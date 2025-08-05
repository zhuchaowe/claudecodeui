import { spawn } from 'child_process';
import { deploymentDb } from '../database/db.js';
import path from 'path';
import fs from 'fs/promises';

/**
 * Container Manager Service
 * Handles Docker container lifecycle management for multi-branch deployments
 */

class ContainerManager {
  constructor() {
    this.defaultResourceLimits = {
      memory: '512m',
      cpus: '0.5',
      memorySwap: '512m'
    };
  }

  /**
   * Generate container name based on project, username, and branch
   */
  generateContainerName(projectName, username, branch) {
    // Sanitize names for Docker compatibility (lowercase, no special chars except hyphens)
    const sanitize = (str) => str.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
    
    const sanitizedProject = sanitize(projectName);
    const sanitizedUser = sanitize(username);
    const sanitizedBranch = sanitize(branch);
    
    return `${sanitizedProject}-${sanitizedUser}-${sanitizedBranch}`;
  }

  /**
   * Generate subdomain for deployment
   */
  generateSubdomain(projectName, username, branch) {
    const sanitize = (str) => str.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
    
    const sanitizedProject = sanitize(projectName);
    const sanitizedUser = sanitize(username);
    const sanitizedBranch = sanitize(branch);
    
    // For main branch, use simpler subdomain
    if (branch === 'main' || branch === 'master') {
      return `${sanitizedProject}-${sanitizedUser}`;
    }
    
    return `${sanitizedProject}-${sanitizedUser}-${sanitizedBranch}`;
  }

  /**
   * Generate Docker Compose configuration for a branch deployment
   */
  generateDockerComposeConfig(deploymentConfig) {
    const {
      containerName,
      port,
      branch,
      username,
      projectPath,
      envVars = {},
      resourceLimits = this.defaultResourceLimits,
      healthCheck = {}
    } = deploymentConfig;

    const config = {
      version: '3.8',
      services: {
        app: {
          container_name: containerName,
          build: {
            context: projectPath,
            dockerfile: 'Dockerfile'
          },
          ports: [`${port}:3000`],
          environment: {
            NODE_ENV: 'production',
            PORT: '3000',
            BRANCH: branch,
            USERNAME: username,
            ...envVars
          },
          deploy: {
            resources: {
              limits: {
                memory: resourceLimits.memory || this.defaultResourceLimits.memory,
                cpus: resourceLimits.cpus || this.defaultResourceLimits.cpus
              }
            }
          },
          restart: 'unless-stopped',
          networks: ['deployment-network']
        }
      },
      networks: {
        'deployment-network': {
          driver: 'bridge'
        }
      }
    };

    // Add volume mounts if specified
    if (deploymentConfig.volumes) {
      config.services.app.volumes = deploymentConfig.volumes;
    }

    // Add health check if specified
    if (healthCheck.path) {
      config.services.app.healthcheck = {
        test: [`CMD`, `curl`, `-f`, `http://localhost:3000${healthCheck.path}`],
        interval: '30s',
        timeout: '10s',
        retries: 3,
        start_period: '40s'
      };
    }

    return config;
  }

  /**
   * Write Docker Compose file to deployment directory
   */
  async writeDockerComposeFile(serverConfig, deploymentConfig, composeConfig) {
    try {
      const deploymentDir = path.join(
        serverConfig.docker_compose_path,
        deploymentConfig.containerName
      );

      // Create deployment directory
      await fs.mkdir(deploymentDir, { recursive: true });

      // Write docker-compose.yml
      const composeFilePath = path.join(deploymentDir, 'docker-compose.yml');
      const yamlContent = this.dockerComposeToYaml(composeConfig);
      await fs.writeFile(composeFilePath, yamlContent);

      // Write environment file if needed
      const envFilePath = path.join(deploymentDir, '.env');
      const envContent = Object.entries(composeConfig.services.app.environment)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
      await fs.writeFile(envFilePath, envContent);

      console.log(`📝 Created Docker Compose config at ${composeFilePath}`);
      return { composeFilePath, envFilePath, deploymentDir };
    } catch (error) {
      console.error('Error writing Docker Compose file:', error);
      throw error;
    }
  }

  /**
   * Convert Docker Compose config object to YAML string
   */
  dockerComposeToYaml(config) {
    // Simple YAML converter (for production, consider using a proper YAML library)
    const yamlLines = [`version: '${config.version}'`];
    
    yamlLines.push('\nservices:');
    for (const [serviceName, serviceConfig] of Object.entries(config.services)) {
      yamlLines.push(`  ${serviceName}:`);
      
      // Add service properties
      if (serviceConfig.container_name) {
        yamlLines.push(`    container_name: ${serviceConfig.container_name}`);
      }
      
      if (serviceConfig.build) {
        yamlLines.push('    build:');
        yamlLines.push(`      context: ${serviceConfig.build.context}`);
        if (serviceConfig.build.dockerfile) {
          yamlLines.push(`      dockerfile: ${serviceConfig.build.dockerfile}`);
        }
      }
      
      if (serviceConfig.ports) {
        yamlLines.push('    ports:');
        serviceConfig.ports.forEach(port => {
          yamlLines.push(`      - "${port}"`);
        });
      }
      
      if (serviceConfig.environment) {
        yamlLines.push('    environment:');
        Object.entries(serviceConfig.environment).forEach(([key, value]) => {
          yamlLines.push(`      - ${key}=${value}`);
        });
      }
      
      if (serviceConfig.volumes) {
        yamlLines.push('    volumes:');
        serviceConfig.volumes.forEach(volume => {
          yamlLines.push(`      - ${volume}`);
        });
      }
      
      if (serviceConfig.restart) {
        yamlLines.push(`    restart: ${serviceConfig.restart}`);
      }
      
      if (serviceConfig.networks) {
        yamlLines.push('    networks:');
        serviceConfig.networks.forEach(network => {
          yamlLines.push(`      - ${network}`);
        });
      }
      
      if (serviceConfig.healthcheck) {
        yamlLines.push('    healthcheck:');
        yamlLines.push(`      test: [${serviceConfig.healthcheck.test.map(t => `"${t}"`).join(', ')}]`);
        yamlLines.push(`      interval: ${serviceConfig.healthcheck.interval}`);
        yamlLines.push(`      timeout: ${serviceConfig.healthcheck.timeout}`);
        yamlLines.push(`      retries: ${serviceConfig.healthcheck.retries}`);
        yamlLines.push(`      start_period: ${serviceConfig.healthcheck.start_period}`);
      }
      
      if (serviceConfig.deploy) {
        yamlLines.push('    deploy:');
        if (serviceConfig.deploy.resources) {
          yamlLines.push('      resources:');
          if (serviceConfig.deploy.resources.limits) {
            yamlLines.push('        limits:');
            Object.entries(serviceConfig.deploy.resources.limits).forEach(([key, value]) => {
              yamlLines.push(`          ${key}: ${value}`);
            });
          }
        }
      }
    }
    
    if (config.networks) {
      yamlLines.push('\nnetworks:');
      Object.entries(config.networks).forEach(([networkName, networkConfig]) => {
        yamlLines.push(`  ${networkName}:`);
        Object.entries(networkConfig).forEach(([key, value]) => {
          yamlLines.push(`    ${key}: ${value}`);
        });
      });
    }
    
    return yamlLines.join('\n');
  }

  /**
   * Execute Docker Compose command via SSH
   */
  async executeDockerCommand(serverConfig, command, workingDir = null, onProgress = null) {
    return new Promise((resolve, reject) => {
      console.log(`🐳 Executing Docker command: ${command}`);
      
      const sshCommand = [
        'ssh',
        '-o', 'StrictHostKeyChecking=no',
        '-p', serverConfig.port.toString(),
        `${serverConfig.username}@${serverConfig.host}`
      ];

      // Add working directory if specified
      if (workingDir) {
        sshCommand.push(`cd ${workingDir} && ${command}`);
      } else {
        sshCommand.push(command);
      }

      const process = spawn('ssh', sshCommand.slice(1), {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        if (onProgress) {
          onProgress({ type: 'stdout', data: output });
        }
      });

      process.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        if (onProgress) {
          onProgress({ type: 'stderr', data: output });
        }
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr, code });
        } else {
          reject(new Error(`Docker command failed with code ${code}:\n${stderr}`));
        }
      });

      process.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Deploy container using Docker Compose
   */
  async deployContainer(serverConfig, deploymentConfig, onProgress = null) {
    try {
      console.log(`🚀 Deploying container ${deploymentConfig.containerName}`);
      
      // Generate Docker Compose configuration
      const composeConfig = this.generateDockerComposeConfig(deploymentConfig);
      
      // Write configuration files (this would be done via SSH in production)
      const { deploymentDir } = await this.writeDockerComposeFile(serverConfig, deploymentConfig, composeConfig);
      
      // Execute Docker Compose up
      const command = `docker-compose -f ${path.join(deploymentDir, 'docker-compose.yml')} up -d --build`;
      const result = await this.executeDockerCommand(serverConfig, command, null, onProgress);
      
      console.log(`✅ Container ${deploymentConfig.containerName} deployed successfully`);
      return result;
    } catch (error) {
      console.error(`❌ Failed to deploy container ${deploymentConfig.containerName}:`, error);
      throw error;
    }
  }

  /**
   * Stop and remove container
   */
  async stopContainer(serverConfig, containerName, onProgress = null) {
    try {
      console.log(`🛑 Stopping container ${containerName}`);
      
      const deploymentDir = path.join(serverConfig.docker_compose_path, containerName);
      const command = `docker-compose -f ${path.join(deploymentDir, 'docker-compose.yml')} down --remove-orphans`;
      
      const result = await this.executeDockerCommand(serverConfig, command, null, onProgress);
      
      console.log(`✅ Container ${containerName} stopped successfully`);
      return result;
    } catch (error) {
      console.error(`❌ Failed to stop container ${containerName}:`, error);
      throw error;
    }
  }

  /**
   * Get container status
   */
  async getContainerStatus(serverConfig, containerName) {
    try {
      const command = `docker ps -f name=${containerName} --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"`;
      const result = await this.executeDockerCommand(serverConfig, command);
      
      // Parse the output to determine status
      const lines = result.stdout.split('\n').filter(line => line.trim());
      if (lines.length > 1) { // Skip header line
        const statusLine = lines[1];
        if (statusLine.includes(containerName)) {
          return {
            running: true,
            status: statusLine.split('\t')[1],
            ports: statusLine.split('\t')[2]
          };
        }
      }
      
      return { running: false, status: 'stopped', ports: '' };
    } catch (error) {
      console.error(`Error getting container status for ${containerName}:`, error);
      return { running: false, status: 'error', ports: '', error: error.message };
    }
  }

  /**
   * Get container logs
   */
  async getContainerLogs(serverConfig, containerName, lines = 100) {
    try {
      const command = `docker logs --tail ${lines} ${containerName}`;
      const result = await this.executeDockerCommand(serverConfig, command);
      return result.stdout;
    } catch (error) {
      console.error(`Error getting container logs for ${containerName}:`, error);
      throw error;
    }
  }

  /**
   * Restart container
   */
  async restartContainer(serverConfig, containerName, onProgress = null) {
    try {
      console.log(`🔄 Restarting container ${containerName}`);
      
      const deploymentDir = path.join(serverConfig.docker_compose_path, containerName);
      const command = `docker-compose -f ${path.join(deploymentDir, 'docker-compose.yml')} restart`;
      
      const result = await this.executeDockerCommand(serverConfig, command, null, onProgress);
      
      console.log(`✅ Container ${containerName} restarted successfully`);
      return result;
    } catch (error) {
      console.error(`❌ Failed to restart container ${containerName}:`, error);
      throw error;
    }
  }

  /**
   * Clean up deployment files
   */
  async cleanupDeployment(serverConfig, containerName) {
    try {
      console.log(`🧹 Cleaning up deployment ${containerName}`);
      
      const deploymentDir = path.join(serverConfig.docker_compose_path, containerName);
      const command = `rm -rf ${deploymentDir}`;
      
      await this.executeDockerCommand(serverConfig, command);
      
      console.log(`✅ Deployment ${containerName} cleaned up successfully`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to cleanup deployment ${containerName}:`, error);
      throw error;
    }
  }

  /**
   * Check container health
   */
  async checkContainerHealth(serverConfig, containerName) {
    try {
      const command = `docker inspect --format='{{.State.Health.Status}}' ${containerName}`;
      const result = await this.executeDockerCommand(serverConfig, command);
      
      const healthStatus = result.stdout.trim();
      return {
        healthy: healthStatus === 'healthy',
        status: healthStatus || 'no-healthcheck'
      };
    } catch (error) {
      console.error(`Error checking container health for ${containerName}:`, error);
      return { healthy: false, status: 'error', error: error.message };
    }
  }
}

// Export singleton instance
export default new ContainerManager();