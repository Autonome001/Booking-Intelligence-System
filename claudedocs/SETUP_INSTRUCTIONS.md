# Setup Instructions - Booking Intelligence System

## Current Status: Ready for Database Migration

### ✅ Completed
- TypeScript migration (100% complete)
- Advanced YAML configuration system
- Enhanced database schema files created
- Migration scripts ready
- .env file template created

### 🔄 Next Steps

#### 1. Fill in Environment Variables

Open the `.env` file in the project root and replace the placeholder values with your actual credentials:

**Required for Database Migration:**
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**How to get these values:**
1. Go to your Supabase project dashboard
2. Click "Settings" → "API"
3. Copy the "Project URL" → paste as SUPABASE_URL
4. Copy the "service_role" key (under "Project API keys") → paste as SUPABASE_SERVICE_KEY

**Other Required Services:**
```env
OPENAI_API_KEY=sk-...
SLACK_BOT_TOKEN=xoxb-...
SLACK_CHANNEL_ID=C...
SLACK_SIGNING_SECRET=...
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=noreply@yourdomain.com
```

#### 2. Run Database Migration

Once you've filled in your Supabase credentials:

```bash
npm run migrate
```

This will create 4 new tables:
- `calendar_accounts` - Multi-calendar support (up to 7 calendars)
- `provisional_holds` - Temporary slot reservations
- `routing_rules` - Intelligent routing engine
- `email_conversations` - Multi-turn email tracking

Plus enhance the `booking_inquiries` table with 15+ new fields.

#### 3. Verify Migration Success

You should see output like:
```
═══════════════════════════════════════════════════════════════
  Applying Enhanced Database Schema (Phase 1)
═══════════════════════════════════════════════════════════════

📄 Reading migration: database/migrations/002_enhanced_schema.sql
✅ Migration file loaded (XXX characters)

🔄 Applying migration to Supabase...
   [1/XX] Executing statement...
   ✅ Statement executed successfully
   ...

═══════════════════════════════════════════════════════════════
  ✅ Enhanced Schema Applied Successfully!
═══════════════════════════════════════════════════════════════
```

## Phase 2: Multi-Calendar Integration (Next)

After successful database migration, we'll proceed with:
1. Google Calendar API integration (OAuth2)
2. Calendar aggregator for 7 calendars
3. Availability engine with intersection logic
4. Provisional holds system
5. Calendar webhook integration

## Troubleshooting

### Migration fails with "Missing environment variables"
- Make sure you've saved the .env file (not just opened it)
- Verify the filename is exactly `.env` (not `.env.txt` or `.env.local.txt`)
- Check that SUPABASE_URL and SUPABASE_SERVICE_KEY are filled in

### Migration fails with "Authentication failed"
- Verify you're using the **service_role** key, not the anon/public key
- Check that your Supabase project is active
- Verify the URL format: `https://xxxxx.supabase.co` (no trailing slash)

### "exec_sql function does not exist"
- This function needs to be created in your Supabase database first
- Go to Supabase SQL Editor and run:
```sql
CREATE OR REPLACE FUNCTION exec_sql(sql text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  EXECUTE sql;
END;
$$;
```

## Need Help?

Check the migration script for detailed error messages:
- Location: `scripts/apply-enhanced-schema.ts`
- The script checks 3 locations for .env files:
  - Project root: `.env`
  - Project root: `.env.local`
  - Backend folder: `backend/.env`
