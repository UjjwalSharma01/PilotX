/**
 * Location Processing Service - Efficient GPS data handling and battery optimization
 * Manages location updates, validates accuracy, and implements smart update intervals
 */
const redis = require('redis');

class LocationProcessingService {
  constructor() {
    this.redisClient = redis.createClient();
    this.minAccuracy = 50; // Reject GPS readings worse than 50m
    this.maxUpdateFrequency = 5000; // Minimum 5 seconds between updates
    this.locationHistory = new Map(); // In-memory cache for recent locations
  }

  /**
   * Process incoming location update with validation and optimization
   * @param {string} driverId 
   * @param {Object} locationData - GPS coordinates and metadata
   * @returns {Object} Processing result with next update interval
   */
  async processLocationUpdate(driverId, locationData) {
    const { lat, lng, accuracy, battery, isMoving, timestamp } = locationData;
    
    try {
      // Validate GPS accuracy
      if (accuracy > this.minAccuracy) {
        return {
          success: false,
          error: 'GPS accuracy too low',
          nextInterval: 30,
          recommendation: 'Move to area with better GPS signal'
        };
      }

      // Rate limiting check
      const lastUpdate = await this.getLastUpdateTime(driverId);
      const timeSinceLastUpdate = Date.now() - lastUpdate;
      
      if (timeSinceLastUpdate < this.maxUpdateFrequency) {
        return {
          success: false,
          error: 'Update too frequent',
          nextInterval: Math.ceil((this.maxUpdateFrequency - timeSinceLastUpdate) / 1000),
          waitTime: this.maxUpdateFrequency - timeSinceLastUpdate
        };
      }

      // Detect significant movement to avoid spam updates
      const lastLocation = await this.getLastLocation(driverId);
      if (lastLocation && !this.hasSignificantMovement(lastLocation, { lat, lng })) {
        return {
          success: false,
          error: 'Insignificant movement',
          nextInterval: this.calculateStaticInterval(battery),
          message: 'Location not significantly changed'
        };
      }

      // Process and store the location
      await this.storeLocation(driverId, {
        lat,
        lng,
        accuracy,
        battery,
        isMoving,
        timestamp: timestamp || new Date().toISOString(),
        processed_at: Date.now()
      });

      // Calculate optimized next update interval
      const nextInterval = this.calculateNextUpdateInterval({
        battery,
        isMoving,
        hasActiveJob: await this.hasActiveJob(driverId),
        accuracy,
        timeOfDay: new Date().getHours()
      });

      // Update driver location in active drivers cache for Haversine calculations
      await this.updateDriverLocationCache(driverId, lat, lng);

      return {
        success: true,
        nextUpdateInterval: nextInterval,
        batteryOptimized: battery < 30,
        locationStored: true,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Location processing error:', error);
      throw error;
    }
  }

  /**
   * Smart calculation of next GPS update interval based on context
   * Balances real-time accuracy with battery conservation
   */
  calculateNextUpdateInterval(context) {
    const { battery, isMoving, hasActiveJob, accuracy, timeOfDay } = context;
    
    let interval = 20; // Base interval in seconds

    // Battery level adjustments
    if (battery < 15) interval = 120;      // Critical battery: 2 minutes
    else if (battery < 25) interval = 90;  // Low battery: 1.5 minutes
    else if (battery < 40) interval = 60;  // Medium battery: 1 minute

    // Job status adjustments
    if (hasActiveJob) {
      interval = Math.min(interval, 15); // Active job: max 15 seconds
    } else {
      interval = Math.max(interval, 30); // Idle: minimum 30 seconds
    }

    // Movement-based adjustments
    if (!isMoving) {
      interval = Math.max(interval, 45); // Stationary: minimum 45 seconds
    }

    // GPS accuracy adjustments
    if (accuracy > 20) {
      interval += 10; // Poor GPS: longer intervals
    }

    // Time-based adjustments (less frequent during night hours)
    if (timeOfDay < 6 || timeOfDay > 22) {
      interval = Math.max(interval, 60); // Night time: minimum 1 minute
    }

    return Math.min(interval, 300); // Cap at 5 minutes maximum
  }

  /**
   * Detect if location change is significant enough to warrant an update
   * Prevents spam updates when driver is stationary
   */
  hasSignificantMovement(lastLocation, newLocation) {
    const distance = this.calculateDistance(lastLocation, newLocation);
    
    // Consider movement significant if > 10 meters
    return distance > 0.01; // ~10 meters in km
  }

  /**
   * Calculate distance between two GPS coordinates using Haversine formula
   */
  calculateDistance(point1, point2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(point2.lat - point1.lat);
    const dLng = this.toRadians(point2.lng - point1.lng);
    
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(this.toRadians(point1.lat)) * Math.cos(this.toRadians(point2.lat)) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // Distance in kilometers
  }

  toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }

  /**
   * Store location data with efficient Redis operations
   */
  async storeLocation(driverId, locationData) {
    const key = `driver:location:${driverId}`;
    
    // Store current location with expiry
    await this.redisClient.setex(
      key,
      3600, // 1 hour expiry
      JSON.stringify(locationData)
    );

    // Update driver status
    await this.redisClient.hset(`driver:status:${driverId}`, {
      last_seen: Date.now(),
      lat: locationData.lat,
      lng: locationData.lng,
      battery: locationData.battery,
      is_moving: locationData.isMoving
    });

    // Store in location history for pattern analysis
    await this.redisClient.lpush(
      `driver:history:${driverId}`,
      JSON.stringify({
        lat: locationData.lat,
        lng: locationData.lng,
        timestamp: locationData.timestamp
      })
    );
    
    // Keep only last 20 location points
    await this.redisClient.ltrim(`driver:history:${driverId}`, 0, 19);
  }

  /**
   * Update driver location in cache for Haversine-based calculations
   */
  async updateDriverLocationCache(driverId, lat, lng) {
    // Store in active drivers cache for job assignment service
    const driverData = {
      lat: lat,
      lng: lng,
      last_update: Date.now(),
      timestamp: new Date().toISOString()
    };
    
    await this.redisClient.hset('active_drivers', driverId, JSON.stringify(driverData));
  }

  /**
   * Get driver's last known location
   */
  async getLastLocation(driverId) {
    const locationJson = await this.redisClient.get(`driver:location:${driverId}`);
    return locationJson ? JSON.parse(locationJson) : null;
  }

  /**
   * Get timestamp of last location update
   */
  async getLastUpdateTime(driverId) {
    const status = await this.redisClient.hget(`driver:status:${driverId}`, 'last_seen');
    return parseInt(status) || 0;
  }

  /**
   * Check if driver has an active job
   */
  async hasActiveJob(driverId) {
    const jobCount = await this.redisClient.hget(`driver:${driverId}`, 'active_jobs');
    return parseInt(jobCount) > 0;
  }

  /**
   * Calculate interval for stationary drivers
   */
  calculateStaticInterval(battery) {
    if (battery < 20) return 180; // 3 minutes for low battery
    if (battery < 50) return 120; // 2 minutes for medium battery
    return 90; // 1.5 minutes for good battery
  }

  /**
   * Batch process multiple location updates for efficiency
   * Useful during high-traffic periods
   */
  async batchProcessLocations(locationUpdates) {
    const results = [];
    const pipeline = this.redisClient.pipeline();
    
    for (const update of locationUpdates) {
      try {
        const result = await this.processLocationUpdate(update.driverId, update.locationData);
        results.push({ driverId: update.driverId, result });
      } catch (error) {
        results.push({ 
          driverId: update.driverId, 
          error: error.message 
        });
      }
    }
    
    await pipeline.exec();
    return results;
  }

  /**
   * Get location processing statistics for monitoring
   */
  async getProcessingStats() {
    const activeDrivers = await this.redisClient.zcard('driver_locations');
    const totalUpdates = await this.redisClient.get('location_updates_count') || 0;
    
    return {
      activeDriversTracked: activeDrivers,
      totalUpdatesProcessed: parseInt(totalUpdates),
      averageAccuracy: '12m', // Mock metric
      batteryOptimizationRate: '73%', // Mock metric
      updateFrequency: '18s avg', // Mock metric
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = LocationProcessingService;