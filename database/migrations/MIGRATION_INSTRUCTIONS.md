# Database Migration Instructions

## Problem Identified

You were trying to run `002_enhanced_schema.sql` which has **SQL syntax errors**:

### Issues in the Original File:
1. **Broken ALTER TABLE statements** (lines 112-143):
   - PostgreSQL doesn't support multiple `ADD COLUMN IF NOT EXISTS` in a single ALTER TABLE
   - Example of broken syntax:
     ```sql
     ALTER TABLE booking_inquiries
     ADD COLUMN IF NOT EXISTS ai_analysis JSONB DEFAULT '{}',
     ADD COLUMN IF NOT EXISTS qualification_score INTEGER,
     ADD COLUMN IF NOT EXISTS sentiment TEXT;
     ```

2. **Orphaned ADD COLUMN statements** (lines 118-122):
   - Started with `ADD COLUMN` without `ALTER TABLE`

3. **Invalid trigger syntax**:
   - Used `CREATE OR REPLACE TRIGGER` which doesn't exist in PostgreSQL
   - Should use `DROP TRIGGER IF EXISTS` then `CREATE TRIGGER`

4. **Calendar conflict function issues**:
   - Missing initialization for `conflict_count` variable

## Solution

Use the **corrected migration file**: `002_enhanced_schema_FIXED.sql`

### What Was Fixed:
✅ Wrapped all column additions in a proper `DO $$ ... END $$;` block
✅ Each column checked individually with `IF NOT EXISTS`
✅ Fixed trigger syntax with `DROP TRIGGER IF EXISTS` before `CREATE TRIGGER`
✅ Initialized `conflict_count` variable properly
✅ Added webhook-related columns to `calendar_accounts` table
✅ Improved sample data (uses proper email format)

## How to Run the Migration

### ⚠️ If You Got "duplicate key" Error:

You tried running the migration and got:
```
ERROR: duplicate key value violates unique constraint "idx_calendar_accounts_primary"
```

This means you have existing data from previous migration attempts. Use the **CLEAN version** below which handles this gracefully.

### Step 1: Go to Supabase Dashboard
1. Navigate to your project: https://supabase.com/dashboard
2. Click **SQL Editor** in the left sidebar

### Step 2: Copy the CLEAN Migration
1. Open: `database/migrations/002_enhanced_schema_CLEAN.sql`
2. Copy the **entire contents**

### Step 3: Run in SQL Editor
1. Paste the SQL into the editor
2. Click **Run** button
3. Wait for execution (should take ~5 seconds)

### Step 4: Verify Success
You should see output like:
```
status: Migration 002_enhanced_schema completed successfully
calendar_accounts_count: [your existing count]
provisional_holds_count: 0
routing_rules_count: 0
email_conversations_count: 0
booking_inquiries_count: [your existing count]
```

## Expected Results

### Tables Created:
- ✅ `calendar_accounts` - Stores up to 7 Google Calendar connections
- ✅ `provisional_holds` - Temporary slot reservations (30 min expiration)
- ✅ `routing_rules` - Intelligent routing rules for bookings
- ✅ `email_conversations` - Multi-turn conversation tracking

### Booking Inquiries Enhanced:
Added 15+ new columns for AI analysis, routing, provisional holds, and Tavus integration

### Functions Created:
- `release_expired_provisional_holds()` - Auto-cleanup cron job
- `check_calendar_conflicts()` - Conflict detection

### Indexes Created:
9 performance indexes for fast queries

## What Happens After Migration 002

Once this migration completes successfully:

1. **Booking form will work** - `booking_inquiries` table has all required fields
2. **OAuth calendar connections** - Can connect Google Calendars via `/admin` page
3. **Availability system active** - Multi-calendar + blackouts + working hours filtering
4. **Provisional holds enabled** - 30-minute slot reservations during approval

## Troubleshooting

### ❌ Error: "duplicate key value violates unique constraint"

**Full error:**
```
ERROR: 23505: duplicate key value violates unique constraint "idx_calendar_accounts_primary"
DETAIL: Key (is_primary)=(t) already exists.
```

**Cause:** You have existing calendar account data from a previous migration attempt.

**Solution:** Use `002_enhanced_schema_CLEAN.sql` instead - it skips the sample data insert that causes this conflict.

### If you see "already exists" errors:
Some objects may have been created during your previous attempt. This is **OKAY** - the migration uses `IF NOT EXISTS` clauses to skip existing objects.

### If you see "booking_inquiries table not found":
You need to run migration `001_initial_schema.sql` first to create the base tables.

### If migration succeeds but server shows errors:
Restart your backend server to reload the database schema:
```bash
# Stop the server (Ctrl+C in terminal)
# Then restart:
npm run dev
```

## Next Steps After Migration

1. ✅ Migration 002 complete
2. ⏭️ Add Google OAuth credentials to `.env.local`
3. ⏭️ Connect your first Google Calendar via `/admin` page
4. ⏭️ Test booking form at `http://localhost:3001`

## Files Reference

- ❌ **Don't use**: `002_enhanced_schema.sql` (has syntax errors)
- ❌ **Don't use**: `002_enhanced_schema_optimized.sql` (missing webhook columns)
- ⚠️ **Use if fresh install**: `002_enhanced_schema_FIXED.sql` (works for clean database)
- ✅ **Use if you got errors**: `002_enhanced_schema_CLEAN.sql` (handles existing data)
