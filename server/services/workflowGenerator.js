/**
 * Workflow Generator Service
 * Generates CI/CD workflow files for different Git platforms and project types
 */

class WorkflowGenerator {
  constructor() {
    this.templates = {
      github: this.getGitHubWorkflowTemplate(),
      gitea: this.getGiteaWorkflowTemplate()
    };
  }

  /**
   * Generate workflow file content based on project configuration
   */
  generateWorkflow(config) {
    const {
      provider = 'github',
      projectType = 'node',
      containerName,
      port,
      branch,
      username,
      serverConfig,
      projectPath,
      environmentVars = {},
      resourceLimits = { memory: '512m', cpus: '0.5' },
      healthCheckPath = '/health'
    } = config;

    const template = this.templates[provider];
    if (!template) {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    // Replace placeholders in the template
    let workflowContent = template
      .replace(/\{\{CONTAINER_NAME\}\}/g, containerName)
      .replace(/\{\{PORT\}\}/g, port.toString())
      .replace(/\{\{BRANCH\}\}/g, branch)
      .replace(/\{\{USERNAME\}\}/g, username)
      .replace(/\{\{SERVER_HOST\}\}/g, serverConfig.base_domain)
      .replace(/\{\{PROJECT_PATH\}\}/g, projectPath || '.')
      .replace(/\{\{MEMORY_LIMIT\}\}/g, resourceLimits.memory)
      .replace(/\{\{CPU_LIMIT\}\}/g, resourceLimits.cpus)
      .replace(/\{\{HEALTH_CHECK_PATH\}\}/g, healthCheckPath);

    // Add environment variables
    const envVarsSection = this.generateEnvironmentVariables(environmentVars);
    workflowContent = workflowContent.replace(/\{\{ENVIRONMENT_VARS\}\}/g, envVarsSection);

    // Add project-specific build steps
    const buildSteps = this.generateBuildSteps(projectType);
    workflowContent = workflowContent.replace(/\{\{BUILD_STEPS\}\}/g, buildSteps);

    return workflowContent;
  }

  /**
   * Generate environment variables section
   */
  generateEnvironmentVariables(envVars) {
    const defaultEnvVars = {
      NODE_ENV: 'production',
      PORT: '3000'
    };

    const allEnvVars = { ...defaultEnvVars, ...envVars };
    
    const envLines = Object.entries(allEnvVars).map(([key, value]) => {
      return `              - ${key}=${value}`;
    });

    return envLines.join('\n');
  }

  /**
   * Generate build steps based on project type
   */
  generateBuildSteps(projectType) {
    switch (projectType) {
      case 'node':
        return `      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build application
        run: npm run build --if-present`;

      case 'python':
        return `      - name: Setup Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.9'
          cache: 'pip'
      
      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements.txt
      
      - name: Build application
        run: python setup.py build --if-present`;

      case 'docker':
        return `      - name: Build Docker image
        run: docker build -t \${{ github.event.inputs.container_name }} .`;

      default:
        return `      - name: Build application
        run: echo "No specific build steps defined for this project type"`;
    }
  }

  /**
   * GitHub Actions workflow template
   */
  getGitHubWorkflowTemplate() {
    return `name: Deploy Branch to Dev Server
on:
  workflow_dispatch:
    inputs:
      branch:
        description: 'Branch to deploy'
        required: true
        default: '{{BRANCH}}'
      username:
        description: 'Username for deployment'
        required: true
        default: '{{USERNAME}}'
      port:
        description: 'Port for deployment'
        required: true
        default: '{{PORT}}'
      container_name:
        description: 'Container name'
        required: true
        default: '{{CONTAINER_NAME}}'

jobs:
  deploy:
    runs-on: self-hosted
    environment: development
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          ref: \${{ github.event.inputs.branch }}
      
      - name: Set deployment variables
        run: |
          echo "BRANCH=\${{ github.event.inputs.branch }}" >> $GITHUB_ENV
          echo "USERNAME=\${{ github.event.inputs.username }}" >> $GITHUB_ENV
          echo "PORT=\${{ github.event.inputs.port }}" >> $GITHUB_ENV
          echo "CONTAINER_NAME=\${{ github.event.inputs.container_name }}" >> $GITHUB_ENV
          echo "DEPLOYMENT_URL=https://\${{ github.event.inputs.container_name }}.{{SERVER_HOST}}" >> $GITHUB_ENV

{{BUILD_STEPS}}
      
      - name: Create deployment directory
        run: |
          sudo mkdir -p /opt/deployments/\${{ github.event.inputs.container_name }}
          sudo chown -R $USER:$USER /opt/deployments/\${{ github.event.inputs.container_name }}
          cp -r . /opt/deployments/\${{ github.event.inputs.container_name }}/
      
      - name: Generate Docker Compose configuration
        run: |
          cat > /opt/deployments/\${{ github.event.inputs.container_name }}/docker-compose.yml << 'EOF'
          version: '3.8'
          services:
            app:
              container_name: \${{ github.event.inputs.container_name }}
              build:
                context: .
                dockerfile: Dockerfile
              ports:
                - "\${{ github.event.inputs.port }}:3000"
              environment:
{{ENVIRONMENT_VARS}}
                - BRANCH=\${{ github.event.inputs.branch }}
                - USERNAME=\${{ github.event.inputs.username }}
                - DEPLOYMENT_URL=https://\${{ github.event.inputs.container_name }}.{{SERVER_HOST}}
              restart: unless-stopped
              networks:
                - deployment-network
              deploy:
                resources:
                  limits:
                    memory: {{MEMORY_LIMIT}}
                    cpus: '{{CPU_LIMIT}}'
              healthcheck:
                test: ["CMD", "curl", "-f", "http://localhost:3000{{HEALTH_CHECK_PATH}}"]
                interval: 30s
                timeout: 10s
                retries: 3
                start_period: 40s
          networks:
            deployment-network:
              driver: bridge
          EOF
      
      - name: Stop existing container
        run: |
          cd /opt/deployments/\${{ github.event.inputs.container_name }}
          docker-compose down --remove-orphans || echo "No existing container to stop"
      
      - name: Deploy with Docker Compose
        run: |
          cd /opt/deployments/\${{ github.event.inputs.container_name }}
          docker-compose up -d --build
      
      - name: Wait for deployment to be ready
        run: |
          echo "Waiting for deployment to be ready..."
          for i in {1..30}; do
            if curl -f -s http://localhost:\${{ github.event.inputs.port }}{{HEALTH_CHECK_PATH}} > /dev/null 2>&1; then
              echo "✅ Deployment is ready!"
              break
            fi
            echo "⏳ Attempt $i/30: Service not ready yet, waiting 10 seconds..."
            sleep 10
          done
          
          # Final health check
          if ! curl -f -s http://localhost:\${{ github.event.inputs.port }}{{HEALTH_CHECK_PATH}} > /dev/null 2>&1; then
            echo "❌ Health check failed after 5 minutes"
            exit 1
          fi
      
      - name: Configure Nginx reverse proxy
        run: |
          sudo tee /etc/nginx/sites-available/\${{ github.event.inputs.container_name }} > /dev/null << 'EOF'
          server {
              listen 80;
              server_name \${{ github.event.inputs.container_name }}.{{SERVER_HOST}};
              
              # Security headers
              add_header X-Frame-Options "SAMEORIGIN" always;
              add_header X-XSS-Protection "1; mode=block" always;
              add_header X-Content-Type-Options "nosniff" always;
              add_header Referrer-Policy "no-referrer-when-downgrade" always;
              
              # Rate limiting
              limit_req_zone \\$binary_remote_addr zone=\${{ github.event.inputs.container_name }}:10m rate=10r/s;
              limit_req zone=\${{ github.event.inputs.container_name }} burst=20 nodelay;
              
              location / {
                  proxy_pass http://localhost:\${{ github.event.inputs.port }};
                  proxy_http_version 1.1;
                  proxy_set_header Upgrade \\$http_upgrade;
                  proxy_set_header Connection 'upgrade';
                  proxy_set_header Host \\$host;
                  proxy_set_header X-Real-IP \\$remote_addr;
                  proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;
                  proxy_set_header X-Forwarded-Proto \\$scheme;
                  proxy_cache_bypass \\$http_upgrade;
                  
                  # Timeout settings
                  proxy_connect_timeout 30s;
                  proxy_send_timeout 30s;
                  proxy_read_timeout 30s;
              }
              
              location {{HEALTH_CHECK_PATH}} {
                  limit_req off;
                  proxy_pass http://localhost:\${{ github.event.inputs.port }}{{HEALTH_CHECK_PATH}};
                  proxy_http_version 1.1;
                  proxy_set_header Host \\$host;
                  
                  proxy_connect_timeout 5s;
                  proxy_send_timeout 5s;
                  proxy_read_timeout 5s;
              }
              
              # Static assets caching
              location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
                  proxy_pass http://localhost:\${{ github.event.inputs.port }};
                  proxy_set_header Host \\$host;
                  expires 1y;
                  add_header Cache-Control "public, immutable";
              }
              
              # Deny access to sensitive files
              location ~ /\\. {
                  deny all;
                  access_log off;
                  log_not_found off;
              }
          }
          EOF
          
          # Enable the site
          sudo ln -sf /etc/nginx/sites-available/\${{ github.event.inputs.container_name }} /etc/nginx/sites-enabled/
          
          # Test nginx configuration
          sudo nginx -t
          
          # Reload nginx
          sudo systemctl reload nginx
      
      - name: Deployment summary
        run: |
          echo "🚀 Deployment completed successfully!"
          echo ""
          echo "📋 Deployment Details:"
          echo "  📍 URL: https://\${{ github.event.inputs.container_name }}.{{SERVER_HOST}}"
          echo "  🐳 Container: \${{ github.event.inputs.container_name }}"
          echo "  🌿 Branch: \${{ github.event.inputs.branch }}"
          echo "  👤 User: \${{ github.event.inputs.username }}"
          echo "  🔌 Port: \${{ github.event.inputs.port }}"
          echo ""
          echo "🌐 You can access your deployment at:"
          echo "  https://\${{ github.event.inputs.container_name }}.{{SERVER_HOST}}"
          
      - name: Notify deployment status
        if: always()
        run: |
          if [ "${{ job.status }}" == "success" ]; then
            echo "✅ Deployment succeeded"
          else
            echo "❌ Deployment failed"
            exit 1
          fi`;
  }

  /**
   * Gitea Actions workflow template
   */
  getGiteaWorkflowTemplate() {
    // Gitea Actions uses similar syntax to GitHub Actions
    return this.getGitHubWorkflowTemplate()
      .replace(/uses: actions\/checkout@v4/g, 'uses: actions/checkout@v3')
      .replace(/uses: actions\/setup-node@v4/g, 'uses: actions/setup-node@v3')
      .replace(/uses: actions\/setup-python@v4/g, 'uses: actions/setup-python@v3');
  }

  /**
   * Generate Dockerfile template based on project type
   */
  generateDockerfile(projectType, config = {}) {
    const {
      nodeVersion = '18',
      pythonVersion = '3.9',
      workDir = '/app',
      port = 3000
    } = config;

    switch (projectType) {
      case 'node':
        return `FROM node:${nodeVersion}-alpine

# Install system dependencies
RUN apk add --no-cache curl

# Set working directory
WORKDIR ${workDir}

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Build application if needed
RUN npm run build --if-present

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001
USER nextjs

# Expose port
EXPOSE ${port}

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD curl -f http://localhost:${port}/health || exit 1

# Start application
CMD ["npm", "start"]`;

      case 'python':
        return `FROM python:${pythonVersion}-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \\
    curl \\
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR ${workDir}

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create non-root user
RUN useradd --create-home --shell /bin/bash app
USER app

# Expose port
EXPOSE ${port}

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD curl -f http://localhost:${port}/health || exit 1

# Start application
CMD ["python", "app.py"]`;

      default:
        return `FROM node:18-alpine

# Install system dependencies
RUN apk add --no-cache curl

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY . .

# Build application
RUN npm run build --if-present

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD curl -f http://localhost:3000/health || exit 1

# Start application
CMD ["npm", "start"]`;
    }
  }

  /**
   * Generate deployment script for manual deployments
   */
  generateDeploymentScript(config) {
    const {
      containerName,
      port,
      projectPath = '.',
      serverHost,
      healthCheckPath = '/health'
    } = config;

    return `#!/bin/bash
set -e

# Deployment configuration
CONTAINER_NAME="${containerName}"
PORT="${port}"
PROJECT_PATH="${projectPath}"
SERVER_HOST="${serverHost}"
HEALTH_CHECK_PATH="${healthCheckPath}"

echo "🚀 Starting deployment of \${CONTAINER_NAME}..."

# Create deployment directory
DEPLOY_DIR="/opt/deployments/\${CONTAINER_NAME}"
mkdir -p "\${DEPLOY_DIR}"

# Copy project files
echo "📁 Copying project files..."
cp -r \${PROJECT_PATH}/. "\${DEPLOY_DIR}/"

# Generate docker-compose.yml
echo "🐳 Generating Docker Compose configuration..."
cat > "\${DEPLOY_DIR}/docker-compose.yml" << EOF
version: '3.8'
services:
  app:
    container_name: \${CONTAINER_NAME}
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "\${PORT}:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
    restart: unless-stopped
    networks:
      - deployment-network
    deploy:
      resources:
        limits:
          memory: 512m
          cpus: '0.5'
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000\${HEALTH_CHECK_PATH}"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
networks:
  deployment-network:
    driver: bridge
EOF

# Stop existing container
echo "🛑 Stopping existing container..."
cd "\${DEPLOY_DIR}"
docker-compose down --remove-orphans || echo "No existing container to stop"

# Deploy with Docker Compose
echo "🚀 Deploying with Docker Compose..."
docker-compose up -d --build

# Wait for health check
echo "⏳ Waiting for deployment to be ready..."
for i in {1..30}; do
    if curl -f -s "http://localhost:\${PORT}\${HEALTH_CHECK_PATH}" > /dev/null 2>&1; then
        echo "✅ Deployment is ready!"
        break
    fi
    echo "Attempt $i/30: Service not ready yet, waiting..."
    sleep 10
done

# Configure Nginx
echo "🌐 Configuring Nginx..."
sudo tee "/etc/nginx/sites-available/\${CONTAINER_NAME}" > /dev/null << EOF
server {
    listen 80;
    server_name \${CONTAINER_NAME}.\${SERVER_HOST};
    
    location / {
        proxy_pass http://localhost:\${PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \\$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \\$host;
        proxy_cache_bypass \\$http_upgrade;
    }
}
EOF

sudo ln -sf "/etc/nginx/sites-available/\${CONTAINER_NAME}" "/etc/nginx/sites-enabled/"
sudo nginx -t && sudo systemctl reload nginx

echo "🎉 Deployment completed successfully!"
echo "📍 URL: https://\${CONTAINER_NAME}.\${SERVER_HOST}"`;
  }

  /**
   * Get available workflow templates
   */
  getAvailableTemplates() {
    return {
      providers: ['github', 'gitea'],
      projectTypes: ['node', 'python', 'docker'],
      features: [
        'automatic_port_allocation',
        'nginx_reverse_proxy',
        'health_checks',
        'resource_limits',
        'auto_cleanup',
        'ssl_support'
      ]
    };
  }
}

// Export singleton instance
export default new WorkflowGenerator();