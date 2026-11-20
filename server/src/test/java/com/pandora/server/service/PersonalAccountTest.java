package com.pandora.server.service;

import com.pandora.server.model.User;
import com.pandora.server.model.WorkLog;
import com.pandora.server.repository.UserRepository;
import com.pandora.server.repository.WorkLogRepository;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class PersonalAccountTest {
    private final UserRepository users = mock(UserRepository.class);
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(4);

    private User user() {
        User user = new User();
        user.setId("manager");
        user.setRole(User.Role.DEPT_MANAGER);
        user.setName("测试用户");
        user.setDepartment("测试部门");
        user.setPasswordHash(encoder.encode("old-pass-123"));
        when(users.findById(user.getId())).thenReturn(Optional.of(user));
        when(users.findByName(user.getName())).thenReturn(List.of(user));
        return user;
    }

    @Test
    void passwordChangeChecksOldPasswordAndInvalidatesExistingTokens() {
        User user = user();
        AuthService auth = new AuthService(users, encoder, "a-test-secret-with-at-least-32-bytes-long", 3600000);
        UserService service = new UserService(users, encoder, mock(jakarta.persistence.EntityManager.class));
        String token = auth.authenticate(user.getName(), "old-pass-123");
        assertEquals(user.getId(), auth.validateToken(token));
        String originalHash = user.getPasswordHash();
        assertThrows(IllegalArgumentException.class, () -> service.changePassword(user, "wrong-pass", "new-pass-456"));
        assertThrows(IllegalArgumentException.class, () -> service.changePassword(user, "old-pass-123", "short"));
        assertThrows(IllegalArgumentException.class, () -> service.changePassword(user, "old-pass-123", "old-pass-123"));
        assertThrows(IllegalArgumentException.class, () -> service.changePassword(user, "old-pass-123", "密".repeat(30)));
        assertEquals(originalHash, user.getPasswordHash());
        verify(users, never()).save(any());

        service.changePassword(user, "old-pass-123", "new-pass-456");
        assertTrue(encoder.matches("new-pass-456", user.getPasswordHash()));
        assertNull(auth.validateToken(token));
        assertThrows(IllegalArgumentException.class, () -> auth.authenticate(user.getName(), "old-pass-123"));
        assertEquals(user.getId(), auth.validateToken(auth.authenticate(user.getName(), "new-pass-456")));
        verify(users).save(user);
    }

    @Test
    void phoneNameLoginHandlesDuplicatesAndNeverAuthenticatesInternalIds() {
        User user = user(); user.setPhone("13800138000");
        when(users.findByPhone("13800138000")).thenReturn(List.of(user));
        AuthService auth = new AuthService(users, encoder, "a-test-secret-with-at-least-32-bytes-long", 3600000);
        assertEquals(user.getId(), auth.validateToken(auth.authenticate("138 0013 8000", "old-pass-123")));
        assertThrows(IllegalArgumentException.class, () -> auth.authenticate(user.getId(), "old-pass-123"));
        User namesake = new User(); namesake.setId("namesake"); namesake.setName(user.getName()); namesake.setRole(User.Role.EMPLOYEE);
        namesake.setDepartment(user.getDepartment());
        namesake.setPasswordHash(encoder.encode("another-pass-123"));
        when(users.findByName(user.getName())).thenReturn(List.of(user, namesake));
        assertEquals(user.getId(), auth.validateToken(auth.authenticate(user.getName(), "old-pass-123")));
        namesake.setPasswordHash(user.getPasswordHash());
        assertThrows(IllegalArgumentException.class, () -> auth.authenticate(user.getName(), "old-pass-123"));
        user.setEnabled(false);
        assertThrows(IllegalArgumentException.class, () -> auth.authenticate(user.getPhone(), "old-pass-123"));
    }

    @Test
    void unassignedAccountsCannotLoginOrReuseTokens() {
        User user = user();
        AuthService auth = new AuthService(users, encoder, "a-test-secret-with-at-least-32-bytes-long", 3600000);
        String token = auth.authenticate(user.getName(), "old-pass-123");
        for (String department : new String[]{"待分配", "", null}) {
            user.setDepartment(department);
            assertThrows(IllegalArgumentException.class, () -> auth.authenticate(user.getName(), "old-pass-123"));
            assertNull(auth.validateToken(token));
        }
    }

    @Test
    void logDiscoveryQueriesRespectOrganizationAndRole() {
        WorkLogRepository logs = mock(WorkLogRepository.class);
        Clock clock = Clock.system(ZoneId.of("Asia/Shanghai"));
        LogService service = new LogService(logs, mock(TaskService.class), users, clock);
        LocalDate today = LocalDate.now(clock);
        User user = user();
        User colleague = new User(); colleague.setId("colleague"); colleague.setRole(User.Role.EMPLOYEE); colleague.setDepartment(user.getDepartment());
        User lead = new User(); lead.setId("lead"); lead.setRole(User.Role.TEAM_LEAD); lead.setDepartment(user.getDepartment());
        User outsider = new User(); outsider.setId("outsider"); outsider.setRole(User.Role.EMPLOYEE); outsider.setDepartment("其他部门");
        when(users.findAll()).thenReturn(List.of(user,colleague,lead,outsider));
        java.util.List<WorkLog> all = new java.util.ArrayList<>();
        for (User member : List.of(user,colleague,lead,outsider)) {
            WorkLog log = new WorkLog(); log.setAuthorId(member.getId()); log.setDate(today.minusDays(15)); all.add(log);
            when(users.findById(member.getId())).thenReturn(Optional.of(member));
        }
        when(logs.findAll()).thenReturn(all);
        when(logs.findByDateBetween(any(),any())).thenReturn(all);
        when(logs.findByAuthorId(user.getId())).thenReturn(List.of(all.get(0)));
        when(logs.findByAuthorIdAndDateBetween(eq(user.getId()),any(),any())).thenReturn(List.of(all.get(0)));
        for (User.Role role : User.Role.values()) {
            user.setRole(role);
            List<WorkLog> expected = switch (role) {
                case ADMIN, FOUNDER -> all;
                case DEPT_MANAGER -> all.subList(0,3);
                case TEAM_LEAD -> all.subList(0,2);
                case EMPLOYEE -> all.subList(0,1);
            };
            assertEquals(expected,service.getVisibleLogs(user));
            assertEquals(expected,service.getRecentLogs(user,30));
            assertEquals(expected,service.getHistoryLogs(user,today.minusDays(6)));
            assertEquals(expected.contains(all.get(3)),service.canViewLog(user,outsider.getId()));
            assertEquals(expected.contains(all.get(2)),service.canViewLog(user,lead.getId()));
        }
    }

    @Test
    void logSubmissionAndWorkspaceUseBeijingDateAfterMidnight() {
        Clock clock = Clock.fixed(Instant.parse("2026-11-19T16:15:00Z"), ZoneId.of("Asia/Shanghai"));
        WorkLogRepository logs = mock(WorkLogRepository.class);
        LogService service = new LogService(logs, mock(TaskService.class), users, clock);
        User author = user();
        author.setRole(User.Role.EMPLOYEE);
        LocalDate today = LocalDate.of(2026, 11, 20);
        when(users.findForUpdate(author.getId())).thenReturn(Optional.of(author));
        when(logs.save(any(WorkLog.class))).thenAnswer(invocation -> invocation.getArgument(0));

        WorkLog submitted = service.saveLog(author, java.util.Map.of("date", today.toString(), "content", "今日工作"), null);
        assertEquals(today, submitted.getDate());
        assertThrows(IllegalArgumentException.class, () ->
                service.saveLog(author, java.util.Map.of("date", today.plusDays(1).toString(), "content", "未来工作"), null));
        assertThrows(IllegalArgumentException.class, () ->
                service.saveLog(author, java.util.Map.of("date", today.minusDays(3).toString(), "content", "旧日志"), null));
        service.getWorkspaceLogs(author);
        verify(logs).findByAuthorIdAndDateBetween(author.getId(), today.withDayOfMonth(1), today);
    }
}
