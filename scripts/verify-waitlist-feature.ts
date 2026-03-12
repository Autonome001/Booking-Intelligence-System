import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { getAvailabilityDisplaySettings, saveAvailabilityDisplaySettings } from '../backend/src/services/calendar/availabilityDisplaySettings.js';
import fetch from 'node-fetch';
import { readFileSync } from 'fs';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const userEmail = 'dev@autonome.us';

const supabase = createClient(supabaseUrl, supabaseKey);

async function applyMigration() {
  console.log('\n--- 0. Applying Database Migration ---');
  const migrationSQL = readFileSync('./database/migrations/009_waitlist_feature.sql', 'utf8');
  
  const postgrestUrl = supabaseUrl.replace(/\/$/, '') + '/rest/v1/';
  
  const response = await fetch(postgrestUrl + 'rpc/query', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({ query: migrationSQL })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.warn('⚠️ Migration RPC failed (might be expected if query rpc is missing):', errorText);
    return false;
  }

  console.log('✅ Migration executed successfully');
  return true;
}

async function verify() {
  console.log('🚀 Starting Waitlist Feature Verification...');

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase credentials in .env.local');
    process.exit(1);
  }

  await applyMigration();

  try {
    // 1. Test Settings Persistence
    console.log('\n--- 1. Testing Settings Persistence ---');
    const initialSettings = await getAvailabilityDisplaySettings(supabase, userEmail, 14);
    console.log('Current Waitlist Mode:', initialSettings.waitlistEnabled);

    console.log('Updating Waitlist Mode to TRUE...');
    const updated = await saveAvailabilityDisplaySettings(supabase, userEmail, { waitlistEnabled: true }, 14);
    console.log('Updated Waitlist Mode:', updated.waitlistEnabled);

    if (updated.waitlistEnabled !== true) {
      throw new Error('Failed to update waitlistEnabled to true');
    }

    console.log('Restoring Waitlist Mode to FALSE...');
    await saveAvailabilityDisplaySettings(supabase, userEmail, { waitlistEnabled: false }, 14);
    const restored = await getAvailabilityDisplaySettings(supabase, userEmail, 14);
    console.log('Restored Waitlist Mode:', restored.waitlistEnabled);
    console.log('✅ Settings Persistence Test Passed');

    // 2. Test Waitlist Submission (Mock Data)
    console.log('\n--- 2. Testing Waitlist Submission ---');
    const testSubmission = {
      name: 'Test User',
      email: `test-${Date.now()}@example.com`,
      interest_level: 'platform'
    };

    const { data: submissionData, error: submissionError } = await supabase
      .from('waitlist_submissions')
      .insert([testSubmission])
      .select()
      .single();

    if (submissionError) {
      console.error('❌ Insertion failed:', {
        message: submissionError.message,
        details: submissionError.details,
        hint: submissionError.hint,
        code: submissionError.code
      });
      throw new Error('Waitlist submission insertion failed');
    }

    console.log('✅ Waitlist Submission stored successfully:', submissionData.id);

    // 3. Cleanup
    console.log('\n--- 3. Cleanup ---');
    const { error: deleteError } = await supabase
      .from('waitlist_submissions')
      .delete()
      .eq('id', submissionData.id);
    
    if (deleteError) {
      console.warn('⚠️ Cleanup failed (non-critical):', deleteError.message);
    } else {
      console.log('✅ Cleanup successful');
    }

    console.log('\n🎉 ALL VERIFICATION TESTS PASSED!');
  } catch (error) {
    console.error('\n❌ VERIFICATION FAILED:', error.message);
    process.exit(1);
  }
}

verify();
