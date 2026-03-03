import type { Resend } from 'resend';
import { getServiceConfig } from '../../utils/config.js';
import { logger } from '../../utils/logger.js';

export interface SendTransactionalEmailOptions {
  emailService: Resend;
  to: string[];
  subject: string;
  text: string;
  context: string;
}

export interface SendTransactionalEmailResult {
  fromAddress: string;
  messageId: string | null;
}

export function getEmailErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }

  return 'Unknown email send error';
}

export async function sendTransactionalEmail(
  options: SendTransactionalEmailOptions
): Promise<SendTransactionalEmailResult> {
  const emailConfig = getServiceConfig('email');
  const configuredFromAddress = emailConfig.fromAddress?.trim();
  const fromAddress =
    configuredFromAddress?.toLowerCase() === 'bookings@autonome.us'
      ? 'booking@autonome.us'
      : configuredFromAddress;

  if (!fromAddress || !fromAddress.includes('@')) {
    throw new Error('EMAIL_FROM_ADDRESS is missing or invalid');
  }

  const sendResult = await options.emailService.emails.send({
    from: fromAddress,
    to: options.to,
    subject: options.subject,
    text: options.text,
    replyTo: fromAddress,
  });

  if (sendResult.error) {
    const errorMessage = getEmailErrorMessage(sendResult.error);
    logger.error(`Transactional email rejected by Resend (${options.context})`, {
      error: sendResult.error,
      recipientCount: options.to.length,
      fromAddress,
    });
    throw new Error(errorMessage);
  }

  return {
    fromAddress,
    messageId: sendResult.data?.id || null,
  };
}
