package com.pandora.server.model;

import jakarta.persistence.*;

@Entity
@Table(name = "highlights", uniqueConstraints = @UniqueConstraint(name = "uk_highlight_slot", columnNames = {"kind", "audience", "position"}))
public class Highlight {
    @Id private String id;
    @Column(nullable = false, length = 16) private String kind;
    @Column(nullable = false, length = 30) private String audience = "";
    @Column(nullable = false) private int position;
    @Column(nullable = false, length = 120) private String title;
    @Column(nullable = false, columnDefinition = "TEXT") private String content;
    @Column(name = "task_id", length = 60) private String taskId;
    @Column(nullable = false) private boolean enabled = true;

    public String getId() { return id; }
    public void setId(String value) { id = value; }
    public String getKind() { return kind; }
    public void setKind(String value) { kind = value; }
    public String getAudience() { return audience; }
    public void setAudience(String value) { audience = value; }
    public int getPosition() { return position; }
    public void setPosition(int value) { position = value; }
    public String getTitle() { return title; }
    public void setTitle(String value) { title = value; }
    public String getContent() { return content; }
    public void setContent(String value) { content = value; }
    public String getTaskId() { return taskId; }
    public void setTaskId(String value) { taskId = value; }
    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean value) { enabled = value; }
}
