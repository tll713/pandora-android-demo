package com.pandora.server.service;

import com.pandora.server.model.*;
import com.pandora.server.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class TaskService {

    private final TaskRepository taskRepository;
    private final TaskOwnerRepository taskOwnerRepository;
    private final TaskHistoryRepository taskHistoryRepository;
    private final ChangeRequestRepository changeRequestRepository;
    private final UserRepository userRepository;
    private final PinRepository pinRepository;

    public TaskService(TaskRepository taskRepository, TaskOwnerRepository taskOwnerRepository,
                       TaskHistoryRepository taskHistoryRepository, ChangeRequestRepository changeRequestRepository,
                       UserRepository userRepository, PinRepository pinRepository) {
        this.taskRepository = taskRepository;
        this.taskOwnerRepository = taskOwnerRepository;
        this.taskHistoryRepository = taskHistoryRepository;
        this.changeRequestRepository = changeRequestRepository;
        this.userRepository = userRepository;
        this.pinRepository = pinRepository;
    }

    // ============ 查询 ============

    public List<Task> getVisibleTasks(User user) {
        if (user.isGlobal()) return taskRepository.findByDeletedFalse();
        if (user.isManager()) return taskRepository.findVisibleToDepartment(user.getDepartment());
        return taskRepository.findVisibleToCreatorOrOwner(user.getId());
    }

    public Task getTask(String taskId) {
        return taskRepository.findById(taskId).filter(t -> !t.getDeleted()).orElse(null);
    }

    public boolean canSeeTask(User user, Task task) {
        if (task == null || task.getDeleted()) return false;
        if (user.isGlobal()) return true;
        if (task.getCreatorId().equals(user.getId())) return true;
        boolean isOwner = task.getOwners().stream().anyMatch(o -> o.getUser().getId().equals(user.getId()));
        if (isOwner) return true;
        if (user.isManager()) {
            return task.getOwners().stream().anyMatch(o -> o.getUser().getDepartment().equals(user.getDepartment()));
        }
        return false;
    }

    public boolean canWorkOnTask(User user, Task task) {
        if (!canSeeTask(user, task)) return false;
        return task.getOwners().stream().anyMatch(o -> o.getUser().getId().equals(user.getId()));
    }

    public boolean canManageTask(User user, Task task) {
        if (!user.isManager() || !canSeeTask(user, task)) return false;
        return task.getOwners().stream().allMatch(o -> canSeeUser(user, o.getUser().getId()));
    }

    public boolean canSeeUser(User user, String targetId) {
        User target = userRepository.findById(targetId).orElse(null);
        if (target == null) return false;
        if (user.isGlobal() || user.getId().equals(targetId)) return true;
        return user.isManager() && target.getDepartment().equals(user.getDepartment());
    }

    public List<User> getAllowedAssignees(User user) {
        if (user.isGlobal()) return userRepository.findAll().stream()
                .filter(u -> u.isEnabled() && u.getRole() != User.Role.ADMIN).collect(Collectors.toList());
        if (user.isManager()) return userRepository.findAll().stream()
                .filter(u -> u.isEnabled() && u.getDepartment().equals(user.getDepartment()) && u.getRole() != User.Role.ADMIN)
                .collect(Collectors.toList());
        return List.of(user);
    }

    // ============ 任务变更申请 ============

    @Transactional
    public ChangeRequest requestTaskChange(User proposer, String kind, Map<String, Object> values, String taskId) {
        if (!Set.of("create", "edit", "delete").contains(kind)) throw new IllegalArgumentException("未知变更类型");
        if (!"create".equals(kind) && !proposer.isManager())
            throw new IllegalArgumentException("当前身份不能编辑或删除任务");

        Task task = null;
        if (!"create".equals(kind)) {
            task = getTask(taskId);
            if (task == null) throw new IllegalArgumentException("任务不存在");
            if (!canManageTask(proposer, task)) throw new IllegalArgumentException("没有修改这项任务的权限");
            if (changeRequestRepository.existsByTaskIdAndStatus(taskId, ChangeRequest.Status.PENDING))
                throw new IllegalArgumentException("这项任务已有待审核变更");
        }

        Map<String, Object> after = null;
        if (!"delete".equals(kind)) {
            after = validateTaskValues(proposer, values);
        }

        ChangeRequest req = new ChangeRequest();
        req.setId("request-" + UUID.randomUUID());
        req.setKind(ChangeRequest.Kind.valueOf(kind.toUpperCase()));
        req.setTaskId(task != null ? task.getId() : "task-" + UUID.randomUUID());
        req.setProposerId(proposer.getId());
        req.setStatus(ChangeRequest.Status.PENDING);
        req.setAfterJson(after != null ? toJson(after) : null);
        req.setBeforeJson(task != null ? toJson(taskToMap(task)) : null);
        req.setExpectedRevision(task != null ? task.getRevision() : 0);
        req.setCreatedAt(LocalDateTime.now());
        return changeRequestRepository.save(req);
    }

    private Map<String, Object> validateTaskValues(User proposer, Map<String, Object> values) {
        if (values == null) throw new IllegalArgumentException("请填写任务信息");
        List<String> owners = (List<String>) values.get("owners");
        if (owners == null || owners.isEmpty()) throw new IllegalArgumentException("请选择管理范围内的负责人");
        Set<String> allowedIds = getAllowedAssignees(proposer).stream().map(User::getId).collect(Collectors.toSet());
        for (String oid : owners) {
            if (!allowedIds.contains(oid)) throw new IllegalArgumentException("请选择管理范围内的负责人");
        }
        String title = ((String) values.get("title") == null ? "" : (String) values.get("title")).trim();
        if (title.isEmpty()) throw new IllegalArgumentException("请填写任务名称");
        if (title.length() > 80) throw new IllegalArgumentException("任务名称不能超过 80 个字");
        String dueAt = (String) values.get("dueAt");
        if (dueAt == null || !dueAt.matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}")) 
            throw new IllegalArgumentException("截止时间需精确到分钟");
        try { LocalDateTime.parse(dueAt); }
        catch (java.time.DateTimeException e) { throw new IllegalArgumentException("请输入有效的截止时间"); }
        String priority = (String) values.get("priority");
        if (!Set.of("high", "medium", "low").contains(priority)) throw new IllegalArgumentException("请选择优先级");
        String detail = (String) values.get("detail");
        if (detail != null && detail.trim().length() > 2000) throw new IllegalArgumentException("任务说明不能超过 2000 个字");
        detail = detail == null ? "" : detail.trim();

        Map<String, Object> result = new HashMap<>();
        result.put("title", title);
        result.put("owners", owners.stream().distinct().toList());
        result.put("dueAt", dueAt);
        result.put("priority", priority);
        result.put("detail", detail);
        return result;
    }

    // ============ 审核 ============

    public List<ChangeRequest> getVisibleRequests(User user) {
        if (user.isGlobal()) return changeRequestRepository.findAll();
        return changeRequestRepository.findByProposerId(user.getId());
    }

    public boolean canReviewRequest(User user, ChangeRequest req) {
        return user.isGlobal() && req != null 
                && !req.getProposerId().equals(user.getId()) 
                && req.getStatus() == ChangeRequest.Status.PENDING;
    }

    @Transactional
    public ChangeRequest reviewTaskChange(User reviewer, String requestId, boolean approve, String reason) {
        ChangeRequest req = changeRequestRepository.findById(requestId)
                .orElseThrow(() -> new IllegalArgumentException("申请不存在"));
        if (!canReviewRequest(reviewer, req)) throw new IllegalArgumentException("需由另一位管理员或创始人审核待处理申请");
        String note = approve ? (reason == null ? "" : reason.trim()) : 
                (reason == null || reason.trim().isEmpty() ? "" : reason.trim());
        if (!approve && note.isEmpty()) throw new IllegalArgumentException("请填写驳回原因");
        if (note.length() > 500) throw new IllegalArgumentException("审核备注不能超过 500 个字");

        LocalDateTime at = LocalDateTime.now();
        if (approve) {
            if (req.getKind() == ChangeRequest.Kind.CREATE) {
                if (taskRepository.existsById(req.getTaskId())) throw new IllegalArgumentException("任务已存在，请勿重复审核");
                Map<String, Object> after = fromJson(req.getAfterJson());
                Task task = new Task();
                task.setId(req.getTaskId());
                task.setTitle((String) after.get("title"));
                task.setDetail((String) after.get("detail"));
                task.setPriority(Task.Priority.valueOf(((String) after.get("priority")).toUpperCase()));
                task.setDueAt(LocalDateTime.parse((String) after.get("dueAt")));
                task.setStatus(Task.Status.TODO);
                task.setCreatorId(req.getProposerId());
                task.setRevision(1);
                task.setDeleted(false);
                task.setCreatedAt(req.getCreatedAt());
                taskRepository.save(task);
                for (String oid : (List<String>) after.get("owners")) {
                    taskOwnerRepository.save(new TaskOwner(task, userRepository.findById(oid).orElseThrow()));
                }
                addHistory(task, reviewer.getId(), "审核通过，任务创建生效");
            } else {
                Task task = taskRepository.findById(req.getTaskId())
                        .orElseThrow(() -> new IllegalArgumentException("任务不存在"));
                if (task.getDeleted() || !task.getRevision().equals(req.getExpectedRevision()))
                    throw new IllegalArgumentException("任务已发生变化，请驳回并重新申请");
                if (req.getKind() == ChangeRequest.Kind.EDIT) {
                    Map<String, Object> after = fromJson(req.getAfterJson());
                    task.setTitle((String) after.get("title"));
                    task.setDetail((String) after.get("detail"));
                    task.setPriority(Task.Priority.valueOf(((String) after.get("priority")).toUpperCase()));
                    task.setDueAt(LocalDateTime.parse((String) after.get("dueAt")));
                    task.setRevision(task.getRevision() + 1);
                    // 先保存 task 确保状态更新，再替换 owners
                    taskRepository.save(task);
                    // 删除旧 owners
                    taskOwnerRepository.deleteAll(task.getOwners());
                    task.getOwners().clear();
                    taskOwnerRepository.flush();
                    for (String oid : (List<String>) after.get("owners")) {
                        taskOwnerRepository.save(new TaskOwner(task, userRepository.findById(oid).orElseThrow()));
                    }
                    addHistory(task, reviewer.getId(), "任务编辑审核通过");
                } else {
                    task.setDeleted(true);
                    task.setRevision(task.getRevision() + 1);
                    addHistory(task, reviewer.getId(), "任务删除审核通过，记录归档");
                }
                taskRepository.save(task);
            }
        }
        req.setStatus(approve ? ChangeRequest.Status.APPROVED : ChangeRequest.Status.REJECTED);
        req.setReviewerId(reviewer.getId());
        req.setReviewedAt(at);
        req.setReason(note);
        return changeRequestRepository.save(req);
    }

    // ============ 任务执行 ============

    @Transactional
    public Task updateTaskDetail(User user, String taskId, String note) {
        Task task = getTask(taskId);
        if (!canWorkOnTask(user, task)) throw new IllegalArgumentException("只有任务负责人可以记录进展");
        if (task.getStatus() == Task.Status.DONE) throw new IllegalArgumentException("已完成任务不能继续记录进展");
        String text = note == null ? "" : note.trim();
        if (text.isEmpty()) throw new IllegalArgumentException("请填写进展内容");
        if (text.length() > 1000) throw new IllegalArgumentException("进展内容不能超过 1000 个字");
        task.setStatus(Task.Status.DOING);
        addHistory(task, user.getId(), "工作进展：" + text);
        return taskRepository.save(task);
    }

    @Transactional
    public Task completeTask(User user, String taskId) {
        Task task = getTask(taskId);
        if (!canWorkOnTask(user, task)) throw new IllegalArgumentException("只有任务负责人可以完成任务");
        if (task.getStatus() == Task.Status.DONE) throw new IllegalArgumentException("任务已经完成");
        task.setStatus(Task.Status.DONE);
        task.setCompletedAt(LocalDateTime.now());
        addHistory(task, user.getId(), "标记任务完成，无需审核");
        return taskRepository.save(task);
    }

    // ============ 收藏 ============

    @Transactional
    public List<String> togglePin(User user, String taskId) {
        Task task = getTask(taskId);
        if (!canSeeTask(user, task)) throw new IllegalArgumentException("不能关注无权查看的任务");
        Optional<Pin> existing = pinRepository.findByUserIdAndTaskId(user.getId(), taskId);
        if (existing.isPresent()) {
            pinRepository.delete(existing.get());
        } else {
            List<Pin> userPins = pinRepository.findByUserId(user.getId());
            if (userPins.size() >= 10) throw new IllegalArgumentException("个人重点最多保留 10 项");
            Pin pin = new Pin();
            pin.setUserId(user.getId());
            pin.setTaskId(taskId);
            pinRepository.save(pin);
        }
        return pinRepository.findByUserId(user.getId()).stream().map(Pin::getTaskId).collect(Collectors.toList());
    }

    public List<String> getUserPins(String userId) {
        return pinRepository.findByUserId(userId).stream().map(Pin::getTaskId).collect(Collectors.toList());
    }

    // ============ 辅助 ============

    private void addHistory(Task task, String actorId, String text) {
        TaskHistory h = new TaskHistory();
        h.setTask(task);
        h.setAt(LocalDateTime.now());
        h.setActorId(actorId);
        h.setText(text);
        taskHistoryRepository.save(h);
    }

    private Map<String, Object> taskToMap(Task task) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", task.getId());
        m.put("title", task.getTitle());
        m.put("detail", task.getDetail());
        m.put("priority", task.getPriority().name().toLowerCase());
        m.put("dueAt", task.getDueAt().toString().substring(0, 16));
        m.put("owners", task.getOwners().stream().map(o -> o.getUser().getId()).collect(Collectors.toList()));
        m.put("status", task.getStatus().name().toLowerCase());
        m.put("creator", task.getCreatorId());
        m.put("revision", task.getRevision());
        return m;
    }

    private String toJson(Object obj) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(obj);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private Map<String, Object> fromJson(String json) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().readValue(json, Map.class);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
