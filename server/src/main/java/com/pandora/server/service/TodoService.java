package com.pandora.server.service;

import com.pandora.server.model.DailyTodo;
import com.pandora.server.repository.DailyTodoRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class TodoService {

    private final DailyTodoRepository todoRepository;

    public TodoService(DailyTodoRepository todoRepository) {
        this.todoRepository = todoRepository;
    }

    public List<DailyTodo> listOwn(String ownerId) {
        return todoRepository.findByOwnerIdOrderByDateAscCreatedAtAsc(ownerId);
    }

    @Transactional
    public DailyTodo save(String ownerId, Map<String, Object> values) {
        String title = (String) values.get("title");
        if (title == null || title.trim().isEmpty()) throw new IllegalArgumentException("请填写事项内容");
        title = title.trim();
        if (title.length() > 120) throw new IllegalArgumentException("事项内容不能超过 120 个字");

        LocalDate date;
        try {
            date = LocalDate.parse((String) values.get("date"));
        } catch (RuntimeException e) {
            throw new IllegalArgumentException("事项日期格式不正确");
        }

        DailyTodo todo = new DailyTodo();
        todo.setId(UUID.randomUUID().toString());
        todo.setOwnerId(ownerId);
        todo.setDate(date);
        todo.setTitle(title);
        todo.setDone(false);
        return todoRepository.save(todo);
    }

    @Transactional
    public DailyTodo toggle(String ownerId, String id) {
        DailyTodo todo = own(ownerId, id);
        todo.setDone(!todo.isDone());
        return todoRepository.save(todo);
    }

    @Transactional
    public DailyTodo move(String ownerId, String id, String dateValue) {
        DailyTodo todo = own(ownerId, id);
        LocalDate date;
        try {
            date = LocalDate.parse(dateValue);
        } catch (RuntimeException e) {
            throw new IllegalArgumentException("事项日期格式不正确");
        }
        todo.setDate(date);
        return todoRepository.save(todo);
    }

    @Transactional
    public void delete(String ownerId, String id) {
        todoRepository.delete(own(ownerId, id));
    }

    private DailyTodo own(String ownerId, String id) {
        DailyTodo todo = todoRepository.findById(id)
                .filter(item -> item.getOwnerId().equals(ownerId))
                .orElseThrow(() -> new IllegalArgumentException("事项不存在或无权操作"));
        return todo;
    }
}
