package com.pandora.server.model;

import jakarta.persistence.*;

/** Last successfully synchronized annual holiday schedule. */
@Entity
@Table(name = "calendar_years")
public class CalendarYear {
    @Id
    @Column(name = "calendar_year")
    private Integer year;
    @Column(nullable = false, length = 1000)
    private String source;
    @Column(name = "holidays_json", nullable = false, columnDefinition = "LONGTEXT")
    private String holidaysJson;
    @Column(name = "synced_at", nullable = false)
    private java.time.Instant syncedAt;
    @Version
    private Long revision;

    public Integer getYear() { return year; }
    public void setYear(Integer year) { this.year = year; }
    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }
    public String getHolidaysJson() { return holidaysJson; }
    public void setHolidaysJson(String holidaysJson) { this.holidaysJson = holidaysJson; }
    public java.time.Instant getSyncedAt() { return syncedAt; }
    public void setSyncedAt(java.time.Instant syncedAt) { this.syncedAt = syncedAt; }
    public Long getRevision() { return revision; }
}
