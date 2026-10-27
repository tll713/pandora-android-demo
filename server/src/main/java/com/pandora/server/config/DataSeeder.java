package com.pandora.server.config;

import com.pandora.server.model.*;
import com.pandora.server.repository.*;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Component
public class DataSeeder implements ApplicationRunner {

    private final UserRepository userRepository;
    private final TaskRepository taskRepository;
    private final TaskOwnerRepository taskOwnerRepository;
    private final TaskHistoryRepository taskHistoryRepository;
    private final ChangeRequestRepository changeRequestRepository;
    private final WorkLogRepository workLogRepository;
    private final AnnouncementRepository announcementRepository;
    private final PinRepository pinRepository;
    private final PasswordEncoder passwordEncoder;

    public DataSeeder(UserRepository userRepository,
                      TaskRepository taskRepository,
                      TaskOwnerRepository taskOwnerRepository,
                      TaskHistoryRepository taskHistoryRepository,
                      ChangeRequestRepository changeRequestRepository,
                      WorkLogRepository workLogRepository,
                      AnnouncementRepository announcementRepository,
                      PinRepository pinRepository,
                      PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.taskRepository = taskRepository;
        this.taskOwnerRepository = taskOwnerRepository;
        this.taskHistoryRepository = taskHistoryRepository;
        this.changeRequestRepository = changeRequestRepository;
        this.workLogRepository = workLogRepository;
        this.announcementRepository = announcementRepository;
        this.pinRepository = pinRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (userRepository.count() > 0) return;

        seedUsers();
        seedTasksAndHistory();
        seedLogs();
        seedAnnouncements();
        seedPins();
    }

    private void seedUsers() {
        String today = LocalDate.now().toString();
        LocalDateTime at = LocalDateTime.now();
        List<User> users = List.of(
            buildUser("manager", "沈知夏", "产品设计部", User.Role.DEPT_MANAGER, "夏", "green"),
            buildUser("lin", "林予安", "产品设计部", User.Role.EMPLOYEE, "安", "blue"),
            buildUser("zhou", "周一鸣", "产品设计部", User.Role.TEAM_LEAD, "鸣", "orange"),
            buildUser("chen", "陈嘉宁", "市场运营部", User.Role.EMPLOYEE, "宁", "purple"),
            buildUser("founder", "许文清", "管理中心", User.Role.FOUNDER, "清", "green"),
            buildUser("admin", "系统管理员", "管理中心", User.Role.ADMIN, "管", "gray")
        );
        userRepository.saveAll(users);
    }

    private User buildUser(String id, String name, String dept, User.Role role, String avatar, String color) {
        User u = new User();
        u.setId(id);
        u.setName(name);
        u.setDepartment(dept);
        u.setRole(role);
        u.setAvatar(avatar);
        u.setColor(color);
        u.setPasswordHash(passwordEncoder.encode(id)); // 仅演示种子保留此密码；登录请使用姓名，正式建号自动生成强密码
        return u;
    }

    private void seedTasksAndHistory() {
        String today = LocalDate.now().toString();
        LocalDateTime at = LocalDateTime.now();
        String[][] rows = {
            {"t1", "完成客户方案初稿", "lin,zhou", "HIGH", "0", "DOING", "梳理客户需求，完成方案结构、核心页面和报价说明。", "manager"},
            {"t2", "整理本周产品需求", "manager", "HIGH", "1", "DOING", "汇总团队反馈，明确需求优先级和验收条件。", "manager"},
            {"t3", "检查移动端交互原型", "zhou", "MEDIUM", "2", "TODO", "检查任务详情、日志和日历在手机上的操作路径。", "manager"},
            {"t4", "整理用户访谈记录", "lin", "MEDIUM", "-1", "DONE", "按使用场景分类，保留原始记录引用。", "manager"},
            {"t5", "准备周例会材料", "manager,lin", "MEDIUM", "2", "TODO", "整理本周成果、风险和下一步安排。", "manager"},
            {"t6", "完成任务模块测试清单", "zhou", "HIGH", "-1", "DOING", "覆盖多人负责、变更审核和直接完成流程。", "manager"},
            {"t7", "整理活动投放计划", "chen", "HIGH", "3", "TODO", "汇总活动渠道和预算。", "founder"},
        };
        for (String[] r : rows) {
            Task t = new Task();
            t.setId(r[0]);
            t.setTitle(r[1]);
            t.setPriority(Task.Priority.valueOf(r[3]));
            t.setDueAt(LocalDateTime.parse(today + "T18:30").plusDays(Long.parseLong(r[4])));
            t.setStatus(Task.Status.valueOf(r[5]));
            t.setDetail(r[6]);
            t.setCreatorId(r[7]);
            t.setRevision(1);
            t.setDeleted(false);
            t.setCreatedAt(at);
            t.setOwners(new ArrayList<>());
            taskRepository.save(t);

            String[] ownerIds = r[2].split(",");
            for (String oid : ownerIds) {
                taskOwnerRepository.save(new TaskOwner(t, userRepository.findById(oid.trim()).orElseThrow()));
            }

            TaskHistory h1 = new TaskHistory();
            h1.setTask(t);
            h1.setAt(at);
            h1.setActorId("founder");
            h1.setText("演示任务已审核通过");
            taskHistoryRepository.save(h1);

            if (t.getStatus() == Task.Status.DOING) {
                TaskHistory h2 = new TaskHistory();
                h2.setTask(t);
                h2.setAt(at);
                h2.setActorId(ownerIds[0].trim());
                h2.setText("工作进展：主要框架已整理，正在补充细节。");
                taskHistoryRepository.save(h2);
            }
            if (t.getStatus() == Task.Status.DONE) {
                TaskHistory h2 = new TaskHistory();
                h2.setTask(t);
                h2.setAt(at);
                h2.setActorId(ownerIds[0].trim());
                h2.setText("标记任务完成，无需审核");
                taskHistoryRepository.save(h2);
                t.setCompletedAt(at);
                taskRepository.save(t);
            }
        }
    }

    private void seedLogs() {
        String today = LocalDate.now().toString();
        LocalDateTime at = LocalDateTime.now();
        for (int i = 0; i < 9; i++) {
            WorkLog log = new WorkLog();
            log.setId("l" + i);
            log.setAuthorId(i == 1 ? "zhou" : "lin");
            log.setDate(LocalDate.now().minusDays(i));
            log.setTitle(LocalDate.now().minusDays(i).toString() + " 工作日志");
            log.setContent(i == 0 ? "完成客户需求梳理，整理了方案主要框架。\n报价细节待进一步确认，明天继续补充。" : "整理需求和工作资料，记录问题并同步团队。");
            log.setTaskId("");
            workLogRepository.save(log);
        }
    }

    private void seedAnnouncements() {
        String today = LocalDate.now().toString();
        Announcement a1 = new Announcement();
        a1.setId("a1");
        a1.setTitle("本周工作安排");
        a1.setContent("请各部门准备周例会材料，及时在任务详情记录进展。");
        a1.setCategory("工作安排");
        a1.setDate(LocalDate.now());
        Announcement a2 = new Announcement();
        a2.setId("a2");
        a2.setTitle("移动端初版体验");
        a2.setContent("重点检查多人负责、任务审核和每日工作日志的操作体验。");
        a2.setCategory("产品动态");
        a2.setDate(LocalDate.now());
        announcementRepository.saveAll(List.of(a1, a2));
    }

    private void seedPins() {
        String[][] pins = {
            {"lin", "t1"}, {"lin", "t5"},
            {"manager", "t2"}, {"manager", "t5"},
            {"zhou", "t1"}, {"zhou", "t3"}
        };
        for (String[] p : pins) {
            Pin pin = new Pin();
            pin.setUserId(p[0]);
            pin.setTaskId(p[1]);
            pinRepository.save(pin);
        }
    }
}
