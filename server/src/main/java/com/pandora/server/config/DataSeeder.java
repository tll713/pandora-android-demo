package com.pandora.server.config;

import com.pandora.server.model.*;
import com.pandora.server.repository.*;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Component
@ConditionalOnProperty(name = "pandora.demo-data.enabled", havingValue = "true")
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
    private final TagRepository tagRepository;
    private final LogCommentRepository logCommentRepository;
    private final DailyTodoRepository dailyTodoRepository;
    private final OperationLogRepository operationLogRepository;
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
                      TagRepository tagRepository,
                      LogCommentRepository logCommentRepository,
                      DailyTodoRepository dailyTodoRepository,
                      OperationLogRepository operationLogRepository,
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
        this.tagRepository = tagRepository;
        this.logCommentRepository = logCommentRepository;
        this.dailyTodoRepository = dailyTodoRepository;
        this.operationLogRepository = operationLogRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (userRepository.count() == 0) {
            seedUsers();
            seedTags();
            seedTasksAndHistory();
            seedLogs();
            seedAnnouncements();
            seedPins();
            seedHighlights();
        }
        // 已有数据的环境也补齐「公司日常」所需的演示数据，全部按主键判重，可重复启动。
        topUpWorkplaceData();
    }

    /** 补齐十大内容、日志评论、每日事项与操作流水，让演示数据接近真实公司的日常。 */
    private void topUpWorkplaceData() {
        seedTagColors();
        seedExtraHighlights();
        seedLogComments();
        seedDailyPlan();
        seedOperationTrail();
    }

    /** 四个部门各铺一套：每个同事账号每天 3—4 项，其中至少一项是跨天任务。 */
    private void seedDailyPlan() {
        LocalDate today = LocalDate.now();
        LocalDate start = today.minusDays(7);
        LocalDate end = today.withDayOfMonth(today.lengthOfMonth());
        String[][] depts = {
                {"产品", "manager,lin,zhou,wang,liu"},
                {"市场", "zhao,chen,sun"},
                {"技术", "li,zhang,yang,huang"},
                {"人力", "wu,zhou2"}
        };
        String[][] subjects = {
                {"恒远科技", "星河传媒", "蓝湾地产", "云启软件", "青禾教育", "远航物流", "新程医疗", "景行咨询", "睿达制造", "南风文创", "城建集团", "华衡能源"},
                {"恒远科技", "星河传媒", "蓝湾地产", "云启软件", "青禾教育", "远航物流", "新程医疗", "景行咨询", "睿达制造", "南风文创", "城建集团", "华衡能源"},
                {"任务模块", "日志模块", "日历模块", "消息模块", "权限模块", "报表模块", "移动端", "服务端", "数据看板", "发布流程", "监控告警", "测试环境"},
                {"招聘", "培训", "考勤", "入职", "绩效", "员工关系", "团建", "制度", "薪酬", "组织架构", "招聘渠道", "员工关怀"}
        };
        String[][] actions = {
                {"需求确认", "原型评审", "排期对齐", "访谈记录", "验收标准", "走查结论"},
                {"投放跟进", "物料确认", "渠道核对", "数据复盘", "客户回访", "预算核对"},
                {"接口联调", "缺陷修复", "性能检查", "文档补充", "回归测试", "部署验证"},
                {"流程跟进", "材料整理", "数据核对", "计划更新", "面谈安排", "通知发布"}
        };
        String[][][] spanTitles = {
                {{"客户方案整理与报价"}, {"产品原型走查与修改"}, {"设计规范补充修订"}, {"需求评审问题闭环"}},
                {{"活动物料与渠道确认"}, {"市场投放效果复盘"}, {"客户验收与交付"}, {"客户投诉处理跟进"}},
                {{"版本联调与回归测试"}, {"性能压测与调优"}, {"安全合规整改跟踪"}, {"发布说明与回滚预案"}},
                {{"招聘流程跟进"}, {"新员工入职带教"}, {"季度培训计划落地"}, {"考勤与假期制度梳理"}}
        };
        String[][] tags = {
                {"important", "design", "review", "meeting", "research", "routine"},
                {"important", "research", "meeting", "review"},
                {"dev", "review", "important", "routine"},
                {"admin", "training", "meeting", "routine"}
        };
        String[] priorities = {"HIGH", "MEDIUM", "LOW"};
        for (int d = 0; d < depts.length; d++) {
            String owners = depts[d][1];
            String[] deptSubjects = subjects[d];
            String[] deptActions = actions[d];
            String[] spans = spanTitles[d][0];
            int index = 0;
            for (LocalDate day = start; !day.isAfter(end); day = day.plusDays(1), index++) {
                Task.Status status = day.isBefore(today) ? Task.Status.DONE : day.isEqual(today) ? Task.Status.DOING : Task.Status.TODO;
                String prefix = "plan-" + depts[d][0] + "-" + day;
                String[] pool = tags[d];
                int tagCount = pool.length;
                // 标题用「客户/模块/事项 · 动作」组合，跨天也不容易重复
                String first = deptSubjects[Math.floorMod(index, deptSubjects.length)] + " · " + deptActions[(index / 12) % deptActions.length];
                String second = deptSubjects[Math.floorMod(index + 5, deptSubjects.length)] + " · " + deptActions[(index / 12 + 1) % deptActions.length];
                planTask(prefix + "-1", first, pool[index % tagCount], owners,
                        Task.Priority.valueOf(priorities[index % 3]), day.atTime(9, 30), day.atTime(18, 0), status,
                        "当天需要完成的短期任务，完成后可在任务详情记录结果。");
                planTask(prefix + "-2", second, pool[(index + 1) % tagCount], owners,
                        Task.Priority.MEDIUM, day.atTime(13, 30), day.atTime(19, 0), status,
                        "当天追加的事项，用于处理临时任务与协作请求。");
                // 每天一项跨两天的任务，保证每人都有连续任务
                String spanTitle = deptSubjects[Math.floorMod(index + 3, deptSubjects.length)] + " · " + spans[index % spans.length];
                planTask(prefix + "-s", spanTitle, pool[(index + 2) % tagCount], owners,
                        Task.Priority.MEDIUM, day.minusDays(1).atTime(10, 0), day.atTime(18, 0), status,
                        "跨越两天的连续任务，在日历上显示为连续任务条，当天收尾。");
                // 每三天再来一项跨五天的大任务
                if (index % 3 == 0) {
                    String weekTitle = deptSubjects[Math.floorMod(index + 8, deptSubjects.length)] + " · " + spans[(index / 3 + 1) % spans.length];
                    planTask(prefix + "-w", weekTitle, pool[(index + 3) % tagCount], owners,
                            Task.Priority.MEDIUM, day.minusDays(4).atTime(9, 0), day.atTime(18, 0), status,
                            "跨五天的重点任务，按阶段推进并在任务详情记录进展。");
                }
            }
            planTask("plan-long-" + d, depts[d][0] + "年度目标推进", null, owners, Task.Priority.MEDIUM,
                    today.minusDays(12).atTime(9, 0), today.plusDays(9).atTime(18, 0), Task.Status.DOING,
                    "贯穿整月的长期任务，按周推进并记录进展。");
        }
    }

    private void planTask(String id, String title, String tagId, String owner, Task.Priority priority,
                          LocalDateTime start, LocalDateTime due, Task.Status status, String detail) {
        if (taskRepository.existsById(id)) return;
        Task task = new Task();
        task.setId(id);
        task.setTitle(title);
        task.setDetail(detail);
        task.setPriority(priority);
        task.setStartAt(start);
        task.setDueAt(due);
        task.setStatus(status);
        task.setCreatorId("manager");
        task.setCreatedAt(start.minusDays(1));
        task.setRevision(1);
        task.setDeleted(false);
        task.setTagId(tagId);
        task.setOwners(new ArrayList<>());
        if (status == Task.Status.DONE) task.setCompletedAt(due.minusHours(2));
        taskRepository.save(task);
        String[] owners = owner.split(",");
        for (String ownerId : owners) {
            taskOwnerRepository.save(new TaskOwner(task, userRepository.findById(ownerId.trim()).orElseThrow()));
        }
        TaskHistory history = new TaskHistory();
        history.setTask(task);
        history.setAt(status == Task.Status.DONE ? due.minusHours(2) : start);
        history.setActorId(owners[0].trim());
        history.setText(status == Task.Status.DONE ? "按计划完成" : "任务已开始，按节奏推进");
        taskHistoryRepository.save(history);
    }

    private void saveHighlightIfAbsent(String id, String kind, String audience, int position, String title, String content, String taskId) {
        if (highlightRepository.existsById(id)) return;
        Highlight h = new Highlight();
        h.setId(id);
        h.setKind(kind);
        h.setAudience(audience);
        h.setPosition(position);
        h.setTitle(title);
        h.setContent(content);
        h.setTaskId(taskId);
        h.setEnabled(true);
        highlightRepository.save(h);
    }

    private void seedExtraHighlights() {
        // 公司事件纪补足 10 项，与 App 首页编号一一对应
        saveHighlightIfAbsent("h-c6", "company", "", 6, "交付流程线上化率 90%",
                "任务、日志、审核全部在 App 内流转，纸质流转单退出日常流程。", null);
        saveHighlightIfAbsent("h-c7", "company", "", 7, "新人 30 天上手周期缩短",
                "入职培训与带教任务模板化，新人首月即可独立跟进需求。", null);
        saveHighlightIfAbsent("h-c8", "company", "", 8, "周报自动化覆盖 3 个部门",
                "周报由日志与任务进展自动汇总，管理层周一可直接复盘。", null);
        saveHighlightIfAbsent("h-c9", "company", "", 9, "服务器稳定性达到 99.9%",
                "完成巡检与告警接入，近 30 天无影响业务的故障。", null);
        saveHighlightIfAbsent("h-c10", "company", "", 10, "季度复盘机制正式运行",
                "各负责人在季度末提交复盘，结论纳入下季度 OKR。", null);
        // 派发任务补齐
        saveHighlightIfAbsent("h-d5", "dispatch", "", 5, "双十一活动文案终审", "", "t10");
        saveHighlightIfAbsent("h-d6", "dispatch", "", 6, "App 性能优化方案评审", "", "t12");
        saveHighlightIfAbsent("h-d7", "dispatch", "", 7, "各部门招聘需求汇总", "", "t15");
        // 个人事项：为管理者与骨干补齐
        saveHighlightIfAbsent("h-p4", "personal", "manager", 1, "本周需求优先级确认", "", "t2");
        saveHighlightIfAbsent("h-p5", "personal", "manager", 2, "周例会材料准备", "", "t5");
        saveHighlightIfAbsent("h-p6", "personal", "manager", 3, "季度 OKR 复盘推进", "", "t17");
        saveHighlightIfAbsent("h-p7", "personal", "zhou", 1, "任务模块测试清单", "", "t6");
        saveHighlightIfAbsent("h-p8", "personal", "zhou", 2, "移动端交互原型检查", "", "t3");
        saveHighlightIfAbsent("h-p9", "personal", "chen", 1, "用户反馈整理", "", "t20");
        saveHighlightIfAbsent("h-p10", "personal", "chen", 2, "月度数据报表", "", "t28");
    }

    private void seedLogComments() {
        if (logCommentRepository.count() > 0) return;
        // 部门负责人给下属日志写评语：产品设计部、市场运营部各一条
        List<WorkLog> logs = workLogRepository.findAll();
        String[][] pairings = {
                {"lin", "manager", "方案框架清楚，报价部分记得同步财务口径。"},
                {"chen", "zhao", "活动节奏可以再压一天，把预热和正式投放错开。"},
                {"zhou", "manager", "原型标注补齐后请发我一份，我一起看交互细节。"}
        };
        int seq = 0;
        for (String[] pairing : pairings) {
            WorkLog log = logs.stream().filter(l -> pairing[0].equals(l.getAuthorId()))
                    .max((a, b) -> a.getDate().compareTo(b.getDate())).orElse(null);
            if (log == null) continue;
            LogComment comment = new LogComment();
            comment.setId("lcomment-seed-" + (seq++));
            comment.setLogId(log.getId());
            comment.setAuthorId(pairing[1]);
            comment.setContent(pairing[2]);
            logCommentRepository.save(comment);
        }
    }

    /** 生成近几天的操作流水，让管理端「系统日志」首次打开就有内容。 */
    private void seedOperationTrail() {
        if (operationLogRepository.count() > 0) return;
        LocalDateTime now = LocalDateTime.now();
        List<OperationLog> trail = new ArrayList<>();
        // 用已有日志与任务反推操作记录
        for (WorkLog log : workLogRepository.findAll()) {
            if (trail.size() >= 26) break;
            trail.add(operation(log.getAuthorId(), "写工作日志", log.getTitle(), "记录当天工作与待办", log.getDate().atTime(18, 10)));
        }
        for (LogComment comment : logCommentRepository.findAll()) {
            WorkLog log = workLogRepository.findById(comment.getLogId()).orElse(null);
            String target = log == null ? comment.getLogId() : log.getTitle();
            trail.add(operation(comment.getAuthorId(), "评价日志", target, comment.getContent(), now.minusHours(3)));
        }
        String[][] taskOps = {
                {"lin", "记录任务进展", "完成客户方案初稿", "补充报价说明与付款条款，等待客户确认"},
                {"manager", "通过任务申请", "产品设计规范文档更新", "审核通过，同意进入执行"},
                {"zhou", "完成任务", "任务模块测试清单", "任务已标记为已完成"},
                {"chen", "提交任务申请", "市场活动文案撰写", "申请延长一天，等客户确认文案方向"},
                {"zhang", "记录任务进展", "App 性能优化方案", "完成首屏资源分析，下周给出优化方案"}
        };
        for (String[] row : taskOps) {
            trail.add(operation(row[0], row[1], row[2], row[3], now.minusHours(6)));
        }
        for (String who : new String[]{"lin", "manager", "zhou", "chen", "zhang"}) {
            trail.add(operation(who, "登录", "工作台", "登录潘多拉工作台", now.minusMinutes(40)));
        }
        operationLogRepository.saveAll(trail);
    }

    private OperationLog operation(String actorId, String action, String target, String summary, LocalDateTime at) {
        OperationLog log = new OperationLog();
        log.setAt(at);
        log.setActorId(actorId);
        log.setActorName(userRepository.findById(actorId).map(User::getName).orElse(actorId));
        log.setAction(action);
        log.setTarget(target);
        log.setSummary(summary);
        return log;
    }

    /** 每个标签有自己的颜色；只有没选标签的任务用浅色。 */
    private static final java.util.Map<String, String> TAG_COLORS = java.util.Map.of(
            "urgent", "#e74c3c", "important", "#e67e22", "routine", "#3498db", "meeting", "#9b59b6",
            "design", "#1abc9c", "dev", "#2ecc71", "review", "#f39c12", "training", "#e91e63",
            "admin", "#7f8c8d", "research", "#34495e");

    private void seedTags() {
        String[][] preset = {
            {"urgent", "紧急重要", "需要立即处理的紧急任务"},
            {"important", "重要", "对业务有关键影响的工作"},
            {"routine", "日常例行", "常规性日常工作"},
            {"meeting", "会议", "各类会议安排与准备"},
            {"design", "设计", "UI/UX 设计相关工作"},
            {"dev", "开发", "技术开发与编码任务"},
            {"review", "评审", "方案、代码、设计评审"},
            {"training", "培训学习", "培训课程与学习计划"},
            {"admin", "行政事务", "行政管理类工作"},
            {"research", "调研分析", "市场调研与数据分析"}
        };
        for (String[] row : preset) {
            com.pandora.server.model.Tag tag = new com.pandora.server.model.Tag();
            tag.setId(row[0]);
            tag.setName(row[1]);
            tag.setColor(TAG_COLORS.get(row[0]));
            tag.setDescription(row[2]);
            tagRepository.save(tag);
        }
    }

    /** 只补齐缺失颜色，保留管理员或创始人保存的自定义配色。 */
    private void seedTagColors() {
        for (com.pandora.server.model.Tag tag : tagRepository.findAll()) {
            String color = TAG_COLORS.get(tag.getId());
            if (color == null) continue;
            String current = tag.getColor() == null ? "" : tag.getColor().toLowerCase();
            if (current.isEmpty()) {
                tag.setColor(color);
                tagRepository.save(tag);
            }
        }
    }

    private String pickTagId(String title) {
        String lower = title.toLowerCase();
        if (lower.contains("紧急") || lower.contains("客户方案") || lower.contains("完成")) return "urgent";
        if (lower.contains("重要") || lower.contains("方案") || lower.contains("核心")) return "important";
        if (lower.contains("会议") || lower.contains("例会") || lower.contains("总结") || lower.contains("评审")) return "meeting";
        if (lower.contains("设计") || lower.contains("原型") || lower.contains("视觉") || lower.contains("组件")) return "design";
        if (lower.contains("开发") || lower.contains("接口") || lower.contains("性能") || lower.contains("安全") || lower.contains("服务器")) return "dev";
        if (lower.contains("评审") || lower.contains("检查") || lower.contains("测试")) return "review";
        if (lower.contains("培训") || lower.contains("入职") || lower.contains("学习")) return "training";
        if (lower.contains("招聘") || lower.contains("团建") || lower.contains("行政")) return "admin";
        if (lower.contains("调研") || lower.contains("数据") || lower.contains("分析") || lower.contains("访谈")) return "research";
        return "routine";
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
        // 初始演示任务放在一个半月前，避免和「每天 3—4 项」的当月计划挤在同一天。
        String today = LocalDate.now().minusDays(45).toString();
        LocalDateTime at = LocalDate.now().minusDays(45).atTime(10, 0);
        // 基本任务: id, 标题, 负责人, 优先级, 截止偏移天数, 状态, 详情, 创建者
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
            t.setTagId(pickTagId(r[1]));
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

        // 跨多天的连续任务（startAt 早于 dueAt），用于日历视图展示连续任务条
        // startAt偏移, dueAt偏移, 负责人, 优先级, 状态
        Object[][] spanningRows = {
            {"s1", "年度产品规划制定", "manager,lin,zhou", "HIGH", -3, 5, "DOING", "manager"},
            {"s2", "新版UI组件库重构", "wang,liu", "HIGH", -5, 4, "DOING", "manager"},
            {"s3", "市场推广活动筹备", "chen,sun,zhao", "MEDIUM", -7, 10, "DOING", "founder"},
            {"s4", "技术架构升级评估", "li,zhang,huang", "HIGH", -2, 7, "DOING", "founder"},
            {"s5", "人才招聘专项行动", "wu,zhou2", "MEDIUM", -10, 15, "DOING", "founder"},
            {"s6", "年终客户回访季", "zhao,sun,chen", "HIGH", -15, 5, "DONE", "founder"},
            {"s7", "App 3.0 版本迭代", "manager,lin,zhou,zhang", "HIGH", -1, 14, "DOING", "founder"},
            {"s8", "安全合规整改", "li,zhang", "MEDIUM", -3, 3, "DOING", "li"},
            {"s9", "团队年终总结与规划", "manager,li,wu,zhao", "MEDIUM", -2, 8, "TODO", "founder"},
            {"s10", "春节前系统巡检", "zhang,yang", "LOW", 3, 12, "TODO", "li"},
            {"s11", "商务洽谈跟进", "zhao", "HIGH", -1, 4, "DOING", "founder"},
            {"s12", "新产品市场调研", "chen,sun", "MEDIUM", -4, 6, "DOING", "zhao"}
        };
        for (Object[] r : spanningRows) {
            Task t = new Task();
            t.setId((String) r[0]);
            t.setTitle((String) r[1]);
            String[] ownerIds = ((String) r[2]).split(",");
            t.setPriority(Task.Priority.valueOf((String) r[3]));
            long startOffset = ((Number) r[4]).longValue();
            long dueOffset = ((Number) r[5]).longValue();
            t.setStartAt(LocalDateTime.parse(today + "T09:00").plusDays(startOffset));
            t.setDueAt(LocalDateTime.parse(today + "T18:30").plusDays(dueOffset));
            t.setStatus(Task.Status.valueOf((String) r[6]));
            String creatorId = (String) r[7];
            t.setDetail("跨多天任务，在日历视图中以连续色条展示。");
            t.setCreatorId(creatorId);
            t.setRevision(1);
            t.setDeleted(false);
            t.setCreatedAt(at);
            t.setOwners(new ArrayList<>());
            taskRepository.save(t);

            for (String oid : ownerIds) {
                taskOwnerRepository.save(new TaskOwner(t, userRepository.findById(oid.trim()).orElseThrow()));
            }

            TaskHistory h1 = new TaskHistory();
            h1.setTask(t);
            h1.setAt(at);
            h1.setActorId("founder");
            h1.setText("演示跨多天任务已审核通过");
            taskHistoryRepository.save(h1);

            if (t.getStatus() == Task.Status.DOING) {
                TaskHistory h2 = new TaskHistory();
                h2.setTask(t);
                h2.setAt(at);
                h2.setActorId(ownerIds[0].trim());
                h2.setText("工作进展：按计划推进中。");
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
                LocalDate day = LocalDate.now().minusDays(i);
                if (!DemoActivitySeeder.shouldSubmit(author[0], day)) continue;
                WorkLog log = new WorkLog();
                log.setDemo(false);
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
