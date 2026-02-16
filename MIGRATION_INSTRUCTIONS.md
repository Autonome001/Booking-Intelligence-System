# Database Migration Instructions

The enhanced database schema needs to be applied manually through the Supabase SQL Editor. This is the most reliable method for complex migrations.

## Step-by-Step Instructions

### 1. Open Supabase Dashboard
Go to: https://supabase.com/dashboard

### 2. Select Your Project
- Find your project: `inntzihbgipggqjvpqyn`
- Click to open it

### 3. Open SQL Editor
- In the left sidebar, click "SQL Editor"
- Click "New query"

### 4. Copy the Migration SQL
Open this file in your text editor:
```
C:\Users\mreug\Projects\Booking Intelligence System\Original Booking Agent\database\migrations\002_enhanced_schema_optimized.sql
```

**IMPORTANT**: Use the `002_enhanced_schema_optimized.sql` file - it's optimized to avoid memory errors.

Copy the entire contents

### 5. Paste and Run
- Paste the SQL into the Supabase SQL Editor
- Click the "Run" button (or press Ctrl+Enter)
- Wait for execution to complete

### 6. Verify Success
You should see a success message and the following new tables created:
- ✅ `calendar_accounts` (7 calendars support)
- ✅ `provisional_holds` (temporary reservations)
- ✅ `routing_rules` (intelligent routing)
- ✅ `email_conversations` (multi-turn tracking)
- ✅ Enhanced `booking_inquiries` (15+ new fields)

### 7. Return Here
Once the migration completes successfully, return to this project and we'll proceed with **Phase 2: Multi-Calendar Integration**.

## What This Migration Does

### New Tables

**calendar_accounts**
- Stores up to 7 Google Calendar accounts
- OAuth credentials (encrypted)
- Priority-based booking selection
- Per-calendar constraints (working hours, buffers)

**provisional_holds**
- Temporary slot reservations (30-min expiration)
- Prevents double-booking during approval
- Auto-release on timeout
- Converts to confirmed events

**routing_rules**
- Intelligent meeting type selection
- Duration calculation
- Priority assignment
- Calendar selection logic

**email_conversations**
- Multi-turn email thread tracking
- Conversation stage management
- Context extraction (AI-parsed)
- Message history storage

### Enhanced Fields on booking_inquiries

- `ai_analysis` - GPT-4o analysis (tier, urgency, budget)
- `qualification_score` - Lead quality score (0-100)
- `meeting_type` - Auto-selected meeting type
- `meeting_duration` - Calculated duration (minutes)
- `priority_level` - Routing priority (1-5)
- `assigned_calendar` - Which calendar to book on
- `provisional_hold_id` - Active hold reference
- `tavus_video_id` - Optional video Q&A integration
- And 7 more tracking fields...

## Troubleshooting

**Error: "memory required is 61 MB, maintenance_work_mem is 32 MB"**
- This means the original migration tried to create too many indexes at once
- **Solution**: Use the optimized migration file (`002_enhanced_schema_optimized.sql`)
- The optimized version creates only essential indexes to avoid memory limits
- Additional indexes can be added later if needed

**Error: "relation already exists"**
- Some tables may already exist - this is OK
- The migration uses `IF NOT EXISTS` checks
- You can safely re-run it

**Error: "permission denied"**
- Make sure you're logged in as the project owner
- Or use a database user with SUPERUSER privileges

**Error: "booking_inquiries does not exist"**
- You need to run the initial schema first
- Check if the table exists in the Table Editor

## After Migration

Once migration is complete, run this to verify:

```bash
npm run migrate:verify
```

Or check manually in Supabase Table Editor - you should see the 4 new tables listed.

## Need Help?

If you encounter any issues:
1. Check the Supabase logs in the dashboard
2. Verify your service_role key has the right permissions
3. Try running individual CREATE TABLE statements one at a time
