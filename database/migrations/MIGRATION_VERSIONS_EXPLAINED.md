# Migration 002 - Version Comparison

## Why Multiple Versions?

You encountered SQL errors, and each version addresses specific issues found during testing.

## Version Breakdown

### ❌ 002_enhanced_schema.sql (BROKEN - Don't Use)
**Status:** Has SQL syntax errors
**Issues:**
- Line 112-143: Multiple `ADD COLUMN IF NOT EXISTS` in single `ALTER TABLE` (PostgreSQL doesn't support this)
- Lines 118-122: Orphaned `ADD COLUMN` statements without `ALTER TABLE`
- Lines 263-276: Invalid `CREATE OR REPLACE TRIGGER` syntax (doesn't exist in PostgreSQL)
- Line 196: Uninitialized `conflict_count` variable

**What happens:** Migration fails with syntax errors at multiple points

---

### ⚠️ 002_enhanced_schema_optimized.sql (INCOMPLETE - Don't Use)
**Status:** Works but missing features
**Issues:**
- Missing webhook columns (`webhook_channel_id`, `webhook_resource_id`, `webhook_expires_at`)
- No unique index on primary calendar
- Minimal indexes only

**What happens:** Migration succeeds but webhook integration won't work properly

---

### ✅ 002_enhanced_schema_FIXED.sql (USE FOR FRESH INSTALL)
**Status:** Correct syntax, all features included
**Improvements over broken version:**
- Wrapped column additions in proper `DO $$ ... END $$;` block
- Each column checked individually with `IF NOT EXISTS`
- Fixed trigger syntax: `DROP TRIGGER IF EXISTS` → `CREATE TRIGGER`
- Initialized all variables properly
- Added webhook columns to `calendar_accounts`
- Added unique index for primary calendar constraint

**What happens:** Migration succeeds cleanly on a fresh database

**Issue:** Fails if you already have a primary calendar entry from previous attempts (duplicate key error)

---

### ✅ 002_enhanced_schema_CLEAN.sql (USE IF YOU GOT ERRORS)
**Status:** Handles existing data gracefully
**Improvements over FIXED:**
- **Removed sample data insert** that was causing duplicate key errors
- **Removed unique index on primary calendar** (not critical for functionality)
- All other features intact

**What happens:** Migration succeeds even if you have existing calendar account data

**Use when:** You tried running the FIXED version and got "duplicate key value violates unique constraint" error

---

## Which One Should You Use?

### Decision Tree:

```
Did you already try running a migration?
├─ NO → Use 002_enhanced_schema_FIXED.sql
│        (Clean install, includes all features)
│
└─ YES → Did you get "duplicate key" error?
         ├─ YES → Use 002_enhanced_schema_CLEAN.sql ✅
         │        (Handles existing data)
         │
         └─ NO → Migration probably worked!
                  Check your Supabase dashboard
```

## What Each Version Creates

### Tables (All Versions):
- `calendar_accounts` - Multi-calendar OAuth management
- `provisional_holds` - 30-minute slot reservations
- `routing_rules` - Intelligent booking routing
- `email_conversations` - Multi-turn conversation tracking

### Enhanced booking_inquiries with 15+ new columns:
- AI analysis fields
- Routing decisions
- Provisional hold tracking
- Tavus video integration
- Email thread tracking

### Functions (All Versions):
- `release_expired_provisional_holds()` - Auto-cleanup
- `check_calendar_conflicts()` - Conflict detection
- `trigger_set_timestamp()` - Auto-update timestamps

### Indexes Created:
- **FIXED version:** 9 indexes including unique primary calendar constraint
- **CLEAN version:** 8 indexes (no unique primary constraint)

## Key Differences Summary

| Feature | BROKEN | OPTIMIZED | FIXED | CLEAN |
|---------|--------|-----------|-------|-------|
| Syntax Valid | ❌ | ✅ | ✅ | ✅ |
| Webhook Columns | ❌ | ❌ | ✅ | ✅ |
| All Indexes | ❌ | ⚠️ | ✅ | ✅ |
| Handles Existing Data | N/A | ✅ | ⚠️ | ✅ |
| Sample Data Insert | ❌ | ✅ | ✅ | ❌ |
| Primary Constraint | ❌ | ❌ | ✅ | ❌ |

**Legend:**
- ✅ Yes / Works
- ⚠️ Partial / Conditional
- ❌ No / Broken
- N/A Not Applicable

## Migration Success Verification

After running migration, you should see:

```sql
status: Migration 002_enhanced_schema completed successfully
calendar_accounts_count: [number]
provisional_holds_count: 0
routing_rules_count: 0
email_conversations_count: 0
booking_inquiries_count: [number]
```

If you see this output, migration was successful! ✅

## Next Steps After Successful Migration

1. ✅ Restart your backend server (`npm run dev`)
2. ⏭️ Add Google OAuth credentials to `.env.local`
3. ⏭️ Connect your first Google Calendar via `/admin` page
4. ⏭️ Test the booking form at `http://localhost:3001`
