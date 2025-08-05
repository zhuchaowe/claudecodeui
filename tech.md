# 多分支Docker部署管理系统技术方案

## 1. 系统概述

本系统是一个集成在Claude Code UI中的多分支Docker自动化部署管理平台，支持团队协作中不同分支的独立部署和测试。

### 核心功能
- 多分支并行部署，避免端口冲突
- GitHub Actions 和 Gitea Actions CI/CD集成
- 动态端口分配和子域名路由
- 实时部署状态监控
- Docker容器生命周期管理
- Nginx反向代理自动配置

## 2. 系统架构

### 2.1 整体架构图
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend UI   │    │   Backend API   │    │  Deploy Server  │
│                 │    │                 │    │                 │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │Deployment   │ │◄──►│ │Port Manager │ │    │ │   Docker    │ │
│ │Manager      │ │    │ │             │ │    │ │  Containers │ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
│                 │    │                 │    │                 │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │WebSocket    │ │◄──►│ │CI/CD Service│ │◄──►│ │   Nginx     │ │
│ │Status       │ │    │ │             │ │    │ │   Proxy     │ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
└─────────────────┘    └─────────────────┘    └─────────────────┘
        │                       │                       │
        └───────────────────────┼───────────────────────┘
                                │
                    ┌─────────────────┐
                    │   Git Provider  │
                    │ GitHub/Gitea    │
                    └─────────────────┘
```

### 2.2 技术栈
- **前端**: React.js + WebSocket
- **后端**: Node.js + Express + SQLite
- **容器化**: Docker + Docker Compose
- **CI/CD**: GitHub Actions + Gitea Actions
- **代理**: Nginx + SSL
- **认证**: JWT + OAuth

## 3. 核心服务模块

### 3.1 端口管理服务 (PortManager)
**文件**: `/server/services/portManager.js`

**功能**:
- 动态端口分配 (3000-4999范围)
- 端口冲突检测和解决
- 基于用户名和分支的确定性端口计算

**核心算法**:
```javascript
calculatePreferredPort(username, branch, serverId) {
    const hash = crypto.createHash('md5')
        .update(`${username}-${branch}-${serverId}`)
        .digest('hex');
    const hashNum = parseInt(hash.substring(0, 8), 16);
    return 3000 + (hashNum % 2000); // 3000-4999范围
}
```

### 3.2 容器管理服务 (ContainerManager)
**文件**: `/server/services/containerManager.js`

**功能**:
- Docker容器生命周期管理
- 动态Docker Compose配置生成
- SSH远程服务器操作
- 容器健康检查

**容器命名规则**:
```
格式: {projectName}-{username}-{branch}
示例: myapp-john-feature-auth
```

### 3.3 CI/CD统一服务 (CICDService)
**文件**: `/server/services/cicdService.js`

**功能**:
- GitHub Actions和Gitea Actions统一API
- 仓库URL解析和提供商检测
- 工作流触发和状态监控
- Webhook处理

**支持的Git提供商**:
- GitHub (github.com)
- Gitea (自托管实例)
- 可扩展支持其他Git平台

### 3.4 Nginx管理服务 (NginxManager)
**文件**: `/server/services/nginxManager.js`

**功能**:
- 动态Nginx配置生成
- SSL证书管理
- 子域名路由设置
- 健康检查端点配置

**子域名规则**:
```
格式: {branch}-{username}.{domain}
示例: feature-auth-john.dev.example.com
```

### 3.5 部署编排服务 (DeploymentOrchestrator)
**文件**: `/server/services/deploymentOrchestrator.js`

**功能**:
- 统一协调所有部署步骤
- 错误处理和回滚机制
- 部署状态管理
- WebSocket实时通知

**部署流程**:
1. 验证部署参数
2. 分配端口和资源
3. 触发CI/CD流水线
4. 监控构建状态
5. 配置Nginx代理
6. 健康检查验证
7. 更新部署状态

### 3.6 工作流生成器 (WorkflowGenerator)
**文件**: `/server/services/workflowGenerator.js`

**功能**:
- 动态CI/CD工作流文件生成
- 支持多种项目类型 (Node.js, Python, Docker)
- Dockerfile自动生成
- 部署脚本生成

## 4. 数据库设计

### 4.1 表结构
**迁移文件**: `/server/database/migrate-deployment-system.sql`

```sql
-- 部署服务器表
CREATE TABLE deployment_servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER DEFAULT 22,
    username TEXT NOT NULL,
    docker_compose_path TEXT,
    nginx_config_path TEXT,
    domain TEXT,
    max_deployments INTEGER DEFAULT 10,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 分支部署表
CREATE TABLE branch_deployments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER,
    project_name TEXT NOT NULL,
    branch_name TEXT NOT NULL,
    username TEXT NOT NULL,
    container_name TEXT NOT NULL,
    assigned_port INTEGER NOT NULL,
    subdomain TEXT,
    status TEXT DEFAULT 'pending',
    deploy_url TEXT,
    commit_hash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (server_id) REFERENCES deployment_servers (id)
);

-- 部署日志表
CREATE TABLE deployment_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deployment_id INTEGER,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (deployment_id) REFERENCES branch_deployments (id)
);

-- 端口分配表
CREATE TABLE port_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER,
    port INTEGER NOT NULL,
    deployment_id INTEGER,
    allocated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    FOREIGN KEY (server_id) REFERENCES deployment_servers (id),
    FOREIGN KEY (deployment_id) REFERENCES branch_deployments (id)
);
```

### 4.2 数据库操作封装
**文件**: `/server/database/db.js`

提供完整的CRUD操作接口:
- `deploymentDb.servers.*` - 服务器管理
- `deploymentDb.deployments.*` - 部署管理
- `deploymentDb.logs.*` - 日志管理
- `deploymentDb.ports.*` - 端口管理

## 5. API接口设计

### 5.1 REST API
**文件**: `/server/routes/deployment.js`

**主要端点**:
```
GET    /api/deployment/servers          # 获取服务器列表
POST   /api/deployment/servers          # 添加服务器
PUT    /api/deployment/servers/:id      # 更新服务器

GET    /api/deployment/branches         # 获取分支部署
POST   /api/deployment/deploy           # 创建部署
DELETE /api/deployment/:id              # 删除部署
POST   /api/deployment/:id/stop         # 停止部署
POST   /api/deployment/:id/restart      # 重启部署

GET    /api/deployment/:id/logs         # 获取部署日志
GET    /api/deployment/:id/status       # 获取部署状态
POST   /api/deployment/health-check     # 健康检查
```

### 5.2 WebSocket通信
**实时事件类型**:
- `deployment_status_update` - 部署状态更新
- `deployment_log` - 部署日志推送
- `port_allocation` - 端口分配通知
- `health_check_result` - 健康检查结果

## 6. 前端界面设计

### 6.1 部署管理组件
**文件**: `/src/components/DeploymentManager.jsx`

**功能特性**:
- 服务器选择和管理
- 分支部署列表
- 实时状态显示
- 日志查看器
- 一键部署按钮

### 6.2 侧边栏集成
**文件**: `/src/components/Sidebar.jsx`

在项目操作区域添加部署按钮(🚀图标)，点击打开部署管理弹窗。

## 7. 部署工作流

### 7.1 用户操作流程
1. **代码开发** - 在本地分支开发功能
2. **提交推送** - 提交代码并推送到远程仓库
3. **触发部署** - 在UI中点击部署按钮选择服务器
4. **自动部署** - 系统自动分配资源并触发CI/CD
5. **实时监控** - 通过WebSocket查看部署进度
6. **访问测试** - 通过生成的子域名访问部署的应用

### 7.2 系统处理流程
```
用户点击部署
    ↓
验证权限和参数
    ↓
分配端口和容器名
    ↓
生成CI/CD工作流
    ↓
触发远程构建
    ↓
监控构建状态
    ↓
配置Nginx代理
    ↓
健康检查验证
    ↓
更新数据库状态
    ↓
通知用户完成
```

## 8. 高级特性

### 8.1 资源管理
- **端口池管理**: 3000-4999端口范围，支持2000个并发部署
- **容器资源限制**: CPU和内存限制配置
- **磁盘空间监控**: 自动清理过期部署
- **并发部署限制**: 每服务器最大10个并发部署

### 8.2 安全特性
- **JWT认证**: API访问权限控制
- **SSH密钥**: 安全的服务器连接
- **端口隔离**: 每个部署独立端口
- **SSL支持**: HTTPS和WSS加密通信

### 8.3 监控和日志
- **实时日志**: WebSocket推送构建和运行日志
- **状态监控**: 容器健康检查和自动重启
- **性能指标**: 资源使用情况统计
- **错误追踪**: 详细的错误日志和堆栈

## 9. 扩展性设计

### 9.1 多云支持
- 支持多个部署服务器
- 可扩展到不同云平台
- 负载均衡和故障转移

### 9.2 插件架构
- 可插拔的CI/CD提供商
- 自定义部署脚本支持
- 第三方服务集成接口

## 10. 部署和维护

### 10.1 服务器要求
- Docker和Docker Compose
- Nginx反向代理
- Node.js运行环境
- Git客户端
- SSH服务

### 10.2 配置管理
- 环境变量配置
- 服务器连接信息
- SSL证书管理
- 域名DNS配置

## 11. 技术优势

1. **高度自动化**: 从代码提交到服务部署全自动化
2. **实时反馈**: WebSocket实时状态更新
3. **资源优化**: 智能端口分配和资源管理
4. **团队协作**: 多分支并行开发和测试
5. **统一管理**: 单一界面管理所有部署
6. **可扩展性**: 模块化设计易于扩展新功能

这个技术方案实现了一个完整的多分支Docker部署管理系统，为团队协作和持续集成提供了强大的基础设施支持。