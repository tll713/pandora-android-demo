# 潘多拉智能掌上工作系统

面向中小企业的任务协作与工作日志系统。按甲方诉求实现「全员 App 端 + 管理员 Web 端 + 统一后端」的全栈架构：员工在 App 上处理任务、记录进展、写每日日志；管理员在 Web 端管理账号、维护公司事项、派发任务、审核变更。

## 系统架构

```
┌──────────────┐   ┌──────────────┐
│   App 端      │   │  Web 管理端   │
│ (安卓 WebView │   │  (原生 JS，   │
│  /浏览器预览)  │   │  由后端托管)  │
└──────┬───────┘   └──────┬───────┘
       │   HTTP + JWT     │
       └────────┬─────────┘
        ┌───────▼────────┐
        │  Spring Boot    │
        │  后端 (8080)    │
        └───────┬────────┘
        ┌───────▼────────┐
        │   MySQL (pandora)│
        └────────────────┘
```

- `server/`：后端服务。Java 21、Spring Boot 3.3、Spring Security + JWT 登录鉴权、Spring Data JPA、MySQL 8。
- `web-admin/`：Web 管理端，原生 HTML/CSS/JS，由 Spring Boot 静态托管，与后端同端口（8080）。
- `pandora-app/`：App 端，原生 HTML/CSS/JS 页面 + 安卓 WebView 外壳；也可直接在浏览器预览调试。

## 核心功能

- 任务支持多个负责人，截止时间精确到分钟。
- 任务详情记录文字进展（不做百分比进度），任务完成无需审核。
- 任务的创建、编辑、删除需提交申请，由具备审核权限的角色审核通过后生效；不能审核自己的申请，驳回必须填写原因。
- 每人每天一篇综合工作日志，仅本人当天可修改；每次修改保留旧版本，历史日志只读。
- 月、周、日工作视图，展示任务与日志分布。
- Web 管理端：账号管理、任务派发、变更审核、日志查看、公告维护、数据统计。

## 演示账号

首次启动后端时自动写入种子数据，演示账号密码与账号相同：

| 账号 | 姓名 | 角色 | 部门 |
| --- | --- | --- | --- |
| `admin` | 系统管理员 | 管理员 | 管理中心 |
| `founder` | 许文清 | 创始人 | 管理中心 |
| `manager` | 沈知夏 | 部门经理 | 产品设计部 |
| `zhou` | 周一鸣 | 团队长 | 产品设计部 |
| `lin` | 林予安 | 员工 | 产品设计部 |
| `chen` | 陈嘉宁 | 员工 | 市场运营部 |

## 本地运行

环境要求：JDK 21、Node.js 20+、MySQL 8（本地 root 密码见团队内部记录）。Windows PowerShell 下 npm 命令请使用 `npm.cmd`。

### 1. 准备数据库

用 root 登录 MySQL 执行：

```sql
CREATE DATABASE pandora DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'pandora_app'@'localhost' IDENTIFIED BY 'pandora_dev_2026';
GRANT ALL PRIVILEGES ON pandora.* TO 'pandora_app'@'localhost';
FLUSH PRIVILEGES;
```

表结构由后端启动时按 `server/src/main/resources/schema.sql` 自动创建，空库首次启动自动写入演示数据。

### 2. 启动后端（端口 8080）

```powershell
cd server
.\mvnw.cmd spring-boot:run
```

启动后即可访问：

- Web 管理端：`http://127.0.0.1:8080`
- 接口前缀：`http://127.0.0.1:8080/api`

### 3. 浏览器预览 App 端（端口 5173）

```powershell
cd pandora-app
npm.cmd start
```

访问 `http://127.0.0.1:5173`，用演示账号登录。日常修改 `pandora-app/src/` 代码后刷新页面即可验证，无需打包。

### 4. 运行测试

```powershell
cd pandora-app
npm.cmd test
npm.cmd run check
```

### 5. 打包安卓 APK

```powershell
cd pandora-app
npm.cmd run build:android
```

构建脚本使用独立缓存的 Android 35 平台与构建工具，首次构建自动下载，无需安装 Android Studio 或 Gradle。

真机运行时，App 通过 `pandora-app/android/src/com/pandora/demo/MainActivity.java` 中的 `API_BASE` 连接后端：模拟器默认 `http://10.0.2.2:8080/api`；真机需改为电脑在局域网中的 IP（如 `http://192.168.x.x:8080/api`），并保证手机与电脑在同一网络、后端已启动。

## 接口概览

所有业务接口位于 `/api` 下，除登录外均需 `Authorization: Bearer <token>`。

| 接口 | 说明 |
| --- | --- |
| `POST /api/auth/login`、`GET /api/auth/me` | 登录、当前用户 |
| `GET /api/workspace` | 工作区聚合数据（任务、成员、公告等） |
| `POST /api/tasks/requests` | 提交任务创建／编辑／删除申请 |
| `POST /api/tasks/requests/{id}/review` | 审核变更申请 |
| `POST /api/tasks/{id}/progress` | 记录任务文字进展 |
| `POST /api/tasks/{id}/complete` | 标记任务完成（免审核） |
| `POST /api/tasks/{id}/pin` | 置顶／取消置顶任务 |
| `POST /api/logs`、`GET /api/logs/history` | 保存当日日志、查询历史日志 |
| `GET /api/announcements` | 公告列表 |
| `GET/POST /api/admin/users` | 账号查询与创建 |
| `GET /api/admin/tasks`、`/admin/requests`、`/admin/logs`、`/admin/stats` | 管理端查询与统计 |
| `POST/DELETE /api/admin/announcements` | 公告维护 |

数据库共 9 张表：`users`、`tasks`、`task_owners`、`task_history`、`change_requests`、`work_logs`、`log_versions`、`announcements`、`pins`，定义见 `server/src/main/resources/schema.sql`。

## 项目结构

```
├── server/            后端：Spring Boot 应用（controller/service/model/repository/config）
├── web-admin/         Web 管理端：index.html + app.js + style.css
├── pandora-app/       App 端
│   ├── src/           页面与业务逻辑（app.js、domain.js、样式）
│   ├── android/       安卓 WebView 外壳源码
│   ├── scripts/       安卓构建脚本 build_android.py
│   ├── tests/         业务规则测试与浏览器操作检查
│   └── deliverables/  安装演示说明与验证记录
└── 潘多拉智能掌上工作系统PDR需求评审稿.docx   需求评审稿（甲方诉求对照）
```

## 当前边界

- 一期按甲方核心诉求交付任务—审核—日志闭环，未接入 AI 功能。
- 变更审核目前为单层「另一位具备审核权限的角色审核」，逐级会签待甲方确认组织层级后扩展。
- 账号密码为演示口令，JWT 密钥写在 `application.properties`，正式部署需改为环境变量并启用强密码策略。
- 安卓包为演示签名，正式发布需替换为受保护的发布签名。
- 后端配置默认本机 MySQL（localhost:3306），多环境部署需按环境调整 `application.properties`。
