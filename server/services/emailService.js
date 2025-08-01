import nodemailer from 'nodemailer';

class EmailService {
  constructor() {
    this.transporter = null;
    this.isConfigured = false;
    this.config = null;
    // 不在构造函数中初始化，等待手动调用
  }

  initializeTransporter() {
    try {
      // 在初始化时读取环境变量
      this.config = {
        smtp: {
          host: process.env.SMTP_HOST || '',
          port: parseInt(process.env.SMTP_PORT || '587'),
          secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
          auth: {
            user: process.env.SMTP_USER || '',
            pass: process.env.SMTP_PASS || ''
          }
        },
        from: process.env.SMTP_FROM || 'Claude Code <noreply@example.com>'
      };
      
      console.log('EmailService: Checking SMTP configuration...', {
        host: this.config.smtp.host,
        port: this.config.smtp.port,
        secure: this.config.smtp.secure,
        user: this.config.smtp.auth.user,
        hasPassword: !!this.config.smtp.auth.pass,
        from: this.config.from
      });
      
      // 检查是否有完整的SMTP配置
      if (this.config.smtp.host && this.config.smtp.auth.user && this.config.smtp.auth.pass) {
        this.transporter = nodemailer.createTransport(this.config.smtp);
        this.isConfigured = true;
        console.log('EmailService: SMTP transporter initialized successfully');
      } else {
        console.log('EmailService: SMTP configuration incomplete, email notifications disabled');
        console.log('EmailService: Missing:', {
          host: !this.config.smtp.host,
          user: !this.config.smtp.auth.user,
          pass: !this.config.smtp.auth.pass
        });
      }
    } catch (error) {
      console.error('EmailService: Failed to initialize transporter:', error);
      this.isConfigured = false;
    }
  }

  /**
   * 验证邮件配置
   */
  async verifyConfiguration() {
    // 确保初始化
    if (!this.config) {
      this.initializeTransporter();
    }
    
    if (!this.isConfigured || !this.transporter) {
      return { success: false, error: 'Email service not configured' };
    }

    try {
      await this.transporter.verify();
      return { success: true };
    } catch (error) {
      console.error('EmailService: Configuration verification failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 发送邮件通知
   */
  async sendNotification(options) {
    // 确保初始化
    if (!this.config) {
      this.initializeTransporter();
    }
    
    const {
      to,
      subject = 'Claude Code Notification',
      sessionId,
      projectName,
      message,
      timestamp = new Date(),
      type = 'complete' // complete, error, warning
    } = options;

    if (!this.isConfigured || !this.transporter) {
      console.log('EmailService: Cannot send email - service not configured');
      return { success: false, error: 'Email service not configured' };
    }

    if (!to) {
      return { success: false, error: 'Recipient email address is required' };
    }

    try {
      // 构建邮件内容
      const html = this.buildEmailTemplate({
        type,
        projectName,
        sessionId,
        message,
        timestamp
      });

      const mailOptions = {
        from: this.config.from,
        to,
        subject,
        html,
        text: this.buildPlainTextEmail({ type, projectName, sessionId, message, timestamp })
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log('EmailService: Email sent successfully:', info.messageId);
      
      return { 
        success: true, 
        messageId: info.messageId 
      };
    } catch (error) {
      console.error('EmailService: Failed to send email:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  /**
   * 构建HTML邮件模板
   */
  buildEmailTemplate(data) {
    const { type, projectName, sessionId, message, timestamp } = data;
    
    const typeConfig = {
      complete: {
        color: '#10b981',
        icon: '✅',
        title: 'Claude Completed Response'
      },
      error: {
        color: '#ef4444',
        icon: '❌',
        title: 'Claude Encountered Error'
      },
      warning: {
        color: '#f59e0b',
        icon: '⚠️',
        title: 'Claude Warning'
      }
    };

    const config = typeConfig[type] || typeConfig.complete;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${config.title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f5f5f5;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    .header {
      background-color: ${config.color};
      color: white;
      padding: 20px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 600;
    }
    .content {
      padding: 30px;
    }
    .info-row {
      margin-bottom: 15px;
      padding: 10px;
      background-color: #f8f9fa;
      border-radius: 5px;
    }
    .info-label {
      font-weight: 600;
      color: #666;
      display: inline-block;
      min-width: 100px;
    }
    .message-box {
      background-color: #f0f9ff;
      border: 1px solid #e0f2fe;
      border-radius: 8px;
      padding: 15px;
      margin: 20px 0;
    }
    .footer {
      background-color: #f8f9fa;
      padding: 20px;
      text-align: center;
      font-size: 14px;
      color: #666;
    }
    .icon {
      font-size: 48px;
      margin-bottom: 10px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="icon">${config.icon}</div>
      <h1>${config.title}</h1>
    </div>
    
    <div class="content">
      <p>Hello,</p>
      <p>You have a new notification from Claude Code:</p>
      
      <div class="info-row">
        <span class="info-label">Project:</span>
        <span>${projectName || 'Unknown Project'}</span>
      </div>
      
      ${sessionId ? `
      <div class="info-row">
        <span class="info-label">Session ID:</span>
        <span>${sessionId}</span>
      </div>
      ` : ''}
      
      <div class="info-row">
        <span class="info-label">Time:</span>
        <span>${timestamp.toLocaleString('en-US')}</span>
      </div>
      
      ${message ? `
      <div class="message-box">
        <strong>Message:</strong><br>
        ${message}
      </div>
      ` : ''}
      
      <p style="margin-top: 30px;">
        Please return to Claude Code to view details.
      </p>
    </div>
    
    <div class="footer">
      <p>This is an automated email, please do not reply.</p>
      <p>&copy; ${new Date().getFullYear()} Claude Code</p>
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * 构建纯文本邮件内容
   */
  buildPlainTextEmail(data) {
    const { type, projectName, sessionId, message, timestamp } = data;
    
    const typeText = {
      complete: 'Claude Completed Response',
      error: 'Claude Encountered Error',
      warning: 'Claude Warning'
    };

    const title = typeText[type] || typeText.complete;

    return `
${title}
${'='.repeat(50)}

Project: ${projectName || 'Unknown Project'}
${sessionId ? `Session ID: ${sessionId}` : ''}
Time: ${timestamp.toLocaleString('en-US')}

${message ? `Message:\n${message}\n` : ''}

Please return to Claude Code to view details.

---
This is an automated email, please do not reply.
© ${new Date().getFullYear()} Claude Code
    `.trim();
  }

  /**
   * 更新邮件配置
   */
  updateConfiguration(config) {
    if (config.smtp) {
      this.config.smtp = { ...this.config.smtp, ...config.smtp };
    }
    if (config.from) {
      this.config.from = config.from;
    }
    
    // 重新初始化transporter
    this.initializeTransporter();
    
    return this.isConfigured;
  }

  /**
   * 获取当前配置状态
   */
  getConfigurationStatus() {
    // 确保初始化
    if (!this.config) {
      this.initializeTransporter();
    }
    
    return {
      isConfigured: this.isConfigured,
      smtp: this.config ? {
        host: this.config.smtp.host,
        port: this.config.smtp.port,
        secure: this.config.smtp.secure,
        hasAuth: !!(this.config.smtp.auth.user && this.config.smtp.auth.pass)
      } : {
        host: '',
        port: 587,
        secure: false,
        hasAuth: false
      },
      from: this.config ? this.config.from : ''
    };
  }
}

// 创建单例实例
const emailService = new EmailService();

export default emailService;