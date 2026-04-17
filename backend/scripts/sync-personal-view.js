import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: SUPABASE_URL or SUPABASE_SERVICE_KEY missing from .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function syncPersonalView() {
  const EMAIL = 'dev@autonome.us'; // Default primary user
  const SLUG = 'jamelleeugene';

  console.log(`Checking settings for ${EMAIL}...`);

  const { data, error } = await supabase
    .from('booking_display_settings')
    .select('*')
    .eq('user_email', EMAIL)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('❌ Error fetching settings:', error.message);
    return;
  }

  const settings = {
    user_email: EMAIL,
    personal_view_enabled: true,
    personal_view_slug: SLUG,
    personal_view_brand_name: 'Jamelle Eugene',
    personal_view_title: "Let's Connect",
    personal_view_tagline: 'Intelligence Reinvented',
    updated_at: new Date().toISOString()
  };

  if (!data) {
    console.log('Creating new settings record...');
    const { error: insertError } = await supabase
      .from('booking_display_settings')
      .insert([settings]);
    
    if (insertError) console.error('❌ Insert failed:', insertError.message);
    else console.log('✅ Success: Personal view created.');
  } else {
    console.log('Updating existing settings record...');
    const { error: updateError } = await supabase
      .from('booking_display_settings')
      .update(settings)
      .eq('user_email', EMAIL);

    if (updateError) console.error('❌ Update failed:', updateError.message);
    else console.log('✅ Success: Personal view settings synchronized.');
  }
}

syncPersonalView();
