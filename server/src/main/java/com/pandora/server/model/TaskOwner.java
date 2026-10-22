package com.pandora.server.model;

import jakarta.persistence.*;

@Entity
@Table(name = "task_owners")
public class TaskOwner {
    @EmbeddedId
    private TaskOwnerId id;

    @ManyToOne(fetch = FetchType.LAZY)
    @MapsId("taskId")
    @JoinColumn(name = "task_id")
    private Task task;

    @ManyToOne(fetch = FetchType.LAZY)
    @MapsId("userId")
    @JoinColumn(name = "user_id")
    private User user;

    public TaskOwner() {}

    public TaskOwner(Task task, User user) {
        this.task = task;
        this.user = user;
        this.id = new TaskOwnerId(task.getId(), user.getId());
    }

    public TaskOwnerId getId() { return id; }
    public void setId(TaskOwnerId id) { this.id = id; }
    public Task getTask() { return task; }
    public void setTask(Task task) { this.task = task; }
    public User getUser() { return user; }
    public void setUser(User user) { this.user = user; }
}
