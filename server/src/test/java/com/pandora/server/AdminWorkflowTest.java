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
        admin = auth.authenticate("admin", "test-pass-123");
        founder = auth.authenticate("founder", "test-pass-123");
        employee = auth.authenticate("employee", "test-pass-123");
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
        String id = "new-worker";
        call("POST", "/api/admin/users", admin, Map.of("login", id, "name", "新成员", "department", "研发部", "role", "EMPLOYEE"));
        String token = auth.authenticate(id, id);
        assertEquals(id, auth.validateToken(token));
        var body = Map.of("name", "成员更新", "department", "产品部", "role", "TEAM_LEAD", "enabled", false);
        mvc.perform(put("/api/admin/users/" + id).header("Authorization", "Bearer " + founder)
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body)))
                .andExpect(status().isForbidden());
        mvc.perform(put("/api/admin/users/founder").header("Authorization", "Bearer " + admin)
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body)))
                .andExpect(status().isBadRequest());
        call("PUT", "/api/admin/users/" + id, admin, body);
        assertNull(auth.validateToken(token));
        assertThrows(IllegalArgumentException.class, () -> auth.authenticate(id, id));
        call("PUT", "/api/admin/users/" + id, admin, Map.of("name", "成员更新", "department", "产品部", "role", "TEAM_LEAD", "enabled", true));
        assertNull(auth.validateToken(token), "Re-enabling must not revive old tokens");
        String enabledToken = auth.authenticate(id, id);
        call("POST", "/api/admin/users/" + id + "/password", admin, Map.of("password", "reset-pass-456"));
        assertNull(auth.validateToken(enabledToken));
        assertThrows(IllegalArgumentException.class, () -> auth.authenticate(id, id));
        assertEquals(id, auth.validateToken(auth.authenticate(id, "reset-pass-456")));
        JsonNode list = call("GET", "/api/admin/users", admin, null);
        assertTrue(list.findValuesAsText("login").contains(id));
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
}
