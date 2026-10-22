package com.pandora.server.repository;

import com.pandora.server.model.TaskOwner;
import com.pandora.server.model.TaskOwnerId;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TaskOwnerRepository extends JpaRepository<TaskOwner, TaskOwnerId> {
}
