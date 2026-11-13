package com.pandora.server.repository;

import com.pandora.server.model.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;
import java.util.Optional;

import java.util.List;

public interface UserRepository extends JpaRepository<User, String> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT u FROM User u WHERE u.id = :id")
    Optional<User> findForUpdate(@Param("id") String id);

    boolean existsByRole(User.Role role);
    boolean existsByPhone(String phone);
    boolean existsByPhoneAndIdNot(String phone, String id);
    List<User> findByPhone(String phone);
    List<User> findByName(String name);
}
