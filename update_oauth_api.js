
import { readFileSync, writeFileSync } from 'fs';

const path = 'backend/src/api/calendar-oauth.ts';
let content = readFileSync(path, 'utf8');

// Add imports
if (!content.includes("import { existsSync, readFileSync } from 'fs';")) {
    content = content.replace(
        "import { Router, type Request, type Response } from 'express';",
        "import { existsSync, readFileSync } from 'fs';\nimport { join } from 'path';\nimport { Router, type Request, type Response } from 'express';"
    );
}

// Replace /accounts endpoint
const startTag = "router.get('/accounts', async (req: Request, res: Response): Promise<void> => {";
const endTag = "    res.json({"; // We'll match up to the response
const regex = /router\.get\('\/accounts'[\s\S]*?res\.json\(\{[\s\S]*?\}\);[\s\S]*?return;[\s\S]*?\}/;

const replacement = `router.get('/accounts', async (req: Request, res: Response): Promise<void> => {
  const { user_email } = req.query;

  if (!user_email || typeof user_email !== 'string') {
    res.status(400).json({ error: 'user_email query parameter required' });
    return;
  }

  try {
    const supabase = await serviceManager.getService<SupabaseClient>('supabase');
    let calendars = [];
    let isFallback = false;

    if (supabase) {
      try {
        const tableStatus = await ensureCalendarAccountsTable(supabase);
        if (tableStatus.ready) {
          const { data: rawCalendars, error } = await supabase
            .from('calendar_accounts')
            .select('*')
            .eq('user_email', user_email)
            .eq('is_active', true)
            .order('priority', { ascending: false });

          if (!error && rawCalendars) {
            calendars = rawCalendars.map((calendar: any) => ({
              id: calendar.id,
              calendar_email: calendar.calendar_email,
              is_primary: Boolean(calendar.is_primary),
              priority: typeof calendar.priority === 'number' ? calendar.priority : 0,
              is_active: Boolean(calendar.is_active),
              created_at: calendar.created_at,
              webhook_channel_id: calendar.webhook_channel_id ?? null,
              webhook_resource_id: calendar.webhook_resource_id ?? null,
              webhook_expires_at: calendar.webhook_expires_at ?? null,
            }));
          }
        }
      } catch (err) {
        logger.error('Database connection failed during accounts fetch:', err);
      }
    }

    // Fallback to local file if database failed or table not ready
    if (calendars.length === 0) {
      const rootPath = join(process.cwd(), 'data', 'calendar-accounts.json');
      const backendPath = join(process.cwd(), 'backend', 'data', 'calendar-accounts.json');
      const filePath = existsSync(rootPath) ? rootPath : (existsSync(backendPath) ? backendPath : null);

      if (filePath) {
        try {
          const raw = JSON.parse(readFileSync(filePath, 'utf8'));
          if (Array.isArray(raw)) {
            calendars = raw.filter(c => c.user_email === user_email || !c.user_email).map((calendar: any) => ({
              id: calendar.id || \`local-\${calendar.calendar_email}\`,
              calendar_email: calendar.calendar_email,
              is_primary: Boolean(calendar.is_primary),
              priority: typeof calendar.priority === 'number' ? calendar.priority : 0,
              is_active: Boolean(calendar.is_active),
              created_at: calendar.created_at || new Date().toISOString(),
              webhook_channel_id: calendar.webhook_channel_id ?? null,
              webhook_resource_id: calendar.webhook_resource_id ?? null,
              webhook_expires_at: calendar.webhook_expires_at ?? null,
            }));
            isFallback = true;
          }
        } catch (err) {
          logger.error('Failed to read calendar accounts fallback file:', err);
        }
      }
    }

    res.json({
      calendars,
      total: calendars.length,
      max_allowed: 7,
      user_email,
      is_fallback: isFallback,
      warning: isFallback ? 'System is running in degraded mode (local fallback active)' : undefined
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to fetch calendar accounts:', errorMessage);
    res.status(500).json({ error: 'Failed to fetch calendar accounts' });
  }
}`;

if (regex.test(content)) {
    content = content.replace(regex, replacement);
    writeFileSync(path, content, 'utf8');
    console.log('Successfully updated calendar-oauth.ts');
} else {
    console.error('Regex match failed');
}
