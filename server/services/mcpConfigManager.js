import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { mcpServerDb } from '../database/db.js';

class McpConfigManager {
  constructor() {
    this.tempConfigDir = path.join(os.tmpdir(), 'claude-code-ui-configs');
    // 追踪活动的配置文件，防止意外删除
    this.activeConfigs = new Map(); // sessionId -> { configPath, userId, createTime }
    // 文件锁机制，防止并发读写冲突
    this.configLocks = new Map(); // configPath -> Promise
  }

  /**
   * 生成唯一的配置文件名
   */
  generateUniqueConfigName(userId, sessionId = null) {
    const timestamp = Date.now();
    const randomId = crypto.randomBytes(8).toString('hex');
    const sessionPart = sessionId ? `-session-${sessionId}` : '';
    return `claude-config-user-${userId}${sessionPart}-${timestamp}-${randomId}.json`;
  }

  /**
   * 获取文件锁，防止并发访问同一配置文件
   */
  async acquireFileLock(filePath) {
    if (this.configLocks.has(filePath)) {
      // 等待现有锁释放
      await this.configLocks.get(filePath);
    }

    let resolveLock;
    const lockPromise = new Promise(resolve => {
      resolveLock = resolve;
    });
    
    this.configLocks.set(filePath, lockPromise);
    
    return () => {
      this.configLocks.delete(filePath);
      resolveLock();
    };
  }

  /**
   * 确保临时配置目录存在
   */
  async ensureTempConfigDir() {
    try {
      await fs.mkdir(this.tempConfigDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * 安全地读取配置文件（带锁机制）
   */
  async safeReadConfig(configPath) {
    const releaseLock = await this.acquireFileLock(configPath);
    
    try {
      const configData = await fs.readFile(configPath, 'utf8');
      return JSON.parse(configData);
    } catch (error) {
      // 如果文件不存在或解析失败，返回默认配置
      return {
        numStartups: 0,
        mcpServers: {},
        projects: {}
      };
    } finally {
      releaseLock();
    }
  }

  /**
   * 安全地写入配置文件（带锁机制）
   */
  async safeWriteConfig(configPath, config) {
    const releaseLock = await this.acquireFileLock(configPath);
    
    try {
      await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
    } finally {
      releaseLock();
    }
  }

  /**
   * 获取用户的MCP服务器配置并转换为Claude CLI格式
   */
  async getUserMcpConfig(userId) {
    try {
      const userServers = await mcpServerDb.getMcpServersByUser(userId);
      const mcpServers = {};

      for (const server of userServers) {
        const config = {
          type: server.type
        };

        if (server.type === 'stdio') {
          config.command = server.config.command;
          if (server.config.args && server.config.args.length > 0) {
            config.args = server.config.args;
          }
          if (server.config.env && Object.keys(server.config.env).length > 0) {
            config.env = server.config.env;
          }
        } else if (server.type === 'http' || server.type === 'sse') {
          config.url = server.config.url;
          if (server.config.headers && Object.keys(server.config.headers).length > 0) {
            config.headers = server.config.headers;
          }
        }

        mcpServers[server.name] = config;
      }

      return mcpServers;
    } catch (error) {
      console.error('Error getting user MCP config:', error);
      return {};
    }
  }

  /**
   * 读取现有的Claude配置文件（如果存在）
   */
  async getExistingClaudeConfig() {
    const claudeConfigPath = path.join(os.homedir(), '.claude.json');
    return await this.safeReadConfig(claudeConfigPath);
  }

  /**
   * 为用户创建临时Claude配置文件
   */
  async createUserTempConfig(userId, projectPath = null, sessionId = null) {
    await this.ensureTempConfigDir();

    try {
      // 获取用户的MCP配置
      const userMcpServers = await this.getUserMcpConfig(userId);

      // 获取现有的Claude配置作为基础
      const existingConfig = await this.getExistingClaudeConfig();

      // 创建用户专属配置
      const userConfig = {
        ...existingConfig,
        mcpServers: {
          // 保留全局MCP服务器（如果有的话）
          ...existingConfig.mcpServers,
          // 添加用户专属的MCP服务器
          ...userMcpServers
        }
      };

      // 如果指定了项目路径，也添加项目特定配置
      if (projectPath && userConfig.projects && userConfig.projects[projectPath]) {
        // 合并项目特定的MCP服务器配置
        if (userConfig.projects[projectPath].mcpServers) {
          userConfig.mcpServers = {
            ...userConfig.mcpServers,
            ...userConfig.projects[projectPath].mcpServers
          };
        }
      }

      // 生成唯一的临时配置文件路径
      const configFileName = this.generateUniqueConfigName(userId, sessionId);
      const tempConfigPath = path.join(this.tempConfigDir, configFileName);

      // 安全地写入临时配置文件
      await this.safeWriteConfig(tempConfigPath, userConfig);

      // 追踪活动的配置文件
      if (sessionId) {
        this.activeConfigs.set(sessionId, {
          configPath: tempConfigPath,
          userId: userId,
          createTime: Date.now()
        });
      }

      console.log(`📝 Created temporary Claude config for user ${userId}: ${tempConfigPath}`);
      console.log(`🔧 MCP servers: ${Object.keys(userMcpServers).join(', ') || 'None'}`);

      return tempConfigPath;
    } catch (error) {
      console.error('Error creating user temp config:', error);
      throw error;
    }
  }

  /**
   * 清理临时配置文件
   */
  async cleanupTempConfig(tempConfigPath, sessionId = null) {
    try {
      if (tempConfigPath) {
        // 检查文件是否仍在使用中
        if (sessionId && this.activeConfigs.has(sessionId)) {
          const configInfo = this.activeConfigs.get(sessionId);
          if (configInfo.configPath === tempConfigPath) {
            // 从活动配置中移除
            this.activeConfigs.delete(sessionId);
          }
        }
        
        // 删除文件
        await fs.unlink(tempConfigPath);
        console.log(`🗑️ Cleaned up temp config: ${tempConfigPath}`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') { // 忽略文件不存在的错误
        console.error('Error cleaning up temp config:', error);
      }
    }
  }

  /**
   * 根据sessionId清理配置文件
   */
  async cleanupConfigBySession(sessionId) {
    if (!sessionId || !this.activeConfigs.has(sessionId)) {
      return;
    }

    const configInfo = this.activeConfigs.get(sessionId);
    await this.cleanupTempConfig(configInfo.configPath, sessionId);
  }

  /**
   * 检查配置文件是否正在被其他会话使用
   */
  isConfigInUse(configPath) {
    for (const [sessionId, configInfo] of this.activeConfigs.entries()) {
      if (configInfo.configPath === configPath) {
        return true;
      }
    }
    return false;
  }

  /**
   * 清理过期的临时配置文件（超过1小时的文件）
   */
  async cleanupExpiredTempConfigs() {
    try {
      await this.ensureTempConfigDir();
      const files = await fs.readdir(this.tempConfigDir);
      const oneHourAgo = Date.now() - (60 * 60 * 1000); // 1小时前

      for (const file of files) {
        if (file.startsWith('claude-config-user-')) {
          const filePath = path.join(this.tempConfigDir, file);
          
          // 检查是否正在使用中
          if (this.isConfigInUse(filePath)) {
            console.log(`⏳ Skipping active config file: ${file}`);
            continue;
          }
          
          try {
            const stats = await fs.stat(filePath);
            if (stats.mtime.getTime() < oneHourAgo) {
              await fs.unlink(filePath);
              console.log(`🗑️ Cleaned up expired temp config: ${file}`);
            }
          } catch (error) {
            if (error.code !== 'ENOENT') { // 忽略文件不存在的错误
              console.error(`Error checking file ${file}:`, error);
            }
          }
        }
      }
      
      // 清理过期的活动配置记录（超过2小时）
      const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
      for (const [sessionId, configInfo] of this.activeConfigs.entries()) {
        if (configInfo.createTime < twoHoursAgo) {
          console.log(`🗑️ Removing stale active config record for session: ${sessionId}`);
          this.activeConfigs.delete(sessionId);
        }
      }
    } catch (error) {
      console.error('Error cleaning up expired temp configs:', error);
    }
  }

  /**
   * 验证MCP配置格式
   */
  validateMcpConfig(config) {
    if (!config || typeof config !== 'object') {
      return false;
    }

    for (const [name, serverConfig] of Object.entries(config)) {
      if (!serverConfig.type) {
        console.warn(`MCP server ${name} missing type`);
        return false;
      }

      if (serverConfig.type === 'stdio' && !serverConfig.command) {
        console.warn(`MCP server ${name} missing command for stdio type`);
        return false;
      }

      if ((serverConfig.type === 'http' || serverConfig.type === 'sse') && !serverConfig.url) {
        console.warn(`MCP server ${name} missing URL for ${serverConfig.type} type`);
        return false;
      }
    }

    return true;
  }
}

// 创建单例实例
const mcpConfigManager = new McpConfigManager();

// 设置定期清理任务（每小时运行一次）
setInterval(() => {
  mcpConfigManager.cleanupExpiredTempConfigs().catch(error => {
    console.error('Error in periodic cleanup:', error);
  });
}, 60 * 60 * 1000); // 1小时

export default mcpConfigManager;