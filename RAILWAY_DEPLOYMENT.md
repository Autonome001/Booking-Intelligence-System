# Railway Deployment Guide

## Overview

Railway is a modern platform-as-a-service (PaaS) that makes deploying your booking system simple. Your server is already configured for Railway compatibility.

**Deployment Time:** ~15 minutes
**Cost:** Free tier available (500 hours/month)
**Result:** Public URL like `https://booking-system-production.up.railway.app`

---

## Prerequisites

Before deploying:
- [ ] Folder cleanup complete (see [FOLDER_CLEANUP_GUIDE.md](./FOLDER_CLEANUP_GUIDE.md))
- [ ] Server working locally (`npm run dev` successful)
- [ ] Git repository initialized
- [ ] GitHub account (for connecting repo to Railway)

---

## Step 1: Prepare for Deployment

### 1.1 Initialize Git Repository (if not done)

```powershell
# Navigate to project root
cd "C:\Users\mreug\Projects\Booking Intelligence System"

# Initialize git
git init

# Add all files
git add .

# First commit
git commit -m "Initial commit: Booking Intelligence System"
```

### 1.2 Create .gitignore

Create `.gitignore` in project root:

```
# Dependencies
node_modules/
npm-debug.log*

# Environment variables (CRITICAL - never commit!)
.env
.env.local
.env.production

# Build outputs
dist/
build/
*.tsbuildinfo

# OS files
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo

# Logs
logs/
*.log

# Database
*.db
*.sqlite

# Temporary files
tmp/
temp/
```

**Commit .gitignore:**

```powershell
git add .gitignore
git commit -m "Add .gitignore"
```

### 1.3 Push to GitHub

```powershell
# Create new repo on GitHub first, then:
git remote add origin https://github.com/your-username/booking-intelligence-system.git
git branch -M main
git push -u origin main
```

---

## Step 2: Sign Up for Railway

1. Visit: https://railway.app
2. Click: **"Start a New Project"** or **"Login"**
3. **Sign up with GitHub** (recommended for easy deployment)
4. Authorize Railway to access your repositories

---

## Step 3: Create New Project

### 3.1 Deploy from GitHub Repo

1. Click: **"New Project"**
2. Select: **"Deploy from GitHub repo"**
3. Choose repository: **booking-intelligence-system**
4. Railway will detect it's a Node.js project ✅

### 3.2 Configure Build Settings

Railway usually auto-detects, but verify:

- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm start`
- **Root Directory:** `/backend` (if you didn't flatten structure yet)

**OR after folder cleanup:**
- **Root Directory:** `/backend`
- Build/Start commands remain the same

---

## Step 4: Add Environment Variables

**CRITICAL:** Your app needs these to work

### 4.1 Open Variables Settings

1. Click your deployed service
2. Click **"Variables"** tab
3. Click **"+ New Variable"**

### 4.2 Add All Variables from .env.local

Copy these from your `.env.local`:

```env
# Database (Required)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here

# OpenAI (Required)
OPENAI_API_KEY=sk-...

# Slack (Required)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...

# Google Calendar OAuth (Required)
GOOGLE_CLIENT_ID=123456789-abc...xyz.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-abc...xyz
GOOGLE_REDIRECT_URI=https://YOUR-RAILWAY-URL.up.railway.app/api/calendar/oauth/callback

# Email (Optional - if using email service)
EMAIL_PROVIDER=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password

# Public URL (IMPORTANT!)
PUBLIC_URL=https://YOUR-RAILWAY-URL.up.railway.app

# Feature Flags
SHOW_CALENDAR_SLOTS=false

# Tavus (Optional)
TAVUS_API_KEY=your-tavus-key-if-you-have-one
```

**⚠️ IMPORTANT:**
- Don't include `GOOGLE_REDIRECT_URI` yet - you'll update it after getting your Railway URL
- Don't include `PUBLIC_URL` yet - you'll add it after deployment

### 4.3 Save and Deploy

After adding variables:
- Railway automatically redeploys
- Wait ~2-3 minutes for build

---

## Step 5: Get Your Public URL

### 5.1 Find Your Railway Domain

1. Go to **"Settings"** tab
2. Scroll to **"Networking"**
3. Click **"Generate Domain"**
4. Railway gives you: `https://your-project-name.up.railway.app`

**Example URLs:**
- `https://booking-system-production.up.railway.app`
- `https://autonome-booking.up.railway.app`

### 5.2 Update Environment Variables

Go back to **"Variables"** tab and update:

```env
# Add/Update these
PUBLIC_URL=https://your-actual-railway-url.up.railway.app
GOOGLE_REDIRECT_URI=https://your-actual-railway-url.up.railway.app/api/calendar/oauth/callback
```

Click **"Save"** - Railway will redeploy automatically

---

## Step 6: Update Google Cloud Console

Your OAuth won't work until you add the production redirect URI

### 6.1 Go to Google Cloud Console

1. Visit: https://console.cloud.google.com
2. Select your project
3. Go to: **APIs & Services → Credentials**
4. Click your OAuth 2.0 Client ID

### 6.2 Add Production Redirect URI

Under **"Authorized redirect URIs"**, add:

```
https://your-actual-railway-url.up.railway.app/api/calendar/oauth/callback
```

**You should have BOTH:**
- `http://localhost:3001/api/calendar/oauth/callback` (for local dev)
- `https://your-railway-url.up.railway.app/api/calendar/oauth/callback` (for production)

Click **"Save"**

---

## Step 7: Test Your Live Site

### 7.1 Visit Your URLs

**Booking Form:**
```
https://your-railway-url.up.railway.app
```

**Admin Page:**
```
https://your-railway-url.up.railway.app/admin
```

**Health Check:**
```
https://your-railway-url.up.railway.app/health
```

### 7.2 Test End-to-End Flow

1. **Submit a test booking:**
   - Visit booking form
   - Fill out form
   - Submit
   - Check Slack for notification ✅

2. **Connect a calendar:**
   - Visit admin page
   - Click "Connect Google Calendar"
   - Authorize
   - Verify connection shows as "Active" ✅

3. **Test blackout periods:**
   - Add a blackout period
   - Verify it appears in list ✅

---

## Step 8: Custom Domain (Optional)

### 8.1 Buy a Domain

Recommended registrars:
- Namecheap
- Google Domains
- Cloudflare

**Example:** `book.autonome.us`

### 8.2 Configure DNS

In your domain registrar, add a CNAME record:

```
Type: CNAME
Name: book (or @ for root domain)
Value: your-project-name.up.railway.app
TTL: Auto or 3600
```

### 8.3 Add Custom Domain in Railway

1. Go to **"Settings"** → **"Networking"**
2. Click **"Custom Domain"**
3. Enter: `book.autonome.us`
4. Railway will provide SSL certificate automatically ✅

### 8.4 Update Environment Variables Again

```env
PUBLIC_URL=https://book.autonome.us
GOOGLE_REDIRECT_URI=https://book.autonome.us/api/calendar/oauth/callback
```

### 8.5 Update Google Cloud Console Again

Add the custom domain redirect URI:

```
https://book.autonome.us/api/calendar/oauth/callback
```

---

## Troubleshooting

### Issue: Build Fails with "Cannot find module 'typescript'"

**Solution:** Ensure `typescript` and `tsx` are in `dependencies`, not `devDependencies`

```json
// backend/package.json
{
  "dependencies": {
    "typescript": "^5.3.3",
    "tsx": "^4.7.0",
    // ... other deps
  }
}
```

Then commit and push:

```powershell
git add backend/package.json
git commit -m "Move typescript to dependencies for Railway"
git push
```

### Issue: Server starts but routes 404

**Cause:** Root directory misconfigured

**Solution:**
- Set **"Root Directory"** to `/backend` in Railway settings
- OR move all files to project root after folder cleanup

### Issue: Environment variables not working

**Verification:**

1. Go to Railway **"Variables"** tab
2. Click **"..." → "View Raw"**
3. Verify all variables are there
4. Redeploy: **"Deployments"** → **"..."** → **"Redeploy"**

### Issue: OAuth redirect error

**Error:** `redirect_uri_mismatch`

**Solution:**
1. Copy exact URL from Railway
2. Add to Google Cloud Console authorized redirect URIs
3. URL must match EXACTLY (no trailing slash)

### Issue: Database connection fails

**Check Supabase settings:**
1. Go to Supabase project settings
2. Verify connection pooling is enabled
3. Try using **"Connection Pooling"** URL instead of direct URL

**Update in Railway variables:**
```env
SUPABASE_URL=https://your-project.supabase.co
```

Should use pooler URL if having connection issues:
```env
SUPABASE_URL=https://your-project.pooler.supabase.com
```

---

## Monitoring & Logs

### View Logs

1. Go to your Railway project
2. Click **"Deployments"**
3. Click latest deployment
4. View **real-time logs**

**Look for:**
```
✅ All services initialized successfully
🚀 Server running on port 3001
```

### Monitor Health

Visit regularly:
```
https://your-railway-url.up.railway.app/health
```

Should return:
```json
{
  "status": "healthy",
  "timestamp": "2026-02-15T...",
  "services": {
    "supabase": true,
    "openai": true,
    "slack": true,
    "email": true,
    "calendar": true
  }
}
```

---

## Cost Optimization

### Railway Free Tier

- **500 execution hours/month**
- **100 GB bandwidth/month**
- **1 GB RAM**
- **1 vCPU**

**Sufficient for:**
- ~100-200 bookings/month
- Small business use
- Testing/MVP

### Upgrade When Needed

If you exceed free tier:
- **Starter Plan:** $5/month
- **Pay as you go:** ~$0.000231/GB-second

**Monitor usage:**
- Railway Dashboard → **"Usage"** tab

---

## Security Best Practices

### 1. Never Commit .env Files

Already in `.gitignore` ✅

### 2. Rotate API Keys Periodically

Update in Railway variables:
- OpenAI API key
- Supabase anon key
- Slack webhook

### 3. Enable Railway Two-Factor Auth

Railway Settings → Security → Enable 2FA

### 4. Monitor Failed Requests

Check logs for:
- `401 Unauthorized` (bad API keys)
- `500 Internal Server Error` (bugs)
- Repeated failed login attempts

---

## Deployment Checklist

Before going live:
- [ ] Folder structure cleaned up
- [ ] Git repository initialized and pushed to GitHub
- [ ] `.gitignore` includes `.env.local`
- [ ] Railway project created
- [ ] All environment variables added
- [ ] Google OAuth redirect URI updated
- [ ] Custom domain configured (optional)
- [ ] Health check passes: `/health`
- [ ] Test booking submitted successfully
- [ ] Slack notification received
- [ ] Calendar connection works
- [ ] SSL certificate active (HTTPS)

After going live:
- [ ] Add booking link to email signature
- [ ] Share link with team/clients
- [ ] Monitor logs for first 24 hours
- [ ] Test from different devices/browsers
- [ ] Set up uptime monitoring (optional: UptimeRobot)

---

## Next Steps After Deployment

1. **Update email signature:**
   ```
   📅 Schedule a consultation: https://book.autonome.us
   ```

2. **Share on social media/website**

3. **Monitor your first bookings:**
   - Check Slack notifications
   - Review database for entries
   - Test calendar integration

4. **Optional enhancements:**
   - Custom email templates
   - SMS notifications (Twilio)
   - Analytics tracking (Google Analytics)

---

## Support Resources

- **Railway Docs:** https://docs.railway.app
- **Railway Discord:** https://discord.gg/railway
- **Your project health:** `https://your-url.up.railway.app/diagnostics`

**Need help?** Check your deployment logs first - they usually show the exact error!
