package com.pandora.server.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/** Records completed demo checklist initialization so deleted items stay deleted. */
@Entity
@Table(name = "demo_activity_days")
public class DemoActivityDay {
    @Id
    @Column(length = 50)
    private String id;

    public DemoActivityDay() {}

    public DemoActivityDay(String id) { this.id = id; }

    public String getId() { return id; }
}
