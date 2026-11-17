import { z } from "zod";
import {
  EXPENSE_CATEGORIES,
  GROUP_CATEGORIES,
  HISTORY_FILTERS,
  HISTORY_SORTS,
  MAX_FUNDING_MINOR,
  MAX_PAYMENT_DESCRIPTION_LENGTH,
  MAX_PAYMENT_MINOR,
  MIN_FUNDING_MINOR,
  MIN_PAYMENT_MINOR,
  PAYMENT_REQUEST_STATUSES,
  SPLIT_METHODS,
  SUPPORTED_CURRENCIES,
  SUPPORTED_LANGUAGES,
} from "@nexus/shared-types";

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

export const clientRequestIdSchema = z
  .string({ required_error: "A payment request reference is required" })
  .trim()
  .uuid("The payment request reference is invalid");

export const fundingRequestSchema = z.object({
  clientRequestId: clientRequestIdSchema,
  amountMinor: z
    .number({ required_error: "Enter an amount" })
    .int("Amounts must be whole paise")
    .min(MIN_FUNDING_MINOR, "The minimum simulated funding amount is ₹1.00")
    .max(MAX_FUNDING_MINOR, "The maximum simulated funding amount is ₹1,00,000.00"),
});

export const sendPaymentSchema = z.object({
  clientRequestId: clientRequestIdSchema,
  recipientToken: z
    .string({ required_error: "Choose a recipient" })
    .trim()
    .min(20, "Choose a recipient")
    .max(1024, "The recipient reference is invalid"),
  amountMinor: z
    .number({ required_error: "Enter an amount" })
    .int("Amounts must be whole paise")
    .min(MIN_PAYMENT_MINOR, "The minimum payment amount is ₹1.00")
    .max(MAX_PAYMENT_MINOR, "The maximum payment amount is ₹1,00,000.00"),
  description: z
    .string()
    .trim()
    .max(MAX_PAYMENT_DESCRIPTION_LENGTH, "Keep the note under 140 characters")
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export const recipientSearchSchema = z.object({
  q: z
    .string({ required_error: "Enter a username, email address or mobile number" })
    .trim()
    .min(3, "Enter at least 3 characters")
    .max(254, "Search text is too long"),
});

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), "Use a valid date");

export const historyQuerySchema = z
  .object({
    filter: z.enum(HISTORY_FILTERS).default("ALL"),
    sort: z.enum(HISTORY_SORTS).default("newest"),
    search: z.string().trim().max(80, "Search text is too long").optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: "The start date must be on or before the end date",
    path: ["from"],
  });

export type FundingRequestInput = z.infer<typeof fundingRequestSchema>;
export type SendPaymentInput = z.infer<typeof sendPaymentSchema>;
export type RecipientSearchInput = z.infer<typeof recipientSearchSchema>;
export type HistoryQueryInput = z.infer<typeof historyQuerySchema>;

// ---------------------------------------------------------------------------
// Release 3 — social payments
// ---------------------------------------------------------------------------

const socialQuery = z
  .string({ required_error: "Enter a username, email address or mobile number" })
  .trim()
  .min(3, "Enter at least 3 characters")
  .max(254, "Search text is too long");

const minorAmount = (label: string) =>
  z
    .number({ required_error: `Enter the ${label}` })
    .int(`${label} must be a whole number of paise`)
    .min(1, `${label} must be greater than zero`)
    .max(10_000_000, `${label} is above the sandbox limit`);

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), "Use a valid date");

export const contactCreateSchema = z.object({
  query: socialQuery,
  displayLabel: z.string().trim().min(1).max(60).optional(),
});

export const requestCreateSchema = z.object({
  payerQuery: socialQuery,
  amountMinor: minorAmount("request amount"),
  currency: z.literal("INR").default("INR"),
  description: z.string().trim().max(200).optional(),
  dueAt: z.string().datetime().optional(),
  groupId: z.string().trim().max(64).optional(),
  expenseId: z.string().trim().max(64).optional(),
});

export const requestListQuerySchema = z.object({
  direction: z.enum(["received", "sent"]).default("received"),
  status: z.enum(PAYMENT_REQUEST_STATUSES).optional(),
  sort: z.enum(["newest", "oldest"]).default("newest"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export const groupCreateSchema = z.object({
  name: z.string().trim().min(2, "Give the group a name").max(80),
  description: z.string().trim().max(400).optional(),
  category: z.enum(GROUP_CATEGORIES).default("OTHER"),
  imageUrl: z.string().trim().url().max(2048).optional(),
  memberQueries: z.array(socialQuery).max(20).default([]),
});

export const groupUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(400).nullable().optional(),
    category: z.enum(GROUP_CATEGORIES).optional(),
    imageUrl: z.string().trim().url().max(2048).nullable().optional(),
    archived: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");

export const groupMemberSchema = z.object({ query: socialQuery });

export const expenseParticipantSchema = z.object({
  userId: z.string().trim().min(1).max(64),
  amountMinor: z.number().int().min(0).max(10_000_000).optional(),
  percentage: z.number().int().min(0).max(100).optional(),
  shares: z.number().int().min(0).max(10_000).optional(),
});

export const expenseCreateSchema = z.object({
  title: z.string().trim().min(2, "Give the expense a title").max(120),
  description: z.string().trim().max(400).optional(),
  totalAmountMinor: minorAmount("expense amount"),
  category: z.enum(EXPENSE_CATEGORIES).default("OTHER"),
  expenseDate: isoDate,
  paidByUserId: z.string().trim().min(1).max(64),
  splitMethod: z.enum(SPLIT_METHODS),
  notes: z.string().trim().max(400).optional(),
  participants: z.array(expenseParticipantSchema).min(1, "Select at least one participant").max(50),
});

export const expenseUpdateSchema = z.object({
  title: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(400).nullable().optional(),
  totalAmountMinor: minorAmount("expense amount").optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  expenseDate: isoDate.optional(),
  paidByUserId: z.string().trim().min(1).max(64).optional(),
  splitMethod: z.enum(SPLIT_METHODS).optional(),
  notes: z.string().trim().max(400).nullable().optional(),
  participants: z.array(expenseParticipantSchema).min(1).max(50).optional(),
  reason: z.string().trim().min(3).max(200).default("Expense updated"),
});

export const settlementCreateSchema = z.object({
  payeeUserId: z.string().trim().min(1).max(64),
  amountMinor: minorAmount("settlement amount"),
  clientRequestId: clientRequestIdSchema,
  description: z.string().trim().max(140).optional(),
});

export const notificationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export type ContactCreateInput = z.infer<typeof contactCreateSchema>;
export type RequestCreateInput = z.infer<typeof requestCreateSchema>;
export type RequestListQueryInput = z.infer<typeof requestListQuerySchema>;
export type GroupCreateInput = z.infer<typeof groupCreateSchema>;
export type GroupUpdateInput = z.infer<typeof groupUpdateSchema>;
export type GroupMemberInput = z.infer<typeof groupMemberSchema>;
export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>;
export type ExpenseUpdateInput = z.infer<typeof expenseUpdateSchema>;
export type SettlementCreateInput = z.infer<typeof settlementCreateSchema>;
export type NotificationListQueryInput = z.infer<typeof notificationListQuerySchema>;
