CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(30) PRIMARY KEY,
  name VARCHAR(30) NOT NULL,
  phone VARCHAR(20),
  gender VARCHAR(8),
  id_number VARCHAR(18),
  department VARCHAR(40) NOT NULL,
  role ENUM('ADMIN','FOUNDER','DEPT_MANAGER','TEAM_LEAD','EMPLOYEE') NOT NULL,
  avatar VARCHAR(10),
  avatar_data LONGTEXT,
  color VARCHAR(10),
  password_hash VARCHAR(100) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  auth_version BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tasks (
  id VARCHAR(60) PRIMARY KEY,
  title VARCHAR(80) NOT NULL,
  detail TEXT,
  priority ENUM('HIGH','MEDIUM','LOW') NOT NULL,
  start_at DATETIME,
  due_at DATETIME NOT NULL,
  status ENUM('TODO','DOING','DONE') NOT NULL DEFAULT 'TODO',
  creator_id VARCHAR(30) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  revision INT NOT NULL DEFAULT 1,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  FOREIGN KEY (creator_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS task_owners (
  task_id VARCHAR(60) NOT NULL,
  user_id VARCHAR(30) NOT NULL,
  PRIMARY KEY (task_id, user_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS task_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  task_id VARCHAR(60) NOT NULL,
  at DATETIME NOT NULL,
  actor_id VARCHAR(30) NOT NULL,
  text VARCHAR(1200) NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS change_requests (
  id VARCHAR(60) PRIMARY KEY,
  kind ENUM('CREATE','EDIT','DELETE') NOT NULL,
  task_id VARCHAR(60) NOT NULL,
  proposer_id VARCHAR(30) NOT NULL,
  status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  after_json LONGTEXT,
  before_json LONGTEXT,
  expected_revision INT,
  reason VARCHAR(500),
  reviewer_id VARCHAR(30),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME,
  FOREIGN KEY (proposer_id) REFERENCES users(id),
  FOREIGN KEY (reviewer_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS work_logs (
  id VARCHAR(60) PRIMARY KEY,
  author_id VARCHAR(30) NOT NULL,
  date DATE NOT NULL,
  title VARCHAR(80) NOT NULL,
  content TEXT NOT NULL,
  task_id VARCHAR(60),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_log_author_date (author_id, date),
  FOREIGN KEY (author_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS log_versions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  log_id VARCHAR(60) NOT NULL,
  title VARCHAR(80) NOT NULL,
  content TEXT NOT NULL,
  task_id VARCHAR(60),
  at DATETIME NOT NULL,
  actor_id VARCHAR(30) NOT NULL,
  FOREIGN KEY (log_id) REFERENCES work_logs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS announcements (
  id VARCHAR(60) PRIMARY KEY,
  title VARCHAR(120) NOT NULL,
  content TEXT NOT NULL,
  category VARCHAR(40) NOT NULL,
  date DATE NOT NULL,
  pinned BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS pins (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(30) NOT NULL,
  task_id VARCHAR(60) NOT NULL,
  UNIQUE KEY uk_pin_user_task (user_id, task_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS highlights (
  id VARCHAR(60) PRIMARY KEY,
  kind VARCHAR(16) NOT NULL,
  audience VARCHAR(30) NOT NULL DEFAULT '',
  position INT NOT NULL,
  title VARCHAR(120) NOT NULL,
  content TEXT NOT NULL,
  task_id VARCHAR(60),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uk_highlight_slot (kind, audience, position)
);

-- Upgrade existing installations without dropping business data.

SET @pandora_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'phone') = 0,
  'ALTER TABLE users ADD COLUMN phone VARCHAR(20)', 'SELECT 1');
PREPARE pandora_migration FROM @pandora_ddl;
EXECUTE pandora_migration;
DEALLOCATE PREPARE pandora_migration;

SET @pandora_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'gender') = 0,
  'ALTER TABLE users ADD COLUMN gender VARCHAR(8)', 'SELECT 1');
PREPARE pandora_migration FROM @pandora_ddl;
EXECUTE pandora_migration;
DEALLOCATE PREPARE pandora_migration;

SET @pandora_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'id_number') = 0,
  'ALTER TABLE users ADD COLUMN id_number VARCHAR(18)', 'SELECT 1');
PREPARE pandora_migration FROM @pandora_ddl;
EXECUTE pandora_migration;
DEALLOCATE PREPARE pandora_migration;

SET @pandora_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'avatar_data') = 0,
  'ALTER TABLE users ADD COLUMN avatar_data LONGTEXT', 'SELECT 1');
PREPARE pandora_migration FROM @pandora_ddl;
EXECUTE pandora_migration;
DEALLOCATE PREPARE pandora_migration;

SET @pandora_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = 'uk_users_phone') = 0,
  'CREATE UNIQUE INDEX uk_users_phone ON users(phone)', 'SELECT 1');
PREPARE pandora_migration FROM @pandora_ddl;
EXECUTE pandora_migration;
DEALLOCATE PREPARE pandora_migration;

SET @pandora_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'enabled') = 0,
  'ALTER TABLE users ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT TRUE', 'SELECT 1');
PREPARE pandora_migration FROM @pandora_ddl;
EXECUTE pandora_migration;
DEALLOCATE PREPARE pandora_migration;

SET @pandora_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'auth_version') = 0,
  'ALTER TABLE users ADD COLUMN auth_version BIGINT NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE pandora_migration FROM @pandora_ddl;
EXECUTE pandora_migration;
DEALLOCATE PREPARE pandora_migration;

SET @pandora_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'announcements' AND column_name = 'pinned') = 0,
  'ALTER TABLE announcements ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT FALSE', 'SELECT 1');
PREPARE pandora_migration FROM @pandora_ddl;
EXECUTE pandora_migration;
DEALLOCATE PREPARE pandora_migration;


-- Explicit task intervals; existing tasks keep their original single due-date display.
SET @pandora_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'tasks' AND column_name = 'start_at') = 0,
  'ALTER TABLE tasks ADD COLUMN start_at DATETIME', 'SELECT 1');
PREPARE pandora_migration FROM @pandora_ddl;
EXECUTE pandora_migration;
DEALLOCATE PREPARE pandora_migration;
