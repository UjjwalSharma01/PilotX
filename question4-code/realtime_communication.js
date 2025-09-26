/**
 * Real-time Communication Hub - WebSocket server for driver notifications
 * Handles job assignments, status updates, and system alerts
 */
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const redis = require('redis');

class DriverWebSocketServer {
  constructor(options = {}) {
    this.port = options.port || 8080;
    this.connectedDrivers = new Map();
    this.redisClient = redis.createClient();
    this.heartbeatInterval = 30000; // 30 seconds
    
    this.initializeServer();
  }
  
  initializeServer() {
    this.wss = new WebSocket.Server({ 
      port: this.port,
      verifyClient: (info) => {
        // Basic rate limiting and origin validation
        return true; // In production: validate origin and implement rate limiting
      }
    });
    
    this.wss.on('connection', (ws, request) => {
      this.handleNewConnection(ws, request);
    });
    
    // Periodic cleanup of stale connections
    setInterval(() => {
      this.cleanupStaleConnections();
    }, this.heartbeatInterval);
    
    console.log(`Driver WebSocket server running on port ${this.port}`);
  }
  
  handleNewConnection(ws, request) {
    console.log('New WebSocket connection established');
    
    ws.isAlive = true;
    ws.connectionTime = Date.now();
    
    // Handle incoming messages
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        this.handleMessage(ws, data);
      } catch (error) {
        console.error('Invalid message format:', error);
        ws.send(JSON.stringify({ 
          type: 'error', 
          message: 'Invalid message format' 
        }));
      }
    });
    
    // Handle connection close
    ws.on('close', () => {
      this.handleDisconnection(ws);
    });
    
    // Handle connection errors
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
    
    // Heartbeat for connection health
    ws.on('pong', () => {
      ws.isAlive = true;
    });
  }
  
  handleMessage(ws, data) {
    switch(data.type) {
      case 'authenticate':
        this.authenticateDriver(ws, data);
        break;
        
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        break;
        
      case 'location_update':
        this.handleLocationUpdate(ws, data);
        break;
        
      case 'job_response':
        this.handleJobResponse(ws, data);
        break;
        
      default:
        console.log('Unknown message type:', data.type);
    }
  }
  
  async authenticateDriver(ws, data) {
    try {
      const { token, driverId } = data;
      
      // In production: Verify JWT token
      // const decoded = jwt.verify(token, process.env.JWT_SECRET);
      // if (decoded.driverId !== driverId) throw new Error('Invalid token');
      
      ws.driverId = driverId;
      ws.isAuthenticated = true;
      
      // Store connection mapping
      this.connectedDrivers.set(driverId, ws);
      
      // Store in Redis for horizontal scaling
      await this.redisClient.setex(
        `driver:ws:${driverId}`, 
        300, // 5 minute expiry
        JSON.stringify({
          serverId: process.env.SERVER_ID || 'server-1',
          connectionTime: ws.connectionTime
        })
      );
      
      ws.send(JSON.stringify({
        type: 'authenticated',
        driverId: driverId,
        serverTime: Date.now()
      }));
      
      console.log(`Driver ${driverId} authenticated successfully`);
      
    } catch (error) {
      console.error('Authentication failed:', error);
      ws.send(JSON.stringify({
        type: 'auth_failed',
        message: 'Authentication failed'
      }));
      ws.close();
    }
  }
  
  handleLocationUpdate(ws, data) {
    if (!ws.isAuthenticated) {
      ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
      return;
    }
    
    // Store location in Redis for real-time tracking
    this.redisClient.setex(
      `driver:location:${ws.driverId}`,
      300, // 5 minute expiry
      JSON.stringify({
        lat: data.lat,
        lng: data.lng,
        timestamp: Date.now()
      })
    );
  }
  
  handleJobResponse(ws, data) {
    const { jobId, response, timestamp } = data; // response: 'accept' | 'decline'
    
    console.log(`Driver ${ws.driverId} ${response}ed job ${jobId}`);
    
    // Notify job management system
    this.notifyJobSystem(ws.driverId, jobId, response, timestamp);
  }
  
  handleDisconnection(ws) {
    if (ws.driverId) {
      this.connectedDrivers.delete(ws.driverId);
      
      // Remove from Redis
      this.redisClient.del(`driver:ws:${ws.driverId}`);
      
      console.log(`Driver ${ws.driverId} disconnected`);
    }
  }
  
  // Clean up stale connections
  cleanupStaleConnections() {
    this.wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        ws.terminate();
        return;
      }
      
      ws.isAlive = false;
      ws.ping();
    });
  }
  
  // Send job offer to specific driver
  sendJobOffer(driverId, jobData, timeoutSeconds = 30) {
    const driver = this.connectedDrivers.get(driverId);
    
    if (driver && driver.isAuthenticated) {
      driver.send(JSON.stringify({
        type: 'job_offer',
        payload: {
          job: jobData,
          timeoutSeconds: timeoutSeconds,
          expiresAt: new Date(Date.now() + timeoutSeconds * 1000).toISOString()
        }
      }));
      
      return true; // Successfully sent via WebSocket
    } else {
      // Driver not connected - send push notification
      this.sendPushNotification(driverId, {
        title: 'New Job Available',
        body: `$${jobData.payout} • ${jobData.distance}km`,
        data: { jobId: jobData.id }
      });
      
      return false; // Fallback to push notification
    }
  }
  
  // Broadcast job cancellation to all drivers
  broadcastJobCancellation(jobId) {
    const message = JSON.stringify({
      type: 'job_cancelled',
      payload: { jobId }
    });
    
    this.connectedDrivers.forEach((ws, driverId) => {
      if (ws.isAuthenticated) {
        ws.send(message);
      }
    });
  }
  
  // Send system alert to all connected drivers
  broadcastSystemAlert(alertMessage, priority = 'normal') {
    const message = JSON.stringify({
      type: 'system_alert',
      payload: {
        message: alertMessage,
        priority: priority,
        timestamp: Date.now()
      }
    });
    
    this.connectedDrivers.forEach((ws, driverId) => {
      if (ws.isAuthenticated) {
        ws.send(message);
      }
    });
  }
  
  // Fallback push notification service
  sendPushNotification(driverId, notification) {
    // In production: Integration with FCM/APNS
    console.log(`Sending push notification to driver ${driverId}:`, notification);
    
    // Mock push service call
    // pushService.send(driverId, notification);
  }
  
  // Notify job management system of driver responses
  notifyJobSystem(driverId, jobId, response, timestamp) {
    // In production: Publish to message queue or call job service API
    console.log(`Job system notified: Driver ${driverId} ${response}ed job ${jobId}`);
  }
  
  // Get connection statistics
  getStats() {
    return {
      totalConnections: this.wss.clients.size,
      authenticatedDrivers: this.connectedDrivers.size,
      uptime: process.uptime(),
      timestamp: Date.now()
    };
  }
}

// Initialize WebSocket server
const wsServer = new DriverWebSocketServer({
  port: process.env.WS_PORT || 8080
});

module.exports = { DriverWebSocketServer, wsServer };