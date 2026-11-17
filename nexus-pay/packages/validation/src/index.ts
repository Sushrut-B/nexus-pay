import { z } from "zod";
import { SUPPORTED_CURRENCIES, SUPPORTED_LANGUAGES } from "@nexus/shared-types";

export const EMAIL_MAX_LENGTH = 254;
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 24;
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Normalises Indian and international numbers to E.164. A bare 10 digit number
 * is treated as an Indian mobile number and prefixed with +91.
 */
export function normalizePhoneNumber(value: string): string {
  const compact = value.trim().replace(/[\s()\-.]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(compact)) {
    return compact;
  }
  if (/^91[6-9]\d{9}$/.test(compact)) {
    return `+${compact}`;
  }
  if (/^[6-9]\d{9}$/.test(compact)) {
    return `+91${compact}`;
  }
  return compact;
}

const emailField = z
  .string({ required_error: "Email address is required" })
  .trim()
  .min(1, "Email address is required")
  .max(EMAIL_MAX_LENGTH, "Email address is too long")
  .email("Enter a valid email address")
  .transform(normalizeEmail);

const usernameField = z
  .string({ required_error: "Username is required" })
  .trim()
  .min(USERNAME_MIN_LENGTH, `Username must be at least ${USERNAME_MIN_LENGTH} characters`)
  .max(USERNAME_MAX_LENGTH, `Username must be at most ${USERNAME_MAX_LENGTH} characters`)
  .regex(/^[a-zA-Z0-9_]+$/, "Use only letters, numbers and underscores")
  .transform(normalizeUsername);

const phoneField = z
  .string({ required_error: "Mobile number is required" })
  .trim()
  .min(1, "Mobile number is required")
  .transform(normalizePhoneNumber)
  .refine((value) => /^\+[1-9]\d{7,14}$/.test(value), "Enter a valid mobile number");

export const passwordSchema = z
  .string({ required_error: "Password is required" })
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`)
  .regex(/[a-z]/, "Include at least one lowercase letter")
  .regex(/[A-Z]/, "Include at least one uppercase letter")
  .regex(/[0-9]/, "Include at least one number")
  .regex(/[^A-Za-z0-9]/, "Include at least one symbol");

export const registerSchema = z
  .object({
    fullName: z
      .string({ required_error: "Full name is required" })
      .trim()
      .min(2, "Enter your full name")
      .max(120, "Full name is too long")
      .regex(/^[\p{L}\p{M}][\p{L}\p{M}\s.'-]*$/u, "Enter a valid name"),
    email: emailField,
    phoneNumber: phoneField,
    username: usernameField,
    password: passwordSchema,
    confirmPassword: z.string({ required_error: "Confirm your password" }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const loginSchema = z.object({
  identifier: z
    .string({ required_error: "Email or username is required" })
    .trim()
    .min(1, "Enter your email address or username")
    .max(EMAIL_MAX_LENGTH, "Email address or username is too long"),
  password: z
    .string({ required_error: "Password is required" })
    .min(1, "Enter your password")
    .max(PASSWORD_MAX_LENGTH, "Password is too long"),
  rememberMe: z.boolean().optional(),
});

export const forgotPasswordSchema = z.object({
  email: emailField,
});

export const resetPasswordSchema = z
  .object({
    token: z
      .string({ required_error: "Reset token is required" })
      .trim()
      .min(20, "Invalid reset link")
      .max(256, "Invalid reset link"),
    password: passwordSchema,
    confirmPassword: z.string({ required_error: "Confirm your password" }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const onboardingSchema = z.object({
  displayName: z
    .string({ required_error: "Display name is required" })
    .trim()
    .min(2, "Display name must be at least 2 characters")
    .max(60, "Display name is too long")
    .regex(/^[\p{L}\p{M}][\p{L}\p{M}\s.'-]*$/u, "Enter a valid display name"),
  username: usernameField,
  preferredCurrency: z.enum(SUPPORTED_CURRENCIES, {
    errorMap: () => ({ message: "Choose a supported currency" }),
  }),
  preferredLanguage: z.enum(SUPPORTED_LANGUAGES, {
    errorMap: () => ({ message: "Choose a supported language" }),
  }),
});

export const profileUpdateSchema = z.object({
  displayName: onboardingSchema.shape.displayName,
  preferredLanguage: onboardingSchema.shape.preferredLanguage,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type OnboardingInput = z.infer<typeof onboardingSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
