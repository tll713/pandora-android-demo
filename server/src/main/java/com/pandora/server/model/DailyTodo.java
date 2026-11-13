package com.pandora.server.model;

import jakarta.persistence.*;

import java.time.LocalDate;
import java.time.LocalDateTime;

@Entity
@Table(name = "daily_todos")
public class DailyTodo {
    @Id
    @Column(length = 40)
    private String id;

    @Column(name = "owner_id", nullable = false, length = 30)
    private String ownerId;

    @Column(nullable = false)
    private LocalDate date;

    @Column(nullable = false, length = 120)
    private String title;

    @Column(nullable = false)
    private boolean done;

    @Column(name = "previous_date")
    private LocalDate previousDate;

    @Column(name = "move_token", length = 36)
    private String moveToken;

    @Version
    @Column(nullable = false)
    private long revision;

    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getOwnerId() { return ownerId; }
    public void setOwnerId(String ownerId) { this.ownerId = ownerId; }
    public LocalDate getDate() { return date; }
    public void setDate(LocalDate date) { this.date = date; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public boolean isDone() { return done; }
    public void setDone(boolean done) { this.done = done; }
    public LocalDate getPreviousDate() { return previousDate; }
    public void setPreviousDate(LocalDate previousDate) { this.previousDate = previousDate; }
    public String getMoveToken() { return moveToken; }
    public void setMoveToken(String moveToken) { this.moveToken = moveToken; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
