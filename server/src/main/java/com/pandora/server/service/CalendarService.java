package com.pandora.server.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nlf.calendar.Solar;
import com.pandora.server.model.CalendarYear;
import com.pandora.server.repository.CalendarYearRepository;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import java.io.IOException;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;

@Service
public class CalendarService {
    public record Holiday(String label, String type) {}
    public record Definition(String source, Map<String, Holiday> holidays) {}
    public record Metadata(int year, boolean published, String source, Instant syncedAt, String syncStatus,
                           Map<String, Holiday> holidays, Map<String, String> solarTerms) {}
    private static final Logger log = LoggerFactory.getLogger(CalendarService.class);
    private static final Duration REFRESH = Duration.ofHours(6);
    private static final TypeReference<Map<String, Holiday>> HOLIDAYS_TYPE = new TypeReference<>() {};
    private final CalendarYearRepository years;
    private final ObjectMapper json;
    private final CalendarFeedClient feed;
    private final boolean syncEnabled;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "calendar-sync"); thread.setDaemon(true); return thread;
    });
    private final Map<String, Definition> defaults;
    private final Map<Integer, Instant> attempted = new ConcurrentHashMap<>();
    private final Set<Integer> pending = ConcurrentHashMap.newKeySet();
    private final Set<Integer> failed = ConcurrentHashMap.newKeySet();
    private final Map<Integer, Map<String, String>> terms = new ConcurrentHashMap<>();

    public CalendarService(CalendarYearRepository years, ObjectMapper json, CalendarFeedClient feed,
                           @Value("${pandora.calendar.sync-enabled:true}") boolean syncEnabled) throws IOException {
        this.years = years; this.json = json; this.feed = feed; this.syncEnabled = syncEnabled;
        // Verified notices are an initial offline fallback, never the annual update mechanism.
        try (var stream = new ClassPathResource("calendar-metadata.json").getInputStream()) {
            defaults = json.readValue(stream, new TypeReference<>() {});
        }
    }

    public Metadata get(int year) {
        validateYear(year);
        CalendarYear saved = years.findById(year).orElse(null);
        requestSync(year);
        Definition definition = defaults.get(String.valueOf(year));
        Instant syncedAt = null;
        if (saved != null) {
            try { definition = new Definition(saved.getSource(), json.readValue(saved.getHolidaysJson(), HOLIDAYS_TYPE)); }
            catch (IOException e) { throw new IllegalStateException("日历缓存无法读取", e); }
            syncedAt = saved.getSyncedAt();
        }
        boolean published = definition != null;
        String status = failed.contains(year) ? "unavailable" : pending.contains(year) ? "syncing"
            : syncedAt != null && syncedAt.plus(REFRESH).isAfter(Instant.now()) ? "current" : "cached";
        return new Metadata(year, published, published ? definition.source() : "", syncedAt, status,
            published ? definition.holidays() : Map.of(), terms.computeIfAbsent(year, this::calculateSolarTerms));
    }

    @Scheduled(initialDelay = 1000, fixedDelay = 21_600_000)
    public void refreshCurrentYears() {
        if (!syncEnabled) return;
        int year = LocalDate.now(ZoneId.of("Asia/Shanghai")).getYear();
        for (int target : new int[]{year, year + 1}) {
            if (target <= 2100) requestSync(target);
        }
    }

    private synchronized void requestSync(int year) {
        if (!syncEnabled || pending.contains(year)) return;
        Instant now = Instant.now(), lastAttempt = attempted.get(year);
        if (lastAttempt != null && lastAttempt.plus(REFRESH).isAfter(now)) return;
        attempted.put(year, now); pending.add(year);
        worker.submit(() -> {
            try { synchronizeYear(year); failed.remove(year); }
            catch (Exception e) {
                failed.add(year);
                log.warn("Calendar sync for {} failed; retaining last good data: {}", year, e.getMessage());
            } finally { pending.remove(year); }
        });
    }

    // A failed download or validation never touches the last successful database cache.
    void synchronizeYear(int year) throws IOException, InterruptedException {
        validateYear(year);
        Definition definition = feed.fetch(year);
        CalendarYear saved = years.findById(year).orElseGet(CalendarYear::new);
        saved.setYear(year); saved.setSource(definition.source());
        saved.setHolidaysJson(json.writeValueAsString(definition.holidays()));
        saved.setSyncedAt(Instant.now());
        years.saveAndFlush(saved);
    }

    private void validateYear(int year) {
        if (year < 1900 || year > 2100) throw new IllegalArgumentException("日历年份需在 1900～2100 之间");
    }

    private Map<String, String> calculateSolarTerms(int year) {
        Map<String, String> result = new TreeMap<>();
        // lunar-java calculates astronomical terms in China Standard Time.
        for (Solar day : Solar.fromYmd(year, 7, 1).getLunar().getJieQiTable().values()) {
            if (day.getYear() == year) result.put(day.toYmd(), day.getLunar().getJieQi());
        }
        return Collections.unmodifiableMap(result);
    }

    @PreDestroy
    void stop() { worker.shutdownNow(); }
}
