package com.pandora.server.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "change_requests")
public class ChangeRequest {
    @Id
    private String id;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Kind kind;

    @Column(name = "task_id", nullable = false)
    private String taskId;

    @Column(name = "proposer_id", nullable = false)
    private String proposerId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Status status = Status.PENDING;

    @Column(name = "after_json", columnDefinition = "LONGTEXT")
    private String afterJson;

    @Column(name = "before_json", columnDefinition = "LONGTEXT")
    private String beforeJson;

    @Column(name = "expected_revision")
    private Integer expectedRevision;

    @Column(length = 500)
    private String reason;

    @Column(name = "reviewer_id")
    private String reviewerId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "reviewed_at")
    private LocalDateTime reviewedAt;

    public enum Kind {
        CREATE, EDIT, DELETE
    }

    public enum Status {
        PENDING, APPROVED, REJECTED
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public Kind getKind() { return kind; }
    public void setKind(Kind kind) { this.kind = kind; }
    public String getTaskId() { return taskId; }
    public void setTaskId(String taskId) { this.taskId = taskId; }
    public String getProposerId() { return proposerId; }
    public void setProposerId(String proposerId) { this.proposerId = proposerId; }
    public Status getStatus() { return status; }
    public void setStatus(Status status) { this.status = status; }
    public String getAfterJson() { return afterJson; }
    public void setAfterJson(String afterJson) { this.afterJson = afterJson; }
    public String getBeforeJson() { return beforeJson; }
    public void setBeforeJson(String beforeJson) { this.beforeJson = beforeJson; }
    public Integer getExpectedRevision() { return expectedRevision; }
    public void setExpectedRevision(Integer expectedRevision) { this.expectedRevision = expectedRevision; }
    public String getReason() { return reason; }
    public void setReason(String reason) { this.reason = reason; }
    public String getReviewerId() { return reviewerId; }
    public void setReviewerId(String reviewerId) { this.reviewerId = reviewerId; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getReviewedAt() { return reviewedAt; }
    public void setReviewedAt(LocalDateTime reviewedAt) { this.reviewedAt = reviewedAt; }
}
