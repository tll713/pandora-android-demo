package com.pandora.server.repository;

import com.pandora.server.model.Task;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface TaskRepository extends JpaRepository<Task, String> {
    List<Task> findByDeletedFalse();
    List<Task> findByDeletedFalseAndCreatorId(String creatorId);
    
    @Query("SELECT t FROM Task t JOIN t.owners o WHERE t.deleted = false AND o.user.id = :userId")
    List<Task> findVisibleToUser(@Param("userId") String userId);
    
    @Query("SELECT t FROM Task t JOIN t.owners o WHERE t.deleted = false AND o.user.department = :department")
    List<Task> findVisibleToDepartment(@Param("department") String department);
    
    @Query("SELECT t FROM Task t WHERE t.deleted = false AND (t.creatorId = :userId OR EXISTS (SELECT o FROM TaskOwner o WHERE o.task = t AND o.user.id = :userId))")
    List<Task> findVisibleToCreatorOrOwner(@Param("userId") String userId);
}
