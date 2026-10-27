package com.pandora.server.repository;

import com.pandora.server.model.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface UserRepository extends JpaRepository<User, String> {
    boolean existsByRole(User.Role role);
    boolean existsByPhone(String phone);
    boolean existsByPhoneAndIdNot(String phone, String id);
    List<User> findByPhone(String phone);
    List<User> findByName(String name);
}
