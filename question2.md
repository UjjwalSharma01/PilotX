## Summary
In this solution i have comprehensively tackled all the possible edge cases and scenarios for a real-time driver matching system, to achieve optimal performance, fairness, reliability, and scalability. The architecture leverages a hybrid approach using Redis for low-latency operations and MongoDB for durable storage, ensuring both speed and data integrity.

Issues addressed:
1. Distribution of order to the driver who are equidistant from the pickup location.
2. Handling scenarios where no drivers are available within the specified radius.
3. Ensuring the fair distribution of orders among drivers over time.
4. Minimizing latency along with the operational cost of the system.
5. Handling the case where drivers are not accepting the order due to any reason.

## Pseudocode Implementation

See algorithm implementation: [`question2-code/pseudocode.js`](./question2-code/pseudocode.js)


## Problem Statement & Requirements

### Functional Requirements
- Match incoming delivery orders to nearest available drivers
- Handle real-time GPS location updates (every 3-5 seconds)
- Manage driver availability changes dynamically
- Process equidistant driver scenarios fairly

### Non-Functional Requirements
- **Latency**: <5 seconds average matching time
- **Throughput**: Support 1000+ orders per minute at peak
- **Availability**: 99.9% uptime with graceful degradation
- **Consistency**: Eventual consistency acceptable for location data

## Architecture Overview

### Service Architecture
**Microservices Design** chosen over monolithic for:
- Independent scaling of matching vs. location services
- Technology diversity (Redis for speed, MongoDB for persistence)
- Fault isolation and easier maintenance

**Core Services:**
1. **Delivery Management Service** - Order intake and customer communication, like order status updates, ratings, etc.
2. **Rider Management Service** - Driver state and location management, this entirely is responsible for the co-ordination with different services and the main entry point for the driver app.
3. **Matching Engine** - Core algorithm with weighted scoring
4. **Notification Service** - Batched driver notifications, to optimise the driver reach out to avoid overwhelming the system.

### Data Architecture
**Hybrid Database Strategy:**
- **Redis**: Real-time location data, availability status, distributed locks, once the driver is reached out (a 10 minutes base cool-down period with dynamic changes according to the business needs, and peak loads) is set to avoid overloading the driver with requests and keeping the system fair and accountable.
- **MongoDB**: Persistent driver profiles, order history, analytics

## Technical Decisions & Trade-offs

### 1. Distance Tolerance (250m vs 100m)
**Decision:** 250m tolerance for "equidistant" drivers  
**Rationale:** 
- Better driver fairness and retention
- Minimal customer impact (30-60 seconds difference)
- Reduces location gaming by drivers and provides a fair opportunity to more deserving drivers.

### 2. Weighted Scoring Algorithm
**Decision:** Multi-factor scoring (Rating 40%, Fairness 30%, Time 20%, Random 10%)  
_fairness_ here means the that there should not be the case where only a few drivers are getting all the orders and rest of them are idle.

we will use this mathematical logic to create a sorted list of drivers based on their scores and then we will use this sorted list to reach out to the drivers in batches.  
**Rationale:**
- Prevents top-driver monopolization
- Maintains service quality through rating priority, ensuring top tier customer satisfaction.
- Ensures fair work distribution

### 3. Batching Strategy (50 drivers per batch)
**Decision:** Sequential batching with 2-3 second intervals  

we are reaching out to the drivers in batches of 50 with a 2-3 seconds interval between each batch, this gives the drivers some time to respond and also prevents overwhelming the system with too many requests at once. and if the drivers do not respond within a certain time frame, lets say we had a batch if 100 initially we reached out to drivers in batches of 50, if none of them respond, so we will increase the distance and send the next batch of 50 drivers along with the notification to entire the previous batch and the cool-down period of the drivers in the previous batch would be removed to increase the scope and ensure that ordered is assigned in a timely manner.  
**Rationale:**
- Prevents system overload
- Gives drivers response time
- Natural fallback mechanism

### 4. Dynamic List Refresh
**Decision:** Peak-aware refresh intervals (3-10 minutes)  
we will keep updating the list of available drivers in redis every 3-10 minutes based on the peak hours and the business needs, this will ensure that we have the most up-to-date list of drivers available for matching and also it will reduce the load on the system by not updating the list too frequently.  
**Rationale:**
- Balances freshness with computational cost
- Adapts to business demand patterns
- Prevents stale driver data

### 5. Distributed Locking
**Decision:** Redis-based locking with 10-second timeout  
This period allows enough time for the driver to accept or reject the order, and also prevents the driver from being assigned multiple orders at the same time.   
**Rationale:**
- Prevents double-assignment in concurrent scenarios
- Handles service failures gracefully
- Maintains data consistency

## Key Assumptions

### Business Assumptions
- **Service Areas:** Urban (15km max), Suburban (25km max) [from customer's location]
- **Driver Capacity:** Maximum 20 deliveries per day per driver
- **Peak Hours:** Dynamic detection based on order volume
- **Cooldown Period:** 10 minutes between assignments for fairness

### Technical Assumptions
- **GPS Accuracy:** 3-5 meter variance acceptable
- **Network Latency:** <100ms between services
- **Driver App Connectivity:** Persistent WebSocket connections maintained
- **Database Performance:** Redis <1ms, MongoDB <50ms query times

## Alternatives Considered

### 1. Geospatial Query Approach
**Rejected:** GEORADIUS for every query  
**Reason:** Performance bottleneck at scale, excessive computational overhead

### 2. Queue-Based Processing
**Rejected:** Single queue for all orders  
**Reason:** Creates driver monopolization, poor fairness distribution

### 3. Machine Learning Matching
**Rejected:** AI-based driver selection  
**Reason:** Over-engineering for current scale, interpretability concerns

### 4. Synchronous Database Updates
**Rejected:** Real-time MongoDB writes    
**Reason:** Performance impact, unnecessary for location data
