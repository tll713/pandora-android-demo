package com.pandora.server.service;

import com.pandora.server.model.Highlight;
import com.pandora.server.model.Task;
import com.pandora.server.model.User;
import com.pandora.server.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class HighlightService {
    private final HighlightRepository highlights;
    private final UserRepository users;
    private final TaskRepository tasks;

    public HighlightService(HighlightRepository highlights, UserRepository users, TaskRepository tasks) {
        this.highlights = highlights; this.users = users; this.tasks = tasks;
    }

    public List<Highlight> getAll() { return highlights.findAllByOrderByPositionAscIdAsc(); }

    public List<Highlight> visibleTo(User user, List<Task> visibleTasks) {
        Set<String> taskIds = visibleTasks.stream().map(Task::getId).collect(Collectors.toSet());
        return getAll().stream().filter(Highlight::isEnabled)
                .filter(h -> !h.getKind().equals("personal") || h.getAudience().equals(user.getId()))
                .filter(h -> !h.getKind().equals("dispatch") || taskIds.contains(h.getTaskId())).toList();
    }

    public record Input(String kind, String audience, Integer position, String title, String content, String taskId, Boolean enabled) {}

    @Transactional
    public Highlight save(String id, Input input) {
        if (input.kind() == null || !Set.of("company", "dispatch", "personal").contains(input.kind()))
            throw new IllegalArgumentException("请选择有效的十大内容板块");
        String audience = "";
        if (input.kind().equals("personal")) {
            audience = input.audience() == null ? "" : input.audience().trim();
            User target = users.findById(audience).orElseThrow(() -> new IllegalArgumentException("请选择展示对象"));
            if (!target.isEnabled()) throw new IllegalArgumentException("不能为停用成员发布个人内容");
        }
        if (input.position() == null || input.position() < 1 || input.position() > 10)
            throw new IllegalArgumentException("展示位置需为 1～10，每个板块最多十项");
        if (input.title() == null || input.title().isBlank() || input.title().trim().length() > 120)
            throw new IllegalArgumentException("标题需为 1～120 个字");
        if (input.content() == null || input.content().isBlank() || input.content().trim().length() > 20000)
            throw new IllegalArgumentException("详细内容需为 1～20000 个字");
        String taskId = null;
        if (input.kind().equals("dispatch")) {
            Task task = tasks.findById(input.taskId() == null ? "" : input.taskId())
                    .orElseThrow(() -> new IllegalArgumentException("请选择已审核生效的派发任务"));
            if (Boolean.TRUE.equals(task.getDeleted())) throw new IllegalArgumentException("关联任务已归档，请重新选择");
            taskId = task.getId();
        }
        Highlight h = id == null ? new Highlight() : highlights.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("内容不存在，请刷新后重试"));
        if (id == null) h.setId("hl-" + UUID.randomUUID());
        if (highlights.existsByKindAndAudienceAndPositionAndIdNot(input.kind(), audience, input.position(), h.getId()))
            throw new IllegalArgumentException("该展示位置已被占用，请编辑原内容或选择其他位置");
        h.setKind(input.kind()); h.setAudience(audience); h.setPosition(input.position());
        h.setTitle(input.title().trim()); h.setContent(input.content().trim()); h.setTaskId(taskId);
        h.setEnabled(!Boolean.FALSE.equals(input.enabled()));
        return highlights.saveAndFlush(h);
    }

    @Transactional
    public void delete(String id) {
        Highlight h = highlights.findById(id).orElseThrow(() -> new IllegalArgumentException("内容不存在"));
        highlights.delete(h);
    }
}
