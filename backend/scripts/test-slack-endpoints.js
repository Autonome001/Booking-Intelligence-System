#!/usr/bin/env node

/**
 * Test script for Slack interactive button endpoints
 * Usage: node scripts/test-slack-endpoints.js [production|local]
 */

import fetch from 'node-fetch';

const PRODUCTION_URL = 'https://autonome-isaas-autonomeus.up.railway.app';
const LOCAL_URL = 'http://localhost:3001';

const args = process.argv.slice(2);
const environment = args[0] || 'local';
const baseUrl = environment === 'production' ? PRODUCTION_URL : LOCAL_URL;

console.log(`🧪 Testing Slack endpoints on ${environment} environment: ${baseUrl}`);

async function testEndpoint(method, path, body = null, headers = {}) {
  try {
    console.log(`\n${method} ${baseUrl}${path}`);
    
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    const response = await fetch(`${baseUrl}${path}`, options);
    const data = await response.json();
    
    console.log(`Status: ${response.status} ${response.statusText}`);
    console.log(`Response:`, JSON.stringify(data, null, 2));
    
    return { success: response.ok, status: response.status, data };
    
  } catch (error) {
    console.error(`❌ Error testing ${path}:`, error.message);
    return { success: false, error: error.message };
  }
}

async function runTests() {
  const results = [];
  
  // Test 1: Health check
  console.log('\n🏥 Testing health endpoints...');
  results.push(await testEndpoint('GET', '/health'));
  results.push(await testEndpoint('GET', '/api/slack/health'));
  
  // Test 2: Slack test interaction
  console.log('\n🔘 Testing Slack button simulation...');
  results.push(await testEndpoint('POST', '/api/slack/test-interaction', {
    action_id: 'approve_email',
    booking_id: 'test-booking-123'
  }));
  
  // Test 3: Direct interaction endpoint (simulated Slack payload)
  console.log('\n📡 Testing direct interaction endpoint...');
  const slackPayload = {
    type: 'block_actions',
    user: { id: 'U123TEST', name: 'test-user' },
    channel: { id: 'C123TEST' },
    message: { ts: '1234567890.123456' },
    actions: [{
      action_id: 'approve_email',
      value: 'test-booking-456'
    }]
  };
  
  results.push(await testEndpoint('POST', '/api/slack/interactions', null, {
    'Content-Type': 'application/x-www-form-urlencoded'
  }));
  
  // Summary
  console.log('\n📊 Test Summary:');
  const passed = results.filter(r => r.success).length;
  const total = results.length;
  
  console.log(`✅ Passed: ${passed}/${total}`);
  console.log(`❌ Failed: ${total - passed}/${total}`);
  
  if (passed < total) {
    console.log('\n🚨 Some tests failed. Check the output above for details.');
    console.log('💡 If testing production, ensure the deployment is complete.');
    process.exit(1);
  } else {
    console.log('\n🎉 All tests passed! Slack endpoints are working correctly.');
  }
}

// Run the tests
runTests().catch(console.error);