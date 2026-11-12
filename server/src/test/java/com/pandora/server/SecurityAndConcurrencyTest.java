package com.pandora.server;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.pandora.server.model.*;
import com.pandora.server.repository.*;
import com.pandora.server.service.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:security-concurrency;MODE=MySQL;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
    "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
    "spring.jpa.hibernate.ddl-auto=create-drop", "spring.sql.init.mode=never", "logging.level.root=WARN"
})
@ActiveProfiles("test")
@AutoConfigureMockMvc
class SecurityAndConcurrencyTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired UserRepository users;
    @Autowired TaskRepository tasks;
    @Autowired ChangeRequestRepository requests;
    @Autowired TaskService service;
    @Autowired LogService logs;
    @Autowired AuthService auth;
    @Autowired PasswordEncoder encoder;
    @Autowired JdbcTemplate jdbc;
    User admin, founder, employee;

    @BeforeEach
    void setup() {
        jdbc.execute("ALTER TABLE tasks ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP");
        jdbc.execute("ALTER TABLE work_logs ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP");
        jdbc.execute("ALTER TABLE work_logs ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP");
        admin = member(User.Role.ADMIN, "部门甲");
        founder = member(User.Role.FOUNDER, "部门甲");
        employee = member(User.Role.EMPLOYEE, "部门甲");
    }

    User member(User.Role role, String department) {
        User u = new User();
        u.setId(UUID.randomUUID().toString().replace("-", "").substring(0, 30));
        u.setName(u.getId()); u.setRole(role); u.setDepartment(department);
        u.setPasswordHash(encoder.encode("test-pass-123"));
        return users.saveAndFlush(u);
    }

    Map<String, Object> values(String title) {
        return Map.of("title", title, "owners", List.of(employee.getId()), "dueAt", "2027-01-10T18:00", "priority", "medium");
    }

    String createTask() {
        ChangeRequest r = service.requestTaskChange(admin, "create", values("并发任务"), null);
        service.reviewTaskChange(founder, r.getId(), true, "");
        return r.getTaskId();
    }

    @Test
    void publicRegistrationCannotCreateAccountsOrReadWorkspace() throws Exception {
        long before = users.count();
        mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
            .content("{\"phone\":\"13999990001\",\"password\":\"test-pass-123\"}"))
            .andExpect(status().isForbidden()).andExpect(jsonPath("$.token").doesNotExist());
        assertEquals(before, users.count());
        for (String path : List.of("/api/workspace", "/api/auth/me"))
            mvc.perform(get(path)).andExpect(status().isUnauthorized());
        mvc.perform(put("/api/auth/profile").contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void personalProfileCannotChangeAuthorizationScope() throws Exception {
        User manager = member(User.Role.DEPT_MANAGER, "部门甲");
        User outsider = member(User.Role.EMPLOYEE, "部门乙");
        logs.saveLog(outsider, Map.of("date", LocalDate.now().toString(), "content", "其他部门机密"), null);
        String token = auth.authenticate(manager.getName(), "test-pass-123");
        for (String key : List.of("department", "role", "phone", "enabled")) {
            var body = new HashMap<String, String>(Map.of("name", manager.getName(), "gender", "男", "idNumber", "11010119900101001X"));
            body.put(key, key.equals("department") ? "部门乙" : "ADMIN");
            mvc.perform(put("/api/auth/profile").header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body))).andExpect(status().isForbidden());
        }
        assertEquals("部门甲", users.findById(manager.getId()).orElseThrow().getDepartment());
        mvc.perform(get("/api/workspace").header("Authorization", "Bearer " + token))
            .andExpect(status().isOk()).andExpect(jsonPath("$.db.logs").isEmpty());
        mvc.perform(put("/api/auth/profile").header("Authorization", "Bearer " + token).contentType(MediaType.APPLICATION_JSON)
            .content(json.writeValueAsString(Map.of("name", "已补充资料", "gender", "男", "idNumber", "11010119900101001X"))))
            .andExpect(status().isOk()).andExpect(jsonPath("$.department").value("部门甲"));
    }

    @Test
    void concurrentReviewsOnlyApplyOneDecision() throws Exception {
        ChangeRequest request = service.requestTaskChange(employee, "create", values("独立审核"), null);
        List<Boolean> results = race(
            () -> service.reviewTaskChange(admin, request.getId(), true, ""),
            () -> service.reviewTaskChange(founder, request.getId(), false, "需调整"));
        assertEquals(1, results.stream().filter(Boolean::booleanValue).count());
        ChangeRequest saved = requests.findById(request.getId()).orElseThrow();
        assertEquals(saved.getStatus() == ChangeRequest.Status.APPROVED, tasks.existsById(request.getTaskId()));
    }

    @Test
    void concurrentChangesCannotCreateTwoPendingRequests() throws Exception {
        String id = createTask();
        List<Boolean> results = race(
            () -> service.requestTaskChange(admin, "edit", values("新名称"), id),
            () -> service.requestTaskChange(founder, "delete", null, id));
        assertEquals(1, results.stream().filter(Boolean::booleanValue).count());
        assertEquals(1, requests.findByStatus(ChangeRequest.Status.PENDING).stream().filter(r -> id.equals(r.getTaskId())).count());
    }

    @Test
    void completionCannotBeOverwrittenByConcurrentProgress() throws Exception {
        String id = createTask();
        race(() -> service.completeTask(employee, id), () -> service.updateTaskDetail(employee, id, "进展记录"));
        Task saved = tasks.findById(id).orElseThrow();
        assertEquals(Task.Status.DONE, saved.getStatus());
        assertNotNull(saved.getCompletedAt());
        assertEquals(1, saved.getHistory().stream().filter(h -> h.getText().contains("标记任务完成")).count());
    }

    private List<Boolean> race(Callable<?> first, Callable<?> second) throws Exception {
        CyclicBarrier start = new CyclicBarrier(2);
        try (var pool = Executors.newFixedThreadPool(2)) {
            List<Future<Boolean>> futures = new ArrayList<>();
            for (Callable<?> action : List.of(first, second)) futures.add(pool.submit(() -> {
                start.await(5, TimeUnit.SECONDS);
                try { action.call(); return true; }
                catch (IllegalArgumentException expected) { return false; }
            }));
            List<Boolean> results = new ArrayList<>();
            for (Future<Boolean> future : futures) results.add(future.get(20, TimeUnit.SECONDS));
            return results;
        }
    }
}
