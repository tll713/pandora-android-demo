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
    @Autowired com.pandora.server.repository.TagRepository tags;
    @MockBean DataSeeder seeder;
    private String admin, founder, employee;

    @BeforeEach
    void setup() {
        // Production schema.sql supplies this database-generated timestamp.
        jdbc.execute("ALTER TABLE tasks ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP");
        jdbc.execute("ALTER TABLE work_logs ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP");
        jdbc.execute("ALTER TABLE work_logs ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP");
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
    void todoReschedulingPersistsAndRejectsOtherOwnersAndInvalidDates() throws Exception {
        String today = java.time.LocalDate.now().toString();
        String nextMonth = java.time.LocalDate.now().plusMonths(1).withDayOfMonth(1).toString();
        JsonNode todo = call("POST", "/api/todos", employee, Map.of("date", today, "title", "需要改期的事项"));
        String path = "/api/todos/" + todo.get("id").asText();
        call("POST", path + "/toggle", employee, null);
        mvc.perform(put(path + "/date").header("Authorization", "Bearer " + admin)
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(Map.of("date", nextMonth))))
                .andExpect(status().isBadRequest());
        mvc.perform(put(path + "/date").header("Authorization", "Bearer " + employee)
                .contentType(MediaType.APPLICATION_JSON).content("{\"date\":\"2026-02-30\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(put(path + "/date").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isUnauthorized());
        JsonNode moved = call("PUT", path + "/date", employee, Map.of("date", nextMonth));
        assertEquals(nextMonth, moved.get("date").asText());
        assertTrue(moved.get("done").asBoolean());
        JsonNode workspace = call("GET", "/api/workspace", employee, null);
        assertTrue(java.util.stream.StreamSupport.stream(workspace.get("db").get("todos").spliterator(), false)
                .anyMatch(item -> item.get("id").equals(todo.get("id")) && item.get("date").asText().equals(nextMonth)));
    }

    @Test
    void dailyReportTagIsSavedAndCanBeClearedOnEdit() throws Exception {
        String today = java.time.LocalDate.now().toString();
        JsonNode log = call("POST", "/api/logs", employee, Map.of("values", Map.of("date", today,
                "content", "【今日完成】\n完成工作\n\n【下一步计划】\n\n\n【问题与协助】", "tagId", "design")));
        assertEquals("design", log.get("tagId").asText());
        JsonNode edited = call("POST", "/api/logs", employee, Map.of("logId", log.get("id").asText(), "values",
                Map.of("date", today, "content", "更新工作", "tagId", "")));
        assertTrue(edited.get("tagId").isNull());
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
    void taskTagsPersistThroughApprovalAndCanBeChangedOrCleared() throws Exception {
        for (String id : new String[]{"tag-design", "tag-meeting"}) {
            var tag = new com.pandora.server.model.Tag();
            tag.setId(id); tag.setName(id); tag.setColor("#9b59b6"); tags.save(tag);
        }
        var values = new java.util.HashMap<String, Object>(Map.of("title", "标签任务", "owners", new String[]{"employee"},
                "dueAt", "2027-01-10T18:00", "priority", "high", "detail", "标签应随审核生效", "tagId", "tag-design"));
        JsonNode request = call("POST", "/api/tasks/requests", admin, Map.of("kind", "create", "values", values));
        String taskId = request.get("taskId").asText();
        assertEquals("tag-design", request.path("after").path("tagId").asText());
        call("POST", "/api/tasks/requests/" + request.get("id").asText() + "/review", founder, Map.of("approve", true));
        assertEquals("tag-design", jdbc.queryForObject("SELECT tag_id FROM tasks WHERE id=?", String.class, taskId));
        JsonNode workspaceTask = call("GET", "/api/workspace", employee, null).path("db").path("tasks")
                .findParents("id").stream().filter(t -> taskId.equals(t.path("id").asText())).findFirst().orElseThrow();
        assertEquals("tag-design", workspaceTask.path("tagId").asText());

        values.put("tagId", "tag-meeting");
        JsonNode edit = call("POST", "/api/tasks/requests", admin, Map.of("kind", "edit", "taskId", taskId, "values", values));
        assertEquals("tag-design", edit.path("before").path("tagId").asText());
        assertEquals("tag-design", jdbc.queryForObject("SELECT tag_id FROM tasks WHERE id=?", String.class, taskId));
        call("POST", "/api/tasks/requests/" + edit.get("id").asText() + "/review", founder, Map.of("approve", true));
        assertEquals("tag-meeting", jdbc.queryForObject("SELECT tag_id FROM tasks WHERE id=?", String.class, taskId));

        values.remove("tagId");
        JsonNode legacy = call("POST", "/api/tasks/requests", admin, Map.of("kind", "edit", "taskId", taskId, "values", values));
        assertEquals("tag-meeting", legacy.path("after").path("tagId").asText());
        var oldSnapshot = legacy.path("after").deepCopy();
        ((com.fasterxml.jackson.databind.node.ObjectNode) oldSnapshot).remove("tagId");
        jdbc.update("UPDATE change_requests SET after_json=? WHERE id=?", json.writeValueAsString(oldSnapshot), legacy.get("id").asText());
        call("POST", "/api/tasks/requests/" + legacy.get("id").asText() + "/review", founder, Map.of("approve", true));
        assertEquals("tag-meeting", jdbc.queryForObject("SELECT tag_id FROM tasks WHERE id=?", String.class, taskId));

        values.put("tagId", "");
        JsonNode clear = call("POST", "/api/tasks/requests", admin, Map.of("kind", "edit", "taskId", taskId, "values", values));
        assertTrue(clear.path("after").path("tagId").isNull());
        call("POST", "/api/tasks/requests/" + clear.get("id").asText() + "/review", founder, Map.of("approve", true));
        assertNull(jdbc.queryForObject("SELECT tag_id FROM tasks WHERE id=?", String.class, taskId));

        values.put("tagId", "tag-does-not-exist");
        mvc.perform(post("/api/tasks/requests").header("Authorization", "Bearer " + admin).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("kind", "create", "values", values)))).andExpect(status().isBadRequest());
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
        assertEquals("首页事件纪新增事项", notices(employee, id).getFirst().path("summary").asText());
        mvc.perform(post("/api/admin/highlights").header("Authorization", "Bearer " + founder).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(company))).andExpect(status().isBadRequest());
        for (int position = 2; position <= 10; position++) {
            company.put("position", position); call("POST", "/api/admin/highlights", admin, company);
        }
        company.put("position", 11);
        mvc.perform(post("/api/admin/highlights").header("Authorization", "Bearer " + admin).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(company))).andExpect(status().isBadRequest());
        String personal = call("POST", "/api/admin/highlights", founder, Map.of("kind", "personal", "audience", "employee", "position", 1, "title", "个人重点", "content", "只给本人展示")).get("id").asText();
        assertEquals(1, notices(employee, personal).size());
        assertTrue(notices(founder, personal).isEmpty());
        call("POST", "/api/admin/highlights", admin, Map.of("kind", "personal", "audience", "founder", "position", 1, "title", "另一个人的重点", "content", "互不占位"));
        assertTrue(call("GET", "/api/workspace", employee, null).get("db").get("highlights").findValuesAsText("id").contains(personal));
        assertFalse(call("GET", "/api/workspace", founder, null).get("db").get("highlights").findValuesAsText("id").contains(personal));
        company.put("position", 1); company.put("enabled", false);
        call("PUT", "/api/admin/highlights/" + id, founder, company);
        assertTrue(notices(employee, id).stream().anyMatch(n -> n.path("summary").asText().contains("撤下")));
        assertFalse(call("GET", "/api/workspace", employee, null).get("db").get("highlights").findValuesAsText("id").contains(id));

        var values = Map.of("title", "派发重点测试", "owners", new String[]{"founder"}, "dueAt", "2027-01-10T18:00", "priority", "high", "detail", "事务详情");
        JsonNode request = call("POST", "/api/tasks/requests", founder, Map.of("kind", "create", "values", values));
        String taskId = request.get("taskId").asText();
        var dispatch = Map.of("kind", "dispatch", "position", 1, "title", "派发重点", "content", "关联任务", "taskId", taskId);
        mvc.perform(post("/api/admin/highlights").header("Authorization", "Bearer " + admin).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(dispatch))).andExpect(status().isBadRequest());
        call("POST", "/api/tasks/requests/" + request.get("id").asText() + "/review", admin, Map.of("approve", true));
        String dispatchId = call("POST", "/api/admin/highlights", admin, dispatch).get("id").asText();
        assertEquals(1, notices(founder, dispatchId).size());
        assertTrue(notices(employee, dispatchId).isEmpty(), "unrelated task updates must not leak through messages");
        assertTrue(call("GET", "/api/workspace", founder, null).get("db").get("highlights").findValuesAsText("id").contains(dispatchId));
        assertFalse(call("GET", "/api/workspace", employee, null).get("db").get("highlights").findValuesAsText("id").contains(dispatchId));
        var disabledDispatch = new java.util.HashMap<String, Object>(dispatch);
        disabledDispatch.put("enabled", false);
        call("PUT", "/api/admin/highlights/" + dispatchId, founder, disabledDispatch);
        assertEquals(2, notices(founder, dispatchId).size());
        assertTrue(notices(founder, dispatchId).stream().allMatch(n -> n.path("kind").asText().equals("tasks")));
        mvc.perform(delete("/api/admin/highlights/" + id).header("Authorization", "Bearer " + employee)).andExpect(status().isForbidden());
        mvc.perform(delete("/api/admin/highlights/" + id).header("Authorization", "Bearer " + admin)).andExpect(status().isOk());
        assertFalse(call("GET", "/api/admin/highlights", founder, null).findValuesAsText("id").contains(id));
    }

    private java.util.List<JsonNode> notices(String token, String targetId) throws Exception {
        return java.util.stream.StreamSupport.stream(call("GET", "/api/workspace", token, null)
                .path("db").path("notifications").spliterator(), false)
                .filter(n -> targetId.equals(n.path("targetId").asText())).toList();
    }

    @Test
    void taskBoardNotificationsPersistForApprovalProgressCompletionAndDeletion() throws Exception {
        var values = Map.of("title", "消息通知测试", "owners", new String[]{"employee"}, "dueAt", "2027-01-10T18:00", "priority", "high");
        JsonNode request = call("POST", "/api/tasks/requests", employee, Map.of("kind", "create", "values", values));
        String taskId = request.path("taskId").asText();
        assertTrue(notices(employee, taskId).isEmpty(), "pending applications do not update the task board");
        call("POST", "/api/tasks/requests/" + request.path("id").asText() + "/review", admin, Map.of("approve", true));
        assertEquals(1, notices(employee, taskId).size());
        assertEquals("tasks", notices(employee, taskId).getFirst().path("kind").asText());
        call("POST", "/api/tasks/" + taskId + "/progress", employee, Map.of("text", "完成第一步"));
        call("POST", "/api/tasks/" + taskId + "/complete", employee, Map.of());
        assertEquals(3, notices(employee, taskId).size());
        assertTrue(notices(employee, taskId).stream().anyMatch(n -> n.path("summary").asText().contains("已完成")));
        JsonNode deletion = call("POST", "/api/tasks/requests", admin, Map.of("kind", "delete", "taskId", taskId));
        call("POST", "/api/tasks/requests/" + deletion.path("id").asText() + "/review", founder, Map.of("approve", true));
        assertEquals(4, notices(employee, taskId).size(), "notifications remain available after the task is removed");

        User next = new User();
        next.setId("next-owner"); next.setName("下一位负责人"); next.setRole(User.Role.EMPLOYEE);
        next.setDepartment("其他部门"); next.setPasswordHash(encoder.encode("test-pass-123")); users.saveAndFlush(next);
        String nextToken = auth.authenticate(next.getName(), "test-pass-123");
        JsonNode reassigned = call("POST", "/api/tasks/requests", admin, Map.of("kind", "create", "values", values));
        String reassignedId = reassigned.path("taskId").asText();
        call("POST", "/api/tasks/requests/" + reassigned.path("id").asText() + "/review", founder, Map.of("approve", true));
        assertTrue(notices(nextToken, reassignedId).isEmpty());
        var changed = Map.of("title", "新范围任务名称", "owners", new String[]{next.getId()}, "dueAt", "2027-01-10T18:00", "priority", "high");
        JsonNode edit = call("POST", "/api/tasks/requests", admin, Map.of("kind", "edit", "taskId", reassignedId, "values", changed));
        call("POST", "/api/tasks/requests/" + edit.path("id").asText() + "/review", founder, Map.of("approve", true));
        assertEquals(2, notices(employee, reassignedId).size());
        assertTrue(notices(employee, reassignedId).stream().noneMatch(n -> n.path("title").asText().equals("新范围任务名称")));
        assertEquals("新范围任务名称", notices(nextToken, reassignedId).getFirst().path("title").asText());
    }

    @Test
    void onlyGlobalRolesCanMaintainSharedTaskTags() throws Exception {
        JsonNode tag = call("POST", "/api/admin/tags", admin, Map.of("name", "共享业务标签", "color", "#a7bfb4"));
        String path = "/api/admin/tags/" + tag.path("id").asText();
        call("PUT", path, founder, Map.of("name", "已更新的共享标签", "color", "#123456"));
        assertTrue(call("GET", "/api/workspace", employee, null).path("db").path("tags")
                .findValuesAsText("name").contains("已更新的共享标签"));
        for (var role : new User.Role[]{User.Role.EMPLOYEE, User.Role.TEAM_LEAD, User.Role.DEPT_MANAGER}) {
            User u = new User();
            u.setId("tag-" + role.name()); u.setName("tag-" + role.name()); u.setRole(role);
            u.setDepartment("研发部"); u.setPasswordHash(encoder.encode("test-pass-123")); users.saveAndFlush(u);
            String token = auth.authenticate(u.getName(), "test-pass-123");
            mvc.perform(post("/api/admin/tags").header("Authorization", "Bearer " + token)
                    .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"越权\",\"color\":\"#123456\"}"))
                    .andExpect(status().isForbidden());
            mvc.perform(put(path).header("Authorization", "Bearer " + token)
                    .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"越权\"}"))
                    .andExpect(status().isForbidden());
        }
        assertEquals("已更新的共享标签", tags.findById(tag.path("id").asText()).orElseThrow().getName());
    }
}
