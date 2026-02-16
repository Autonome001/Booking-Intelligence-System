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

interface AvailabilityCacheEntry {
  slots: TimeSlot[];
  cachedAt: Date;
  expiresAt: Date;
}

export class CalendarService {
  private providers: Map<string, ICalendarProvider> = new Map();
  private availabilityCache: Map<string, AvailabilityCacheEntry> = new Map();
  private cacheTTLMinutes = 15; // Configurable via YAML in production

  constructor(
    private supabase: SupabaseClient,
    private googleConfig: GoogleCalendarConfig
  ) { }

  /**
   * Initialize all active calendar providers from database
   */
  async initializeProviders(): Promise<void> {
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

    console.log(`Initializing ${accounts.length} calendar provider(s)...`);

    for (const account of accounts as CalendarAccount[]) {
      try {
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
    const userEmail = Array.from(this.providers.values())[0]?.providerId || 'dev@autonome.us';
    const filteredByBlackouts = await this.filterByBlackouts(intersectedSlots, userEmail, options.startDate, options.endDate);
    const finalSlots = await this.filterByWorkingHours(filteredByBlackouts, userEmail);

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

      console.log(`Filtering ${slots.length} slots by ${blackouts.length} blackout period(s)`);

      // Filter out slots that overlap with any blackout period
      const filteredSlots = slots.filter((slot) => {
        // Check if this slot overlaps with any blackout
        const hasOverlap = blackouts.some((blackout) => {
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
      const workingHoursMap = new Map<number, { start: string; end: string }>();
      workingHours.forEach((wh) => {
        workingHoursMap.set(wh.day_of_week, {
          start: wh.start_time,
          end: wh.end_time,
        });
      });

      // Filter slots that fall within working hours
      const filteredSlots = slots.filter((slot) => {
        const dayOfWeek = slot.start.getDay(); // 0=Sunday, 1=Monday, etc.

        // Check if there are working hours defined for this day
        const hoursForDay = workingHoursMap.get(dayOfWeek);

        if (!hoursForDay) {
          // No working hours for this day = day off, exclude slot
          return false;
        }

        // Extract time components from slot
        const slotStartTime = slot.start.toTimeString().slice(0, 8); // "HH:MM:SS"
        const slotEndTime = slot.end.toTimeString().slice(0, 8);

        // Check if slot falls within working hours
        // Slot is valid if: slot_start >= working_start AND slot_end <= working_end
        const isWithinWorkingHours =
          slotStartTime >= hoursForDay.start && slotEndTime <= hoursForDay.end;

        return isWithinWorkingHours;
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
