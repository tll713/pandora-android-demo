package com.pandora.server.config;

import com.pandora.server.model.User;
import com.pandora.server.repository.UserRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** Explicit first-deployment bootstrap; never overwrites an existing account. */
@Component
@ConditionalOnProperty(name = "pandora.bootstrap.enabled", havingValue = "true")
public class BootstrapAdmin implements ApplicationRunner {
    private final UserRepository users;
    private final PasswordEncoder encoder;
    private final String phone, password;

    public BootstrapAdmin(UserRepository users, PasswordEncoder encoder,
            @Value("${pandora.bootstrap.phone:}") String phone,
            @Value("${pandora.bootstrap.password:}") String password) {
        this.users = users; this.encoder = encoder; this.phone = phone; this.password = password;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (users.count() != 0) return;
        if (!phone.matches("^\\+?[0-9]{7,15}$") || password.length() < 12 || password.length() > 64
                || password.getBytes(StandardCharsets.UTF_8).length > 72 || password.isBlank())
            throw new IllegalStateException("首次初始化需配置管理员手机号及 12～64 位强密码");
        User u = new User();
        u.setId(UUID.randomUUID().toString().replace("-", "").substring(0, 30));
        u.setName("系统管理员"); u.setPhone(phone); u.setRole(User.Role.ADMIN);
        u.setDepartment("管理中心"); u.setAvatar("管"); u.setColor("gray");
        u.setPasswordHash(encoder.encode(password));
        users.save(u);
    }
}
