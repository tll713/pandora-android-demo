package com.pandora.server.service;

import com.pandora.server.model.WorkspaceNotification;
import com.pandora.server.repository.WorkspaceNotificationRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.LocalDateTime;
import java.util.*;

@Service
public class NotificationService {
    private final WorkspaceNotificationRepository notifications;
    public NotificationService(WorkspaceNotificationRepository notifications) { this.notifications = notifications; }

    public List<WorkspaceNotification> listOwn(String userId) {
        return notifications.findTop200ByRecipientIdOrderByCreatedAtDescIdDesc(userId);
    }

    @Transactional
    public void publish(Collection<String> recipients, String kind, String targetId, String title, String summary) {
        LocalDateTime at = LocalDateTime.now();
        for (String recipient : new HashSet<>(recipients)) {
            WorkspaceNotification n = new WorkspaceNotification();
            n.setId("notice-" + UUID.randomUUID());
            n.setRecipientId(recipient); n.setKind(kind); n.setTargetId(targetId);
            n.setTitle(title); n.setSummary(summary); n.setCreatedAt(at);
            notifications.save(n);
        }
    }
}
