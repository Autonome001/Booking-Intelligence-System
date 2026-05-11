
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * EMERGENCY RESTORE SCRIPT
 * 
 * 1. Verifies exec_sql exists
 * 2. Applies all missing migrations
 * 3. Restores settings from local JSON backups
 */

function loadEnv() {
  const envPaths = ['.env.local', '.env'];
  for (const path of envPaths) {
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf8');
      const env = {};
      content.split('\n').forEach(line => {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) env[match[1]] = match[2].replace(/['"]/g, '');
      });
      if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) return env;
    }
  }
  throw new Error('Could not find .env with Supabase credentials');
}

const env = loadEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

async function run() {
  console.log('🚀 STARTING EMERGENCY DATABASE RESTORE');
  console.log('════════════════════════════════════════');

  // 1. Check for exec_sql
  const { error: rpcError } = await supabase.rpc('exec_sql', { sql: 'SELECT 1;' });
  if (rpcError && rpcError.message.includes('could not find the function')) {
    console.error('❌ CRITICAL ERROR: exec_sql function is missing.');
    console.error('   Please run the following SQL in your Supabase SQL Editor first:');
    console.error('\n   CREATE OR REPLACE FUNCTION exec_sql(sql text)');
    console.error('   RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$');
    console.error('   BEGIN EXECUTE sql; END; $$;\n');
    return;
  }
  console.log('✅ Master key (exec_sql) is present.');

  // 2. Apply Schema
  console.log('\n🔨 Applying Schema migrations...');
  const schemaPath = join(process.cwd(), 'database', 'schema.sql');
  if (existsSync(schemaPath)) {
    const schemaSql = readFileSync(schemaPath, 'utf8');
    const statements = schemaSql.split(';').map(s => s.trim()).filter(s => s.length > 0 && !s.startsWith('--'));
    for (const stmt of statements) {
      const { error } = await supabase.rpc('exec_sql', { sql: stmt + ';' });
      if (error && !error.message.includes('already exists')) {
        console.warn(`   ⚠️  Statement warning: ${error.message}`);
      }
    }
    console.log('✅ Base schema applied.');
  }

  // 3. Apply Specific Migrations
  const migrations = [
    '002_enhanced_schema_FIXED.sql',
    '006_booking_display_settings.sql',
    '009_waitlist_feature.sql',
    '011_booking_display_personal_view.sql'
  ];

  for (const m of migrations) {
    const mPath = join(process.cwd(), 'database', 'migrations', m);
    if (existsSync(mPath)) {
      const sql = readFileSync(mPath, 'utf8');
      const { error } = await supabase.rpc('exec_sql', { sql });
      if (error && !error.message.includes('already exists')) {
        console.warn(`   ⚠️  Migration ${m} warning: ${error.message}`);
      } else {
        console.log(`✅ Migration ${m} applied.`);
      }
    }
  }

  // 4. Restore Settings from JSON
  console.log('\n💾 Restoring settings from local backups...');
  const settingsPath = join(process.cwd(), 'backend', 'data', 'availability-display-settings.json');
  if (existsSync(settingsPath)) {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    for (const [email, data] of Object.entries(settings)) {
      const { error } = await supabase
        .from('booking_display_settings')
        .upsert({
          user_email: email,
          ...data,
          updated_at: new Date().toISOString()
        });
      if (error) {
        console.error(`   ❌ Failed to restore settings for ${email}: ${error.message}`);
      } else {
        console.log(`✅ Restored settings for ${email}`);
      }
    }
  }

  const notificationPath = join(process.cwd(), 'backend', 'data', 'meeting-notification-settings.json');
  if (existsSync(notificationPath)) {
    const notifications = JSON.parse(readFileSync(notificationPath, 'utf8'));
    for (const [email, data] of Object.entries(notifications)) {
      const { error } = await supabase
        .from('meeting_notification_settings')
        .upsert({
          user_email: email,
          ...data,
          updated_at: new Date().toISOString()
        });
      if (error) {
        console.error(`   ❌ Failed to restore notification settings for ${email}: ${error.message}`);
      } else {
        console.log(`✅ Restored notification settings for ${email}`);
      }
    }
  }

  console.log('\n🏁 RESTORE COMPLETED');
  console.log('════════════════════════════════════════');
}

run();
