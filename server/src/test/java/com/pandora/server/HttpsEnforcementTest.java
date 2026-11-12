package com.pandora.server;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:https-test;MODE=MySQL", "spring.datasource.driver-class-name=org.h2.Driver",
    "spring.datasource.username=sa", "spring.datasource.password=", "spring.sql.init.mode=never",
    "spring.jpa.hibernate.ddl-auto=create-drop", "pandora.security.require-https=true", "logging.level.root=WARN"
})
@ActiveProfiles("test")
@AutoConfigureMockMvc
class HttpsEnforcementTest {
    @Autowired MockMvc mvc;

    @Test
    void httpIsRedirectedAndSecureRequestsReachAuthentication() throws Exception {
        mvc.perform(get("/api/workspace")).andExpect(status().is3xxRedirection())
            .andExpect(header().string("Location", "https://localhost/api/workspace"));
        mvc.perform(get("/api/workspace").secure(true)).andExpect(status().isUnauthorized());
    }
}
