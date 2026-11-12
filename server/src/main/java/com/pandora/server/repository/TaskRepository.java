package com.pandora.server.repository;

import com.pandora.server.model.Task;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.Lock;
import jakarta.persistence.LockModeType;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

public interface TaskRepository extends JpaRepository<Task, String> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT t FROM Task t WHERE t.id = :id")
    Optional<Task> findForUpdate(@Param("id") String id);

    List<Task> findByDeletedFalse();
    List<Task> findByDeletedFalseAndCreatorId(String creatorId);

    long countByTagId(String tagId);

    /** 删除标签时把任务的标签引用清空，避免留下悬空的 tag_id。 */
    @Modifying
    @Transactional
    @Query("UPDATE Task t SET t.tagId = null WHERE t.tagId = :tagId")
    int clearTag(@Param("tagId") String tagId);
    
    @Query("SELECT t FROM Task t JOIN t.owners o WHERE t.deleted = false AND o.user.id = :userId")
    List<Task> findVisibleToUser(@Param("userId") String userId);
    
    @Query("SELECT t FROM Task t JOIN t.owners o WHERE t.deleted = false AND o.user.department = :department")
    List<Task> findVisibleToDepartment(@Param("department") String department);
    
    @Query("SELECT t FROM Task t WHERE t.deleted = false AND (t.creatorId = :userId OR EXISTS (SELECT o FROM TaskOwner o WHERE o.task = t AND o.user.id = :userId))")
    List<Task> findVisibleToCreatorOrOwner(@Param("userId") String userId);
}
