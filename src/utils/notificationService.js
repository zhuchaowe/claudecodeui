/**
 * Notification Service - 处理浏览器通知、声音提醒、页面标题提醒和Toast视觉提醒
 */

class NotificationService {
  constructor() {
    this.audioContext = null;
    this.notificationSound = null;
    this.originalTitle = '';
    this.titleBlinking = false;
    this.titleBlinkInterval = null;
    this.notificationPermission = 'default';
    this.toastCallbacks = new Set();
    
    // 初始化
    this.init();
  }

  async init() {
    console.log('NotificationService: Initializing...');
    
    // 请求通知权限
    await this.requestNotificationPermission();
    
    // 初始化音频上下文
    this.initAudioContext();
    
    // 监听页面可见性变化
    this.initVisibilityListener();
    
    console.log('NotificationService: Initialized successfully', {
      notificationPermission: this.notificationPermission,
      audioContext: !!this.audioContext
    });
  }

  /**
   * 请求浏览器通知权限
   */
  async requestNotificationPermission() {
    if ('Notification' in window) {
      this.notificationPermission = await Notification.requestPermission();
    }
  }

  /**
   * 初始化音频上下文
   */
  initAudioContext() {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (error) {
      console.warn('Audio context not supported:', error);
    }
  }

  /**
   * 初始化页面可见性监听器
   */
  initVisibilityListener() {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.titleBlinking) {
        this.stopTitleBlinking();
      }
    });
  }

  /**
   * 显示浏览器通知
   */
  showBrowserNotification(title, options = {}) {
    if ('Notification' in window && this.notificationPermission === 'granted') {
      const notification = new Notification(title, {
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: 'claude-response',
        requireInteraction: false,
        ...options
      });

      // 自动关闭通知
      setTimeout(() => {
        notification.close();
      }, 5000);

      // 点击通知时聚焦到窗口
      notification.onclick = () => {
        window.focus();
        notification.close();
      };

      return notification;
    }
    return null;
  }

  /**
   * 播放通知声音
   */
  async playNotificationSound() {
    console.log('NotificationService: Attempting to play sound');
    
    if (!this.audioContext) {
      console.warn('NotificationService: No audio context available');
      return;
    }

    try {
      // 确保音频上下文是运行状态
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      // 创建简单的提示音
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      // 配置音频参数
      oscillator.frequency.setValueAtTime(800, this.audioContext.currentTime);
      oscillator.frequency.setValueAtTime(600, this.audioContext.currentTime + 0.1);
      
      gainNode.gain.setValueAtTime(0.3, this.audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.3);

      oscillator.start(this.audioContext.currentTime);
      oscillator.stop(this.audioContext.currentTime + 0.3);
      
      console.log('NotificationService: Sound played successfully');
    } catch (error) {
      console.warn('Failed to play notification sound:', error);
    }
  }

  /**
   * 开始页面标题闪烁提醒
   */
  startTitleBlinking(message = '💬 Claude responded') {
    if (this.titleBlinking) return;
    
    // 保存当前的标题
    if (!this.originalTitle) {
      this.originalTitle = document.title;
    }
    
    console.log('NotificationService: Starting title blinking', {
      originalTitle: this.originalTitle,
      message
    });
    
    this.titleBlinking = true;
    let showOriginal = false;

    this.titleBlinkInterval = setInterval(() => {
      document.title = showOriginal ? this.originalTitle : message;
      showOriginal = !showOriginal;
    }, 1000);
  }

  /**
   * 停止页面标题闪烁提醒
   */
  stopTitleBlinking() {
    if (this.titleBlinkInterval) {
      clearInterval(this.titleBlinkInterval);
      this.titleBlinkInterval = null;
    }
    this.titleBlinking = false;
    document.title = this.originalTitle;
  }

  /**
   * 注册Toast显示回调
   */
  registerToastCallback(callback) {
    this.toastCallbacks.add(callback);
    return () => this.toastCallbacks.delete(callback);
  }

  /**
   * 显示Toast通知
   */
  showToast(message, type = 'info', duration = 4000) {
    const toast = {
      id: Date.now() + Math.random(),
      message,
      type,
      duration,
      timestamp: Date.now()
    };

    console.log('NotificationService: Showing toast', toast);
    console.log('NotificationService: Registered callbacks:', this.toastCallbacks.size);

    // 调用所有注册的Toast回调
    this.toastCallbacks.forEach(callback => {
      try {
        callback(toast);
      } catch (error) {
        console.error('Toast callback error:', error);
      }
    });

    return toast;
  }

  /**
   * 检查用户设置
   */
  getUserSettings() {
    const notificationsEnabled = localStorage.getItem('notificationsEnabled');
    const soundEnabled = localStorage.getItem('soundEnabled');
    const emailEnabled = localStorage.getItem('emailEnabled');
    
    return {
      notificationsEnabled: notificationsEnabled !== null ? JSON.parse(notificationsEnabled) : true,
      soundEnabled: soundEnabled !== null ? JSON.parse(soundEnabled) : true,
      emailEnabled: emailEnabled !== null ? JSON.parse(emailEnabled) : false
    };
  }

  /**
   * 发送邮件通知
   */
  async sendEmailNotification(options) {
    const { projectName, sessionId, message, type = 'complete' } = options;
    
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        console.log('NotificationService: No auth token, skipping email notification');
        return null;
      }
      
      const response = await fetch('/api/email/notify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          type,
          projectName,
          sessionId,
          message
        })
      });
      
      const result = await response.json();
      console.log('NotificationService: Email notification result:', result);
      return result;
    } catch (error) {
      console.error('NotificationService: Failed to send email notification:', error);
      return null;
    }
  }

  /**
   * 发送完整的通知（包含所有类型的提醒）
   */
  sendNotification(options = {}) {
    console.log('NotificationService: sendNotification called', options);
    
    const {
      title = 'Claude Code',
      message = 'Claude has completed the response',
      body,
      type = 'info',
      showBrowser = true,
      playSound = true,
      blinkTitle = true,
      showToast = true,
      sendEmail = true,
      onlyWhenHidden = true,
      projectName,
      sessionId
    } = options;

    // 获取用户设置
    const settings = this.getUserSettings();
    console.log('NotificationService: User settings', settings);
    console.log('NotificationService: Document hidden?', document.hidden);

    // 如果设置了仅在页面隐藏时通知，且页面可见，则跳过
    if (onlyWhenHidden && !document.hidden) {
      console.log('NotificationService: Skipping notification - page is visible');
      return;
    }

    const promises = [];

    // 浏览器通知（根据用户设置）
    if (showBrowser && settings.notificationsEnabled) {
      const notification = this.showBrowserNotification(title, { body: body || message });
      if (notification) {
        promises.push(Promise.resolve(notification));
      }
    }

    // 声音提醒（根据用户设置）
    if (playSound && settings.soundEnabled) {
      this.playNotificationSound();
    }

    // 页面标题闪烁（仅在页面隐藏时）
    if (blinkTitle && document.hidden) {
      this.startTitleBlinking(message);
    }

    // Toast视觉提醒（始终显示，作为主要的视觉反馈）
    if (showToast) {
      const toast = this.showToast(message, type);
      promises.push(Promise.resolve(toast));
    }

    // 邮件通知（根据用户设置）
    if (sendEmail && settings.emailEnabled) {
      const emailPromise = this.sendEmailNotification({
        projectName,
        sessionId,
        message,
        type
      });
      promises.push(emailPromise);
    }

    return Promise.all(promises);
  }

  /**
   * 清理资源
   */
  destroy() {
    this.stopTitleBlinking();
    if (this.audioContext) {
      this.audioContext.close();
    }
    this.toastCallbacks.clear();
  }
}

// 创建全局单例实例
const notificationService = new NotificationService();

export default notificationService;