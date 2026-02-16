import { getConfigSection } from '../../../src/config/loader.js';

/**
 * Booking Rules Utility
 * Centralizes scheduling logic and configuration for consistency
 */

/**
 * Get core scheduling configuration
 */
export function getSchedulingConfig() {
    const scheduling = getConfigSection('scheduling');
    const calendar = getConfigSection('calendar');
    const tavus = getConfigSection('tavus');

    return {
        durations: [15, 30, 45],
        defaultDuration: 30,
        slotIntervalMinutes: scheduling.slot_interval_minutes || 60,
        minLeadTimeMinutes: scheduling.min_lead_time_minutes || 30,
        maxSlots: scheduling.max_slots || 12,
        qaBookingWindowHours: scheduling.booking_window_hours || 48,
        defaultBookingWindowDays: calendar.constraints.max_booking_window_days || 60,
        isTavusEnabled: tavus && tavus.enabled === true,
    };
}

/**
 * Get the booking window height (in hours) for a specific duration
 */
export function getBookingWindowHours(durationMinutes: number): number {
    const config = getSchedulingConfig();

    // Rule: 48-hour window is specific to 15-min Q&A
    if (durationMinutes === 15) {
        return config.qaBookingWindowHours;
    }

    // Otherwise use the default calendar constraint (converted to hours)
    return config.defaultBookingWindowDays * 24;
}

/**
 * Validate requested duration against allowed values and Tavus status
 */
export function validateDuration(durationMinutes: number): { valid: boolean; error?: string } {
    const config = getSchedulingConfig();

    if (!config.durations.includes(durationMinutes)) {
        return {
            valid: false,
            error: `Invalid duration. Allowed values: ${config.durations.join(', ')} minutes.`,
        };
    }

    // Tavus specific rule: 15 minute calls require Tavus to be enabled
    if (durationMinutes === 15 && !config.isTavusEnabled) {
        return {
            valid: false,
            error: '15-minute Q&A sessions are currently unavailable (Requires Tavus integration).',
        };
    }

    return { valid: true };
}
