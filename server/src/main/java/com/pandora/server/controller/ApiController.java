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
    private final HighlightService highlightService;
    private final com.pandora.server.repository.UserRepository userRepository;
    private final com.pandora.server.repository.TaskRepository taskRepository;
    private final com.pandora.server.repository.TaskOwnerRepository taskOwnerRepository;
    private final com.pandora.server.repository.TaskHistoryRepository taskHistoryRepository;
    private final com.pandora.server.repository.ChangeRequestRepository changeRequestRepository;
    private final com.pandora.server.repository.WorkLogRepository workLogRepository;

    public ApiController(AuthService authService, UserService userService, TaskService taskService,
                         LogService logService, AnnouncementService announcementService, HighlightService highlightService,
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
        this.highlightService = highlightService;
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
        String identifier = body.get("identifier");
        String password = body.get("password");
        if (identifier == null || password == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "请填写手机号或姓名及密码"));
        }
        try {
            AuthService.LoginResult result = authService.login(identifier, password);
            return ResponseEntity.ok(Map.of(
                "token", result.token(),
                "user", profileToMap(result.user())
            ));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/auth/me")
    public ResponseEntity<?> me(@AuthenticationPrincipal UserDetails ud) {
        if (ud == null) return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        User user = userRepository.findById(ud.getUsername()).orElseThrow();
        return ResponseEntity.ok(profileToMap(user));
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

    @PutMapping("/auth/profile/avatar")
    public ResponseEntity<?> updateAvatar(@AuthenticationPrincipal UserDetails ud,
                                          @RequestBody Map<String, String> body) {
        if (ud == null) return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        User user = userRepository.findById(ud.getUsername()).orElseThrow();
        try {
            return ResponseEntity.ok(profileToMap(userService.updateAvatar(user, body.get("avatarData"))));
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
        db.put("highlights", highlightService.visibleTo(user, tasks));
        db.put("pins", Map.of(user.getId(), pins));
        db.put("members", visibleUsers.stream().map(this::userToMap).collect(Collectors.toList()));
        db.put("allowedAssignees", allowedAssignees.stream().map(this::userToMap).collect(Collectors.toList()));

        return ResponseEntity.ok(Map.of(
            "user", profileToMap(user),
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
        return ResponseEntity.ok(userRepository.findAll().stream().map(this::adminUserToMap).collect(Collectors.toList()));
    }

    @PostMapping("/admin/users")
    public ResponseEntity<?> adminCreateUser(@AuthenticationPrincipal UserDetails ud,
                                             @RequestBody Map<String, String> body) {
        if (ud == null) return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        User user = userRepository.findById(ud.getUsername()).orElseThrow();
        try {
            UserService.CreatedAccount created = userService.createUser(user, body.get("name"), body.get("phone"),
                    body.get("gender"), body.get("idNumber"), body.get("department"), body.get("role"));
            Map<String, Object> result = new HashMap<>(adminUserToMap(created.user()));
            result.put("temporaryPassword", created.temporaryPassword());
            return ResponseEntity.ok(result);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PutMapping("/admin/users/{id}")
    public ResponseEntity<?> adminUpdateUser(@AuthenticationPrincipal UserDetails ud, @PathVariable String id,
                                             @RequestBody Map<String, Object> body) {
        User actor = userRepository.findById(ud.getUsername()).orElseThrow();
        if (actor.getRole() != User.Role.ADMIN) return ResponseEntity.status(403).body(Map.of("error", "只有管理员可以维护账号"));
        try {
            User updated = userService.updateUser(actor, id, (String) body.get("name"),
                    (String) body.get("phone"), (String) body.get("gender"), (String) body.get("idNumber"),
                    (String) body.get("department"), (String) body.get("role"), Boolean.TRUE.equals(body.get("enabled")));
            return ResponseEntity.ok(adminUserToMap(updated));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/admin/users/{id}/password")
    public ResponseEntity<?> adminResetPassword(@AuthenticationPrincipal UserDetails ud, @PathVariable String id,
                                                @RequestBody Map<String, String> body) {
        User actor = userRepository.findById(ud.getUsername()).orElseThrow();
        if (actor.getRole() != User.Role.ADMIN) return ResponseEntity.status(403).body(Map.of("error", "只有管理员可以维护账号"));
        try {
            userService.resetPassword(actor, id, body.get("password"));
            return ResponseEntity.ok(Map.of("message", "密码已重置，原登录状态已失效"));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PutMapping("/admin/announcements/{id}")
    public ResponseEntity<?> adminUpdateAnnouncement(@PathVariable String id, @RequestBody Map<String, Object> body) {
        try {
            return ResponseEntity.ok(announcementToMap(announcementService.update(id, (String) body.get("title"),
                    (String) body.get("content"), (String) body.get("category"), Boolean.TRUE.equals(body.get("pinned")))));
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
        m.put("enabled", u.isEnabled());
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

    private Map<String, Object> profileToMap(User u) {
        Map<String, Object> m = userToMap(u);
        m.put("phone", u.getPhone());
        m.put("gender", u.getGender());
        m.put("idNumber", u.getIdNumber());
        m.put("avatarData", u.getAvatarData());
        return m;
    }

    private Map<String, Object> adminUserToMap(User u) {
        return profileToMap(u);
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
        m.put("reviewerName", r.getReviewerId() != null
                ? userRepository.findById(r.getReviewerId()).map(User::getName).orElse(r.getReviewerId()) : null);
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
        m.put("pinned", a.isPinned());
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
