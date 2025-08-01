import express from 'express';
import emailService from '../services/emailService.js';
import { authenticateToken } from '../middleware/auth.js';
import { db } from '../database/db.js';

const router = express.Router();

// 创建邮件设置表
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_settings (
      user_id INTEGER PRIMARY KEY,
      email TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      on_complete INTEGER DEFAULT 1,
      on_error INTEGER DEFAULT 1,
      on_long_running INTEGER DEFAULT 0,
      long_running_threshold INTEGER DEFAULT 300,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  console.log('Email settings table created/verified');
} catch (error) {
  console.error('Error creating email_settings table:', error);
}

// 获取邮件设置
router.get('/settings', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    
    const settings = db.prepare(`
      SELECT * FROM email_settings WHERE user_id = ?
    `).get(userId);
    
    // 获取邮件服务配置状态
    console.log('Email route: Getting configuration status...');
    const serviceStatus = emailService.getConfigurationStatus();
    console.log('Email route: Service status:', serviceStatus);
    
    res.json({
      settings: settings || null,
      serviceStatus
    });
  } catch (error) {
    console.error('Error fetching email settings:', error);
    res.status(500).json({ error: 'Failed to fetch email settings' });
  }
});

// 更新邮件设置
router.post('/settings', authenticateToken, express.json(), (req, res) => {
  try {
    const userId = req.user.id;
    const {
      email,
      enabled,
      onComplete,
      onError,
      onLongRunning,
      longRunningThreshold
    } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email address is required' });
    }
    
    // 检查是否已有设置
    const existing = db.prepare('SELECT * FROM email_settings WHERE user_id = ?').get(userId);
    
    if (existing) {
      // 更新现有设置
      db.prepare(`
        UPDATE email_settings 
        SET email = ?, enabled = ?, on_complete = ?, on_error = ?, 
            on_long_running = ?, long_running_threshold = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `).run(
        email,
        enabled ? 1 : 0,
        onComplete ? 1 : 0,
        onError ? 1 : 0,
        onLongRunning ? 1 : 0,
        longRunningThreshold || 300,
        userId
      );
    } else {
      // 创建新设置
      db.prepare(`
        INSERT INTO email_settings (user_id, email, enabled, on_complete, on_error, on_long_running, long_running_threshold)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        email,
        enabled ? 1 : 0,
        onComplete ? 1 : 0,
        onError ? 1 : 0,
        onLongRunning ? 1 : 0,
        longRunningThreshold || 300
      );
    }
    
    const settings = db.prepare('SELECT * FROM email_settings WHERE user_id = ?').get(userId);
    res.json({ settings });
  } catch (error) {
    console.error('Error updating email settings:', error);
    res.status(500).json({ error: 'Failed to update email settings' });
  }
});

// 测试邮件发送
router.post('/test', authenticateToken, express.json(), async (req, res) => {
  try {
    const userId = req.user.id;
    
    // 获取用户邮件设置
    const settings = db.prepare('SELECT * FROM email_settings WHERE user_id = ?').get(userId);
    
    if (!settings || !settings.email) {
      return res.status(400).json({ error: 'Email not configured' });
    }
    
    // 发送测试邮件
    const result = await emailService.sendNotification({
      to: settings.email,
      subject: 'Claude Code - Test Email',
      type: 'complete',
      projectName: 'Test Project',
      message: 'This is a test email to verify that your email notification settings are working properly.',
      timestamp: new Date()
    });
    
    res.json(result);
  } catch (error) {
    console.error('Error sending test email:', error);
    res.status(500).json({ error: 'Failed to send test email' });
  }
});

// 发送邮件通知 (内部API，由WebSocket服务调用)
router.post('/notify', authenticateToken, express.json(), async (req, res) => {
  try {
    const {
      type = 'complete',
      projectName,
      sessionId,
      message
    } = req.body;
    
    // 使用认证中的用户ID
    const userId = req.user.id;
    
    // 获取用户邮件设置
    const settings = db.prepare('SELECT * FROM email_settings WHERE user_id = ?').get(userId);
    
    if (!settings || !settings.enabled || !settings.email) {
      return res.json({ success: false, reason: 'Email notifications disabled or not configured' });
    }
    
    // 检查通知类型是否启用
    const typeEnabled = {
      complete: settings.on_complete,
      error: settings.on_error,
      warning: settings.on_long_running
    };
    
    if (!typeEnabled[type]) {
      return res.json({ success: false, reason: `Notifications for type '${type}' are disabled` });
    }
    
    // 发送邮件
    const result = await emailService.sendNotification({
      to: settings.email,
      type,
      projectName,
      sessionId,
      message,
      subject: `Claude Code - ${type === 'complete' ? 'Task Completed' : type === 'error' ? 'Task Error' : 'Task Warning'}`
    });
    
    res.json(result);
  } catch (error) {
    console.error('Error sending notification email:', error);
    res.status(500).json({ error: 'Failed to send notification email' });
  }
});

// 验证SMTP配置
router.post('/verify', authenticateToken, async (req, res) => {
  try {
    const result = await emailService.verifyConfiguration();
    res.json(result);
  } catch (error) {
    console.error('Error verifying email configuration:', error);
    res.status(500).json({ error: 'Failed to verify email configuration' });
  }
});

export default router;