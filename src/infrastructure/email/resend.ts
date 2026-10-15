import nodemailer, { type Transporter } from "nodemailer";
import { Resend } from "resend";
import { env } from "../../app/config/env";
import { logger } from "../logging/logger";

function getTransporter(): Transporter | null {
  if (env.SMTP_USER && env.SMTP_PASS) {
    return nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });
  }
  return null;
}

function getResendClient(): Resend | null {
  if (env.RESEND_API_KEY) {
    return new Resend(env.RESEND_API_KEY);
  }
  return null;
}

export async function sendVerificationEmail(to: string, url: string): Promise<boolean> {
  const transporter = getTransporter();
  const resend = getResendClient();

  if (!transporter && !resend) {
    logger.info({ to, url }, "Simulating verification email delivery (No email provider configured)");
    return true;
  }

  if (transporter) {
    try {
      const from =
        env.EMAIL_FROM && !env.EMAIL_FROM.includes("quote-hub.local")
          ? env.EMAIL_FROM
          : `"Quote-Hub" <${env.SMTP_USER}>`;

      const info = await transporter.sendMail({
        from,
        to,
        subject: "Verify your Quote-Hub account",
        html: `<p>Welcome to Quote-Hub! Please verify your email by clicking <a href="${url}">here</a>.</p>`,
      });
      logger.info({ to, messageId: info.messageId }, "Verification email sent successfully via Nodemailer");
      return true;
    } catch (err) {
      logger.error({ err, to }, "Failed to send verification email via Nodemailer");
      return false;
    }
  }

  if (resend) {
    try {
      const { error } = await resend.emails.send({
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

  return false;
}

export async function sendPasswordResetEmail(to: string, url: string): Promise<boolean> {
  const transporter = getTransporter();
  const resend = getResendClient();

  if (!transporter && !resend) {
    logger.info({ to, url }, "Simulating password reset email delivery (No email provider configured)");
    return true;
  }

  if (transporter) {
    try {
      const from =
        env.EMAIL_FROM && !env.EMAIL_FROM.includes("quote-hub.local")
          ? env.EMAIL_FROM
          : `"Quote-Hub" <${env.SMTP_USER}>`;

      await transporter.sendMail({
        from,
        to,
        subject: "Reset your Quote-Hub password",
        html: `<p>You requested a password reset. Click <a href="${url}">here</a> to set a new password.</p>`,
      });
      return true;
    } catch (err) {
      logger.error({ err, to }, "Failed to send password reset email via Nodemailer");
      return false;
    }
  }

  if (resend) {
    try {
      const { error } = await resend.emails.send({
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

  return false;
}