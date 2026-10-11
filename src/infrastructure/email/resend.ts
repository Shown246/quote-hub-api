import { Resend } from "resend";
import { env } from "../../app/config/env";
import { logger } from "../logging/logger";

function getResendClient(): Resend | null {
  if (env.RESEND_API_KEY) {
    return new Resend(env.RESEND_API_KEY);
  }
  return null;
}

export async function sendVerificationEmail(to: string, url: string): Promise<boolean> {
  const client = getResendClient();
  if (!client) {
    logger.info({ to, url }, "Simulating verification email delivery (RESEND_API_KEY not configured)");
    return true;
  }

  try {
    const { error } = await client.emails.send({
      from: env.EMAIL_FROM || "noreply@quote-hub.local",
      to,
      subject: "Verify your Quote-Hub account",
      html: `<p>Welcome to Quote-Hub! Please verify your email by clicking <a href="${url}">here</a>.</p>`,
    });

    if (error) {
      logger.error({ error, to }, "Failed to send verification email via Resend");
      return false;
    }

    return true;
  } catch (err) {
    logger.error({ err, to }, "Failed to send verification email via Resend");
    return false;
  }
}

export async function sendPasswordResetEmail(to: string, url: string): Promise<boolean> {
  const client = getResendClient();
  if (!client) {
    logger.info({ to, url }, "Simulating password reset email delivery (RESEND_API_KEY not configured)");
    return true;
  }

  try {
    const { error } = await client.emails.send({
      from: env.EMAIL_FROM || "noreply@quote-hub.local",
      to,
      subject: "Reset your Quote-Hub password",
      html: `<p>You requested a password reset. Click <a href="${url}">here</a> to set a new password.</p>`,
    });

    if (error) {
      logger.error({ error, to }, "Failed to send password reset email via Resend");
      return false;
    }

    return true;
  } catch (err) {
    logger.error({ err, to }, "Failed to send password reset email via Resend");
    return false;
  }
}
