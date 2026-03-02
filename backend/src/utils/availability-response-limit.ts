export function calculateAvailabilityResponseLimit(
  startDate: Date,
  endDate: Date,
  slotIntervalMinutes: number,
  configuredMaxSlots: number
): number {
  const effectiveIntervalMinutes = Math.max(1, slotIntervalMinutes || 60);
  const configuredLimit = Math.max(1, configuredMaxSlots || 0);
  const windowMs = Math.max(0, endDate.getTime() - startDate.getTime());

  if (windowMs === 0) {
    return configuredLimit;
  }

  const windowBasedLimit = Math.ceil(
    windowMs / (effectiveIntervalMinutes * 60 * 1000)
  );

  return Math.max(configuredLimit, windowBasedLimit);
}
