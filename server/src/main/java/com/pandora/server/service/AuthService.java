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
import java.util.Map;

@Service
public class AuthService {

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

    public String authenticate(String username, String rawPassword) {
        User user = userRepository.findById(username).orElse(null);
        if (user == null || !passwordEncoder.matches(rawPassword, user.getPasswordHash())) {
            throw new IllegalArgumentException("用户名或密码错误");
        }
        return generateToken(user);
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
            return user != null && credentialStamp(user).equals(claims.get("credentials", String.class))
                    ? user.getId() : null;
        } catch (Exception e) {
            return null;
        }
    }

    private String credentialStamp(User user) {
        try {
            byte[] digest = java.security.MessageDigest.getInstance("SHA-256")
                    .digest(user.getPasswordHash().getBytes(StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(digest);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
