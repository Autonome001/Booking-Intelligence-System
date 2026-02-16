import OpenAI from 'openai';
import type { WebClient } from '@slack/web-api';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceManager } from './serviceManager.js';
import { logger } from '../utils/logger.js';
import { getServiceConfig } from '../utils/config.js';
import type {
  AIAnalysis,
  CustomerTier,
  UrgencyLevel,
  BookingResponse,
} from '../../../src/types/index.js';

/**
 * AI Processing Service
 * Handles customer analysis and email draft generation using OpenAI GPT-4o
 */

interface BookingData {
  name: string;
  email: string;
  company?: string;
  message: string;
  phone?: string;
}

interface EmergencyResult extends Partial<BookingResponse> {
  processing_id?: string;
}

/**
 * Analyze customer inquiry using AI
 */
async function analyzeCustomerInquiry(
  openai: OpenAI,
  bookingData: BookingData
): Promise<AIAnalysis> {
  const openaiConfig = getServiceConfig('openai');

  logger.info('Starting AI analysis for customer inquiry...');

  const aiAnalysis = await openai.chat.completions.create({
    model: openaiConfig.model || 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a business analyst. Analyze this customer inquiry and respond with ONLY a valid JSON object. No other text, explanations, or formatting.

Required JSON format:
{
  "customer_tier": "Basic|Professional|Enterprise",
  "urgency_level": "Low|Medium|High",
  "budget_estimation": "estimated budget range or 'Not specified'",
  "key_needs_summary": "brief summary of automation needs"
}

Analysis guidelines:
- Basic: Small business, minimal automation, <$10K budget
- Professional: Growing business, moderate automation, $10K-$100K budget
- Enterprise: Large business, complex automation, >$100K budget`,
      },
      {
        role: 'user',
        content: `Customer: ${bookingData.name}
Company: ${bookingData.company || 'Not specified'}
Email: ${bookingData.email}
Message: ${bookingData.message}`,
      },
    ],
    temperature: 0.1,
    max_tokens: 300,
  });

  try {
    const rawContent = aiAnalysis.choices[0]?.message?.content?.trim();
    if (!rawContent) {
      throw new Error('Empty AI response');
    }

    logger.info('Raw AI response:', rawContent);

    // Clean the content - remove any markdown or extra formatting
    const cleanContent = rawContent
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .replace(/^\s*[\{\[]/, '{')
      .replace(/[\}\]]\s*$/, '}');

    const analysis = JSON.parse(cleanContent) as AIAnalysis;

    // Validate required fields
    if (
      !analysis.customer_tier ||
      !analysis.urgency_level ||
      !analysis.budget_estimation ||
      !analysis.key_needs_summary
    ) {
      throw new Error('Missing required fields in AI analysis');
    }

    logger.info('AI analysis successful:', analysis);
    return analysis;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('AI analysis failed:', errorMessage);
    logger.error('Raw content was:', aiAnalysis.choices[0]?.message?.content);

    // Intelligent fallback based on message content
    return generateFallbackAnalysis(bookingData);
  }
}

/**
 * Generate fallback analysis when AI parsing fails
 */
function generateFallbackAnalysis(bookingData: BookingData): AIAnalysis {
  const message = bookingData.message.toLowerCase();
  const company = (bookingData.company || '').toLowerCase();

  // Determine tier based on keywords
  let tier: CustomerTier = 'Professional';
  if (
    message.includes('enterprise') ||
    message.includes('large') ||
    company.includes('corp') ||
    company.includes('inc')
  ) {
    tier = 'Enterprise';
  } else if (
    message.includes('small') ||
    message.includes('startup') ||
    message.includes('freelance')
  ) {
    tier = 'Basic';
  }

  // Determine urgency based on keywords
  let urgency: UrgencyLevel = 'Medium';
  if (
    message.includes('urgent') ||
    message.includes('asap') ||
    message.includes('immediately')
  ) {
    urgency = 'High';
  } else if (
    message.includes('no rush') ||
    message.includes('future') ||
    message.includes('planning')
  ) {
    urgency = 'Low';
  }

  const analysis: AIAnalysis = {
    customer_tier: tier,
    urgency_level: urgency,
    budget_estimation: 'To be determined during consultation',
    key_needs_summary: 'Business process automation and optimization',
  };

  logger.info('Using fallback analysis:', analysis);
  return analysis;
}

/**
 * Generate schedule suggestions using real calendar availability
 * Falls back to algorithmic suggestions if calendar service unavailable
 */
async function generateScheduleSuggestionsWithCalendar(analysis: AIAnalysis): Promise<string[]> {
  try {
    // Try to get real availability from calendar service
    const calendarService = await serviceManager.getService('calendar') as {
      getAvailableSlots: (options: {
        startDate: Date;
        endDate: Date;
        durationMinutes: number;
        maxSlots?: number;
        workingHours?: { start: string; end: string };
        bufferMinutes?: number;
      }) => Promise<Array<{ start: Date; end: Date; available: boolean }>>;
    } | null;

    if (calendarService) {
      const daysAhead = analysis.urgency_level === 'High' ? 1 : analysis.urgency_level === 'Medium' ? 3 : 7;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() + 1); // Start tomorrow
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + daysAhead + 7); // Look ahead 7 more days

      // Determine meeting duration based on customer tier
      const durationMinutes =
        analysis.customer_tier === 'Enterprise' ? 60 :
        analysis.customer_tier === 'Professional' ? 30 : 15;

      const availableSlots = await calendarService.getAvailableSlots({
        startDate,
        endDate,
        durationMinutes,
        maxSlots: 3,
        workingHours: {
          start: '09:00',
          end: '17:00',
        },
        bufferMinutes: 15,
      });

      // Format slots for email
      return availableSlots.map((slot) =>
        `${slot.start.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} at ${slot.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} EST`
      );
    }
  } catch (error) {
    logger.warn('Calendar service unavailable, using fallback suggestions:', error);
  }

  // Fallback to algorithmic suggestions if calendar unavailable
  return generateScheduleSuggestionsFallback(analysis);
}

/**
 * Fallback schedule suggestions (algorithmic) when calendar unavailable
 */
function generateScheduleSuggestionsFallback(analysis: AIAnalysis): string[] {
  const suggestions: string[] = [];
  const daysAhead = analysis.urgency_level === 'High' ? 1 : analysis.urgency_level === 'Medium' ? 3 : 7;

  const baseDate = new Date();
  for (let i = 1; i <= 3; i++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + (daysAhead * i));

    // Skip weekends
    while (date.getDay() === 0 || date.getDay() === 6) {
      date.setDate(date.getDate() + 1);
    }

    const timeSlot = i === 1 ? '10:00 AM' : i === 2 ? '2:00 PM' : '11:00 AM';
    suggestions.push(
      `${date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} at ${timeSlot} EST`
    );
  }

  return suggestions;
}

// Keep sync version for backward compatibility
function generateScheduleSuggestions(analysis: AIAnalysis): string[] {
  return generateScheduleSuggestionsFallback(analysis);
}

/**
 * Generate email draft using AI
 */
async function generateEmailDraft(
  openai: OpenAI,
  bookingData: BookingData,
  analysis: AIAnalysis,
  calendarInfo: string
): Promise<string> {
  const openaiConfig = getServiceConfig('openai');

  logger.info('Generating email response draft...');

  const emailDraft = await openai.chat.completions.create({
    model: openaiConfig.model || 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a professional business representative for Autonome.us. Generate a professional email response to this customer inquiry.

Requirements:
- Professional, warm, and consultative tone
- Acknowledge their specific needs mentioned in their inquiry
- Reference their company if provided
- Based on the tier (${analysis.customer_tier}), suggest appropriate next steps
- Include a strong call to action for consultation booking
- If calendar coordination is mentioned, include scheduling information
- Keep it concise but personalized
- Sign as "The Autonome.us Team"

For ${analysis.customer_tier} customers:
- Basic: Focus on cost-effective solutions and clear ROI
- Professional: Emphasize scalability and growth enablement
- Enterprise: Highlight strategic transformation and enterprise capabilities

${calendarInfo ? `Calendar note: ${calendarInfo}` : ''}`,
      },
      {
        role: 'user',
        content: `Customer Name: ${bookingData.name}
Company: ${bookingData.company || 'Not specified'}
Email: ${bookingData.email}
Message: ${bookingData.message}

AI Analysis:
- Customer Tier: ${analysis.customer_tier}
- Urgency Level: ${analysis.urgency_level}
- Budget Estimation: ${analysis.budget_estimation}
- Key Needs: ${analysis.key_needs_summary}`,
      },
    ],
    temperature: 0.3,
    max_tokens: 500,
  });

  const draftedEmail = emailDraft.choices[0]?.message?.content?.trim();
  if (!draftedEmail) {
    throw new Error('Empty email draft from AI');
  }

  logger.info('Email draft generated successfully');
  return draftedEmail;
}

/**
 * Send Slack approval request
 */
async function sendSlackApproval(
  slack: WebClient,
  bookingData: BookingData,
  analysis: AIAnalysis,
  draftedEmail: string,
  requestId: string
): Promise<void> {
  const slackConfig = getServiceConfig('slack');

  const slackMessage = {
    channel: slackConfig.channelId,
    text: `📧 EMAIL DRAFT APPROVAL NEEDED - ${analysis.customer_tier} Customer`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `📧 Email Draft for ${analysis.customer_tier} Customer`,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Customer:* ${bookingData.name}` },
          { type: 'mrkdwn', text: `*Email:* ${bookingData.email}` },
          { type: 'mrkdwn', text: `*Company:* ${bookingData.company || 'Not specified'}` },
          { type: 'mrkdwn', text: `*Booking ID:* ${requestId}` },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Original Inquiry:*\n"${bookingData.message}"`,
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*📧 DRAFTED EMAIL RESPONSE:*\n\n${draftedEmail}`,
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*AI Analysis Summary:*\n• *Tier:* ${analysis.customer_tier} | *Urgency:* ${analysis.urgency_level}\n• *Budget:* ${analysis.budget_estimation}\n• *Key Needs:* ${analysis.key_needs_summary}`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '✅ Send Email' },
            style: 'primary',
            action_id: 'approve_email',
            value: requestId,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '📝 Revise Email' },
            action_id: 'revise_email',
            value: requestId,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '👤 Human Takeover' },
            style: 'danger',
            action_id: 'human_takeover',
            value: requestId,
          },
        ],
      },
    ],
  };

  logger.info('Sending interactive Slack approval message...');
  await slack.chat.postMessage(slackMessage);
  logger.info('Slack notification sent successfully via Web API');
}

/**
 * Update database with AI analysis and drafted email
 */
async function updateDatabaseWithDraft(
  supabase: SupabaseClient,
  requestId: string,
  analysis: AIAnalysis,
  draftedEmail: string
): Promise<void> {
  try {
    await supabase
      .from('booking_inquiries')
      .update({
        drafted_email: draftedEmail,
        ai_analysis: analysis,
        status: 'draft_created',
      })
      .eq('processing_id', requestId);

    logger.info(`Drafted email stored in database for ${requestId}`);
  } catch (dbError) {
    const errorMessage = dbError instanceof Error ? dbError.message : 'Unknown error';
    logger.error(`Failed to update database with drafted email: ${errorMessage}`);
  }
}

/**
 * Process booking in full AI mode (OpenAI + Interactive Slack + Database + Email)
 */
export async function processFullAIMode(
  bookingData: BookingData,
  requestId: string,
  processEmergencyMode: (data: BookingData, id: string) => Promise<EmergencyResult>,
  _generateScheduleSuggestions?: typeof generateScheduleSuggestions
): Promise<BookingResponse> {
  logger.info(`Processing booking ${requestId} in FULL AI mode`);

  // Store to database first
  const emergencyResult = await processEmergencyMode(bookingData, requestId);

  try {
    // Get services
    const openai = await serviceManager.getService<OpenAI>('openai');
    const slack = await serviceManager.getService<WebClient>('slack');
    const supabase = await serviceManager.getService<SupabaseClient>('supabase');

    if (!openai || !slack) {
      throw new Error('Required services (OpenAI, Slack) not available');
    }

    // AI Analysis
    const analysis = await analyzeCustomerInquiry(openai, bookingData);

    // Generate schedule suggestions (using real calendar availability)
    let calendarInfo = '';
    const needsScheduling =
      bookingData.message.toLowerCase().includes('calendar') ||
      bookingData.message.toLowerCase().includes('schedule') ||
      bookingData.message.toLowerCase().includes('meeting') ||
      bookingData.message.toLowerCase().includes('consultation') ||
      bookingData.message.toLowerCase().includes('call') ||
      bookingData.message.toLowerCase().includes('time');

    if (needsScheduling) {
      const scheduleOptions = await generateScheduleSuggestionsWithCalendar(analysis);
      calendarInfo = `Available consultation times:\n${scheduleOptions.join('\n')}\n\nPlease reply with your preferred time or suggest alternatives that work for your schedule.`;
    } else if (analysis.customer_tier === 'Enterprise' || analysis.urgency_level === 'High') {
      const scheduleOptions = await generateScheduleSuggestionsWithCalendar(analysis);
      calendarInfo = `Priority scheduling available:\n${scheduleOptions.slice(0, 2).join('\n')}\n\nWe can schedule an immediate consultation call to address your needs.`;
    }

    // Generate email draft
    const draftedEmail = await generateEmailDraft(openai, bookingData, analysis, calendarInfo);

    // Send Slack approval request
    await sendSlackApproval(slack, bookingData, analysis, draftedEmail, requestId);

    // Update database
    if (supabase) {
      await updateDatabaseWithDraft(supabase, requestId, analysis, draftedEmail);
    }

    // Return success response
    return {
      ...emergencyResult,
      success: true,
      ai_analysis: analysis,
      drafted_email: draftedEmail,
      slack_notification: { sent: true, interactive: true, type: 'email_draft_approval' },
      processing_mode: 'FULL_AI',
      message: 'Your booking request has been received and analyzed! Our team will respond shortly.',
    };
  } catch (error) {
    logger.error('Full AI processing failed:', error);
    throw error;
  }
}

// Export helper functions for testing
export {
  analyzeCustomerInquiry,
  generateEmailDraft,
  generateScheduleSuggestions,
  generateScheduleSuggestionsWithCalendar,
};
