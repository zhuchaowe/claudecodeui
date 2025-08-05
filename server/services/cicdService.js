import fetch from 'node-fetch';
import { getUserById } from '../database/db.js';

/**
 * CI/CD Service
 * Unified service for GitHub Actions and Gitea Actions integration
 */

class CICDService {
  constructor() {
    this.providers = {
      github: new GitHubCICDProvider(),
      gitea: new GiteaCICDProvider()
    };
  }

  /**
   * Detect Git provider from repository URL
   */
  detectProvider(gitUrl) {
    if (!gitUrl) return null;
    
    if (gitUrl.includes('github.com')) {
      return 'github';
    } else if (gitUrl.includes('gitea')) {
      return 'gitea';
    }
    
    // Default to GitHub for unknown providers
    return 'github';
  }

  /**
   * Extract repository info from Git URL
   */
  parseGitUrl(gitUrl) {
    try {
      // Handle both HTTPS and SSH URLs
      let cleanUrl = gitUrl;
      
      // Convert SSH to HTTPS format for parsing
      if (gitUrl.startsWith('git@')) {
        cleanUrl = gitUrl.replace('git@', 'https://').replace(':', '/');
      }
      
      // Remove .git suffix
      cleanUrl = cleanUrl.replace(/\.git$/, '');
      
      const url = new URL(cleanUrl);
      const pathParts = url.pathname.split('/').filter(part => part);
      
      if (pathParts.length >= 2) {
        return {
          host: url.hostname,
          owner: pathParts[0],
          repo: pathParts[1],
          fullName: `${pathParts[0]}/${pathParts[1]}`
        };
      }
      
      throw new Error('Invalid repository URL format');
    } catch (error) {
      console.error('Error parsing Git URL:', error);
      throw new Error(`Failed to parse repository URL: ${gitUrl}`);
    }
  }

  /**
   * Get CI/CD provider instance
   */
  getProvider(providerName) {
    const provider = this.providers[providerName];
    if (!provider) {
      throw new Error(`Unsupported CI/CD provider: ${providerName}`);
    }
    return provider;
  }

  /**
   * Trigger workflow for deployment
   */
  async triggerDeployment(userId, gitUrl, branch, deploymentConfig) {
    try {
      const provider = this.detectProvider(gitUrl);
      const repoInfo = this.parseGitUrl(gitUrl);
      const cicdProvider = this.getProvider(provider);
      
      console.log(`🚀 Triggering ${provider} deployment for ${repoInfo.fullName}:${branch}`);
      
      // Get user's auth token
      const user = await getUserById(userId);
      if (!user) throw new Error('User not found');
      
      const authToken = provider === 'github' ? user.github_token : user.gitea_token;
      if (!authToken) {
        throw new Error(`${provider} token not found. Please connect your ${provider} account.`);
      }
      
      // Trigger workflow
      const result = await cicdProvider.triggerWorkflow(
        authToken,
        repoInfo,
        branch,
        deploymentConfig
      );
      
      console.log(`✅ ${provider} workflow triggered successfully:`, result);
      return {
        provider,
        workflowId: result.workflowId,
        runId: result.runId,
        runUrl: result.runUrl,
        repository: repoInfo
      };
    } catch (error) {
      console.error('Error triggering deployment:', error);
      throw error;
    }
  }

  /**
   * Get workflow run status
   */
  async getWorkflowStatus(userId, provider, repoInfo, runId) {
    try {
      const cicdProvider = this.getProvider(provider);
      const user = await getUserById(userId);
      const authToken = provider === 'github' ? user.github_token : user.gitea_token;
      
      return await cicdProvider.getWorkflowStatus(authToken, repoInfo, runId);
    } catch (error) {
      console.error('Error getting workflow status:', error);
      throw error;
    }
  }

  /**
   * Get workflow run logs
   */
  async getWorkflowLogs(userId, provider, repoInfo, runId) {
    try {
      const cicdProvider = this.getProvider(provider);
      const user = await getUserById(userId);
      const authToken = provider === 'github' ? user.github_token : user.gitea_token;
      
      return await cicdProvider.getWorkflowLogs(authToken, repoInfo, runId);
    } catch (error) {
      console.error('Error getting workflow logs:', error);
      throw error;
    }
  }

  /**
   * Generate workflow file content
   */
  generateWorkflowContent(deploymentConfig) {
    const { containerName, port, branch, username, serverHost, projectPath } = deploymentConfig;
    
    return `name: Deploy Branch
on:
  workflow_dispatch:
    inputs:
      branch:
        description: 'Branch to deploy'
        required: true
        default: '${branch}'
      username:
        description: 'Username for deployment'
        required: true
        default: '${username}'
      port:
        description: 'Port for deployment'
        required: true
        default: '${port}'
      container_name:
        description: 'Container name'
        required: true
        default: '${containerName}'

jobs:
  deploy:
    runs-on: self-hosted
    environment: development
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          ref: \${{ github.event.inputs.branch }}
      
      - name: Set up deployment variables
        run: |
          echo "BRANCH=\${{ github.event.inputs.branch }}" >> $GITHUB_ENV
          echo "USERNAME=\${{ github.event.inputs.username }}" >> $GITHUB_ENV
          echo "PORT=\${{ github.event.inputs.port }}" >> $GITHUB_ENV
          echo "CONTAINER_NAME=\${{ github.event.inputs.container_name }}" >> $GITHUB_ENV
          echo "DEPLOYMENT_URL=https://\${{ github.event.inputs.container_name }}.${serverHost}" >> $GITHUB_ENV
      
      - name: Create deployment directory
        run: |
          mkdir -p /opt/deployments/\${{ github.event.inputs.container_name }}
          cp -r . /opt/deployments/\${{ github.event.inputs.container_name }}/
      
      - name: Generate Docker Compose file
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
                - NODE_ENV=production
                - PORT=3000
                - BRANCH=\${{ github.event.inputs.branch }}
                - USERNAME=\${{ github.event.inputs.username }}
              restart: unless-stopped
              networks:
                - deployment-network
              deploy:
                resources:
                  limits:
                    memory: 512M
                    cpus: '0.5'
          networks:
            deployment-network:
              driver: bridge
          EOF
      
      - name: Deploy with Docker Compose
        run: |
          cd /opt/deployments/\${{ github.event.inputs.container_name }}
          docker-compose down --remove-orphans || true
          docker-compose up -d --build
      
      - name: Wait for deployment to be ready
        run: |
          echo "Waiting for deployment to be ready..."
          for i in {1..30}; do
            if curl -f -s http://localhost:\${{ github.event.inputs.port }}/health > /dev/null 2>&1; then
              echo "Deployment is ready!"
              break
            fi
            echo "Attempt $i/30: Service not ready yet, waiting..."
            sleep 10
          done
      
      - name: Update Nginx configuration
        run: |
          cat > /etc/nginx/sites-available/\${{ github.event.inputs.container_name }} << 'EOF'
          server {
              listen 80;
              server_name \${{ github.event.inputs.container_name }}.${serverHost};
              
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
              }
          }
          EOF
          
          ln -sf /etc/nginx/sites-available/\${{ github.event.inputs.container_name }} /etc/nginx/sites-enabled/
          nginx -t && systemctl reload nginx
      
      - name: Deployment summary
        run: |
          echo "🚀 Deployment completed successfully!"
          echo "📍 URL: https://\${{ github.event.inputs.container_name }}.${serverHost}"
          echo "🐳 Container: \${{ github.event.inputs.container_name }}"
          echo "🌿 Branch: \${{ github.event.inputs.branch }}"
          echo "👤 User: \${{ github.event.inputs.username }}"
          echo "🔌 Port: \${{ github.event.inputs.port }}"`;
  }
}

/**
 * GitHub Actions Provider
 */
class GitHubCICDProvider {
  constructor() {
    this.baseUrl = 'https://api.github.com';
  }

  async triggerWorkflow(authToken, repoInfo, branch, deploymentConfig) {
    try {
      const workflowFileName = 'deploy-branch.yml';
      const url = `${this.baseUrl}/repos/${repoInfo.fullName}/actions/workflows/${workflowFileName}/dispatches`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `token ${authToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ref: branch,
          inputs: {
            branch: branch,
            username: deploymentConfig.username,
            port: deploymentConfig.port.toString(),
            container_name: deploymentConfig.containerName
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`GitHub API error: ${response.status} - ${errorData.message || response.statusText}`);
      }

      // Get recent workflow runs to find the one we just triggered
      const runsUrl = `${this.baseUrl}/repos/${repoInfo.fullName}/actions/workflows/${workflowFileName}/runs?per_page=1`;
      const runsResponse = await fetch(runsUrl, {
        headers: {
          'Authorization': `token ${authToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      const runsData = await runsResponse.json();
      const latestRun = runsData.workflow_runs?.[0];

      return {
        workflowId: workflowFileName,
        runId: latestRun?.id,
        runUrl: latestRun?.html_url,
        status: 'triggered'
      };
    } catch (error) {
      console.error('GitHub workflow trigger error:', error);
      throw error;
    }
  }

  async getWorkflowStatus(authToken, repoInfo, runId) {
    try {
      const url = `${this.baseUrl}/repos/${repoInfo.fullName}/actions/runs/${runId}`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `token ${authToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const data = await response.json();
      
      return {
        status: data.status, // queued, in_progress, completed
        conclusion: data.conclusion, // success, failure, cancelled, neutral, skipped
        htmlUrl: data.html_url,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        runNumber: data.run_number
      };
    } catch (error) {
      console.error('GitHub workflow status error:', error);
      throw error;
    }
  }

  async getWorkflowLogs(authToken, repoInfo, runId) {
    try {
      const url = `${this.baseUrl}/repos/${repoInfo.fullName}/actions/runs/${runId}/logs`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `token ${authToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      // The response is a zip file containing log files
      const logData = await response.buffer();
      return logData;
    } catch (error) {
      console.error('GitHub workflow logs error:', error);
      throw error;
    }
  }
}

/**
 * Gitea Actions Provider
 */  
class GiteaCICDProvider {
  constructor() {
    // Base URL will be set based on the repository host
    this.baseUrl = null;
  }

  setBaseUrl(repoHost) {
    this.baseUrl = `https://${repoHost}/api/v1`;
  }

  async triggerWorkflow(authToken, repoInfo, branch, deploymentConfig) {
    try {
      this.setBaseUrl(repoInfo.host);
      
      const workflowFileName = 'deploy-branch.yml';
      const url = `${this.baseUrl}/repos/${repoInfo.fullName}/actions/workflows/${workflowFileName}/dispatches`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `token ${authToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ref: branch,
          inputs: {
            branch: branch,
            username: deploymentConfig.username,
            port: deploymentConfig.port.toString(),
            container_name: deploymentConfig.containerName
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Gitea API error: ${response.status} - ${errorData.message || response.statusText}`);
      }

      // Get recent workflow runs
      const runsUrl = `${this.baseUrl}/repos/${repoInfo.fullName}/actions/runs?per_page=1`;
      const runsResponse = await fetch(runsUrl, {
        headers: {
          'Authorization': `token ${authToken}`,
          'Accept': 'application/json'
        }
      });

      const runsData = await runsResponse.json();
      const latestRun = runsData.workflow_runs?.[0];

      return {
        workflowId: workflowFileName,
        runId: latestRun?.id,
        runUrl: `https://${repoInfo.host}/${repoInfo.fullName}/actions/runs/${latestRun?.id}`,
        status: 'triggered'
      };
    } catch (error) {
      console.error('Gitea workflow trigger error:', error);
      throw error;
    }
  }

  async getWorkflowStatus(authToken, repoInfo, runId) {
    try {
      this.setBaseUrl(repoInfo.host);
      const url = `${this.baseUrl}/repos/${repoInfo.fullName}/actions/runs/${runId}`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `token ${authToken}`,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Gitea API error: ${response.status}`);
      }

      const data = await response.json();
      
      return {
        status: data.status,
        conclusion: data.conclusion,
        htmlUrl: `https://${repoInfo.host}/${repoInfo.fullName}/actions/runs/${runId}`,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        runNumber: data.run_number
      };
    } catch (error) {
      console.error('Gitea workflow status error:', error);
      throw error;
    }
  }

  async getWorkflowLogs(authToken, repoInfo, runId) {
    try {
      this.setBaseUrl(repoInfo.host);
      const url = `${this.baseUrl}/repos/${repoInfo.fullName}/actions/runs/${runId}/logs`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `token ${authToken}`,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Gitea API error: ${response.status}`);
      }

      const logData = await response.buffer();
      return logData;
    } catch (error) {
      console.error('Gitea workflow logs error:', error);
      throw error;
    }
  }
}

// Export singleton instance
export default new CICDService();