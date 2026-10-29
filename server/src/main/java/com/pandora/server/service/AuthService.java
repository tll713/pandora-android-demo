package com.pandora.server.service;

import com.pandora.server.model.User;
import com.pandora.server.repository.UserRepository;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class AuthService {

    public record LoginResult(String token, User user) {}

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final SecretKey secretKey;
    private final long expiration;

    public AuthService(UserRepository userRepository, PasswordEncoder passwordEncoder,
                       @Value("${jwt.secret}") String secret,
                       @Value("${jwt.expiration}") long expiration) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.secretKey = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.expiration = expiration;
    }

    public String authenticate(String identifier, String rawPassword) {
        return login(identifier, rawPassword).token();
    }

    public LoginResult login(String identifier, String rawPassword) {
        if (identifier == null || identifier.isBlank() || rawPassword == null)
            throw new IllegalArgumentException("手机号/姓名或密码错误");
        String value = identifier.trim();
        List<User> candidates;
        if (value.matches("^\\+?[0-9\\s()-]{7,24}$")) {
            String phone = value.replaceAll("[\\s()-]", "");
            candidates = userRepository.findByPhone(phone);
        } else {
            candidates = userRepository.findByName(value);
        }
        User matched = null;
        for (User candidate : candidates) {
            if (candidate.isEnabled() && passwordEncoder.matches(rawPassword, candidate.getPasswordHash())) {
                if (matched != null) throw new IllegalArgumentException("手机号/姓名或密码错误");
                matched = candidate;
            }
        }
        if (matched == null) throw new IllegalArgumentException("手机号/姓名或密码错误");
        return new LoginResult(generateToken(matched), matched);
    }

    /** 手机号注册：创建普通员工账号，资料待完善 */
    public LoginResult register(String phone, String rawPassword, String name) {
        if (phone == null || phone.isBlank())
            throw new IllegalArgumentException("请填写手机号");
        String normalized = phone.trim().replaceAll("[\\s()-]", "");
        if (!normalized.matches("^1[3-9]\\d{9}$"))
            throw new IllegalArgumentException("请输入有效的 11 位手机号");
        if (userRepository.existsByPhone(normalized))
            throw new IllegalArgumentException("该手机号已注册，请直接登录");
        if (rawPassword == null || rawPassword.length() < 6 || rawPassword.length() > 64)
            throw new IllegalArgumentException("密码需为 6～64 位字符");
        String displayName = (name != null && !name.isBlank()) ? name.trim() : "用户" + normalized.substring(normalized.length() - 4);
        if (displayName.length() > 30) displayName = displayName.substring(0, 30);

        User u = new User();
        u.setId(java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 30));
        u.setName(displayName);
        u.setPhone(normalized);
        u.setDepartment("待分配");
        u.setRole(User.Role.EMPLOYEE);
        u.setAvatar(displayName.substring(displayName.length() - 1));
        u.setColor("blue");
        u.setPasswordHash(passwordEncoder.encode(rawPassword));
        userRepository.save(u);
        return new LoginResult(generateToken(u), u);
    }

    private String generateToken(User user) {
        Map<String, Object> claims = new HashMap<>();
        claims.put("role", user.getRole().name());
        claims.put("name", user.getName());
        claims.put("dept", user.getDepartment());
        claims.put("credentials", credentialStamp(user));
        Date now = new Date();
        Date expiry = new Date(now.getTime() + expiration);
        return Jwts.builder()
                .subject(user.getId())
                .claims(claims)
                .issuedAt(now)
                .expiration(expiry)
                .signWith(secretKey, Jwts.SIG.HS256)
                .compact();
    }

    public String validateToken(String token) {
        try {
            var claims = Jwts.parser().verifyWith(secretKey).build()
                    .parseSignedClaims(token).getPayload();
            User user = userRepository.findById(claims.getSubject()).orElse(null);
            return user != null && user.isEnabled() && credentialStamp(user).equals(claims.get("credentials", String.class))
                    ? user.getId() : null;
        } catch (Exception e) {
            return null;
        }
    }

    private String credentialStamp(User user) {
        try {
            byte[] digest = java.security.MessageDigest.getInstance("SHA-256")
                    .digest((user.getPasswordHash() + ":" + user.getAuthVersion()).getBytes(StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(digest);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
