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
    @Autowired UserService accounts;
    @Autowired WorkLogRepository workLogs;
    @Autowired PinRepository pins;
    @Autowired org.springframework.transaction.PlatformTransactionManager transactionManager;
    User admin, founder, employee;

    @BeforeEach
    void setup() {
        jdbc.execute("ALTER TABLE tasks ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP");
        jdbc.execute("ALTER TABLE work_logs ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP");
        jdbc.execute("ALTER TABLE work_logs ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP");
        String department = "部门-" + UUID.randomUUID().toString().substring(0, 8);
        admin = member(User.Role.ADMIN, department);
        founder = member(User.Role.FOUNDER, department);
        employee = member(User.Role.EMPLOYEE, department);
    }

    User member(User.Role role, String department) {
        User u = new User();
        u.setId(UUID.randomUUID().toString().replace("-", "").substring(0, 30));
        u.setName(u.getId()); u.setRole(role); u.setDepartment(department);
        u.setPhone("1" + ThreadLocalRandom.current().nextLong(1000000000L, 9999999999L));
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

    private String avatar() throws Exception {
        var image = new java.awt.image.BufferedImage(2, 2, java.awt.image.BufferedImage.TYPE_INT_RGB);
        var bytes = new java.io.ByteArrayOutputStream();
        javax.imageio.ImageIO.write(image, "jpg", bytes);
        return "data:image/jpeg;base64," + Base64.getEncoder().encodeToString(bytes.toByteArray());
    }

    private void disable(User target) {
        accounts.updateUser(admin, target.getId(), target.getName(), target.getPhone(), null, null,
                target.getDepartment(), target.getRole().name(), false);
    }

    @Test
    void staleAvatarProfileAndPasswordWritesCannotRestoreOldCredentialsOrReenableAccount() throws Exception {
        String token = auth.authenticate(employee.getName(), "test-pass-123");
        User stale = users.findById(employee.getId()).orElseThrow();
        accounts.resetPassword(admin, employee.getId(), "new-password-456");
        String image = avatar();
        accounts.updateAvatar(stale, image);
        accounts.updateProfile(stale, employee.getName(), "男", "11010119900101001X");
        assertThrows(IllegalArgumentException.class, () -> accounts.changePassword(stale, "test-pass-123", "try-to-restore-789"));
        User saved = users.findById(employee.getId()).orElseThrow();
        assertTrue(encoder.matches("new-password-456", saved.getPasswordHash()));
        assertTrue(saved.getAuthVersion() > stale.getAuthVersion());
        assertNull(auth.validateToken(token));
        assertThrows(IllegalArgumentException.class, () -> auth.authenticate(employee.getName(), "test-pass-123"));
        disable(saved);
        assertThrows(IllegalArgumentException.class, () -> accounts.updateAvatar(stale, image));
        assertThrows(IllegalArgumentException.class, () -> accounts.updateProfile(stale, "旧请求", "男", "11010119900101001X"));
        assertFalse(users.findById(employee.getId()).orElseThrow().isEnabled());
        assertNull(auth.validateToken(token));
    }

    @Test
    void concurrentAvatarAndAccountMaintenanceKeepDisableAndResetEffective() throws Exception {
        String token = auth.authenticate(employee.getName(), "test-pass-123"), image = avatar();
        race(() -> accounts.updateAvatar(employee, image), () -> {
            accounts.resetPassword(admin, employee.getId(), "reset-password-456");
            disable(employee); return null;
        });
        User saved = users.findById(employee.getId()).orElseThrow();
        assertFalse(saved.isEnabled());
        assertTrue(encoder.matches("reset-password-456", saved.getPasswordHash()));
        assertEquals(2, saved.getAuthVersion());
        assertNull(auth.validateToken(token));
    }

    @Test
    void accountEditRefreshesAnAlreadyManagedUserBeforeSaving() throws Exception {
        String image = avatar();
        var tx = new org.springframework.transaction.support.TransactionTemplate(transactionManager);
        tx.executeWithoutResult(status -> {
            User cached = users.findById(employee.getId()).orElseThrow();
            try (var pool = Executors.newSingleThreadExecutor()) {
                pool.submit(() -> accounts.updateAvatar(employee, image)).get(10, TimeUnit.SECONDS);
            } catch (Exception e) { throw new RuntimeException(e); }
            assertNull(cached.getAvatarData(), "simulate an old OSIV entity");
            accounts.updateUser(admin, employee.getId(), employee.getName(), employee.getPhone(), null, null,
                    employee.getDepartment(), "EMPLOYEE", true);
        });
        assertEquals(image, users.findById(employee.getId()).orElseThrow().getAvatarData());
    }

    @Test
    void concurrentLogEditsPreserveBothSavedContentsInVersionHistory() throws Exception {
        String today = LocalDate.now().toString();
        WorkLog original = logs.saveLog(employee, Map.of("date", today, "content", "原始日报"), null);
        List<Boolean> results = race(
                () -> logs.saveLog(employee, Map.of("date", today, "content", "并发内容甲"), original.getId()),
                () -> logs.saveLog(employee, Map.of("date", today, "content", "并发内容乙"), original.getId()));
        assertEquals(List.of(true, true), results);
        WorkLog saved = workLogs.findById(original.getId()).orElseThrow();
        Set<String> contents = new HashSet<>(); contents.add(saved.getContent());
        var versions = jdbc.queryForList("SELECT content FROM log_versions WHERE log_id = ?", String.class, saved.getId());
        contents.addAll(versions);
        assertEquals(Set.of("原始日报", "并发内容甲", "并发内容乙"), contents);
        assertEquals(2, versions.size());
    }

    @Test
    void concurrentFirstLogWritesProduceOneDailyLogAndKeepTheOtherVersion() throws Exception {
        String today = LocalDate.now().toString();
        assertEquals(List.of(true, true), race(
                () -> logs.saveLog(employee, Map.of("date", today, "content", "首次内容甲"), null),
                () -> logs.saveLog(employee, Map.of("date", today, "content", "首次内容乙"), null)));
        WorkLog saved = workLogs.findByAuthorIdAndDate(employee.getId(), LocalDate.now()).orElseThrow();
        var versions = jdbc.queryForList("SELECT content FROM log_versions WHERE log_id = ?", String.class, saved.getId());
        assertEquals(1, versions.size());
        assertEquals(Set.of("首次内容甲", "首次内容乙"), Set.of(saved.getContent(), versions.getFirst()));
    }

    @Test
    void duplicateConcurrentCreateRequestsShareOnePendingRequest() throws Exception {
        var input = values("双击提交");
        assertEquals(List.of(true, true), race(
                () -> service.requestTaskChange(employee, "create", input, null),
                () -> service.requestTaskChange(employee, "create", input, null)));
        var pending = requests.findByProposerId(employee.getId()).stream()
                .filter(r -> r.getStatus() == ChangeRequest.Status.PENDING).toList();
        assertEquals(1, pending.size());
        service.reviewTaskChange(admin, pending.getFirst().getId(), true, "");
        assertTrue(tasks.existsById(pending.getFirst().getTaskId()));
    }

    @Test
    void archivedPinsAreRemovedAndLegacyInvalidPinsDoNotConsumeTheQuota() {
        List<String> ids = new ArrayList<>();
        for (int i = 0; i < 11; i++) ids.add(createTask());
        for (int i = 0; i < 10; i++) service.togglePin(employee, ids.get(i));
        ChangeRequest deletion = service.requestTaskChange(admin, "delete", null, ids.getFirst());
        service.reviewTaskChange(founder, deletion.getId(), true, "");
        assertTrue(pins.findByUserIdAndTaskId(employee.getId(), ids.getFirst()).isEmpty());
        assertEquals(9, service.getUserPins(employee.getId()).size());
        Pin stale = new Pin(); stale.setUserId(employee.getId()); stale.setTaskId(ids.getFirst()); pins.saveAndFlush(stale);
        assertEquals(9, service.togglePin(employee, ids.getFirst()).size(), "an unavailable task can still be unpinned");
        Pin legacy = new Pin(); legacy.setUserId(employee.getId()); legacy.setTaskId(ids.getFirst()); pins.saveAndFlush(legacy);
        assertEquals(10, service.togglePin(employee, ids.getLast()).size());
        assertTrue(pins.findByUserIdAndTaskId(employee.getId(), ids.getFirst()).isEmpty());
    }

    @Test
    void disabledOwnerBlocksCreateAndEditApprovalButAllowsRejection() {
        ChangeRequest creation = service.requestTaskChange(admin, "create", values("待审批创建"), null);
        disable(employee);
        assertThrows(IllegalArgumentException.class, () -> service.reviewTaskChange(founder, creation.getId(), true, ""));
        assertFalse(tasks.existsById(creation.getTaskId()));
        assertEquals(ChangeRequest.Status.PENDING, requests.findById(creation.getId()).orElseThrow().getStatus());
        service.reviewTaskChange(founder, creation.getId(), false, "负责人已停用，请更换");
        accounts.updateUser(admin, employee.getId(), employee.getName(), employee.getPhone(), null, null,
                employee.getDepartment(), "EMPLOYEE", true);
        String id = createTask();
        ChangeRequest edit = service.requestTaskChange(admin, "edit", values("待审批修改"), id);
        disable(employee);
        assertThrows(IllegalArgumentException.class, () -> service.reviewTaskChange(founder, edit.getId(), true, ""));
        assertEquals("并发任务", tasks.findById(id).orElseThrow().getTitle());
        service.reviewTaskChange(founder, edit.getId(), false, "更换负责人后重新申请");
    }

    @Test
    void concurrentPinAndArchiveCannotLeaveAnArchivedPin() throws Exception {
        String id = createTask();
        ChangeRequest deletion = service.requestTaskChange(admin, "delete", null, id);
        race(() -> service.togglePin(employee, id),
                () -> service.reviewTaskChange(founder, deletion.getId(), true, ""));
        assertTrue(tasks.findById(id).orElseThrow().getDeleted());
        assertTrue(pins.findByUserIdAndTaskId(employee.getId(), id).isEmpty());
        assertTrue(service.getUserPins(employee.getId()).isEmpty());
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
