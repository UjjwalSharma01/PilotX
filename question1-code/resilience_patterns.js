
// degradation with customer choice during service failures

class ResilientOrderProcessor {
  constructor(partnerService, orderRepository, redis) {
    this.partnerService = partnerService;
    this.orderRepository = orderRepository;
    this.redis = redis;
  }

  // Main order processing with resilience patterns
  async processOrderWithResilience(order) {
    try {
      // Phase 1: Attempt normal partner assignment with 30s timeout
      const partner = await Promise.race([
        this.partnerService.assignOptimal(order),
        this.timeout(30000)
      ]);
      
      return { 
        status: 'success', 
        partner, 
        processingTime: '200ms',
        message: 'Order processed successfully with optimal partner'
      };
      
    } catch (error) {
      console.warn('Primary partner service failed, initiating fallback:', error.message);
      
      // Phase 2: Graceful degradation - save order with default partner
      const savedOrder = await this.saveOrderWithFallback(order);
      
      return {
        status: 'partner_assignment_delayed',
        orderId: savedOrder.id,
        timestamp: new Date().toISOString(),
        message: 'Partner assignment taking longer than usual',
        options: {
          wait: {
            action: 'wait_for_assignment',
            message: 'Wait 1 more minute - we\'ll keep trying to assign partner',
            estimatedWait: '60 seconds'
          },
          cancel: {
            action: 'cancel_order',
            message: 'Cancel order and try again later'
          }
        }
      };
    }
  }

  // Customer choice handler for fallback scenarios
  async handleCustomerChoice(orderId, choice) {
    const order = await this.orderRepository.findById(orderId);
    
    if (choice === 'wait') {
      // Customer chooses to wait 1 more minute for partner assignment
      return await this.attemptExtendedPartnerAssignment(order);
      
    } else if (choice === 'cancel') {
      // Customer cancels the order
      await this.cancelOrder(order);
      return {
        status: 'cancelled',
        message: 'Order cancelled successfully. You can try again anytime.',
        orderId: order.id
      };
    }
  }

  // Fallback order saving with default partner
  async saveOrderWithFallback(order) {
    try {
      // Get nearest hub as fallback partner
      const defaultPartner = await this.getDefaultPartner(order.deliveryAddress);
      
      const savedOrder = await this.orderRepository.create({
        ...order,
        status: 'pending_customer_choice',
        partnerId: defaultPartner.id,
        partnerType: 'default_fallback',
        createdAt: new Date(),
        fallbackReason: 'primary_partner_service_unavailable'
      });

      // Queue for background optimization
      await this.queueForBackgroundOptimization(savedOrder);
      
      return savedOrder;
      
    } catch (error) {
      // Ultimate fallback - save to Redis queue
      console.error('Database fallback failed, using Redis queue:', error);
      return await this.saveToRedisQueue(order);
    }
  }

  // Attempt extended partner assignment (Phase 4: 60 seconds more)
  async attemptExtendedPartnerAssignment(order) {
    try {
      // Extended attempt with 60s timeout
      const partner = await Promise.race([
        this.partnerService.assignOptimal(order),
        this.timeout(60000)
      ]);

      // Success - partner finally assigned
      await this.orderRepository.update(order.id, {
        partnerId: partner.id,
        status: 'partner_assigned',
        partnerAssignedAt: new Date()
      });

      return {
        status: 'partner_assigned_success',
        partner: partner,
        message: 'Great! Partner assigned successfully',
        orderId: order.id
      };

    } catch (error) {
      // Still failed after extended wait - offer final choices
      console.warn('Extended partner assignment failed:', error);
      
      return {
        status: 'partner_assignment_failed',
        orderId: order.id,
        message: 'Unable to assign partner at this time',
        options: {
          background: {
            action: 'process_in_background',
            message: 'Process order in background - we\'ll notify when partner assigned'
          },
          cancel: {
            action: 'cancel_order', 
            message: 'Cancel order and try again later'
          }
        }
      };
    }
  }

  // Handle final customer choice after extended attempt fails
  async handleFinalChoice(orderId, choice) {
    const order = await this.orderRepository.findById(orderId);
    
    if (choice === 'background') {
      // Process in background and notify customer
      await this.processInBackground(order);
      return {
        status: 'processing_in_background',
        message: 'Order queued for background processing. We\'ll notify you once partner is assigned.',
        orderId: order.id,
        estimatedNotification: '5-15 minutes'
      };
      
    } else if (choice === 'cancel') {
      // Final cancellation
      await this.cancelOrder(order);
      return {
        status: 'cancelled',
        message: 'Order cancelled successfully. You can try again anytime.',
        orderId: order.id
      };
    }
  }

  // Process order in background
  async processInBackground(order) {
    await this.orderRepository.update(order.id, {
      status: 'background_processing',
      backgroundProcessingStarted: new Date()
    });

    // Queue for background partner assignment with high priority
    await this.queueForBackgroundPartnerAssignment(order);
  }

  // Background partner assignment queue
  async queueForBackgroundPartnerAssignment(order) {
    const jobData = {
      orderId: order.id,
      type: 'partner_assignment',
      priority: 'high',
      attempts: 0,
      maxAttempts: 10, // Keep trying for a while
      nextAttempt: Date.now() + (2 * 60 * 1000), // Retry in 2 minutes
      customerNotification: true
    };

    await this.redis.zadd('background_partner_assignment_queue', Date.now(), JSON.stringify(jobData));
  }

  // Cancel order
  async cancelOrder(order) {
    return await this.orderRepository.update(order.id, {
      status: 'cancelled',
      cancelledAt: new Date(),
      cancellationReason: 'customer_choice_partner_assignment_failed'
    });
  }

  // Background optimization for queued orders
  async queueForBackgroundOptimization(order) {
    const jobData = {
      orderId: order.id,
      priority: 'high',
      attempts: 0,
      maxAttempts: 3,
      nextAttempt: Date.now() + (5 * 60 * 1000) // Retry in 5 minutes
    };

    await this.redis.zadd('background_optimization_queue', Date.now(), JSON.stringify(jobData));
  }

  // Utility methods
  async timeout(ms) {
    return new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms)
    );
  }

  async getDefaultPartner(address) {
    // Simplified default partner selection based on location
    return {
      id: 'default_hub_' + address.zipCode,
      name: 'Regional Distribution Hub',
      type: 'default',
      estimatedDelivery: '2-3 business days'
    };
  }

  async confirmOrderWithDefault(order) {
    return await this.orderRepository.update(order.id, {
      status: 'confirmed',
      confirmedAt: new Date(),
      customerChoice: 'proceed_with_default'
    });
  }

  async saveToRedisQueue(order) {
    const queueKey = `emergency_order_queue:${Date.now()}`;
    await this.redis.setex(queueKey, 3600, JSON.stringify(order)); // 1 hour expiry
    return { id: queueKey, status: 'queued_for_recovery' };
  }

  calculateDefaultDelivery(order) {
    const now = new Date();
    now.setDate(now.getDate() + 2); // Add 2 days
    return now.toISOString().split('T')[0]; // Return date only
  }
}

// Circuit breaker pattern for partner service
class PartnerServiceCircuitBreaker {
  constructor(partnerService, options = {}) {
    this.service = partnerService;
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000; // 1 minute
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.lastFailureTime = null;
  }

  async assignOptimal(order) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = 'HALF_OPEN';
        this.failureCount = 0;
      } else {
        throw new Error('Circuit breaker is OPEN - service unavailable');
      }
    }

    try {
      const result = await this.service.assignOptimal(order);
      
      if (this.state === 'HALF_OPEN') {
        this.state = 'CLOSED';
        this.failureCount = 0;
      }
      
      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      
      if (this.failureCount >= this.failureThreshold) {
        this.state = 'OPEN';
      }
      
      throw error;
    }
  }
}

module.exports = {
  ResilientOrderProcessor,
  PartnerServiceCircuitBreaker
};