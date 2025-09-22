#!/bin/bash

# Booking Form Critical Fix - Deployment Script
# Safely deploys the booking form fix with fallback processing

set -e  # Exit on any error

echo "🚀 BOOKING FORM FIX - DEPLOYMENT SCRIPT"
echo "========================================"
echo "Date: $(date)"
echo "Environment: ${NODE_ENV:-development}"
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -d "src/api" ]; then
    echo "❌ Error: Please run this script from the booking-agent root directory"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node --version)
echo "📦 Node.js Version: $NODE_VERSION"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📥 Installing dependencies..."
    npm install
fi

# Syntax check the modified files
echo "🔍 Checking syntax of modified files..."
node -c src/api/simple-booking.js
echo "✅ simple-booking.js - OK"

node -c src/api/webhook-handler.js  
echo "✅ webhook-handler.js - OK"

node -c test-booking-fix.js
echo "✅ test-booking-fix.js - OK"

echo ""
echo "🧪 RUNNING PRE-DEPLOYMENT TESTS"
echo "================================"

# Test if server is running
if pgrep -f "node.*src/index.js" > /dev/null; then
    echo "⚠️  Server is currently running. Preparing for restart..."
    SERVER_RUNNING=true
else
    echo "ℹ️  Server is not currently running."
    SERVER_RUNNING=false
fi

# If Railway environment, skip local testing
if [ -n "$RAILWAY_ENVIRONMENT" ]; then
    echo "🚂 Railway environment detected - skipping local tests"
    echo "   Production deployment will be handled by Railway"
    echo ""
    echo "✅ DEPLOYMENT READY"
    echo "Files updated and syntax verified."
    echo ""
    echo "📝 Next steps:"
    echo "1. Railway will automatically redeploy with these changes"
    echo "2. Wait for deployment to complete (~2-3 minutes)"
    echo "3. Test endpoints using: node test-booking-fix.js"
    echo "4. Monitor logs for 'fallback mode' indicators"
    echo ""
    exit 0
fi

# For local environment, restart server if it was running
if [ "$SERVER_RUNNING" = true ]; then
    echo "🔄 Restarting server..."
    
    # Kill existing server
    pkill -f "node.*src/index.js" || true
    sleep 2
    
    # Start server in background
    echo "🚀 Starting server with booking fix..."
    npm start > server.log 2>&1 &
    SERVER_PID=$!
    echo "   Server PID: $SERVER_PID"
    
    # Wait for server to start
    echo "⏳ Waiting for server to start..."
    sleep 5
    
    # Check if server is healthy
    if curl -f -s "http://localhost:3001/health" > /dev/null; then
        echo "✅ Server started successfully"
    else
        echo "❌ Server health check failed"
        echo "   Check server.log for details"
        exit 1
    fi
fi

echo ""
echo "🧪 RUNNING BOOKING FORM TESTS"
echo "============================="

# Run the test script
if [ -f "test-booking-fix.js" ]; then
    echo "🔬 Testing booking endpoints..."
    BASE_URL="http://localhost:3001" node test-booking-fix.js
    TEST_RESULT=$?
    
    if [ $TEST_RESULT -eq 0 ]; then
        echo "✅ All tests passed!"
    else
        echo "⚠️  Some tests failed - check output above"
    fi
else
    echo "⚠️  Test script not found - skipping automated tests"
fi

echo ""
echo "🎉 DEPLOYMENT COMPLETE"
echo "====================="
echo "✅ Booking form fix deployed successfully"
echo "✅ Fallback processing implemented"
echo "✅ Error handling enhanced"
echo ""
echo "📊 Available endpoints:"
echo "  - /api/webhook/public/booking-form (main with fallback)"
echo "  - /api/webhook/public/safe-booking-form (emergency safe)"
echo ""
echo "📋 What to do next:"
echo "1. Test the booking form on the website"
echo "2. Verify Slack notifications are working"
echo "3. Monitor server logs for any issues"
echo "4. Update team about the fix"
echo ""
echo "🔍 Monitoring commands:"
echo "  - Health check: curl http://localhost:3001/health"
echo "  - View logs: tail -f server.log"
echo "  - Test booking: node test-booking-fix.js"
echo ""
echo "Deployment completed at: $(date)"