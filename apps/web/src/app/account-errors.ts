import { ApiClientError } from "../lib/api-client.ts";

/** Plain wording for account and security error codes. Shared by sign-in and Us. */
export function accountMessageFor(error: unknown): string {
  if (error instanceof ApiClientError) {
    const known: Record<string, string> = {
      AGE_INELIGIBLE: "You must be at least 18 years old.",
      AUTH_INVALID: "The email/username or password is incorrect.",
      AUTH_REQUIRED: "Please sign in again.",
      CONFLICT: "The account changed while this request was running. Try again.",
      DOB_CORRECTION_ALREADY_USED: "The date-of-birth correction was already used.",
      EMAIL_CHALLENGE_EXPIRED: "That verification code expired. Request a new one.",
      EMAIL_CHALLENGE_INVALID: "That verification code is invalid.",
      EMAIL_UNAVAILABLE: "That email address cannot be used.",
      PASSWORD_COMMON: "Choose a less common password.",
      PASSWORD_TOO_LONG: "That password is too long.",
      PASSWORD_TOO_SHORT: "Use at least 15 characters.",
      RATE_LIMITED: "Too many attempts. Try again later.",
      REAUTH_REQUIRED: "Re-enter your password before this security-sensitive change.",
      USERNAME_CHANGE_NOT_ALLOWED: "The username cannot be changed right now.",
      USERNAME_INVALID: "Use 3-30 letters, numbers, dots, or underscores.",
      USERNAME_RESERVED: "That username is reserved.",
      USERNAME_UNAVAILABLE: "That username is unavailable.",
    };
    return known[error.code] ?? error.code.replaceAll("_", " ").toLowerCase();
  }
  return "Something went wrong.";
}
