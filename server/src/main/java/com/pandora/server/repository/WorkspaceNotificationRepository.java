package com.pandora.server.repository;

import com.pandora.server.model.WorkspaceNotification;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface WorkspaceNotificationRepository extends JpaRepository<WorkspaceNotification, String> {
    List<WorkspaceNotification> findTop200ByRecipientIdOrderByCreatedAtDescIdDesc(String recipientId);
}
