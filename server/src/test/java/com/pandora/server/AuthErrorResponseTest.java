package com.pandora.server;

import com.pandora.server.model.User;
import com.pandora.server.repository.UserRepository;
import com.pandora.server.service.AuthService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import static org.junit.jupiter.api.Assertions.*;

// Real servlet dispatch is required: MockMvc does not forward failures to /error.
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "spring.datasource.url=jdbc:h2:mem:auth-error-test;MODE=MySQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.jpa.hibernate.ddl-auto=create-drop", "spring.sql.init.mode=never", "logging.level.root=WARN"
})
@ActiveProfiles("test")
@Import(AuthErrorResponseTest.FailureConfig.class)
class AuthErrorResponseTest {
    @LocalServerPort int port;
    @Autowired UserRepository users;
    @Autowired PasswordEncoder encoder;
    @Autowired AuthService auth;
    private final HttpClient client = HttpClient.newHttpClient();
    private String token;

    @BeforeEach void login() {
        User user = new User(); user.setId("error-test"); user.setName("error-test");
        user.setRole(User.Role.EMPLOYEE); user.setDepartment("测试部门");
        user.setPasswordHash(encoder.encode("isolated-test-password"));
        users.saveAndFlush(user);
        token = auth.authenticate("error-test", "isolated-test-password");
    }

    private HttpResponse<String> get(String path, String credential) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).GET();
        if (credential != null) request.header("Authorization", "Bearer " + credential);
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    @Test void missingAndFailedEndpointsKeepTheirHttpStatusForAuthenticatedUsers() throws Exception {
        assertEquals(404, get("/api/no-such-endpoint", token).statusCode());
        assertEquals(500, get("/api/test/failure", token).statusCode());
        assertEquals(200, get("/api/auth/me", token).statusCode());
    }

    @Test void errorDispatchPermissionDoesNotGrantUnauthenticatedApiAccess() throws Exception {
        assertEquals(401, get("/api/test/failure", null).statusCode());
        assertEquals(401, get("/api/auth/me", "invalid-token").statusCode());
        assertEquals(401, get("/error", null).statusCode());
    }

    @TestConfiguration static class FailureConfig {
        @Bean FailureController failureController() { return new FailureController(); }
    }
    @RestController static class FailureController {
        @GetMapping("/api/test/failure") Object failure() { throw new IllegalStateException("test failure"); }
    }
}
