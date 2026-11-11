package com.pandora.server.service;

import com.pandora.server.model.DailyTodo;
import com.pandora.server.repository.DailyTodoRepository;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class TodoServiceTest {
    @Test
    void movePreservesIdentityContentAndCompletionAndRejectsOtherOwners() {
        DailyTodoRepository repository = mock(DailyTodoRepository.class);
        TodoService service = new TodoService(repository);
        DailyTodo todo = new DailyTodo();
        todo.setId("todo-1"); todo.setOwnerId("lin"); todo.setTitle("提交报告");
        todo.setDate(LocalDate.of(2026, 11, 11)); todo.setDone(true);
        when(repository.findById("todo-1")).thenReturn(Optional.of(todo));
        when(repository.save(todo)).thenReturn(todo);

        assertThrows(IllegalArgumentException.class, () -> service.move("other", "todo-1", "2026-11-12"));
        assertThrows(IllegalArgumentException.class, () -> service.move("lin", "todo-1", "2026-02-30"));
        assertThrows(IllegalArgumentException.class, () -> service.move("lin", "todo-1", null));
        assertEquals(LocalDate.of(2026, 11, 11), todo.getDate());
        verify(repository, never()).save(any());

        assertSame(todo, service.move("lin", "todo-1", "2026-12-01"));
        assertEquals(LocalDate.of(2026, 12, 1), todo.getDate());
        assertEquals("提交报告", todo.getTitle()); assertTrue(todo.isDone());
        assertEquals("todo-1", todo.getId()); assertEquals("lin", todo.getOwnerId());
        verify(repository).save(todo);
    }
}
