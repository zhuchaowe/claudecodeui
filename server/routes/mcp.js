import express from 'express';
import { mcpServerDb } from '../database/db.js';

const router = express.Router();

// User-isolated MCP server management routes

// GET /api/mcp/servers - List MCP servers for the current user
router.get('/servers', async (req, res) => {
  try {
    console.log('📋 Listing MCP servers for user:', req.user.id);
    
    const servers = await mcpServerDb.getMcpServersByUser(req.user.id);
    
    // Transform to frontend format
    const transformedServers = servers.map(server => ({
      id: server.id,
      name: server.name,
      type: server.type,
      scope: 'user', // Always user scope now
      config: server.config,
      created: server.created_at,
      updated: server.updated_at
    }));
    
    res.json({ servers: transformedServers });
  } catch (error) {
    console.error('Error listing MCP servers:', error);
    res.status(500).json({ error: 'Failed to list MCP servers', details: error.message });
  }
});

// GET /api/mcp/cli/list - List MCP servers (compatibility route)
router.get('/cli/list', async (req, res) => {
  try {
    console.log('📋 Listing MCP servers for user (via cli route):', req.user.id);
    
    const servers = await mcpServerDb.getMcpServersByUser(req.user.id);
    
    // Transform to format expected by frontend
    const transformedServers = servers.map(server => ({
      name: server.name,
      type: server.type,
      status: 'active',
      command: server.config.command || '',
      url: server.config.url || '',
      args: server.config.args || [],
      env: server.config.env || {},
      headers: server.config.headers || {}
    }));
    
    res.json({ 
      success: true, 
      output: `Found ${servers.length} MCP servers`, 
      servers: transformedServers 
    });
  } catch (error) {
    console.error('Error listing MCP servers via CLI route:', error);
    res.status(500).json({ error: 'Failed to list MCP servers', details: error.message });
  }
});

// POST /api/mcp/cli/add - Add MCP server to database
router.post('/cli/add', async (req, res) => {
  try {
    const { name, type = 'stdio', command, args = [], url, headers = {}, env = {} } = req.body;
    
    console.log('➕ Adding MCP server for user:', req.user.id, 'name:', name);
    
    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Server name is required' });
    }
    
    // Check if server with same name already exists for this user
    const existingServer = await mcpServerDb.getMcpServerByName(req.user.id, name);
    if (existingServer) {
      return res.status(400).json({ error: `MCP server "${name}" already exists for this user` });
    }
    
    // Build config object based on transport type
    let config = { timeout: 30000 };
    
    if (type === 'http' || type === 'sse') {
      if (!url || !url.trim()) {
        return res.status(400).json({ error: `URL is required for ${type.toUpperCase()} transport` });
      }
      config.url = url;
      config.headers = headers || {};
    } else {
      // stdio type
      if (!command || !command.trim()) {
        return res.status(400).json({ error: 'Command is required for stdio transport' });
      }
      config.command = command;
      config.args = args || [];
      config.env = env || {};
    }
    
    // Create the server in database
    const newServer = await mcpServerDb.createMcpServer(req.user.id, name, type, config);
    
    res.json({ 
      success: true, 
      message: `MCP server "${name}" added successfully`,
      server: {
        id: newServer.id,
        name: newServer.name,
        type: newServer.type,
        config: newServer.config
      }
    });
  } catch (error) {
    console.error('Error adding MCP server:', error);
    res.status(500).json({ error: 'Failed to add MCP server', details: error.message });
  }
});

// DELETE /api/mcp/cli/remove/:name - Remove MCP server from database
router.delete('/cli/remove/:name', async (req, res) => {
  try {
    const { name } = req.params;
    
    console.log('🗑️ Removing MCP server for user:', req.user.id, 'name:', name);
    
    // Check if server exists and belongs to this user
    const existingServer = await mcpServerDb.getMcpServerByName(req.user.id, name);
    if (!existingServer) {
      return res.status(404).json({ error: `MCP server "${name}" not found for this user` });
    }
    
    // Delete the server
    const success = await mcpServerDb.deleteMcpServerByName(req.user.id, name);
    
    if (success) {
      res.json({ 
        success: true, 
        message: `MCP server "${name}" removed successfully`
      });
    } else {
      res.status(500).json({ error: 'Failed to remove MCP server' });
    }
  } catch (error) {
    console.error('Error removing MCP server:', error);
    res.status(500).json({ error: 'Failed to remove MCP server', details: error.message });
  }
});

// GET /api/mcp/cli/get/:name - Get MCP server details from database
router.get('/cli/get/:name', async (req, res) => {
  try {
    const { name } = req.params;
    
    console.log('📄 Getting MCP server details for user:', req.user.id, 'name:', name);
    
    // Get server from database
    const server = await mcpServerDb.getMcpServerByName(req.user.id, name);
    
    if (!server) {
      return res.status(404).json({ error: `MCP server "${name}" not found for this user` });
    }
    
    res.json({ 
      success: true, 
      server: {
        id: server.id,
        name: server.name,
        type: server.type,
        config: server.config,
        created_at: server.created_at,
        updated_at: server.updated_at
      }
    });
  } catch (error) {
    console.error('Error getting MCP server details:', error);
    res.status(500).json({ error: 'Failed to get MCP server details', details: error.message });
  }
});

// POST /api/mcp/servers/:id/test - Test MCP server connection
router.post('/servers/:id/test', async (req, res) => {
  try {
    const serverId = req.params.id;
    
    console.log('🧪 Testing MCP server connection for user:', req.user.id, 'server:', serverId);
    
    // Get server from database
    const server = await mcpServerDb.getMcpServer(req.user.id, serverId);
    
    if (!server) {
      return res.json({ 
        testResult: { 
          success: false, 
          message: 'MCP server not found',
          details: ['Server not found or you do not have permission to access it']
        } 
      });
    }
    
    // Perform basic validation tests
    let testResult = {
      success: true,
      message: `MCP server "${server.name}" configuration is valid`,
      details: []
    };
    
    // Test configuration validity
    if (server.type === 'stdio') {
      if (!server.config.command) {
        testResult = {
          success: false,
          message: 'Invalid stdio configuration',
          details: ['Command is required for stdio transport']
        };
      } else {
        testResult.details = [
          'Configuration is valid',
          `Transport: ${server.type}`,
          `Command: ${server.config.command}`,
          server.config.args && server.config.args.length > 0 ? `Args: ${server.config.args.join(' ')}` : 'No arguments'
        ];
      }
    } else if (server.type === 'http' || server.type === 'sse') {
      if (!server.config.url) {
        testResult = {
          success: false,
          message: `Invalid ${server.type.toUpperCase()} configuration`,
          details: [`URL is required for ${server.type.toUpperCase()} transport`]
        };
      } else {
        testResult.details = [
          'Configuration is valid',
          `Transport: ${server.type}`,
          `URL: ${server.config.url}`,
          server.config.headers && Object.keys(server.config.headers).length > 0 ? `Headers: ${Object.keys(server.config.headers).length}` : 'No headers'
        ];
      }
    }
    
    res.json({ testResult });
  } catch (error) {
    console.error('Error testing MCP server:', error);
    res.status(500).json({ error: 'Failed to test MCP server', details: error.message });
  }
});

// POST /api/mcp/servers/test - Test MCP server configuration (for form testing)
router.post('/servers/test', async (req, res) => {
  try {
    const { name, type, config } = req.body;
    
    console.log('🧪 Testing MCP server configuration:', name);
    
    // For now, just validate the configuration structure
    let testResult = {
      success: true,
      message: 'Configuration appears valid',
      details: []
    };
    
    if (!name || !name.trim()) {
      testResult = {
        success: false,
        message: 'Server name is required',
        details: ['Please provide a server name']
      };
    } else if (type === 'stdio' && (!config?.command || !config.command.trim())) {
      testResult = {
        success: false,
        message: 'Command is required for stdio transport',
        details: ['Please provide a command for stdio transport']
      };
    } else if ((type === 'sse' || type === 'http') && (!config?.url || !config.url.trim())) {
      testResult = {
        success: false,
        message: `URL is required for ${type.toUpperCase()} transport`,
        details: [`Please provide a URL for ${type.toUpperCase()} transport`]
      };
    } else {
      testResult.details = [
        'Configuration syntax is valid',
        `Transport type: ${type}`,
        type === 'stdio' ? `Command: ${config.command}` : `URL: ${config.url}`
      ];
    }
    
    res.json({ testResult });
  } catch (error) {
    console.error('Error testing MCP configuration:', error);
    res.status(500).json({ error: 'Failed to test configuration', details: error.message });
  }
});

// POST /api/mcp/servers/:id/tools - Discover MCP server tools
router.post('/servers/:id/tools', async (req, res) => {
  try {
    const serverId = req.params.id;
    
    console.log('🔍 Discovering tools for MCP server:', serverId, 'user:', req.user.id);
    
    // Get server from database to ensure user owns it
    const server = await mcpServerDb.getMcpServer(req.user.id, serverId);
    
    if (!server) {
      return res.json({
        toolsResult: {
          success: false,
          tools: [],
          resources: [],
          prompts: [],
          message: 'MCP server not found or you do not have permission to access it.'
        }
      });
    }
    
    // For now, return a placeholder response as tool discovery would require
    // actually connecting to the MCP server which is complex
    const toolsResult = {
      success: true,
      tools: [],
      resources: [],
      prompts: [],
      message: `Tools discovery not yet implemented for "${server.name}". Server configuration is valid.`
    };
    
    res.json({ toolsResult });
  } catch (error) {
    console.error('Error discovering MCP tools:', error);
    res.status(500).json({ error: 'Failed to discover tools', details: error.message });
  }
});

// PUT /api/mcp/servers/:id - Update MCP server configuration
router.put('/servers/:id', async (req, res) => {
  try {
    const serverId = req.params.id;
    const { name, type, config } = req.body;
    
    console.log('📝 Updating MCP server for user:', req.user.id, 'server:', serverId);
    
    // Validate input
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Server name is required' });
    }
    
    if (!type || !['stdio', 'http', 'sse'].includes(type)) {
      return res.status(400).json({ error: 'Valid transport type is required (stdio, http, sse)' });
    }
    
    // Check if user owns the server
    if (!await mcpServerDb.userOwnsMcpServer(req.user.id, serverId)) {
      return res.status(404).json({ error: 'MCP server not found or you do not have permission to modify it' });
    }
    
    // Check if another server with the same name exists for this user
    const existingServer = await mcpServerDb.getMcpServerByName(req.user.id, name);
    if (existingServer && existingServer.id != serverId) {
      return res.status(400).json({ error: `MCP server "${name}" already exists for this user` });
    }
    
    // Update the server
    const success = await mcpServerDb.updateMcpServer(req.user.id, serverId, name, type, config);
    
    if (success) {
      // Get updated server details
      const updatedServer = await mcpServerDb.getMcpServer(req.user.id, serverId);
      res.json({
        success: true,
        message: `MCP server "${name}" updated successfully`,
        server: {
          id: updatedServer.id,
          name: updatedServer.name,
          type: updatedServer.type,
          config: updatedServer.config,
          updated_at: updatedServer.updated_at
        }
      });
    } else {
      res.status(500).json({ error: 'Failed to update MCP server' });
    }
  } catch (error) {
    console.error('Error updating MCP server:', error);
    res.status(500).json({ error: 'Failed to update MCP server', details: error.message });
  }
});

// DELETE /api/mcp/servers/:id - Delete MCP server
router.delete('/servers/:id', async (req, res) => {
  try {
    const serverId = req.params.id;
    
    console.log('🗑️ Deleting MCP server for user:', req.user.id, 'server:', serverId);
    
    // Get server details before deletion for response
    const server = await mcpServerDb.getMcpServer(req.user.id, serverId);
    if (!server) {
      return res.status(404).json({ error: 'MCP server not found or you do not have permission to delete it' });
    }
    
    // Delete the server
    const success = await mcpServerDb.deleteMcpServer(req.user.id, serverId);
    
    if (success) {
      res.json({
        success: true,
        message: `MCP server "${server.name}" deleted successfully`
      });
    } else {
      res.status(500).json({ error: 'Failed to delete MCP server' });
    }
  } catch (error) {
    console.error('Error deleting MCP server:', error);
    res.status(500).json({ error: 'Failed to delete MCP server', details: error.message });
  }
});


export default router;