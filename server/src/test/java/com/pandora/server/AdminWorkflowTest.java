package com.pandora.server;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.pandora.server.config.DataSeeder;
import com.pandora.server.model.User;
import com.pandora.server.repository.UserRepository;
import com.pandora.server.service.AuthService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:admin-test;MODE=MySQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.jpa.hibernate.ddl-auto=create-drop", "spring.sql.init.mode=never",
        "spring.jpa.show-sql=false", "debug=false", "logging.level.root=WARN", "logging.level.org.hibernate.SQL=WARN"
})
@AutoConfigureMockMvc
class AdminWorkflowTest {
    @Autowired MockMvc mvc;
    @Autowired UserRepository users;
    @Autowired AuthService auth;
    @Autowired PasswordEncoder encoder;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @MockBean DataSeeder seeder;
    private String admin, founder, employee;

    @BeforeEach
    void setup() {
        // Production schema.sql supplies this database-generated timestamp.
        jdbc.execute("ALTER TABLE tasks ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP");
        for (var role : new User.Role[]{User.Role.ADMIN, User.Role.FOUNDER, User.Role.EMPLOYEE}) {
            User u = new User();
            u.setId(role.name().toLowerCase()); u.setRole(role);
            u.setName(role.name()); u.setDepartment("研发部");
            u.setPasswordHash(encoder.encode("test-pass-123"));
            users.saveAndFlush(u);
        }
        admin = auth.authenticate("ADMIN", "test-pass-123");
        founder = auth.authenticate("FOUNDER", "test-pass-123");
        employee = auth.authenticate("EMPLOYEE", "test-pass-123");
    }

    private JsonNode call(String method, String path, String token, Object body) throws Exception {
        var request = switch (method) {
            case "POST" -> post(path);
            case "PUT" -> put(path);
            default -> get(path);
        };
        request.header("Authorization", "Bearer " + token);
        if (body != null) request.contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body));
        return json.readTree(mvc.perform(request).andExpect(status().isOk()).andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8));
    }

    @Test
    void accessIsEnforcedAtServerAndStaticAssetsArePublic() throws Exception {
        mvc.perform(get("/app.js")).andExpect(status().isOk());
        mvc.perform(get("/style.css")).andExpect(status().isOk());
        mvc.perform(get("/api/admin/users")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/admin/users").header("Authorization", "Bearer " + employee))
                .andExpect(status().isForbidden());
        assertTrue(call("GET", "/api/admin/users", founder, null).isArray());
        mvc.perform(post("/api/admin/users").header("Authorization", "Bearer " + founder)
                .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"越权\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void accountMaintenanceProtectsPrivilegedUsersAndRevokesCredentials() throws Exception {
        String phone = "13800138001";
        JsonNode created = call("POST", "/api/admin/users", admin, Map.of("phone", phone, "name", "新成员", "gender", "女", "idNumber", "11010119900101001X", "department", "研发部", "role", "EMPLOYEE"));
        String id = created.get("id").asText(), password = created.get("temporaryPassword").asText();
        assertEquals(18, password.length());
        assertTrue(password.matches(".*[A-Z].*") && password.matches(".*[a-z].*") && password.matches(".*[0-9].*") && password.matches(".*[^A-Za-z0-9].*"));
        String token = auth.authenticate(phone, password);
        assertEquals(id, auth.validateToken(token));
        assertEquals(id, auth.validateToken(auth.authenticate("新成员", password)));
        var body = Map.of("name", "成员更新", "phone", phone, "department", "产品部", "role", "TEAM_LEAD", "enabled", false);
        mvc.perform(put("/api/admin/users/" + id).header("Authorization", "Bearer " + founder)
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body)))
                .andExpect(status().isForbidden());
        mvc.perform(put("/api/admin/users/founder").header("Authorization", "Bearer " + admin)
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body)))
                .andExpect(status().isBadRequest());
        call("PUT", "/api/admin/users/" + id, admin, body);
        assertNull(auth.validateToken(token));
        assertThrows(IllegalArgumentException.class, () -> auth.authenticate(phone, password));
        call("PUT", "/api/admin/users/" + id, admin, Map.of("name", "成员更新", "phone", phone, "department", "产品部", "role", "TEAM_LEAD", "enabled", true));
        assertNull(auth.validateToken(token), "Re-enabling must not revive old tokens");
        String enabledToken = auth.authenticate(phone, password);
        call("POST", "/api/admin/users/" + id + "/password", admin, Map.of("password", "reset-pass-456"));
        assertNull(auth.validateToken(enabledToken));
        assertThrows(IllegalArgumentException.class, () -> auth.authenticate(phone, password));
        assertEquals(id, auth.validateToken(auth.authenticate(phone, "reset-pass-456")));
        JsonNode list = call("GET", "/api/admin/users", admin, null);
        assertTrue(list.findValuesAsText("phone").contains(phone));
        assertTrue(list.findValues("temporaryPassword").isEmpty());
        assertTrue(list.findValues("passwordHash").isEmpty());
    }

    @Test
    void taskCreateEditAndDeleteMustGoThroughAnotherReviewer() throws Exception {
        var values = Map.of("title", "待审核任务", "owners", new String[]{"employee"}, "dueAt", "2027-01-10T18:00", "priority", "high", "detail", "初始说明");
        JsonNode request = call("POST", "/api/tasks/requests", admin, Map.of("kind", "create", "values", values));
        String requestId = request.get("id").asText(), taskId = request.get("taskId").asText();
        assertFalse(call("GET", "/api/admin/tasks", admin, null).findValuesAsText("id").contains(taskId));
        mvc.perform(post("/api/tasks/requests/" + requestId + "/review").header("Authorization", "Bearer " + admin)
                .contentType(MediaType.APPLICATION_JSON).content("{\"approve\":true}")).andExpect(status().isBadRequest());
        mvc.perform(post("/api/tasks/requests/" + requestId + "/review").header("Authorization", "Bearer " + founder)
                .contentType(MediaType.APPLICATION_JSON).content("{\"approve\":false}")).andExpect(status().isBadRequest());
        call("POST", "/api/tasks/requests/" + requestId + "/review", founder, Map.of("approve", true));
        assertTrue(call("GET", "/api/admin/tasks", admin, null).findValuesAsText("id").contains(taskId));

        var edited = Map.of("title", "修改后的任务", "owners", new String[]{"employee"}, "dueAt", "2027-01-11T18:00", "priority", "low", "detail", "修改说明");
        JsonNode edit = call("POST", "/api/tasks/requests", founder, Map.of("kind", "edit", "taskId", taskId, "values", edited));
        assertEquals("待审核任务", edit.get("before").get("title").asText());
        assertEquals("修改后的任务", edit.get("after").get("title").asText());
        call("POST", "/api/tasks/requests/" + edit.get("id").asText() + "/review", admin, Map.of("approve", true));
        assertTrue(call("GET", "/api/admin/tasks", founder, null).findValuesAsText("title").contains("修改后的任务"));

        JsonNode deletion = call("POST", "/api/tasks/requests", admin, Map.of("kind", "delete", "taskId", taskId));
        call("POST", "/api/tasks/requests/" + deletion.get("id").asText() + "/review", founder, Map.of("approve", false, "reason", "需要保留"));
        assertTrue(call("GET", "/api/admin/tasks", admin, null).findValuesAsText("id").contains(taskId));
        JsonNode retry = call("POST", "/api/tasks/requests", admin, Map.of("kind", "delete", "taskId", taskId));
        call("POST", "/api/tasks/requests/" + retry.get("id").asText() + "/review", founder, Map.of("approve", true));
        assertFalse(call("GET", "/api/admin/tasks", admin, null).findValuesAsText("id").contains(taskId));
    }

    @Test
    void taskIntervalsPersistThroughApprovalAndRejectInvalidDates() throws Exception {
        var values = Map.of("title", "持续一周", "owners", new String[]{"employee"}, "startAt", "2027-01-04T09:00", "dueAt", "2027-01-10T18:00", "priority", "high", "detail", "跨天执行");
        JsonNode request = call("POST", "/api/tasks/requests", admin, Map.of("kind", "create", "values", values));
        assertEquals("2027-01-04T09:00", request.get("after").get("startAt").asText());
        String taskId = request.get("taskId").asText();
        call("POST", "/api/tasks/requests/" + request.get("id").asText() + "/review", founder, Map.of("approve", true));
        JsonNode task = call("GET", "/api/admin/tasks", admin, null).findParents("id").stream().filter(t -> taskId.equals(t.get("id").asText())).findFirst().orElseThrow();
        assertEquals("2027-01-04T09:00", task.get("startAt").asText());
        assertEquals("2027-01-10T18:00", task.get("dueAt").asText());
        var edited = Map.of("title", "延后一周", "owners", new String[]{"employee"}, "dueAt", "2027-01-17T18:00", "priority", "high");
        JsonNode edit = call("POST", "/api/tasks/requests", founder, Map.of("kind", "edit", "taskId", taskId, "values", edited));
        assertEquals("2027-01-04T09:00", edit.get("before").get("startAt").asText());
        assertEquals("2027-01-04T09:00", edit.get("after").get("startAt").asText(), "Legacy clients must preserve start time");
        call("POST", "/api/tasks/requests/" + edit.get("id").asText() + "/review", admin, Map.of("approve", true));
        JsonNode workspace = call("GET", "/api/workspace", employee, null);
        JsonNode saved = workspace.get("db").get("tasks").findParents("id").stream().filter(t -> taskId.equals(t.get("id").asText())).findFirst().orElseThrow();
        assertEquals("2027-01-04T09:00", saved.get("startAt").asText());
        assertEquals("2027-01-17T18:00", saved.get("dueAt").asText());
        for (String invalid : new String[]{"2027-01-11T09:00", "2027-02-30T09:00", "2027-01-04", ""}) {
            var bad = new java.util.HashMap<String, Object>(values); bad.put("startAt", invalid);
            mvc.perform(post("/api/tasks/requests").header("Authorization", "Bearer " + admin).contentType(MediaType.APPLICATION_JSON)
                    .content(json.writeValueAsString(Map.of("kind", "create", "values", bad)))).andExpect(status().isBadRequest());
        }
    }

    @Test
    void employeeCanRequestOwnTasksButCannotAssignOthersOrReview() throws Exception {
        var values = Map.of("title", "本人创建任务", "owners", new String[]{"employee"}, "dueAt", "2027-01-10T18:00", "priority", "high", "detail", "本人负责");
        JsonNode request = call("POST", "/api/tasks/requests", employee, Map.of("kind", "create", "values", values));
        String taskId = request.get("taskId").asText();
        assertFalse(call("GET", "/api/workspace", employee, null).get("db").get("tasks").findValuesAsText("id").contains(taskId));
        mvc.perform(post("/api/tasks/requests/" + request.get("id").asText() + "/review").header("Authorization", "Bearer " + employee)
                .contentType(MediaType.APPLICATION_JSON).content("{\"approve\":true}")).andExpect(status().isBadRequest());
        var forbiddenValues = Map.of("title", "越权任务", "owners", new String[]{"founder"}, "dueAt", "2027-01-10T18:00", "priority", "high");
        mvc.perform(post("/api/tasks/requests").header("Authorization", "Bearer " + employee)
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(Map.of("kind", "create", "values", forbiddenValues))))
                .andExpect(status().isBadRequest());
        call("POST", "/api/tasks/requests/" + request.get("id").asText() + "/review", admin, Map.of("approve", true));
        assertTrue(call("GET", "/api/workspace", employee, null).get("db").get("tasks").findValuesAsText("id").contains(taskId));
        mvc.perform(post("/api/tasks/requests").header("Authorization", "Bearer " + employee)
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(Map.of("kind", "delete", "taskId", taskId))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void profileIsPrivateAndAvatarPersistsWithoutChangingLogin() throws Exception {
        User member = users.findById("employee").orElseThrow();
        member.setPhone("13800138008"); member.setGender("男"); member.setIdNumber("11010119900101001X"); users.saveAndFlush(member);
        JsonNode login = call("POST", "/api/auth/login", "", Map.of("identifier", "138 0013 8008", "password", "test-pass-123"));
        assertEquals("employee", login.get("user").get("id").asText());
        assertEquals("男", login.get("user").get("gender").asText());
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"identifier\":\"employee\",\"password\":\"test-pass-123\"}")).andExpect(status().isBadRequest());
        JsonNode workspace = call("GET", "/api/workspace", employee, null);
        assertEquals(member.getIdNumber(), workspace.get("user").get("idNumber").asText());
        assertTrue(workspace.get("db").get("members").findValues("phone").isEmpty());
        assertTrue(workspace.get("db").get("members").findValues("idNumber").isEmpty());
        var bytes = new java.io.ByteArrayOutputStream();
        javax.imageio.ImageIO.write(new java.awt.image.BufferedImage(32, 32, java.awt.image.BufferedImage.TYPE_INT_RGB), "jpeg", bytes);
        String avatar = "data:image/jpeg;base64," + java.util.Base64.getEncoder().encodeToString(bytes.toByteArray());
        call("PUT", "/api/auth/profile/avatar", employee, Map.of("avatarData", avatar));
        assertEquals(avatar, call("GET", "/api/auth/me", employee, null).get("avatarData").asText());
        assertFalse(call("GET", "/api/workspace", employee, null).get("db").get("members").findValues("avatarData").iterator().hasNext());
        mvc.perform(put("/api/auth/profile/avatar").header("Authorization", "Bearer " + employee).contentType(MediaType.APPLICATION_JSON)
                .content("{\"avatarData\":\"data:image/jpeg;base64,dGVzdA==\"}")).andExpect(status().isBadRequest());
        assertEquals(avatar, call("GET", "/api/auth/me", employee, null).get("avatarData").asText());
    }

    @Test
    void announcementsCanBeEditedPinnedAndDeletedByBothGlobalRoles() throws Exception {
        JsonNode created = call("POST", "/api/admin/announcements", founder, Map.of("title", "通知", "content", "正文", "category", "通知"));
        String id = created.get("id").asText();
        JsonNode updated = call("PUT", "/api/admin/announcements/" + id, admin,
                Map.of("title", "更新通知", "content", "更新正文", "category", "制度", "pinned", true));
        assertTrue(updated.get("pinned").asBoolean());
        assertEquals("更新正文", updated.get("content").asText());
        assertEquals(id, call("GET", "/api/announcements", founder, null).get(0).get("id").asText());
        mvc.perform(delete("/api/admin/announcements/" + id).header("Authorization", "Bearer " + founder))
                .andExpect(status().isOk());
        assertFalse(call("GET", "/api/announcements", admin, null).findValuesAsText("id").contains(id));
    }

    @Test
    void highlightsRespectSlotsPublicationAudienceAndTaskVisibility() throws Exception {
        mvc.perform(get("/api/admin/highlights")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/admin/highlights").header("Authorization", "Bearer " + employee)).andExpect(status().isForbidden());
        var company = new java.util.HashMap<String, Object>(Map.of("kind", "company", "position", 1, "title", "公司重点", "content", "详细安排", "enabled", true));
        String id = call("POST", "/api/admin/highlights", admin, company).get("id").asText();
        mvc.perform(post("/api/admin/highlights").header("Authorization", "Bearer " + founder).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(company))).andExpect(status().isBadRequest());
        for (int position = 2; position <= 10; position++) {
            company.put("position", position); call("POST", "/api/admin/highlights", admin, company);
        }
        company.put("position", 11);
        mvc.perform(post("/api/admin/highlights").header("Authorization", "Bearer " + admin).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(company))).andExpect(status().isBadRequest());
        String personal = call("POST", "/api/admin/highlights", founder, Map.of("kind", "personal", "audience", "employee", "position", 1, "title", "个人重点", "content", "只给本人展示")).get("id").asText();
        call("POST", "/api/admin/highlights", admin, Map.of("kind", "personal", "audience", "founder", "position", 1, "title", "另一个人的重点", "content", "互不占位"));
        assertTrue(call("GET", "/api/workspace", employee, null).get("db").get("highlights").findValuesAsText("id").contains(personal));
        assertFalse(call("GET", "/api/workspace", founder, null).get("db").get("highlights").findValuesAsText("id").contains(personal));
        company.put("position", 1); company.put("enabled", false);
        call("PUT", "/api/admin/highlights/" + id, founder, company);
        assertFalse(call("GET", "/api/workspace", employee, null).get("db").get("highlights").findValuesAsText("id").contains(id));

        var values = Map.of("title", "派发重点测试", "owners", new String[]{"founder"}, "dueAt", "2027-01-10T18:00", "priority", "high", "detail", "事务详情");
        JsonNode request = call("POST", "/api/tasks/requests", founder, Map.of("kind", "create", "values", values));
        String taskId = request.get("taskId").asText();
        var dispatch = Map.of("kind", "dispatch", "position", 1, "title", "派发重点", "content", "关联任务", "taskId", taskId);
        mvc.perform(post("/api/admin/highlights").header("Authorization", "Bearer " + admin).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(dispatch))).andExpect(status().isBadRequest());
        call("POST", "/api/tasks/requests/" + request.get("id").asText() + "/review", admin, Map.of("approve", true));
        String dispatchId = call("POST", "/api/admin/highlights", admin, dispatch).get("id").asText();
        assertTrue(call("GET", "/api/workspace", founder, null).get("db").get("highlights").findValuesAsText("id").contains(dispatchId));
        assertFalse(call("GET", "/api/workspace", employee, null).get("db").get("highlights").findValuesAsText("id").contains(dispatchId));
        mvc.perform(delete("/api/admin/highlights/" + id).header("Authorization", "Bearer " + employee)).andExpect(status().isForbidden());
        mvc.perform(delete("/api/admin/highlights/" + id).header("Authorization", "Bearer " + admin)).andExpect(status().isOk());
        assertFalse(call("GET", "/api/admin/highlights", founder, null).findValuesAsText("id").contains(id));
    }
}
