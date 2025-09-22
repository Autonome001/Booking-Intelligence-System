#!/usr/bin/env node

/**
 * Debug Slack Integration - Comprehensive Troubleshooting
 * 
 * This script helps diagnose Slack button interaction issues by:
 * 1. Testing all production endpoints
 * 2. Checking Slack App configuration
 * 3. Simulating button interactions
 * 4. Verifying signature handling
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');

// Configuration
const PRODUCTION_URL = 'https://autonome-isaas-autonomeus.up.railway.app';
const LOCAL_URL = 'http://localhost:3002';

// Colors for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m', 
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
};

function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    
    const req = client.request(url, {
      method: 'GET',
      timeout: 10000,
      ...options
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => reject(new Error('Request timeout')));
    
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function testSlackInteraction(baseUrl, withSignature = false) {
  try {
    log('blue', `\n🧪 Testing Slack Interaction: ${baseUrl}`);
    log('blue', `📍 Signature: ${withSignature ? 'ENABLED' : 'DISABLED'}`);
    
    // Create test payload
    const payload = JSON.stringify({
      type: 'block_actions',
      user: { id: 'U123TEST', name: 'test_user' },
      actions: [{ action_id: 'revise_email', value: 'booking_1757590728815_0kgrkxi1l' }],
      message: { ts: '1757590728815' },
      channel: { id: 'C123TEST' }
    });

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = `payload=${encodeURIComponent(payload)}`;
    
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body)
    };

    // Add Slack signature if requested
    if (withSignature) {
      const sigBasestring = `v0:${timestamp}:${body}`;
      const signature = 'v0=' + crypto
        .createHmac('sha256', 'dummy_secret')
        .update(sigBasestring, 'utf8')
        .digest('hex');
      
      headers['X-Slack-Signature'] = signature;
      headers['X-Slack-Request-Timestamp'] = timestamp;
    }

    const response = await makeRequest(`${baseUrl}/api/slack/interactions`, {
      method: 'POST',
      headers,
      body
    });

    if (response.status === 200) {
      log('green', `✅ SUCCESS (${response.status})`);
      try {
        const jsonResponse = JSON.parse(response.body);
        console.log('📋 Response:', JSON.stringify(jsonResponse, null, 2));
      } catch (e) {
        console.log('📋 Response:', response.body);
      }
      return true;
    } else {
      log('red', `❌ FAILED (${response.status})`);
      console.log('📋 Response:', response.body);
      return false;
    }
  } catch (error) {
    log('red', `❌ ERROR: ${error.message}`);
    return false;
  }
}

async function testSlackEvents(baseUrl) {
  try {
    log('blue', `\n🧪 Testing Slack Events: ${baseUrl}`);
    
    const eventPayload = JSON.stringify({
      type: 'event_callback',
      event: {
        type: 'message',
        user: 'U123TEST',
        text: 'Make it more casual and friendly',
        channel: 'C123TEST',
        ts: '1757590728816',
        thread_ts: '1757590728815'
      }
    });

    const response = await makeRequest(`${baseUrl}/api/slack/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(eventPayload)
      },
      body: eventPayload
    });

    if (response.status === 200) {
      log('green', `✅ SUCCESS (${response.status})`);
      try {
        const jsonResponse = JSON.parse(response.body);
        console.log('📋 Response:', JSON.stringify(jsonResponse, null, 2));
      } catch (e) {
        console.log('📋 Response:', response.body);
      }
      return true;
    } else {
      log('red', `❌ FAILED (${response.status})`);
      console.log('📋 Response:', response.body);
      return false;
    }
  } catch (error) {
    log('red', `❌ ERROR: ${error.message}`);
    return false;
  }
}

async function checkBookingStatus(baseUrl, bookingId) {
  try {
    log('blue', `\n🔍 Checking booking status: ${bookingId}`);
    
    const response = await makeRequest(`${baseUrl}/api/booking/status/${bookingId}`);
    
    if (response.status === 200) {
      log('green', `✅ Booking found`);
      try {
        const booking = JSON.parse(response.body);
        console.log('📋 Booking Status:', booking.status);
        console.log('📋 Last Updated:', booking.updated_at);
        return booking;
      } catch (e) {
        console.log('📋 Response:', response.body);
      }
    } else {
      log('yellow', `⚠️ Booking not found or endpoint unavailable (${response.status})`);
    }
  } catch (error) {
    log('yellow', `⚠️ Could not check booking: ${error.message}`);
  }
  return null;
}

async function runDiagnostics() {
  log('cyan', '🔧 SLACK INTEGRATION DIAGNOSTICS');
  log('cyan', '=================================');
  
  const tests = [
    { url: LOCAL_URL, name: 'Local Development' },
    { url: PRODUCTION_URL, name: 'Production Railway' }
  ];

  for (const test of tests) {
    log('yellow', `\n🎯 Testing ${test.name} (${test.url})`);
    log('yellow', '='.repeat(50));

    // Test health endpoints
    log('blue', '\n📊 Health Checks:');
    try {
      const health = await makeRequest(`${test.url}/health`);
      log(health.status === 200 ? 'green' : 'red', 
          `   General Health: ${health.status === 200 ? '✅' : '❌'} (${health.status})`);
    } catch (e) {
      log('red', `   General Health: ❌ (${e.message})`);
    }

    try {
      const slackHealth = await makeRequest(`${test.url}/api/slack/health`);
      log(slackHealth.status === 200 ? 'green' : 'red', 
          `   Slack Health: ${slackHealth.status === 200 ? '✅' : '❌'} (${slackHealth.status})`);
    } catch (e) {
      log('red', `   Slack Health: ❌ (${e.message})`);
    }

    // Test Slack interactions
    log('blue', '\n🔘 Button Interactions:');
    const interactionNoSig = await testSlackInteraction(test.url, false);
    const interactionWithSig = await testSlackInteraction(test.url, true);
    
    // Test events
    log('blue', '\n📨 Event Processing:');
    await testSlackEvents(test.url);

    // Check specific booking
    await checkBookingStatus(test.url, 'booking_1757590728815_0kgrkxi1l');

    // Summary
    log('yellow', '\n📊 Test Summary:');
    console.log(`   Interaction (no sig): ${interactionNoSig ? '✅' : '❌'}`);
    console.log(`   Interaction (with sig): ${interactionWithSig ? '✅' : '❌'}`);
  }

  log('cyan', '\n🔧 RECOMMENDATIONS:');
  log('cyan', '===================');
  console.log('1. Check your Slack App configuration:');
  console.log('   - Interactive Components URL: https://autonome-isaas-autonomeus.up.railway.app/api/slack/interactions');
  console.log('   - Event Subscriptions URL: https://autonome-isaas-autonomeus.up.railway.app/api/slack/events');
  console.log('');
  console.log('2. Verify bot permissions:');
  console.log('   - chat:write, channels:read, channels:history');
  console.log('');
  console.log('3. Check environment variables in Railway:');
  console.log('   - SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, REAL_CHANNEL_ID');
  console.log('');
  console.log('4. Look for the booking message in your Slack channel and try clicking buttons');
}

// Run diagnostics
runDiagnostics().catch(console.error);