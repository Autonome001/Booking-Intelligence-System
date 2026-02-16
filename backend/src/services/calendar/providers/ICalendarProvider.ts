/**
 * Calendar Provider Interface
 *
 * Defines the contract for calendar integrations (Google, Outlook, Calendly, etc.)
 * Supports multi-calendar orchestration with up to 7 calendar accounts
 */

export interface TimeSlot {
  start: Date;
  end: Date;
  available: boolean;
}

export interface AvailabilityOptions {
  startDate: Date;
  endDate: Date;
  durationMinutes: number;
  workingHours?: {
    start: string; // "09:00"
    end: string;   // "17:00"
  };
  bufferMinutes?: number;
  slotIntervalMinutes?: number;
  timezone?: string;
}

export interface ProvisionalHold {
  id: string;
  calendarEventId: string;
  slotStart: Date;
  slotEnd: Date;
  expiresAt: Date;
  metadata?: Record<string, unknown>;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  attendees?: string[];
  location?: string;
  meetingLink?: string;
}

export interface WebhookSubscription {
  id: string;
  channelId: string;
  resourceId: string;
  expiresAt: Date;
}

export interface CalendarCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes?: string[];
}

/**
 * Abstract Calendar Provider Interface
 * Implement this interface for each calendar type (Google, Outlook, Calendly, etc.)
 */
export interface ICalendarProvider {
  /**
   * Provider identification
   */
  readonly providerId: string;
  readonly providerType: 'google' | 'outlook' | 'calendly' | 'nylas';
  readonly calendarEmail: string;

  /**
   * Initialize provider with credentials
   */
  initialize(credentials: CalendarCredentials): Promise<void>;

  /**
   * Check if provider is properly authenticated
   */
  isAuthenticated(): boolean;

  /**
   * Refresh access token if needed
   */
  refreshAuthentication(): Promise<void>;

  /**
   * Get available time slots based on free/busy data
   * @returns Array of available time slots
   */
  getAvailability(options: AvailabilityOptions): Promise<TimeSlot[]>;

  /**
   * Create a provisional hold (temporary tentative event)
   * Used during approval workflow to reserve time slot
   *
   * @param slot - Time slot to hold
   * @param bookingInquiryId - Associated booking inquiry ID
   * @param expirationMinutes - How long the hold is valid (default: 30)
   * @returns Provisional hold details
   */
  createProvisionalHold(
    slot: { start: Date; end: Date },
    bookingInquiryId: string,
    expirationMinutes?: number
  ): Promise<ProvisionalHold>;

  /**
   * Confirm a provisional hold by converting to a real calendar event
   *
   * @param holdId - ID of the provisional hold
   * @param eventDetails - Final event details (attendees, description, etc.)
   * @returns Confirmed calendar event
   */
  confirmProvisionalHold(
    holdId: string,
    eventDetails: Partial<CalendarEvent>
  ): Promise<CalendarEvent>;

  /**
   * Release a provisional hold (delete the tentative event)
   * Used when booking is rejected or hold expires
   *
   * @param holdId - ID of the provisional hold to release
   */
  releaseProvisionalHold(holdId: string): Promise<void>;

  /**
   * Subscribe to calendar change notifications via webhooks
   *
   * @param webhookUrl - URL to receive push notifications
   * @returns Subscription details
   */
  subscribeToWebhook(webhookUrl: string): Promise<WebhookSubscription>;

  /**
   * Unsubscribe from calendar change notifications
   *
   * @param subscriptionId - ID of the subscription to cancel
   */
  unsubscribeFromWebhook(subscriptionId: string): Promise<void>;

  /**
   * Renew an existing webhook subscription before it expires
   *
   * @param subscriptionId - ID of the subscription to renew
   * @returns Updated subscription details
   */
  renewWebhookSubscription(subscriptionId: string): Promise<WebhookSubscription>;

  /**
   * Get a specific calendar event by ID
   *
   * @param eventId - Calendar event ID
   * @returns Calendar event details
   */
  getEvent(eventId: string): Promise<CalendarEvent>;

  /**
   * Create a new calendar event
   *
   * @param eventDetails - Event details
   * @returns Created calendar event
   */
  createEvent(eventDetails: Partial<CalendarEvent>): Promise<CalendarEvent>;

  /**
   * Update an existing calendar event
   *
   * @param eventId - Calendar event ID
   * @param updates - Fields to update
   * @returns Updated calendar event
   */
  updateEvent(
    eventId: string,
    updates: Partial<CalendarEvent>
  ): Promise<CalendarEvent>;

  /**
   * Delete a calendar event
   *
   * @param eventId - Calendar event ID
   */
  deleteEvent(eventId: string): Promise<void>;
}

/**
 * Calendar Provider Error Types
 */
export class CalendarProviderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly providerId: string
  ) {
    super(message);
    this.name = 'CalendarProviderError';
  }
}

export class AuthenticationError extends CalendarProviderError {
  constructor(providerId: string, message = 'Calendar authentication failed') {
    super(message, 'AUTH_ERROR', providerId);
    this.name = 'AuthenticationError';
  }
}

export class AvailabilityError extends CalendarProviderError {
  constructor(providerId: string, message = 'Failed to fetch availability') {
    super(message, 'AVAILABILITY_ERROR', providerId);
    this.name = 'AvailabilityError';
  }
}

export class ProvisionalHoldError extends CalendarProviderError {
  constructor(providerId: string, message = 'Provisional hold operation failed') {
    super(message, 'HOLD_ERROR', providerId);
    this.name = 'ProvisionalHoldError';
  }
}

export class WebhookError extends CalendarProviderError {
  constructor(providerId: string, message = 'Webhook operation failed') {
    super(message, 'WEBHOOK_ERROR', providerId);
    this.name = 'WebhookError';
  }
}
