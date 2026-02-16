import { Router, Request, Response } from 'express';
import { serviceManager } from '../services/serviceManager.js';
import { logger } from '../utils/logger.js';
import type { SupabaseClient } from '@supabase/supabase-js';

const router = Router();

// ═══════════════════════════════════════════════════════════════════════
// BLACKOUT PERIODS ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Get all blackout periods for a user
 * GET /api/calendar/blackouts?user_email=dev@autonome.us
 */
router.get('/blackouts', async (req: Request, res: Response): Promise<void> => {
  try {
    const { user_email } = req.query;

    if (!user_email || typeof user_email !== 'string') {
      res.status(400).json({ error: 'user_email query parameter required' });
      return;
    }

    const supabase = await serviceManager.getService<SupabaseClient>('supabase');

    if (!supabase) {
      res.status(503).json({ error: 'Database service not available' });
      return;
    }

    const { data, error } = await supabase
      .from('blackout_periods')
      .select('*')
      .eq('user_email', user_email)
      .eq('is_active', true)
      .order('start_time', { ascending: true });

    if (error) {
      logger.error('Failed to fetch blackout periods:', error);
      res.status(500).json({ error: 'Failed to fetch blackout periods' });
      return;
    }

    res.json({
      blackouts: data || [],
      total: data?.length || 0,
    });
  } catch (error) {
    logger.error('Blackout periods fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Create a new blackout period
 * POST /api/calendar/blackouts
 * Body: { user_email, title, description?, start_time, end_time, is_recurring?, recurrence_pattern? }
 */
router.post('/blackouts', async (req: Request, res: Response): Promise<void> => {
  try {
    const { user_email, title, description, start_time, end_time, is_recurring, recurrence_pattern } = req.body;

    // Validation
    if (!user_email || !title || !start_time || !end_time) {
      res.status(400).json({
        error: 'Missing required fields',
        required: ['user_email', 'title', 'start_time', 'end_time'],
      });
      return;
    }

    // Validate time range
    const startDate = new Date(start_time);
    const endDate = new Date(end_time);

    if (endDate <= startDate) {
      res.status(400).json({ error: 'end_time must be after start_time' });
      return;
    }

    const supabase = await serviceManager.getService<SupabaseClient>('supabase');

    if (!supabase) {
      res.status(503).json({ error: 'Database service not available' });
      return;
    }

    const { data, error } = await supabase
      .from('blackout_periods')
      .insert({
        user_email,
        title,
        description: description || null,
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
        is_recurring: is_recurring || false,
        recurrence_pattern: recurrence_pattern || {},
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create blackout period:', error);
      res.status(500).json({ error: 'Failed to create blackout period' });
      return;
    }

    logger.info('Blackout period created:', { id: data.id, title, user_email });

    res.status(201).json({
      success: true,
      blackout: data,
    });
  } catch (error) {
    logger.error('Blackout period creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Delete a blackout period (soft delete)
 * DELETE /api/calendar/blackouts/:id
 */
router.delete('/blackouts/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({ error: 'Blackout ID required' });
      return;
    }

    const supabase = await serviceManager.getService<SupabaseClient>('supabase');

    if (!supabase) {
      res.status(503).json({ error: 'Database service not available' });
      return;
    }

    // Soft delete - set is_active to false
    const { error } = await supabase
      .from('blackout_periods')
      .update({ is_active: false })
      .eq('id', id);

    if (error) {
      logger.error('Failed to delete blackout period:', error);
      res.status(500).json({ error: 'Failed to delete blackout period' });
      return;
    }

    logger.info('Blackout period deleted:', { id });

    res.json({
      success: true,
      message: 'Blackout period deleted successfully',
    });
  } catch (error) {
    logger.error('Blackout period deletion error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// WORKING HOURS ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Get working hours for a user
 * GET /api/calendar/working-hours?user_email=dev@autonome.us
 */
router.get('/working-hours', async (req: Request, res: Response): Promise<void> => {
  try {
    const { user_email } = req.query;

    if (!user_email || typeof user_email !== 'string') {
      res.status(400).json({ error: 'user_email query parameter required' });
      return;
    }

    const supabase = await serviceManager.getService<SupabaseClient>('supabase');

    if (!supabase) {
      res.status(503).json({ error: 'Database service not available' });
      return;
    }

    const { data, error } = await supabase
      .from('working_hours')
      .select('*')
      .eq('user_email', user_email)
      .eq('is_active', true)
      .order('day_of_week', { ascending: true });

    if (error) {
      logger.error('Failed to fetch working hours:', error);
      res.status(500).json({ error: 'Failed to fetch working hours' });
      return;
    }

    res.json({
      working_hours: data || [],
      total: data?.length || 0,
    });
  } catch (error) {
    logger.error('Working hours fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Update working hours for a specific day
 * PUT /api/calendar/working-hours
 * Body: { user_email, day_of_week, start_time, end_time, timezone, is_active }
 */
router.put('/working-hours', async (req: Request, res: Response): Promise<void> => {
  try {
    const { user_email, day_of_week, start_time, end_time, timezone, is_active } = req.body;

    // Validation
    if (user_email === undefined || day_of_week === undefined || !start_time || !end_time) {
      res.status(400).json({
        error: 'Missing required fields',
        required: ['user_email', 'day_of_week', 'start_time', 'end_time'],
      });
      return;
    }

    // Validate day_of_week (0-6)
    if (day_of_week < 0 || day_of_week > 6) {
      res.status(400).json({ error: 'day_of_week must be between 0 (Sunday) and 6 (Saturday)' });
      return;
    }

    const supabase = await serviceManager.getService<SupabaseClient>('supabase');

    if (!supabase) {
      res.status(503).json({ error: 'Database service not available' });
      return;
    }

    // Upsert working hours
    const { data, error } = await supabase
      .from('working_hours')
      .upsert(
        {
          user_email,
          day_of_week,
          start_time,
          end_time,
          timezone: timezone || 'America/New_York',
          is_active: is_active !== undefined ? is_active : true,
        },
        {
          onConflict: 'user_email,day_of_week',
        }
      )
      .select()
      .single();

    if (error) {
      logger.error('Failed to update working hours:', error);
      res.status(500).json({ error: 'Failed to update working hours' });
      return;
    }

    logger.info('Working hours updated:', { user_email, day_of_week });

    res.json({
      success: true,
      working_hours: data,
    });
  } catch (error) {
    logger.error('Working hours update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Batch update working hours (update all days at once)
 * PUT /api/calendar/working-hours/batch
 * Body: { user_email, hours: [{ day_of_week, start_time, end_time, is_active }] }
 */
router.put('/working-hours/batch', async (req: Request, res: Response): Promise<void> => {
  try {
    const { user_email, hours, timezone } = req.body;

    if (!user_email || !Array.isArray(hours)) {
      res.status(400).json({
        error: 'Missing required fields',
        required: ['user_email', 'hours (array)'],
      });
      return;
    }

    const supabase = await serviceManager.getService<SupabaseClient>('supabase');

    if (!supabase) {
      res.status(503).json({ error: 'Database service not available' });
      return;
    }

    // Prepare upsert data
    const upsertData = hours.map((h) => ({
      user_email,
      day_of_week: h.day_of_week,
      start_time: h.start_time,
      end_time: h.end_time,
      timezone: timezone || h.timezone || 'America/New_York',
      is_active: h.is_active !== undefined ? h.is_active : true,
    }));

    const { data, error } = await supabase
      .from('working_hours')
      .upsert(upsertData, {
        onConflict: 'user_email,day_of_week',
      })
      .select();

    if (error) {
      logger.error('Failed to batch update working hours:', error);
      res.status(500).json({ error: 'Failed to batch update working hours' });
      return;
    }

    logger.info('Working hours batch updated:', { user_email, count: data.length });

    res.json({
      success: true,
      working_hours: data,
      updated_count: data.length,
    });
  } catch (error) {
    logger.error('Working hours batch update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
