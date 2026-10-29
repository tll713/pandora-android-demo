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
    private final HighlightRepository highlightRepository;
    private final PasswordEncoder passwordEncoder;

    public DataSeeder(UserRepository userRepository,
                      TaskRepository taskRepository,
                      TaskOwnerRepository taskOwnerRepository,
                      TaskHistoryRepository taskHistoryRepository,
                      ChangeRequestRepository changeRequestRepository,
                      WorkLogRepository workLogRepository,
                      AnnouncementRepository announcementRepository,
                      PinRepository pinRepository,
                      HighlightRepository highlightRepository,
                      PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.taskRepository = taskRepository;
        this.taskOwnerRepository = taskOwnerRepository;
        this.taskHistoryRepository = taskHistoryRepository;
        this.changeRequestRepository = changeRequestRepository;
        this.workLogRepository = workLogRepository;
        this.announcementRepository = announcementRepository;
        this.pinRepository = pinRepository;
        this.highlightRepository = highlightRepository;
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
        seedHighlights();
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
            buildUser("admin", "系统管理员", "管理中心", User.Role.ADMIN, "管", "gray"),
            // 新增演示用户
            buildUser("wang", "王思琪", "产品设计部", User.Role.EMPLOYEE, "琪", "pink"),
            buildUser("liu", "刘建国", "产品设计部", User.Role.EMPLOYEE, "国", "teal"),
            buildUser("zhao", "赵敏", "市场运营部", User.Role.TEAM_LEAD, "敏", "orange"),
            buildUser("sun", "孙浩然", "市场运营部", User.Role.EMPLOYEE, "然", "blue"),
            buildUser("li", "李婉清", "技术研发部", User.Role.DEPT_MANAGER, "清", "green"),
            buildUser("zhang", "张伟", "技术研发部", User.Role.EMPLOYEE, "伟", "purple"),
            buildUser("yang", "杨紫萱", "技术研发部", User.Role.EMPLOYEE, "萱", "pink"),
            buildUser("huang", "黄俊杰", "技术研发部", User.Role.TEAM_LEAD, "杰", "teal"),
            buildUser("wu", "吴婷婷", "人力资源部", User.Role.DEPT_MANAGER, "婷", "green"),
            buildUser("zhou2", "周明轩", "人力资源部", User.Role.EMPLOYEE, "轩", "blue")
        );
        userRepository.saveAll(users);
    }

    private User buildUser(String id, String name, String dept, User.Role role, String avatar, String color) {
        User u = new User();
        u.setId(id);
        u.setName(name);
        u.setPhone("138" + String.format("%08d", Math.abs(id.hashCode()) % 100000000));
        u.setGender(id.hashCode() % 2 == 0 ? "男" : "女");
        u.setIdNumber("11010119900101" + String.format("%04d", Math.abs(id.hashCode()) % 10000));
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
            // 新增任务
            {"t8", "产品设计规范文档更新", "wang,liu", "MEDIUM", "0", "DOING", "梳理组件库和设计规范，输出最新版本文档。", "manager"},
            {"t9", "竞品功能调研报告", "liu", "LOW", "4", "TODO", "调研 3 款竞品的核心功能和交互差异。", "manager"},
            {"t10", "市场活动文案撰写", "chen,sun", "HIGH", "1", "DOING", "撰写双十一活动推广文案和海报标语。", "zhao"},
            {"t11", "客户回访电话跟进", "sun", "MEDIUM", "0", "TODO", "联系 10 家重点客户收集产品反馈。", "zhao"},
            {"t12", "App 性能优化方案", "zhang,huang", "HIGH", "2", "DOING", "分析启动速度和内存占用，输出优化方案。", "li"},
            {"t13", "后端接口联调测试", "yang", "HIGH", "1", "DOING", "完成任务、日志、认证模块的接口联调。", "li"},
            {"t14", "技术分享会准备", "huang", "LOW", "5", "TODO", "准备关于微服务架构的技术分享材料。", "li"},
            {"t15", "招聘需求梳理", "wu,zhou2", "MEDIUM", "3", "TODO", "汇总各部门招聘需求，制定招聘计划。", "founder"},
            {"t16", "员工入职培训材料", "zhou2", "LOW", "7", "TODO", "整理新员工入职培训 PPT 和手册。", "wu"},
            {"t17", "季度 OKR 复盘", "manager,li,wu", "HIGH", "5", "TODO", "各部门负责人复盘本季度 OKR 完成情况。", "founder"},
            {"t18", "产品需求评审会议", "lin,zhou,wang", "MEDIUM", "1", "DOING", "评审下一迭代的产品需求清单。", "manager"},
            {"t19", "服务器安全检查", "zhang", "HIGH", "0", "DOING", "检查服务器安全漏洞，更新系统补丁。", "li"},
            {"t20", "用户反馈整理分析", "chen,zhou2", "LOW", "2", "TODO", "整理本月用户反馈，分类统计问题类型。", "founder"},
            // 第二批演示任务（覆盖过去与未来日期）
            {"t21", "撰写产品迭代周报", "lin", "MEDIUM", "-2", "DONE", "汇总本周迭代进度、风险和下周计划。", "manager"},
            {"t22", "整理客户反馈清单", "lin,wang", "HIGH", "0", "DOING", "按主题归类客户反馈，标注优先级。", "manager"},
            {"t23", "更新产品原型标注", "lin", "MEDIUM", "1", "TODO", "补充交互说明和状态标注，便于开发理解。", "manager"},
            {"t24", "准备产品培训材料", "lin,liu", "LOW", "4", "TODO", "整理新功能培训课件与演示脚本。", "manager"},
            {"t25", "核对报价单明细", "lin", "HIGH", "-3", "DONE", "核对报价单中的单价、折扣与付款条款。", "manager"},
            {"t26", "梳理用户旅程地图", "lin,wang", "MEDIUM", "3", "DOING", "梳理关键场景的用户旅程与触达点。", "manager"},
            {"t27", "评审视觉设计稿", "wang,lin,liu", "HIGH", "2", "DOING", "评审新版首页与任务详情的视觉稿。", "manager"},
            {"t28", "整理月度数据报表", "chen,sun", "MEDIUM", "-5", "DONE", "汇总本月投放、转化与留存数据。", "zhao"},
            {"t29", "撰写季度总结", "manager,li,wu", "HIGH", "-7", "DONE", "各部门输出季度总结与下季度重点。", "founder"},
            {"t30", "组织部门团建", "wu,zhou2", "LOW", "9", "TODO", "确定团建时间、场地与预算。", "founder"},
            {"t31", "优化首页加载速度", "zhang,yang", "HIGH", "6", "TODO", "减少首屏资源体积，优化接口响应。", "li"},
            {"t32", "补充接口文档", "yang", "MEDIUM", "-4", "DONE", "补充任务、日志、认证模块接口说明。", "li"},
            {"t33", "调研客户续约意向", "zhao,sun", "HIGH", "2", "DOING", "回访重点客户，评估续约意向。", "founder"},
            {"t34", "制定下季度市场计划", "zhao,chen", "MEDIUM", "8", "TODO", "制定下季度市场推广与预算计划。", "founder"}
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
        String[][] authors = {{"lin", "产品设计"}, {"manager", "产品管理"}, {"chen", "市场运营"}, {"zhou", "产品设计"}, {"zhang", "技术研发"}, {"wu", "人力资源"}};
        String[] contents = {
            "完成客户需求梳理，整理了方案主要框架。\n报价细节待进一步确认，明天继续补充。",
            "整理需求和工作资料，记录问题并同步团队。",
            "与开发同学对齐接口字段，明确异常场景的提示文案。",
            "整理了本周的用户反馈，按类型汇总后同步到需求池。",
            "完成原型页面的交互标注，等待产品评审确认。",
            "跟进客户试用反馈，整理出三个优先修复的问题。",
            "复盘本周任务进度，调整了下周的工作优先级。"
        };
        int seq = 0;
        int daysBack = 21;
        for (String[] author : authors) {
            for (int i = 0; i < daysBack; i++) {
                // 每位用户每 3 天保留一天空档，模拟真实的补写情况
                if ((i + author[0].length()) % 4 == 3) continue;
                LocalDate day = LocalDate.now().minusDays(i);
                WorkLog log = new WorkLog();
                log.setId("l" + (seq++));
                log.setAuthorId(author[0]);
                log.setDate(day);
                log.setTitle(day + " " + author[1] + "工作日志");
                log.setContent(contents[(i + author[0].length()) % contents.length]);
                log.setTaskId("");
                workLogRepository.save(log);
            }
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

    /** 公司、派发、个人三类重要展示项 */
    private void seedHighlights() {
        String[][] company = {
            {"h-c1", "1", "本季度客户满意度提升至 96%", "客户成功团队回访 42 家重点客户，满意度较上季度提升 5 个百分点。"},
            {"h-c2", "2", "新版移动端日历正式上线", "支持月视图缩放、跨天任务连贯展示，日活使用率提升明显。"},
            {"h-c3", "3", "产品设计规范完成统一", "组件库与设计规范完成合并，交付效率提升约 30%。"},
            {"h-c4", "4", "双十一活动方案确定", "市场运营部完成活动方案评审，投放排期已确认。"},
            {"h-c5", "5", "招聘完成率达成 85%", "人力资源部本月完成 17 人入职，关键岗位全部到位。"}
        };
        for (String[] row : company) {
            Highlight h = new Highlight();
            h.setId(row[0]);
            h.setKind("company");
            h.setAudience("");
            h.setPosition(Integer.parseInt(row[1]));
            h.setTitle(row[2]);
            h.setContent(row[3]);
            h.setEnabled(true);
            highlightRepository.save(h);
        }

        String[][] dispatch = {
            {"h-d1", "1", "t17", "季度 OKR 复盘（各部门负责人）", ""},
            {"h-d2", "2", "t27", "视觉设计稿评审", ""},
            {"h-d3", "3", "t31", "首页加载速度优化", ""},
            {"h-d4", "4", "t33", "重点客户续约意向调研", ""}
        };
        for (String[] row : dispatch) {
            Highlight h = new Highlight();
            h.setId(row[0]);
            h.setKind("dispatch");
            h.setAudience("");
            h.setPosition(Integer.parseInt(row[1]));
            h.setTaskId(row[2]);
            h.setTitle(row[3]);
            h.setContent("");
            h.setEnabled(true);
            highlightRepository.save(h);
        }

        String[][] personal = {
            {"h-p1", "lin", "1", "t22", "客户反馈清单整理"},
            {"h-p2", "lin", "2", "t26", "用户旅程地图梳理"},
            {"h-p3", "lin", "3", "t18", "产品需求评审会议"}
        };
        for (String[] row : personal) {
            Highlight h = new Highlight();
            h.setId(row[0]);
            h.setKind("personal");
            h.setAudience(row[1]);
            h.setPosition(Integer.parseInt(row[2]));
            h.setTaskId(row[3]);
            h.setTitle(row[4]);
            h.setContent("");
            h.setEnabled(true);
            highlightRepository.save(h);
        }
    }
}
