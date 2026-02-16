/**
 * Calendar OAuth2 Flow Endpoints
 *
 * Allows business owner to connect up to 7 Google Calendar accounts
 * via OAuth2 authorization flow
 */

import { Router, type Request, type Response } from 'express';
import { google } from 'googleapis';
import { serviceManager } from '../services/serviceManager.js';
import { getServiceConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import type { SupabaseClient } from '@supabase/supabase-js';

const router = Router();

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
        is_primary: false,
        priority: 1,
        is_active: true,
      });

    if (insertError) {
      throw insertError;
    }

    logger.info(`✅ Successfully connected calendar: ${calendarEmail}`);

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

    const { data: calendars, error } = await supabase
      .from('calendar_accounts')
      .select('id, calendar_email, is_primary, priority, is_active, created_at, webhook_channel_id, webhook_resource_id, webhook_expires_at')
      .eq('user_email', user_email)
      .eq('is_active', true)
      .order('priority', { ascending: false });

    if (error) {
      throw error;
    }

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

    // Soft delete (set is_active = false)
    const { error } = await supabase
      .from('calendar_accounts')
      .update({ is_active: false })
      .eq('id', id);

    if (error) {
      throw error;
    }

    logger.info(`Calendar account ${id} disconnected`);

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
