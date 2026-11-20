package com.pandora.server.service;

import com.pandora.server.model.*;
import com.pandora.server.repository.*;
import org.springframework.stereotype.Service;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.LockModeType;
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
    private final TagRepository tagRepository;
    private final NotificationService notifications;
    @PersistenceContext private EntityManager entityManager;

    public TaskService(TaskRepository taskRepository, TaskOwnerRepository taskOwnerRepository,
                       TaskHistoryRepository taskHistoryRepository, ChangeRequestRepository changeRequestRepository,
                       UserRepository userRepository, PinRepository pinRepository, TagRepository tagRepository,
                       NotificationService notifications) {
        this.taskRepository = taskRepository;
        this.taskOwnerRepository = taskOwnerRepository;
        this.taskHistoryRepository = taskHistoryRepository;
        this.changeRequestRepository = changeRequestRepository;
        this.userRepository = userRepository;
        this.pinRepository = pinRepository;
        this.tagRepository = tagRepository;
        this.notifications = notifications;
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
        if (user.isManager()) return userRepository.findAll().stream()
                .filter(u -> u.isOrganizationMember() && canAssignTaskTo(user, u)).toList();
        return List.of(user);
    }

    private boolean canAssignTaskTo(User proposer, User owner) {
        if (!proposer.isManager()) return proposer.getId().equals(owner.getId());
        return owner.getRole() != User.Role.ADMIN
                && (proposer.isGlobal() || proposer.getDepartment().equals(owner.getDepartment()));
    }

    // ============ 任务变更申请 ============

    @Transactional
    public ChangeRequest requestTaskChange(User proposer, String kind, Map<String, Object> values, String taskId) {
        return requestTaskChange(proposer, kind, values, taskId, null);
    }

    public List<User> getAllowedReviewers(User proposer) {
        return userRepository.findAll().stream().filter(User::isOrganizationMember)
                .filter(u -> !u.getId().equals(proposer.getId())).toList();
    }

    private List<String> validateReviewers(User proposer, Object input) {
        // Older clients and pending requests retain their original independent-review flow.
        if (input == null) return List.of();
        if (!(input instanceof List<?> ids) || ids.isEmpty()) throw new IllegalArgumentException("请选择至少一位审核人");
        Set<String> allowed = getAllowedReviewers(proposer).stream().map(User::getId).collect(Collectors.toSet());
        Set<String> selected = new TreeSet<>();
        for (Object id : ids) {
            if (!(id instanceof String value) || !allowed.contains(value))
                throw new IllegalArgumentException("只能选择启用的成员，且不能选择申请人本人");
            selected.add((String) id);
        }
        return List.copyOf(selected);
    }

    public List<String> reviewers(ChangeRequest request) {
        try { return request.getReviewersJson() == null ? List.of() : new com.fasterxml.jackson.databind.ObjectMapper()
                .readValue(request.getReviewersJson(), new com.fasterxml.jackson.core.type.TypeReference<List<String>>() {}); }
        catch (Exception e) { throw new IllegalStateException("审核人数据无效", e); }
    }

    public List<Map<String, Object>> reviews(ChangeRequest request) {
        try { return request.getReviewsJson() == null ? List.of() : new com.fasterxml.jackson.databind.ObjectMapper()
                .readValue(request.getReviewsJson(), new com.fasterxml.jackson.core.type.TypeReference<List<Map<String, Object>>>() {}); }
        catch (Exception e) { throw new IllegalStateException("审核记录无效", e); }
    }

    @Transactional
    public ChangeRequest requestTaskChange(User proposer, String kind, Map<String, Object> values, String taskId, Object reviewerIds) {
        List<String> selectedReviewers = validateReviewers(proposer, reviewerIds);
        if (!Set.of("create", "edit", "delete").contains(kind)) throw new IllegalArgumentException("未知变更类型");
        if (!"create".equals(kind) && !proposer.isManager())
            throw new IllegalArgumentException("当前身份不能编辑或删除任务");

        if ("create".equals(kind)) {
            // Serialize identical creates from the same applicant, including network retries.
            userRepository.findForUpdate(proposer.getId()).orElseThrow(() -> new IllegalArgumentException("申请人不存在"));
        }
        Task task = null;
        if (!"create".equals(kind)) {
            task = lockTask(taskId);
            if (task == null) throw new IllegalArgumentException("任务不存在");
            if (!canManageTask(proposer, task)) throw new IllegalArgumentException("没有修改这项任务的权限");
            if (changeRequestRepository.existsByTaskIdAndStatus(taskId, ChangeRequest.Status.PENDING))
                throw new IllegalArgumentException("这项任务已有待审核变更");
        }

        Map<String, Object> after = null;
        if (!"delete".equals(kind)) {
            after = validateTaskValues(proposer, values, task);
        }

        if ("create".equals(kind)) {
            for (ChangeRequest pending : changeRequestRepository.findByProposerId(proposer.getId())) {
                if (pending.getKind() == ChangeRequest.Kind.CREATE && pending.getStatus() == ChangeRequest.Status.PENDING
                        && Objects.equals(fromJson(pending.getAfterJson()), after)
                        && reviewers(pending).equals(selectedReviewers)) return pending;
            }
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
        req.setReviewersJson(toJson(selectedReviewers));
        req.setReviewsJson("[]");
        return changeRequestRepository.save(req);
    }

    private Map<String, Object> validateTaskValues(User proposer, Map<String, Object> values, Task existing) {
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
        String startAt = values.containsKey("startAt") ? (String) values.get("startAt")
                : existing != null && existing.getStartAt() != null ? existing.getStartAt().toString().substring(0, 16) : dueAt;
        if (startAt == null || !startAt.matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}"))
            throw new IllegalArgumentException("开始时间需精确到分钟");
        try { LocalDateTime.parse(startAt); }
        catch (java.time.DateTimeException e) { throw new IllegalArgumentException("请输入有效的开始时间"); }
        if (startAt.compareTo(dueAt) > 0) throw new IllegalArgumentException("结束时间不能早于开始时间");
        String priority = (String) values.get("priority");
        if (!Set.of("high", "medium", "low").contains(priority)) throw new IllegalArgumentException("请选择优先级");
        String detail = (String) values.get("detail");
        if (detail != null && detail.trim().length() > 2000) throw new IllegalArgumentException("任务说明不能超过 2000 个字");
        detail = detail == null ? "" : detail.trim();
        String tagId = values.containsKey("tagId") ? (String) values.get("tagId")
                : existing != null ? existing.getTagId() : null;
        tagId = tagId == null || tagId.isBlank() ? null : tagId.trim();
        if (tagId != null && !tagRepository.existsById(tagId))
            throw new IllegalArgumentException("请选择有效的任务标签");

        Map<String, Object> result = new HashMap<>();
        result.put("title", title);
        result.put("owners", owners.stream().distinct().toList());
        result.put("startAt", startAt);
        result.put("dueAt", dueAt);
        result.put("priority", priority);
        result.put("detail", detail);
        result.put("tagId", tagId);
        return result;
    }

    // ============ 审核 ============

    public List<ChangeRequest> getVisibleRequests(User user) {
        if (user.isGlobal()) return changeRequestRepository.findAll();
        return changeRequestRepository.findAll().stream()
                .filter(r -> r.getProposerId().equals(user.getId()) || reviewers(r).contains(user.getId())).toList();
    }

    public boolean canReviewRequest(User user, ChangeRequest req) {
        return user.isOrganizationMember() && req != null
                && !req.getProposerId().equals(user.getId()) 
                && req.getStatus() == ChangeRequest.Status.PENDING
                && (reviewers(req).isEmpty() ? user.isGlobal() : reviewers(req).contains(user.getId()))
                && reviews(req).stream().noneMatch(r -> user.getId().equals(r.get("reviewer")));
    }

    @Transactional
    public ChangeRequest withdrawTaskChange(User actor, String requestId) {
        ChangeRequest req = changeRequestRepository.findForUpdate(requestId)
                .orElseThrow(() -> new IllegalArgumentException("申请不存在"));
        if (req.getStatus() != ChangeRequest.Status.PENDING)
            throw new IllegalArgumentException("只能撤回待审核申请");
        boolean ownRequest = req.getProposerId().equals(actor.getId());
        if (!actor.isOrganizationMember() || (!ownRequest && !(actor.isGlobal() && hasUnavailableReviewer(req))))
            throw new IllegalArgumentException("只能撤回本人的申请，或由管理员、创始人撤回有审核人不可用的申请");

        req.setStatus(ChangeRequest.Status.WITHDRAWN);
        req.setReviewerId(actor.getId());
        req.setReviewedAt(LocalDateTime.now());
        req.setReason(ownRequest ? "申请人主动撤回" : "有尚未提交意见的审核人已不可用");
        return changeRequestRepository.save(req);
    }

    private boolean hasUnavailableReviewer(ChangeRequest req) {
        Set<String> remaining = new HashSet<>(reviewers(req));
        reviews(req).forEach(record -> remaining.remove(record.get("reviewer")));
        return userRepository.findAllById(remaining).stream().filter(User::isOrganizationMember).count() < remaining.size();
    }

    @Transactional
    public ChangeRequest reviewTaskChange(User reviewer, String requestId, boolean approve, String reason) {
        ChangeRequest req = changeRequestRepository.findForUpdate(requestId)
                .orElseThrow(() -> new IllegalArgumentException("申请不存在"));
        if (!canReviewRequest(reviewer, req)) throw new IllegalArgumentException("仅指定且尚未审核的审核人可处理待审申请，申请人不能自审");
        String note = approve ? (reason == null ? "" : reason.trim()) : 
                (reason == null || reason.trim().isEmpty() ? "" : reason.trim());
        if (!approve && note.isEmpty()) throw new IllegalArgumentException("请填写驳回原因");
        if (note.length() > 500) throw new IllegalArgumentException("审核备注不能超过 500 个字");

        LocalDateTime at = LocalDateTime.now();
        List<Map<String, Object>> records = new ArrayList<>(reviews(req));
        records.add(Map.of("reviewer", reviewer.getId(), "approve", approve, "reason", note, "at", at.toString()));
        req.setReviewsJson(toJson(records));
        Set<String> approved = records.stream().filter(r -> Boolean.TRUE.equals(r.get("approve")))
                .map(r -> (String) r.get("reviewer")).collect(Collectors.toSet());
        if (approve && !approved.containsAll(reviewers(req))) return changeRequestRepository.save(req);
        if (approve) {
            Map<String, Object> after = req.getKind() == ChangeRequest.Kind.DELETE ? null : fromJson(req.getAfterJson());
            // Tag deletion takes the same tag-before-task lock order.
            if (after != null && after.get("tagId") instanceof String tagId && tagRepository.findForUpdate(tagId).isEmpty()) {
                after.put("tagId", null);
            }
            if (req.getKind() == ChangeRequest.Kind.CREATE) {
                if (taskRepository.existsById(req.getTaskId())) throw new IllegalArgumentException("任务已存在，请勿重复审核");
                validateApprovedOwners(req, after);
                Task task = new Task();
                task.setId(req.getTaskId());
                task.setTitle((String) after.get("title"));
                task.setDetail((String) after.get("detail"));
                task.setPriority(Task.Priority.valueOf(((String) after.get("priority")).toUpperCase()));
                applyTaskDates(task, after);
                applyTaskTag(task, after);
                task.setStatus(Task.Status.TODO);
                task.setCreatorId(req.getProposerId());
                task.setRevision(1);
                task.setDeleted(false);
                task.setCreatedAt(req.getCreatedAt());
                taskRepository.save(task);
                for (String oid : (List<String>) after.get("owners")) {
                    task.getOwners().add(taskOwnerRepository.save(new TaskOwner(task, userRepository.findById(oid).orElseThrow())));
                }
                addHistory(task, reviewer.getId(), "审核通过，任务创建生效");
                Set<String> recipients = new HashSet<>((List<String>) after.get("owners"));
                recipients.add(req.getProposerId());
                recipients.addAll(taskAudience(task));
                notifications.publish(recipients, "tasks", task.getId(), task.getTitle(), "任务看板新增任务，创建申请已通过");
            } else {
                Task task = taskRepository.findForUpdate(req.getTaskId())
                        .orElseThrow(() -> new IllegalArgumentException("任务不存在"));
                if (task.getDeleted() || !task.getRevision().equals(req.getExpectedRevision()))
                    throw new IllegalArgumentException("任务已发生变化，请驳回并重新申请");
                Set<String> recipients = taskAudience(task);
                String previousTitle = task.getTitle();
                if (req.getKind() == ChangeRequest.Kind.EDIT) {
                    validateApprovedOwners(req, after);
                    task.setTitle((String) after.get("title"));
                    task.setDetail((String) after.get("detail"));
                    task.setPriority(Task.Priority.valueOf(((String) after.get("priority")).toUpperCase()));
                    applyTaskDates(task, after);
                    applyTaskTag(task, after);
                    task.setRevision(task.getRevision() + 1);
                    // 先保存 task 确保状态更新，再替换 owners
                    taskRepository.save(task);
                    // 删除旧 owners
                    taskOwnerRepository.deleteAll(task.getOwners());
                    task.getOwners().clear();
                    taskOwnerRepository.flush();
                    for (String oid : (List<String>) after.get("owners")) {
                        task.getOwners().add(taskOwnerRepository.save(new TaskOwner(task, userRepository.findById(oid).orElseThrow())));
                    }
                    addHistory(task, reviewer.getId(), "任务编辑审核通过");
                } else {
                    task.setDeleted(true);
                    pinRepository.deleteByTaskId(task.getId());
                    task.setRevision(task.getRevision() + 1);
                    addHistory(task, reviewer.getId(), "任务删除审核通过，记录归档");
                }
                taskRepository.save(task);
                if (req.getKind() == ChangeRequest.Kind.EDIT) {
                    Set<String> current = taskAudience(task);
                    recipients.removeAll(current);
                    notifications.publish(recipients, "tasks", task.getId(), previousTitle, "任务负责人或查看范围已调整，任务已从你的看板移除");
                    notifications.publish(current, "tasks", task.getId(), task.getTitle(), "任务看板已更新，任务修改申请已通过");
                } else {
                    notifications.publish(recipients, "tasks", task.getId(), task.getTitle(), "任务已从看板移除，删除申请已通过");
                }
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
        Task task = lockTask(taskId);
        if (!canWorkOnTask(user, task)) throw new IllegalArgumentException("只有任务负责人可以记录进展");
        if (task.getStatus() == Task.Status.DONE) throw new IllegalArgumentException("已完成任务不能继续记录进展");
        String text = note == null ? "" : note.trim();
        if (text.isEmpty()) throw new IllegalArgumentException("请填写进展内容");
        if (text.length() > 1000) throw new IllegalArgumentException("进展内容不能超过 1000 个字");
        task.setStatus(Task.Status.DOING);
        addHistory(task, user.getId(), "工作进展：" + text);
        notifications.publish(taskAudience(task), "tasks", task.getId(), task.getTitle(), "任务进展已更新");
        return taskRepository.save(task);
    }

    @Transactional
    public Task completeTask(User user, String taskId) {
        Task task = lockTask(taskId);
        if (!canWorkOnTask(user, task)) throw new IllegalArgumentException("只有任务负责人可以完成任务");
        if (task.getStatus() == Task.Status.DONE) throw new IllegalArgumentException("任务已经完成");
        task.setStatus(Task.Status.DONE);
        task.setCompletedAt(LocalDateTime.now());
        addHistory(task, user.getId(), "标记任务完成，无需审核");
        notifications.publish(taskAudience(task), "tasks", task.getId(), task.getTitle(), "任务已完成，任务看板已更新");
        return taskRepository.save(task);
    }

    // ============ 收藏 ============

    @Transactional
    public List<String> togglePin(User user, String taskId) {
        // Match approval's task-before-user lock order and serialize pinning with archival.
        Task task = taskRepository.findForUpdate(taskId).orElse(null);
        userRepository.findForUpdate(user.getId()).orElseThrow(() -> new IllegalArgumentException("账号不存在"));
        Optional<Pin> existing = pinRepository.findByUserIdAndTaskId(user.getId(), taskId);
        // A stale or hidden focus must still be removable by its owner.
        if (existing.isPresent()) {
            pinRepository.delete(existing.get());
        } else {
            if (!canSeeTask(user, task)) throw new IllegalArgumentException("不能关注无权查看的任务");
            List<Pin> valid = new ArrayList<>();
            for (Pin pin : pinRepository.findByUserId(user.getId())) {
                if (canSeeTask(user, getTask(pin.getTaskId()))) valid.add(pin);
                else pinRepository.delete(pin);
            }
            if (valid.size() >= 10) throw new IllegalArgumentException("个人重点最多保留 10 项");
            Pin pin = new Pin();
            pin.setUserId(user.getId()); pin.setTaskId(taskId);
            pinRepository.save(pin);
        }
        return getUserPins(user.getId());
    }

    public List<String> getUserPins(String userId) {
        User user = userRepository.findById(userId).orElseThrow(() -> new IllegalArgumentException("账号不存在"));
        return pinRepository.findByUserId(userId).stream().map(Pin::getTaskId)
                .filter(id -> canSeeTask(user, getTask(id))).collect(Collectors.toList());
    }

    // ============ 辅助 ============

    private void validateApprovedOwners(ChangeRequest req, Map<String, Object> after) {
        List<String> owners = (List<String>) after.get("owners");
        if (owners == null || owners.isEmpty()) throw new IllegalArgumentException("任务缺少负责人，请驳回后重新申请");
        // Lock current account data in ID order so account edits cannot race approval.
        Map<String, User> accounts = new HashMap<>();
        Set<String> accountIds = new TreeSet<>(owners);
        accountIds.add(req.getProposerId());
        for (String id : accountIds) {
            User account = userRepository.findById(id).orElseThrow(() -> new IllegalArgumentException("申请人或负责人不存在，请驳回后重新申请"));
            entityManager.refresh(account, LockModeType.PESSIMISTIC_WRITE);
            accounts.put(id, account);
        }
        User proposer = accounts.get(req.getProposerId());
        if (!proposer.isOrganizationMember() || (req.getKind() == ChangeRequest.Kind.EDIT && !proposer.isManager()))
            throw new IllegalArgumentException("申请人已停用或权限已变更，请驳回后重新申请");
        for (String id : owners) {
            User owner = accounts.get(id);
            if (!owner.isOrganizationMember() || !canAssignTaskTo(proposer, owner))
                throw new IllegalArgumentException("负责人已停用或不在申请人的分派范围内，请驳回后重新申请");
        }
    }

    private Task lockTask(String taskId) {
        return taskRepository.findForUpdate(taskId).filter(t -> !t.getDeleted()).orElse(null);
    }

    private Set<String> taskAudience(Task task) {
        return userRepository.findAll().stream().filter(User::isEnabled).filter(u -> canSeeTask(u, task))
                .map(User::getId).collect(Collectors.toCollection(HashSet::new));
    }

    private void applyTaskTag(Task task, Map<String, Object> after) {
        // Older pending requests omit tagId and must retain the existing tag.
        if (after.containsKey("tagId")) task.setTagId((String) after.get("tagId"));
    }

    private void applyTaskDates(Task task, Map<String, Object> after) {
        LocalDateTime due = LocalDateTime.parse((String) after.get("dueAt"));
        LocalDateTime start = after.get("startAt") != null ? LocalDateTime.parse((String) after.get("startAt"))
                : task.getStartAt() != null ? task.getStartAt() : due;
        if (start.isAfter(due)) throw new IllegalArgumentException("结束时间不能早于开始时间");
        task.setStartAt(start);
        task.setDueAt(due);
    }

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
        m.put("startAt", (task.getStartAt() != null ? task.getStartAt() : task.getDueAt()).toString().substring(0, 16));
        m.put("dueAt", task.getDueAt().toString().substring(0, 16));
        m.put("owners", task.getOwners().stream().map(o -> o.getUser().getId()).collect(Collectors.toList()));
        m.put("status", task.getStatus().name().toLowerCase());
        m.put("creator", task.getCreatorId());
        m.put("revision", task.getRevision());
        m.put("tagId", task.getTagId());
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
