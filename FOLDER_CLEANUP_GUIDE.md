# Folder Cleanup Guide

## Current Structure Issues

Your current folder structure:
```
C:\Users\mreug\Projects\Booking Intelligence System\
├── .env.local (environment variables)
├── Original Booking Agent\
│   ├── backend\
│   ├── database\
│   └── ... (your working system)
└── Sales System\
    └── ... (can be deleted)
```

## Proposed Clean Structure

After cleanup:
```
C:\Users\mreug\Projects\Booking Intelligence System\
├── .env.local
├── backend\
├── database\
└── ... (all files directly in root)
```

---

## Step-by-Step Cleanup Instructions

### ⚠️ IMPORTANT: Backup First!

Before making any changes, create a backup:

```powershell
# Create backup (run in PowerShell)
cd "C:\Users\mreug\Projects"
Copy-Item -Path "Booking Intelligence System" -Destination "Booking Intelligence System BACKUP $(Get-Date -Format 'yyyy-MM-dd')" -Recurse
```

---

### Step 1: Delete Sales System Folder

**What it is:** Separate project that's not part of the booking system

**Safe to delete:** Yes

```powershell
# Navigate to project root
cd "C:\Users\mreug\Projects\Booking Intelligence System"

# Delete Sales System folder
Remove-Item -Path "Sales System" -Recurse -Force
```

**Verification:**
- Sales System folder should be gone
- Only "Original Booking Agent" folder remains

---

### Step 2: Move Contents from "Original Booking Agent" to Root

**Goal:** Flatten structure so backend/, database/ are directly in root

```powershell
# Still in C:\Users\mreug\Projects\Booking Intelligence System

# Move all contents from "Original Booking Agent" to current directory
Get-ChildItem -Path "Original Booking Agent" | Move-Item -Destination .

# Delete now-empty "Original Booking Agent" folder
Remove-Item -Path "Original Booking Agent" -Force
```

**Verification:**
```powershell
# Check current structure
Get-ChildItem

# You should see:
# - backend/
# - database/
# - .env.local
# - WHATS_NEXT.md
# - etc.
```

---

### Step 3: Verify Environment Variables

**Check .env.local location:**

```powershell
# Should be at project root
Test-Path ".env.local"
# Output: True

# View contents (first 5 lines)
Get-Content ".env.local" -Head 5
```

**If .env.local is missing:**

The file should already be in the root. If not, check `Original Booking Agent/.env.local` before moving.

---

### Step 4: Update Git (if using version control)

If you have a git repository:

```powershell
# Navigate to project root
cd "C:\Users\mreug\Projects\Booking Intelligence System"

# Check git status
git status

# Add changes
git add .

# Commit
git commit -m "Cleanup: Flatten folder structure, remove Sales System"
```

---

### Step 5: Test Backend Still Works

```powershell
# Navigate to backend
cd backend

# Install dependencies (if needed)
npm install

# Start server
npm run dev

# Should see:
# ✅ All services initialized successfully
# 🚀 Server running on port 3001
```

**Verification URLs:**
- Booking form: http://localhost:3001
- Admin page: http://localhost:3001/admin
- Health check: http://localhost:3001/health

---

## Final Structure Verification

After cleanup, your structure should be:

```
C:\Users\mreug\Projects\Booking Intelligence System\
│
├── .env.local                    # Environment variables
├── .gitignore                    # Git ignore rules
├── WHATS_NEXT.md                # Next steps guide
├── FOLDER_CLEANUP_GUIDE.md      # This guide
├── RAILWAY_DEPLOYMENT.md        # Deployment instructions
├── SLACK_SETUP.md               # Slack configuration
│
├── backend/                      # Backend server
│   ├── src/                     # Source code
│   ├── public/                  # Static files (HTML, CSS, JS)
│   ├── server.ts                # Main server file
│   ├── package.json             # Dependencies
│   ├── tsconfig.json            # TypeScript config
│   └── node_modules/            # Installed packages
│
└── database/                     # Database migrations
    └── migrations/
        ├── 001_initial_schema.sql
        ├── 002_enhanced_schema_CLEAN.sql
        ├── 003_availability_controls.sql
        ├── MIGRATION_INSTRUCTIONS.md
        └── MIGRATION_VERSIONS_EXPLAINED.md
```

---

## Troubleshooting

### Issue: "Access denied" when deleting folders

**Solution:** Close any VSCode/editor windows that have files open in those folders

### Issue: "Cannot remove item" error

**Solution:** Some files may be read-only or in use

```powershell
# Remove read-only attribute
Get-ChildItem -Path "folder-name" -Recurse | Set-ItemProperty -Name IsReadOnly -Value $false

# Then try delete again
Remove-Item -Path "folder-name" -Recurse -Force
```

### Issue: .env.local not found after moving

**Check both locations:**

```powershell
# Check root
Test-Path "C:\Users\mreug\Projects\Booking Intelligence System\.env.local"

# Check old location
Test-Path "C:\Users\mreug\Projects\Booking Intelligence System\Original Booking Agent\.env.local"

# If in old location, move it
Move-Item "Original Booking Agent\.env.local" ".\"
```

### Issue: Server won't start after cleanup

**Likely cause:** Working directory changed

**Solution:** Update paths in VSCode/terminal

```powershell
# Navigate to correct backend folder
cd "C:\Users\mreug\Projects\Booking Intelligence System\backend"

# Start server
npm run dev
```

---

## What Gets Deleted (Safe to Remove)

### ✅ Sales System folder
- Separate project
- Not used by booking system
- ~MB of files

### ✅ Original Booking Agent wrapper folder
- Just a container
- No actual code in it
- Contents moved to root

---

## What Gets Kept (Important!)

### ⚠️ .env.local
- Contains ALL your API keys
- Database credentials
- Slack webhook
- OpenAI API key
- **CRITICAL: Do not delete!**

### ⚠️ backend/node_modules
- Installed dependencies
- Can be regenerated with `npm install`
- But faster to keep

### ⚠️ database/migrations
- Schema definitions
- Already run, but needed for reference
- **Keep for documentation**

---

## Checklist

Before cleanup:
- [ ] Created backup of entire folder
- [ ] Closed all editor windows
- [ ] Stopped any running servers

During cleanup:
- [ ] Deleted Sales System folder
- [ ] Moved contents from "Original Booking Agent" to root
- [ ] Deleted empty "Original Booking Agent" folder
- [ ] Verified .env.local is in root

After cleanup:
- [ ] Tested server starts: `cd backend && npm run dev`
- [ ] Tested booking form: http://localhost:3001
- [ ] Tested admin page: http://localhost:3001/admin
- [ ] Committed changes to git (if applicable)

---

## Quick Reference Commands

**All-in-one cleanup (PowerShell):**

```powershell
# Navigate to project root
cd "C:\Users\mreug\Projects\Booking Intelligence System"

# Delete Sales System
Remove-Item -Path "Sales System" -Recurse -Force

# Move all files from "Original Booking Agent" to root
Get-ChildItem -Path "Original Booking Agent" | Move-Item -Destination .

# Delete empty "Original Booking Agent" folder
Remove-Item -Path "Original Booking Agent" -Force

# Verify structure
Get-ChildItem

# Test server
cd backend
npm run dev
```

---

Need help? The structure should match what you see when you deploy to Railway in the next step!
