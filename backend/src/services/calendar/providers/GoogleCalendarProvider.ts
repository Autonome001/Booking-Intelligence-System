/**
 * Google Calendar Provider Implementation
 *
 * Implements ICalendarProvider for Google Calendar API v3
 * Features:
 * - OAuth2 authentication with automatic token refresh
 * - Free/busy availability checking
 * - Provisional holds as tentative events
 * - Webhook push notifications
 */

import { google, calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import {
  ICalendarProvider,
  TimeSlot,
  AvailabilityOptions,
  ProvisionalHold,
  CalendarEvent,
  WebhookSubscription,
  CalendarCredentials,
  AuthenticationError,
  AvailabilityError,
  ProvisionalHoldError,
  WebhookError,
} from './ICalendarProvider.js';

export interface GoogleCalendarConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  calendarId?: string; // Default: 'primary'
}

export class GoogleCalendarProvider implements ICalendarProvider {
  public readonly providerId: string;
  public readonly providerType = 'google' as const;
  public readonly calendarEmail: string;

  private auth: OAuth2Client;
  private calendar: calendar_v3.Calendar;
  private calendarId: string;
  private isInitialized = false;
  private provisionalHolds: Map<string, ProvisionalHold> = new Map();

  constructor(
    providerId: string,
    calendarEmail: string,
    config: GoogleCalendarConfig
  ) {
    this.providerId = providerId;
    this.calendarEmail = calendarEmail;
    this.calendarId = config.calendarId || 'primary';

    // Initialize OAuth2 client
    this.auth = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      config.redirectUri
    );

    this.calendar = google.calendar({ version: 'v3', auth: this.auth });
  }

  /**
   * Initialize with OAuth2 credentials
   */
  async initialize(credentials: CalendarCredentials): Promise<void> {
    try {
      this.auth.setCredentials({
        access_token: credentials.accessToken,
        refresh_token: credentials.refreshToken,
        expiry_date: credentials.expiresAt?.getTime(),
      });

      // Test authentication by fetching calendar info
      await this.calendar.calendars.get({ calendarId: this.calendarId });

      this.isInitialized = true;
    } catch (error) {
      throw new AuthenticationError(
        this.providerId,
        `Failed to initialize Google Calendar: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return this.isInitialized && !!this.auth.credentials.access_token;
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAuthentication(): Promise<void> {
    try {
      const { credentials } = await this.auth.refreshAccessToken();
      this.auth.setCredentials(credentials);
    } catch (error) {
      throw new AuthenticationError(
        this.providerId,
        `Token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get available time slots using free/busy query
   */
  async getAvailability(options: AvailabilityOptions): Promise<TimeSlot[]> {
    if (!this.isAuthenticated()) {
      throw new AuthenticationError(this.providerId, 'Not authenticated');
    }

    try {
      // Query free/busy information
      const response = await this.calendar.freebusy.query({
        requestBody: {
          timeMin: options.startDate.toISOString(),
          timeMax: options.endDate.toISOString(),
          items: [{ id: this.calendarId }],
        },
      });

      const busySlots = response.data.calendars?.[this.calendarId]?.busy || [];

      // Generate available slots based on working hours and busy periods
      const availableSlots = this.calculateAvailableSlots(
        options.startDate,
        options.endDate,
        busySlots.map((slot) => ({
          start: new Date(slot.start || ''),
          end: new Date(slot.end || ''),
        })),
        options
      );

      return availableSlots;
    } catch (error) {
      // Auto-refresh token if expired
      if (this.isTokenExpiredError(error)) {
        await this.refreshAuthentication();
        return this.getAvailability(options); // Retry
      }

      throw new AvailabilityError(
        this.providerId,
        `Failed to fetch availability: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Create provisional hold as tentative event with [HOLD] prefix
   */
  async createProvisionalHold(
    slot: { start: Date; end: Date },
    bookingInquiryId: string,
    expirationMinutes = 30
  ): Promise<ProvisionalHold> {
    if (!this.isAuthenticated()) {
      throw new AuthenticationError(this.providerId, 'Not authenticated');
    }

    try {
      const expiresAt = new Date(Date.now() + expirationMinutes * 60 * 1000);

      // Create tentative event
      const event = await this.calendar.events.insert({
        calendarId: this.calendarId,
        requestBody: {
          summary: `[HOLD] Booking Inquiry ${bookingInquiryId.substring(0, 8)}`,
          description: `Provisional hold expires at ${expiresAt.toISOString()}\nBooking Inquiry ID: ${bookingInquiryId}`,
          start: { dateTime: slot.start.toISOString() },
          end: { dateTime: slot.end.toISOString() },
          status: 'tentative',
          transparency: 'opaque', // Blocks time
          colorId: '11', // Red color for holds
          extendedProperties: {
            private: {
              type: 'provisional_hold',
              booking_inquiry_id: bookingInquiryId,
              expires_at: expiresAt.toISOString(),
            },
          },
        },
      });

      const hold: ProvisionalHold = {
        id: `${this.providerId}:${event.data.id}`,
        calendarEventId: event.data.id || '',
        slotStart: slot.start,
        slotEnd: slot.end,
        expiresAt,
        metadata: {
          bookingInquiryId,
          calendarId: this.calendarId,
        },
      };

      this.provisionalHolds.set(hold.id, hold);

      return hold;
    } catch (error) {
      if (this.isTokenExpiredError(error)) {
        await this.refreshAuthentication();
        return this.createProvisionalHold(slot, bookingInquiryId, expirationMinutes);
      }

      throw new ProvisionalHoldError(
        this.providerId,
        `Failed to create provisional hold: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Confirm provisional hold by converting to confirmed event
   */
  async confirmProvisionalHold(
    holdId: string,
    eventDetails: Partial<CalendarEvent>
  ): Promise<CalendarEvent> {
    if (!this.isAuthenticated()) {
      throw new AuthenticationError(this.providerId, 'Not authenticated');
    }

    const hold = this.provisionalHolds.get(holdId);
    if (!hold) {
      throw new ProvisionalHoldError(
        this.providerId,
        `Provisional hold ${holdId} not found`
      );
    }

    try {
      // Update event to confirmed status
      const event = await this.calendar.events.patch({
        calendarId: this.calendarId,
        eventId: hold.calendarEventId,
        requestBody: {
          summary: eventDetails.summary || 'Confirmed Meeting',
          description: eventDetails.description,
          status: 'confirmed',
          colorId: '9', // Blue color for confirmed
          attendees: eventDetails.attendees?.map((email) => ({ email })),
          location: eventDetails.location,
          conferenceData: eventDetails.meetingLink
            ? {
              createRequest: {
                requestId: `${hold.calendarEventId}-meet`,
                conferenceSolutionKey: { type: 'hangoutsMeet' },
              },
            }
            : undefined,
          extendedProperties: {
            private: {
              type: 'confirmed_booking',
              booking_inquiry_id: hold.metadata?.['bookingInquiryId'] as string,
            },
          },
        },
        conferenceDataVersion: eventDetails.meetingLink ? 1 : undefined,
      });

      // Remove from provisional holds map
      this.provisionalHolds.delete(holdId);

      return this.mapGoogleEventToCalendarEvent(event.data);
    } catch (error) {
      if (this.isTokenExpiredError(error)) {
        await this.refreshAuthentication();
        return this.confirmProvisionalHold(holdId, eventDetails);
      }

      throw new ProvisionalHoldError(
        this.providerId,
        `Failed to confirm provisional hold: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Release provisional hold by deleting the event
   */
  async releaseProvisionalHold(holdId: string): Promise<void> {
    if (!this.isAuthenticated()) {
      throw new AuthenticationError(this.providerId, 'Not authenticated');
    }

    const hold = this.provisionalHolds.get(holdId);
    if (!hold) {
      throw new ProvisionalHoldError(
        this.providerId,
        `Provisional hold ${holdId} not found`
      );
    }

    try {
      await this.calendar.events.delete({
        calendarId: this.calendarId,
        eventId: hold.calendarEventId,
      });

      this.provisionalHolds.delete(holdId);
    } catch (error) {
      if (this.isTokenExpiredError(error)) {
        await this.refreshAuthentication();
        return this.releaseProvisionalHold(holdId);
      }

      throw new ProvisionalHoldError(
        this.providerId,
        `Failed to release provisional hold: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Subscribe to calendar push notifications
   */
  async subscribeToWebhook(webhookUrl: string): Promise<WebhookSubscription> {
    if (!this.isAuthenticated()) {
      throw new AuthenticationError(this.providerId, 'Not authenticated');
    }

    try {
      const response = await this.calendar.events.watch({
        calendarId: this.calendarId,
        requestBody: {
          id: `${this.providerId}-${Date.now()}`,
          type: 'web_hook',
          address: webhookUrl,
        },
      });

      return {
        id: response.data.id || '',
        channelId: response.data.id || '',
        resourceId: response.data.resourceId || '',
        expiresAt: new Date(parseInt(response.data.expiration || '0')),
      };
    } catch (error) {
      if (this.isTokenExpiredError(error)) {
        await this.refreshAuthentication();
        return this.subscribeToWebhook(webhookUrl);
      }

      throw new WebhookError(
        this.providerId,
        `Failed to subscribe to webhook: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Unsubscribe from webhook
   */
  async unsubscribeFromWebhook(subscriptionId: string): Promise<void> {
    if (!this.isAuthenticated()) {
      throw new AuthenticationError(this.providerId, 'Not authenticated');
    }

    try {
      await this.calendar.channels.stop({
        requestBody: {
          id: subscriptionId,
          resourceId: subscriptionId,
        },
      });
    } catch (error) {
      if (this.isTokenExpiredError(error)) {
        await this.refreshAuthentication();
        return this.unsubscribeFromWebhook(subscriptionId);
      }

      throw new WebhookError(
        this.providerId,
        `Failed to unsubscribe from webhook: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Renew webhook subscription
   */
  async renewWebhookSubscription(
    subscriptionId: string
  ): Promise<WebhookSubscription> {
    // Google Calendar requires stopping and recreating subscriptions
    await this.unsubscribeFromWebhook(subscriptionId);

    // Note: This requires storing the original webhook URL
    // In production, you'd retrieve this from database
    throw new WebhookError(
      this.providerId,
      'Webhook renewal requires original webhook URL - use unsubscribe + resubscribe pattern'
    );
  }

  /**
   * Get calendar event by ID
   */
  async getEvent(eventId: string): Promise<CalendarEvent> {
    if (!this.isAuthenticated()) {
      throw new AuthenticationError(this.providerId, 'Not authenticated');
    }

    try {
      const event = await this.calendar.events.get({
        calendarId: this.calendarId,
        eventId,
      });

      return this.mapGoogleEventToCalendarEvent(event.data);
    } catch (error) {
      if (this.isTokenExpiredError(error)) {
        await this.refreshAuthentication();
        return this.getEvent(eventId);
      }

      throw new Error(
        `Failed to get event: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Create calendar event
   */
  async createEvent(eventDetails: Partial<CalendarEvent>): Promise<CalendarEvent> {
    if (!this.isAuthenticated()) {
      throw new AuthenticationError(this.providerId, 'Not authenticated');
    }

    try {
      const event = await this.calendar.events.insert({
        calendarId: this.calendarId,
        requestBody: {
          summary: eventDetails.summary,
          description: eventDetails.description,
          start: eventDetails.start
            ? { dateTime: eventDetails.start.toISOString() }
            : undefined,
          end: eventDetails.end ? { dateTime: eventDetails.end.toISOString() } : undefined,
          attendees: eventDetails.attendees?.map((email) => ({ email })),
          location: eventDetails.location,
        },
      });

      return this.mapGoogleEventToCalendarEvent(event.data);
    } catch (error) {
      if (this.isTokenExpiredError(error)) {
        await this.refreshAuthentication();
        return this.createEvent(eventDetails);
      }

      throw new Error(
        `Failed to create event: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Update calendar event
   */
  async updateEvent(
    eventId: string,
    updates: Partial<CalendarEvent>
  ): Promise<CalendarEvent> {
    if (!this.isAuthenticated()) {
      throw new AuthenticationError(this.providerId, 'Not authenticated');
    }

    try {
      const event = await this.calendar.events.patch({
        calendarId: this.calendarId,
        eventId,
        requestBody: {
          summary: updates.summary,
          description: updates.description,
          start: updates.start ? { dateTime: updates.start.toISOString() } : undefined,
          end: updates.end ? { dateTime: updates.end.toISOString() } : undefined,
          attendees: updates.attendees?.map((email) => ({ email })),
          location: updates.location,
        },
      });

      return this.mapGoogleEventToCalendarEvent(event.data);
    } catch (error) {
      if (this.isTokenExpiredError(error)) {
        await this.refreshAuthentication();
        return this.updateEvent(eventId, updates);
      }

      throw new Error(
        `Failed to update event: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Delete calendar event
   */
  async deleteEvent(eventId: string): Promise<void> {
    if (!this.isAuthenticated()) {
      throw new AuthenticationError(this.providerId, 'Not authenticated');
    }

    try {
      await this.calendar.events.delete({
        calendarId: this.calendarId,
        eventId,
      });
    } catch (error) {
      if (this.isTokenExpiredError(error)) {
        await this.refreshAuthentication();
        return this.deleteEvent(eventId);
      }

      throw new Error(
        `Failed to delete event: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // ====================================================================
  // PRIVATE HELPER METHODS
  // ====================================================================

  /**
   * Calculate available time slots from busy periods
   */
  private calculateAvailableSlots(
    startDate: Date,
    endDate: Date,
    busySlots: { start: Date; end: Date }[],
    options: AvailabilityOptions
  ): TimeSlot[] {
    const availableSlots: TimeSlot[] = [];
    const durationMs = options.durationMinutes * 60 * 1000;
    // Default working hours: 9 AM - 5 PM
    const workStart = options.workingHours?.start || '09:00';
    const workEnd = options.workingHours?.end || '17:00';

    let currentDate = new Date(startDate);

    while (currentDate < endDate) {
      // Set to working hours start
      const dayStart = this.setTimeOfDay(new Date(currentDate), workStart);
      const dayEnd = this.setTimeOfDay(new Date(currentDate), workEnd);

      let slotStart = new Date(dayStart);

      while (slotStart < dayEnd) {
        const slotEnd = new Date(slotStart.getTime() + durationMs);

        if (slotEnd > dayEnd) break;

        // Check if slot overlaps with any busy period
        const isAvailable = !busySlots.some(
          (busy) =>
            (slotStart >= busy.start && slotStart < busy.end) ||
            (slotEnd > busy.start && slotEnd <= busy.end) ||
            (slotStart <= busy.start && slotEnd >= busy.end)
        );

        availableSlots.push({
          start: new Date(slotStart),
          end: new Date(slotEnd),
          available: isAvailable,
        });

        // Move to next slot start using a fixed interval (e.g., 60 minutes)
        // This ensures slots start at predictable times (9:00, 10:00, etc.)
        const intervalMs = (options.slotIntervalMinutes || 60) * 60 * 1000;
        slotStart = new Date(slotStart.getTime() + intervalMs);
      }

      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Return only available slots
    return availableSlots.filter((slot) => slot.available);
  }

  /**
   * Set time of day on a date (e.g., "09:00" => 9:00 AM)
   */
  private setTimeOfDay(date: Date, time: string): Date {
    const [hours = 0, minutes = 0] = time.split(':').map(Number);
    const result = new Date(date);
    result.setHours(hours, minutes, 0, 0);
    return result;
  }

  /**
   * Check if error is due to expired token
   */
  private isTokenExpiredError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return (
      message.includes('invalid_grant') ||
      message.includes('token') ||
      message.includes('unauthorized') ||
      message.includes('401')
    );
  }

  /**
   * Map Google Calendar event to standard CalendarEvent
   */
  private mapGoogleEventToCalendarEvent(event: calendar_v3.Schema$Event): CalendarEvent {
    return {
      id: event.id || '',
      summary: event.summary || '',
      description: event.description || undefined,
      start: new Date(event.start?.dateTime || event.start?.date || ''),
      end: new Date(event.end?.dateTime || event.end?.date || ''),
      attendees: event.attendees?.map((a) => a.email || '').filter(Boolean),
      location: event.location || undefined,
      meetingLink: (event.hangoutLink || event.conferenceData?.entryPoints?.[0]?.uri) || undefined,
    };
  }
}
