package com.pandora.server.model;

import jakarta.persistence.*;

import java.time.LocalDateTime;

/**
 * 操作流水：记录员工在 App／管理端的每一次实质操作（写日志、评价日志、任务进展、审核等），
 * 供管理端「系统日志」按时间线审计。
 */
@Entity
@Table(name = "operation_logs", indexes = {
        @Index(name = "idx_operation_at", columnList = "at"),
        @Index(name = "idx_operation_actor", columnList = "actor_id")
})
public class OperationLog {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "at", nullable = false)
    private LocalDateTime at = LocalDateTime.now();

    @Column(name = "actor_id", nullable = false, length = 30)
    private String actorId;

    @Column(name = "actor_name", nullable = false, length = 30)
    private String actorName;

    @Column(nullable = false, length = 40)
    private String action;

    @Column(nullable = false, length = 160)
    private String target = "";

    @Column(nullable = false, length = 600)
    private String summary = "";

    public Long getId() { return id; }
    public LocalDateTime getAt() { return at; }
    public void setAt(LocalDateTime value) { at = value; }
    public String getActorId() { return actorId; }
    public void setActorId(String value) { actorId = value; }
    public String getActorName() { return actorName; }
    public void setActorName(String value) { actorName = value; }
    public String getAction() { return action; }
    public void setAction(String value) { action = value; }
    public String getTarget() { return target; }
    public void setTarget(String value) { target = value; }
    public String getSummary() { return summary; }
    public void setSummary(String value) { summary = value; }
}
