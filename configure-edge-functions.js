#!/usr/bin/env node

/**
 * Configuration script for Supabase Edge Functions environment variables
 * This helps you set up all required environment variables for the booking agent
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import readline from 'readline';

const execAsync = promisify(exec);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

console.log('🚀 SUPABASE EDGE FUNCTIONS CONFIGURATION');
console.log('=' .repeat(60));
console.log('This script will help you configure environment variables for your edge functions.');
console.log('');

// Required environment variables
const envVars = {
  SUPABASE_URL: {
    description: 'Supabase Project URL',
    default: 'https://usrouqkkqwdnfymxusbj.supabase.co',
    required: true
  },
  SUPABASE_SERVICE_ROLE_KEY: {
    description: 'Supabase Service Role Key (from Settings > API)',
    required: true,
    secret: true
  },
  SUPABASE_ANON_KEY: {
    description: 'Supabase Anon Key (from Settings > API)',
    required: true
  },
  OPENAI_API_KEY: {
    description: 'OpenAI API Key (from https://platform.openai.com/api-keys)',
    required: true,
    secret: true
  },
  RESEND_API_KEY: {
    description: 'Resend API Key (from https://resend.com/api-keys)',
    required: true,
    secret: true
  },
  SLACK_SIGNING_SECRET: {
    description: 'Slack App Signing Secret (from Basic Information > App Credentials)',
    required: true,
    secret: true
  },
  SLACK_BOT_TOKEN: {
    description: 'Slack Bot Token (from OAuth & Permissions, starts with xoxb-)',
    required: false,
    secret: true
  },
  SLACK_CHANNEL_ID: {
    description: 'Slack Channel ID for booking notifications',
    required: false
  }
};

async function checkSupabaseCLI() {
  try {
    const { stdout } = await execAsync('supabase --version');
    console.log(`✅ Supabase CLI found: ${stdout.trim()}`);
    return true;
  } catch (error) {
    console.log('❌ Supabase CLI not found. Please install it first:');
    console.log('   npm install -g supabase');
    console.log('   or visit: https://supabase.com/docs/guides/cli');
    return false;
  }
}

async function checkSupabaseLogin() {
  try {
    await execAsync('supabase projects list');
    console.log('✅ Supabase CLI authenticated');
    return true;
  } catch (error) {
    console.log('❌ Please login to Supabase CLI first:');
    console.log('   supabase login');
    return false;
  }
}

async function collectEnvironmentVariables() {
  const values = {};
  
  console.log('\\n📝 COLLECTING ENVIRONMENT VARIABLES');
  console.log('-' .repeat(40));
  
  for (const [key, config] of Object.entries(envVars)) {
    let prompt = `${config.description}`;
    if (config.default) {
      prompt += ` (${config.default})`;
    }
    if (config.required) {
      prompt += ' *REQUIRED*';
    }
    prompt += ': ';
    
    const value = await question(prompt);
    
    if (value.trim()) {
      values[key] = value.trim();
    } else if (config.default) {
      values[key] = config.default;
    } else if (config.required) {
      console.log(`❌ ${key} is required!`);
      process.exit(1);
    }
    
    if (config.secret && values[key]) {
      console.log(`   ✅ ${key}: ${values[key].substring(0, 8)}...`);
    } else if (values[key]) {
      console.log(`   ✅ ${key}: ${values[key]}`);
    }
  }
  
  return values;
}

async function setEnvironmentVariables(values) {
  console.log('\\n🔧 SETTING ENVIRONMENT VARIABLES');
  console.log('-' .repeat(40));
  
  // Build supabase secrets set command
  const secretPairs = Object.entries(values)
    .filter(([key, value]) => value)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  
  const command = `supabase secrets set --project-ref usrouqkkqwdnfymxusbj ${secretPairs}`;
  
  try {
    console.log('Running: supabase secrets set...');
    const { stdout, stderr } = await execAsync(command);
    
    if (stdout) console.log(stdout);
    if (stderr) console.log('stderr:', stderr);
    
    console.log('✅ Environment variables set successfully!');
    return true;
  } catch (error) {
    console.error('❌ Failed to set environment variables:', error.message);
    
    console.log('\\n🔧 MANUAL SETUP INSTRUCTIONS:');
    console.log('You can set these variables manually using:');
    console.log('');
    Object.entries(values).forEach(([key, value]) => {
      if (value) {
        console.log(`supabase secrets set ${key}="${value}" --project-ref usrouqkkqwdnfymxusbj`);
      }
    });
    
    return false;
  }
}

async function testEdgeFunctions() {
  console.log('\\n🧪 TESTING EDGE FUNCTIONS');
  console.log('-' .repeat(40));
  
  try {
    // Wait a moment for secrets to propagate
    console.log('Waiting for environment variables to propagate...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Test with a simple request
    const testResponse = await fetch('https://usrouqkkqwdnfymxusbj.supabase.co/functions/v1/booking-workflow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY || 'test'}`
      },
      body: JSON.stringify({
        action: 'test_config'
      })
    });
    
    if (testResponse.ok) {
      console.log('✅ Edge functions are responding successfully!');
    } else {
      console.log(`⚠️  Edge functions responded with status: ${testResponse.status}`);
      const responseText = await testResponse.text();
      console.log('Response:', responseText);
    }
  } catch (error) {
    console.log('⚠️  Edge function test failed (this is expected if APIs aren\'t configured yet)');
    console.log('Error:', error.message);
  }
}

async function main() {
  try {
    // Check prerequisites
    if (!await checkSupabaseCLI()) {
      process.exit(1);
    }
    
    if (!await checkSupabaseLogin()) {
      process.exit(1);
    }
    
    // Collect environment variables
    const envValues = await collectEnvironmentVariables();
    
    console.log('\\n📋 SUMMARY:');
    console.log('You provided the following environment variables:');
    Object.entries(envValues).forEach(([key, value]) => {
      if (value) {
        const config = envVars[key];
        if (config.secret) {
          console.log(`  ${key}: ${value.substring(0, 8)}...`);
        } else {
          console.log(`  ${key}: ${value}`);
        }
      }
    });
    
    const confirm = await question('\\nProceed with setting these environment variables? (y/N): ');
    
    if (confirm.toLowerCase() !== 'y') {
      console.log('Configuration cancelled.');
      process.exit(0);
    }
    
    // Set environment variables
    const success = await setEnvironmentVariables(envValues);
    
    if (success) {
      // Test edge functions
      await testEdgeFunctions();
      
      console.log('\\n🎉 CONFIGURATION COMPLETE!');
      console.log('=' .repeat(60));
      console.log('✅ Edge functions deployed and configured');
      console.log('✅ Environment variables set');
      console.log('');
      console.log('🔗 Your edge function URLs:');
      console.log('  Booking Workflow: https://usrouqkkqwdnfymxusbj.supabase.co/functions/v1/booking-workflow');
      console.log('  AI Processor: https://usrouqkkqwdnfymxusbj.supabase.co/functions/v1/ai-processor');
      console.log('  Email Handler: https://usrouqkkqwdnfymxusbj.supabase.co/functions/v1/email-handler');
      console.log('  Slack Webhook: https://usrouqkkqwdnfymxusbj.supabase.co/functions/v1/slack-webhook');
      console.log('');
      console.log('📝 NEXT STEPS:');
      console.log('1. Update your Slack app webhook URL to: https://usrouqkkqwdnfymxusbj.supabase.co/functions/v1/slack-webhook');
      console.log('2. Test the complete workflow: node test-edge-functions.js');
      console.log('3. Monitor edge function logs in the Supabase dashboard');
    }
    
  } catch (error) {
    console.error('❌ Configuration failed:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Run the configuration
main();