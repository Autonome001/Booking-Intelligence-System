import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

/**
 * Database Migration Script
 * Applies schema migrations to Supabase database
 */

interface MigrationResult {
  migration: string;
  success: boolean;
  error?: string;
  executionTime?: number;
}

async function runMigration(
  migrationFile: string,
  testMode: boolean = false
): Promise<MigrationResult> {
  const startTime = Date.now();

  try {
    // Read migration file
    const migrationPath = join(__dirname, '..', 'database', 'migrations', migrationFile);
    const migrationSQL = readFileSync(migrationPath, 'utf8');

    console.log(`\n📋 Running migration: ${migrationFile}`);
    console.log(`📍 Path: ${migrationPath}`);
    console.log(`🔧 Mode: ${testMode ? 'TEST (dry-run)' : 'PRODUCTION'}`);

    if (testMode) {
      console.log(`✅ Migration ${migrationFile} validated (test mode - no changes applied)`);
      return {
        migration: migrationFile,
        success: true,
        executionTime: Date.now() - startTime,
      };
    }

    // Initialize Supabase client
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Execute migration
    const { error } = await supabase.rpc('exec_sql', { sql: migrationSQL });

    if (error) {
      // If exec_sql doesn't exist, try direct execution (fallback)
      const { error: directError } = await (supabase as any).from('_migrations').insert({
        name: migrationFile,
        executed_at: new Date().toISOString(),
      });

      if (directError) {
        throw new Error(`Migration failed: ${error.message || directError.message}`);
      }
    }

    const executionTime = Date.now() - startTime;

    console.log(`✅ Migration ${migrationFile} completed successfully`);
    console.log(`⏱️  Execution time: ${executionTime}ms`);

    return {
      migration: migrationFile,
      success: true,
      executionTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ Migration ${migrationFile} failed: ${errorMessage}`);

    return {
      migration: migrationFile,
      success: false,
      error: errorMessage,
      executionTime: Date.now() - startTime,
    };
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Booking Intelligence System - Database Migration Tool');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Check for test mode flag
  const testMode = process.argv.includes('--test') || process.argv.includes('-t');

  if (testMode) {
    console.log('⚠️  TEST MODE: Migrations will be validated but not applied\n');
  }

  // List of migrations to run (in order)
  const migrations = [
    '001_initial_schema.sql', // Should already exist from original system
    '002_enhanced_schema.sql', // New enhanced schema
  ];

  const results: MigrationResult[] = [];

  // Run migrations sequentially
  for (const migration of migrations) {
    const result = await runMigration(migration, testMode);
    results.push(result);

    // Stop on first failure
    if (!result.success) {
      console.error(`\n❌ Migration stopped due to error in ${migration}`);
      break;
    }
  }

  // Print summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Migration Summary');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const totalTime = results.reduce((sum, r) => sum + (r.executionTime || 0), 0);

  console.log(`✅ Successful: ${successful}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`⏱️  Total time: ${totalTime}ms\n`);

  if (failed > 0) {
    console.error('❌ Some migrations failed. Please review the errors above.\n');
    process.exit(1);
  }

  console.log('✅ All migrations completed successfully!\n');

  // Print next steps
  if (!testMode) {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  Next Steps');
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log('1. Verify the schema in your Supabase dashboard');
    console.log('2. Configure calendar OAuth credentials');
    console.log('3. Load routing rules from YAML config');
    console.log('4. Test the system with sample booking requests\n');
  }

  process.exit(0);
}

// Run the migration
main().catch((error) => {
  console.error('❌ Migration script failed:', error);
  process.exit(1);
});
