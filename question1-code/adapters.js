class ShopifyAdapter {
  transform(shopifyOrder) {
    try {
      // Validate required fields
      if (!shopifyOrder?.order?.id) {
        throw new Error('Missing order ID');
      }

      return {
        orderId: shopifyOrder.order.id,
        items: (shopifyOrder.order.line_items || []).map(item => ({
          name: item.title || 'Unknown Product',
          price: parseFloat(item.price) || 0,
          quantity: parseInt(item.quantity) || 1
        })),
        customer: {
          email: shopifyOrder.order.email || '',
          name: shopifyOrder.order.billing_address?.name || 'Unknown Customer'
        },
        timestamp: new Date().toISOString(),
        platform: 'shopify'
      };
    } catch (error) {
      throw new Error(`Shopify transformation failed: ${error.message}`);
    }
  }
}

class WooCommerceAdapter {
  transform(wooOrder) {
    try {
      if (!wooOrder?.id) {
        throw new Error('Missing order ID');
      }

      return {
        orderId: wooOrder.id,
        items: (wooOrder.items || []).map(item => ({
          name: item.product_name || 'Unknown Product',
          price: parseFloat(item.total) || 0,
          quantity: parseInt(item.quantity) || 1
        })),
        customer: {
          email: wooOrder.billing?.email || '',
          name: `${wooOrder.billing?.first_name || ''} ${wooOrder.billing?.last_name || ''}`.trim() || 'Unknown Customer'
        },
        timestamp: new Date().toISOString(),
        platform: 'woocommerce'
      };
    } catch (error) {
      throw new Error(`WooCommerce transformation failed: ${error.message}`);
    }
  }
}

// Factory pattern for adapter selection
class AdapterFactory {
  static getAdapter(platform) {
    const adapters = {
      'shopify': new ShopifyAdapter(),
      'woocommerce': new WooCommerceAdapter(),
      // Easy to add more platforms
    };
    
    const adapter = adapters[platform.toLowerCase()];
    if (!adapter) {
      throw new Error(`Unsupported platform: ${platform}`);
    }
    return adapter;
  }
}

// Improved main processing function
async function processOrder(platformData, platform) {
  try {
    const adapter = AdapterFactory.getAdapter(platform);
    const standardOrder = adapter.transform(platformData);
    
    // Validate the standardized order
    validateStandardOrder(standardOrder);
    
    // Process with proper error handling
    await Promise.all([
      saveToDatabase(standardOrder),
      assignDeliveryPartner(standardOrder),
      sendConfirmationEmail(standardOrder)
    ]);
    
    return { success: true, orderId: standardOrder.orderId };
  } catch (error) {
    console.error(`Order processing failed:`, error);
    // Implement retry logic or fallback mechanisms
    return { success: false, error: error.message };
  }
}

function validateStandardOrder(order) {
  if (!order.orderId) throw new Error('Order ID is required');
  if (!order.items || order.items.length === 0) throw new Error('Order must have items');
  if (!order.customer?.email) throw new Error('Customer email is required');
}