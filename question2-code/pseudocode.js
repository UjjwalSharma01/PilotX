/**
 * Main function to match incoming delivery order to nearest available driver
 * Implements weighted scoring with 250m tolerance for distance and fairness logic to make sure driver are not over burdened and the deliveries are not consolidated to few drivers.
 */
function matchDriverToOrder(orderLocation, orderDetails) {
    let searchRadius = 2; // Start with 2km radius
    const maxRadius = getBusinessThreshold(orderLocation); // Urban: 15km, Suburban: 25km
    
    while (searchRadius <= maxRadius) {
        // Get pre-sorted driver list (refreshed every 3-10 mins based on peak hours)
        const availableDrivers = getPresortedDriverList();
        const candidates = [];
        
        // Process drivers in batches of 50 to prevent system overload
        for (let batch = 0; batch < availableDrivers.length; batch += 50) {
            const driverBatch = availableDrivers.slice(batch, batch + 50);
            
            for (const driver of driverBatch) {
                // Skip drivers in 10-minute cooldown period (fairness mechanism)
                if (isInCooldown(driver.id)) continue;
                
                // Calculate straight-line distance using Haversine formula
                const distance = calculateDistance(orderLocation, driver.location);
                
                // Skip if outside current search radius
                if (distance > searchRadius) continue;
                
                // Acquire distributed lock to prevent double-assignment
                if (acquireLock(driver.id, 10)) { // 10-second timeout
                    candidates.push({driver, distance});
                }
            }
            
            // If candidates found, select best one
            if (candidates.length > 0) {
                const selectedDriver = selectBestDriver(candidates);
                releaseLocks(candidates, selectedDriver.id); // Release unused locks
                setCooldownPeriod(selectedDriver.id, 600); // 10-minute cooldown
                return selectedDriver;
            }
            
            // Wait 2-3 seconds before next batch (discussed batching strategy)
            sleep(2500);
        }
        
        // Expand search radius if no drivers found
        searchRadius += 2; // Increment by 2km
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
