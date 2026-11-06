package com.pandora.server.config;

import com.pandora.server.model.DailyTodo;
import com.pandora.server.model.User;
import com.pandora.server.model.WorkLog;
import com.pandora.server.repository.DailyTodoRepository;
import com.pandora.server.repository.UserRepository;
import com.pandora.server.repository.WorkLogRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.*;

@DataJpaTest(showSql = false, properties = {
        "spring.jpa.hibernate.ddl-auto=create-drop", "spring.sql.init.mode=never",
        "pandora.demo-data.enabled=true", "logging.level.root=WARN"
})
@Import(DemoActivitySeeder.class)
class DemoActivitySeederTest {
    @Autowired DemoActivitySeeder seeder;
    @Autowired UserRepository users;
    @Autowired WorkLogRepository logs;
    @Autowired DailyTodoRepository todos;

    private User member(String id, String name) {
        User user = new User();
        user.setId(id); user.setName(name); user.setDepartment("产品设计部");
        user.setRole(User.Role.EMPLOYEE); user.setPasswordHash("test-hash");
        return users.save(user);
    }

    @Test
    void fillsRecentDaysOnceAndAdvancesWhenTheDateChanges() {
        LocalDate today = LocalDate.of(2026, 11, 6);
        member("lin", "林予安");
        member("real-member", "真实成员");
        member("chen", "另一个用户");
        User disabled = member("wang", "王思琪");
        disabled.setEnabled(false); users.save(disabled);

        seeder.topUpAt(today);
        assertEquals(30, logs.count());
        assertEquals(60, todos.count());
        assertEquals(7, logs.findByAuthorIdAndDateBetween("lin", today.minusDays(6), today).size());
        var todayTodos = todos.findByOwnerIdOrderByDateAscCreatedAtAsc("lin").stream().filter(t -> t.getDate().equals(today)).toList();
        assertEquals(6, todayTodos.size());
        assertEquals(2, todayTodos.stream().filter(DailyTodo::isDone).count());
        assertTrue(logs.findAll().stream().allMatch(log -> log.getAuthorId().equals("lin") && !log.getDate().isAfter(today)));

        seeder.topUpAt(today);
        assertEquals(30, logs.count());
        assertEquals(60, todos.count());

        LocalDate later = today.plusDays(4);
        seeder.topUpAt(later);
        assertEquals(34, logs.count());
        assertEquals(84, todos.count());
        assertEquals(30, logs.findByAuthorIdAndDateBetween("lin", later.minusDays(29), later).size());
        assertEquals(6, todos.findByOwnerIdOrderByDateAscCreatedAtAsc("lin").stream().filter(t -> t.getDate().equals(later)).count());
    }

    @Test
    void preservesExistingLogsAndPersonalChecklistIncludingCompletedState() {
        LocalDate today = LocalDate.of(2026, 11, 6);
        member("lin", "林予安");
        WorkLog original = new WorkLog();
        original.setId("my-log"); original.setAuthorId("lin"); original.setDate(today);
        original.setTitle("我自己的日志"); original.setContent("手动记录的工作内容");
        logs.save(original);
        DailyTodo personal = new DailyTodo();
        personal.setId("personal-todo"); personal.setOwnerId("lin"); personal.setDate(today);
        personal.setTitle("自己添加的事项"); personal.setDone(true);
        todos.save(personal);

        seeder.topUpAt(today);
        assertEquals(30, logs.count());
        assertEquals("手动记录的工作内容", logs.findByAuthorIdAndDate("lin", today).orElseThrow().getContent());
        assertEquals(6, todos.findByOwnerIdOrderByDateAscCreatedAtAsc("lin").stream().filter(t -> t.getDate().equals(today)).count());
        assertEquals("自己添加的事项", todos.findById("personal-todo").orElseThrow().getTitle());
        assertTrue(todos.findById("personal-todo").orElseThrow().isDone());

        WorkLog edited = logs.findByAuthorIdAndDate("lin", today.minusDays(1)).orElseThrow();
        edited.setContent("演示日志已由用户修改"); logs.save(edited);
        DailyTodo changed = todos.findByOwnerIdOrderByDateAscCreatedAtAsc("lin").stream()
                .filter(t -> t.getDate().equals(today.plusDays(1))).findFirst().orElseThrow();
        changed.setTitle("修改后的安排"); changed.setDone(true); todos.save(changed);
        String deletedId = todos.findByOwnerIdOrderByDateAscCreatedAtAsc("lin").stream()
                .filter(t -> t.getDate().equals(today.plusDays(1)) && !t.getId().equals(changed.getId())).findFirst().orElseThrow().getId();
        todos.deleteById(deletedId);

        seeder.topUpAt(today);
        assertEquals("演示日志已由用户修改", logs.findById(edited.getId()).orElseThrow().getContent());
        assertEquals("修改后的安排", todos.findById(changed.getId()).orElseThrow().getTitle());
        assertTrue(todos.findById(changed.getId()).orElseThrow().isDone());
        assertFalse(todos.existsById(deletedId));
    }

    @Test
    void topsUpSparseListsAcrossAccountsAndDoesNotRestoreClearedDays() {
        LocalDate today = LocalDate.of(2026, 11, 6);
        member("manager", "沈知夏");
        member("lin", "林予安");
        member("chen", "陈嘉宁");
        DailyTodo managerItem = new DailyTodo();
        managerItem.setId("existing-manager"); managerItem.setOwnerId("manager");
        managerItem.setDate(today); managerItem.setTitle("审核项目排期"); managerItem.setDone(false);
        todos.save(managerItem);
        DailyTodo duplicateTitle = new DailyTodo();
        duplicateTitle.setId("existing-lin"); duplicateTitle.setOwnerId("lin");
        duplicateTitle.setDate(today); duplicateTitle.setTitle("梳理需求优先级"); duplicateTitle.setDone(true);
        todos.save(duplicateTitle);

        seeder.topUpAt(today);
        for (String owner : new String[]{"manager", "lin", "chen"}) {
            var checklist = todos.findByOwnerIdOrderByDateAscCreatedAtAsc(owner).stream()
                    .filter(item -> item.getDate().equals(today)).toList();
            assertEquals(6, checklist.size());
            assertEquals(6, checklist.stream().map(DailyTodo::getTitle).distinct().count());
        }
        assertFalse(todos.findById("existing-manager").orElseThrow().isDone());
        assertTrue(todos.findById("existing-lin").orElseThrow().isDone());
        assertEquals(180, todos.count());
        seeder.topUpAt(today);
        assertEquals(180, todos.count());

        todos.deleteAll(todos.findByOwnerIdOrderByDateAscCreatedAtAsc("manager").stream()
                .filter(item -> item.getDate().equals(today)).toList());
        seeder.topUpAt(today);
        assertEquals(0, todos.findByOwnerIdOrderByDateAscCreatedAtAsc("manager").stream()
                .filter(item -> item.getDate().equals(today)).count());
    }
}
