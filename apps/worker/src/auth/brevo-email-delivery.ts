import type { EmailDeliveryPort, SecurityEmailMessage } from "./email-delivery-port.ts";
import { PermanentWorkerError, RetryableWorkerError } from "../runtime/errors.ts";

const BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;

export interface BrevoEmailConfig {
  readonly apiKey: string;
  readonly senderEmail: string;
  readonly senderName: string;
  readonly timeoutMs: number;
}

interface RenderedSecurityEmail {
  readonly subject: string;
  readonly textContent: string;
  readonly htmlContent: string;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function requiredStringParameter(message: SecurityEmailMessage, key: string): string {
  const value = message.parameters[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new PermanentWorkerError("EMAIL_TEMPLATE_PARAMETER_MISSING");
  }
  return value;
}

function requiredPositiveIntegerParameter(message: SecurityEmailMessage, key: string): number {
  const value = message.parameters[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new PermanentWorkerError("EMAIL_TEMPLATE_PARAMETER_MISSING");
  }
  return value;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function emailShell(title: string, bodyHtml: string): string {
  return [
    "<!doctype html>",
    '<html><body style="margin:0;background:#15111a;color:#f7eef3;font-family:Arial,sans-serif;">',
    '<div style="max-width:560px;margin:0 auto;padding:32px 20px;">',
    '<div style="font-size:24px;font-weight:700;margin-bottom:24px;">Shawtie pls</div>',
    '<div style="background:#211b27;border:1px solid #3a3043;border-radius:16px;padding:24px;">',
    '<h1 style="font-size:22px;margin:0 0 16px;">' + escapeHtml(title) + "</h1>",
    bodyHtml,
    "</div>",
    '<p style="font-size:12px;color:#b9aebb;margin-top:18px;">This is an automated security email from Shawtie pls.</p>',
    "</div></body></html>",
  ].join("");
}

function purposeTitle(purpose: string): string {
  switch (purpose) {
    case "registration":
      return "Verify your Shawtie pls email";
    case "email_change":
      return "Verify your new Shawtie pls email";
    case "password_recovery":
      return "Reset your Shawtie pls password";
    case "account_recovery":
      return "Recover your Shawtie pls account";
    default:
      throw new PermanentWorkerError("EMAIL_TEMPLATE_PARAMETER_INVALID");
  }
}

function optionalDeadline(message: SecurityEmailMessage): string | null {
  const raw = message.parameters.deadline;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    throw new PermanentWorkerError("EMAIL_TEMPLATE_PARAMETER_INVALID");
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new PermanentWorkerError("EMAIL_TEMPLATE_PARAMETER_INVALID");
  }
  return parsed.toISOString();
}

function simpleSecurityEmail(
  subject: string,
  body: string,
  deadline: string | null = null,
): RenderedSecurityEmail {
  const deadlineText = deadline ? "\n\nRelevant deadline: " + deadline : "";
  const deadlineHtml = deadline
    ? '<p style="line-height:1.6;"><strong>Relevant deadline:</strong> ' +
      escapeHtml(deadline) +
      "</p>"
    : "";
  return {
    subject,
    textContent: body + deadlineText + "\n\nIf this was not expected, review your Shawtie pls account and security settings.",
    htmlContent: emailShell(
      subject,
      '<p style="line-height:1.6;">' +
        escapeHtml(body) +
        "</p>" +
        deadlineHtml +
        '<p style="line-height:1.6;">If this was not expected, review your Shawtie pls account and security settings.</p>',
    ),
  };
}

export function renderSecurityEmail(message: SecurityEmailMessage): RenderedSecurityEmail {
  if (message.template !== "verification_code") {
    throw new PermanentWorkerError("EMAIL_TEMPLATE_UNSUPPORTED");
  }

  const code = requiredStringParameter(message, "code");
  if (!/^\d{8}$/.test(code)) {
    throw new PermanentWorkerError("EMAIL_TEMPLATE_PARAMETER_INVALID");
  }
  const purpose = requiredStringParameter(message, "purpose");
  const expiresAtRaw = requiredStringParameter(message, "expiresAt");
  const expiresAt = new Date(expiresAtRaw);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new PermanentWorkerError("EMAIL_TEMPLATE_PARAMETER_INVALID");
  }
  const expiresInMinutes = requiredPositiveIntegerParameter(message, "expiresInMinutes");
  const title = purposeTitle(purpose);
  const minuteLabel = expiresInMinutes === 1 ? "minute" : "minutes";

  const textContent =
    title +
    "\n\nYour verification code is:\n\n" +
    code +
    "\n\nThis code expires in " +
    expiresInMinutes +
    " " +
    minuteLabel +
    ".\n\nIf you did not request this, you can ignore this email.";

  const htmlContent = emailShell(
    title,
    '<p style="line-height:1.6;">Your verification code is:</p>' +
      '<div style="font-size:30px;font-weight:700;letter-spacing:6px;margin:22px 0;">' +
      escapeHtml(code) +
      "</div>" +
      '<p style="line-height:1.6;">This code expires in ' +
      String(expiresInMinutes) +
      " " +
      minuteLabel +
      ".</p>" +
      '<p style="line-height:1.6;">If you did not request this, you can ignore this email.</p>',
  );

  return { subject: title, textContent, htmlContent };
}

export function renderEmailMessage(message: SecurityEmailMessage): RenderedSecurityEmail {
  if (message.template === "verification_code") return renderSecurityEmail(message);

  switch (message.template) {
    case "password_reset_completed":
      return simpleSecurityEmail(
        "Your Shawtie pls password was reset",
        "The password for your Shawtie pls account was changed successfully.",
      );
    case "email_changed_old_address":
      return simpleSecurityEmail(
        "Your Shawtie pls email was changed",
        "The verified email address on your Shawtie pls account was changed. This notice was sent to the previous address.",
      );
    case "account_deletion_requested":
      return simpleSecurityEmail(
        "Shawtie pls account deletion requested",
        "Account deletion was requested and account access is now suspended during the recovery window.",
        optionalDeadline(message),
      );
    case "partner_account_deletion_started":
      return simpleSecurityEmail(
        "A partner account deletion process started",
        "The account paired with your Shawtie pls partnership entered its deletion recovery window. Shared access follows the in-app lifecycle rules.",
        optionalDeadline(message),
      );
    case "account_permanently_deleted":
      return simpleSecurityEmail(
        "Your Shawtie pls account was permanently deleted",
        "The account deletion recovery period ended and the account was permanently deleted.",
        optionalDeadline(message),
      );
    case "breakup_started":
      return simpleSecurityEmail(
        "A Shawtie pls breakup process started",
        "Your partnership entered the breakup-pending state. Open Shawtie pls for the current authoritative status and available actions.",
        optionalDeadline(message),
      );
    case "restoration_requested":
      return simpleSecurityEmail(
        "Partnership restoration was requested",
        "A restoration request was submitted for your Shawtie pls partnership. Open the app for the current authoritative status.",
        optionalDeadline(message),
      );
    case "partnership_restored":
      return simpleSecurityEmail(
        "Your Shawtie pls partnership was restored",
        "The partnership is active again.",
      );
    case "breakup_deadline_reminder":
      return simpleSecurityEmail(
        "Shawtie pls breakup deadline reminder",
        "Your partnership remains in breakup-pending state and its destructive deadline is approaching.",
        optionalDeadline(message),
      );
    case "partnership_dissolved":
      return simpleSecurityEmail(
        "Your Shawtie pls partnership ended",
        "The partnership reached final dissolution. Shared partnership data follows the product deletion rules.",
        optionalDeadline(message),
      );
    case "partner_account_deleted":
      return simpleSecurityEmail(
        "Your former partner account was deleted",
        "The other account in your Shawtie pls partnership was permanently deleted and the partnership ended.",
        optionalDeadline(message),
      );
    default:
      throw new PermanentWorkerError("EMAIL_TEMPLATE_UNSUPPORTED");
  }
}

async function brevoErrorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { code?: unknown };
    return typeof body.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

export class BrevoEmailDelivery implements EmailDeliveryPort {
  readonly #config: BrevoEmailConfig;
  readonly #fetch: FetchLike;

  constructor(config: BrevoEmailConfig, fetchImpl: FetchLike = fetch) {
    this.#config = config;
    this.#fetch = fetchImpl;
  }

  async sendSecurityEmail(message: SecurityEmailMessage, signal: AbortSignal): Promise<void> {
    const rendered = renderEmailMessage(message);
    const timeoutSignal = AbortSignal.timeout(this.#config.timeoutMs);
    const requestSignal = AbortSignal.any([signal, timeoutSignal]);

    let response: Response;
    try {
      response = await this.#fetch(BREVO_SEND_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "api-key": this.#config.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sender: {
            email: this.#config.senderEmail,
            name: this.#config.senderName,
          },
          to: [{ email: message.destination }],
          subject: rendered.subject,
          htmlContent: rendered.htmlContent,
          tags: [message.template === "verification_code" ? "shawtie-auth" : "shawtie-security"],
          headers: {
            idempotencyKey: message.deliveryId,
            "X-Shawtie-Delivery-ID": message.deliveryId,
          },
        }),
        signal: requestSignal,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      if (timeoutSignal.aborted) throw new RetryableWorkerError("BREVO_TIMEOUT");
      throw new RetryableWorkerError("BREVO_NETWORK_FAILURE");
    }

    if (response.ok) return;

    if (response.status === 400 && (await brevoErrorCode(response)) === "duplicate_parameter") {
      return;
    }

    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      throw new RetryableWorkerError("BREVO_TEMPORARY_FAILURE");
    }
    throw new PermanentWorkerError("BREVO_DELIVERY_REJECTED");
  }
}

function configuredTimeout(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_TIMEOUT_MS;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || String(value) !== raw || value < 1_000 || value > MAX_TIMEOUT_MS) {
    throw new Error("BREVO_TIMEOUT_MS must be an integer from 1000 to 30000");
  }
  return value;
}

function looksLikeEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

export function brevoEmailConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BrevoEmailConfig | null {
  const production = env.NODE_ENV === "production";
  const provider = env.EMAIL_PROVIDER?.trim().toLowerCase() || "disabled";
  if (provider === "disabled") {
    if (production) throw new Error("EMAIL_PROVIDER is required in production");
    return null;
  }
  if (provider !== "brevo") throw new Error("EMAIL_PROVIDER must be disabled or brevo");

  const apiKey = env.BREVO_API_KEY?.trim();
  const senderEmail = env.BREVO_SENDER_EMAIL?.trim();
  const senderName = env.BREVO_SENDER_NAME?.trim() || "Shawtie pls";

  if (!apiKey) throw new Error("BREVO_API_KEY is required when EMAIL_PROVIDER=brevo");
  if (!senderEmail || !looksLikeEmail(senderEmail)) {
    throw new Error("BREVO_SENDER_EMAIL must be a valid sender address");
  }
  if (!senderName) throw new Error("BREVO_SENDER_NAME must not be empty");

  return {
    apiKey,
    senderEmail,
    senderName,
    timeoutMs: configuredTimeout(env.BREVO_TIMEOUT_MS),
  };
}

export function emailDeliveryFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): EmailDeliveryPort | null {
  const config = brevoEmailConfigFromEnv(env);
  return config ? new BrevoEmailDelivery(config) : null;
}
