export interface SecurityEmailMessage {
  readonly deliveryId: string;
  readonly destination: string;
  readonly template: string;
  readonly parameters: Readonly<Record<string, string | number | boolean | null>>;
}

export type AuthVerificationPurpose =
  "registration" | "email_change" | "password_recovery" | "account_recovery";

export interface VerificationCodeEmailMessage extends SecurityEmailMessage {
  readonly template: "verification_code";
  readonly parameters: Readonly<{
    code: string;
    purpose: AuthVerificationPurpose;
    expiresAt: string;
    expiresInMinutes: number;
  }>;
}

export interface EmailDeliveryPort {
  sendSecurityEmail(message: SecurityEmailMessage, signal: AbortSignal): Promise<void>;
}
