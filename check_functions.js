
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';

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
  return null;
}

const env = loadEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

async function checkFunctions() {
  console.log('Checking for query function...');
  try {
    const { data: qData, error: qError } = await supabase.rpc('query', { query: 'SELECT 1;' });
    if (qError) {
      console.log(`❌ query check failed: ${qError.message} (Code: ${qError.code})`);
    } else {
      console.log('✅ query function exists.');
    }
  } catch (err) { console.log(`💥 query exception: ${err.message}`); }

  console.log('Checking for exec_sql function...');
  try {
    const { data: eData, error: eError } = await supabase.rpc('exec_sql', { sql: 'SELECT 1;' });
    if (eError) {
      console.log(`❌ exec_sql check failed: ${eError.message} (Code: ${eError.code})`);
    } else {
      console.log('✅ exec_sql function exists.');
    }
  } catch (err) { console.log(`💥 exec_sql exception: ${err.message}`); }
}

checkFunctions();
