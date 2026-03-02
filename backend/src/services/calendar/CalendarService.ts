/**
 * Calendar Service - Multi-Calendar Orchestration
 *
 * Manages up to 7 Google Calendar accounts with:
 * - Parallel availability fetching from all calendars
 * - Intersection logic (available only when ALL calendars free)
 * - Caching with 15-minute TTL
 * - Provisional holds across all calendars simultaneously
 * - Transaction-style rollback on failures
 * - Webhook cache invalidation
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { GoogleCalendarProvider, GoogleCalendarConfig } from './providers/GoogleCalendarProvider.js';
import { ensureCalendarAccountsTable } from './calendarAccountsSchema.js';
import {
  ICalendarProvider,
  TimeSlot,
  ProvisionalHold,
  CalendarEvent,
} from './providers/ICalendarProvider.js';

export interface CalendarAccount {
  id: string;
  user_email: string;
  calendar_email: string;
  calendar_type: string;
  oauth_credentials: {
    access_token: string;
    refresh_token: string;
    expiry_date?: number;
  };
  is_primary: boolean;
  priority: number;
  is_active: boolean;
}

export interface GetAvailableSlotsOptions {
  startDate: Date;
  endDate: Date;
  durationMinutes: number;
  maxSlots?: number;
  workingHours?: {
    start: string;
    end: string;
  };
  bufferMinutes?: number;
  slotIntervalMinutes?: number;
}

export interface ProvisionalHoldRequest {
  bookingInquiryId: string;
  slot: { start: Date; end: Date };
  expirationMinutes?: number;
}

export interface MultiCalendarProvisionalHold {
  id: string;
  booking_inquiry_id: string;
  holds: ProvisionalHold[];
  created_at: Date;
  expires_at: Date;
}

export interface BookingCalendarInfo {
  providerId: string | null;
  calendarEmail: string | null;
  isConfigured: boolean;
}

interface AvailabilityCacheEntry {
  slots: TimeSlot[];
  cachedAt: Date;
  expiresAt: Date;
}

export class CalendarService {
  private providers: Map<string, ICalendarProvider> = new Map();
  private availabilityCache: Map<string, AvailabilityCacheEntry> = new Map();
  private cacheTTLMinutes = 15; // Configurable via YAML in production
  private availabilityUserEmail: string | null = null;
  private bookingProviderId: string | null = null;
  private bookingCalendarEmail: string | null = null;
  private selectionHoldBySession: Map<string, string> = new Map();
  private selectionHoldTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  private getLocalDateParts(date: Date, timeZone: string): {
    dayOfWeek: number;
    time: string;
  } {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);

    const weekday = parts.find((part) => part.type === 'weekday')?.value || 'Sun';
    const hour = parts.find((part) => part.type === 'hour')?.value || '00';
    const minute = parts.find((part) => part.type === 'minute')?.value || '00';
    const second = parts.find((part) => part.type === 'second')?.value || '00';

    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };

    return {
      dayOfWeek: weekdayMap[weekday] ?? 0,
      time: `${hour}:${minute}:${second}`,
    };
  }

  constructor(
    private supabase: SupabaseClient,
    private googleConfig: GoogleCalendarConfig
  ) { }

  /**
   * Initialize all active calendar providers from database
   */
  async initializeProviders(): Promise<void> {
    const tableStatus = await ensureCalendarAccountsTable(this.supabase);

    if (!tableStatus.ready) {
      console.warn(
        `Calendar accounts table unavailable, continuing without calendar providers: ${tableStatus.reason || 'unknown reason'}`
      );
      return;
    }

    const { data: accounts, error } = await this.supabase
      .from('calendar_accounts')
      .select('*')
      .eq('is_active', true)
      .order('priority', { ascending: false });

    if (error) {
      console.error('Failed to load calendar accounts:', error);
      throw new Error(`Failed to initialize calendar providers: ${error.message}`);
    }

    if (!accounts || accounts.length === 0) {
      console.warn('No active calendar accounts found in database');
      return;
    }

    this.providers.clear();
    this.availabilityUserEmail = null;
    this.bookingProviderId = null;
    this.bookingCalendarEmail = null;
    console.log(`Initializing ${accounts.length} calendar provider(s)...`);

    for (const account of accounts as CalendarAccount[]) {
      try {
        if (!this.availabilityUserEmail && account.user_email) {
          this.availabilityUserEmail = account.user_email;
        }

        if (!account.oauth_credentials?.access_token || !account.oauth_credentials?.refresh_token) {
          console.warn(`Skipping calendar without OAuth credentials: ${account.calendar_email}`);
          continue;
        }

        if (account.calendar_type === 'google') {
          const provider = new GoogleCalendarProvider(
            account.id,
            account.calendar_email,
            this.googleConfig
          );

          await provider.initialize({
            accessToken: account.oauth_credentials.access_token,
            refreshToken: account.oauth_credentials.refresh_token,
            expiresAt: account.oauth_credentials.expiry_date
              ? new Date(account.oauth_credentials.expiry_date)
              : undefined,
          });

          this.providers.set(account.id, provider);
          if (account.is_primary) {
            this.bookingProviderId = account.id;
            this.bookingCalendarEmail = account.calendar_email;
          } else if (!this.bookingProviderId) {
            this.bookingProviderId = account.id;
            this.bookingCalendarEmail = account.calendar_email;
          }
          console.log(`✓ Initialized calendar: ${account.calendar_email}`);
        }
      } catch (error) {
        console.error(
          `Failed to initialize calendar ${account.calendar_email}:`,
          error
        );
      }
    }

    console.log(`Calendar service ready with ${this.providers.size} provider(s)`);
  }

  /**
   * Get available time slots aggregated across ALL calendars
   * Returns slots that are available in ALL calendars (intersection logic)
   */
  async getAvailableSlots(
    options: GetAvailableSlotsOptions
  ): Promise<TimeSlot[]> {
    if (this.providers.size === 0) {
      throw new Error('No calendar providers initialized');
    }

    // Check cache first
    const cacheKey = this.generateCacheKey(options);
    const cached = this.availabilityCache.get(cacheKey);

    if (cached && cached.expiresAt > new Date()) {
      console.log(`Cache hit for availability (${this.providers.size} calendars)`);
      return cached.slots.slice(0, options.maxSlots || 10);
    }

    console.log(
      `Fetching availability from ${this.providers.size} calendar(s) in parallel...`
    );

    // Fetch availability from all calendars in parallel
    const availabilityPromises = Array.from(this.providers.values()).map(
      (provider) =>
        provider.getAvailability({
          startDate: options.startDate,
          endDate: options.endDate,
          durationMinutes: options.durationMinutes,
          workingHours: options.workingHours,
          bufferMinutes: options.bufferMinutes,
          slotIntervalMinutes: options.slotIntervalMinutes,
        })
    );

    const allAvailabilities = await Promise.all(availabilityPromises);

    // Intersection logic: Find slots available in ALL calendars
    const intersectedSlots = this.intersectAvailabilities(allAvailabilities);

    // Apply availability controls: blackouts and working hours
    const userEmail = this.availabilityUserEmail || 'dev@autonome.us';
    const filteredByBlackouts = await this.filterByBlackouts(intersectedSlots, userEmail, options.startDate, options.endDate);
    const filteredByWorkingHours = await this.filterByWorkingHours(filteredByBlackouts, userEmail);
    const finalSlots = filteredByWorkingHours.filter((slot) => slot.start >= options.startDate);

    // Cache the result
    this.cacheAvailability(cacheKey, finalSlots);

    console.log(
      `Found ${finalSlots.length} available slots (after blackouts and working hours filtering)`
    );

    return finalSlots.slice(0, options.maxSlots || 10);
  }

  /**
   * Create provisional holds on ALL calendars simultaneously
   * Uses transaction-style: if any calendar fails, rollback all holds
   */
  async createProvisionalHolds(
    request: ProvisionalHoldRequest
  ): Promise<MultiCalendarProvisionalHold> {
    if (this.providers.size === 0) {
      throw new Error('No calendar providers initialized');
    }

    const createdHolds: ProvisionalHold[] = [];
    const expiresAt = new Date(
      Date.now() + (request.expirationMinutes || 30) * 60 * 1000
    );

    try {
      console.log(
        `Creating provisional holds on ${this.providers.size} calendar(s)...`
      );

      // Create holds on all calendars in parallel
      const holdPromises = Array.from(this.providers.values()).map((provider) =>
        provider.createProvisionalHold(
          request.slot,
          request.bookingInquiryId,
          request.expirationMinutes
        )
      );

      const holds = await Promise.all(holdPromises);
      createdHolds.push(...holds);

      console.log(`✓ Created ${holds.length} provisional hold(s)`);

      // Store in database
      const { data: dbHold, error: dbError } = await this.supabase
        .from('provisional_holds')
        .insert({
          booking_inquiry_id: request.bookingInquiryId,
          calendar_email: Array.from(this.providers.values())
            .map((p) => p.calendarEmail)
            .join(','),
          slot_start: request.slot.start.toISOString(),
          slot_end: request.slot.end.toISOString(),
          expires_at: expiresAt.toISOString(),
          status: 'active',
          metadata: { holds: holds.map((h) => h.id) },
        })
        .select()
        .single();

      if (dbError) {
        // Rollback: release all holds if database insert fails
        console.error('Database insert failed, rolling back holds:', dbError);
        await this.rollbackHolds(createdHolds);
        throw new Error(`Failed to store provisional holds: ${dbError.message}`);
      }

      return {
        id: dbHold.id,
        booking_inquiry_id: request.bookingInquiryId,
        holds: createdHolds,
        created_at: new Date(dbHold.created_at),
        expires_at: expiresAt,
      };
    } catch (error) {
      // Rollback: release all successfully created holds
      console.error('Failed to create provisional holds, rolling back:', error);
      await this.rollbackHolds(createdHolds);
      throw error;
    }
  }

  /**
   * Confirm provisional holds by converting to real events on all calendars
   */
  async confirmProvisionalHolds(
    holdId: string,
    eventDetails: Partial<CalendarEvent>
  ): Promise<CalendarEvent[]> {
    // Fetch hold from database
    const { data: dbHold, error: dbError } = await this.supabase
      .from('provisional_holds')
      .select('*')
      .eq('id', holdId)
      .eq('status', 'active')
      .single();

    if (dbError || !dbHold) {
      throw new Error(`Provisional hold ${holdId} not found or already processed`);
    }

    const holdIds = (dbHold.metadata as { holds: string[] }).holds;

    console.log(`Confirming ${holdIds.length} provisional hold(s)...`);

    const confirmedEvents: CalendarEvent[] = [];

    try {
      // Confirm holds on all calendars in parallel
      const confirmPromises = holdIds.map((id) => {
        const providerId = id.split(':')[0]!; // Non-null assertion - format guaranteed by system
        const provider = this.providers.get(providerId);

        if (!provider) {
          throw new Error(`Provider ${providerId} not found`);
        }

        return provider.confirmProvisionalHold(id, eventDetails);
      });

      const events = await Promise.all(confirmPromises);
      confirmedEvents.push(...events);

      // Update database status
      await this.supabase
        .from('provisional_holds')
        .update({
          status: 'confirmed',
          confirmed_event_id: events[0]?.id,
        })
        .eq('id', holdId);

      console.log(`✓ Confirmed ${events.length} event(s) across all calendars`);

      // Invalidate availability cache
      this.clearAvailabilityCache();

      return confirmedEvents;
    } catch (error) {
      console.error('Failed to confirm provisional holds:', error);
      throw error;
    }
  }

  /**
   * Release provisional holds (delete from all calendars)
   */
  async releaseProvisionalHolds(holdId: string): Promise<void> {
    // Fetch hold from database
    const { data: dbHold, error: dbError } = await this.supabase
      .from('provisional_holds')
      .select('*')
      .eq('id', holdId)
      .single();

    if (dbError || !dbHold) {
      throw new Error(`Provisional hold ${holdId} not found`);
    }

    if (dbHold.status === 'released' || dbHold.status === 'expired') {
      console.log(`Hold ${holdId} already ${dbHold.status}`);
      return;
    }

    const metadata = dbHold.metadata as Record<string, unknown> | null;
    const isSelectionHold =
      metadata?.['type'] === 'selection_hold'
      || typeof metadata?.['provider_hold_id'] === 'string';

    if (isSelectionHold) {
      await this.releaseSelectionHold(holdId);
      return;
    }

    const holdIds = (dbHold.metadata as { holds: string[] }).holds;

    console.log(`Releasing ${holdIds.length} provisional hold(s)...`);

    // Release holds on all calendars in parallel
    const releasePromises = holdIds.map((id) => {
      const providerId = id.split(':')[0]!; // Non-null assertion - format guaranteed by system
      const provider = this.providers.get(providerId);

      if (!provider) {
        console.warn(`Provider ${providerId} not found, skipping release`);
        return Promise.resolve();
      }

      return provider.releaseProvisionalHold(id).catch((error) => {
        console.error(`Failed to release hold ${id}:`, error);
      });
    });

    await Promise.all(releasePromises);

    // Update database status
    await this.supabase
      .from('provisional_holds')
      .update({
        status: 'released',
        released_at: new Date().toISOString(),
      })
      .eq('id', holdId);

    console.log(`✓ Released ${holdIds.length} hold(s)`);

    // Invalidate availability cache
    this.clearAvailabilityCache();
  }

  /**
   * Cleanup expired provisional holds (called by cron job)
   */
  async cleanupExpiredHolds(): Promise<number> {
    const { data: expiredHolds, error } = await this.supabase
      .from('provisional_holds')
      .select('*')
      .eq('status', 'active')
      .lt('expires_at', new Date().toISOString());

    if (error || !expiredHolds || expiredHolds.length === 0) {
      return 0;
    }

    console.log(`Cleaning up ${expiredHolds.length} expired hold(s)...`);

    for (const hold of expiredHolds) {
      try {
        await this.releaseProvisionalHolds(hold.id);

        // Mark as expired
        await this.supabase
          .from('provisional_holds')
          .update({ status: 'expired' })
          .eq('id', hold.id);
      } catch (error) {
        console.error(`Failed to cleanup hold ${hold.id}:`, error);
      }
    }

    return expiredHolds.length;
  }

  /**
   * Handle webhook notification (invalidate cache)
   */
  handleWebhookNotification(calendarId: string): void {
    console.log(`Webhook notification received for calendar ${calendarId}`);
    this.clearAvailabilityCache();
  }

  /**
   * Get all active calendar providers
   */
  getProviders(): ICalendarProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get primary calendar provider (highest priority)
   */
  getPrimaryProvider(): ICalendarProvider | undefined {
    return this.providers.values().next().value;
  }

  /**
   * Get the admin-selected booking calendar.
   */
  getBookingCalendarInfo(): BookingCalendarInfo {
    return {
      providerId: this.bookingProviderId,
      calendarEmail: this.bookingCalendarEmail,
      isConfigured: Boolean(this.bookingProviderId && this.bookingCalendarEmail),
    };
  }

  /**
   * Create a provisional hold for the customer-selected slot on the designated booking calendar.
   */
  async createSelectionHold(
    sessionId: string,
    slot: { start: Date; end: Date },
    expirationMinutes = 15
  ): Promise<{ holdId: string; calendarEmail: string; expiresAt: Date }> {
    const provider = this.getBookingProviderOrThrow();
    const existingHoldId = this.selectionHoldBySession.get(sessionId);

    if (existingHoldId) {
      try {
        await this.releaseSelectionHold(existingHoldId);
      } catch (error) {
        console.warn(`Failed to release previous selection hold ${existingHoldId}:`, error);
      }
    }

    const hold = await provider.createProvisionalHold(
      slot,
      `selection_${sessionId}`,
      expirationMinutes
    );
    const persistencePayload = {
      booking_inquiry_id: null,
      calendar_account_id: this.bookingProviderId,
      calendar_email: provider.calendarEmail,
      slot_start: hold.slotStart.toISOString(),
      slot_end: hold.slotEnd.toISOString(),
      expires_at: hold.expiresAt.toISOString(),
      status: 'active',
      metadata: {
        type: 'selection_hold',
        session_id: sessionId,
        provider_hold_id: hold.id,
      },
    };
    const { data: persistedHold, error: persistenceError } = await this.supabase
      .from('provisional_holds')
      .insert(persistencePayload)
      .select('id, expires_at')
      .single<{ id: string; expires_at: string }>();

    if (persistenceError || !persistedHold) {
      try {
        await provider.releaseProvisionalHold(hold.id);
      } catch (releaseError) {
        console.warn(`Failed to release unpersisted selection hold ${hold.id}:`, releaseError);
      }

      throw new Error(
        `Failed to persist the selected booking slot: ${persistenceError?.message || 'Unknown database error'}`
      );
    }

    const publicHoldId = persistedHold.id;
    const expiresAt = new Date(persistedHold.expires_at || hold.expiresAt.toISOString());

    this.selectionHoldBySession.set(sessionId, publicHoldId);
    this.scheduleSelectionHoldExpiry(publicHoldId, sessionId, expiresAt);
    this.clearAvailabilityCache();

    return {
      holdId: publicHoldId,
      calendarEmail: provider.calendarEmail,
      expiresAt,
    };
  }

  /**
   * Confirm a customer-selected provisional hold into a real calendar event.
   */
  async confirmSelectionHold(
    holdId: string,
    eventDetails: Partial<CalendarEvent>
  ): Promise<{ event: CalendarEvent; calendarEmail: string }> {
    if (holdId.includes(':')) {
      const provider = this.getProviderForHoldOrThrow(holdId);
      const event = await provider.confirmProvisionalHold(holdId, eventDetails);

      this.removeSelectionHoldReferences(holdId);
      this.clearAvailabilityCache();

      return {
        event,
        calendarEmail: provider.calendarEmail,
      };
    }

    const { data: persistedHold, error } = await this.supabase
      .from('provisional_holds')
      .select('*')
      .eq('id', holdId)
      .single<Record<string, unknown>>();

    if (error || !persistedHold) {
      throw new Error(`Selection hold ${holdId} not found`);
    }

    const status = typeof persistedHold['status'] === 'string' ? persistedHold['status'] : 'active';
    const metadata = persistedHold['metadata'] as Record<string, unknown> | null;
    const providerHoldId =
      typeof metadata?.['provider_hold_id'] === 'string' ? metadata['provider_hold_id'] : '';

    if (!providerHoldId) {
      throw new Error(`Selection hold ${holdId} is missing provider metadata`);
    }

    const providerId =
      typeof persistedHold['calendar_account_id'] === 'string'
        ? persistedHold['calendar_account_id']
        : providerHoldId.split(':')[0];
    const provider = providerId ? this.providers.get(providerId) : undefined;

    if (!provider) {
      throw new Error(`Booking calendar provider ${providerId || 'unknown'} is not available`);
    }

    if (status === 'confirmed' && typeof persistedHold['confirmed_event_id'] === 'string') {
      const existingEvent = await provider.getEvent(persistedHold['confirmed_event_id']);
      this.removeSelectionHoldReferences(holdId);
      this.clearAvailabilityCache();

      return {
        event: existingEvent,
        calendarEmail: provider.calendarEmail,
      };
    }

    if (status !== 'active') {
      throw new Error(`Selection hold ${holdId} is no longer active`);
    }

    const event = await provider.confirmProvisionalHold(providerHoldId, eventDetails);

    await this.supabase
      .from('provisional_holds')
      .update({
        status: 'confirmed',
        confirmed_event_id: event.id,
      })
      .eq('id', holdId);

    this.removeSelectionHoldReferences(holdId);
    this.clearAvailabilityCache();

    return {
      event,
      calendarEmail: provider.calendarEmail,
    };
  }

  /**
   * Release a customer-selected provisional hold.
   */
  async releaseSelectionHold(holdId: string): Promise<void> {
    if (holdId.includes(':')) {
      const provider = this.getProviderForHoldOrThrow(holdId);
      await provider.releaseProvisionalHold(holdId);

      this.removeSelectionHoldReferences(holdId);
      this.clearAvailabilityCache();
      return;
    }

    const { data: persistedHold, error } = await this.supabase
      .from('provisional_holds')
      .select('*')
      .eq('id', holdId)
      .single<Record<string, unknown>>();

    if (error || !persistedHold) {
      throw new Error(`Selection hold ${holdId} not found`);
    }

    const status = typeof persistedHold['status'] === 'string' ? persistedHold['status'] : 'active';
    if (status === 'released' || status === 'expired' || status === 'confirmed') {
      this.removeSelectionHoldReferences(holdId);
      this.clearAvailabilityCache();
      return;
    }

    const metadata = persistedHold['metadata'] as Record<string, unknown> | null;
    const providerHoldId =
      typeof metadata?.['provider_hold_id'] === 'string' ? metadata['provider_hold_id'] : '';
    const providerId =
      typeof persistedHold['calendar_account_id'] === 'string'
        ? persistedHold['calendar_account_id']
        : providerHoldId.split(':')[0];
    const provider = providerId ? this.providers.get(providerId) : undefined;

    if (!provider || !providerHoldId) {
      throw new Error(`Booking calendar provider ${providerId || 'unknown'} is not available`);
    }

    await provider.releaseProvisionalHold(providerHoldId);
    await this.supabase
      .from('provisional_holds')
      .update({
        status: 'released',
        released_at: new Date().toISOString(),
      })
      .eq('id', holdId);

    this.removeSelectionHoldReferences(holdId);
    this.clearAvailabilityCache();
  }

  // ====================================================================
  // PRIVATE HELPER METHODS
  // ====================================================================

  /**
   * Intersect availability from multiple calendars
   * Returns slots that are available in ALL calendars
   */
  private intersectAvailabilities(
    allAvailabilities: TimeSlot[][]
  ): TimeSlot[] {
    if (allAvailabilities.length === 0) return [];
    if (allAvailabilities.length === 1) return allAvailabilities[0] || [];

    // Start with first calendar's availability
    let intersected = allAvailabilities[0] || [];

    // Intersect with each subsequent calendar
    for (let i = 1; i < allAvailabilities.length; i++) {
      const nextAvailability = allAvailabilities[i];
      if (nextAvailability) {
        intersected = this.intersectTwoAvailabilities(
          intersected,
          nextAvailability
        );
      }
    }

    return intersected;
  }

  /**
   * Intersect two availability arrays
   */
  private intersectTwoAvailabilities(
    slots1: TimeSlot[],
    slots2: TimeSlot[]
  ): TimeSlot[] {
    const intersected: TimeSlot[] = [];

    for (const slot1 of slots1) {
      for (const slot2 of slots2) {
        // Check if slots overlap
        const overlapStart = new Date(
          Math.max(slot1.start.getTime(), slot2.start.getTime())
        );
        const overlapEnd = new Date(
          Math.min(slot1.end.getTime(), slot2.end.getTime())
        );

        // If there's a valid overlap, add it
        if (overlapStart < overlapEnd) {
          intersected.push({
            start: overlapStart,
            end: overlapEnd,
            available: slot1.available && slot2.available,
          });
        }
      }
    }

    return intersected.filter((slot) => slot.available);
  }

  /**
   * Rollback provisional holds (delete all)
   */
  private async rollbackHolds(holds: ProvisionalHold[]): Promise<void> {
    console.log(`Rolling back ${holds.length} provisional hold(s)...`);

    const rollbackPromises = holds.map((hold) => {
      const providerId = hold.id.split(':')[0]!; // Non-null assertion - format guaranteed by system
      const provider = this.providers.get(providerId);

      if (!provider) return Promise.resolve();

      return provider.releaseProvisionalHold(hold.id).catch((error) => {
        console.error(`Failed to rollback hold ${hold.id}:`, error);
      });
    });

    await Promise.all(rollbackPromises);
  }

  private getBookingProviderOrThrow(): ICalendarProvider {
    const providerId = this.bookingProviderId || this.providers.keys().next().value;
    const provider = providerId ? this.providers.get(providerId) : undefined;

    if (!provider) {
      throw new Error('No designated booking calendar is configured');
    }

    return provider;
  }

  private getProviderForHoldOrThrow(holdId: string): ICalendarProvider {
    const providerId = holdId.split(':')[0];
    const provider = providerId ? this.providers.get(providerId) : undefined;

    if (!provider) {
      throw new Error(`Booking calendar provider ${providerId || 'unknown'} is not available`);
    }

    return provider;
  }

  private clearSelectionHoldTimeout(holdId: string): void {
    const timeout = this.selectionHoldTimers.get(holdId);
    if (timeout) {
      clearTimeout(timeout);
      this.selectionHoldTimers.delete(holdId);
    }
  }

  private removeSelectionHoldReferences(holdId: string): void {
    this.clearSelectionHoldTimeout(holdId);

    for (const [sessionId, mappedHoldId] of this.selectionHoldBySession.entries()) {
      if (mappedHoldId === holdId) {
        this.selectionHoldBySession.delete(sessionId);
      }
    }
  }

  private scheduleSelectionHoldExpiry(
    holdId: string,
    sessionId: string,
    expiresAt: Date
  ): void {
    this.clearSelectionHoldTimeout(holdId);

    const msUntilExpiry = Math.max(1_000, expiresAt.getTime() - Date.now());
    const timeout = setTimeout(async () => {
      const mappedHoldId = this.selectionHoldBySession.get(sessionId);

      if (mappedHoldId !== holdId) {
        this.selectionHoldTimers.delete(holdId);
        return;
      }

      try {
        if (holdId.includes(':')) {
          const provider = this.getProviderForHoldOrThrow(holdId);
          await provider.releaseProvisionalHold(holdId);
        } else {
          const { data: persistedHold, error } = await this.supabase
            .from('provisional_holds')
            .select('*')
            .eq('id', holdId)
            .single<Record<string, unknown>>();

          if (!error && persistedHold) {
            const status =
              typeof persistedHold['status'] === 'string' ? persistedHold['status'] : 'active';

            if (status === 'active') {
              const metadata = persistedHold['metadata'] as Record<string, unknown> | null;
              const providerHoldId =
                typeof metadata?.['provider_hold_id'] === 'string'
                  ? metadata['provider_hold_id']
                  : '';
              const providerId =
                typeof persistedHold['calendar_account_id'] === 'string'
                  ? persistedHold['calendar_account_id']
                  : providerHoldId.split(':')[0];
              const provider = providerId ? this.providers.get(providerId) : undefined;

              if (provider && providerHoldId) {
                await provider.releaseProvisionalHold(providerHoldId);
              }

              await this.supabase
                .from('provisional_holds')
                .update({
                  status: 'expired',
                  released_at: new Date().toISOString(),
                })
                .eq('id', holdId);
            }
          }
        }
      } catch (error) {
        console.warn(`Failed to release expired selection hold ${holdId}:`, error);
      } finally {
        this.removeSelectionHoldReferences(holdId);
        this.clearAvailabilityCache();
      }
    }, msUntilExpiry);

    this.selectionHoldTimers.set(holdId, timeout);
  }

  /**
   * Generate cache key for availability query
   */
  private generateCacheKey(options: GetAvailableSlotsOptions): string {
    return `${options.startDate.toISOString()}_${options.endDate.toISOString()}_${options.durationMinutes}`;
  }

  /**
   * Cache availability results
   */
  private cacheAvailability(cacheKey: string, slots: TimeSlot[]): void {
    const now = new Date();
    this.availabilityCache.set(cacheKey, {
      slots,
      cachedAt: now,
      expiresAt: new Date(now.getTime() + this.cacheTTLMinutes * 60 * 1000),
    });
  }

  /**
   * Clear all availability cache
   */
  private clearAvailabilityCache(): void {
    this.availabilityCache.clear();
    console.log('Availability cache cleared');
  }

  /**
   * Public cache invalidation hook for admin-side schedule updates
   */
  public invalidateAvailabilityCache(): void {
    this.clearAvailabilityCache();
  }

  /**
   * Filter slots by blackout periods
   * Removes any slots that overlap with active blackout periods
   */
  private async filterByBlackouts(
    slots: TimeSlot[],
    userEmail: string,
    startDate: Date,
    endDate: Date
  ): Promise<TimeSlot[]> {
    try {
      // Fetch active blackout periods for this user in the date range
      const { data: blackouts, error } = await this.supabase
        .from('blackout_periods')
        .select('*')
        .eq('user_email', userEmail)
        .eq('is_active', true)
        .lte('start_time', endDate.toISOString())
        .gte('end_time', startDate.toISOString());

      if (error) {
        console.error('Failed to fetch blackout periods:', error);
        // On error, return all slots (fail open to avoid blocking bookings)
        return slots;
      }

      if (!blackouts || blackouts.length === 0) {
        // No blackouts, return all slots
        return slots;
      }

      const validBlackouts = blackouts.filter((blackout) => {
        const blackoutStart = new Date(blackout.start_time);
        const blackoutEnd = new Date(blackout.end_time);
        const hasValidDates =
          !Number.isNaN(blackoutStart.getTime()) &&
          !Number.isNaN(blackoutEnd.getTime()) &&
          blackoutEnd > blackoutStart;
        const plausibleRange =
          blackoutStart.getUTCFullYear() >= 2000 &&
          blackoutEnd.getUTCFullYear() >= 2000;

        if (!hasValidDates || !plausibleRange) {
          console.warn(
            `Ignoring invalid blackout period ${blackout.id ?? 'unknown'} for ${userEmail}`
          );
          return false;
        }

        return true;
      });

      if (validBlackouts.length === 0) {
        return slots;
      }

      console.log(`Filtering ${slots.length} slots by ${validBlackouts.length} blackout period(s)`);

      // Filter out slots that overlap with any blackout period
      const filteredSlots = slots.filter((slot) => {
        // Check if this slot overlaps with any blackout
        const hasOverlap = validBlackouts.some((blackout) => {
          const blackoutStart = new Date(blackout.start_time);
          const blackoutEnd = new Date(blackout.end_time);

          // Slots overlap if: slot_start < blackout_end AND slot_end > blackout_start
          return slot.start < blackoutEnd && slot.end > blackoutStart;
        });

        // Keep slot if it does NOT overlap with any blackout
        return !hasOverlap;
      });

      console.log(`${filteredSlots.length} slots remain after blackout filtering`);

      return filteredSlots;
    } catch (error) {
      console.error('Error filtering by blackouts:', error);
      // On error, return all slots (fail open)
      return slots;
    }
  }

  /**
   * Filter slots by working hours
   * Removes any slots that fall outside defined working hours
   */
  private async filterByWorkingHours(
    slots: TimeSlot[],
    userEmail: string
  ): Promise<TimeSlot[]> {
    try {
      // Fetch working hours for this user
      const { data: workingHours, error } = await this.supabase
        .from('working_hours')
        .select('*')
        .eq('user_email', userEmail)
        .eq('is_active', true);

      if (error) {
        console.error('Failed to fetch working hours:', error);
        // On error, return all slots (fail open)
        return slots;
      }

      if (!workingHours || workingHours.length === 0) {
        // No working hours defined, return all slots
        return slots;
      }

      console.log(`Filtering ${slots.length} slots by working hours`);

      // Create a map of day_of_week -> working hours
      const workingHoursMap = new Map<number, { start: string; end: string; timezone: string }>();
      workingHours.forEach((wh) => {
        workingHoursMap.set(wh.day_of_week, {
          start: wh.start_time,
          end: wh.end_time,
          timezone: wh.timezone || 'America/New_York',
        });
      });

      // Filter slots that fall within working hours
      const filteredSlots = slots.filter((slot) => {
        // Try each configured working-hours row in its own timezone
        for (const hoursForDay of workingHoursMap.values()) {
          const localStart = this.getLocalDateParts(slot.start, hoursForDay.timezone);
          const localEnd = this.getLocalDateParts(slot.end, hoursForDay.timezone);

          // Find the matching row for the slot's local weekday in that timezone
          if (!workingHoursMap.has(localStart.dayOfWeek)) {
            continue;
          }

          const matchingHours = workingHoursMap.get(localStart.dayOfWeek);

          if (!matchingHours) {
            continue;
          }

          const isWithinWorkingHours =
            localStart.time >= matchingHours.start && localEnd.time <= matchingHours.end;

          if (isWithinWorkingHours) {
            return true;
          }
        }

        // No matching working-hours window in the configured timezone(s)
        return false;
      });

      console.log(`${filteredSlots.length} slots remain after working hours filtering`);

      return filteredSlots;
    } catch (error) {
      console.error('Error filtering by working hours:', error);
      // On error, return all slots (fail open)
      return slots;
    }
  }
}
