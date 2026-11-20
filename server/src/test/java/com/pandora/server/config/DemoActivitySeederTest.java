package com.pandora.server.config;

import com.pandora.server.model.DailyTodo;
import com.pandora.server.model.LogComment;
import com.pandora.server.repository.LogCommentRepository;
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
import java.util.List;
import java.util.Map;
import com.pandora.server.service.LogService;
import com.pandora.server.service.TaskService;
import static org.mockito.Mockito.mock;

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
    @Autowired LogCommentRepository comments;

    private User member(String id, String name) {
        User user = new User();
        user.setId(id); user.setName(name); user.setDepartment("产品设计部");
        user.setRole(User.Role.EMPLOYEE); user.setPasswordHash("test-hash");
        return users.save(user);
    }

    @Test
    void initializesMixedLogDaysOnceAndKeepsFutureChecklistWindow() {
        LocalDate today = LocalDate.of(2026, 11, 6);
        member("lin", "林予安");
        member("real-member", "真实成员");
        member("chen", "另一个用户");
        User disabled = member("wang", "王思琪");
        disabled.setEnabled(false); users.save(disabled);

        seeder.topUpAt(today);
        assertEquals(20, logs.count());
        assertEquals(186, todos.count());
        assertTrue(logs.findByAuthorIdAndDateBetween("lin", today.minusDays(6), today).size() < 7);
        var todayTodos = todos.findByOwnerIdOrderByDateAscCreatedAtAsc("lin").stream().filter(t -> t.getDate().equals(today)).toList();
        assertEquals(6, todayTodos.size());
        assertEquals(2, todayTodos.stream().filter(DailyTodo::isDone).count());
        assertTrue(logs.findAll().stream().allMatch(log -> log.getAuthorId().equals("lin") && !log.getDate().isAfter(today)));

        seeder.topUpAt(today);
        assertEquals(20, logs.count());
        assertEquals(186, todos.count());

        LocalDate later = today.plusDays(4);
        seeder.topUpAt(later);
        assertEquals(20, logs.count(), "future dates require members to submit their own logs");
        assertEquals(186, todos.count());
        assertTrue(logs.findByAuthorIdAndDateBetween("lin", later.minusDays(29), later).size() < 20);
        assertTrue(logs.findByAuthorIdAndDate("lin", later).isEmpty());
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
        assertTrue(logs.count() >= 20 && logs.count() <= 21);
        assertEquals("手动记录的工作内容", logs.findByAuthorIdAndDate("lin", today).orElseThrow().getContent());
        assertEquals(6, todos.findByOwnerIdOrderByDateAscCreatedAtAsc("lin").stream().filter(t -> t.getDate().equals(today)).count());
        assertEquals("自己添加的事项", todos.findById("personal-todo").orElseThrow().getTitle());
        assertTrue(todos.findById("personal-todo").orElseThrow().isDone());

        WorkLog edited = logs.findByAuthorId("lin").stream().filter(log -> !log.getId().equals("my-log")).findFirst().orElseThrow();
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
        assertEquals(558, todos.count());
        seeder.topUpAt(today);
        assertEquals(558, todos.count());

        todos.deleteAll(todos.findByOwnerIdOrderByDateAscCreatedAtAsc("manager").stream()
                .filter(item -> item.getDate().equals(today)).toList());
        seeder.topUpAt(today);
        assertEquals(0, todos.findByOwnerIdOrderByDateAscCreatedAtAsc("manager").stream()
                .filter(item -> item.getDate().equals(today)).count());
    }

    @Test
    void upgradesOldDemoLogsToMixedSubmissionsAndKeepsManualWork() {
        LocalDate today = LocalDate.of(2026, 11, 13);
        for (String[] member : new String[][]{{"lin", "林予安"}, {"zhou", "周一鸣"}, {"manager", "沈知夏"}}) {
            member(member[0], member[1]);
            for (int offset = 0; offset < 30; offset++) {
                LocalDate day = today.minusDays(offset);
                WorkLog log = new WorkLog();
                log.setId("demo-log-" + member[0] + "-" + day);
                log.setAuthorId(member[0]); log.setDate(day); log.setDemo(true);
                log.setTitle(day + " 工作日志（演示）"); log.setContent("原有工作记录");
                logs.save(log);
            }
        }
        // A member's actual edit must survive even on a date selected as unsubmitted.
        WorkLog manual = logs.findByAuthorIdAndDate("lin", today).orElseThrow();
        manual.setDemo(false); manual.setTitle("本人提交的日报"); manual.setContent("本人实际工作内容");
        logs.save(manual);
        // Retain comments and their target log even when migrating a sample missing date.
        WorkLog reviewed = logs.findByAuthorIdAndDate("lin", today.minusDays(3)).orElseThrow();
        LogComment comment = new LogComment();
        comment.setId("review"); comment.setLogId(reviewed.getId()); comment.setAuthorId("manager");
        comment.setContent("请继续跟进"); comments.save(comment);

        seeder.topUpAt(today);
        assertTrue(logs.count() < 90);
        assertTrue(logs.findAll().stream().noneMatch(WorkLog::isDemo));
        assertTrue(logs.findAll().stream().noneMatch(log -> log.getTitle().contains("（演示）")));
        assertEquals("本人实际工作内容", logs.findById(manual.getId()).orElseThrow().getContent());
        assertTrue(logs.existsById(reviewed.getId()));
        assertEquals("请继续跟进", comments.findById("review").orElseThrow().getContent());
        // Every historical date has both saved submissions and genuinely absent logs.
        for (int offset = 1; offset < 30; offset++) {
            if (offset == 3) continue;
            int count = logs.findByDateBetween(today.minusDays(offset), today.minusDays(offset)).size();
            assertTrue(count > 0 && count < 3, "mixed state on offset " + offset);
        }
        long total = logs.count();
        seeder.topUpAt(today);
        assertEquals(total, logs.count());
        WorkLog removed = logs.findByAuthorId("zhou").getFirst();
        logs.delete(removed); logs.flush();
        seeder.topUpAt(today.plusDays(1));
        assertFalse(logs.existsById(removed.getId()), "restarts must not submit a deleted log again");
    }

    @Test
    void missingMemberCanSubmitAndRestartKeepsTheirActualWork() {
        var clock = java.time.Clock.system(java.time.ZoneId.of("Asia/Shanghai"));
        LocalDate today = LocalDate.now(clock);
        member("lin", "林予安"); member("zhou", "周一鸣"); member("manager", "沈知夏");
        seeder.topUpAt(today);
        String missingId = List.of("lin", "zhou", "manager").stream()
                .filter(id -> logs.findByAuthorIdAndDate(id, today).isEmpty()).findFirst().orElseThrow();
        long submittedBefore = logs.findByDateBetween(today, today).size();
        LogService service = new LogService(logs, mock(TaskService.class), users, clock);
        WorkLog submitted = service.saveLog(users.findById(missingId).orElseThrow(),
                Map.of("date", today.toString(), "title", "本人今日工作", "content", "通过日志保存流程提交的实际内容"), null);
        logs.flush();
        assertFalse(submitted.isDemo());
        assertEquals(submittedBefore + 1, logs.findByDateBetween(today, today).size());
        seeder.topUpAt(today.plusDays(1));
        assertEquals("通过日志保存流程提交的实际内容", logs.findById(submitted.getId()).orElseThrow().getContent());
        assertEquals(submittedBefore + 1, logs.findByDateBetween(today, today).size());
        assertTrue(logs.findByDateBetween(today.plusDays(1), today.plusDays(1)).isEmpty());
    }

    @Test
    void fillsEveryRemainingDayAndCarriesTheWindowAcrossMonthEnd() {
        member("lin", "林予安");
        LocalDate today = LocalDate.of(2026, 11, 11);
        seeder.topUpAt(today);
        var planned = todos.findByOwnerIdOrderByDateAscCreatedAtAsc("lin");
        for (LocalDate date = today; !date.isAfter(LocalDate.of(2026, 11, 30)); date = date.plusDays(1)) {
            LocalDate expectedDay = date;
            assertEquals(6, planned.stream().filter(todo -> todo.getDate().equals(expectedDay)).count());
        }
        seeder.topUpAt(LocalDate.of(2026, 11, 30));
        assertEquals(6, todos.findByOwnerIdOrderByDateAscCreatedAtAsc("lin").stream()
                .filter(todo -> todo.getDate().equals(LocalDate.of(2026, 12, 3))).count());
    }
}
