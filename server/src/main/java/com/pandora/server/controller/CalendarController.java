package com.pandora.server.controller;

import com.pandora.server.service.CalendarService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class CalendarController {
    private final CalendarService service;
    public CalendarController(CalendarService service) { this.service = service; }
    @GetMapping("/calendar/metadata")
    public Object get(@RequestParam int year) { return service.get(year); }
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<?> invalid(IllegalArgumentException e) { return ResponseEntity.badRequest().body(Map.of("error", e.getMessage())); }
}
