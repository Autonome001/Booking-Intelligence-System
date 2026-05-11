
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
if (!env) {
    console.error('No environment variables found');
    process.exit(1);
}
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

async function checkExecSql() {
  console.log('Checking for exec_sql function...');
  try {
    const { data, error } = await supabase.rpc('exec_sql', { sql: 'SELECT 1;' });
    if (error) {
      console.log(`❌ exec_sql check failed: ${error.message} (Code: ${error.code})`);
    } else {
      console.log('✅ exec_sql function exists and is working.');
    }
  } catch (err) {
    console.log(`💥 Exception: ${err.message}`);
  }
}

checkExecSql();
