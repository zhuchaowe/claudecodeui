import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

/**
 * Nginx Manager Service
 * Handles dynamic subdomain configuration and reverse proxy setup for deployments
 */

class NginxManager {
  constructor() {
    this.configTemplate = this.getDefaultConfigTemplate();
  }

  /**
   * Generate Nginx configuration for a deployment
   */
  generateNginxConfig(deploymentConfig) {
    const {
      subdomain,
      baseDomain,
      port,
      containerName,
      sslEnabled = true,
      additionalConfig = {}
    } = deploymentConfig;

    const fullDomain = `${subdomain}.${baseDomain}`;
    
    let config = `# Nginx configuration for ${containerName}
# Generated automatically - do not edit manually

server {
    listen 80;
    server_name ${fullDomain};
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;
    
    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied expired no-cache no-store private must-revalidate auth;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;
    
    # Rate limiting
    limit_req_zone $binary_remote_addr zone=${containerName}:10m rate=10r/s;
    limit_req zone=${containerName} burst=20 nodelay;
    
    # Main proxy location
    location / {
        proxy_pass http://localhost:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeout settings
        proxy_connect_timeout 30s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
        
        # Buffer settings
        proxy_buffering on;
        proxy_buffer_size 4k;
        proxy_buffers 8 4k;
        proxy_busy_buffers_size 8k;
    }
    
    # Health check endpoint (bypass rate limiting)
    location /health {
        limit_req off;
        proxy_pass http://localhost:${port}/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Health check specific settings
        proxy_connect_timeout 5s;
        proxy_send_timeout 5s;
        proxy_read_timeout 5s;
    }
    
    # Static assets (if any)
    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        proxy_pass http://localhost:${port};
        proxy_set_header Host $host;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    
    # Deny access to sensitive files
    location ~ /\\. {
        deny all;
        access_log off;
        log_not_found off;
    }
    
    # Custom error pages
    error_page 502 503 504 /deployment-error.html;
    location = /deployment-error.html {
        root /var/www/html/errors;
        internal;
    }
`;

    // Add SSL configuration if enabled
    if (sslEnabled) {
      config += `    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${fullDomain};
    
    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/${baseDomain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${baseDomain}/privkey.pem;
    ssl_trusted_certificate /etc/letsencrypt/live/${baseDomain}/chain.pem;
    
    # SSL Security Settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    ssl_session_tickets off;
    ssl_stapling on;
    ssl_stapling_verify on;
    
    # Security headers (HTTPS)
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;
    
    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied expired no-cache no-store private must-revalidate auth;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;
    
    # Rate limiting
    limit_req_zone $binary_remote_addr zone=${containerName}_ssl:10m rate=10r/s;
    limit_req zone=${containerName}_ssl burst=20 nodelay;
    
    # Main proxy location
    location / {
        proxy_pass http://localhost:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeout settings
        proxy_connect_timeout 30s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
        
        # Buffer settings
        proxy_buffering on;
        proxy_buffer_size 4k;
        proxy_buffers 8 4k;
        proxy_busy_buffers_size 8k;
    }
    
    # Health check endpoint
    location /health {
        limit_req off;
        proxy_pass http://localhost:${port}/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        proxy_connect_timeout 5s;
        proxy_send_timeout 5s;
        proxy_read_timeout 5s;
    }
    
    # Static assets
    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        proxy_pass http://localhost:${port};
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    
    # Deny access to sensitive files
    location ~ /\\. {
        deny all;
        access_log off;
        log_not_found off;
    }
    
    # Custom error pages
    error_page 502 503 504 /deployment-error.html;
    location = /deployment-error.html {
        root /var/www/html/errors;
        internal;
    }
`;
    }

    config += '\n}';

    // Add additional custom configuration if provided
    if (additionalConfig.extraLocations) {
      additionalConfig.extraLocations.forEach(location => {
        config += `\n    ${location}`;
      });
    }

    return config;
  }

  /**
   * Write Nginx configuration to server
   */
  async writeNginxConfig(serverConfig, deploymentConfig, nginxConfig) {
    try {
      const configFileName = `${deploymentConfig.containerName}.conf`;
      const configPath = path.join(serverConfig.nginx_config_path, configFileName);
      
      console.log(`📝 Writing Nginx config to ${configPath}`);
      
      // Write configuration via SSH
      const writeCommand = `cat > ${configPath} << 'EOF'\n${nginxConfig}\nEOF`;
      await this.executeSSHCommand(serverConfig, writeCommand);
      
      console.log(`✅ Nginx configuration written successfully`);
      return { configPath, configFileName };
    } catch (error) {
      console.error('Error writing Nginx config:', error);
      throw error;
    }
  }

  /**
   * Enable Nginx site (create symlink)
   */
  async enableSite(serverConfig, configFileName) {
    try {
      const availablePath = path.join(serverConfig.nginx_config_path, configFileName);
      const enabledPath = path.join('/etc/nginx/sites-enabled', configFileName);
      
      console.log(`🔗 Enabling Nginx site: ${configFileName}`);
      
      const symlinkCommand = `ln -sf ${availablePath} ${enabledPath}`;
      await this.executeSSHCommand(serverConfig, symlinkCommand);
      
      console.log(`✅ Nginx site enabled successfully`);
      return true;
    } catch (error) {
      console.error('Error enabling Nginx site:', error);
      throw error;
    }
  }

  /**
   * Disable Nginx site (remove symlink)
   */
  async disableSite(serverConfig, configFileName) {
    try {
      const enabledPath = path.join('/etc/nginx/sites-enabled', configFileName);
      
      console.log(`🔗 Disabling Nginx site: ${configFileName}`);
      
      const removeCommand = `rm -f ${enabledPath}`;
      await this.executeSSHCommand(serverConfig, removeCommand);
      
      console.log(`✅ Nginx site disabled successfully`);
      return true;
    } catch (error) {
      console.error('Error disabling Nginx site:', error);
      throw error;
    }
  }

  /**
   * Test Nginx configuration
   */
  async testNginxConfig(serverConfig) {
    try {
      console.log(`🧪 Testing Nginx configuration`);
      
      const testCommand = 'nginx -t';
      const result = await this.executeSSHCommand(serverConfig, testCommand);
      
      if (result.stderr && result.stderr.includes('syntax is ok')) {
        console.log(`✅ Nginx configuration test passed`);
        return { valid: true, output: result.stderr };
      } else {
        console.log(`❌ Nginx configuration test failed`);
        return { valid: false, output: result.stderr || result.stdout };
      }
    } catch (error) {
      console.error('Error testing Nginx config:', error);
      return { valid: false, error: error.message };
    }
  }

  /**
   * Reload Nginx configuration
   */
  async reloadNginx(serverConfig) {
    try {
      console.log(`🔄 Reloading Nginx configuration`);
      
      const reloadCommand = 'systemctl reload nginx';
      await this.executeSSHCommand(serverConfig, reloadCommand);
      
      console.log(`✅ Nginx reloaded successfully`);
      return true;
    } catch (error) {
      console.error('Error reloading Nginx:', error);
      throw error;
    }
  }

  /**
   * Deploy Nginx configuration (write, enable, test, reload)
   */
  async deployNginxConfig(serverConfig, deploymentConfig) {
    try {
      console.log(`🚀 Deploying Nginx configuration for ${deploymentConfig.containerName}`);
      
      // Generate configuration
      const nginxConfig = this.generateNginxConfig(deploymentConfig);
      
      // Write configuration file
      const { configFileName } = await this.writeNginxConfig(serverConfig, deploymentConfig, nginxConfig);
      
      // Enable site
      await this.enableSite(serverConfig, configFileName);
      
      // Test configuration
      const testResult = await this.testNginxConfig(serverConfig);
      if (!testResult.valid) {
        // Rollback on test failure
        await this.disableSite(serverConfig, configFileName);
        throw new Error(`Nginx configuration test failed: ${testResult.output}`);
      }
      
      // Reload Nginx
      await this.reloadNginx(serverConfig);
      
      console.log(`✅ Nginx configuration deployed successfully`);
      return {
        configFileName,
        fullDomain: `${deploymentConfig.subdomain}.${deploymentConfig.baseDomain}`,
        configValid: true
      };
    } catch (error) {
      console.error('Error deploying Nginx config:', error);
      throw error;
    }
  }

  /**
   * Remove Nginx configuration
   */
  async removeNginxConfig(serverConfig, containerName) {
    try {
      console.log(`🗑️ Removing Nginx configuration for ${containerName}`);
      
      const configFileName = `${containerName}.conf`;
      
      // Disable site first
      await this.disableSite(serverConfig, configFileName);
      
      // Remove configuration file
      const configPath = path.join(serverConfig.nginx_config_path, configFileName);
      const removeCommand = `rm -f ${configPath}`;
      await this.executeSSHCommand(serverConfig, removeCommand);
      
      // Test and reload
      const testResult = await this.testNginxConfig(serverConfig);
      if (testResult.valid) {
        await this.reloadNginx(serverConfig);
      }
      
      console.log(`✅ Nginx configuration removed successfully`);
      return true;
    } catch (error) {
      console.error('Error removing Nginx config:', error);
      throw error;
    }
  }

  /**
   * Check SSL certificate status
   */
  async checkSSLCertificate(serverConfig, domain) {
    try {
      console.log(`🔒 Checking SSL certificate status for ${domain}`);
      
      const checkCommand = `openssl x509 -in /etc/letsencrypt/live/${domain}/fullchain.pem -text -noout | grep "Not After"`;
      const result = await this.executeSSHCommand(serverConfig, checkCommand);
      
      if (result.stdout) {
        const expiryMatch = result.stdout.match(/Not After : (.+)/);
        if (expiryMatch) {
          const expiryDate = new Date(expiryMatch[1]);
          const daysUntilExpiry = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
          
          return {
            valid: true,
            expiryDate,
            daysUntilExpiry,
            needsRenewal: daysUntilExpiry < 30
          };
        }
      }
      
      return { valid: false, error: 'Certificate not found or invalid' };
    } catch (error) {
      console.error('Error checking SSL certificate:', error);
      return { valid: false, error: error.message };
    }
  }

  /**
   * Execute SSH command on server
   */
  async executeSSHCommand(serverConfig, command) {
    return new Promise((resolve, reject) => {
      const sshCommand = [
        'ssh',
        '-o', 'StrictHostKeyChecking=no',
        '-p', serverConfig.port.toString(),
        `${serverConfig.username}@${serverConfig.host}`,
        command
      ];

      const process = spawn('ssh', sshCommand.slice(1), {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr, code });
        } else {
          reject(new Error(`SSH command failed with code ${code}: ${stderr}`));
        }
      });

      process.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Get default Nginx configuration template
   */
  getDefaultConfigTemplate() {
    return {
      sslEnabled: true,
      gzipEnabled: true,
      rateLimitEnabled: true,
      securityHeaders: true,
      errorPages: true
    };
  }

  /**
   * Validate domain name format
   */
  validateDomain(domain) {
    const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    return domainRegex.test(domain);
  }

  /**
   * Generate wildcard SSL certificate command (Let's Encrypt)
   */
  generateSSLCertCommand(baseDomain) {
    return `certbot certonly --dns-cloudflare --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini -d ${baseDomain} -d *.${baseDomain} --agree-tos --non-interactive`;
  }
}

// Export singleton instance
export default new NginxManager();