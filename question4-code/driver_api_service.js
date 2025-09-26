/**
 * Driver API Service - Simple implementation for mobile app
 * Handles job management, location updates, and battery optimization
 */
const express = require('express');
const redis = require('redis');
const rateLimit = require('express-rate-limit');

const app = express();
const redisClient = redis.createClient();

app.use(express.json({ limit: '10mb' }));

// Rate limiting for mobile clients
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200, // Max 200 requests per minute per IP
  message: { error: 'Rate limit exceeded' }
});
app.use(limiter);

// JWT Authentication middleware
const authenticateDriver = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  // In production: verify JWT and extract driver ID
  // jwt.verify(token, process.env.JWT_SECRET)
  req.driverId = 'driver_abc123'; // Mock authenticated driver
  next();
};

// 1. Fetch available jobs within driver's radius
app.get('/api/jobs', authenticateDriver, (req, res) => {
  const { lat, lng, radius = 5 } = req.query;
  
  // Validate coordinates
  if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: 'Valid lat/lng coordinates required' });
  }
  
  // In production: Query MongoDB and filter using simple distance calculation
  // const allJobs = await db.jobs.find({ status: 'pending' });
  // const nearbyJobs = allJobs.filter(job => calculateDistance(driverLocation, job.pickup) <= 5);
 
  
  const availableJobs = [
    {
      id: 'job_abc123',
      pickup: {
        address: '123 Main St, NYC',
        lat: 40.7580,
        lng: -73.9855
      },
      delivery: {
        address: '456 Park Ave, NYC',
        lat: 40.7505, 
        lng: -73.9934
      },
      payout: 12.50,
      distance: 2.3,
      estimatedDuration: 25,
      expiresAt: new Date(Date.now() + 30 * 60000).toISOString() // 30 min expiry
    }
  ];
  
  res.json({
    jobs: availableJobs,
    nextPollInterval: 15,
    driverLocation: { lat: parseFloat(lat), lng: parseFloat(lng) }
  });
});

// 2. Accept job assignment with atomic update
app.post('/api/jobs/:jobId/accept', authenticateDriver, async (req, res) => {
  const { jobId } = req.params;
  const { driverId } = req;
  
  try {
    // In production: Atomic MongoDB update to prevent race conditions
    // await Job.findOneAndUpdate(
    //   { _id: jobId, status: 'pending', assigned_driver_id: null },
    //   { status: 'accepted', assigned_driver_id: driverId, accepted_at: new Date() },
    //   { new: true }
    // )
    
    const jobDetails = {
      id: jobId,
      status: 'accepted',
      customer: {
        name: 'John D.',
        phone: '+1234567890'
      },
      specialInstructions: 'Ring doorbell twice',
      acceptedAt: new Date().toISOString()
    };
    
    // Notify other drivers this job is no longer available
    // webSocketManager.broadcastJobRemoval(jobId);
    
    res.json({
      success: true,
      job: jobDetails
    });
    
  } catch (error) {
    res.status(409).json({ 
      error: 'Job no longer available or already assigned' 
    });
  }
});

// 3. Decline job with optional reason  
app.post('/api/jobs/:jobId/decline', authenticateDriver, (req, res) => {
  const { jobId } = req.params;
  const { reason } = req.body;
  
  // In production: Log decline reason for analytics
  // await JobDecline.create({ job_id: jobId, driver_id: driverId, reason, created_at: new Date() })
  console.log(`Driver ${req.driverId} declined job ${jobId}: ${reason || 'No reason'}`);
  
  res.json({ success: true });
});

// 4. Update job status with location verification
app.put('/api/jobs/:jobId/status', authenticateDriver, (req, res) => {
  const { jobId } = req.params;
  const { status, location } = req.body;
  
  // Validate status transitions
  const validTransitions = {
    'accepted': ['pickup'],
    'pickup': ['delivery'], 
    'delivery': ['completed']
  };
  
  // Validate location accuracy
  if (location && (!location.lat || !location.lng)) {
    return res.status(400).json({ error: 'Valid location coordinates required' });
  }
  
  // In production: Update job status with location proof
  // await Job.findOneAndUpdate(
  //   { _id: jobId, assigned_driver_id: driverId },
  //   { status: status, updated_at: new Date() }
  // );
  // await JobLocation.create({ job_id: jobId, status, location, timestamp: new Date() })
  
  const timestamp = new Date().toISOString();
  
  res.json({
    success: true,
    status: status,
    timestamp: timestamp,
    location: location
  });
});

// 5. Update driver location with battery optimization
app.post('/api/drivers/location', authenticateDriver, async (req, res) => {
  const { lat, lng, accuracy, battery, isMoving, timestamp } = req.body;
  const { driverId } = req;
  
  // Validate GPS accuracy (reject poor quality readings)
  if (accuracy > 50) {
    return res.status(400).json({ 
      error: 'GPS accuracy too low. Please wait for better signal.' 
    });
  }
  
  // Rate limiting: Prevent location spam
  const now = Date.now();
  const lastUpdate = req.session?.lastLocationUpdate || 0;
  if (now - lastUpdate < 5000) { // 5 second minimum interval
    return res.status(429).json({ error: 'Location updates too frequent' });
  }
  req.session = { lastLocationUpdate: now };
  
  // Smart interval calculation based on context
  const calculateUpdateInterval = (battery, isMoving, hasActiveJob) => {
    if (battery < 15) return 120; // Critical battery
    if (battery < 30) return 60;  // Low battery
    if (!isMoving) return 45;     // Stationary
    if (hasActiveJob) return 10;  // Active delivery
    return 20; // Default
  };
  
  const hasActiveJob = true; // Mock: check if driver has active delivery
  const nextInterval = calculateUpdateInterval(battery, isMoving, hasActiveJob);
  
  // Store in Redis for real-time tracking
  await redisClient.setex(`driver:location:${driverId}`, 300, JSON.stringify({lat, lng, battery, timestamp}));
  
  res.json({
    success: true,
    nextUpdateInterval: nextInterval,
    batteryOptimized: battery < 30,
    timestamp: new Date().toISOString()
  });
});

// Utility function: Haversine distance calculation 
function calculateDistance(point1, point2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(point2.lat - point1.lat);
  const dLng = toRadians(point2.lng - point1.lng);
  
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(toRadians(point1.lat)) * Math.cos(toRadians(point2.lat)) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c; // Distance in kilometers
}

function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Driver API server running on port ${PORT}`);
});

module.exports = app;