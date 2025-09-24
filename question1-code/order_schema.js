// Standardized Order Schema
const STANDARD_ORDER_SCHEMA = {
  // Core fields - same for all platforms
  orderId: "string",           // Our internal order ID
  platformOrderId: "string",  // Original platform order ID
  platform: "enum",           // shopify|woocommerce|bigcommerce
  storeId: "string",          // store123.myshopify.com
  
  // Customer data
  customer: {
    email: "string",
    name: "string",
    phone: "string?",
    address: {
      street: "string",
      city: "string", 
      country: "string",
      zipCode: "string"
    }
  },
  
  // Order items
  items: [{
    sku: "string",
    name: "string", 
    quantity: "number",
    unitPrice: "number",
    totalPrice: "number"
  }],
  
  // Financial data
  totals: {
    subtotal: "number",
    tax: "number",
    shipping: "number",
    discount: "number",
    total: "number"
  },
  
  // Metadata
  timestamp: "ISO8601",
  status: "enum", // pending|confirmed|shipped|delivered
  
  // Platform-specific data preserved
  platformData: "object" // Original platform data for reference
};

// Example of consistent output
const exampleOutput = {
  orderId: "internal_789",
  platformOrderId: "shopify_order_456", 
  platform: "shopify",
  storeId: "store123.myshopify.com",
  
  customer: {
    email: "user@example.com",
    name: "John Doe",
    phone: "+1234567890",
    address: {
      street: "123 Main St",
      city: "New York",
      country: "USA",
      zipCode: "10001"
    }
  },
  
  items: [
    {
      sku: "ABC123",
      name: "Premium T-Shirt",
      quantity: 2,
      unitPrice: 29.99,
      totalPrice: 59.98
    }
  ],
  
  totals: {
    subtotal: 59.98,
    tax: 4.80,
    shipping: 9.99,
    discount: 0,
    total: 74.77
  },
  
  timestamp: "2025-09-24T10:30:00Z",
  status: "pending",
  
  platformData: {
    // Original Shopify data preserved for debugging/compliance
    shopifyFulfillmentStatus: "unfulfilled",
    discountCodes: ["SAVE10"],
    originalOrderData: "..." // Full original order
  }
};