/**
 * Calendar OAuth2 Flow Endpoints
 *
 * Allows business owner to connect up to 7 Google Calendar accounts
 * via OAuth2 authorization flow
 */

import { Router, type Request, type Response } from 'express';
import { google } from 'googleapis';
import { serviceManager } from '../services/serviceManager.js';
import { ensureCalendarAccountsTable, isCalendarAccountsMissing } from '../services/calendar/calendarAccountsSchema.js';
import { getServiceConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CalendarService } from '../services/calendar/CalendarService.js';

const router = Router();

async function refreshCalendarRuntimeState(): Promise<void> {
  await serviceManager.reinitializeService('calendar');
  const calendarService = await serviceManager.getService<CalendarService>('calendar');
  calendarService?.invalidateAvailabilityCache();
}

async function promoteHighestPriorityCalendar(
  supabase: SupabaseClient,
  userEmail: string
): Promise<void> {
  const { data: fallbackCalendar } = await supabase
    .from('calendar_accounts')
    .select('id')
    .eq('user_email', userEmail)
    .eq('is_active', true)
    .order('priority', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!fallbackCalendar?.id) {
    return;
  }

  await supabase
    .from('calendar_accounts')
    .update({ is_primary: false })
    .eq('user_email', userEmail)
    .eq('is_active', true);

  await supabase
    .from('calendar_accounts')
    .update({ is_primary: true })
    .eq('id', fallbackCalendar.id);
}

async function setPrimaryCalendarAccount(
  supabase: SupabaseClient,
  calendarId: string
): Promise<{ calendarEmail: string; userEmail: string }> {
  const { data: targetCalendar, error: targetError } = await supabase
    .from('calendar_accounts')
    .select('id, user_email, calendar_email')
    .eq('id', calendarId)
    .eq('is_active', true)
    .single();

  if (targetError || !targetCalendar) {
    throw new Error(`Calendar not found: ${targetError?.message || calendarId}`);
  }

  const { data: activeCalendars } = await supabase
    .from('calendar_accounts')
    .select('id, priority')
    .eq('user_email', targetCalendar.user_email)
    .eq('is_active', true);

  const nextPriority =
    (activeCalendars || []).reduce((max, calendar: { priority?: number }) => {
      return Math.max(max, typeof calendar.priority === 'number' ? calendar.priority : 0);
    }, 0) + 1;

  await supabase
    .from('calendar_accounts')
    .update({ is_primary: false })
    .eq('user_email', targetCalendar.user_email)
    .eq('is_active', true);

  const { error: updateError } = await supabase
    .from('calendar_accounts')
    .update({
      is_primary: true,
      priority: nextPriority,
    })
    .eq('id', calendarId);

  if (updateError) {
    throw updateError;
  }

  return {
    calendarEmail: targetCalendar.calendar_email,
    userEmail: targetCalendar.user_email,
  };
}

/**
 * Authorization Initiation Endpoint
 * GET /api/calendar/oauth/authorize?user_email=dev@autonome.us
 *
 * Redirects to Google consent screen to begin OAuth flow
 */
router.get('/authorize', (req: Request, res: Response): void => {
  const { user_email } = req.query;

  // Validate user_email parameter
  if (!user_email || typeof user_email !== 'string') {
    res.status(400).json({ error: 'user_email query parameter required' });
    return;
  }

  try {
    const config = getServiceConfig('calendar');

    const oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      config.redirectUri
    );

    // State parameter includes user email for callback
    const state = Buffer.from(JSON.stringify({ user_email })).toString('base64');

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline', // Request refresh token
      scope: config.scopes,
      state,
      prompt: 'consent', // Force consent screen to ensure refresh token
    });

    logger.info(`OAuth flow initiated for user: ${user_email}`);
    res.redirect(authUrl);
  } catch (error) {
    logger.error('OAuth authorization error:', error);
    res.status(500).json({ error: 'Failed to initiate OAuth flow' });
  }
});

/**
 * OAuth Callback Handler
 * GET /api/calendar/oauth/callback?code=...&state=...
 *
 * Receives authorization code from Google, exchanges for tokens,
 * and stores credentials in database
 */
router.get('/callback', async (req: Request, res: Response): Promise<void> => {
  const { code, state } = req.query;

  if (!code || !state) {
    res.status(400).send('Missing authorization code or state parameter');
    return;
  }

  try {
    // Decode state to get user email
    const { user_email } = JSON.parse(
      Buffer.from(state as string, 'base64').toString()
    );

    const config = getServiceConfig('calendar');

    // Exchange authorization code for tokens
    const oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      config.redirectUri
    );

    const { tokens } = await oauth2Client.getToken(code as string);
    oauth2Client.setCredentials(tokens);

    // Fetch calendar info to get calendar email
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const calendarInfo = await calendar.calendars.get({ calendarId: 'primary' });

    const calendarEmail = calendarInfo.data.id || user_email;

    // Store credentials in database
    const supabase = await serviceManager.getService<SupabaseClient>('supabase');

    if (!supabase) {
      throw new Error('Database service not available');
    }

    const tableStatus = await ensureCalendarAccountsTable(supabase);

    if (!tableStatus.ready) {
      throw new Error(tableStatus.reason || 'calendar_accounts table is unavailable');
    }

    // Check if calendar already exists
    const { data: existingCalendar } = await supabase
      .from('calendar_accounts')
      .select('id')
      .eq('calendar_email', calendarEmail)
      .eq('is_active', true)
      .single();

    if (existingCalendar) {
      logger.warn(`Calendar ${calendarEmail} already connected`);
      res.redirect(`/admin?connected=false&email=${encodeURIComponent(calendarEmail)}&reason=already_connected`);
      return;
    }

    const { data: existingPrimary } = await supabase
      .from('calendar_accounts')
      .select('id')
      .eq('user_email', user_email)
      .eq('is_active', true)
      .eq('is_primary', true)
      .maybeSingle();

    // Insert new calendar account
    const { error: insertError } = await supabase
      .from('calendar_accounts')
      .insert({
        user_email,
        calendar_email: calendarEmail,
        calendar_type: 'google',
        oauth_credentials: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expiry_date: tokens.expiry_date,
        },
        is_primary: !existingPrimary,
        priority: existingPrimary ? 1 : 100,
        is_active: true,
      });

    if (insertError) {
      throw insertError;
    }

      logger.info(`✅ Successfully connected calendar: ${calendarEmail}`);
      await refreshCalendarRuntimeState();

      // Redirect to admin page with success parameters
      res.redirect(`/admin?connected=true&email=${encodeURIComponent(calendarEmail)}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('OAuth callback error:', errorMessage);

    res.redirect(`/admin?connected=false&error=${encodeURIComponent(errorMessage)}`);
  }
});

/**
 * List Connected Calendars
 * GET /api/calendar/accounts?user_email=dev@autonome.us
 *
 * Returns list of connected calendar accounts for a user
 */
router.get('/accounts', async (req: Request, res: Response): Promise<void> => {
  const { user_email } = req.query;

  if (!user_email || typeof user_email !== 'string') {
    res.status(400).json({ error: 'user_email query parameter required' });
    return;
  }

  try {
    const supabase = await serviceManager.getService<SupabaseClient>('supabase');

    if (!supabase) {
      res.status(503).json({ error: 'Database service not available' });
      return;
    }

    const tableStatus = await ensureCalendarAccountsTable(supabase);

    if (!tableStatus.ready) {
      res.json({
        calendars: [],
        total: 0,
        max_allowed: 7,
        user_email,
        warning: 'Calendar storage is not fully configured yet',
        details: tableStatus.reason,
      });
      return;
    }

    const { data: rawCalendars, error } = await supabase
      .from('calendar_accounts')
      .select('*')
      .eq('user_email', user_email)
      .eq('is_active', true)
      .order('priority', { ascending: false });

    if (error) {
      if (isCalendarAccountsMissing(error)) {
        res.json({
          calendars: [],
          total: 0,
          max_allowed: 7,
          user_email,
          warning: 'calendar_accounts table was missing and could not be read',
        });
        return;
      }
      throw error;
    }

    const calendars = (rawCalendars || []).map((calendar: any) => ({
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

    res.json({
      calendars: calendars || [],
      total: calendars?.length || 0,
      max_allowed: 7,
      user_email,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to fetch calendar accounts:', errorMessage);
    res.status(500).json({ error: 'Failed to fetch calendar accounts' });
  }
});

/**
 * Set the designated booking calendar.
 * PUT /api/calendar/oauth/accounts/:id/primary
 */
router.put('/accounts/:id/primary', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!id) {
    res.status(400).json({ error: 'Calendar ID is required' });
    return;
  }

  try {
    const supabase = await serviceManager.getService<SupabaseClient>('supabase');

    if (!supabase) {
      res.status(503).json({ error: 'Database service not available' });
      return;
    }

    const tableStatus = await ensureCalendarAccountsTable(supabase);

    if (!tableStatus.ready) {
      res.status(503).json({
        error: 'Calendar storage is unavailable',
        details: tableStatus.reason,
      });
      return;
    }

    const result = await setPrimaryCalendarAccount(supabase, id);
    await refreshCalendarRuntimeState();

    res.json({
      success: true,
      calendar_id: id,
      calendar_email: result.calendarEmail,
      user_email: result.userEmail,
      message: `${result.calendarEmail} is now the booking destination`,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to set primary calendar:', errorMessage);
    res.status(500).json({ error: 'Failed to set booking destination calendar' });
  }
});

/**
 * Disconnect Calendar
 * DELETE /api/calendar/accounts/:id
 *
 * Soft deletes a calendar account (sets is_active = false)
 */
router.delete('/accounts/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    const supabase = await serviceManager.getService<SupabaseClient>('supabase');

    if (!supabase) {
      res.status(503).json({ error: 'Database service not available' });
      return;
    }

    const tableStatus = await ensureCalendarAccountsTable(supabase);

    if (!tableStatus.ready) {
      res.status(503).json({
        error: 'Calendar storage is unavailable',
        details: tableStatus.reason,
      });
      return;
    }

    const { data: existingCalendar } = await supabase
      .from('calendar_accounts')
      .select('user_email, calendar_email, is_primary')
      .eq('id', id)
      .maybeSingle();

    // Soft delete (set is_active = false)
    const { error } = await supabase
      .from('calendar_accounts')
      .update({ is_active: false })
      .eq('id', id);

    if (error) {
      throw error;
    }

    if (existingCalendar?.user_email && existingCalendar.is_primary) {
      await promoteHighestPriorityCalendar(supabase, existingCalendar.user_email);
    }

      logger.info(`Calendar account ${id} disconnected`);
      await refreshCalendarRuntimeState();

      res.json({
        success: true,
      message: 'Calendar disconnected successfully',
      calendar_id: id,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to disconnect calendar:', errorMessage);
    res.status(500).json({ error: 'Failed to disconnect calendar' });
  }
});

export default router;
