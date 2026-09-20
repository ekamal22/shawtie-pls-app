import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const password = z.string().min(1).max(1024);
const email = z.string().trim().min(3).max(254);
const username = z.string().trim().min(1).max(128);
const code = z.string().regex(/^\d{8}$/);
const uuid = z.string().uuid();

export const registrationStartSchema = z.object({
  username,
  displayName: z.string().trim().min(1).max(80),
  dateOfBirth: isoDate,
  email,
  password,
});

export const registrationVerifySchema = z.object({
  registrationIntentId: uuid,
  code,
  deviceName: z.string().trim().min(1).max(80).optional(),
});

export const registrationResendSchema = z.object({
  registrationIntentId: uuid,
});

export const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  password,
  deviceName: z.string().trim().min(1).max(80).optional(),
});

export const recoveryStartSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
});

export const passwordRecoveryCompleteSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  code,
  newPassword: password,
});

export const accountRecoveryCompleteSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  code,
});

export const reauthenticateSchema = z.object({ password });

export const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
});

export const emailChangeStartSchema = z.object({ email });
export const emailChangeCompleteSchema = z.object({ code });
export const usernameChangeSchema = z.object({ username });
export const dateOfBirthCorrectionSchema = z.object({ dateOfBirth: isoDate });
export const deviceRenameSchema = z.object({ displayName: z.string().trim().min(1).max(80) });
export const deviceIdParamsSchema = z.object({ deviceId: uuid });

export type RegistrationStartInput = z.infer<typeof registrationStartSchema>;
export type RegistrationVerifyInput = z.infer<typeof registrationVerifySchema>;
export type RegistrationResendInput = z.infer<typeof registrationResendSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RecoveryStartInput = z.infer<typeof recoveryStartSchema>;
export type PasswordRecoveryCompleteInput = z.infer<typeof passwordRecoveryCompleteSchema>;
export type AccountRecoveryCompleteInput = z.infer<typeof accountRecoveryCompleteSchema>;
export type ReauthenticateInput = z.infer<typeof reauthenticateSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type EmailChangeStartInput = z.infer<typeof emailChangeStartSchema>;
export type EmailChangeCompleteInput = z.infer<typeof emailChangeCompleteSchema>;
export type UsernameChangeInput = z.infer<typeof usernameChangeSchema>;
export type DateOfBirthCorrectionInput = z.infer<typeof dateOfBirthCorrectionSchema>;
export type DeviceRenameInput = z.infer<typeof deviceRenameSchema>;
