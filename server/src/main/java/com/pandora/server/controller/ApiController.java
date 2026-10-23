package com.pandora.server.controller;

import com.pandora.server.model.*;
import com.pandora.server.service.*;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api")
public class ApiController {

    private final AuthService authService;
    private final UserService userService;
    private final TaskService taskService;
    private final LogService logService;
    private final AnnouncementService announcementService;
    private final com.pandora.server.repository.UserRepository userRepository;
    private final com.pandora.server.repository.TaskRepository taskRepository;
    private final com.pandora.server.repository.TaskOwnerRepository taskOwnerRepository;
    private final com.pandora.server.repository.TaskHistoryRepository taskHistoryRepository;
    private final com.pandora.server.repository.ChangeRequestRepository changeRequestRepository;
    private final com.pandora.server.repository.WorkLogRepository workLogRepository;

    public ApiController(AuthService authService, UserService userService, TaskService taskService,
                         LogService logService, AnnouncementService announcementService,
                         com.pandora.server.repository.UserRepository userRepository,
                         com.pandora.server.repository.TaskRepository taskRepository,
                         com.pandora.server.repository.TaskOwnerRepository taskOwnerRepository,
                         com.pandora.server.repository.TaskHistoryRepository taskHistoryRepository,
                         com.pandora.server.repository.ChangeRequestRepository changeRequestRepository,
                         com.pandora.server.repository.WorkLogRepository workLogRepository) {
        this.authService = authService;
        this.userService = userService;
        this.taskService = taskService;
        this.logService = logService;
        this.announcementService = announcementService;
        this.userRepository = userRepository;
        this.taskRepository = taskRepository;
        this.taskOwnerRepository = taskOwnerRepository;
        this.taskHistoryRepository = taskHistoryRepository;
        this.changeRequestRepository = changeRequestRepository;
        this.workLogRepository = workLogRepository;
    }

    // ============ 认证 ============

    @PostMapping("/auth/login")
    public ResponseEntity<?> login(@RequestBody Map<String, String> body) {
        String username = body.get("username");
        String password = body.get("password");
        if (username == null || password == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "请填写用户名和密码"));
        }
        try {
            String token = authService.authenticate(username, password);
            User user = userRepository.findById(username).orElseThrow();
            return ResponseEntity.ok(Map.of(
                "token", token,
                "user", userToMap(user)
            ));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/auth/me")
    public ResponseEntity<?> me(@AuthenticationPrincipal UserDetails ud) {
        if (ud == null) return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        User user = userRepository.findById(ud.getUsername()).orElseThrow();
        return ResponseEntity.ok(userToMap(user));
    }

    // ============ 工作区数据（App） ============

    @PostMapping("/auth/password")
    public ResponseEntity<?> changePassword(@AuthenticationPrincipal UserDetails ud,
                                           @RequestBody Map<String, String> body) {
        if (ud == null) return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        User user = userRepository.findById(ud.getUsername()).orElseThrow();
        try {
            userService.changePassword(user, body.get("currentPassword"), body.get("newPassword"));
            return ResponseEntity.ok(Map.of("message", "密码已修改，请重新登录"));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/workspace")
    public ResponseEntity<?> workspace(@AuthenticationPrincipal UserDetails ud) {
        if (ud == null) return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        User user = userRepository.findById(ud.getUsername()).orElseThrow();
        List<Task> tasks = taskService.getVisibleTasks(user);
        // 同时覆盖本月日志统计和月初跨月的最近七天。
        List<WorkLog> logs = logService.getRecentLogs(user, Math.max(7, LocalDate.now().getDayOfMonth()));
        List<ChangeRequest> requests = taskService.getVisibleRequests(user);
        List<Announcement> announcements = announcementService.getAll();
        List<String> pins = taskService.getUserPins(user.getId());
        List<User> allowedAssignees = taskService.getAllowedAssignees(user);
        // 成员目录对全员可见：任务多负责人、日志查看都需要解析姓名与部门
        List<User> visibleUsers = userRepository.findAll();

        Map<String, Object> db = new HashMap<>();
        db.put("tasks", tasks.stream().map(this::taskToMap).collect(Collectors.toList()));
        db.put("logs", logs.stream().map(this::logToMap).collect(Collectors.toList()));
        db.put("requests", requests.stream().map(this::requestToMap).collect(Collectors.toList()));
        db.put("announcements", announcements.stream().map(this::announcementToMap).collect(Collectors.toList()));
        db.put("pins", Map.of(user.getId(), pins));
        db.put("members", visibleUsers.stream().map(this::userToMap).collect(Collectors.toList()));
        db.put("allowedAssignees", allowedAssignees.stream().map(this::userToMap).collect(Collectors.toList()));

        return ResponseEntity.ok(Map.of(
            "user", userToMap(user),
            "db", db
        ));
    }

    // ============ 任务 ============

    @PostMapping("/tasks/requests")
    public ResponseEntity<?> submitTaskRequest(@AuthenticationPrincipal UserDetails ud,
                                               @RequestBody Map<String, Object> body) {
        if (ud == null) return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        User user = userRepository.findById(ud.getUsername()).orElseThrow();
        String kind = (String) body.get("kind");
        String taskId = (String) body.get("taskId");
        Map<String, Object> values = (Map<String, Object>) body.get("values");
        try {
            ChangeRequest req = taskService.requestTaskChange(user, kind, values, taskId);
            return ResponseEntity.ok(requestToMap(req));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/tasks/requests/{id}/review")
    public ResponseEntity<?> reviewRequest(@AuthenticationPrincipal UserDetails ud,
                                           @PathVariable String id,
                                           @RequestBody Map<String, Object> body) {
        if (ud == null) return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        User user = userRepository.findById(ud.getUsername()).orElseThrow();
        boolean approve = Boolean.TRUE.equals(body.get("approve"));
        String reason = (String) body.get("reason");
        try {
            ChangeRequest req = taskService.reviewTaskChange(user, id, approve, reason);
            return ResponseEntity.ok(requestToMap(req));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/tasks/{id}/progress")
    public ResponseEntity<?> updateProgress(@AuthenticationPrincipal UserDetails ud,
                                            @PathVariable String id,
                                            @RequestBody Map<String, String> body) {
        if (ud == null) return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        User user = userRepository.findById(ud.getUsername()).orElseThrow();
        String text = body.get("text");
        try {
            Task task = taskService.updateTaskDetail(user, id, text);
            return ResponseEntity.ok(taskToMap(task));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/tasks/{id}/complete")
    public ResponseEntity<?> completeTask(@AuthenticationPrincipal UserDetails ud,
                                          @PathVariable String id) {
        if (ud == null) return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        User user = userRepository.findById(ud.getUsername()).orElseThrow();
        try {
            Task task = taskService.completeTask(user, id);
            return ResponseEntity.ok(taskToMap(task));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/tasks/{id}/pin")
    public ResponseEntity<?> togglePin(@AuthenticationPrincipal UserDetails ud,
                                       @PathVariable String id) {
        if (ud == null) return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        User user = userRepository.findById(ud.getUsername()).orElseThrow();
        try {
            List<String> pins = taskService.togglePin(user, id);
            return ResponseEntity.ok(Map.of("pins", pins));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    // ============ 日志 ============

    @PostMapping("/logs")
    public ResponseEntity<?> saveLog(@AuthenticationPrincipal UserDetails ud,
                                     @RequestBody Map<String, Object> body) {
        if (ud == null) return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        User user = userRepository.findById(ud.getUsername()).orElseThrow();
        String logId = (String) body.get("logId");
        Map<String, Object> values = (Map<String, Object>) body.get("values");
        try {
            WorkLog log = logService.saveLog(user, values, logId);
            return ResponseEntity.ok(logToMap(log));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/logs/history")
    public ResponseEntity<?> historyLogs(@AuthenticationPrincipal UserDetails ud,
                                         @RequestParam String before) {
        if (ud == null) return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        User user = userRepository.findById(ud.getUsername()).orElseThrow();
        LocalDate date = LocalDate.parse(before);
        List<WorkLog> logs = logService.getHistoryLogs(user, date);
        return ResponseEntity.ok(logs.stream().map(this::logToMap).collect(Collectors.toList()));
    }

    // ============ 公告 ============

    @GetMapping("/announcements")
    public ResponseEntity<?> announcements(@AuthenticationPrincipal UserDetails ud) {
        if (ud == null) return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        return ResponseEntity.ok(announcementService.getAll().stream().map(this::announcementToMap).collect(Collectors.toList()));
    }

    // ============ 管理端 ============

    @GetMapping("/admin/users")
    public ResponseEntity<?> adminUsers(@AuthenticationPrincipal UserDetails ud) {
        if (ud == null) return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        User user = userRepository.findById(ud.getUsername()).orElseThrow();
        if (!user.isGlobal()) return ResponseEntity.status(403).body(Map.of("error", "无权限"));
        return ResponseEntity.ok(userRepository.findAll().stream().map(this::userToMap).collect(Collectors.toList()));
    }

    @PostMapping("/admin/users")
    public ResponseEntity<?> adminCreateUser(@AuthenticationPrincipal UserDetails ud,
                                             @RequestBody Map<String, String> body) {
        if (ud == null) return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        User user = userRepository.findById(ud.getUsername()).orElseThrow();
        try {
            User created = userService.createUser(user, body.get("name"), body.get("login"), body.get("department"), body.get("role"));
            return ResponseEntity.ok(userToMap(created));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/admin/tasks")
    public ResponseEntity<?> adminTasks(@AuthenticationPrincipal UserDetails ud) {
        if (ud == null) return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        User user = userRepository.findById(ud.getUsername()).orElseThrow();
        if (!user.isGlobal()) return ResponseEntity.status(403).body(Map.of("error", "无权限"));
        return ResponseEntity.ok(taskRepository.findByDeletedFalse().stream().map(this::taskToMap).collect(Collectors.toList()));
    }

    @GetMapping("/admin/requests")
    public ResponseEntity<?> adminRequests(@AuthenticationPrincipal UserDetails ud) {
        if (ud == null) return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        User user = userRepository.findById(ud.getUsername()).orElseThrow();
        if (!user.isGlobal()) return ResponseEntity.status(403).body(Map.of("error", "无权限"));
        return ResponseEntity.ok(changeRequestRepository.findAll().stream().map(this::requestToMap).collect(Collectors.toList()));
    }

    @GetMapping("/admin/logs")
    public ResponseEntity<?> adminLogs(@AuthenticationPrincipal UserDetails ud) {
        if (ud == null) return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        User user = userRepository.findById(ud.getUsername()).orElseThrow();
        if (!user.isGlobal()) return ResponseEntity.status(403).body(Map.of("error", "无权限"));
        return ResponseEntity.ok(workLogRepository.findAll().stream().map(this::logToMap).collect(Collectors.toList()));
    }

    @PostMapping("/admin/announcements")
    public ResponseEntity<?> adminCreateAnnouncement(@AuthenticationPrincipal UserDetails ud,
                                                     @RequestBody Map<String, String> body) {
        if (ud == null) return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        User user = userRepository.findById(ud.getUsername()).orElseThrow();
        if (!user.isGlobal()) return ResponseEntity.status(403).body(Map.of("error", "无权限"));
        try {
            LocalDate date = body.get("date") != null ? LocalDate.parse(body.get("date")) : null;
            Announcement a = announcementService.create(body.get("title"), body.get("content"), body.get("category"), date);
            return ResponseEntity.ok(announcementToMap(a));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/admin/announcements/{id}")
    public ResponseEntity<?> adminDeleteAnnouncement(@AuthenticationPrincipal UserDetails ud,
                                                     @PathVariable String id) {
        if (ud == null) return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        User user = userRepository.findById(ud.getUsername()).orElseThrow();
        if (!user.isGlobal()) return ResponseEntity.status(403).body(Map.of("error", "无权限"));
        announcementService.delete(id);
        return ResponseEntity.ok(Map.of("ok", true));
    }

    @GetMapping("/admin/stats")
    public ResponseEntity<?> adminStats(@AuthenticationPrincipal UserDetails ud) {
        if (ud == null) return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        User user = userRepository.findById(ud.getUsername()).orElseThrow();
        if (!user.isGlobal()) return ResponseEntity.status(403).body(Map.of("error", "无权限"));
        long totalTasks = taskRepository.findByDeletedFalse().size();
        long doneTasks = taskRepository.findByDeletedFalse().stream().filter(t -> t.getStatus() == Task.Status.DONE).count();
        long pendingRequests = changeRequestRepository.findByStatus(ChangeRequest.Status.PENDING).size();
        long totalLogs = workLogRepository.count();
        long totalUsers = userRepository.count();
        return ResponseEntity.ok(Map.of(
            "totalTasks", totalTasks,
            "doneTasks", doneTasks,
            "pendingRequests", pendingRequests,
            "totalLogs", totalLogs,
            "totalUsers", totalUsers
        ));
    }

    // ============ 映射辅助 ============

    private Map<String, Object> userToMap(User u) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", u.getId());
        m.put("name", u.getName());
        m.put("department", u.getDepartment());
        m.put("role", u.getRole().name());
        m.put("roleName", switch (u.getRole()) {
            case ADMIN -> "管理员";
            case FOUNDER -> "创始人";
            case DEPT_MANAGER -> "部门负责人";
            case TEAM_LEAD -> "团队长";
            case EMPLOYEE -> "员工";
        });
        m.put("avatar", u.getAvatar());
        m.put("color", u.getColor());
        return m;
    }

    private Map<String, Object> taskToMap(Task t) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", t.getId());
        m.put("title", t.getTitle());
        m.put("detail", t.getDetail());
        m.put("priority", t.getPriority().name().toLowerCase());
        m.put("dueAt", t.getDueAt().toString().substring(0, 16));
        m.put("status", t.getStatus().name().toLowerCase());
        m.put("creator", t.getCreatorId());
        m.put("createdAt", t.getCreatedAt().toString());
        m.put("completedAt", t.getCompletedAt() != null ? t.getCompletedAt().toString() : null);
        m.put("revision", t.getRevision());
        m.put("owners", t.getOwners().stream().map(o -> o.getUser().getId()).collect(Collectors.toList()));
        m.put("ownerNames", t.getOwners().stream().map(o -> o.getUser().getName()).collect(Collectors.toList()));
        m.put("creatorName", userRepository.findById(t.getCreatorId()).map(User::getName).orElse(t.getCreatorId()));
        m.put("history", t.getHistory().stream().map(h -> {
            Map<String, Object> hm = new HashMap<>();
            hm.put("at", h.getAt().toString());
            hm.put("actor", h.getActorId());
            hm.put("text", h.getText());
            return hm;
        }).collect(Collectors.toList()));
        return m;
    }

    private Map<String, Object> requestToMap(ChangeRequest r) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", r.getId());
        m.put("kind", r.getKind().name().toLowerCase());
        m.put("taskId", r.getTaskId());
        m.put("proposer", r.getProposerId());
        m.put("proposerName", userRepository.findById(r.getProposerId()).map(User::getName).orElse(r.getProposerId()));
        Map<String, Object> snapshot = r.getAfterJson() != null ? fromJson(r.getAfterJson())
                : r.getBeforeJson() != null ? fromJson(r.getBeforeJson()) : null;
        m.put("taskTitle", snapshot != null ? (String) snapshot.get("title") : String.valueOf(r.getTaskId()));
        m.put("status", r.getStatus().name().toLowerCase());
        m.put("after", r.getAfterJson() != null ? fromJson(r.getAfterJson()) : null);
        m.put("before", r.getBeforeJson() != null ? fromJson(r.getBeforeJson()) : null);
        m.put("expectedRevision", r.getExpectedRevision());
        m.put("reason", r.getReason());
        m.put("reviewer", r.getReviewerId());
        m.put("createdAt", r.getCreatedAt().toString());
        m.put("reviewedAt", r.getReviewedAt() != null ? r.getReviewedAt().toString() : null);
        return m;
    }

    private Map<String, Object> logToMap(WorkLog l) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", l.getId());
        m.put("author", l.getAuthorId());
        m.put("authorName", userRepository.findById(l.getAuthorId()).map(User::getName).orElse(l.getAuthorId()));
        m.put("date", l.getDate().toString());
        m.put("title", l.getTitle());
        m.put("content", l.getContent());
        m.put("taskId", l.getTaskId() != null ? l.getTaskId() : "");
        m.put("createdAt", l.getCreatedAt().toString());
        m.put("updatedAt", l.getUpdatedAt().toString());
        m.put("versions", l.getVersions() != null ? l.getVersions().stream().map(v -> {
            Map<String, Object> vm = new HashMap<>();
            vm.put("title", v.getTitle());
            vm.put("content", v.getContent());
            vm.put("taskId", v.getTaskId() != null ? v.getTaskId() : "");
            vm.put("at", v.getAt().toString());
            vm.put("actor", v.getActorId());
            return vm;
        }).collect(Collectors.toList()) : List.of());
        return m;
    }

    private Map<String, Object> announcementToMap(Announcement a) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", a.getId());
        m.put("title", a.getTitle());
        m.put("content", a.getContent());
        m.put("category", a.getCategory());
        m.put("date", a.getDate().toString());
        return m;
    }

    private Map<String, Object> fromJson(String json) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().readValue(json, Map.class);
        } catch (Exception e) {
            return Map.of();
        }
    }
}
