import nodemailer, { type Transporter } from "nodemailer";
import { getServerEnv } from "@/lib/env";

let transporter: Transporter | null | undefined;

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;
  const env = getServerEnv();
  if (!env.SMTP_HOST) {
    transporter = null;
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth:
      env.SMTP_USER && env.SMTP_PASSWORD
        ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
        : undefined,
  });
  return transporter;
}

export async function sendPasswordResetEmail(input: {
  to: string;
  displayName: string;
  resetUrl: string;
  expiresInMinutes: number;
}): Promise<boolean> {
  const env = getServerEnv();
  const transport = getTransporter();
  if (!transport) return false;

  await transport.sendMail({
    from: env.MAIL_FROM,
    to: input.to,
    subject: "Reset your Nexus Pay password",
    text: [
      `Hi ${input.displayName},`,
      "",
      "We received a request to reset your Nexus Pay password.",
      `Open this link to choose a new password: ${input.resetUrl}`,
      "",
      `This link expires in ${input.expiresInMinutes} minutes. If you did not request it, you can ignore this email.`,
      "",
      "Nexus Pay",
    ].join("\n"),
    html: `
      <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#111827;max-width:560px;margin:0 auto;padding:32px">
        <p style="font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;font-weight:600">Nexus Pay</p>
        <h1 style="font-size:24px;margin:16px 0 8px">Reset your password</h1>
        <p>Hi ${escapeHtml(input.displayName)},</p>
        <p>We received a request to reset your Nexus Pay password. Choose a new password using the button below.</p>
        <p style="margin:28px 0">
          <a href="${escapeHtml(input.resetUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:12px 22px;border-radius:12px;text-decoration:none;font-weight:600">Choose a new password</a>
        </p>
        <p style="color:#4b5563;font-size:14px">This link expires in ${input.expiresInMinutes} minutes. If you did not request it, you can safely ignore this email.</p>
      </div>
    `,
  });

  return true;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
