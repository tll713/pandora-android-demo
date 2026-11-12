package com.pandora.server.config;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import com.pandora.server.model.User;
import com.pandora.server.repository.UserRepository;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class DemoDataIsolationTest {
    @Test
    void disablingDemoDataRemovesBothInitialAndScheduledSeeders() {
        new ApplicationContextRunner().withUserConfiguration(DataSeeder.class, DemoActivitySeeder.class)
            .withPropertyValues("pandora.demo-data.enabled=false").run(context -> {
                assertThat(context).doesNotHaveBean(DataSeeder.class).doesNotHaveBean(DemoActivitySeeder.class);
            });
    }

    @Test
    void bootstrapOnlyCreatesAdminInAnEmptyDatabase() {
        UserRepository users = mock(UserRepository.class);
        var encoder = new BCryptPasswordEncoder();
        var bootstrap = new BootstrapAdmin(users, encoder, "13800138000", "Strong-Initial-Password-123");
        bootstrap.run(null);
        var saved = org.mockito.ArgumentCaptor.forClass(User.class);
        verify(users).save(saved.capture());
        assertEquals(User.Role.ADMIN, saved.getValue().getRole());
        assertTrue(encoder.matches("Strong-Initial-Password-123", saved.getValue().getPasswordHash()));
        reset(users); when(users.count()).thenReturn(1L);
        bootstrap.run(null); verify(users, never()).save(any());
        when(users.count()).thenReturn(0L);
        assertThrows(IllegalStateException.class, () -> new BootstrapAdmin(users, encoder, "13800138000", "weak").run(null));
    }
}
