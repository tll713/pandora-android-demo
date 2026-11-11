package com.pandora.server.config;

import com.pandora.server.model.DailyTodo;
import com.pandora.server.model.DemoActivityDay;
import com.pandora.server.model.User;
import com.pandora.server.model.WorkLog;
import com.pandora.server.repository.DailyTodoRepository;
import com.pandora.server.repository.DemoActivityDayRepository;
import com.pandora.server.repository.UserRepository;
import com.pandora.server.repository.WorkLogRepository;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/** Adds missing activity only for the named demo accounts; existing work stays untouched. */
@Component
@EnableScheduling
@ConditionalOnProperty(name = "pandora.demo-data.enabled", havingValue = "true")
public class DemoActivitySeeder {
    private static final Map<String, String> DEMO_USERS = Map.ofEntries(
            Map.entry("admin", "系统管理员"), Map.entry("founder", "许文清"),
            Map.entry("manager", "沈知夏"), Map.entry("lin", "林予安"),
            Map.entry("zhou", "周一鸣"), Map.entry("chen", "陈嘉宁"),
            Map.entry("wang", "王思琪"), Map.entry("liu", "刘建国"),
            Map.entry("zhao", "赵敏"), Map.entry("sun", "孙浩然"),
            Map.entry("li", "李婉清"), Map.entry("zhang", "张伟"),
            Map.entry("yang", "杨紫萱"), Map.entry("huang", "黄俊杰"),
            Map.entry("wu", "吴婷婷"), Map.entry("zhou2", "周明轩"));

    private static final String[][] PRODUCT = {
            {"梳理需求优先级", "整理本轮用户访谈与试用反馈，区分体验问题和功能需求，更新需求池的优先级。", "设计"},
            {"完善页面交互标注", "补充首页与任务详情的交互说明，核对空状态、加载失败和表单校验场景。", "设计"},
            {"对齐接口字段", "与研发核对任务起止时间、负责人和标签字段，整理联调问题及处理建议。", "开发"},
            {"整理设计评审意见", "汇总评审结论，标记待确认细节，更新原型及组件使用说明。", "评审"},
            {"回访产品试用反馈", "复核试用用户提出的问题，确认复现路径，补充验收标准与跟进记录。", "调研"},
            {"更新项目周报", "整理本周交付内容和待处理风险，明确下一阶段的负责人及时间安排。", "日常"}
    };
    private static final String[][] MARKET = {
            {"核对活动投放计划", "对齐本轮活动的投放渠道、素材规格与预算，记录各渠道确认结果。", "日常"},
            {"整理客户反馈", "汇总客户咨询与体验反馈，按问题类型分组并同步产品团队。", "调研"},
            {"复核宣传素材", "检查活动页面、海报和推广文案，补齐落地页的转化入口。", "评审"},
            {"分析渠道转化数据", "对比各渠道的访问、咨询和转化情况，整理后续优化建议。", "调研"},
            {"跟进合作方排期", "联系合作方确认发布节点，更新联络记录与待办清单。", "日常"},
            {"提交运营复盘", "汇总活动进展、用户反馈及下阶段计划，整理团队复盘材料。", "日常"}
    };
    private static final String[][] ENGINEERING = {
            {"处理接口联调问题", "核对请求参数和响应格式，补齐边界校验，更新接口联调记录。", "开发"},
            {"巡检服务告警", "检查服务运行状态和异常日志，复核告警规则，记录需要持续观察的问题。", "日常"},
            {"完成代码评审", "复查变更涉及的权限和数据处理逻辑，将评审意见同步给相关开发人员。", "评审"},
            {"验证移动端兼容性", "检查不同屏幕尺寸下的交互，复测登录、任务详情和日志提交流程。", "开发"},
            {"补充回归用例", "整理近期修复问题的回归范围，覆盖异常输入和接口失败恢复。", "开发"},
            {"更新发布检查清单", "整理配置变更、数据库兼容项与验证步骤，补充发布后的观察事项。", "日常"}
    };
    private static final String[][] PEOPLE = {
            {"跟进候选人面试", "确认候选人与面试官时间，整理面试反馈并更新招聘进展。", "日常"},
            {"核对入职资料", "核验待入职成员的资料清单，跟进缺失项并同步用人部门。", "日常"},
            {"准备新人培训材料", "更新岗位介绍与制度说明，协调培训安排和内部分享时间。", "培训"},
            {"确认部门人员安排", "与各部门核对人员需求，整理岗位职责与协作事项。", "日常"},
            {"整理员工沟通反馈", "归纳员工沟通中的共性问题，记录后续支持事项及负责人。", "调研"},
            {"更新人事工作周报", "汇总招聘、入职和培训安排，整理下一阶段的人力支持计划。", "日常"}
    };
    private static final String[][] MANAGEMENT = {
            {"确认部门工作排期", "核对各部门重点任务与资源安排，明确跨部门协作的时间节点。", "日常"},
            {"复核待审核申请", "检查任务变更申请的说明、责任人与起止时间，整理需要补充的信息。", "评审"},
            {"准备经营例会材料", "汇总各部门工作进展、风险和需协调事项，形成例会讨论清单。", "日常"},
            {"跟进重点客户事项", "检查重点客户项目的交付安排，记录待决策事项和后续跟进责任人。", "日常"},
            {"检查账号与权限", "核对成员账号状态和部门归属，复查权限变更记录。", "日常"},
            {"整理公司工作复盘", "汇总本阶段完成事项、延期风险和改进建议，形成下一阶段工作计划。", "日常"}
    };

    private final UserRepository users;
    private final WorkLogRepository logs;
    private final DailyTodoRepository todos;
    private final DemoActivityDayRepository initializedDays;

    public DemoActivitySeeder(UserRepository users, WorkLogRepository logs, DailyTodoRepository todos,
                              DemoActivityDayRepository initializedDays) {
        this.users = users;
        this.logs = logs;
        this.todos = todos;
        this.initializedDays = initializedDays;
    }

    @EventListener(ApplicationReadyEvent.class)
    @Scheduled(cron = "0 5 0 * * *", zone = "Asia/Shanghai")
    @Transactional
    public void topUp() {
        topUpAt(LocalDate.now(ZoneId.of("Asia/Shanghai")));
    }

    void topUpAt(LocalDate today) {
        for (User user : users.findAll()) {
            if (!user.isEnabled() || !user.getName().equals(DEMO_USERS.get(user.getId()))) continue;
            String[][] topics = topicsFor(user);
            Set<LocalDate> writtenDays = logs.findByAuthorIdAndDateBetween(user.getId(), today.minusDays(29), today)
                    .stream().map(WorkLog::getDate).collect(Collectors.toCollection(HashSet::new));
            for (int offset = 29; offset >= 0; offset--) {
                LocalDate day = today.minusDays(offset);
                if (writtenDays.contains(day)) continue;
                String id = "demo-log-" + user.getId() + "-" + day;
                if (logs.existsById(id)) continue;
                int index = Math.floorMod((int) day.toEpochDay() + user.getId().hashCode(), topics.length);
                String[] topic = topics[index];
                WorkLog log = new WorkLog();
                log.setId(id);
                log.setAuthorId(user.getId());
                log.setDate(day);
                log.setTitle(day + " " + topic[0] + "（演示）");
                log.setContent("今日完成\n" + topic[1] + "\n\n协作与待确认\n已同步相关同事，待确认项继续跟进。\n\n下一步计划\n" + topics[(index + 1) % topics.length][1]);
                log.setTaskId("");
                logs.save(log);
                writtenDays.add(day);
            }
            Map<LocalDate, List<DailyTodo>> plannedDays = todos.findByOwnerIdOrderByDateAscCreatedAtAsc(user.getId()).stream()
                    .collect(Collectors.groupingBy(DailyTodo::getDate));
            // Keep the rest of this month populated, with at least three future days at month end.
            int futureDays = Math.max(3, today.lengthOfMonth() - today.getDayOfMonth());
            for (int offset = -6; offset <= futureDays; offset++) {
                LocalDate day = today.plusDays(offset);
                String dayId = user.getId() + "-" + day;
                if (initializedDays.existsById(dayId)) continue;
                List<DailyTodo> existing = plannedDays.getOrDefault(day, List.of());
                String prefix = "demo-" + dayId + "-";
                // Migrate previously generated lists without restoring items the user removed.
                boolean alreadySeeded = existing.stream().anyMatch(item -> item.getId().startsWith(prefix));
                int missing = Math.max(0, topics.length - existing.size());
                Set<String> titles = existing.stream().map(item -> item.getTitle().trim()).collect(Collectors.toSet());
                long completed = existing.stream().filter(DailyTodo::isDone).count();
                for (int index = 0; !alreadySeeded && index < topics.length && missing > 0; index++) {
                    String title = topics[(index + day.getDayOfWeek().getValue()) % topics.length][0];
                    if (!titles.add(title)) continue;
                    DailyTodo todo = new DailyTodo();
                    todo.setId(prefix + index);
                    todo.setOwnerId(user.getId());
                    todo.setDate(day);
                    todo.setTitle(title);
                    todo.setDone(offset < 0 || offset == 0 && completed < 2);
                    if (todo.isDone()) completed++;
                    todos.save(todo);
                    missing--;
                }
                initializedDays.save(new DemoActivityDay(dayId));
            }
        }
    }

    private String[][] topicsFor(User user) {
        return switch (user.getDepartment()) {
            case "产品设计部" -> PRODUCT;
            case "市场运营部" -> MARKET;
            case "技术研发部" -> ENGINEERING;
            case "人力资源部" -> PEOPLE;
            default -> MANAGEMENT;
        };
    }
}
