/**
 * Job Assignment Service - Core backend logic for matching drivers to jobs
 * Handles geospatial queries, driver availability, and assignment algorithms
 */
const redis = require('redis');

class JobAssignmentService {
  constructor() {
    this.redisClient = redis.createClient();
    this.assignmentRadius = 5000; // 5km radius in meters
    this.maxJobsPerDriver = 3; // Prevent driver overload
  }

  /**
   * Find available drivers within radius of pickup location using Haversine formula
   * @param {Object} pickupLocation - {lat, lng}
   * @param {number} radiusKm - Search radius in kilometers
   * @returns {Array} Available driver IDs sorted by proximity
   */
  async findNearbyDrivers(pickupLocation, radiusKm = 5) {
    try {
      // Get all active drivers from Redis cache
      const allDrivers = await this.redisClient.hgetall('active_drivers');
      const eligibleDrivers = [];
      
      // Calculate distance for each driver using Haversine formula 
      for (const [driverId, driverData] of Object.entries(allDrivers)) {
        const driver = JSON.parse(driverData);
        const distance = this.calculateDistance(pickupLocation, { lat: driver.lat, lng: driver.lng });
        
        // Check if driver is within radius
        if (distance <= radiusKm) {
          // Check availability and job capacity
          const isAvailable = await this.isDriverAvailable(driverId);
          const currentJobCount = await this.getDriverJobCount(driverId);
          
          if (isAvailable && currentJobCount < this.maxJobsPerDriver) {
            eligibleDrivers.push({
              driverId,
              distance: distance,
              priority: this.calculateDriverPriority(driverId, distance),
              ...driver
            });
          }
        }
      }

      return eligibleDrivers.sort((a, b) => b.priority - a.priority);
    } catch (error) {
      console.error('Error finding nearby drivers:', error);
      throw error;
    }
  }

  /**
   * Assign job to the best available driver using intelligent routing
   * @param {Object} job - Job details with pickup/delivery coordinates
   * @returns {Object} Assignment result with driver and estimated time
   */
  async assignJobToDriver(job) {
    const nearbyDrivers = await this.findNearbyDrivers(job.pickup);
    
    if (nearbyDrivers.length === 0) {
      throw new Error('No available drivers in the area');
    }

    // Try to assign to drivers in order of priority
    for (const driver of nearbyDrivers.slice(0, 3)) { // Try top 3 drivers
      try {
        const assignment = await this.attemptJobAssignment(job.id, driver.driverId);
        if (assignment.success) {
          return {
            success: true,
            assignedDriver: driver.driverId,
            estimatedPickupTime: this.calculateETA(driver, job.pickup),
            assignmentId: assignment.id
          };
        }
      } catch (error) {
        console.log(`Failed to assign to driver ${driver.driverId}, trying next...`);
        continue;
      }
    }

    throw new Error('Unable to assign job to any available driver');
  }

  /**
   * Atomic job assignment with database transaction
   * Prevents race conditions when multiple jobs compete for same driver
   */
  async attemptJobAssignment(jobId, driverId) {
    // In production: Use MongoDB transactions
    // const session = await mongoose.startSession();
    // await session.withTransaction(async () => {
    //   await Job.findOneAndUpdate(
    //     { _id: jobId, assigned_driver_id: null },
    //     { assigned_driver_id: driverId, status: 'assigned', accepted_at: new Date() }
    //   );
    // });

    const assignmentId = `assign_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Store assignment in Redis with expiry
    await this.redisClient.setex(
      `job_assignment:${jobId}`,
      1800, // 30 minutes
      JSON.stringify({
        assignmentId,
        driverId,
        jobId,
        assignedAt: new Date().toISOString()
      })
    );

    return { success: true, id: assignmentId };
  }

  /**
   * Calculate driver priority based on multiple factors
   * @param {string} driverId 
   * @param {number} distance - Distance to pickup in km
   * @returns {number} Priority score (higher = better)
   */
  calculateDriverPriority(driverId, distance) {
    // Scoring algorithm considering multiple factors
    let score = 100;
    
    // Distance factor (closer is better)
    score -= distance * 5; // Subtract 5 points per km
    
    // Driver rating factor (mock - in production get from database)
    const driverRating = 4.2; // Mock rating out of 5
    score += (driverRating - 3) * 20; // Bonus for high ratings
    
    // Completion rate factor
    const completionRate = 0.95; // Mock 95% completion rate
    score += (completionRate - 0.8) * 50; // Bonus for reliability
    
    // Recent activity bonus (active drivers get priority)
    const lastActiveMinutes = 5; // Mock: last seen 5 minutes ago
    if (lastActiveMinutes < 10) {
      score += 10; // Bonus for recent activity
    }

    return Math.max(0, score); // Ensure non-negative score
  }

  /**
   * Calculate estimated time of arrival for driver to pickup location
   */
  calculateETA(driver, pickupLocation) {
    const baseSpeedKmh = 25; // Average city driving speed
    const etaMinutes = (driver.distance / baseSpeedKmh) * 60;
    const bufferMinutes = 3; // Add buffer for traffic/stops
    
    return Math.ceil(etaMinutes + bufferMinutes);
  }

  /**
   * Check if driver is currently available for new jobs
   */
  async isDriverAvailable(driverId) {
    const status = await this.redisClient.hget(`driver:${driverId}`, 'status');
    return status === 'available' || status === 'online';
  }

  /**
   * Get current number of active jobs for a driver
   */
  async getDriverJobCount(driverId) {
    const count = await this.redisClient.hget(`driver:${driverId}`, 'active_jobs');
    return parseInt(count) || 0;
  }

  /**
   * Calculate distance between two coordinates using Haversine formula
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

  /**
   * Convert degrees to radians
   */
  toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }

  /**
   * Update driver location in cache
   * @param {string} driverId 
   * @param {Object} location - {lat, lng}
   */
  async updateDriverLocation(driverId, location) {
    try {
      // Store location in Redis cache with timestamp
      await this.redisClient.hset(`driver:${driverId}`, {
        lat: location.lat,
        lng: location.lng,
        last_update: Date.now(),
        timestamp: new Date().toISOString()
      });

      // Also update active drivers list for quick access
      const driverData = {
        lat: location.lat,
        lng: location.lng,
        last_update: Date.now()
      };
      await this.redisClient.hset('active_drivers', driverId, JSON.stringify(driverData));

      console.log(`Updated location for driver ${driverId}: ${location.lat}, ${location.lng}`);
    } catch (error) {
      console.error('Failed to update driver location:', error);
      throw error;
    }
  }

  /**
   * Get real-time statistics for monitoring
   */
  async getSystemStats() {
    const totalDrivers = await this.redisClient.zcard('driver_locations');
    const availableDrivers = await this.redisClient.hlen('available_drivers');
    
    return {
      totalActiveDrivers: totalDrivers,
      availableDrivers: availableDrivers,
      averageResponseTime: '2.3s', // Mock metric
      assignmentSuccessRate: '94%', // Mock metric
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = JobAssignmentService;