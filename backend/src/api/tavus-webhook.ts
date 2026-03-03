import { Router } from 'express';
import { serviceManager } from '../services/serviceManager.js';
import { logger } from '../utils/logger.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TavusService } from '../services/TavusService.js';

const router: Router = Router();

/**
 * Tavus Webhook Handler
 * Receives events from Tavus, such as video generation completion or transcript availability.
 */
router.post('/callback', async (req, res) => {
    const event = req.body;
    const { event_type, data } = event;

    logger.info(`Received Tavus event: ${event_type}`, { video_id: data?.video_id });

    try {
        const supabase = await serviceManager.getService<SupabaseClient>('supabase');
        const tavusService = await serviceManager.getService<TavusService>('tavus');

        if (!supabase || !tavusService) {
            throw new Error('Required services for Tavus webhook not available');
        }

        const videoId = data?.video_id;
        if (!videoId) {
            return res.status(400).json({ error: 'Missing video_id' });
        }

        if (event_type === 'video.ready' || event_type === 'application.transcription_ready') {
            // Retrieve Q&A responses and transcript
            const responses = await tavusService.getQAResponses(videoId);

            // Update database
            const { error } = await supabase
                .from('booking_inquiries')
                .update({
                    tavus_video_status: 'ready',
                    tavus_video_url: data.hosted_url || data.stream_url,
                    tavus_qa_responses: responses,
                })
                .eq('tavus_video_id', videoId);

            if (error) {
                throw error;
            }

            logger.info(`Updated booking inquiry for Tavus video: ${videoId}`);
        } else if (event_type === 'video.failed') {
            await supabase
                .from('booking_inquiries')
                .update({ tavus_video_status: 'failed' })
                .eq('tavus_video_id', videoId);

            logger.warn(`Tavus video failed: ${videoId}`);
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Failed to process Tavus webhook:', errorMessage);
        return res.status(500).json({ error: errorMessage });
    }
});

export default router;
