package com.pandora.server.model;

import jakarta.persistence.*;

@Entity
@Table(name = "users")
public class User {
    @Id
    private String id;
    @Column(nullable = false)
    private String name;
    @Column(unique = true, length = 20)
    private String phone;
    @Column(length = 8)
    private String gender;
    @Column(name = "id_number", length = 18)
    private String idNumber;
    @Column(nullable = false)
    private String department;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Role role;
    private String avatar;
    @Lob
    @Column(name = "avatar_data")
    private String avatarData;
    private String color;
    @Column(name = "password_hash", nullable = false)
    private String passwordHash;
    @Column(name = "created_at", insertable = false, updatable = false)
    private java.time.LocalDateTime createdAt;

    @Column(nullable = false)
    private boolean enabled = true;
    @Column(name = "auth_version", nullable = false)
    private long authVersion = 0;

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public long getAuthVersion() { return authVersion; }
    public void setAuthVersion(long authVersion) { this.authVersion = authVersion; }

    public enum Role {
        ADMIN, FOUNDER, DEPT_MANAGER, TEAM_LEAD, EMPLOYEE
    }

    public boolean isManager() {
        return role != Role.EMPLOYEE;
    }

    public boolean isGlobal() {
        return role == Role.ADMIN || role == Role.FOUNDER;
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getPhone() { return phone; }
    public void setPhone(String phone) { this.phone = phone; }
    public String getGender() { return gender; }
    public void setGender(String gender) { this.gender = gender; }
    public String getIdNumber() { return idNumber; }
    public void setIdNumber(String idNumber) { this.idNumber = idNumber; }
    public String getDepartment() { return department; }
    public void setDepartment(String department) { this.department = department; }
    public Role getRole() { return role; }
    public void setRole(Role role) { this.role = role; }
    public String getAvatar() { return avatar; }
    public void setAvatar(String avatar) { this.avatar = avatar; }
    public String getAvatarData() { return avatarData; }
    public void setAvatarData(String avatarData) { this.avatarData = avatarData; }
    public String getColor() { return color; }
    public void setColor(String color) { this.color = color; }
    public String getPasswordHash() { return passwordHash; }
    public void setPasswordHash(String passwordHash) { this.passwordHash = passwordHash; }
    public java.time.LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(java.time.LocalDateTime createdAt) { this.createdAt = createdAt; }
}
