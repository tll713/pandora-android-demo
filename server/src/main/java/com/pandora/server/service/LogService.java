package com.pandora.server.service;

import com.pandora.server.model.*;
import com.pandora.server.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class LogService {

    private final WorkLogRepository workLogRepository;
    private final TaskService taskService;
    private final UserRepository userRepository;

    public LogService(WorkLogRepository workLogRepository, TaskService taskService, UserRepository userRepository) {
        this.workLogRepository = workLogRepository;
        this.taskService = taskService;
        this.userRepository = userRepository;
    }

    public List<WorkLog> getVisibleLogs(User user) {
        return workLogRepository.findByAuthorId(user.getId());
    }

    public List<WorkLog> getRecentLogs(User user, int days) {
        LocalDate end = LocalDate.now();
        LocalDate start = end.minusDays(days - 1);
        return workLogRepository.findByAuthorIdAndDateBetween(user.getId(), start, end);
    }

    public List<WorkLog> getHistoryLogs(User user, LocalDate before) {
        List<WorkLog> all = getVisibleLogs(user);
        return all.stream().filter(l -> l.getDate().isBefore(before)).collect(Collectors.toList());
    }

    @Transactional
    public WorkLog saveLog(User author, Map<String, Object> values, String logId) {
        LocalDate today = LocalDate.now();
        LocalDate earliest = today.minusDays(2);
        String requestedDate = (String) values.get("date");
        LocalDate logDate;
        try {
            logDate = requestedDate == null || requestedDate.isBlank() ? today : LocalDate.parse(requestedDate);
        } catch (RuntimeException e) {
            throw new IllegalArgumentException("日志日期格式不正确");
        }
        if (logDate.isBefore(earliest) || logDate.isAfter(today))
            throw new IllegalArgumentException("只能补写或编辑最近三天的日志");

        WorkLog existing = null;
        if (logId != null) {
            existing = workLogRepository.findById(logId).orElse(null);
            if (existing == null || !existing.getAuthorId().equals(author.getId())
                    || existing.getDate().isBefore(earliest) || existing.getDate().isAfter(today))
                throw new IllegalArgumentException("只能编辑本人最近三天的日志");
            if (!existing.getDate().equals(logDate))
                throw new IllegalArgumentException("不能修改日志日期");
        } else {
            existing = workLogRepository.findByAuthorIdAndDate(author.getId(), logDate).orElse(null);
        }

        String content = (String) values.get("content");
        if (content == null || content.trim().isEmpty()) throw new IllegalArgumentException("请填写工作内容");
        if (content.trim().length() > 3000) throw new IllegalArgumentException("工作内容不能超过 3000 个字");
        content = content.trim();

        String title = (String) values.get("title");
        if (title == null || title.trim().isEmpty()) title = logDate + " 工作日志";
        title = title.trim();
        if (title.length() > 80) throw new IllegalArgumentException("日志标题不能超过 80 个字");

        String taskId = (String) values.get("taskId");
        if (taskId != null && !taskId.isEmpty()) {
            Task task = taskService.getTask(taskId);
            if (task == null || !taskService.canSeeTask(author, task))
                throw new IllegalArgumentException("不能关联无权查看的任务");
        } else {
            taskId = "";
        }

        LocalDateTime at = LocalDateTime.now();
        if (existing != null) {
            LogVersion v = new LogVersion();
            v.setLog(existing);
            v.setTitle(existing.getTitle());
            v.setContent(existing.getContent());
            v.setTaskId(existing.getTaskId());
            v.setAt(existing.getUpdatedAt());
            v.setActorId(existing.getAuthorId());
            existing.getVersions().add(v);
            existing.setTitle(title);
            existing.setContent(content);
            existing.setTaskId(taskId);
            existing.setUpdatedAt(at);
            return workLogRepository.save(existing);
        }

        WorkLog log = new WorkLog();
        log.setId("log-" + UUID.randomUUID());
        log.setAuthorId(author.getId());
        log.setDate(logDate);
        log.setTitle(title);
        log.setContent(content);
        log.setTaskId(taskId);
        return workLogRepository.save(log);
    }
}
