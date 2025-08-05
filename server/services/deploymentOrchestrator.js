import { deploymentDb } from '../database/db.js';
import portManager from './portManager.js';
import containerManager from './containerManager.js';
import cicdService from './cicdService.js';
import nginxManager from './nginxManager.js';
import crypto from 'crypto';

/**
 * Deployment Orchestrator Service
 * Orchestrates the entire deployment process by coordinating all other services
 */

class DeploymentOrchestrator {
  constructor() {
    this.deploymentSteps = [
      'validation',
      'port_allocation',
      'workflow_generation', 
      'cicd_trigger',
      'deployment_monitoring',
      'nginx_configuration',
      'health_check',
      'finalization'
    ];
  }

  /**
   * Main deployment orchestration function
   */
  async deployBranch(userId, deploymentRequest, onProgress = null) {
    const deploymentId = crypto.randomUUID();
    let deployment = null;
    
    try {
      console.log(`🚀 Starting deployment orchestration for ${deploymentRequest.username}/${deploymentRequest.branch}`);
      
      // Step 1: Validation
      await this.reportProgress(onProgress, deploymentId, 'validation', 'running', 'Validating deployment request');
      const validationResult = await this.validateDeploymentRequest(deploymentRequest);
      if (!validationResult.valid) {
        throw new Error(`Validation failed: ${validationResult.error}`);
      }
      await this.reportProgress(onProgress, deploymentId, 'validation', 'success', 'Deployment request validated');

      // Step 2: Check for existing deployment
      const existingDeployment = await this.checkExistingDeployment(deploymentRequest);
      if (existingDeployment) {
        console.log(`♻️ Updating existing deployment ${existingDeployment.id}`);
        deployment = existingDeployment;
        await deploymentDb.updateDeploymentStatus(deployment.id, 'deploying');
      } else {
        // Step 3: Port allocation
        await this.reportProgress(onProgress, deploymentId, 'port_allocation', 'running', 'Allocating port');
        const port = await portManager.allocatePort(
          deploymentRequest.serverId,
          deploymentRequest.username,
          deploymentRequest.branch
        );
        await this.reportProgress(onProgress, deploymentId, 'port_allocation', 'success', `Port ${port} allocated`);

        // Step 4: Create deployment record
        deployment = await this.createDeploymentRecord(deploymentRequest, port);
        console.log(`✅ Created deployment record ${deployment.id}`);
      }

      // Step 5: Generate container and subdomain names
      const containerName = containerManager.generateContainerName(
        deploymentRequest.projectName,
        deploymentRequest.username,
        deploymentRequest.branch
      );
      const subdomain = containerManager.generateSubdomain(
        deploymentRequest.projectName,
        deploymentRequest.username,
        deploymentRequest.branch
      );

      // Step 6: Get server configuration
      const serverConfig = deploymentDb.getServerById(deploymentRequest.serverId);
      if (!serverConfig) {
        throw new Error('Deployment server not found');
      }

      // Step 7: CI/CD workflow trigger
      await this.reportProgress(onProgress, deployment.id, 'cicd_trigger', 'running', 'Triggering CI/CD workflow');
      const cicdResult = await cicdService.triggerDeployment(
        userId,
        deploymentRequest.gitUrl,
        deploymentRequest.branch,
        {
          containerName,
          port: deployment.port,
          username: deploymentRequest.username,
          serverHost: serverConfig.base_domain,
          projectPath: deploymentRequest.projectPath
        }
      );

      // Update deployment with CI/CD info
      await deploymentDb.db.prepare(`
        UPDATE branch_deployments 
        SET deploy_config = ?, commit_hash = ?
        WHERE id = ?
      `).run(
        JSON.stringify({
          ...JSON.parse(deployment.deploy_config || '{}'),
          cicd: cicdResult
        }),
        deploymentRequest.commitHash,
        deployment.id
      );

      await this.reportProgress(onProgress, deployment.id, 'cicd_trigger', 'success', 
        `CI/CD workflow triggered: ${cicdResult.runUrl}`);

      // Step 8: Monitor CI/CD deployment
      await this.reportProgress(onProgress, deployment.id, 'deployment_monitoring', 'running', 
        'Monitoring CI/CD deployment');
      
      const deploymentSuccess = await this.monitorCICDDeployment(
        userId, cicdResult, onProgress, deployment.id
      );
      
      if (!deploymentSuccess) {
        throw new Error('CI/CD deployment failed');
      }

      await this.reportProgress(onProgress, deployment.id, 'deployment_monitoring', 'success', 
        'CI/CD deployment completed');

      // Step 9: Configure Nginx
      await this.reportProgress(onProgress, deployment.id, 'nginx_configuration', 'running', 
        'Configuring reverse proxy');
      
      const fullUrl = await this.configureNginx(serverConfig, {
        containerName,
        subdomain,
        baseDomain: serverConfig.base_domain,
        port: deployment.port
      });

      // Update deployment with full URL
      await deploymentDb.db.prepare(`
        UPDATE branch_deployments 
        SET full_url = ?, subdomain = ?, container_name = ?
        WHERE id = ?
      `).run(fullUrl, subdomain, containerName, deployment.id);

      await this.reportProgress(onProgress, deployment.id, 'nginx_configuration', 'success', 
        `Reverse proxy configured: ${fullUrl}`);

      // Step 10: Health check
      await this.reportProgress(onProgress, deployment.id, 'health_check', 'running', 
        'Performing health check');
      
      const healthCheckResult = await this.performHealthCheck(fullUrl, deployment.port);
      if (!healthCheckResult.healthy) {
        console.warn(`⚠️ Health check failed for ${fullUrl}, but deployment will continue`);
      }

      await this.reportProgress(onProgress, deployment.id, 'health_check', 
        healthCheckResult.healthy ? 'success' : 'warning', 
        healthCheckResult.healthy ? 'Health check passed' : 'Health check failed - service may still be starting');

      // Step 11: Finalization
      await this.reportProgress(onProgress, deployment.id, 'finalization', 'running', 
        'Finalizing deployment');

      // Update deployment status to running
      await deploymentDb.updateDeploymentStatus(deployment.id, 'running', deploymentRequest.commitHash);

      // Set expiration date (7 days from now by default)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + (serverConfig.auto_cleanup_days || 7));
      await deploymentDb.db.prepare(`
        UPDATE branch_deployments SET expires_at = ? WHERE id = ?
      `).run(expiresAt.toISOString(), deployment.id);

      await this.reportProgress(onProgress, deployment.id, 'finalization', 'success', 
        'Deployment completed successfully');

      // Return deployment summary
      const finalDeployment = deploymentDb.getDeployment(deployment.id);
      
      console.log(`🎉 Deployment completed successfully: ${fullUrl}`);
      
      return {
        success: true,
        deployment: finalDeployment,
        url: fullUrl,
        containerName,
        port: deployment.port,
        cicd: cicdResult
      };

    } catch (error) {
      console.error('❌ Deployment orchestration failed:', error);
      
      // Update deployment status to error if we have a deployment record
      if (deployment) {
        await deploymentDb.updateDeploymentStatus(deployment.id, 'error');
        await this.reportProgress(onProgress, deployment.id, 'error', 'error', error.message);
      }

      throw error;
    }
  }

  /**
   * Validate deployment request
   */
  async validateDeploymentRequest(request) {
    try {
      // Check required fields
      const requiredFields = ['username', 'branch', 'projectName', 'gitUrl', 'serverId'];
      for (const field of requiredFields) {
        if (!request[field]) {
          return { valid: false, error: `Missing required field: ${field}` };
        }
      }

      // Validate server exists and is active
      const server = deploymentDb.getServerById(request.serverId);
      if (!server) {
        return { valid: false, error: 'Deployment server not found' };
      }
      if (server.status !== 'active') {
        return { valid: false, error: 'Deployment server is not active' };
      }

      // Check user deployment limits
      const userDeployments = deploymentDb.getDeploymentsByUser(request.username);
      const activeDeployments = userDeployments.filter(d => d.status === 'running');
      if (activeDeployments.length >= server.max_deployments_per_user) {
        return { 
          valid: false, 
          error: `Maximum deployments exceeded (${server.max_deployments_per_user})` 
        };
      }

      // Validate Git URL format
      try {
        cicdService.parseGitUrl(request.gitUrl);
      } catch (error) {
        return { valid: false, error: 'Invalid Git repository URL' };
      }

      // Validate branch name
      if (!/^[a-zA-Z0-9/_-]+$/.test(request.branch)) {
        return { valid: false, error: 'Invalid branch name format' };
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Check for existing deployment of the same branch
   */
  async checkExistingDeployment(request) {
    try {
      const existingDeployments = deploymentDb.db.prepare(`
        SELECT * FROM branch_deployments 
        WHERE username = ? AND branch = ? AND server_id = ? AND status != 'cleanup'
        ORDER BY last_deployed DESC
        LIMIT 1
      `).get(request.username, request.branch, request.serverId);

      return existingDeployments || null;
    } catch (error) {
      console.error('Error checking existing deployment:', error);
      return null;
    }
  }

  /**
   * Create deployment record in database
   */
  async createDeploymentRecord(request, port) {
    try {
      const containerName = containerManager.generateContainerName(
        request.projectName,
        request.username,
        request.branch
      );
      const subdomain = containerManager.generateSubdomain(
        request.projectName,
        request.username,
        request.branch
      );

      const deploymentConfig = {
        project_id: request.projectId || 0, // TODO: Get actual project ID
        server_id: request.serverId,
        username: request.username,
        branch: request.branch,
        container_name: containerName,
        port: port,
        subdomain: subdomain,
        full_url: '', // Will be updated later
        commit_hash: request.commitHash,
        deploy_config: JSON.stringify({
          gitUrl: request.gitUrl,
          projectName: request.projectName,
          projectPath: request.projectPath
        }),
        resources_config: JSON.stringify({
          memory: '512m',
          cpus: '0.5'
        }),
        health_check_url: `/health`,
        expires_at: null // Will be set after successful deployment
      };

      const deployment = deploymentDb.createDeployment(deploymentConfig);
      
      // Assign port to deployment permanently
      await portManager.assignPortToDeployment(request.serverId, port, deployment.id);
      
      return deployment;
    } catch (error) {
      console.error('Error creating deployment record:', error);
      throw error;
    }
  }

  /**
   * Monitor CI/CD deployment progress
   */
  async monitorCICDDeployment(userId, cicdResult, onProgress, deploymentId) {
    const maxWaitTime = 10 * 60 * 1000; // 10 minutes
    const pollInterval = 10 * 1000; // 10 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const status = await cicdService.getWorkflowStatus(
          userId,
          cicdResult.provider,
          cicdResult.repository,
          cicdResult.runId
        );

        await this.reportProgress(onProgress, deploymentId, 'deployment_monitoring', 'running',
          `CI/CD Status: ${status.status} - ${status.conclusion || 'In progress'}`);

        if (status.status === 'completed') {
          if (status.conclusion === 'success') {
            return true;
          } else {
            throw new Error(`CI/CD deployment failed: ${status.conclusion}`);
          }
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      } catch (error) {
        console.error('Error monitoring CI/CD deployment:', error);
        // Continue monitoring unless it's been too long
        if (Date.now() - startTime > maxWaitTime / 2) {
          throw error;
        }
      }
    }

    throw new Error('CI/CD deployment timeout');
  }

  /**
   * Configure Nginx reverse proxy
   */
  async configureNginx(serverConfig, deploymentConfig) {
    try {
      const nginxConfig = {
        ...deploymentConfig,
        sslEnabled: true
      };

      const result = await nginxManager.deployNginxConfig(serverConfig, nginxConfig);
      
      const protocol = nginxConfig.sslEnabled ? 'https' : 'http';
      const fullUrl = `${protocol}://${result.fullDomain}`;
      
      return fullUrl;
    } catch (error) {
      console.error('Error configuring Nginx:', error);
      throw error;
    }
  }

  /**
   * Perform health check on deployed service
   */
  async performHealthCheck(url, port, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const healthUrl = `${url}/health`;
        const response = await fetch(healthUrl, { 
          timeout: 10000,
          headers: { 'User-Agent': 'DeploymentHealthCheck/1.0' }
        });
        
        if (response.ok) {
          return { healthy: true, status: response.status, attempt: i + 1 };
        }
      } catch (error) {
        console.log(`Health check attempt ${i + 1} failed:`, error.message);
      }

      // Wait before retry (exponential backoff)
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 2000));
      }
    }

    return { healthy: false, attempts: maxRetries };
  }

  /**
   * Stop and cleanup deployment
   */
  async stopDeployment(deploymentId, onProgress = null) {
    try {
      console.log(`🛑 Stopping deployment ${deploymentId}`);
      
      const deployment = deploymentDb.getDeployment(deploymentId);
      if (!deployment) {
        throw new Error('Deployment not found');
      }

      const serverConfig = deploymentDb.getServerById(deployment.server_id);
      if (!serverConfig) {
        throw new Error('Server configuration not found');
      }

      await this.reportProgress(onProgress, deploymentId, 'stop_container', 'running', 
        'Stopping container');

      // Stop container
      await containerManager.stopContainer(serverConfig, deployment.container_name, 
        (progress) => this.reportProgress(onProgress, deploymentId, 'stop_container', 'running', progress.data));

      await this.reportProgress(onProgress, deploymentId, 'remove_nginx', 'running', 
        'Removing Nginx configuration');

      // Remove Nginx configuration
      await nginxManager.removeNginxConfig(serverConfig, deployment.container_name);

      await this.reportProgress(onProgress, deploymentId, 'cleanup_files', 'running', 
        'Cleaning up deployment files');

      // Cleanup deployment files
      await containerManager.cleanupDeployment(serverConfig, deployment.container_name);

      // Release port
      await portManager.releasePort(deployment.server_id, deployment.port);

      // Update deployment status
      await deploymentDb.updateDeploymentStatus(deploymentId, 'stopped');

      await this.reportProgress(onProgress, deploymentId, 'finalization', 'success', 
        'Deployment stopped successfully');

      console.log(`✅ Deployment ${deploymentId} stopped successfully`);
      return true;
    } catch (error) {
      console.error(`❌ Error stopping deployment ${deploymentId}:`, error);
      await deploymentDb.updateDeploymentStatus(deploymentId, 'error');
      throw error;
    }
  }

  /**
   * Restart deployment
   */
  async restartDeployment(deploymentId, onProgress = null) {
    try {
      console.log(`🔄 Restarting deployment ${deploymentId}`);
      
      const deployment = deploymentDb.getDeployment(deploymentId);
      if (!deployment) {
        throw new Error('Deployment not found');
      }

      const serverConfig = deploymentDb.getServerById(deployment.server_id);
      if (!serverConfig) {
        throw new Error('Server configuration not found');
      }

      await this.reportProgress(onProgress, deploymentId, 'restart_container', 'running', 
        'Restarting container');

      // Restart container
      await containerManager.restartContainer(serverConfig, deployment.container_name,
        (progress) => this.reportProgress(onProgress, deploymentId, 'restart_container', 'running', progress.data));

      // Update deployment timestamp
      await deploymentDb.updateDeploymentStatus(deploymentId, 'running');

      await this.reportProgress(onProgress, deploymentId, 'finalization', 'success', 
        'Deployment restarted successfully');

      console.log(`✅ Deployment ${deploymentId} restarted successfully`);
      return true;
    } catch (error) {
      console.error(`❌ Error restarting deployment ${deploymentId}:`, error);
      throw error;
    }
  }

  /**
   * Clean up expired deployments
   */
  async cleanupExpiredDeployments() {
    try {
      console.log('🧹 Starting cleanup of expired deployments');
      
      const expiredDeployments = deploymentDb.getExpiredDeployments();
      
      for (const deployment of expiredDeployments) {
        try {
          console.log(`🗑️ Cleaning up expired deployment ${deployment.id} (${deployment.container_name})`);
          
          await deploymentDb.updateDeploymentStatus(deployment.id, 'cleanup');
          await this.stopDeployment(deployment.id);
          await deploymentDb.deleteDeployment(deployment.id);
          
          console.log(`✅ Cleaned up deployment ${deployment.id}`);
        } catch (error) {
          console.error(`❌ Error cleaning up deployment ${deployment.id}:`, error);
        }
      }
      
      console.log(`🧹 Cleanup completed. Processed ${expiredDeployments.length} expired deployments`);
      return expiredDeployments.length;
    } catch (error) {
      console.error('Error during cleanup:', error);
      return 0;
    }
  }

  /**
   * Report progress to callback function
   */
  async reportProgress(onProgress, deploymentId, step, status, message) {
    if (onProgress) {
      onProgress({
        deploymentId,
        step,
        status,
        message,
        timestamp: new Date().toISOString()
      });
    }

    // Also log to database
    if (deploymentId && step && status) {
      try {
        deploymentDb.addDeploymentLog(deploymentId, step, status, message);
      } catch (error) {
        console.error('Error logging deployment progress:', error);
      }
    }
  }
}

// Export singleton instance
export default new DeploymentOrchestrator();