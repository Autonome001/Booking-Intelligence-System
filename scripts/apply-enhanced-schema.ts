import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables - try multiple paths
const envPaths = [
  join(__dirname, '..', '..', '.env.local'),        // Parent directory .env.local
  join(__dirname, '..', '..', '.env'),              // Parent directory .env
  join(__dirname, '..', '.env'),                    // Project root .env
  join(__dirname, '..', '.env.local'),              // Project root .env.local
  join(__dirname, '..', 'backend', '.env'),         // Backend directory .env
];

console.log('🔍 Looking for .env files in:');
for (const envPath of envPaths) {
  console.log(`   - ${envPath}`);
  dotenv.config({ path: envPath });
}
console.log('');

const SUPABASE_URL = process.env['SUPABASE_URL'];
const SUPABASE_SERVICE_KEY = process.env['SUPABASE_SERVICE_KEY'];

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing required environment variables: SUPABASE_URL and SUPABASE_SERVICE_KEY');
  console.error('');
  console.error('📝 Please create a .env or .env.local file in the project root with:');
  console.error('');
  console.error('   SUPABASE_URL=your_supabase_url');
  console.error('   SUPABASE_SERVICE_KEY=your_service_role_key');
  console.error('');
  console.error('💡 Make sure the file is saved (not just open in your editor)!');
  process.exit(1);
}

async function applyEnhancedSchema() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Applying Enhanced Database Schema (Phase 1)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  try {
    // Read the enhanced schema migration file
    const migrationPath = join(__dirname, '..', 'database', 'migrations', '002_enhanced_schema.sql');
    console.log(`📄 Reading migration: ${migrationPath}`);

    const migrationSQL = readFileSync(migrationPath, 'utf8');
    console.log(`✅ Migration file loaded (${migrationSQL.length} characters)\n`);

    console.log('🔄 Applying migration to Supabase...');
    console.log('   This will create:');
    console.log('   - calendar_accounts table (multi-calendar support)');
    console.log('   - provisional_holds table (temporary slot reservations)');
    console.log('   - routing_rules table (intelligent routing)');
    console.log('   - email_conversations table (multi-turn email tracking)');
    console.log('   - Enhanced booking_inquiries table (15+ new fields)\n');

    // Execute SQL via Supabase REST API
    console.log('   Executing migration via Supabase REST API...\n');

    const postgrestUrl = SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/';

    const response = await fetch(postgrestUrl + 'rpc/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ query: migrationSQL })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ REST API execution failed, will use manual approach\n');
      console.error('Please run the migration manually:');
      console.error('1. Go to your Supabase dashboard: https://supabase.com/dashboard');
      console.error('2. Select your project');
      console.error('3. Go to SQL Editor');
      console.error(`4. Copy and paste the contents of: ${migrationPath}`);
      console.error('5. Click "Run"\n');
      console.error('Alternatively, copy this command to create the tables:\n');
      console.error('---');
      console.error(migrationSQL);
      console.error('---\n');
      throw new Error(`API Error: ${response.status} - ${errorText}`);
    }

    console.log('   ✅ Migration executed successfully\n');

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  ✅ Enhanced Schema Applied Successfully!');
    console.log('═══════════════════════════════════════════════════════════════\n');

    console.log('New database capabilities:');
    console.log('  ✓ Support for up to 7 Google Calendar accounts');
    console.log('  ✓ Provisional holds (30-min temporary reservations)');
    console.log('  ✓ Intelligent routing rules (YAML-backed)');
    console.log('  ✓ Multi-turn email conversation tracking');
    console.log('  ✓ Enhanced booking inquiries with AI analysis fields\n');

  } catch (error) {
    console.error('\n❌ Migration failed:', error instanceof Error ? error.message : error);
    console.error('\n📌 Manual Migration Instructions:');
    console.error('Since automatic migration failed, please apply the schema manually:\n');
    console.error('1. Open Supabase Dashboard → SQL Editor');
    console.error(`2. Open file: ${join(__dirname, '..', 'database', 'migrations', '002_enhanced_schema.sql')}`);
    console.error('3. Copy the entire SQL content');
    console.error('4. Paste into SQL Editor and click "Run"\n');
    process.exit(1);
  }
}

applyEnhancedSchema();
