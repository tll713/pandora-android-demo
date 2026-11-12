package com.pandora.server.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.pandora.server.model.User;
import com.pandora.server.repository.CalendarYearRepository;
import com.pandora.server.repository.UserRepository;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.awaitility.Awaitility.await;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:calendar-test;MODE=MySQL;DB_CLOSE_DELAY=-1",
    "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
    "spring.jpa.hibernate.ddl-auto=create-drop", "spring.sql.init.mode=never", "logging.level.root=WARN"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CalendarTest {
    @Autowired CalendarService calendar;
    @Autowired CalendarYearRepository years;
    @Autowired ObjectMapper json;
    @Autowired MockMvc mvc;
    @Autowired UserRepository users;
    @Autowired AuthService auth;
    @Autowired PasswordEncoder encoder;
    @MockBean CalendarFeedClient feed;

    @BeforeEach void resetCache() { years.deleteAll(); }

    @Test void solarTermsAreCalculatedForEveryYearWithoutAnnualTables() {
        for (int year : new int[]{1900, 2000, 2025, 2026, 2027, 2028, 2100}) {
            var data = calendar.get(year);
            assertEquals(24, data.solarTerms().size(), "24 solar terms in " + year);
            assertTrue(data.solarTerms().keySet().stream().allMatch(day -> day.startsWith(year + "-")));
            assertTrue(data.solarTerms().containsValue("立春"));
            assertTrue(data.solarTerms().containsValue("冬至"));
        }
        assertEquals("立春", calendar.get(2026).solarTerms().get("2026-02-04"));
        assertEquals("清明", calendar.get(2026).solarTerms().get("2026-04-05"));
        assertEquals("冬至", calendar.get(2026).solarTerms().get("2026-12-22"));
        assertFalse(calendar.get(2030).published());
        assertTrue(calendar.get(2030).holidays().isEmpty());
    }

    @Test void verifiedFallbackCorrectsFormerWorkdayMistakes() {
        var data = calendar.get(2026);
        assertEquals(39, data.holidays().size());
        assertEquals("workday", data.holidays().get("2026-01-04").type());
        assertEquals("workday", data.holidays().get("2026-02-28").type());
        assertNull(data.holidays().get("2026-04-11"));
        assertTrue(data.source().startsWith("https://www.gov.cn/"));
    }

    @Test void automaticSyncPersistsAndFailedDownloadsRetainLastGoodData() throws Exception {
        var definition = new CalendarService.Definition("https://www.gov.cn/notice.htm",
            Map.of("2030-01-01", new CalendarService.Holiday("元旦", "holiday")));
        when(feed.fetch(2030)).thenReturn(definition);
        calendar.synchronizeYear(2030);
        var saved = calendar.get(2030);
        assertTrue(saved.published()); assertNotNull(saved.syncedAt());
        assertEquals("current", saved.syncStatus());
        assertEquals("元旦", saved.holidays().get("2030-01-01").label());
        try (var ignored = new AutoCloseableCalendar(years, json, feed)) {
            assertEquals(saved.holidays(), ignored.service.get(2030).holidays(), "cache survives service recreation");
        }
        when(feed.fetch(2030)).thenThrow(new IOException("HTTP 404"));
        assertThrows(IOException.class, () -> calendar.synchronizeYear(2030));
        assertEquals(saved.syncedAt(), calendar.get(2030).syncedAt());
        assertEquals(saved.holidays(), calendar.get(2030).holidays());
    }

    @Test void requestsDoNotBlockOnFeedAndFailuresAreThrottled() throws Exception {
        var entered = new java.util.concurrent.CountDownLatch(1);
        var release = new java.util.concurrent.CountDownLatch(1);
        when(feed.fetch(2031)).thenAnswer(call -> {
            entered.countDown(); release.await(); throw new IOException("network offline");
        });
        var automatic = new CalendarService(years, json, feed, true);
        try {
            assertTimeoutPreemptively(Duration.ofSeconds(2), () -> assertEquals("syncing", automatic.get(2031).syncStatus()));
            assertTrue(entered.await(2, java.util.concurrent.TimeUnit.SECONDS));
            assertFalse(automatic.get(2031).published());
            release.countDown();
            await().atMost(Duration.ofSeconds(3)).until(() -> automatic.get(2031).syncStatus().equals("unavailable"));
            for (int i = 0; i < 4; i++) automatic.get(2031);
            verify(feed, times(1)).fetch(2031);
        } finally { release.countDown(); automatic.stop(); }
    }

    @Test void scheduledCheckSynchronizesCurrentAndNextYearWithoutAnyCalendarRequest() throws Exception {
        int year = java.time.LocalDate.now(java.time.ZoneId.of("Asia/Shanghai")).getYear();
        when(feed.fetch(anyInt())).thenAnswer(call -> new CalendarService.Definition("https://www.gov.cn/notice.htm",
            Map.of(call.getArgument(0) + "-01-01", new CalendarService.Holiday("元旦", "holiday"))));
        var automatic = new CalendarService(years, json, feed, true);
        try {
            automatic.refreshCurrentYears();
            await().atMost(Duration.ofSeconds(3)).until(() -> years.existsById(year) && years.existsById(year + 1));
            automatic.refreshCurrentYears();
            assertEquals(1, automatic.get(year).holidays().size());
            verify(feed, times(1)).fetch(year);
            verify(feed, times(1)).fetch(year + 1);
        } finally { automatic.stop(); }
    }

    @Test void endpointRequiresLoginAndHasNoManualWriteRoute() throws Exception {
        mvc.perform(get("/api/calendar/metadata?year=2026")).andExpect(status().isUnauthorized());
        User employee = new User(); employee.setId("calendar-employee"); employee.setName("日历测试员工");
        employee.setRole(User.Role.EMPLOYEE); employee.setDepartment("研发部");
        employee.setPasswordHash(encoder.encode("Calendar-Test-123")); users.saveAndFlush(employee);
        String token = auth.authenticate(employee.getName(), "Calendar-Test-123");
        mvc.perform(get("/api/calendar/metadata?year=2026").header("Authorization", "Bearer " + token))
            .andExpect(status().isOk()).andExpect(jsonPath("$.solarTerms['2026-02-04']").value("立春"))
            .andExpect(jsonPath("$.holidays['2026-01-04'].type").value("workday"));
        mvc.perform(get("/api/calendar/metadata?year=2101").header("Authorization", "Bearer " + token))
            .andExpect(status().isBadRequest());
        mvc.perform(put("/api/calendar/metadata?year=2026").header("Authorization", "Bearer " + token)
            .contentType("application/json").content("{}"))
            .andExpect(status().isMethodNotAllowed());
    }

    @Test void feedRejectsMalformedPartialOrUntrustedDataBeforeCacheReplacement() throws Exception {
        var client = new CalendarFeedClient(json);
        String valid = """
            {"year":2030,"papers":["https://www.gov.cn/notice.htm"],
             "days":[{"date":"2030-01-01","name":"元旦","isOffDay":true}]}
            """;
        assertEquals("holiday", client.parse(2030, valid.getBytes(StandardCharsets.UTF_8)).holidays().get("2030-01-01").type());
        for (String bad : new String[]{valid.replace("\"year\":2030", "\"year\":2029"),
            valid.replace("2030-01-01", "2030-02-30"), valid.replace("2030-01-01", "2029-01-01"),
            valid.replace("true", "\"true\""), valid.replace("https://www.gov.cn/", "https://gov.cn.evil.example/"),
            valid.replace("https://www.gov.cn/", "http://www.gov.cn/"), valid.replace("元旦", ""),
            "{\"year\":2030,\"papers\":[],\"days\":[]}", "<html>gateway error</html>",
            valid.replace("}]}", "},{\"date\":\"2030-01-01\",\"name\":\"重复\",\"isOffDay\":false}]}")}) {
            assertThrows(IOException.class, () -> client.parse(2030, bad.getBytes(StandardCharsets.UTF_8)), bad);
        }
        assertThrows(IOException.class, () -> client.parse(2030, new byte[262145]));
    }

    @Test void feedAutomaticallyUsesAlternateHostWhenPrimaryIsUnreachableOrInvalid() throws Exception {
        for (boolean malformed : new boolean[]{false,true}) {
            var requested = new java.util.ArrayList<String>();
            var client = new CalendarFeedClient(json) {
                @Override byte[] download(java.net.URI uri) throws IOException {
                    requested.add(uri.getHost());
                    if (uri.getHost().equals("raw.githubusercontent.com")) {
                        if (malformed) return "<html>invalid response</html>".getBytes(StandardCharsets.UTF_8);
                        throw new IOException("connection reset");
                    }
                    return """
                        {"year":2030,"papers":["https://www.gov.cn/notice.htm"],
                         "days":[{"date":"2030-01-01","name":"元旦","isOffDay":true}]}
                        """.getBytes(StandardCharsets.UTF_8);
                }
            };
            assertEquals("元旦", client.fetch(2030).holidays().get("2030-01-01").label());
            assertEquals(java.util.List.of("raw.githubusercontent.com", "fastly.jsdelivr.net"), requested);
        }
    }

    private static class AutoCloseableCalendar implements AutoCloseable {
        final CalendarService service;
        AutoCloseableCalendar(CalendarYearRepository years, ObjectMapper json, CalendarFeedClient feed) throws IOException {
            service = new CalendarService(years, json, feed, false);
        }
        public void close() { service.stop(); }
    }
}
