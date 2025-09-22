import { serviceManager } from './serviceManager.js';
import { logger } from '../utils/logger.js';
import { getServiceConfig } from '../utils/config.js';

/**
 * Process booking in full AI mode (OpenAI + Interactive Slack + Database + Email)
 */
async function processFullAIMode(bookingData, requestId, processEmergencyMode, generateScheduleSuggestions) {
  logger.info(`Processing booking ${requestId} in FULL AI mode`);

  // Store to database first
  const emergencyResult = await processEmergencyMode(bookingData, requestId);

  try {
    // Get services
    const openai = await serviceManager.getService('openai');
    const slack = await serviceManager.getService('slack');
    const openaiConfig = getServiceConfig('openai');

    // AI Analysis of the customer inquiry with improved error handling
    logger.info('Starting AI analysis for customer inquiry...');

    const aiAnalysis = await openai.chat.completions.create({
      model: openaiConfig.model || "gpt-4o",
      messages: [{
        role: "system",
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
- Enterprise: Large business, complex automation, >$100K budget`
      }, {
        role: "user",
        content: `Customer: ${bookingData.name}
Company: ${bookingData.company || 'Not specified'}
Email: ${bookingData.email}
Message: ${bookingData.message}`
      }],
      temperature: 0.1,
      max_tokens: 300
    });

    let analysis;
    try {
      const rawContent = aiAnalysis.choices[0].message.content.trim();
      logger.info('Raw AI response:', rawContent);

      // Clean the content - remove any markdown or extra formatting
      const cleanContent = rawContent
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .replace(/^\s*[\{\[]/, '{')
        .replace(/[\}\]]\s*$/, '}');

      analysis = JSON.parse(cleanContent);

      // Validate required fields
      if (!analysis.customer_tier || !analysis.urgency_level || !analysis.budget_estimation || !analysis.key_needs_summary) {
        throw new Error('Missing required fields in AI analysis');
      }

      logger.info('AI analysis successful:', analysis);

    } catch (error) {
      logger.error('AI analysis failed:', error.message);
      logger.error('Raw content was:', aiAnalysis.choices[0].message.content);

      // Intelligent fallback based on message content
      const message = bookingData.message.toLowerCase();
      const company = (bookingData.company || '').toLowerCase();

      // Determine tier based on keywords
      let tier = "Professional";
      if (message.includes('enterprise') || message.includes('large') || company.includes('corp') || company.includes('inc')) {
        tier = "Enterprise";
      } else if (message.includes('small') || message.includes('startup') || message.includes('freelance')) {
        tier = "Basic";
      }

      // Determine urgency based on keywords
      let urgency = "Medium";
      if (message.includes('urgent') || message.includes('asap') || message.includes('immediately')) {
        urgency = "High";
      } else if (message.includes('no rush') || message.includes('future') || message.includes('planning')) {
        urgency = "Low";
      }

      analysis = {
        customer_tier: tier,
        urgency_level: urgency,
        budget_estimation: "To be determined during consultation",
        key_needs_summary: "Business process automation and optimization"
      };

      logger.info('Using fallback analysis:', analysis);
    }

    // Check calendar availability and provide schedule suggestions
    let calendarInfo = '';
    try {
      const calendar = await serviceManager.getService('calendar');
      const needsScheduling = bookingData.message.toLowerCase().includes('calendar') ||
                             bookingData.message.toLowerCase().includes('schedule') ||
                             bookingData.message.toLowerCase().includes('meeting') ||
                             bookingData.message.toLowerCase().includes('consultation') ||
                             bookingData.message.toLowerCase().includes('call') ||
                             bookingData.message.toLowerCase().includes('time');

      if (needsScheduling) {
        logger.info('Checking calendar availability and generating schedule suggestions...');

        // Generate intelligent schedule suggestions based on urgency and customer tier
        const scheduleOptions = generateScheduleSuggestions(analysis);
        calendarInfo = `Available consultation times:\n${scheduleOptions.join('\n')}\n\nPlease reply with your preferred time or suggest alternatives that work for your schedule.`;

        // Add calendar info to Slack notification for team visibility
        logger.info(`Calendar suggestions generated for ${analysis.customer_tier} customer with ${analysis.urgency_level} urgency`);
      } else {
        // Even if not explicitly requested, offer scheduling for high-value customers
        if (analysis.customer_tier === 'Enterprise' || analysis.urgency_level === 'High') {
          const scheduleOptions = generateScheduleSuggestions(analysis);
          calendarInfo = `Priority scheduling available:\n${scheduleOptions.slice(0, 2).join('\n')}\n\nWe can schedule an immediate consultation call to address your needs.`;
        }
      }
    } catch (calendarError) {
      logger.warn('Calendar service not available:', calendarError.message);
      // Provide fallback scheduling information
      if (bookingData.message.toLowerCase().includes('urgent') || analysis.urgency_level === 'High') {
        calendarInfo = 'Priority scheduling: We can arrange a consultation call within 24 hours. Please let us know your availability.';
      }
    }

    // Generate professional email response draft using AI
    logger.info('Generating email response draft...');

    const emailDraft = await openai.chat.completions.create({
      model: openaiConfig.model || "gpt-4o",
      messages: [{
        role: "system",
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

${calendarInfo ? `Calendar note: ${calendarInfo}` : ''}`
      }, {
        role: "user",
        content: `Customer Name: ${bookingData.name}
Company: ${bookingData.company || 'Not specified'}
Email: ${bookingData.email}
Message: ${bookingData.message}

AI Analysis:
- Customer Tier: ${analysis.customer_tier}
- Urgency Level: ${analysis.urgency_level}
- Budget Estimation: ${analysis.budget_estimation}
- Key Needs: ${analysis.key_needs_summary}`
      }],
      temperature: 0.3,
      max_tokens: 500
    });

    const draftedEmail = emailDraft.choices[0].message.content.trim();
    logger.info('Email draft generated successfully');

    // Send interactive Slack message with drafted email for approval
    const slackMessage = {
      channel: getServiceConfig('slack').channelId,
      text: `📧 EMAIL DRAFT APPROVAL NEEDED - ${analysis.customer_tier} Customer`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `📧 Email Draft for ${analysis.customer_tier} Customer`
          }
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Customer:* ${bookingData.name}` },
            { type: "mrkdwn", text: `*Email:* ${bookingData.email}` },
            { type: "mrkdwn", text: `*Company:* ${bookingData.company || 'Not specified'}` },
            { type: "mrkdwn", text: `*Booking ID:* ${requestId}` }
          ]
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Original Inquiry:*\n"${bookingData.message}"`
          }
        },
        {
          type: "divider"
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*📧 DRAFTED EMAIL RESPONSE:*\n\n${draftedEmail}`
          }
        },
        {
          type: "divider"
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*AI Analysis Summary:*\n• *Tier:* ${analysis.customer_tier} | *Urgency:* ${analysis.urgency_level}\n• *Budget:* ${analysis.budget_estimation}\n• *Key Needs:* ${analysis.key_needs_summary}`
          }
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "✅ Send Email" },
              style: "primary",
              action_id: "approve_email",
              value: requestId
            },
            {
              type: "button",
              text: { type: "plain_text", text: "📝 Revise Email" },
              action_id: "revise_email",
              value: requestId
            },
            {
              type: "button",
              text: { type: "plain_text", text: "👤 Human Takeover" },
              style: "danger",
              action_id: "human_takeover",
              value: requestId
            }
          ]
        }
      ]
    };

    logger.info('Attempting to send Slack notification via webhook...');

    // Create simplified message for webhook (no interactive buttons for now)
    const webhookMessage = {
      text: `📧 *NEW BOOKING REQUEST*`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `📧 New Booking from ${bookingData.name}`
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Customer:* ${bookingData.name}\n*Email:* ${bookingData.email}\n*Company:* ${bookingData.company || 'Not specified'}\n*Booking ID:* \`${requestId}\``
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Customer Message:*\n${bookingData.message}`
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*AI Analysis:*\n• Tier: ${analysis.customer_tier}\n• Urgency: ${analysis.urgency_level}\n• Budget: ${analysis.budget_estimation}\n• Needs: ${analysis.key_needs_summary}${calendarInfo ? `\n\n📅 *Calendar:* Schedule suggestions included in email` : ''}`
          }
        },
        {
          type: "divider"
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*📧 DRAFTED EMAIL RESPONSE:*\n\n${draftedEmail}`
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Next Steps:* Go to Railway dashboard or use Slack commands to approve, revise, or request human takeover for booking \`${requestId}\``
          }
        }
      ]
    };

    // For interactive messages with buttons, always use Web API (webhooks don't support buttons)
    logger.info('Sending interactive message with buttons via Slack Web API...');
    await sendViaWebAPI();

    async function sendViaWebAPI() {
      const slackResponse = await slack.chat.postMessage(slackMessage);
      logger.info('Web API response:', slackResponse);

      if (!slackResponse.ok) {
        throw new Error(`Slack Web API error: ${slackResponse.error}`);
      }

      logger.info('Slack notification sent successfully via Web API!');
    }

    // Update database with drafted email for later retrieval
    try {
      const supabase = await serviceManager.getService('supabase'); // Fix: get supabase service properly
      if (supabase) {
        await supabase
          .from('booking_inquiries')
          .update({
            drafted_email: draftedEmail,
            ai_analysis: analysis
          })
          .eq('processing_id', requestId);

        logger.info(`Drafted email stored in database for ${requestId}`);
      } else {
        logger.warn('Supabase service not available, skipping database update');
      }
    } catch (dbError) {
      logger.error(`Failed to update database with drafted email: ${dbError.message}`);
    }

    // Update result with AI analysis and drafted email
    emergencyResult.ai_analysis = analysis;
    emergencyResult.drafted_email = draftedEmail;
    emergencyResult.slack_notification = { sent: true, interactive: true, type: 'email_draft_approval' };
    emergencyResult.processing_mode = 'full_ai';
    emergencyResult.message = 'Your booking request has been received and analyzed! Our team will respond shortly.';

    return emergencyResult;

  } catch (error) {
    logger.error('Full AI processing failed, falling back:', error);
    throw error; // Let the calling function handle the fallback
  }
}

export { processFullAIMode };