#!/usr/bin/env node

/**
 * Apply database schema to Supabase
 * This script applies the schema.sql to ensure all tables exist
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logger } from './src/utils/logger.js';
import { config } from './src/utils/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🔧 APPLYING DATABASE SCHEMA');
console.log('='.repeat(40));

// Initialize Supabase client with service role
const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

async function applySchema() {
  try {
    console.log('📁 Reading schema file...');
    const schemaPath = join(__dirname, 'database', 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf8');
    
    console.log(`✅ Schema loaded (${schema.length} characters)`);
    
    console.log('🔨 Applying schema to database...');
    
    // Split the schema into individual statements
    const statements = schema
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    console.log(`📝 Found ${statements.length} SQL statements to execute`);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      // Skip empty statements and comments
      if (!statement || statement.startsWith('--')) continue;
      
      try {
        console.log(`   [${i + 1}/${statements.length}] Executing: ${statement.substring(0, 50)}...`);
        
        const { data, error } = await supabase.rpc('exec_sql', {
          sql: statement + ';'
        });
        
        if (error) {
          // Some errors are expected (like "already exists")
          if (error.message.includes('already exists') || 
              error.message.includes('does not exist') ||
              error.message.includes('duplicate key')) {
            console.log(`   ⚠️  Expected error: ${error.message}`);
          } else {
            console.error(`   ❌ Error: ${error.message}`);
            errorCount++;
          }
        } else {
          console.log(`   ✅ Success`);
          successCount++;
        }
        
      } catch (error) {
        console.error(`   ❌ Exception: ${error.message}`);
        errorCount++;
      }
    }
    
    console.log('\n📊 SCHEMA APPLICATION SUMMARY');
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    
    return errorCount === 0;
    
  } catch (error) {
    console.error('💥 Failed to apply schema:', error.message);
    return false;
  }
}

async function testTablesAfterSchema() {
  console.log('\n🧪 TESTING TABLES AFTER SCHEMA APPLICATION');
  console.log('='.repeat(40));
  
  const requiredTables = [
    'booking_inquiries',
    'faq_embeddings', 
    'approval_audit_log',
    'email_delivery_log'
  ];
  
  for (const table of requiredTables) {
    try {
      console.log(`🔍 Testing table: ${table}`);
      
      const { data, error } = await supabase
        .from(table)
        .select('count', { count: 'exact', head: true });
      
      if (error) {
        if (error.code === '42P01') {
          console.log(`   ❌ Table '${table}' not found`);
        } else {
          console.log(`   ⚠️  Table '${table}' exists but has issues: ${error.message}`);
        }
      } else {
        console.log(`   ✅ Table '${table}' is accessible (count: ${data || 0})`);
      }
      
    } catch (error) {
      console.log(`   ❌ Error testing '${table}': ${error.message}`);
    }
  }
}

async function runSchemaApplication() {
  const startTime = Date.now();
  
  try {
    console.log('🚀 Starting schema application process...');
    console.log(`📡 Supabase URL: ${config.supabase.url}`);
    console.log('');
    
    const success = await applySchema();
    
    await testTablesAfterSchema();
    
    const duration = Date.now() - startTime;
    
    console.log('\n🏁 SCHEMA APPLICATION COMPLETED');
    console.log('='.repeat(40));
    console.log(`⏱️  Duration: ${duration}ms`);
    
    if (success) {
      console.log('✅ Schema applied successfully!');
      console.log('\n📋 NEXT STEPS:');
      console.log('   1. Run test-db-connectivity.js to verify everything works');
      console.log('   2. Create and deploy edge functions');
      console.log('   3. Test the complete workflow');
    } else {
      console.log('⚠️  Schema application completed with some errors');
      console.log('   Check the errors above and verify manually if needed');
    }
    
  } catch (error) {
    console.error('💥 SCHEMA APPLICATION FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runSchemaApplication();
}

export { applySchema, testTablesAfterSchema };