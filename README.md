# Pilot X Backend Assessment

My solutions for the Pilot X technical assessment - building backend systems for a delivery platform.

## What I Built

**Q1: Order Import System**  
Multi-platform order processing (Shopify, WooCommerce) with smart duplicate prevention using Redis + MongoDB. Scales to 10K+ orders/hour with microservices architecture.

**Q2: Driver Matching Engine**  
Real-time algorithm that finds the best driver for each order while keeping things fair. Handles tricky cases like equidistant drivers and peak hour demand.

**Q3: System Architecture**  
Designed the whole backend to handle 30+ stores and 50+ drivers simultaneously. Chose technologies based on cost and operational simplicity, not just performance.

**Q4: Mobile Driver App Backend**  
REST APIs plus real-time job notifications. The GPS tracking is battery-smart - adapts update frequency based on phone battery and driver activity.

## How It Works

Each solution includes the system design thinking, working code, and explanations of why I chose specific approaches over alternatives. 

I focused on practical solutions that work in the real world - considering things like battery life, network issues, business costs, and scaling from startup to enterprise.

**Tech Stack**: Node.js, MongoDB, Redis, BullMQ, Kong Gateway
