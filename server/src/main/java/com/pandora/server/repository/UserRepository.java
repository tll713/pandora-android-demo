package com.pandora.server.repository;

import com.pandora.server.model.User;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserRepository extends JpaRepository<User, String> {
    boolean existsByRole(User.Role role);
}
