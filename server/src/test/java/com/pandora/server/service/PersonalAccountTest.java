package com.pandora.server.service;

import com.pandora.server.model.User;
import com.pandora.server.model.WorkLog;
import com.pandora.server.repository.UserRepository;
import com.pandora.server.repository.WorkLogRepository;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

import java.time.LocalDate;
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
        return user;
    }

    @Test
    void passwordChangeChecksOldPasswordAndInvalidatesExistingTokens() {
        User user = user();
        AuthService auth = new AuthService(users, encoder, "a-test-secret-with-at-least-32-bytes-long", 3600000);
        UserService service = new UserService(users, encoder);
        String token = auth.authenticate(user.getId(), "old-pass-123");
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
        assertThrows(IllegalArgumentException.class, () -> auth.authenticate(user.getId(), "old-pass-123"));
        assertEquals(user.getId(), auth.validateToken(auth.authenticate(user.getId(), "new-pass-456")));
        verify(users).save(user);
    }

    @Test
    void mobileLogQueriesAlwaysUseCurrentAuthorRegardlessOfRole() {
        WorkLogRepository logs = mock(WorkLogRepository.class);
        LogService service = new LogService(logs, mock(TaskService.class), users);
        LocalDate today = LocalDate.now();
        WorkLog own = new WorkLog();
        own.setAuthorId("manager");
        own.setDate(today.minusDays(15));
        when(logs.findByAuthorId("manager")).thenReturn(List.of(own));
        when(logs.findByAuthorIdAndDateBetween(eq("manager"), any(), any())).thenReturn(List.of(own));
        User user = user();
        for (User.Role role : User.Role.values()) {
            user.setRole(role);
            assertEquals(List.of(own), service.getVisibleLogs(user));
            assertEquals(List.of(own), service.getRecentLogs(user, 30));
            assertEquals(List.of(own), service.getHistoryLogs(user, today.minusDays(6)));
        }
        verify(logs, never()).findAll();
        verify(logs, never()).findByDepartment(anyString());
        verify(logs, never()).findByDateBetween(any(), any());
    }
}
