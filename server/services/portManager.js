import crypto from 'crypto';
import { deploymentDb } from '../database/db.js';

/**
 * Port Manager Service
 * Handles dynamic port allocation, conflict detection, and cleanup for multi-branch deployments
 */

class PortManager {
  constructor() {
    this.portReservationTimeout = 60 * 60 * 1000; // 1 hour in milliseconds
  }

  /**
   * Calculate a deterministic port based on username and branch
   * This ensures the same branch for the same user gets the same port (when available)
   */
  calculatePreferredPort(username, branch, serverId) {
    try {
      // Get server port range
      const server = deploymentDb.getServerById(serverId);
      if (!server) throw new Error('Server not found');

      // Handle main/master branch - always try to get a low port
      if (branch === 'main' || branch === 'master') {
        return server.port_range_start;
      }

      // Create hash from username and branch
      const hash = crypto.createHash('md5')
        .update(`${username}-${branch}`)
        .digest('hex');
      
      // Convert first 4 hex chars to number and map to port range
      const hashNum = parseInt(hash.substr(0, 4), 16);
      const portRange = server.port_range_end - server.port_range_start;
      const preferredPort = server.port_range_start + (hashNum % portRange);

      console.log(`🔢 Calculated preferred port for ${username}/${branch}: ${preferredPort}`);
      return preferredPort;
    } catch (error) {
      console.error('Error calculating preferred port:', error);
      throw error;
    }
  }

  /**
   * Allocate a port for a deployment
   * First tries the preferred port, then finds any available port
   */
  async allocatePort(serverId, username, branch, deploymentId = null) {
    try {
      console.log(`🎯 Allocating port for ${username}/${branch} on server ${serverId}`);
      
      const server = deploymentDb.getServerById(serverId);
      if (!server) throw new Error('Server not found');

      // Clean up expired reservations first
      await this.cleanupExpiredReservations(serverId);

      // Try preferred port first
      const preferredPort = this.calculatePreferredPort(username, branch, serverId);
      if (await this.isPortAvailable(serverId, preferredPort)) {
        await this.reservePort(serverId, preferredPort, deploymentId);
        console.log(`✅ Allocated preferred port ${preferredPort} for ${username}/${branch}`);
        return preferredPort;
      }

      // If preferred port is not available, find any available port
      const availablePort = await this.findAvailablePort(serverId);
      if (availablePort) {
        await this.reservePort(serverId, availablePort, deploymentId);
        console.log(`✅ Allocated available port ${availablePort} for ${username}/${branch}`);
        return availablePort;
      }

      throw new Error(`No available ports in range ${server.port_range_start}-${server.port_range_end}`);
    } catch (error) {
      console.error('Error allocating port:', error);
      throw error;
    }
  }

  /**
   * Check if a specific port is available
   */
  async isPortAvailable(serverId, port) {
    try {
      const allocation = deploymentDb.db.prepare(
        'SELECT * FROM port_allocations WHERE server_id = ? AND port = ?'
      ).get(serverId, port);

      return !allocation; // Available if no allocation exists
    } catch (error) {
      console.error('Error checking port availability:', error);
      return false;
    }
  }

  /**
   * Find any available port in the server's range
   */
  async findAvailablePort(serverId) {
    try {
      const server = deploymentDb.getServerById(serverId);
      if (!server) throw new Error('Server not found');

      // Get all allocated ports for this server
      const allocatedPorts = deploymentDb.db.prepare(
        'SELECT port FROM port_allocations WHERE server_id = ?'
      ).all(serverId);
      
      const usedPorts = new Set(allocatedPorts.map(p => p.port));

      // Find first available port in range
      for (let port = server.port_range_start; port <= server.port_range_end; port++) {
        if (!usedPorts.has(port)) {
          return port;
        }
      }

      return null; // No available ports
    } catch (error) {
      console.error('Error finding available port:', error);
      return null;
    }
  }

  /**
   * Reserve a port for a deployment
   */
  async reservePort(serverId, port, deploymentId = null) {
    try {
      const reservedUntil = new Date(Date.now() + this.portReservationTimeout);
      
      deploymentDb.db.prepare(`
        INSERT OR REPLACE INTO port_allocations 
        (server_id, port, deployment_id, reserved_until)
        VALUES (?, ?, ?, ?)
      `).run(serverId, port, deploymentId, reservedUntil.toISOString());

      console.log(`🔒 Reserved port ${port} on server ${serverId} until ${reservedUntil.toISOString()}`);
      return true;
    } catch (error) {
      console.error('Error reserving port:', error);
      throw error;
    }
  }

  /**
   * Release a port allocation
   */
  async releasePort(serverId, port) {
    try {
      deploymentDb.releasePort(serverId, port);
      console.log(`🔓 Released port ${port} on server ${serverId}`);
      return true;
    } catch (error) {
      console.error('Error releasing port:', error);
      throw error;
    }
  }

  /**
   * Update port allocation to be permanent (tied to deployment)
   */
  async assignPortToDeployment(serverId, port, deploymentId) {
    try {
      deploymentDb.db.prepare(`
        UPDATE port_allocations 
        SET deployment_id = ?, reserved_until = NULL
        WHERE server_id = ? AND port = ?
      `).run(deploymentId, serverId, port);

      console.log(`📌 Assigned port ${port} to deployment ${deploymentId}`);
      return true;
    } catch (error) {
      console.error('Error assigning port to deployment:', error);
      throw error;
    }
  }

  /**
   * Clean up expired port reservations
   */
  async cleanupExpiredReservations(serverId = null) {
    try {
      let query = `
        DELETE FROM port_allocations 
        WHERE reserved_until IS NOT NULL 
        AND reserved_until < datetime('now')
      `;
      let params = [];

      if (serverId) {
        query += ' AND server_id = ?';
        params.push(serverId);
      }

      const result = deploymentDb.db.prepare(query).run(...params);
      
      if (result.changes > 0) {
        console.log(`🧹 Cleaned up ${result.changes} expired port reservations`);
      }
      
      return result.changes;
    } catch (error) {
      console.error('Error cleaning up expired reservations:', error);
      return 0;
    }
  }

  /**
   * Get port usage statistics for a server
   */
  async getPortUsageStats(serverId) {
    try {
      const server = deploymentDb.getServerById(serverId);
      if (!server) throw new Error('Server not found');

      const totalPorts = server.port_range_end - server.port_range_start + 1;
      
      const allocatedPorts = deploymentDb.db.prepare(
        'SELECT COUNT(*) as count FROM port_allocations WHERE server_id = ?'
      ).get(serverId);

      const activePorts = deploymentDb.db.prepare(`
        SELECT COUNT(*) as count FROM port_allocations pa
        JOIN branch_deployments bd ON pa.deployment_id = bd.id
        WHERE pa.server_id = ? AND bd.status = 'running'
      `).get(serverId);

      return {
        total: totalPorts,
        allocated: allocatedPorts.count,
        active: activePorts.count,
        available: totalPorts - allocatedPorts.count,
        range: `${server.port_range_start}-${server.port_range_end}`
      };
    } catch (error) {
      console.error('Error getting port usage stats:', error);
      throw error;
    }
  }

  /**
   * Check for port conflicts across deployments
   */
  async checkPortConflicts(serverId) {
    try {
      const conflicts = deploymentDb.db.prepare(`
        SELECT pa.port, COUNT(*) as conflict_count
        FROM port_allocations pa
        WHERE pa.server_id = ?
        GROUP BY pa.port
        HAVING COUNT(*) > 1
      `).all(serverId);

      if (conflicts.length > 0) {
        console.warn(`⚠️ Found ${conflicts.length} port conflicts on server ${serverId}:`, conflicts);
      }

      return conflicts;
    } catch (error) {
      console.error('Error checking port conflicts:', error);
      return [];
    }
  }

  /**
   * Get all port allocations for a server (for debugging)
   */
  async getServerPortAllocations(serverId) {
    try {
      const allocations = deploymentDb.db.prepare(`
        SELECT pa.*, bd.username, bd.branch, bd.status as deployment_status
        FROM port_allocations pa
        LEFT JOIN branch_deployments bd ON pa.deployment_id = bd.id
        WHERE pa.server_id = ?
        ORDER BY pa.port ASC
      `).all(serverId);

      return allocations;
    } catch (error) {
      console.error('Error getting server port allocations:', error);
      return [];
    }
  }
}

// Export singleton instance
export default new PortManager();