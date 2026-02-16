# Slack Setup Guide

## Overview

Your Booking Intelligence System sends notifications to Slack when new booking requests are submitted. This guide will help you set up or fix your Slack integration.

**Setup Time:** ~10 minutes
**Requirements:** Slack workspace admin access

---

## How It Works

```
Customer submits booking form
        ↓
Backend receives request
        ↓
AI analyzes booking details
        ↓
Slack notification sent to your channel
        ↓
You see booking details in Slack
```

**Notification includes:**
- Customer name, email, company, phone
- Booking message/needs
- AI qualification score
- Urgency level
- Recommended action

---

## Step 1: Create Slack Webhook

### 1.1 Go to Slack API

1. Visit: https://api.slack.com/apps
2. Click: **"Create New App"**
3. Choose: **"From scratch"**
4. **App Name:** "Booking Intelligence System" (or "Autonome Booking Agent")
5. **Pick a workspace:** Select your workspace
6. Click: **"Create App"**

### 1.2 Enable Incoming Webhooks

1. In your app dashboard, click: **"Incoming Webhooks"** (left sidebar)
2. Toggle: **"Activate Incoming Webhooks"** → **ON**
3. Scroll down, click: **"Add New Webhook to Workspace"**
4. **Select a channel** where booking notifications will appear
   - Recommended: Create `#bookings` channel
   - OR use `#general`, `#sales`, etc.
5. Click: **"Allow"**

### 1.3 Copy Webhook URL

You'll see a webhook URL like:
```
https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX
```

**IMPORTANT:** Keep this URL secret! It's like a password.

---

## Step 2: Add Webhook to Environment Variables

### 2.1 Local Development (.env.local)

Open: `C:\Users\mreug\Projects\Booking Intelligence System\.env.local`

Add or update:
```env
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/ACTUAL/WEBHOOK_URL
```

### 2.2 Production (Railway)

1. Go to your Railway project
2. Click: **"Variables"** tab
3. Find: `SLACK_WEBHOOK_URL`
4. Update with your new webhook URL
5. Click: **"Save"**
6. Railway will automatically redeploy

---

## Step 3: Test Slack Integration

### 3.1 Restart Your Server

```powershell
# Stop current server (Ctrl+C)

# Navigate to backend
cd "C:\Users\mreug\Projects\Booking Intelligence System\Original Booking Agent\backend"

# Start server
npm run dev

# Look for:
# ✅ Slack service registered
```

### 3.2 Submit Test Booking

1. Visit: http://localhost:3001
2. Fill out booking form:
   - **Name:** Test User
   - **Email:** test@example.com
   - **Company:** Test Company
   - **Message:** "Testing Slack integration for booking system"
3. Click: **"Book Your Consultation"**

### 3.3 Check Slack Channel

You should see a notification like:

```
📅 NEW BOOKING REQUEST

Name: Test User
Email: test@example.com
Company: Test Company
Phone: N/A

Message:
Testing Slack integration for booking system

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AI Analysis:
• Qualification Score: 75/100
• Urgency: Medium
• Category: Product Demo

Booking ID: abc-123-def
Submitted: Feb 15, 2026 at 2:30 PM
```

---

## Customizing Slack Notifications

### Location of Slack Integration Code

**File:** `backend/src/services/slack/SlackService.ts`

### Current Notification Format

The notification includes:
1. **Header:** "📅 NEW BOOKING REQUEST"
2. **Customer Details:** Name, email, company, phone
3. **Message:** What they wrote
4. **AI Analysis:** Score, urgency, category (if enabled)
5. **Metadata:** Booking ID, timestamp

### Customize Notification Fields

To add/remove fields, edit `SlackService.ts`:

**Find:** `sendBookingNotification` method

**Example: Add custom field**

```typescript
// Add after existing fields
{
  type: 'section',
  text: {
    type: 'mrkdwn',
    text: `*Preferred Time:* ${bookingData.preferred_time || 'Not specified'}`
  }
}
```

---

## Advanced: Multiple Channels

### Use Case: Send different bookings to different channels

**Scenario:**
- High-priority bookings → `#sales-urgent`
- Demo requests → `#product-demos`
- General inquiries → `#general-inquiries`

### Implementation

**Create multiple webhooks:**

1. **High Priority Channel:**
   - Create `#sales-urgent` channel
   - Add webhook → Copy URL
   - Store as: `SLACK_WEBHOOK_URGENT`

2. **Demo Requests Channel:**
   - Create `#product-demos` channel
   - Add webhook → Copy URL
   - Store as: `SLACK_WEBHOOK_DEMOS`

3. **General Channel:**
   - Create `#general-inquiries` channel
   - Add webhook → Copy URL
   - Store as: `SLACK_WEBHOOK_GENERAL`

**Update .env.local:**

```env
SLACK_WEBHOOK_URL=https://hooks.slack.com/.../general
SLACK_WEBHOOK_URGENT=https://hooks.slack.com/.../urgent
SLACK_WEBHOOK_DEMOS=https://hooks.slack.com/.../demos
```

**Update SlackService.ts to route based on AI analysis:**

```typescript
async sendBookingNotification(bookingData: any, aiAnalysis?: any) {
  let webhookUrl = this.webhookUrl; // default channel

  // Route to urgent channel if high priority
  if (aiAnalysis?.urgencyLevel === 'high' || aiAnalysis?.qualificationScore > 80) {
    webhookUrl = process.env['SLACK_WEBHOOK_URGENT'] || this.webhookUrl;
  }

  // Route to demos channel if it's a demo request
  if (aiAnalysis?.category === 'Product Demo') {
    webhookUrl = process.env['SLACK_WEBHOOK_DEMOS'] || this.webhookUrl;
  }

  // Send to appropriate channel
  await this.sendMessage(webhookUrl, blocks);
}
```

---

## Troubleshooting

### Issue: "Slack service not registered" in logs

**Cause:** Webhook URL missing or invalid

**Solution:**
1. Check `.env.local` has `SLACK_WEBHOOK_URL`
2. Verify URL starts with `https://hooks.slack.com/services/`
3. No extra spaces or quotes
4. Restart server

**Verify:**

```powershell
# Check environment variable is loaded
cd backend
npm run dev

# Look for:
# ✅ Slack service registered
```

### Issue: Notification not appearing in Slack

**Diagnosis:**

```powershell
# Check server logs when submitting booking
# Look for:
# "Slack notification sent successfully" ✅
# OR
# "Failed to send Slack notification: [error]" ❌
```

**Common Causes:**

1. **Wrong channel selected:**
   - Re-create webhook with correct channel
   - Update `.env.local` and Railway

2. **Webhook revoked:**
   - Go to https://api.slack.com/apps
   - Select your app
   - Check "Incoming Webhooks" → verify webhook is listed

3. **Network/firewall blocking:**
   - Test from different network
   - Check corporate firewall settings

### Issue: Webhook URL not found

**Error:** `invalid_payload` or `channel_not_found`

**Solution:**
1. Go to https://api.slack.com/apps
2. Select your app
3. Click "Incoming Webhooks"
4. Delete old webhook
5. Click "Add New Webhook to Workspace"
6. Select channel again
7. Copy NEW webhook URL
8. Update `.env.local` and Railway

### Issue: Notifications working locally but not in production

**Cause:** Environment variable not set in Railway

**Solution:**
1. Go to Railway project
2. Click "Variables" tab
3. Verify `SLACK_WEBHOOK_URL` exists
4. Copy exact value from `.env.local`
5. Save and redeploy

**Test production webhook:**

```bash
# Test using curl
curl -X POST https://hooks.slack.com/services/YOUR/WEBHOOK/URL \
  -H 'Content-Type: application/json' \
  -d '{"text":"Test notification from Railway"}'
```

Should see "ok" response and notification in Slack ✅

---

## Testing Different Notification Scenarios

### Test 1: Basic Booking

```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "message": "Interested in automation solutions"
}
```

**Expected:** Standard notification with basic info

### Test 2: High-Priority Booking

```json
{
  "name": "Enterprise Client",
  "email": "ceo@bigcorp.com",
  "company": "Fortune 500 Company",
  "phone": "+1-555-0100",
  "message": "Need urgent automation for 500 employees. Budget: $100k+"
}
```

**Expected:** High qualification score, urgent tag

### Test 3: Demo Request

```json
{
  "name": "Product Manager",
  "email": "pm@startup.com",
  "message": "Want to see a demo of your AI booking system"
}
```

**Expected:** Categorized as "Product Demo"

---

## Notification Examples

### Standard Notification

```
📅 NEW BOOKING REQUEST

Name: Sarah Johnson
Email: sarah@techstartup.com
Company: Tech Startup Inc
Phone: +1-555-0123

Message:
Looking for automation solutions to handle customer onboarding. Currently processing 50+ new customers per week manually.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AI Analysis:
• Qualification Score: 82/100
• Urgency: High
• Customer Tier: Mid-Market
• Estimated Budget: $10k-$50k
• Key Needs: Customer onboarding automation

Booking ID: booking_abc123
Submitted: Feb 15, 2026 at 3:45 PM
```

### High-Priority Alert

```
🚨 HIGH-PRIORITY BOOKING REQUEST

Name: Alex Chen
Email: alex@enterprise.com
Company: Enterprise Solutions Corp
Phone: +1-555-9999

Message:
Our CEO wants to discuss automating our entire sales pipeline. We're currently doing $10M ARR and need to scale.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AI Analysis:
• Qualification Score: 95/100 ⭐
• Urgency: URGENT
• Customer Tier: Enterprise
• Estimated Budget: $100k+
• Key Needs: Sales pipeline automation

⚡ RECOMMENDED ACTION: Respond within 1 hour

Booking ID: booking_xyz789
Submitted: Feb 15, 2026 at 4:15 PM
```

---

## Integration Verification Checklist

Before marking Slack as complete:
- [ ] Slack app created
- [ ] Incoming webhook activated
- [ ] Webhook URL added to `.env.local`
- [ ] Webhook URL added to Railway variables
- [ ] Server shows "✅ Slack service registered"
- [ ] Test booking notification received
- [ ] Notification contains all expected fields
- [ ] Notifications working in production (Railway)
- [ ] Team members can see notifications
- [ ] Channel permissions configured correctly

---

## Additional Slack Features (Optional)

### 1. Interactive Buttons

Add action buttons to notifications:

```typescript
// Add to notification blocks
{
  type: 'actions',
  elements: [
    {
      type: 'button',
      text: { type: 'plain_text', text: 'View in Dashboard' },
      url: `https://your-admin.com/bookings/${bookingId}`,
      style: 'primary'
    },
    {
      type: 'button',
      text: { type: 'plain_text', text: 'Send Calendar Invite' },
      url: `mailto:${customerEmail}`,
    }
  ]
}
```

### 2. Thread Replies

For follow-up messages about same booking:

```typescript
// Store thread_ts from first message
const response = await axios.post(webhookUrl, { blocks });
const threadTs = response.data.thread_ts;

// Reply in thread
await axios.post(webhookUrl, {
  text: 'Calendar invite sent!',
  thread_ts: threadTs
});
```

### 3. Custom Emojis

Based on booking type:

```typescript
const emoji = {
  'Product Demo': '🎥',
  'Consultation': '💼',
  'Support': '🛠️',
  'Enterprise': '🏢'
}[bookingType] || '📅';
```

---

## Support & Resources

- **Slack API Docs:** https://api.slack.com/messaging/webhooks
- **Block Kit Builder:** https://app.slack.com/block-kit-builder (design notifications)
- **Your Slack App:** https://api.slack.com/apps
- **Test Webhooks:** Use Postman or curl

**Need help?** Check your server logs first - they show exactly what's being sent to Slack!
