package com.pandora.server.service;

import com.pandora.server.model.User;
import com.pandora.server.repository.UserRepository;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.DateTimeException;
import java.time.LocalDate;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

@Service
public class UserService {

    public record CreatedAccount(User user, String temporaryPassword) {}

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    private static final String LOWER = "abcdefghijkmnopqrstuvwxyz";
    private static final String DIGITS = "23456789";
    private static final String SYMBOLS = "!@#$%&*+-_";
    private static final String PASSWORD_CHARS = UPPER + LOWER + DIGITS + SYMBOLS;

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
    public CreatedAccount createUser(User admin, String name, String phone, String gender,
                                    String idNumber, String department, String role) {
        if (admin.getRole() != User.Role.ADMIN) throw new IllegalArgumentException("只有管理员可以创建账号");
        name = validateName(name);
        phone = normalizePhone(phone);
        if (userRepository.existsByPhone(phone)) throw new IllegalArgumentException("手机号已被使用");
        gender = validateGender(gender);
        idNumber = validateIdNumber(idNumber);
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
        u.setId(newInternalId());
        u.setName(name);
        u.setPhone(phone);
        u.setGender(gender);
        u.setIdNumber(idNumber);
        u.setDepartment(department.trim());
        u.setRole(r);
        u.setAvatar(name.substring(name.length() - 1));
        u.setColor("blue");
        String temporaryPassword = generatePassword();
        u.setPasswordHash(passwordEncoder.encode(temporaryPassword));
        return new CreatedAccount(userRepository.save(u), temporaryPassword);
    }
    private void requireAccountAdmin(User actor, User target) {
        if (actor.getRole() != User.Role.ADMIN)
            throw new IllegalArgumentException("只有管理员可以维护账号");
        if (target.isGlobal())
            throw new IllegalArgumentException("管理员和创始人账号受保护，不能在此修改");
    }

    @Transactional
    public User updateUser(User actor, String id, String name, String phone, String gender,
                           String idNumber, String department, String role, boolean enabled) {
        User target = userRepository.findById(id).orElseThrow(() -> new IllegalArgumentException("账号不存在"));
        requireAccountAdmin(actor, target);
        name = validateName(name);
        phone = normalizePhone(phone);
        if (userRepository.existsByPhoneAndIdNot(phone, id)) throw new IllegalArgumentException("手机号已被使用");
        gender = validateGender(gender);
        idNumber = validateIdNumber(idNumber);
        if (department == null || department.isBlank() || department.trim().length() > 40)
            throw new IllegalArgumentException("部门需为 1～40 个字");
        User.Role newRole;
        try { newRole = User.Role.valueOf(role); }
        catch (Exception e) { throw new IllegalArgumentException("请选择有效角色"); }
        if (newRole == User.Role.ADMIN || newRole == User.Role.FOUNDER)
            throw new IllegalArgumentException("不能通过此操作授予管理员或创始人身份");
        target.setName(name);
        target.setPhone(phone);
        target.setGender(gender);
        target.setIdNumber(idNumber);
        target.setDepartment(department.trim());
        target.setRole(newRole);
        target.setEnabled(enabled);
        target.setAvatar(name.substring(name.length() - 1));
        target.setAuthVersion(target.getAuthVersion() + 1);
        return userRepository.save(target);
    }

    @Transactional
    public User updateAvatar(User user, String avatarData) {
        if (avatarData == null || avatarData.length() > 350000 || !avatarData.matches("^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$"))
            throw new IllegalArgumentException("请选择有效的 JPEG 头像");
        String encoded = avatarData.substring("data:image/jpeg;base64,".length());
        try {
            byte[] bytes = Base64.getDecoder().decode(encoded);
            if (bytes.length > 256 * 1024)
                throw new IllegalArgumentException("头像压缩后不能超过 256 KB");
            try (var input = javax.imageio.ImageIO.createImageInputStream(new java.io.ByteArrayInputStream(bytes))) {
                var readers = javax.imageio.ImageIO.getImageReaders(input);
                if (!readers.hasNext()) throw new IllegalArgumentException("请选择有效的 JPEG 头像");
                var reader = readers.next();
                try {
                    reader.setInput(input);
                    if (!"JPEG".equalsIgnoreCase(reader.getFormatName()) || reader.getWidth(0) > 1024 || reader.getHeight(0) > 1024
                            || reader.read(0) == null) throw new IllegalArgumentException("请选择有效的 JPEG 头像");
                } finally { reader.dispose(); }
            }
        } catch (java.io.IOException e) {
            throw new IllegalArgumentException("请选择有效的 JPEG 头像");
        } catch (IllegalArgumentException e) {
            if (e.getMessage() != null && e.getMessage().contains("不能超过")) throw e;
            throw new IllegalArgumentException("请选择有效的 JPEG 头像");
        }
        user.setAvatarData(avatarData);
        return userRepository.save(user);
    }

    private String validateName(String name) {
        if (name == null || name.trim().isEmpty() || name.trim().length() > 30)
            throw new IllegalArgumentException("姓名需为 1～30 个字");
        return name.trim();
    }

    private String normalizePhone(String phone) {
        if (phone == null) throw new IllegalArgumentException("请填写手机号");
        String normalized = phone.trim().replaceAll("[\\s()-]", "");
        if (!normalized.matches("^\\+?[0-9]{7,15}$")) throw new IllegalArgumentException("请输入有效手机号");
        return normalized;
    }

    private String validateGender(String gender) {
        if (gender == null || gender.isBlank()) return null;
        String value = gender.trim();
        if (!List.of("男", "女", "其他").contains(value)) throw new IllegalArgumentException("请选择有效性别");
        return value;
    }

    private String validateIdNumber(String idNumber) {
        if (idNumber == null || idNumber.isBlank()) return null;
        String value = idNumber.trim().toUpperCase();
        if (!value.matches("^[0-9]{17}[0-9X]$")) throw new IllegalArgumentException("身份证号需为 18 位有效格式");
        try {
            LocalDate.of(Integer.parseInt(value.substring(6, 10)), Integer.parseInt(value.substring(10, 12)),
                    Integer.parseInt(value.substring(12, 14)));
        } catch (DateTimeException | NumberFormatException e) {
            throw new IllegalArgumentException("身份证号中的出生日期无效");
        }
        return value;
    }

    private String newInternalId() {
        String id;
        do { id = UUID.randomUUID().toString().replace("-", "").substring(0, 30); }
        while (userRepository.existsById(id));
        return id;
    }

    private String generatePassword() {
        char[] password = new char[18];
        password[0] = pick(UPPER);
        password[1] = pick(LOWER);
        password[2] = pick(DIGITS);
        password[3] = pick(SYMBOLS);
        for (int i = 4; i < password.length; i++) password[i] = pick(PASSWORD_CHARS);
        for (int i = password.length - 1; i > 0; i--) {
            int j = RANDOM.nextInt(i + 1);
            char value = password[i]; password[i] = password[j]; password[j] = value;
        }
        return new String(password);
    }

    private char pick(String chars) { return chars.charAt(RANDOM.nextInt(chars.length())); }

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
