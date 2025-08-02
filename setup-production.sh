#!/bin/bash

echo "=== 设置生产环境 ==="

echo "1. 安装 PM2（如果未安装）"
echo "请运行: npm install -g pm2"

echo -e "\n2. 构建前端项目"
echo "请运行: npm run build"

echo -e "\n3. 启动后端服务（使用PM2）"
echo "请运行: pm2 start ecosystem.config.js"

echo -e "\n4. 设置PM2开机自启"
echo "请运行: pm2 startup"
echo "然后运行: pm2 save"

echo -e "\n5. 配置nginx"
echo "将nginx配置链接到sites-enabled："
echo "sudo ln -sf /home/claude/claudecodeui/nginx-claudecode-prod.conf /etc/nginx/sites-enabled/claudecode"
echo "删除默认配置（如果存在）："
echo "sudo rm -f /etc/nginx/sites-enabled/default"
echo "测试nginx配置："
echo "sudo nginx -t"
echo "重新加载nginx："
echo "sudo nginx -s reload"

echo -e "\n6. 防火墙设置（如果需要）"
echo "sudo ufw allow 443/tcp"
echo "sudo ufw allow 80/tcp"

echo -e "\n=== PM2 管理命令 ==="
echo "查看进程状态: pm2 status"
echo "查看日志: pm2 logs"
echo "重启应用: pm2 restart claudecode-backend"
echo "停止应用: pm2 stop claudecode-backend"
echo "监控: pm2 monit"

echo -e "\n=== 注意事项 ==="
echo "1. 确保已经运行 'npm install' 安装所有依赖"
echo "2. 确保数据库文件有正确的权限"
echo "3. 自签名证书会在浏览器中显示安全警告，这是正常的"
echo "4. 生产环境建议使用Let's Encrypt免费证书"