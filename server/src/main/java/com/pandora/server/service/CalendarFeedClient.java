package com.pandora.server.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import java.io.IOException;
import java.net.URI;
import java.net.http.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.nio.ByteBuffer;

@Component
public class CalendarFeedClient {
    private static final int MAX_BYTES = 256 * 1024;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5))
        .followRedirects(HttpClient.Redirect.NEVER).build();
    private final ObjectMapper json;
    public CalendarFeedClient(ObjectMapper json) { this.json = json; }

    public CalendarService.Definition fetch(int year) throws IOException, InterruptedException {
        // Same repository through two fixed HTTPS hosts; no remotely supplied URL is fetched.
        IOException failure = null;
        for (String url : new String[]{
            "https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/" + year + ".json",
            "https://fastly.jsdelivr.net/gh/NateScarlet/holiday-cn@master/" + year + ".json"}) {
            try { return parse(year, download(URI.create(url))); }
            catch (IOException e) { failure = e; }
        }
        throw failure;
    }

    byte[] download(URI uri) throws IOException, InterruptedException {
        var request = HttpRequest.newBuilder(uri)
            .timeout(Duration.ofSeconds(10)).header("Accept", "application/json").GET().build();
        var response = http.send(request, info -> limitedBody());
        if (response.statusCode() != 200) throw new IOException("holiday feed HTTP " + response.statusCode());
        return response.body();
    }

    // Limit the download as it arrives, including responses without Content-Length.
    private static HttpResponse.BodySubscriber<byte[]> limitedBody() {
        var delegate = HttpResponse.BodySubscribers.ofByteArray();
        return new HttpResponse.BodySubscriber<>() {
            private Flow.Subscription subscription;
            private int size;
            public CompletionStage<byte[]> getBody() { return delegate.getBody(); }
            public void onSubscribe(Flow.Subscription value) { subscription = value; delegate.onSubscribe(value); }
            public void onNext(List<ByteBuffer> chunks) {
                for (var chunk : chunks) size += chunk.remaining();
                if (size > MAX_BYTES) { subscription.cancel(); delegate.onError(new IOException("Holiday feed exceeds size limit")); }
                else delegate.onNext(chunks);
            }
            public void onError(Throwable error) { delegate.onError(error); }
            public void onComplete() { delegate.onComplete(); }
        };
    }

    CalendarService.Definition parse(int year, byte[] bytes) throws IOException {
        if (bytes.length > MAX_BYTES) throw new IOException("Holiday feed exceeds size limit");
        JsonNode data = json.readTree(bytes);
        if (data == null || !data.path("year").isIntegralNumber() || data.path("year").intValue() != year)
            throw new IOException("Holiday feed year mismatch");
        JsonNode papers = data.path("papers"), days = data.path("days");
        if (!papers.isArray() || papers.isEmpty() || papers.size() > 10 || !days.isArray() || days.isEmpty() || days.size() > 366)
            throw new IOException("Incomplete holiday feed");
        String source = papers.get(0).asText();
        for (JsonNode paper : papers) {
            try {
                URI uri = URI.create(paper.asText());
                String host = uri.getHost();
                if (!paper.isTextual() || paper.asText().length() > 1000 || !"https".equals(uri.getScheme())
                    || uri.getUserInfo() != null || uri.getPort() != -1 || host == null
                    || !(host.equals("gov.cn") || host.endsWith(".gov.cn"))) throw new IllegalArgumentException();
            } catch (IllegalArgumentException e) { throw new IOException("Missing official government notice", e); }
        }
        Map<String, CalendarService.Holiday> holidays = new TreeMap<>();
        for (JsonNode item : days) {
            String date = item.path("date").asText(), label = item.path("name").asText();
            try {
                LocalDate day = LocalDate.parse(date);
                if (day.getYear() != year || !day.toString().equals(date)) throw new IllegalArgumentException();
            } catch (RuntimeException e) { throw new IOException("Invalid holiday date", e); }
            if (!item.path("name").isTextual() || label.isBlank() || label.length() > 40 || !item.path("isOffDay").isBoolean())
                throw new IOException("Invalid holiday entry");
            if (holidays.putIfAbsent(date, new CalendarService.Holiday(label, item.get("isOffDay").booleanValue() ? "holiday" : "workday")) != null)
                throw new IOException("Duplicate holiday date");
        }
        return new CalendarService.Definition(source, Collections.unmodifiableMap(holidays));
    }
}
