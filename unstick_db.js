
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

async function unstick() {
  console.log('Attempting to unstick database by terminating active connections...');
  try {
    const { error } = await supabase.rpc('exec_sql', { 
      sql: "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();" 
    });
    if (error) {
      console.log(`❌ Unstick failed: ${error.message} (Code: ${error.code})`);
    } else {
      console.log('✅ Connections terminated. Database should be unstuck.');
    }
  } catch (err) {
    console.log(`💥 Exception: ${err.message}`);
  }
}

unstick();
