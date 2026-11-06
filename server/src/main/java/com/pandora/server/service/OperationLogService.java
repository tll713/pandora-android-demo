package com.pandora.server.service;

import com.pandora.server.model.OperationLog;
import com.pandora.server.repository.OperationLogRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Service
public class OperationLogService {

    private final OperationLogRepository repository;

    public OperationLogService(OperationLogRepository repository) {
        this.repository = repository;
    }

    /** 记录一条操作流水；写失败不影响业务主流程。 */
    @Transactional
    public void record(String actorId, String actorName, String action, String target, String summary) {
        if (actorId == null || action == null) return;
        OperationLog log = new OperationLog();
        log.setAt(LocalDateTime.now());
        log.setActorId(actorId);
        log.setActorName(trim(actorName, 30));
        log.setAction(trim(action, 40));
        log.setTarget(trim(target, 160));
        log.setSummary(trim(summary, 600));
        repository.save(log);
    }

    @Transactional(readOnly = true)
    public List<OperationLog> recent() {
        return repository.findTop500ByOrderByAtDescIdDesc();
    }

    @Transactional(readOnly = true)
    public List<OperationLog> recentOf(String actorId) {
        return actorId == null || actorId.isBlank()
                ? recent() : repository.findTop500ByActorIdOrderByAtDescIdDesc(actorId);
    }

    private static String trim(String value, int max) {
        String text = value == null ? "" : value.trim().replaceAll("\\s+", " ");
        return text.length() <= max ? text : text.substring(0, max - 1) + "…";
    }
}
