
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const path = 'backend/src/api/calendar-oauth.ts';
let content = readFileSync(path, 'utf8');

// The replacement logic for the callback
const replacement = `    // Store credentials - resilient approach
    let savedToDb = false;
    const accountData = {
      user_email,
      calendar_email: calendarEmail,
      calendar_type: 'google',
      oauth_credentials: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry_date: tokens.expiry_date,
      },
      is_primary: false, // Default, will update if needed
      priority: 1,
      is_active: true,
    };

    const supabase = await serviceManager.getService<SupabaseClient>('supabase');
    if (supabase) {
      try {
        const tableStatus = await ensureCalendarAccountsTable(supabase);
        if (tableStatus.ready) {
          const { data: existingPrimary } = await supabase
            .from('calendar_accounts')
            .select('id')
            .eq('user_email', user_email)
            .eq('is_active', true)
            .eq('is_primary', true)
            .maybeSingle();

          accountData.is_primary = !existingPrimary;
          accountData.priority = existingPrimary ? 1 : 100;

          const { error: insertError } = await supabase
            .from('calendar_accounts')
            .insert(accountData);

          if (!insertError) {
            savedToDb = true;
            logger.info(\`✅ Successfully saved calendar \${calendarEmail} to database\`);
          } else {
            logger.warn(\`⚠️ Database save failed for \${calendarEmail}, falling back to local file: \${insertError.message}\`);
          }
        }
      } catch (err) {
        logger.error('Supabase connection error during OAuth callback, falling back to local:', err);
      }
    }

    // Always ensure local fallback is updated
    try {
      const rootPath = join(process.cwd(), 'data', 'calendar-accounts.json');
      const backendPath = join(process.cwd(), 'backend', 'data', 'calendar-accounts.json');
      const filePath = existsSync(backendPath) ? backendPath : rootPath;
      const dirPath = dirname(filePath);
      
      if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
      
      let accounts = [];
      if (existsSync(filePath)) {
        try {
          const raw = JSON.parse(readFileSync(filePath, 'utf8'));
          if (Array.isArray(raw)) accounts = raw;
        } catch (e) { /* ignore parse error */ }
      }
      
      // Remove existing entry for same email if present
      accounts = accounts.filter(a => a.calendar_email !== calendarEmail);
      accounts.push({ ...accountData, id: \`local-\${Date.now()}\`, created_at: new Date().toISOString() });
      
      writeFileSync(filePath, JSON.stringify(accounts, null, 2), 'utf8');
      logger.info(\`✅ Local fallback updated for \${calendarEmail}\`);
    } catch (err) {
      logger.error('Failed to update local fallback file:', err);
      if (!savedToDb) throw new Error('Failed to save calendar credentials to both database and local fallback');
    }

    await refreshCalendarRuntimeState();
    res.redirect(\`/admin?connected=true&email=\${encodeURIComponent(calendarEmail)}\${!savedToDb ? '&warning=offline_sync_active' : ''}\`);
`;

// Regex to replace the whole block from "Store credentials in database" to "Redirect to admin page"
const regex = /\/\/ Store credentials in database[\s\S]*?res\.redirect\(\`\/admin\?connected=true[\s\S]*?\`/;

if (regex.test(content)) {
    content = content.replace(regex, replacement);
    writeFileSync(path, content, 'utf8');
    console.log('Successfully updated OAuth callback with local fallback resilience');
} else {
    console.log('Regex failed to match callback block');
    // Try a simpler match if needed
}
