package com.pandora.server.repository;

import com.pandora.server.model.ChangeRequest;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;

import java.util.List;
import java.util.Optional;

public interface ChangeRequestRepository extends JpaRepository<ChangeRequest, String> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT r FROM ChangeRequest r WHERE r.id = :id")
    Optional<ChangeRequest> findForUpdate(@Param("id") String id);

    List<ChangeRequest> findByStatus(ChangeRequest.Status status);
    List<ChangeRequest> findByProposerId(String proposerId);
    boolean existsByTaskIdAndStatus(String taskId, ChangeRequest.Status status);
}
