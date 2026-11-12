package com.pandora.server;

import com.pandora.server.model.User;
import com.pandora.server.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import java.nio.file.*;
import java.util.concurrent.TimeUnit;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "spring.datasource.url=jdbc:h2:mem:browser-e2e;MODE=MySQL;DB_CLOSE_DELAY=-1",
    "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
    "spring.jpa.hibernate.ddl-auto=create-drop", "spring.sql.init.mode=never", "logging.level.root=WARN"
})
@ActiveProfiles("test")
@EnabledIfEnvironmentVariable(named = "PANDORA_E2E", matches = "true")
class BackendE2eTest {
    @LocalServerPort int port;
    @Autowired UserRepository users;
    @Autowired PasswordEncoder encoder;
    @Autowired JdbcTemplate jdbc;

    @Test
    void realBrowserWorkflowAndAndroidNetworkPolicy() throws Exception {
        jdbc.execute("ALTER TABLE tasks ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP");
        jdbc.execute("ALTER TABLE work_logs ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP");
        jdbc.execute("ALTER TABLE work_logs ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP");
        String password = "Isolated-E2e-Password-123";
        for (var role : new User.Role[]{User.Role.ADMIN, User.Role.FOUNDER, User.Role.EMPLOYEE}) {
            User u = new User(); u.setId("e2e-" + role.name()); u.setName(u.getId());
            u.setRole(role); u.setDepartment("测试部门"); u.setGender("其他");
            u.setPhone("1390000000" + role.ordinal()); u.setIdNumber("11010119900101001X");
            u.setPasswordHash(encoder.encode(password)); users.saveAndFlush(u);
        }
        Path server = Path.of(System.getProperty("pandora.project-dir"));
        Path app = server.resolve("../pandora-app").normalize();
        for (String script : new String[]{"android-network.ui.mjs", "backend.e2e.mjs"}) {
            Path output = server.resolve("target/" + script + ".log");
            ProcessBuilder builder = new ProcessBuilder("node", "tests/" + script).directory(app.toFile())
                .redirectErrorStream(true).redirectOutput(output.toFile());
            builder.environment().put("PANDORA_TEST_API_BASE", "http://127.0.0.1:" + port + "/api");
            builder.environment().put("PANDORA_TEST_IDENTIFIER", "e2e-ADMIN");
            builder.environment().put("PANDORA_TEST_PASSWORD", password);
            builder.environment().put("PANDORA_E2E_ARTIFACTS", server.resolve("target/e2e").toString());
            Process process = builder.start();
            try {
                assertTrue(process.waitFor(120, TimeUnit.SECONDS), script + " timed out; see " + output);
                assertEquals(0, process.exitValue(), () -> {
                    try { return Files.readString(output); } catch (Exception e) { return e.toString(); }
                });
            } finally { if (process.isAlive()) process.destroyForcibly(); }
        }
    }
}
