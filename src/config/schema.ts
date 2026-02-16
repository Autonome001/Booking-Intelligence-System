import { z } from 'zod';

/**
 * Zod Schema for Booking Intelligence System Configuration
 * Provides type-safe configuration validation with runtime checks
 */

// === IDENTITY ===
export const IdentitySchema = z.object({
  company_name: z.string().min(1),
  company_url: z.string().url(),
  support_email: z.string().email(),
  brand_color: z.string().regex(/^#[0-9A-F]{6}$/i).optional(),
  logo_url: z.string().url().optional(),
});

// === TONE OF VOICE ===
export const ToneOfVoiceSchema = z.object({
  style: z.enum(['professional_warm', 'casual_friendly', 'executive_formal']),
  personality_traits: z.array(z.string()).min(1),
  avoid_words: z.array(z.string()).optional(),
});

// === WORKING HOURS ===
const DayScheduleSchema = z.object({
  enabled: z.boolean().optional().default(true),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
}).or(z.object({
  enabled: z.literal(false),
}));

export const WorkingHoursSchema = z.object({
  monday: DayScheduleSchema,
  tuesday: DayScheduleSchema,
  wednesday: DayScheduleSchema,
  thursday: DayScheduleSchema,
  friday: DayScheduleSchema,
  saturday: DayScheduleSchema,
  sunday: DayScheduleSchema,
});

// === SCHEDULING ===
export const SchedulingSchema = z.object({
  timezone: z.string(),
  working_hours: WorkingHoursSchema,
  buffer_times: z.object({
    before_meeting: z.number().int().min(0),
    after_meeting: z.number().int().min(0),
  }),
  provisional_hold: z.object({
    enabled: z.boolean(),
    duration_minutes: z.number().int().min(5).max(60),
    auto_release_if_not_approved: z.boolean(),
  }),
  meeting_durations: z.object({
    discovery: z.number().int().min(5),
    consultation: z.number().int().min(5),
    demo: z.number().int().min(5),
    strategy: z.number().int().min(5),
    technical: z.number().int().min(5),
  }),
});

// === ROUTING RULES ===
const RoutingRuleSchema = z.object({
  name: z.string(),
  priority: z.number().int().min(0),
  conditions: z.object({
    customer_tier: z.enum(['Basic', 'Professional', 'Enterprise']).optional(),
    urgency_level: z.array(z.enum(['Low', 'Medium', 'High'])).optional(),
    qualification_score_above: z.number().int().min(0).max(100).optional(),
  }),
  actions: z.object({
    meeting_type: z.enum(['discovery', 'consultation', 'demo', 'strategy', 'technical']),
    duration: z.number().int().min(5),
    priority: z.number().int().min(1).max(5),
    require_approval: z.boolean(),
    notify_slack: z.boolean().optional(),
    calendar: z.string().optional(),
  }),
});

export const RoutingRulesSchema = z.array(RoutingRuleSchema);

// === CALENDAR ===
const CalendarProviderSchema = z.object({
  id: z.string(),
  type: z.enum(['google', 'calendly', 'outlook', 'nylas']),
  calendar_id: z.string(),
  priority: z.number().int().min(0),
  enabled: z.boolean(),
  meeting_types: z.array(z.string()),
});

export const CalendarSchema = z.object({
  providers: z.array(CalendarProviderSchema).max(7), // Up to 7 calendars
  constraints: z.object({
    max_meetings_per_day: z.number().int().min(1),
    min_advance_notice_hours: z.number().int().min(0),
    max_booking_window_days: z.number().int().min(1),
    blackout_dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  }),
  sync: z.object({
    webhook_enabled: z.boolean(),
    sync_interval_minutes: z.number().int().min(1),
    cache_ttl_minutes: z.number().int().min(1),
  }),
});

// === SLACK ===
const ConditionalRuleSchema = z.object({
  auto_approve_if: z.array(z.object({
    customer_tier: z.enum(['Basic', 'Professional', 'Enterprise']).optional(),
    priority: z.array(z.number().int().min(1).max(5)).optional(),
    qualification_score_above: z.number().int().min(0).max(100).optional(),
  })).optional(),
  require_approval_if: z.array(z.object({
    customer_tier: z.enum(['Basic', 'Professional', 'Enterprise']).optional(),
    urgency_level: z.enum(['Low', 'Medium', 'High']).optional(),
    priority: z.array(z.number().int().min(1).max(5)).optional(),
  })).optional(),
});

export const SlackSchema = z.object({
  approval_mode: z.enum(['required', 'autopilot', 'conditional']),
  conditional_rules: ConditionalRuleSchema.optional(),
  notifications: z.object({
    channel_id: z.string(),
    mention_on_enterprise: z.boolean(),
    mention_on_high_priority: z.boolean(),
    daily_summary: z.boolean(),
    daily_summary_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  }),
  interaction: z.object({
    revision_enabled: z.boolean(),
    takeover_enabled: z.boolean(),
    max_revision_rounds: z.number().int().min(1).max(10),
  }),
});

// === TAVUS ===
export const TavusSchema = z.object({
  enabled: z.boolean(),
  stage: z.enum(['required', 'optional', 'disabled']),
  trigger_conditions: z.object({
    customer_tier: z.array(z.enum(['Basic', 'Professional', 'Enterprise'])).optional(),
    meeting_duration_above: z.number().int().min(0).optional(),
  }),
  video_settings: z.object({
    replica_id: z.string(),
    background_url: z.string().url().optional(),
    default_script_template: z.string(),
  }),
  qa_questions: z.array(z.string()).optional(),
});

// === MESSAGING TEMPLATES ===
const EmailTemplateSchema = z.object({
  subject: z.string(),
  body_template: z.string(),
});

export const MessagingTemplatesSchema = z.object({
  email: z.object({
    confirmation: EmailTemplateSchema,
    reminder_24h: EmailTemplateSchema,
    reminder_1h: EmailTemplateSchema,
  }),
});

// === SYSTEM BEHAVIOR ===
export const SystemBehaviorSchema = z.object({
  conversation: z.object({
    max_turns: z.number().int().min(1).max(20),
    timeout_minutes: z.number().int().min(5),
    require_all_fields: z.boolean(),
    allow_skip_fields: z.array(z.string()),
  }),
  ai: z.object({
    model: z.string(),
    temperature: z.number().min(0).max(2),
    max_tokens: z.number().int().min(100),
    customer_analysis_enabled: z.boolean(),
  }),
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']),
    structured: z.boolean(),
    log_to_database: z.boolean(),
  }),
  error_handling: z.object({
    retry_attempts: z.number().int().min(0),
    fallback_to_human: z.boolean(),
    graceful_degradation: z.boolean(),
  }),
});

// === ROOT CONFIG SCHEMA ===
export const ConfigSchema = z.object({
  identity: IdentitySchema,
  tone_of_voice: ToneOfVoiceSchema,
  scheduling: SchedulingSchema,
  routing_rules: RoutingRulesSchema,
  calendar: CalendarSchema,
  slack: SlackSchema,
  tavus: TavusSchema,
  messaging_templates: MessagingTemplatesSchema,
  system_behavior: SystemBehaviorSchema,
});

// Export the inferred TypeScript type
export type Config = z.infer<typeof ConfigSchema>;
export type Identity = z.infer<typeof IdentitySchema>;
export type ToneOfVoice = z.infer<typeof ToneOfVoiceSchema>;
export type Scheduling = z.infer<typeof SchedulingSchema>;
export type RoutingRule = z.infer<typeof RoutingRuleSchema>;
export type Calendar = z.infer<typeof CalendarSchema>;
export type Slack = z.infer<typeof SlackSchema>;
export type Tavus = z.infer<typeof TavusSchema>;
export type MessagingTemplates = z.infer<typeof MessagingTemplatesSchema>;
export type SystemBehavior = z.infer<typeof SystemBehaviorSchema>;
