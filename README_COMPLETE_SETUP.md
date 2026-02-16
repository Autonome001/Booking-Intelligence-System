# Booking Intelligence System - Complete Setup Guide

## 🎉 You Asked For 4 Things - Here's Everything!

### ✅ 1. Enhanced Landing Page with Autonome Branding
**Status:** COMPLETE ✅

**What Changed:**
- Added custom Autonome robot logo (AI-themed with gradient)
- "Autonome" brand name with gradient text
- Professional tagline: "Intelligent Automation for Modern Business"
- Trust indicators (Free Consultation, 30-Min Session, Instant Response)
- Enhanced footer with branding
- More appealing visual hierarchy

**View it:** http://localhost:3001

---

### ✅ 2. Folder Cleanup Instructions
**Status:** GUIDE CREATED ✅

**What to Do:**
Read and follow: **[FOLDER_CLEANUP_GUIDE.md](./FOLDER_CLEANUP_GUIDE.md)**

**Summary:**
```powershell
# Delete Sales System folder
Remove-Item -Path "Sales System" -Recurse -Force

# Move everything from "Original Booking Agent" to root
Get-ChildItem -Path "Original Booking Agent" | Move-Item -Destination .

# Delete empty wrapper folder
Remove-Item -Path "Original Booking Agent" -Force
```

**Result:**
```
Booking Intelligence System/
├── .env.local
├── backend/
├── database/
└── documentation files
```

---

### ✅ 3. Railway Deployment (Make System Live)
**Status:** GUIDE CREATED ✅

**What to Do:**
Read and follow: **[RAILWAY_DEPLOYMENT.md](./RAILWAY_DEPLOYMENT.md)**

**Quick Steps:**
1. Push code to GitHub
2. Sign up at railway.app
3. Deploy from GitHub repo
4. Add environment variables
5. Get public URL
6. Update Google OAuth redirect URIs

**Cost:** FREE tier (500 hours/month)

**Result:** Public booking link like:
- `https://booking-autonome.up.railway.app`
- OR `https://book.autonome.us` (with custom domain)

---

### ✅ 4. Slack Setup/Fix
**Status:** GUIDE CREATED ✅

**What to Do:**
Read and follow: **[SLACK_SETUP.md](./SLACK_SETUP.md)**

**Quick Steps:**
1. Go to https://api.slack.com/apps
2. Create new app
3. Enable Incoming Webhooks
4. Add webhook to workspace
5. Copy webhook URL
6. Add to `.env.local`:
   ```env
   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
   ```
7. Restart server
8. Test with booking submission

**Result:** Slack notifications for every booking request ✅

---

## 📚 All Documentation Files

### Core Guides
| File | Purpose | Time to Complete |
|------|---------|------------------|
| [FOLDER_CLEANUP_GUIDE.md](./FOLDER_CLEANUP_GUIDE.md) | Restructure project folders safely | 10 min |
| [RAILWAY_DEPLOYMENT.md](./RAILWAY_DEPLOYMENT.md) | Deploy to production | 15-20 min |
| [SLACK_SETUP.md](./SLACK_SETUP.md) | Setup Slack notifications | 10 min |
| [WHATS_NEXT.md](./WHATS_NEXT.md) | Next steps after database migration | Reference |

### Technical Docs
| File | Purpose |
|------|---------|
| [database/migrations/MIGRATION_INSTRUCTIONS.md](./database/migrations/MIGRATION_INSTRUCTIONS.md) | Database migration guide |
| [database/migrations/MIGRATION_VERSIONS_EXPLAINED.md](./database/migrations/MIGRATION_VERSIONS_EXPLAINED.md) | Migration version comparison |

---

## 🚀 Quick Start Sequence

### If Starting Fresh Today:

**1. Folder Cleanup (10 min)**
```powershell
cd "C:\Users\mreug\Projects\Booking Intelligence System"
Remove-Item "Sales System" -Recurse -Force
Get-ChildItem "Original Booking Agent" | Move-Item -Destination .
Remove-Item "Original Booking Agent" -Force
```

**2. Slack Setup (10 min)**
- https://api.slack.com/apps → Create app → Get webhook URL
- Add to `.env.local`: `SLACK_WEBHOOK_URL=...`
- Restart server: `cd backend && npm run dev`

**3. Test Locally (5 min)**
- Visit http://localhost:3001
- Submit test booking
- Check Slack for notification ✅

**4. Deploy to Railway (15 min)**
- Push to GitHub
- Connect to Railway
- Add environment variables
- Get public URL

**5. Go Live! (2 min)**
- Share booking link
- Add to email signature
- Monitor Slack for bookings

**Total Time:** ~45 minutes from start to fully live system! 🎉

---

## 🎯 Current System Status

### ✅ What's Working Now

| Feature | Status | Notes |
|---------|--------|-------|
| Database | ✅ Complete | All 88 bookings preserved |
| Backend Server | ✅ Running | Port 3001, all services active |
| Landing Page | ✅ Enhanced | Autonome branding added |
| Admin Page | ✅ Ready | Calendar management, blackouts, working hours |
| Booking Form | ✅ Functional | Accepts submissions |
| AI Analysis | ✅ Active | Qualifies bookings |
| Blackout Periods | ✅ Working | Manual time blocks |
| Working Hours | ✅ Working | Per-day availability |
| Multi-Calendar Support | ✅ Ready | Up to 7 calendars |
| Webhooks | ✅ Ready | Real-time calendar updates |
| Cron Jobs | ✅ Active | Cleanup + renewal |

### ⏳ Pending Setup

| Task | Guide | Estimated Time |
|------|-------|----------------|
| Folder Cleanup | [FOLDER_CLEANUP_GUIDE.md](./FOLDER_CLEANUP_GUIDE.md) | 10 min |
| Google OAuth | [WHATS_NEXT.md](./WHATS_NEXT.md) | 15 min |
| Slack Integration | [SLACK_SETUP.md](./SLACK_SETUP.md) | 10 min |
| Railway Deployment | [RAILWAY_DEPLOYMENT.md](./RAILWAY_DEPLOYMENT.md) | 15 min |

---

## 📊 System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CUSTOMER                              │
│                                                          │
│   Visits: https://book.autonome.us                      │
│   Sees: Autonome branded landing page                   │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│                 BOOKING FORM                             │
│                                                          │
│  • Name, Email, Company, Phone                          │
│  • Message (what they need)                             │
│  • Optional: Calendar slot selection                     │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│                BACKEND SERVER                            │
│                (Railway + Node.js)                       │
│                                                          │
│  1. Receive submission                                  │
│  2. AI analysis (OpenAI)                                │
│  3. Check availability (7 calendars)                    │
│  4. Apply filters (blackouts + working hours)           │
│  5. Store in database (Supabase)                        │
│  6. Send notifications (Slack)                          │
└─────────────────────┬───────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
        ▼             ▼             ▼
┌─────────────┐ ┌─────────┐ ┌────────────┐
│   SLACK     │ │SUPABASE │ │ GOOGLE CAL │
│             │ │         │ │            │
│ "New        │ │ Stores  │ │ 7 Calendars│
│  Booking!"  │ │ Booking │ │ Webhooks   │
└─────────────┘ └─────────┘ └────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│                   YOU (OWNER)                            │
│                                                          │
│  • See Slack notification                               │
│  • Review booking details                               │
│  • Check your /admin dashboard                          │
│  • Respond to customer                                  │
│  • Book calendar event                                  │
└─────────────────────────────────────────────────────────┘
```

---

## 🔑 Environment Variables Reference

### Required for Production

```env
# Database (Required)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJhb...

# AI (Required)
OPENAI_API_KEY=sk-...

# Slack (Required)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...

# Google OAuth (Required for calendar connections)
GOOGLE_CLIENT_ID=123456789-abc...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_REDIRECT_URI=https://your-url.up.railway.app/api/calendar/oauth/callback

# Deployment (Required for production)
PUBLIC_URL=https://your-url.up.railway.app

# Features (Optional)
SHOW_CALENDAR_SLOTS=false

# Email (Optional)
EMAIL_PROVIDER=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password

# Tavus (Optional)
TAVUS_API_KEY=your-key
```

---

## 🎨 Branding Changes Made

### Landing Page (`public/index.html`)

**Before:**
```html
<h1>Schedule Your Consultation</h1>
<p>Premium automation solutions...</p>
```

**After:**
```html
<!-- Autonome Robot Logo SVG -->
<svg class="autonome-logo">...</svg>

<!-- Brand Name with Gradient -->
<h1 class="brand-name">Autonome</h1>

<!-- Tagline -->
<div class="brand-tagline">
  Intelligent Automation for Modern Business
</div>

<!-- Main Heading -->
<h2>Schedule Your Consultation</h2>

<!-- Trust Indicators -->
<div class="trust-indicators">
  ✓ Free Consultation
  ✓ 30-Min Session
  ✓ Instant Response
</div>
```

### Footer

**Before:**
```html
<p>Powered by Autonome.us</p>
```

**After:**
```html
<!-- Autonome Logo Icon -->
&copy; 2026 Autonome | Intelligent Business Automation

Links: Autonome.us | Privacy Policy | Admin
```

---

## 💼 Using Your Booking System

### For Email Signature

**HTML Version:**
```html
<a href="https://book.autonome.us" style="color: #2563eb; text-decoration: none; font-weight: 600;">
  📅 Schedule a consultation
</a>
```

**Plain Text:**
```
📅 Schedule a consultation: https://book.autonome.us
```

### For Website

**CTA Button:**
```html
<a href="https://book.autonome.us" class="cta-button">
  Book a Free Consultation
</a>
```

### For Social Media

**Bio Link:**
```
🤖 Autonome - AI Business Automation
📅 Book a consultation: book.autonome.us
```

---

## 📈 Monitoring Your System

### Health Checks

**Local:**
- http://localhost:3001/health
- http://localhost:3001/diagnostics

**Production:**
- https://your-url.up.railway.app/health
- https://your-url.up.railway.app/diagnostics

### Expected Responses

**Health Check:**
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

**Service Status:**
```json
{
  "supabase": { "status": "operational" },
  "openai": { "status": "operational" },
  "slack": { "status": "operational" },
  "email": { "status": "operational" },
  "calendar": { "status": "operational", "providers": 3 }
}
```

---

## 🆘 Quick Troubleshooting

### Problem: Landing page looks the same

**Solution:** Hard refresh browser (Ctrl+Shift+R)

### Problem: Slack notifications not working

**Solution:** See [SLACK_SETUP.md](./SLACK_SETUP.md) - Section "Troubleshooting"

### Problem: Can't connect Google Calendar

**Solution:** Check Google OAuth credentials in `.env.local`

### Problem: Server won't start after folder cleanup

**Solution:**
```powershell
cd backend
npm install  # Reinstall dependencies
npm run dev  # Start server
```

### Problem: Bookings not saving to database

**Solution:** Check Supabase credentials and run migrations

---

## 📞 Support Resources

| Resource | Link |
|----------|------|
| Railway Docs | https://docs.railway.app |
| Slack API Docs | https://api.slack.com |
| Google Calendar API | https://developers.google.com/calendar |
| Supabase Docs | https://supabase.com/docs |

---

## ✅ Final Checklist

### Before Going Live

- [ ] Folder cleanup complete
- [ ] Slack webhook configured and tested
- [ ] Google OAuth credentials added
- [ ] Server tested locally (all services ✅)
- [ ] Database migrations complete
- [ ] Code pushed to GitHub
- [ ] Railway project created
- [ ] Environment variables added to Railway
- [ ] Custom domain configured (optional)
- [ ] Test booking submitted successfully
- [ ] Slack notification received
- [ ] Calendar connection works
- [ ] Blackout periods functional
- [ ] Working hours configured

### After Going Live

- [ ] Bookmark your URLs:
  - Main: https://book.autonome.us
  - Admin: https://book.autonome.us/admin
- [ ] Add booking link to email signature
- [ ] Share link on website/social media
- [ ] Monitor first few bookings
- [ ] Set up uptime monitoring (optional)
- [ ] Configure backup schedule (optional)

---

## 🎉 You're Ready!

**You now have:**
1. ✅ Professional Autonome-branded booking page
2. ✅ Complete folder cleanup guide
3. ✅ Railway deployment instructions
4. ✅ Slack integration guide
5. ✅ All documentation needed to go live

**Next Steps:**
1. Follow [FOLDER_CLEANUP_GUIDE.md](./FOLDER_CLEANUP_GUIDE.md) (10 min)
2. Follow [SLACK_SETUP.md](./SLACK_SETUP.md) (10 min)
3. Follow [RAILWAY_DEPLOYMENT.md](./RAILWAY_DEPLOYMENT.md) (15 min)

**Total time to production:** ~35 minutes! 🚀

---

**Questions?** Check the specific guide for detailed instructions and troubleshooting!
