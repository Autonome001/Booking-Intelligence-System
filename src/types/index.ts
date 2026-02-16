/**
 * Booking Intelligence System - Core Type Definitions
 * Centralized type definitions for the entire system
 */

// === BOOKING INQUIRY TYPES ===

export type BookingStatus =
  | 'pending'
  | 'processing'
  | 'draft_created'
  | 'approved'
  | 'revised'
  | 'human_takeover'
  | 'sent'
  | 'failed'
  | 'email_approved'
  | 'email_revision_requested'
  | 'human_takeover_requested';

export type CustomerTier = 'Basic' | 'Professional' | 'Enterprise';
export type UrgencyLevel = 'Low' | 'Medium' | 'High';
export type MeetingType = 'discovery' | 'consultation' | 'demo' | 'strategy' | 'technical';
export type Sentiment = 'positive' | 'neutral' | 'negative';

export interface AIAnalysis {
  customer_tier: CustomerTier;
  urgency_level: UrgencyLevel;
  budget_estimation: string;
  key_needs_summary: string;
  company_size?: string;
  industry?: string;
}

export interface BookingInquiry {
  id: string;
  form_submission_id?: string;
  email_from: string;
  email_subject?: string;
  email_body: string;
  customer_name: string;
  company_name?: string;
  phone_number?: string;
  preferred_date?: Date;
  inquiry_type?: string;
  created_at: Date;
  updated_at: Date;
  status: BookingStatus;
  draft_response?: string;
  final_response?: string;
  slack_message_ts?: string;
  slack_thread_ts?: string;
  approval_history?: ApprovalHistoryEntry[];
  metadata?: Record<string, unknown>;
  priority?: number;
  assigned_to?: string;

  // Enhanced fields
  ai_analysis?: AIAnalysis;
  qualification_score?: number;
  sentiment?: Sentiment;
  meeting_type?: MeetingType;
  meeting_duration?: number;
  priority_level?: number;
  assigned_calendar_email?: string;
  provisional_hold_id?: string;
  provisional_hold_expires_at?: Date;
  tavus_video_id?: string;
  tavus_video_status?: 'queuing' | 'generating' | 'ready' | 'failed';
  tavus_video_url?: string;
  tavus_qa_responses?: Record<string, string>;
  email_thread_id?: string;
  conversation_turns?: number;
  conversation_stage?: ConversationStage;
  processing_id?: string;
}

export interface ApprovalHistoryEntry {
  action: 'approved' | 'revised' | 'human_takeover' | 'cancelled' | 'escalated';
  actor_slack_id?: string;
  actor_name?: string;
  feedback?: string;
  timestamp: string;
}

// === CALENDAR TYPES ===

export type CalendarType = 'google' | 'calendly' | 'outlook' | 'nylas';

export interface CalendarAccount {
  id: string;
  user_email: string;
  calendar_email: string;
  calendar_type: CalendarType;
  oauth_credentials?: EncryptedCredentials;
  is_primary: boolean;
  priority: number;
  is_active: boolean;
  constraints?: CalendarConstraints;
  last_sync_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface EncryptedCredentials {
  refresh_token: string;
  access_token?: string;
  expiry_date?: number;
  scope?: string;
}

export interface CalendarConstraints {
  working_hours?: WorkingHours;
  buffer_before?: number;
  buffer_after?: number;
  max_meetings_per_day?: number;
}

export interface WorkingHours {
  monday?: DaySchedule;
  tuesday?: DaySchedule;
  wednesday?: DaySchedule;
  thursday?: DaySchedule;
  friday?: DaySchedule;
  saturday?: DaySchedule;
  sunday?: DaySchedule;
}

export interface DaySchedule {
  enabled: boolean;
  start?: string;
  end?: string;
}

export interface TimeSlot {
  start: Date;
  end: Date;
  available: boolean;
  calendar_emails?: string[];
  conflicts?: string[];
}

export interface CalendarEvent {
  id: string;
  calendar_email: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string;
  attendees?: string[];
  meeting_link?: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
}

// === PROVISIONAL HOLDS ===

export type ProvisionalHoldStatus = 'active' | 'confirmed' | 'expired' | 'released';

export interface ProvisionalHold {
  id: string;
  booking_inquiry_id: string;
  calendar_account_id: string;
  calendar_email: string;
  slot_start: Date;
  slot_end: Date;
  expires_at: Date;
  status: ProvisionalHoldStatus;
  created_at: Date;
  released_at?: Date;
  confirmed_event_id?: string;
  metadata?: Record<string, unknown>;
}

// === ROUTING RULES ===

export interface RoutingRule {
  id: string;
  rule_name: string;
  priority: number;
  conditions: RoutingConditions;
  actions: RoutingActions;
  is_active: boolean;
  is_from_yaml: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface RoutingConditions {
  customer_tier?: CustomerTier;
  urgency_level?: UrgencyLevel[];
  qualification_score_above?: number;
  meeting_duration_above?: number;
  company_size?: string[];
  industry?: string[];
}

export interface RoutingActions {
  meeting_type: MeetingType;
  duration: number;
  priority: number;
  require_approval: boolean;
  notify_slack?: boolean;
  calendar?: string;
}

// === EMAIL CONVERSATION ===

export type ConversationStage =
  | 'initial'
  | 'gathering_info'
  | 'proposing_slots'
  | 'confirming'
  | 'completed'
  | 'abandoned';

export type MessageDirection = 'inbound' | 'outbound';

export interface EmailConversation {
  id: string;
  booking_inquiry_id: string;
  thread_id: string;
  conversation_stage: ConversationStage;
  turns_count: number;
  messages: ConversationMessage[];
  context: ConversationContext;
  last_inbound_at?: Date;
  last_outbound_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface ConversationMessage {
  direction: MessageDirection;
  content: string;
  timestamp: Date;
  metadata?: {
    from?: string;
    to?: string;
    subject?: string;
    message_id?: string;
  };
}

export interface ConversationContext {
  preferred_dates?: string[];
  preferred_times?: string[];
  answered_questions?: Record<string, string>;
  extracted_info?: Record<string, unknown>;
  sentiment?: Sentiment;
  intent?: string;
}

// === SERVICE TYPES ===

export interface ServiceHealth {
  service: string;
  healthy: boolean;
  lastCheck: Date;
  error?: string;
}

export interface ServiceConfig {
  [key: string]: unknown;
}

export type ProcessingMode = 'FULL_AI' | 'BASIC_AI' | 'FALLBACK' | 'EMERGENCY';

// === SLACK TYPES ===

export interface SlackUser {
  id: string;
  name: string;
  email?: string;
}

export interface SlackMessageBlock {
  type: string;
  text?: {
    type: string;
    text: string;
  };
  fields?: Array<{
    type: string;
    text: string;
  }>;
  elements?: unknown[];
}

export interface SlackInteractionPayload {
  type: string;
  user: SlackUser;
  channel: {
    id: string;
    name: string;
  };
  message?: {
    ts: string;
    text: string;
  };
  message_ts?: string;
  actions?: Array<{
    action_id: string;
    value: string;
    type: string;
  }>;
}

// === API RESPONSE TYPES ===

export interface APIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  processing_mode?: ProcessingMode;
}

export interface BookingResponse extends APIResponse<BookingInquiry> {
  ai_analysis?: AIAnalysis;
  drafted_email?: string;
  slack_notification?: {
    sent: boolean;
    interactive: boolean;
    type: string;
  };
}

// === UTILITY TYPES ===

export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type RequiredKeys<T, K extends keyof T> = T & Required<Pick<T, K>>;

// === ERROR TYPES ===

export class BookingSystemError extends Error {
  constructor(
    message: string,
    public code?: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'BookingSystemError';
  }
}

export class ValidationError extends BookingSystemError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class ServiceUnavailableError extends BookingSystemError {
  constructor(service: string, details?: Record<string, unknown>) {
    super(`Service unavailable: ${service}`, 'SERVICE_UNAVAILABLE', details);
    this.name = 'ServiceUnavailableError';
  }
}

export class CalendarConflictError extends BookingSystemError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CALENDAR_CONFLICT', details);
    this.name = 'CalendarConflictError';
  }
}
