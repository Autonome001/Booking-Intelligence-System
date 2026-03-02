import { describe, expect, it } from '@jest/globals';
import { calculateAvailabilityResponseLimit } from './availability-response-limit.js';

describe('calculateAvailabilityResponseLimit', () => {
  it('expands the response cap to cover a full 7-day public window', () => {
    const startDate = new Date('2026-03-04T14:00:00.000Z');
    const endDate = new Date('2026-03-11T14:00:00.000Z');

    expect(calculateAvailabilityResponseLimit(startDate, endDate, 60, 12)).toBe(168);
  });

  it('never returns less than the configured minimum cap', () => {
    const startDate = new Date('2026-03-04T14:00:00.000Z');
    const endDate = new Date('2026-03-04T15:00:00.000Z');

    expect(calculateAvailabilityResponseLimit(startDate, endDate, 60, 12)).toBe(12);
  });
});
