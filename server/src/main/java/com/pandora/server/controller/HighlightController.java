package com.pandora.server.controller;

import com.pandora.server.service.HighlightService;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

// /api/admin/** is restricted to administrators and founders by SecurityConfig.
@RestController
@RequestMapping("/api/admin/highlights")
public class HighlightController {
    private final HighlightService service;
    public HighlightController(HighlightService service) { this.service = service; }
    @GetMapping public Object list() { return service.getAll(); }
    @PostMapping public Object create(@RequestBody HighlightService.Input input) { return service.save(null, input); }
    @PutMapping("/{id}") public Object update(@PathVariable String id, @RequestBody HighlightService.Input input) { return service.save(id, input); }
    @DeleteMapping("/{id}") public Object delete(@PathVariable String id) { service.delete(id); return Map.of("ok", true); }
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<?> invalid(IllegalArgumentException error) { return ResponseEntity.badRequest().body(Map.of("error", error.getMessage())); }
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<?> conflict() { return ResponseEntity.badRequest().body(Map.of("error", "该展示位置已被占用，请刷新后选择其他位置")); }
}
