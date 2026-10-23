package com.pandora.server.service;

import com.pandora.server.model.User;
import com.pandora.server.repository.UserRepository;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class UserService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    public UserService(UserRepository userRepository, PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }

    public List<User> getAllUsers() {
        return userRepository.findAll();
    }

    @Transactional
    public void changePassword(User user, String currentPassword, String newPassword) {
        if (currentPassword == null || !passwordEncoder.matches(currentPassword, user.getPasswordHash()))
            throw new IllegalArgumentException("原密码不正确");
        if (newPassword == null || newPassword.length() < 8 || newPassword.length() > 64
                || newPassword.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 72
                || newPassword.isBlank())
            throw new IllegalArgumentException("新密码需为 8～64 位字符，最多 72 字节");
        if (passwordEncoder.matches(newPassword, user.getPasswordHash()))
            throw new IllegalArgumentException("新密码不能与原密码相同");
        user.setPasswordHash(passwordEncoder.encode(newPassword));
        userRepository.save(user);
    }

    @Transactional
    public User createUser(User admin, String name, String login, String department, String role) {
        if (admin.getRole() != User.Role.ADMIN) throw new IllegalArgumentException("只有管理员可以创建账号");
        if (name == null || name.trim().isEmpty()) throw new IllegalArgumentException("请填写姓名");
        if (name.trim().length() > 30) throw new IllegalArgumentException("姓名不能超过 30 个字");
        if (login == null || login.trim().isEmpty()) throw new IllegalArgumentException("请填写账号");
        login = login.trim();
        if (!login.matches("^[a-zA-Z0-9_-]{3,30}$")) throw new IllegalArgumentException("账号需为 3 到 30 位字母、数字、下划线或短横线");
        if (userRepository.existsById(login)) throw new IllegalArgumentException("账号已存在");
        if (department == null || department.trim().isEmpty()) throw new IllegalArgumentException("请填写部门");
        if (department.trim().length() > 40) throw new IllegalArgumentException("部门不能超过 40 个字");
        User.Role r;
        try {
            r = User.Role.valueOf(role.toUpperCase());
        } catch (Exception e) {
            throw new IllegalArgumentException("请选择有效角色");
        }
        if (r == User.Role.ADMIN || r == User.Role.FOUNDER) throw new IllegalArgumentException("不能创建管理员或创始人账号");
        User u = new User();
        u.setId(login);
        u.setName(name.trim());
        u.setDepartment(department.trim());
        u.setRole(r);
        u.setAvatar(name.trim().substring(name.trim().length() - 1));
        u.setColor("blue");
        u.setPasswordHash(passwordEncoder.encode(login)); // 初始密码与账号相同
        return userRepository.save(u);
    }
    private void requireAccountAdmin(User actor, User target) {
        if (actor.getRole() != User.Role.ADMIN)
            throw new IllegalArgumentException("只有管理员可以维护账号");
        if (target.isGlobal())
            throw new IllegalArgumentException("管理员和创始人账号受保护，不能在此修改");
    }

    @Transactional
    public User updateUser(User actor, String id, String name, String department, String role, boolean enabled) {
        User target = userRepository.findById(id).orElseThrow(() -> new IllegalArgumentException("账号不存在"));
        requireAccountAdmin(actor, target);
        if (name == null || name.isBlank() || name.trim().length() > 30)
            throw new IllegalArgumentException("姓名需为 1～30 个字");
        if (department == null || department.isBlank() || department.trim().length() > 40)
            throw new IllegalArgumentException("部门需为 1～40 个字");
        User.Role newRole;
        try { newRole = User.Role.valueOf(role); }
        catch (Exception e) { throw new IllegalArgumentException("请选择有效角色"); }
        if (newRole == User.Role.ADMIN || newRole == User.Role.FOUNDER)
            throw new IllegalArgumentException("不能通过此操作授予管理员或创始人身份");
        target.setName(name.trim());
        target.setDepartment(department.trim());
        target.setRole(newRole);
        target.setEnabled(enabled);
        target.setAvatar(name.trim().substring(name.trim().length() - 1));
        target.setAuthVersion(target.getAuthVersion() + 1);
        return userRepository.save(target);
    }

    @Transactional
    public void resetPassword(User actor, String id, String password) {
        User target = userRepository.findById(id).orElseThrow(() -> new IllegalArgumentException("账号不存在"));
        requireAccountAdmin(actor, target);
        if (password == null || password.isBlank() || password.length() < 8 || password.length() > 64
                || password.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 72)
            throw new IllegalArgumentException("新密码需为 8～64 位字符，最多 72 字节");
        target.setPasswordHash(passwordEncoder.encode(password));
        target.setAuthVersion(target.getAuthVersion() + 1);
        userRepository.save(target);
    }

}
