package com.pandora.server.repository;

import com.pandora.server.model.LogComment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface LogCommentRepository extends JpaRepository<LogComment, String> {
    List<LogComment> findByLogIdOrderByCreatedAtDesc(String logId);
}
