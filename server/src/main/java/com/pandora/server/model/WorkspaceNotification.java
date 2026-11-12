package com.pandora.server.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "workspace_notifications", indexes = @Index(name = "idx_notification_recipient", columnList = "recipient_id,created_at"))
public class WorkspaceNotification {
    @Id private String id;
    @Column(name = "recipient_id", nullable = false, length = 30) private String recipientId;
    @Column(nullable = false, length = 16) private String kind;
    @Column(name = "target_id", nullable = false, length = 60) private String targetId;
    @Column(nullable = false, length = 120) private String title;
    @Column(nullable = false, length = 160) private String summary;
    @Column(name = "created_at", nullable = false) private LocalDateTime createdAt;

    public String getId() { return id; }
    public void setId(String value) { id = value; }
    public String getRecipientId() { return recipientId; }
    public void setRecipientId(String value) { recipientId = value; }
    public String getKind() { return kind; }
    public void setKind(String value) { kind = value; }
    public String getTargetId() { return targetId; }
    public void setTargetId(String value) { targetId = value; }
    public String getTitle() { return title; }
    public void setTitle(String value) { title = value; }
    public String getSummary() { return summary; }
    public void setSummary(String value) { summary = value; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime value) { createdAt = value; }
}
