package com.pandora.server.repository;

import com.pandora.server.model.OperationLog;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface OperationLogRepository extends JpaRepository<OperationLog, Long> {
    List<OperationLog> findTop500ByOrderByAtDescIdDesc();

    List<OperationLog> findTop500ByActorIdOrderByAtDescIdDesc(String actorId);
}
