import { readFileSync } from 'fs';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  getAvailabilityDisplaySettings,
  saveAvailabilityDisplaySettings,
} from '../backend/src/services/calendar/availabilityDisplaySettings.js';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const userEmail = 'dev@autonome.us';

const supabase = createClient(supabaseUrl, supabaseKey);

async function applyMigration(): Promise<boolean> {
  console.log('\n--- 0. Applying Database Migrations ---');
  const migrationFiles = [
    './database/migrations/009_waitlist_feature.sql',
    './database/migrations/010_booking_display_waitlist_personalization.sql',
  ];
  const postgrestUrl = supabaseUrl.replace(/\/$/, '') + '/rest/v1/';

  for (const migrationFile of migrationFiles) {
    const migrationSQL = readFileSync(migrationFile, 'utf8');
    const response = await fetch(postgrestUrl + 'rpc/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ query: migrationSQL }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(
        `Migration RPC failed for ${migrationFile} (this may be expected if the query RPC is unavailable):`,
        errorText
      );
      return false;
    }
  }

  console.log('Migrations executed successfully');
  return true;
}

async function verify(): Promise<void> {
  console.log('Starting waitlist feature verification...');

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
  }

  await applyMigration();

  try {
    console.log('\n--- 1. Testing Settings Persistence ---');
    const initialSettings = await getAvailabilityDisplaySettings(supabase, userEmail, 14);
    console.log('Current Waitlist Mode:', initialSettings.waitlistEnabled);

    console.log('Updating Waitlist Settings...');
    const updated = await saveAvailabilityDisplaySettings(
      supabase,
      userEmail,
      {
        waitlistEnabled: true,
        waitlistTitle: 'Verification Waitlist Title',
        waitlistDescription: 'Verification waitlist description',
        showWaitlistCopyright: false,
        waitlistCtaTitle: 'Verification CTA Title',
        waitlistCtaDescription: 'Verification CTA Description',
        waitlistCtaButtonText: 'Verification CTA Button',
      },
      14
    );
    console.log('Updated Waitlist Settings:', updated);

    if (
      updated.waitlistEnabled !== true ||
      updated.waitlistTitle !== 'Verification Waitlist Title' ||
      updated.waitlistDescription !== 'Verification waitlist description' ||
      updated.showWaitlistCopyright !== false ||
      updated.waitlistCtaTitle !== 'Verification CTA Title' ||
      updated.waitlistCtaDescription !== 'Verification CTA Description' ||
      updated.waitlistCtaButtonText !== 'Verification CTA Button'
    ) {
      throw new Error('Failed to persist waitlist personalization settings');
    }

    console.log('Restoring Waitlist Settings...');
    await saveAvailabilityDisplaySettings(
      supabase,
      userEmail,
      {
        waitlistEnabled: false,
        waitlistTitle: initialSettings.waitlistTitle,
        waitlistDescription: initialSettings.waitlistDescription,
        showWaitlistCopyright: initialSettings.showWaitlistCopyright,
        waitlistCtaTitle: initialSettings.waitlistCtaTitle,
        waitlistCtaDescription: initialSettings.waitlistCtaDescription,
        waitlistCtaButtonText: initialSettings.waitlistCtaButtonText,
      },
      14
    );
    const restored = await getAvailabilityDisplaySettings(supabase, userEmail, 14);
    console.log('Restored Waitlist Mode:', restored.waitlistEnabled);
    console.log('Settings persistence test passed');

    console.log('\n--- 2. Testing Waitlist Submission ---');
    const testSubmission = {
      name: 'Test User',
      email: `test-${Date.now()}@example.com`,
      interest_level: 'platform',
    };

    const { data: submissionData, error: submissionError } = await supabase
      .from('waitlist_submissions')
      .insert([testSubmission])
      .select()
      .single();

    if (submissionError) {
      console.error('Insertion failed:', {
        message: submissionError.message,
        details: submissionError.details,
        hint: submissionError.hint,
        code: submissionError.code,
      });
      throw new Error('Waitlist submission insertion failed');
    }

    console.log('Waitlist submission stored successfully:', submissionData.id);

    console.log('\n--- 3. Cleanup ---');
    const { error: deleteError } = await supabase
      .from('waitlist_submissions')
      .delete()
      .eq('id', submissionData.id);

    if (deleteError) {
      console.warn('Cleanup failed (non-critical):', deleteError.message);
    } else {
      console.log('Cleanup successful');
    }

    console.log('\nAll verification tests passed');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('\nVerification failed:', errorMessage);
    process.exit(1);
  }
}

void verify();
