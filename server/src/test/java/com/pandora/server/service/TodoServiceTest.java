package com.pandora.server.service;

import com.pandora.server.model.DailyTodo;
import com.pandora.server.repository.DailyTodoRepository;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.ZoneId;
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

        LocalDate target = LocalDate.now(ZoneId.of("Asia/Shanghai")).plusDays(3);
        assertSame(todo, service.move("lin", "todo-1", target.toString()));
        assertEquals(target, todo.getDate());
        assertEquals("提交报告", todo.getTitle()); assertTrue(todo.isDone());
        assertEquals("todo-1", todo.getId()); assertEquals("lin", todo.getOwnerId());
        verify(repository).save(todo);
    }

    @Test
    void onlyMovesForwardFromTodayAndUndoIsOwnedOneTimeAndBoundToTheLastMove() {
        DailyTodoRepository repository = mock(DailyTodoRepository.class);
        TodoService service = new TodoService(repository);
        LocalDate today = LocalDate.now(ZoneId.of("Asia/Shanghai"));
        DailyTodo todo = new DailyTodo(); todo.setId("todo"); todo.setOwnerId("lin");
        todo.setDate(today.minusDays(5)); todo.setTitle("逾期事项");
        when(repository.findById("todo")).thenReturn(Optional.of(todo));
        when(repository.save(todo)).thenReturn(todo);
        assertThrows(IllegalArgumentException.class, () -> service.move("lin","todo",today.minusDays(1).toString()));
        assertEquals(today.minusDays(5),todo.getDate());
        service.move("lin","todo",today.toString());
        String first = todo.getMoveToken(); assertNotNull(first);
        assertThrows(IllegalArgumentException.class, () -> service.undoMove("other","todo",first));
        assertThrows(IllegalArgumentException.class, () -> service.undoMove("lin","todo","forged"));
        service.undoMove("lin","todo",first);
        assertEquals(today.minusDays(5),todo.getDate());
        assertThrows(IllegalArgumentException.class, () -> service.undoMove("lin","todo",first));
        service.move("lin","todo",today.toString()); String stale = todo.getMoveToken();
        service.move("lin","todo",today.plusDays(1).toString());
        assertThrows(IllegalArgumentException.class, () -> service.undoMove("lin","todo",stale));
        service.undoMove("lin","todo",todo.getMoveToken());
        assertEquals(today,todo.getDate());
    }
}
