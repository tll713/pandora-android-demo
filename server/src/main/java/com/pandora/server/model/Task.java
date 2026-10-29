package com.pandora.server.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "tasks")
public class Task {
    @Id
    private String id;
    @Column(nullable = false, length = 80)
    private String title;
    @Column(columnDefinition = "TEXT")
    private String detail;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Priority priority;
    @Column(name = "start_at")
    private LocalDateTime startAt;
    @Column(name = "due_at", nullable = false)
    private LocalDateTime dueAt;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Status status = Status.TODO;
    @Column(name = "creator_id", nullable = false)
    private String creatorId;
    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;
    @Column(name = "completed_at")
    private LocalDateTime completedAt;
    @Column(nullable = false)
    private Integer revision = 1;
    @Column(nullable = false)
    private Boolean deleted = false;

    @OneToMany(mappedBy = "task", cascade = CascadeType.PERSIST, fetch = FetchType.EAGER)
    private List<TaskOwner> owners = new ArrayList<>();

    @OneToMany(mappedBy = "task", fetch = FetchType.EAGER)
    @OrderBy("at ASC")
    private List<TaskHistory> history = new ArrayList<>();

    public enum Priority {
        HIGH, MEDIUM, LOW
    }

    public enum Status {
        TODO, DOING, DONE
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public String getDetail() { return detail; }
    public void setDetail(String detail) { this.detail = detail; }
    public Priority getPriority() { return priority; }
    public void setPriority(Priority priority) { this.priority = priority; }
    public LocalDateTime getStartAt() { return startAt; }
    public void setStartAt(LocalDateTime startAt) { this.startAt = startAt; }
    public LocalDateTime getDueAt() { return dueAt; }
    public void setDueAt(LocalDateTime dueAt) { this.dueAt = dueAt; }
    public Status getStatus() { return status; }
    public void setStatus(Status status) { this.status = status; }
    public String getCreatorId() { return creatorId; }
    public void setCreatorId(String creatorId) { this.creatorId = creatorId; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getCompletedAt() { return completedAt; }
    public void setCompletedAt(LocalDateTime completedAt) { this.completedAt = completedAt; }
    public Integer getRevision() { return revision; }
    public void setRevision(Integer revision) { this.revision = revision; }
    public Boolean getDeleted() { return deleted; }
    public void setDeleted(Boolean deleted) { this.deleted = deleted; }
    public List<TaskOwner> getOwners() { return owners; }
    public void setOwners(List<TaskOwner> owners) { this.owners = owners; }
    public List<TaskHistory> getHistory() { return history; }
    public void setHistory(List<TaskHistory> history) { this.history = history; }
}
