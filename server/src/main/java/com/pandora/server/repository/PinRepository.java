package com.pandora.server.repository;

import com.pandora.server.model.Pin;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface PinRepository extends JpaRepository<Pin, Long> {
    List<Pin> findByUserId(String userId);
    Optional<Pin> findByUserIdAndTaskId(String userId, String taskId);
    void deleteByUserIdAndTaskId(String userId, String taskId);
}
