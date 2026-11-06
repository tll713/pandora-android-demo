package com.pandora.server.repository;

import com.pandora.server.model.DailyTodo;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface DailyTodoRepository extends JpaRepository<DailyTodo, String> {
    List<DailyTodo> findByOwnerIdOrderByDateAscCreatedAtAsc(String ownerId);
}
