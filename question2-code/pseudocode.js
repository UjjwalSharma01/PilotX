/**
 * Main function to match incoming delivery order to nearest available driver
 * 
 * Escalation Strategy:
 * 1. Start: 2km radius, 50 drivers per batch
 * 2. No response: Expand radius by 2km, during peak hours remove cooldowns from previous notifications
 * 3. Progressive: Increase batch sizes (50→75→100→150→200) as radius expands
 * 4. Peak hours: Remove cooldowns from all previously notified drivers to maximize pool
 * 5. Limits: Stop at 15km (urban) or 25km (suburban), return "no drivers available"
 */
function matchDriverToOrder(orderLocation, orderDetails) {
    let searchRadius = 2; // Start with 2km radius
    const maxRadius = getBusinessThreshold(orderLocation); // Urban: 15km, Suburban: 25km
    let batchSize = 50; // Start with 50 drivers per batch
    const notifiedDriversHistory = []; // Track all previously notified drivers
    
    while (searchRadius <= maxRadius) {
        // Get pre-sorted driver list (refreshed every 3-10 mins based on peak hours)
        const availableDrivers = getPresortedDriverList();
        const radiusCandidates = [];
        
        // Filter drivers within current radius and not in cooldown
        for (const driver of availableDrivers) {
            const distance = calculateDistance(orderLocation, driver.location);
            if (distance <= searchRadius && !isInCooldown(driver.id)) {
                radiusCandidates.push({driver, distance});
            }
        }
        
        // Process drivers in dynamic batch sizes
        for (let batch = 0; batch < radiusCandidates.length; batch += batchSize) {
            const driverBatch = radiusCandidates.slice(batch, batch + batchSize);
            const batchCandidates = [];
            
            // Acquire locks for this batch
            for (const candidate of driverBatch) {
                if (acquireLock(candidate.driver.id, 10)) { // 10-second timeout
                    batchCandidates.push(candidate);
                }
            }
            
            // If candidates found in this batch, notify them
            if (batchCandidates.length > 0) {
                const batchNotified = [];
                const bestDriversInBatch = selectBestDriversFromBatch(batchCandidates);
                
                // Send notifications to best drivers in this batch
                for (const candidate of bestDriversInBatch) {
                    sendOrderNotification(candidate.driver.id, orderDetails);
                    batchNotified.push(candidate.driver.id);
                }
                
                notifiedDriversHistory.push(...batchNotified);
                
                // Wait for responses (first to accept wins)
                const acceptedDriver = waitForAcceptance(bestDriversInBatch, 10);
                
                if (acceptedDriver) {
                    releaseLocks(batchCandidates, acceptedDriver.id);
                    // Apply cooldown to all drivers notified in this search
                    applyFairnessCooldown(notifiedDriversHistory, 600);
                    return acceptedDriver;
                } else {
                    // No acceptance - apply cooldown and continue to next batch
                    releaseLocks(batchCandidates);
                    applyFairnessCooldown(batchNotified, 600);
                }
            }
            
            // Wait before processing next batch
            sleep(2500);
        }
        
        // No drivers found in current radius - escalate search strategy
        searchRadius += 2; // Increment by 2km
        
        // During peak hours, remove cooldowns from all previously notified drivers
        // and increase batch size for broader coverage
        if (isPeakHours() && notifiedDriversHistory.length > 0) {
            removeCooldownsForDrivers(notifiedDriversHistory);
            batchSize = Math.min(batchSize * 1.5, 150); // Increase batch size, cap at 150
        }
        
        // Progressive batch size increase as radius expands
        if (searchRadius > 6) { // After 2nd expansion
            batchSize = Math.min(batchSize + 25, 200); // Increase batch size progressively
        }
    }
    
    throw new Error("No available drivers within service area");
}

/**
 * Weighted scoring algorithm for handling equidistant drivers (within 250m)
 * Prevents top-rated drivers from getting all orders
 */
function selectBestDriver(candidates) {
    // Group drivers within 250m tolerance as "equidistant"
    const distanceGroups = groupByTolerance(candidates, 0.25); // 250m in km
    
    // Process closest group first
    for (const group of distanceGroups) {
        if (group.length === 1) return group[0];
        
        // Apply weighted scoring for equidistant drivers
        const scored = group.map(candidate => {
            const driver = candidate.driver;
            
            // Weighted scoring system (discussed approach)
            const ratingScore = normalizeRating(driver.rating) * 0.4;        // 40% weight
            const fairnessScore = calculateFairness(driver.deliveries) * 0.3;  // 30% weight  
            const timeScore = calculateTimeScore(driver.lastAssignment) * 0.2;  // 20% weight
            const randomFactor = Math.random() * 0.1;                          // 10% weight
            
            return {
                ...candidate,
                finalScore: ratingScore + fairnessScore + timeScore + randomFactor
            };
        });
        
        // Return highest scoring driver
        return scored.reduce((best, current) => 
            current.finalScore > best.finalScore ? current : best
        );
    }
}

/**
 * Helper functions for scoring criteria
 */
function calculateFairness(deliveriesToday) {
    const maxDaily = 20; // Business assumption
    return Math.max(0, 1 - (deliveriesToday / maxDaily));
}

function calculateTimeScore(lastAssignment) {
    const hoursSinceAssignment = (Date.now() - lastAssignment) / 3600000;
    return Math.min(1, hoursSinceAssignment); // Longer wait = higher score
}

/**
 * Calculate distance between two GPS coordinates using Haversine formula
 * Returns distance in kilometers
 */
function calculateDistance(point1, point2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = toRadians(point2.lat - point1.lat);
    const dLng = toRadians(point2.lng - point1.lng);
    
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(toRadians(point1.lat)) * Math.cos(toRadians(point2.lat)) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function toRadians(degrees) {
    return degrees * (Math.PI / 180);
}

/**
 * Additional helper functions for notification and cooldown management
 */
function sendOrderNotification(driverId, orderDetails) {
    // Send push notification to driver with order details
    // Returns immediately, doesn't wait for response
}

function waitForAcceptance(candidates, timeoutSeconds) {
    // Wait for first driver to accept within timeout period
    // Returns accepted driver or null if timeout
}

function selectBestDriversFromBatch(batchCandidates) {
    // Apply weighted scoring to select best drivers from current batch
    // Returns top candidates up to notification limit
    return selectBestDriver(batchCandidates);
}

function applyFairnessCooldown(driverIds, cooldownSeconds) {
    // Apply 10-minute cooldown to all notified drivers for fairness
    // Prevents cherry-picking high-value orders
}

function removeCooldownsForDrivers(driverIds) {
    // Remove cooldowns for specific drivers during peak load escalation
    // Allows previously notified drivers to be contacted again
}

function isPeakHours() {
    // Detect peak hours based on order volume and time patterns
    return getCurrentOrderVolume() > PEAK_THRESHOLD;
}
