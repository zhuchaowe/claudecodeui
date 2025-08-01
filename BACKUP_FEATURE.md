# Claude Code UI 项目备份功能

## 概述
该功能实现了自动备份和恢复用户的 Claude 项目会话数据，防止因意外删除或系统重启导致的项目丢失。

## 配置
在 `.env` 文件中配置备份目录：
```
BACKUP_DIR=/home/claude/projects/.claudecode_backup
```

## 备份机制

### 1. 自动备份触发时机
- **服务启动时**：为所有用户执行初始备份
- **用户连接时**（页面刷新）：当 WebSocket 连接建立时
- **会话结束时**：每次 Claude CLI 会话完成后
- **手动触发**：通过 API 端点 `/api/projects/backup`

### 2. 备份位置
- 原始数据：`~/.claude/projects/{project-name}/`
- 备份数据：`/home/claude/projects/.claudecode_backup/{username}/{project-name}/`

### 3. 恢复机制
- 在加载项目列表前自动检查并恢复丢失的项目
- 比较备份目录和会话目录，自动恢复缺失的项目

## 实现细节

### 核心函数
1. **backupProject(username, projectName)** - 备份单个项目
2. **restoreProject(username, projectName)** - 恢复单个项目
3. **backupAllUserProjects(username)** - 备份用户的所有项目
4. **checkAndRestoreMissingProjects(username)** - 检查并恢复丢失的项目

### 集成点
1. **server/index.js**
   - 服务启动时的初始备份
   - WebSocket 连接时的备份/恢复
   - 手动备份 API 端点

2. **server/claude-cli.js**
   - 会话结束后的自动备份

3. **server/projects.js**
   - 删除项目时同时删除备份

## 使用说明

### 自动功能
- 无需用户干预，系统会自动进行备份和恢复
- 每次页面刷新都会检查并恢复丢失的项目

### 手动备份
可以通过 API 手动触发备份：
```bash
curl -X POST http://localhost:3008/api/projects/backup \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 注意事项
1. 备份使用 `rsync` 进行增量同步，如果不可用会退回到 `cp` 命令
2. 删除项目时会同时删除对应的备份
3. 备份目录需要有适当的读写权限