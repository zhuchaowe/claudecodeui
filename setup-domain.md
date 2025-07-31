# Domain Setup Instructions for claudecode-dev.gbase.ai

## Prerequisites
1. Domain DNS A record pointing to your server IP
2. Nginx installed on the server
3. (Optional) SSL certificate for HTTPS

## Setup Steps

### 1. Copy Nginx Configuration

```bash
# For HTTP only (start here)
sudo cp /home/claude/claudecodeui/nginx-claudecode-dev-http.conf /etc/nginx/sites-available/claudecode-dev.gbase.ai

# Enable the site
sudo ln -s /etc/nginx/sites-available/claudecode-dev.gbase.ai /etc/nginx/sites-enabled/

# Test nginx configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

### 2. Update Environment Configuration

```bash
# Copy the production environment file
cp /home/claude/claudecodeui/.env.production /home/claude/claudecodeui/.env

# Edit the .env file and update:
# - GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET with your values
# - FRONTEND_URL=https://claudecode-dev.gbase.ai
nano /home/claude/claudecodeui/.env
```

### 3. Update GitHub OAuth App

Go to https://github.com/settings/developers and update your OAuth App:
- Homepage URL: `https://claudecode-dev.gbase.ai`
- Authorization callback URL: `https://claudecode-dev.gbase.ai/api/github/callback`

### 4. Start the Application

```bash
cd /home/claude/claudecodeui

# Install dependencies if not already done
npm install

# Build the frontend for production
npm run build

# Start the backend server
npm start

# Or use PM2 for process management
npm install -g pm2
pm2 start server/index.js --name claudecode-api
pm2 save
pm2 startup
```

### 5. Setup SSL Certificate (Recommended)

```bash
# Install certbot
sudo apt update
sudo apt install certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d claudecode-dev.gbase.ai

# After successful SSL setup, switch to HTTPS nginx config
sudo cp /home/claude/claudecodeui/nginx-claudecode-dev.conf /etc/nginx/sites-available/claudecode-dev.gbase.ai
sudo nginx -t
sudo systemctl reload nginx
```

### 6. For Production Deployment

Update the nginx configuration to serve built files instead of proxying to Vite:

1. Build the frontend:
   ```bash
   npm run build
   ```

2. Edit `/etc/nginx/sites-available/claudecode-dev.gbase.ai` and update the location / block:
   ```nginx
   location / {
       root /home/claude/claudecodeui/dist;
       try_files $uri $uri/ /index.html;
   }
   ```

3. Reload nginx:
   ```bash
   sudo systemctl reload nginx
   ```

## Verification

1. Check if the domain resolves: `nslookup claudecode-dev.gbase.ai`
2. Test HTTP access: `curl http://claudecode-dev.gbase.ai`
3. Check nginx logs: `sudo tail -f /var/log/nginx/claudecode-dev.error.log`
4. Check application logs: `pm2 logs claudecode-api`

## Troubleshooting

- **502 Bad Gateway**: Check if the backend server is running on port 3008
- **GitHub OAuth errors**: Verify the callback URL matches exactly in both GitHub and .env
- **WebSocket issues**: Ensure nginx is properly configured for WebSocket upgrade