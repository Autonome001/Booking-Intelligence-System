import { logger } from '../utils/logger.js';

export interface TavusVideoRequest {
    replica_id: string;
    script: string;
    background_url?: string;
    video_name?: string;
}

export interface TavusVideoResponse {
    video_id: string;
    status: 'queuing' | 'generating' | 'ready' | 'failed';
    video_url?: string;
}

/**
 * Tavus Service
 * Handles interaction with Tavus.io API for personalized video generation
 */
export class TavusService {
    private apiKey: string;
    private baseUrl = 'https://tavusapi.com/v2';

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    /**
     * Create a personalized video
     */
    async createVideo(request: TavusVideoRequest): Promise<TavusVideoResponse> {
        try {
            logger.info('Creating Tavus video replica...', { replica_id: request.replica_id });

            // @ts-ignore - fetch is global in Node 20+ but TS types may be missing
            const response = await fetch(`${this.baseUrl}/videos`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey,
                },
                body: JSON.stringify({
                    replica_id: request.replica_id,
                    script: request.script,
                    background_url: request.background_url,
                    video_name: request.video_name || 'Booking Consultation Intro',
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Tavus API error: ${JSON.stringify(errorData)}`);
            }

            const data = await response.json() as any;

            return {
                video_id: data.video_id,
                status: data.status || 'queuing',
                video_url: data.video_url,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error('Failed to create Tavus video:', errorMessage);
            throw error;
        }
    }

    /**
     * Get video status
     */
    async getVideoStatus(videoId: string): Promise<TavusVideoResponse> {
        try {
            // @ts-ignore - fetch is global in Node 20+
            const response = await fetch(`${this.baseUrl}/videos/${videoId}`, {
                method: 'GET',
                headers: {
                    'x-api-key': this.apiKey,
                },
            });

            if (!response.ok) {
                throw new Error(`Tavus API error: ${response.statusText}`);
            }

            const data = await response.json() as any;

            return {
                video_id: videoId,
                status: data.status,
                video_url: data.video_url,
            };
        } catch (error) {
            logger.error(`Failed to get Tavus video status for ${videoId}:`, error);
            throw error;
        }
    }

    /**
     * Get Q&A responses for a video
     */
    async getQAResponses(videoId: string): Promise<Record<string, string>> {
        try {
            // @ts-ignore - fetch is global in Node 20+
            const response = await fetch(`${this.baseUrl}/videos/${videoId}/responses`, {
                method: 'GET',
                headers: {
                    'x-api-key': this.apiKey,
                },
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Tavus API error: ${JSON.stringify(errorData)}`);
            }

            const data = await response.json() as any;
            return data.responses || {};
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Failed to get Tavus Q&A responses for ${videoId}:`, errorMessage);
            return {};
        }
    }

    /**
     * Get transcript for a video
     */
    async getTranscript(videoId: string): Promise<string> {
        try {
            // @ts-ignore - fetch is global in Node 20+
            const response = await fetch(`${this.baseUrl}/videos/${videoId}/transcript`, {
                method: 'GET',
                headers: {
                    'x-api-key': this.apiKey,
                },
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Tavus API error: ${JSON.stringify(errorData)}`);
            }

            const data = await response.json() as any;
            return data.transcript || '';
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Failed to get Tavus transcript for ${videoId}:`, errorMessage);
            return '';
        }
    }
}
