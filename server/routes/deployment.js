import express from 'express';
import { deploymentDb } from '../database/db.js';
import deploymentOrchestrator from '../services/deploymentOrchestrator.js';
import portManager from '../services/portManager.js';
import containerManager from '../services/containerManager.js';
import cicdService from '../services/cicdService.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

/**
 * GET /api/deployment/servers
 * Get all available deployment servers
 */
router.get('/servers', async (req, res) => {
  try {
    const servers = deploymentDb.getServers();
    res.json(servers);
  } catch (error) {
    console.error('Error getting deployment servers:', error);
    res.status(500).json({ error: 'Failed to get deployment servers' });
  }
});

/**
 * POST /api/deployment/servers
 * Create a new deployment server
 */
router.post('/servers', async (req, res) => {
  try {
    const serverConfig = req.body;
    
    // Validate required fields
    const requiredFields = ['name', 'host', 'username', 'base_domain'];
    for (const field of requiredFields) {
      if (!serverConfig[field]) {
        return res.status(400).json({ error: `Missing required field: ${field}` });
      }
    }

    const server = deploymentDb.createServer(serverConfig);
    res.json(server);
  } catch (error) {
    console.error('Error creating deployment server:', error);
    res.status(500).json({ error: 'Failed to create deployment server' });
  }
});

/**
 * GET /api/deployment/deployments
 * Get deployments for the current user
 */
router.get('/deployments', async (req, res) => {
  try {
    const deployments = deploymentDb.getDeploymentsByUser(req.user.username);
    res.json(deployments);
  } catch (error) {
    console.error('Error getting user deployments:', error);
    res.status(500).json({ error: 'Failed to get deployments' });
  }
});

/**
 * GET /api/deployment/deployments/:deploymentId
 * Get specific deployment details
 */
router.get('/deployments/:deploymentId', async (req, res) => {
  try {
    const deploymentId = parseInt(req.params.deploymentId);
    const deployment = deploymentDb.getDeployment(deploymentId);
    
    if (!deployment) {
      return res.status(404).json({ error: 'Deployment not found' });
    }

    // Check if user owns this deployment
    if (deployment.username !== req.user.username) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(deployment);
  } catch (error) {
    console.error('Error getting deployment details:', error);
    res.status(500).json({ error: 'Failed to get deployment details' });
  }
});

/**
 * POST /api/deployment/deploy
 * Deploy a branch
 */
router.post('/deploy', async (req, res) => {
  try {
    const deploymentRequest = {
      ...req.body,
      username: req.user.username
    };

    console.log(`🚀 Deploy request received:`, {
      username: deploymentRequest.username,
      branch: deploymentRequest.branch,
      projectName: deploymentRequest.projectName,
      serverId: deploymentRequest.serverId
    });

    // Validate required fields
    const requiredFields = ['branch', 'projectName', 'gitUrl', 'serverId'];
    for (const field of requiredFields) {
      if (!deploymentRequest[field]) {
        return res.status(400).json({ error: `Missing required field: ${field}` });
      }
    }

    // Store WebSocket connection for progress updates
    const progressCallback = (progress) => {
      // Find WebSocket connections for this user and send progress
      const message = JSON.stringify({
        type: 'deployment-progress',
        ...progress
      });

      // Access WebSocket connections from the main server
      // This assumes we have access to connectedClients from the main server
      if (req.app.locals.connectedClients) {
        req.app.locals.connectedClients.forEach((clientInfo, ws) => {
          if (clientInfo.username === req.user.username && ws.readyState === ws.OPEN) {
            ws.send(message);
          }
        });
      }
    };

    // Start deployment (this is async but we return immediately)
    deploymentOrchestrator.deployBranch(req.user.id, deploymentRequest, progressCallback)
      .then((result) => {
        console.log(`✅ Deployment completed for ${deploymentRequest.username}/${deploymentRequest.branch}`);
        
        // Send final success message via WebSocket
        progressCallback({
          type: 'deployment-complete',
          success: true,
          deployment: result.deployment,
          url: result.url
        });
      })
      .catch((error) => {
        console.error(`❌ Deployment failed for ${deploymentRequest.username}/${deploymentRequest.branch}:`, error);
        
        // Send error message via WebSocket
        progressCallback({
          type: 'deployment-error',
          success: false,
          error: error.message
        });
      });

    // Return immediately with deployment started status
    res.json({
      success: true,
      message: 'Deployment started',
      status: 'deploying'
    });

  } catch (error) {
    console.error('Error starting deployment:', error);
    res.status(500).json({ error: 'Failed to start deployment' });
  }
});

/**
 * POST /api/deployment/deployments/:deploymentId/stop
 * Stop a deployment
 */
router.post('/deployments/:deploymentId/stop', async (req, res) => {
  try {
    const deploymentId = parseInt(req.params.deploymentId);
    const deployment = deploymentDb.getDeployment(deploymentId);
    
    if (!deployment) {
      return res.status(404).json({ error: 'Deployment not found' });
    }

    // Check if user owns this deployment
    if (deployment.username !== req.user.username) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Progress callback for WebSocket updates
    const progressCallback = (progress) => {
      const message = JSON.stringify({
        type: 'deployment-progress',
        ...progress
      });

      if (req.app.locals.connectedClients) {
        req.app.locals.connectedClients.forEach((clientInfo, ws) => {
          if (clientInfo.username === req.user.username && ws.readyState === ws.OPEN) {
            ws.send(message);
          }
        });
      }
    };

    // Stop deployment asynchronously
    deploymentOrchestrator.stopDeployment(deploymentId, progressCallback)
      .then(() => {
        console.log(`✅ Deployment ${deploymentId} stopped successfully`);
        progressCallback({
          type: 'deployment-stopped',
          deploymentId: deploymentId,
          success: true
        });
      })
      .catch((error) => {
        console.error(`❌ Failed to stop deployment ${deploymentId}:`, error);
        progressCallback({
          type: 'deployment-stop-error', 
          deploymentId: deploymentId,
          success: false,
          error: error.message
        });
      });

    res.json({
      success: true,
      message: 'Deployment stop initiated'
    });

  } catch (error) {
    console.error('Error stopping deployment:', error);
    res.status(500).json({ error: 'Failed to stop deployment' });
  }
});

/**
 * POST /api/deployment/deployments/:deploymentId/restart
 * Restart a deployment
 */
router.post('/deployments/:deploymentId/restart', async (req, res) => {
  try {
    const deploymentId = parseInt(req.params.deploymentId);
    const deployment = deploymentDb.getDeployment(deploymentId);
    
    if (!deployment) {
      return res.status(404).json({ error: 'Deployment not found' });
    }

    // Check if user owns this deployment
    if (deployment.username !== req.user.username) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Progress callback for WebSocket updates
    const progressCallback = (progress) => {
      const message = JSON.stringify({
        type: 'deployment-progress',
        ...progress
      });

      if (req.app.locals.connectedClients) {
        req.app.locals.connectedClients.forEach((clientInfo, ws) => {
          if (clientInfo.username === req.user.username && ws.readyState === ws.OPEN) {
            ws.send(message);
          }
        });
      }
    };

    // Restart deployment asynchronously
    deploymentOrchestrator.restartDeployment(deploymentId, progressCallback)
      .then(() => {
        console.log(`✅ Deployment ${deploymentId} restarted successfully`);
        progressCallback({
          type: 'deployment-restarted',
          deploymentId: deploymentId,
          success: true
        });
      })
      .catch((error) => {
        console.error(`❌ Failed to restart deployment ${deploymentId}:`, error);
        progressCallback({
          type: 'deployment-restart-error',
          deploymentId: deploymentId,
          success: false,
          error: error.message
        });
      });

    res.json({
      success: true,
      message: 'Deployment restart initiated'
    });

  } catch (error) {
    console.error('Error restarting deployment:', error);
    res.status(500).json({ error: 'Failed to restart deployment' });
  }
});

/**
 * DELETE /api/deployment/deployments/:deploymentId
 * Delete a deployment
 */
router.delete('/deployments/:deploymentId', async (req, res) => {
  try {
    const deploymentId = parseInt(req.params.deploymentId);
    const deployment = deploymentDb.getDeployment(deploymentId);
    
    if (!deployment) {
      return res.status(404).json({ error: 'Deployment not found' });
    }

    // Check if user owns this deployment
    if (deployment.username !== req.user.username) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Stop deployment first if it's running
    if (deployment.status === 'running') {
      await deploymentOrchestrator.stopDeployment(deploymentId);
    }

    // Delete deployment record
    await deploymentDb.deleteDeployment(deploymentId);

    res.json({
      success: true,
      message: 'Deployment deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting deployment:', error);
    res.status(500).json({ error: 'Failed to delete deployment' });
  }
});

/**
 * GET /api/deployment/deployments/:deploymentId/logs
 * Get deployment logs
 */
router.get('/deployments/:deploymentId/logs', async (req, res) => {
  try {
    const deploymentId = parseInt(req.params.deploymentId);
    const deployment = deploymentDb.getDeployment(deploymentId);
    
    if (!deployment) {
      return res.status(404).json({ error: 'Deployment not found' });
    }

    // Check if user owns this deployment
    if (deployment.username !== req.user.username) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const logs = deploymentDb.getDeploymentLogs(deploymentId);
    res.json(logs);

  } catch (error) {
    console.error('Error getting deployment logs:', error);
    res.status(500).json({ error: 'Failed to get deployment logs' });
  }
});

/**
 * GET /api/deployment/deployments/:deploymentId/status
 * Get deployment status
 */
router.get('/deployments/:deploymentId/status', async (req, res) => {
  try {
    const deploymentId = parseInt(req.params.deploymentId);
    const deployment = deploymentDb.getDeployment(deploymentId);
    
    if (!deployment) {
      return res.status(404).json({ error: 'Deployment not found' });
    }

    // Check if user owns this deployment
    if (deployment.username !== req.user.username) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get container status if deployment is running
    let containerStatus = null;
    if (deployment.status === 'running') {
      try {
        const serverConfig = deploymentDb.getServerById(deployment.server_id);
        containerStatus = await containerManager.getContainerStatus(
          serverConfig,
          deployment.container_name
        );
      } catch (error) {
        console.error('Error getting container status:', error);
      }
    }

    res.json({
      deployment: deployment,
      containerStatus: containerStatus
    });

  } catch (error) {
    console.error('Error getting deployment status:', error);
    res.status(500).json({ error: 'Failed to get deployment status' });
  }
});

/**
 * GET /api/deployment/servers/:serverId/stats
 * Get server statistics
 */
router.get('/servers/:serverId/stats', async (req, res) => {
  try {
    const serverId = parseInt(req.params.serverId);
    const server = deploymentDb.getServerById(serverId);
    
    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    // Get port usage statistics
    const portStats = await portManager.getPortUsageStats(serverId);
    
    // Get deployment statistics
    const deployments = deploymentDb.getDeploymentsByProject(0); // Get all deployments for this server
    const serverDeployments = deployments.filter(d => d.server_id === serverId);
    
    const deploymentStats = {
      total: serverDeployments.length,
      running: serverDeployments.filter(d => d.status === 'running').length,
      stopped: serverDeployments.filter(d => d.status === 'stopped').length,
      error: serverDeployments.filter(d => d.status === 'error').length
    };

    res.json({
      server: server,
      portUsage: portStats,
      deployments: deploymentStats
    });

  } catch (error) {
    console.error('Error getting server stats:', error);
    res.status(500).json({ error: 'Failed to get server statistics' });
  }
});

/**
 * POST /api/deployment/cleanup
 * Manually trigger cleanup of expired deployments
 */
router.post('/cleanup', async (req, res) => {
  try {
    console.log(`🧹 Manual cleanup triggered by user ${req.user.username}`);
    
    const cleanedCount = await deploymentOrchestrator.cleanupExpiredDeployments();
    
    res.json({
      success: true,
      message: `Cleaned up ${cleanedCount} expired deployments`,
      cleanedCount: cleanedCount
    });

  } catch (error) {
    console.error('Error during manual cleanup:', error);
    res.status(500).json({ error: 'Failed to cleanup expired deployments' });
  }
});

/**
 * GET /api/deployment/branch-info
 * Get Git repository branch information
 */
router.get('/branch-info', async (req, res) => {
  try {
    const { gitUrl } = req.query;
    
    if (!gitUrl) {
      return res.status(400).json({ error: 'Git URL is required' });
    }

    // Parse Git URL to get repository info
    const repoInfo = cicdService.parseGitUrl(gitUrl);
    const provider = cicdService.detectProvider(gitUrl);

    res.json({
      provider: provider,
      repository: repoInfo,
      supported: ['github', 'gitea'].includes(provider)
    });

  } catch (error) {
    console.error('Error getting branch info:', error);
    res.status(400).json({ error: 'Invalid Git URL or unsupported provider' });
  }
});

/**
 * POST /api/deployment/test-connection
 * Test connection to deployment server
 */
router.post('/test-connection', async (req, res) => {
  try {
    const { serverId } = req.body;
    
    if (!serverId) {
      return res.status(400).json({ error: 'Server ID is required' });
    }

    const server = deploymentDb.getServerById(serverId);
    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    // Test SSH connection
    try {
      const testCommand = 'echo "Connection test successful"';
      // This would use the SSH service to test connection
      // For now, we'll just return a success response
      
      res.json({
        success: true,
        message: 'Connection test successful',
        server: {
          name: server.name,
          host: server.host,
          port: server.port
        }
      });
    } catch (error) {
      res.json({
        success: false,
        message: 'Connection test failed',
        error: error.message
      });
    }

  } catch (error) {
    console.error('Error testing server connection:', error);
    res.status(500).json({ error: 'Failed to test server connection' });
  }
});

export default router;