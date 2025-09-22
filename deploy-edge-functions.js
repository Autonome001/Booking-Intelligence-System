#!/usr/bin/env node

/**
 * Deploy Supabase Edge Functions and configure secrets
 * This script automates the deployment process
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

console.log('🚀 DEPLOYING SUPABASE EDGE FUNCTIONS');
console.log('='.repeat(50));

const FUNCTIONS = [
  'booking-workflow',
  'ai-processor',
  'email-handler',
  'slack-webhook'
];

const REQUIRED_SECRETS = [
  'OPENAI_API_KEY',
  'SLACK_BOT_TOKEN',
  'SLACK_CHANNEL_ID',
  'RESEND_API_KEY',
  'EMAIL_FROM_ADDRESS',
  'EMAIL_FROM_NAME'
];

function runCommand(command, description) {
  console.log(`📋 ${description}...`);
  console.log(`   Command: ${command}`);
  
  try {
    const output = execSync(command, { 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    console.log(`✅ ${description} completed`);
    if (output.trim()) {
      console.log(`   Output: ${output.trim()}`);
    }
    return true;
  } catch (error) {
    console.error(`❌ ${description} failed:`, error.message);
    if (error.stdout) {
      console.log(`   Stdout: ${error.stdout}`);
    }
    if (error.stderr) {
      console.error(`   Stderr: ${error.stderr}`);
    }
    return false;
  }
}

function checkSupabaseCLI() {
  console.log('🔍 Checking Supabase CLI installation...');
  
  try {
    const version = execSync('supabase --version', { encoding: 'utf8' });
    console.log(`✅ Supabase CLI found: ${version.trim()}`);
    return true;
  } catch (error) {
    console.error('❌ Supabase CLI not found!');
    console.log('   Install it with: npm install -g supabase');
    console.log('   Or visit: https://supabase.com/docs/guides/cli');
    return false;
  }
}

function checkEnvironmentVariables() {
  console.log('\n🔐 Checking environment variables...');
  
  const missing = [];
  
  for (const secret of REQUIRED_SECRETS) {
    if (!process.env[secret]) {
      missing.push(secret);
      console.log(`   ❌ ${secret}: MISSING`);
    } else {
      const value = process.env[secret];
      const displayValue = secret.includes('KEY') || secret.includes('TOKEN') 
        ? `${value.substring(0, 8)}...` 
        : value;
      console.log(`   ✅ ${secret}: ${displayValue}`);
    }
  }
  
  if (missing.length > 0) {
    console.log(`\n⚠️  Missing ${missing.length} required environment variables:`);
    missing.forEach(var_ => console.log(`   - ${var_}`));
    return false;
  }
  
  console.log('✅ All required environment variables are set');
  return true;
}

function loginToSupabase() {
  console.log('\n🔑 Checking Supabase authentication...');
  
  try {
    // Check if already logged in
    const projects = execSync('supabase projects list', { 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    if (projects.includes('usrouqkkqwdnfymxusbj')) {
      console.log('✅ Already authenticated and project found');
      return true;
    }
  } catch (error) {
    console.log('⚠️  Not authenticated or project not accessible');
  }
  
  console.log('🔐 Please login to Supabase...');
  console.log('   Run: supabase login');
  console.log('   Then link your project: supabase link --project-ref usrouqkkqwdnfymxusbj');
  return false;
}

function deployFunction(functionName) {
  console.log(`\n🚀 Deploying function: ${functionName}`);
  
  return runCommand(
    `supabase functions deploy ${functionName}`,
    `Deploy ${functionName} function`
  );
}

function setSecret(secretName, secretValue) {
  if (!secretValue) {
    console.log(`⚠️  Skipping ${secretName} - no value provided`);
    return false;
  }
  
  // Mask sensitive values in logs
  const displayValue = secretName.includes('KEY') || secretName.includes('TOKEN')
    ? `${secretValue.substring(0, 8)}...`
    : secretValue;
    
  console.log(`🔐 Setting secret: ${secretName} = ${displayValue}`);
  
  return runCommand(
    `supabase secrets set ${secretName}="${secretValue}"`,
    `Set secret ${secretName}`
  );
}

function configureSecrets() {
  console.log('\n🔐 CONFIGURING SUPABASE SECRETS');
  console.log('='.repeat(50));
  
  let successCount = 0;
  
  for (const secret of REQUIRED_SECRETS) {
    const value = process.env[secret];
    if (setSecret(secret, value)) {
      successCount++;
    }
  }
  
  console.log(`\n📊 Secrets configuration: ${successCount}/${REQUIRED_SECRETS.length} successful`);
  return successCount === REQUIRED_SECRETS.length;
}

function deployAllFunctions() {
  console.log('\n🚀 DEPLOYING EDGE FUNCTIONS');
  console.log('='.repeat(50));
  
  let successCount = 0;
  
  for (const functionName of FUNCTIONS) {
    if (deployFunction(functionName)) {
      successCount++;
    }
  }
  
  console.log(`\n📊 Function deployment: ${successCount}/${FUNCTIONS.length} successful`);
  return successCount === FUNCTIONS.length;
}

function getFunctionUrls() {
  console.log('\n🔗 FUNCTION URLs');
  console.log('='.repeat(50));
  
  const projectUrl = 'https://usrouqkkqwdnfymxusbj.supabase.co';
  
  for (const functionName of FUNCTIONS) {
    console.log(`${functionName}: ${projectUrl}/functions/v1/${functionName}`);
  }
}

async function runDeployment() {
  const startTime = Date.now();
  
  try {
    console.log('🎯 Starting Supabase Edge Functions deployment...\n');
    
    // Pre-flight checks
    if (!checkSupabaseCLI()) {
      process.exit(1);
    }
    
    if (!checkEnvironmentVariables()) {
      console.log('\n💡 Add missing variables to your .env file first');
      process.exit(1);
    }
    
    if (!loginToSupabase()) {
      console.log('\n💡 Please authenticate with Supabase first');
      process.exit(1);
    }
    
    // Deploy functions
    const functionsDeployed = deployAllFunctions();
    
    // Configure secrets  
    const secretsConfigured = configureSecrets();
    
    const duration = Date.now() - startTime;
    
    console.log('\n🏁 DEPLOYMENT COMPLETED');
    console.log('='.repeat(50));
    console.log(`⏱️  Total time: ${duration}ms`);
    
    if (functionsDeployed && secretsConfigured) {
      console.log('🎉 All functions deployed and secrets configured!');
      
      getFunctionUrls();
      
      console.log('\n📋 NEXT STEPS:');
      console.log('1. Test functions with: node test-edge-functions.js');
      console.log('2. Check function logs in Supabase dashboard');
      console.log('3. Monitor function performance and errors');
      console.log('4. Update Slack webhook URLs if needed');
      
      process.exit(0);
    } else {
      console.log('⚠️  Deployment completed with some issues');
      console.log('   Check the errors above and retry if needed');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n💥 DEPLOYMENT FAILED:', error.message);
    process.exit(1);
  }
}

// Run deployment if script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runDeployment();
}

export { 
  runDeployment,
  checkSupabaseCLI,
  checkEnvironmentVariables,
  deployAllFunctions,
  configureSecrets
};