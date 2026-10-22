package com.pandora.server.repository;

import com.pandora.server.model.ChangeRequest;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ChangeRequestRepository extends JpaRepository<ChangeRequest, String> {
    List<ChangeRequest> findByStatus(ChangeRequest.Status status);
    List<ChangeRequest> findByProposerId(String proposerId);
    boolean existsByTaskIdAndStatus(String taskId, ChangeRequest.Status status);
}
