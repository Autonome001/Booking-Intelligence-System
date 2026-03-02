const BOOKING_LINK = 'https://booking.autonome.us/';
const PUBLIC_REPLY_ADDRESS = 'bookings@autonome.us';

export function normalizeCustomerFacingEmailCopy(content: string): string {
  let normalized = content || '';

  normalized = normalized.replace(
    /\[(?:insert|Insert)\s+(?:scheduling\s+)?link\s+here\]/g,
    BOOKING_LINK
  );

  normalized = normalized.replace(
    /\b[A-Z0-9._%+-]+@(?!autonome\.us\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    PUBLIC_REPLY_ADDRESS
  );

  return normalized.trim();
}

export function getPublicBookingLink(): string {
  return BOOKING_LINK;
}

export function getPublicReplyAddress(): string {
  return PUBLIC_REPLY_ADDRESS;
}
