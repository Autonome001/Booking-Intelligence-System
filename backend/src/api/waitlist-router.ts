import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger.js';
import { serviceManager } from '../services/serviceManager.js';

const router = Router();

/**
 * Submit waitlist interest.
 * POST /api/waitlist/submit
 */
router.post('/submit', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, interest_level } = req.body ?? {};

    if (!name || !email || !interest_level) {
      res.status(400).json({
        success: false,
        error: 'name, email, and interest_level are required',
      });
      return;
    }

    const validInterests = ['curious', 'platform', 'assessment', 'reseller'];
    if (!validInterests.includes(interest_level)) {
      res.status(400).json({
        success: false,
        error: `invalid interest_level. Must be one of: ${validInterests.join(', ')}`,
      });
      return;
    }

    const supabase = await serviceManager.getService<SupabaseClient>('supabase');
    if (!supabase) {
      throw new Error('Supabase service not available');
    }

    const { data, error } = await supabase
      .from('waitlist_submissions')
      .insert([
        { 
          name, 
          email, 
          interest_level 
        }
      ])
      .select()
      .single();

    if (error) {
      logger.error('Waitlist submission error:', error.message);
      throw new Error('Failed to store waitlist submission');
    }

    logger.info(`New waitlist submission: ${email} (${interest_level})`);

    res.json({
      success: true,
      data,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Waitlist submission API failed:', errorMessage);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

export default router;
