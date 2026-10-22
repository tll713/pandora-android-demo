package com.pandora.server.repository;

import com.pandora.server.model.WorkLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

public interface WorkLogRepository extends JpaRepository<WorkLog, String> {
    Optional<WorkLog> findByAuthorIdAndDate(String authorId, LocalDate date);
    List<WorkLog> findByAuthorId(String authorId);
    
    @Query("SELECT l FROM WorkLog l JOIN User u ON l.authorId = u.id WHERE u.department = :department")
    List<WorkLog> findByDepartment(@Param("department") String department);
    
    @Query("SELECT l FROM WorkLog l WHERE l.date >= :start AND l.date <= :end")
    List<WorkLog> findByDateBetween(@Param("start") LocalDate start, @Param("end") LocalDate end);
    
    @Query("SELECT l FROM WorkLog l WHERE l.date >= :start AND l.date <= :end AND l.authorId = :authorId")
    List<WorkLog> findByAuthorIdAndDateBetween(@Param("authorId") String authorId, @Param("start") LocalDate start, @Param("end") LocalDate end);
}
