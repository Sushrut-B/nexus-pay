import { z } from "zod";
import {
  ADMIN_ROLES,
  API_SCOPES,
  EXTERNAL_ACCOUNT_TYPES,
  BILLING_FREQUENCIES,
  BUDGET_PERIOD_TYPES,
  CANCELLATION_TIMINGS,
  BUDGET_STATUS,
  CATEGORY_TYPES,
  CHAOS_SCENARIOS,
  CONTRIBUTION_TYPES,
  EXPENSE_CATEGORIES,
  FINANCE_PERIODS,
  GROUP_CATEGORIES,
  HISTORY_FILTERS,
  HISTORY_SORTS,
  INSIGHT_PERIODS,
  MAX_FUNDING_MINOR,
  MERCHANT_TYPES,
  MAX_PAYMENT_DESCRIPTION_LENGTH,
  MAX_PAYMENT_MINOR,
  MIN_FUNDING_MINOR,
  MIN_PAYMENT_MINOR,
  PAYMENT_REQUEST_STATUSES,
  REWARD_ACTIVITY_TYPES,
  REWARD_CAMPAIGN_STATUSES,
  REWARD_CAMPAIGN_TYPES,
  RULE_CONDITION_TYPES,
  SAVINGS_GOAL_STATUSES,
  SCHEDULE_FREQUENCIES,
  SPLIT_METHODS,
  STATEMENT_FORMATS,
  SUPPORTED_CURRENCIES,
  WEBHOOK_EVENT_TYPES,
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

// ---------------------------------------------------------------------------
// Release 4 — personal finance
// ---------------------------------------------------------------------------

const isoDateOptional = isoDate.optional();

export const insightQuerySchema = z.object({
  period: z.enum(INSIGHT_PERIODS).default("month"),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const categorizeSchema = z.object({
  paymentRef: z.string().trim().min(1).max(80),
  categoryId: z.string().trim().min(1).max(64),
  note: z.string().trim().max(200).optional(),
});

export const categoryRuleCreateSchema = z.object({
  conditionType: z.enum(RULE_CONDITION_TYPES),
  conditionValue: z.string().trim().min(1).max(120),
  categoryId: z.string().trim().min(1).max(64),
  priority: z.number().int().min(0).max(1000).default(100),
  isEnabled: z.boolean().default(true),
});

export const categoryRuleUpdateSchema = z
  .object({
    conditionType: z.enum(RULE_CONDITION_TYPES).optional(),
    conditionValue: z.string().trim().min(1).max(120).optional(),
    categoryId: z.string().trim().min(1).max(64).optional(),
    priority: z.number().int().min(0).max(1000).optional(),
    isEnabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");

export const budgetCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    categoryId: z.string().trim().min(1).max(64),
    amountMinor: minorAmount("budget amount"),
    currency: z.literal("INR").default("INR"),
    periodType: z.enum(BUDGET_PERIOD_TYPES),
    startDate: isoDate,
    endDate: isoDateOptional,
    thresholds: z.array(z.number().int().min(1).max(100)).max(10).default([50, 75, 90, 100]),
  })
  .refine((value) => !value.endDate || value.startDate <= value.endDate, {
    message: "The start date must be on or before the end date",
    path: ["startDate"],
  });

export const budgetUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    categoryId: z.string().trim().min(1).max(64).optional(),
    amountMinor: minorAmount("budget amount").optional(),
    periodType: z.enum(BUDGET_PERIOD_TYPES).optional(),
    startDate: isoDate.optional(),
    endDate: isoDateOptional,
    status: z.enum(BUDGET_STATUS).optional(),
    thresholds: z.array(z.number().int().min(1).max(100)).max(10).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");

export const savingsGoalCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  targetAmountMinor: minorAmount("target amount"),
  currency: z.literal("INR").default("INR"),
  targetDate: z.string().datetime().optional(),
  description: z.string().trim().max(400).optional(),
  icon: z.string().trim().max(40).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
});

export const savingsGoalUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    targetAmountMinor: minorAmount("target amount").optional(),
    targetDate: z.string().datetime().nullable().optional(),
    description: z.string().trim().max(400).nullable().optional(),
    icon: z.string().trim().max(40).nullable().optional(),
    status: z.enum(SAVINGS_GOAL_STATUSES).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");

export const contributionCreateSchema = z.object({
  amountMinor: minorAmount("contribution amount"),
  contributionType: z.enum(CONTRIBUTION_TYPES).default("RECORDED"),
  note: z.string().trim().max(200).optional(),
  relatedPaymentRef: z.string().trim().max(80).optional(),
});

export const scheduledPaymentCreateSchema = z
  .object({
    recipientQuery: socialQuery,
    amountMinor: minorAmount("payment amount"),
    currency: z.literal("INR").default("INR"),
    description: z.string().trim().max(200).optional(),
    frequency: z.enum(SCHEDULE_FREQUENCIES),
    startDate: z.string().datetime(),
    endDate: z.string().datetime().optional(),
    maxExecutions: z.number().int().min(1).max(1000).optional(),
  })
  .refine((value) => !value.endDate || value.startDate <= value.endDate, {
    message: "The start date must be on or before the end date",
    path: ["startDate"],
  });

export const scheduledPaymentUpdateSchema = z
  .object({
    amountMinor: minorAmount("payment amount").optional(),
    description: z.string().trim().max(200).nullable().optional(),
    frequency: z.enum(SCHEDULE_FREQUENCIES).optional(),
    endDate: z.string().datetime().nullable().optional(),
    maxExecutions: z.number().int().min(1).max(1000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");

export const statementGenerateSchema = z
  .object({
    format: z.enum(STATEMENT_FORMATS),
    periodStart: isoDate,
    periodEnd: isoDate,
  })
  .refine((value) => value.periodStart <= value.periodEnd, {
    message: "The start date must be on or before the end date",
    path: ["periodStart"],
  });

export const calendarQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
  })
  .refine((value) => value.from <= value.to, {
    message: "The start date must be on or before the end date",
    path: ["from"],
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
export type InsightQueryInput = z.infer<typeof insightQuerySchema>;
export type CategorizeInput = z.infer<typeof categorizeSchema>;
export type CategoryRuleCreateInput = z.infer<typeof categoryRuleCreateSchema>;
export type CategoryRuleUpdateInput = z.infer<typeof categoryRuleUpdateSchema>;
export type BudgetCreateInput = z.infer<typeof budgetCreateSchema>;
export type BudgetUpdateInput = z.infer<typeof budgetUpdateSchema>;
export type SavingsGoalCreateInput = z.infer<typeof savingsGoalCreateSchema>;
export type SavingsGoalUpdateInput = z.infer<typeof savingsGoalUpdateSchema>;
export type ContributionCreateInput = z.infer<typeof contributionCreateSchema>;
export type ScheduledPaymentCreateInput = z.infer<typeof scheduledPaymentCreateSchema>;
export type ScheduledPaymentUpdateInput = z.infer<typeof scheduledPaymentUpdateSchema>;
export type StatementGenerateInput = z.infer<typeof statementGenerateSchema>;
export type CalendarQueryInput = z.infer<typeof calendarQuerySchema>;

// ---------------------------------------------------------------------------
// Release 5 — Nexus Control
// ---------------------------------------------------------------------------

export const adminLoginSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128),
});

export const adminCreateSchema = z.object({
  email: emailField,
  username: usernameField,
  password: passwordSchema,
  role: z.enum(ADMIN_ROLES),
});

export const adminRoleUpdateSchema = z.object({
  role: z.enum(ADMIN_ROLES),
  isActive: z.boolean().optional(),
});

export const chaosInjectSchema = z
  .object({
    nodeId: z.string().trim().regex(/^node-[1-5]$/, "Choose a configured Raftline node"),
    scenario: z.enum(CHAOS_SCENARIOS),
    reason: z.string().trim().min(5, "Provide an incident reference or reason").max(500),
    peer: z.string().trim().max(40).optional(),
    target: z.string().trim().max(80).optional(),
    delayMs: z.number().int().min(0).max(60_000).optional(),
    dropRate: z.number().min(0).max(1).optional(),
  })
  .refine((value) => value.scenario !== "CUSTOM" || Boolean(value.peer), {
    message: "CUSTOM requires a target peer",
    path: ["peer"],
  });

export const chaosHealSchema = z.object({
  nodeId: z.string().trim().regex(/^node-[1-5]$/, "Choose a configured Raftline node"),
  reason: z.string().trim().min(5, "Provide an incident reference or reason").max(500),
  all: z.boolean().default(false),
  peer: z.string().trim().max(40).optional(),
});

export const reconciliationResolveSchema = z.object({
  decision: z.enum(["RESOLVED_SETTLED", "RESOLVED_REJECTED", "UNRESOLVED"]),
  reason: z.string().trim().min(5, "Provide a reconciliation reason").max(500),
});

export const alertAcknowledgeSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const controlRangeSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
export type AdminCreateInput = z.infer<typeof adminCreateSchema>;
export type AdminRoleUpdateInput = z.infer<typeof adminRoleUpdateSchema>;
export type ChaosInjectInput = z.infer<typeof chaosInjectSchema>;
export type ChaosHealInput = z.infer<typeof chaosHealSchema>;
export type ReconciliationResolveInput = z.infer<typeof reconciliationResolveSchema>;
export type AlertAcknowledgeInput = z.infer<typeof alertAcknowledgeSchema>;
export type ControlRangeInput = z.infer<typeof controlRangeSchema>;

// ---------------------------------------------------------------------------
// Release 6 — Merchant ecosystem
// ---------------------------------------------------------------------------

const merchantHandle = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9_-]{2,39}$/, "Use lowercase letters, numbers, hyphens or underscores");

const minorAmount6 = z
  .number({ required_error: "Enter an amount" })
  .int("Amounts must be whole paise")
  .min(1, "Amount must be greater than zero")
  .max(10_000_000, "Amount is above the sandbox limit");

export const merchantCreateSchema = z.object({
  handle: merchantHandle,
  businessName: z.string().trim().min(2).max(120),
  displayName: z.string().trim().min(2).max(120),
  businessType: z.enum(MERCHANT_TYPES),
  category: z.string().trim().min(2).max(60),
  description: z.string().trim().max(600).optional(),
  email: emailField,
  phone: phoneField,
  website: z.string().trim().url().max(2048).optional(),
  address: z.string().trim().max(400).optional(),
  logoUrl: z.string().trim().url().max(2048).optional(),
  brandColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  supportEmail: z.string().trim().email().max(254).optional(),
  supportPhone: z.string().trim().max(20).optional(),
  refundPolicy: z.string().trim().max(1000).optional(),
});

export const merchantUpdateSchema = merchantCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "Nothing to update",
);

export const merchantOrderItemSchema = z.object({
  title: z.string().trim().min(1).max(160),
  quantity: z.number().int().min(1).max(10_000),
  unitPriceMinor: minorAmount6,
  sku: z.string().trim().max(80).optional(),
});

export const merchantOrderCreateSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(600).optional(),
  customerName: z.string().trim().max(120).optional(),
  customerEmail: z.string().trim().email().max(254).optional(),
  customerPhone: z.string().trim().max(20).optional(),
  items: z.array(merchantOrderItemSchema).min(1).max(50),
  taxMinor: z.number().int().min(0).max(10_000_000).default(0),
  discountMinor: z.number().int().min(0).max(10_000_000).default(0),
  expiresAt: z.string().datetime().optional(),
});

export const merchantPaymentLinkCreateSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(600).optional(),
  amountMinor: minorAmount6,
  customerName: z.string().trim().max(120).optional(),
  customerEmail: z.string().trim().email().max(254).optional(),
  maxPayments: z.number().int().min(1).max(1000).optional(),
  expiresAt: z.string().datetime().optional(),
  redirectUrl: z.string().trim().url().max(2048).optional(),
  orderId: z.string().trim().max(64).optional(),
});

export const checkoutConfirmSchema = z.object({
  clientRequestId: clientRequestIdSchema,
  promoCode: z.string().trim().min(3).max(60).optional(),
  promoOrderId: z.string().trim().min(3).max(64).optional(),
});

export const refundCreateSchema = z.object({
  paymentId: z.string().trim().min(1).max(64),
  amountMinor: minorAmount6,
  reason: z.string().trim().min(5).max(500),
  type: z.enum(["FULL", "PARTIAL"]),
});

export const refundReviewSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  note: z.string().trim().min(5).max(500),
});

export const webhookCreateSchema = z.object({
  url: z.string().trim().url().max(2048),
  events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1),
});

export const webhookUpdateSchema = z.object({
  url: z.string().trim().url().max(2048).optional(),
  events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1).optional(),
  enabled: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "Nothing to update");

export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  scopes: z.array(z.enum(API_SCOPES)).min(1),
});

export const merchantRangeSchema = z.object({
  range: z.enum(["today", "week", "month", "90days", "custom"]).default("month"),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export type MerchantCreateInput = z.infer<typeof merchantCreateSchema>;
export type MerchantUpdateInput = z.infer<typeof merchantUpdateSchema>;
export type MerchantOrderCreateInput = z.infer<typeof merchantOrderCreateSchema>;
export type PaymentLinkCreateInput = z.infer<typeof merchantPaymentLinkCreateSchema>;
export type CheckoutConfirmInput = z.infer<typeof checkoutConfirmSchema>;
export type RefundCreateInput = z.infer<typeof refundCreateSchema>;
export type RefundReviewInput = z.infer<typeof refundReviewSchema>;
export type WebhookCreateInput = z.infer<typeof webhookCreateSchema>;
export type WebhookUpdateInput = z.infer<typeof webhookUpdateSchema>;
export type ApiKeyCreateInput = z.infer<typeof apiKeyCreateSchema>;
export type MerchantRangeInput = z.infer<typeof merchantRangeSchema>;

// ---------------------------------------------------------------------------
// Release 7 — Subscriptions & recurring billing
// ---------------------------------------------------------------------------

const subscriptionAmount = z
  .number({ required_error: "Enter an amount" })
  .int("Amounts must be whole paise")
  .min(1, "Amount must be greater than zero")
  .max(10_000_000, "Amount is above the sandbox limit");

const subscriptionPlanBase = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional(),
  imageUrl: z.string().trim().url().max(2048).optional(),
  amountMinor: subscriptionAmount,
  setupFeeMinor: z.number().int().min(0).max(10_000_000).default(0),
  currency: z.literal("INR"),
  frequency: z.enum(BILLING_FREQUENCIES),
  intervalCount: z.number().int().min(1).max(12).default(1),
  trialDays: z.number().int().min(0).max(365).default(0),
  introPriceMinor: subscriptionAmount.optional(),
  introPeriods: z.number().int().min(0).max(24).default(0),
  maxBillingPeriods: z.number().int().min(1).max(1200).optional(),
  cancellationPolicy: z.string().trim().max(1000).optional(),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).default("PUBLIC"),
  status: z.enum(["DRAFT", "ACTIVE"]).default("DRAFT"),
});

export const subscriptionPlanCreateSchema = subscriptionPlanBase.refine(
  (value) => value.introPriceMinor === undefined || value.introPeriods > 0,
  "Introductory pricing requires at least one introductory period",
).refine(
  (value) => value.frequency !== "CUSTOM" || value.intervalCount >= 1,
  "Custom intervals require a valid interval count",
);

export const subscriptionPlanUpdateSchema = subscriptionPlanBase.partial().refine(
  (value) => Object.keys(value).length > 0,
  "Nothing to update",
);

export const subscriptionCheckoutConfirmSchema = z.object({
  clientRequestId: clientRequestIdSchema,
  acceptTerms: z.literal(true, { errorMap: () => ({ message: "You must accept the recurring billing terms" }) }),
});

export const subscriptionCancelSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  timing: z.enum(CANCELLATION_TIMINGS).default("END_OF_PERIOD"),
});

export const subscriptionPlanChangeSchema = z.object({
  planId: z.string().trim().min(1).max(64),
  reason: z.string().trim().max(500).optional(),
});

export const subscriptionRangeSchema = z.object({
  range: z.enum(["today", "week", "month", "90days", "custom"]).default("month"),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export type SubscriptionPlanCreateInput = z.infer<typeof subscriptionPlanCreateSchema>;
export type SubscriptionPlanUpdateInput = z.infer<typeof subscriptionPlanUpdateSchema>;
export type SubscriptionCheckoutConfirmInput = z.infer<typeof subscriptionCheckoutConfirmSchema>;
export type SubscriptionCancelInput = z.infer<typeof subscriptionCancelSchema>;
export type SubscriptionPlanChangeInput = z.infer<typeof subscriptionPlanChangeSchema>;
export type SubscriptionRangeInput = z.infer<typeof subscriptionRangeSchema>;

// ---------------------------------------------------------------------------
// Release 8 — Rewards, cashback, loyalty and offers
// ---------------------------------------------------------------------------

export const rewardListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  type: z.string().max(60).optional(),
  status: z.string().max(60).optional(),
  merchantId: z.string().max(64).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

const rewardMinor = z
  .number({ required_error: "Enter an amount" })
  .int("Amounts must be whole paise")
  .min(0)
  .max(10_000_000);

const rewardPoints = z.number().int().min(0).max(10_000_000);

const rewardCampaignBase = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().min(2).max(1000),
  type: z.enum(REWARD_CAMPAIGN_TYPES),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  minSpendMinor: rewardMinor.default(0),
  maxRewardMinor: rewardMinor.default(0),
  pointsPerMinor: rewardPoints.default(0),
  cashbackBps: z.number().int().min(0).max(10_000).default(0),
  bonusPoints: rewardPoints.default(0),
  discountBps: z.number().int().min(0).max(10_000).default(0),
  discountMinor: rewardMinor.default(0),
  budgetMinor: rewardMinor.default(0),
  pointsBudget: rewardPoints.default(0),
  perUserLimit: z.number().int().min(1).max(1000).default(1),
  globalRedemptionLimit: z.number().int().min(1).max(1_000_000).optional(),
  eligibleCategories: z.array(z.string().max(40)).max(30).default([]),
  customerSegments: z.array(z.string().max(40)).max(30).default([]),
  promoCode: z.string().trim().min(4).max(60).regex(/^[A-Za-z0-9_-]+$/).optional(),
  terms: z.string().trim().max(2000).optional(),
});

export const rewardCampaignCreateSchema = rewardCampaignBase.refine((value) => new Date(value.endAt) > new Date(value.startAt), "endAt must be after startAt")
  .refine(
    (value) => value.pointsPerMinor > 0 || value.cashbackBps > 0 || value.bonusPoints > 0 || value.discountBps > 0 || value.discountMinor > 0,
    "Configure at least one reward",
  );

export const rewardCampaignUpdateSchema = rewardCampaignBase.partial();

export const rewardCampaignStatusSchema = z.object({
  status: z.enum(REWARD_CAMPAIGN_STATUSES),
  reason: z.string().trim().max(500).optional(),
});

export const rewardRedeemSchema = z.object({
  catalogueItemId: z.string().trim().min(1).max(64),
  idempotencyKey: z.string().trim().min(8).max(120),
});

export const rewardPromoValidateSchema = z.object({
  code: z.string().trim().min(3).max(60),
  amountMinor: rewardMinor.refine((value) => value > 0, "Amount must be positive"),
  orderId: z.string().trim().min(3).max(64),
  merchantId: z.string().trim().max(64).optional(),
});

export const rewardAdjustmentSchema = z.object({
  userId: z.string().trim().min(1).max(64),
  points: z.number().int().refine((value) => value !== 0, "Points must not be zero"),
  reason: z.string().trim().min(5).max(500),
  idempotencyKey: z.string().trim().min(8).max(120),
});

export const rewardInvestigationCreateSchema = z.object({
  type: z.string().trim().min(2).max(60),
  subjectId: z.string().trim().min(1).max(120),
  riskEventId: z.string().trim().max(64).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export type RewardListQuery = z.infer<typeof rewardListQuerySchema>;
export type RewardCampaignCreateInput = z.infer<typeof rewardCampaignCreateSchema>;
export type RewardCampaignUpdateInput = z.infer<typeof rewardCampaignUpdateSchema>;
export type RewardCampaignStatusInput = z.infer<typeof rewardCampaignStatusSchema>;
export type RewardRedeemInput = z.infer<typeof rewardRedeemSchema>;
export type RewardPromoValidateInput = z.infer<typeof rewardPromoValidateSchema>;
export type RewardAdjustmentInput = z.infer<typeof rewardAdjustmentSchema>;
export type RewardInvestigationCreateInput = z.infer<typeof rewardInvestigationCreateSchema>;

// ---------------------------------------------------------------------------
// Release 9 — Financial intelligence
// ---------------------------------------------------------------------------

export const financeQuerySchema = z.object({
  period: z.enum(FINANCE_PERIODS).default("month"),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const recurringPatternUpdateSchema = z.object({
  merchant: z.string().trim().min(2).max(160).optional(),
  amountMinor: z.number().int().min(1).max(10_000_000).optional(),
  frequency: z.enum(["WEEKLY", "FORTNIGHTLY", "MONTHLY", "QUARTERLY", "YEARLY", "CUSTOM"]).optional(),
  status: z.enum(["CONFIRMED", "PAUSED", "DELETED"]).optional(),
}).refine((value) => Object.keys(value).length > 0, "Nothing to update");

export const assistantChatSchema = z.object({
  message: z.string().trim().min(3).max(500),
  conversationId: z.string().trim().max(64).optional(),
});

export const financialReportCreateSchema = z.object({
  type: z.enum([
    "MONTHLY_SUMMARY", "ANNUAL_SUMMARY", "CATEGORY_EXPENDITURE", "MERCHANT_EXPENDITURE",
    "SUBSCRIPTION", "RECURRING_PAYMENT", "BUDGET_PERFORMANCE", "SAVINGS_GOAL",
  ]),
  format: z.enum(["PDF", "CSV"]),
  period: z.enum(FINANCE_PERIODS).default("month"),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const financePreferenceUpdateSchema = z.object({
  defaultPeriod: z.enum(FINANCE_PERIODS).optional(),
  insightNotifications: z.boolean().optional(),
  forecastNotifications: z.boolean().optional(),
  budgetRecommendationNotifications: z.boolean().optional(),
  recurringDetection: z.boolean().optional(),
  goalReminders: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "Nothing to update");

export const anomalyFeedbackSchema = z.object({
  status: z.enum(["EXPECTED", "DISMISSED", "REVIEWED"]),
  note: z.string().trim().max(300).optional(),
});

export const insightFeedbackSchema = z.object({
  useful: z.boolean(),
  note: z.string().trim().max(300).optional(),
});

export const budgetRecommendationDecisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
});

export type FinanceQueryInput = z.infer<typeof financeQuerySchema>;
export type RecurringPatternUpdateInput = z.infer<typeof recurringPatternUpdateSchema>;
export type AssistantChatInput = z.infer<typeof assistantChatSchema>;
export type FinancialReportCreateInput = z.infer<typeof financialReportCreateSchema>;
export type FinancePreferenceUpdateInput = z.infer<typeof financePreferenceUpdateSchema>;
export type AnomalyFeedbackInput = z.infer<typeof anomalyFeedbackSchema>;
export type InsightFeedbackInput = z.infer<typeof insightFeedbackSchema>;
export type BudgetRecommendationDecisionInput = z.infer<typeof budgetRecommendationDecisionSchema>;

// ---------------------------------------------------------------------------
// Release 10 — Unified financial hub
// ---------------------------------------------------------------------------

export const connectAccountSchema = z.object({
  providerCode: z.string().trim().min(2).max(60),
  purpose: z.string().trim().min(5).max(300),
  dataCategories: z.array(z.enum(["ACCOUNT_METADATA", "BALANCES", "TRANSACTIONS"])).min(1),
  periodFrom: isoDate,
  periodTo: isoDate,
  durationDays: z.number().int().min(1).max(365).default(90),
  refreshFrequencyMinutes: z.number().int().min(15).max(10_080).default(360),
  termsAccepted: z.literal(true, { errorMap: () => ({ message: "You must accept the data-sharing terms" }) }),
}).refine((value) => value.periodTo >= value.periodFrom, "Invalid consent period");

export const providerCallbackSchema = z.object({
  state: z.string().trim().min(8).max(200),
  code: z.string().trim().max(300).optional(),
  providerRef: z.string().trim().max(180).optional(),
  error: z.string().trim().max(200).optional(),
});

export const accountQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  status: z.string().max(40).optional(),
  providerId: z.string().max(64).optional(),
  accountType: z.enum(EXTERNAL_ACCOUNT_TYPES).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  scope: z.enum(["WALLET", "ACCOUNT", "ALL"]).default("ALL"),
  accountId: z.string().max(64).optional(),
});

export const consentActionSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

export const dataDeletionRequestSchema = z.object({
  reason: z.string().trim().min(5).max(500),
  accountId: z.string().trim().max(64).optional(),
});

export const transferDecisionSchema = z.object({
  decision: z.enum(["CONFIRM", "REJECT"]),
});

export type ConnectAccountInput = z.infer<typeof connectAccountSchema>;
export type ProviderCallbackInput = z.infer<typeof providerCallbackSchema>;
export type AccountQueryInput = z.infer<typeof accountQuerySchema>;
export type ConsentActionInput = z.infer<typeof consentActionSchema>;
export type DataDeletionRequestInput = z.infer<typeof dataDeletionRequestSchema>;
export type TransferDecisionInput = z.infer<typeof transferDecisionSchema>;

// ---------------------------------------------------------------------------
// Release 12 — Insurance marketplace & policy management
// ---------------------------------------------------------------------------

export const insuranceQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  category: z.string().max(60).optional(),
  status: z.string().max(60).optional(),
  providerId: z.string().max(64).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const insuranceCompareSchema = z.object({
  productIds: z.array(z.string().min(1).max(100)).min(2).max(4),
});

export const insuranceQuoteCreateSchema = z.object({
  productId: z.string().trim().min(1).max(100),
  answers: z.record(z.unknown()),
  consentVersion: z.string().trim().min(3).max(40),
  termsAccepted: z.literal(true, { errorMap: () => ({ message: "You must accept the privacy notice" }) }),
});

export const insuranceApplicationCreateSchema = z.object({
  productId: z.string().trim().min(1).max(100),
  quoteId: z.string().trim().max(64).optional(),
  applicantData: z.record(z.unknown()),
  idempotencyKey: z.string().trim().min(8).max(160),
  consentVersion: z.string().trim().min(3).max(40),
  disclosuresAccepted: z.literal(true, { errorMap: () => ({ message: "You must accept the disclosures" }) }),
});

export const insuranceClaimCreateSchema = z.object({
  policyId: z.string().trim().min(1).max(64),
  claimType: z.string().trim().min(2).max(80),
  incidentDate: z.string().datetime(),
  description: z.string().trim().max(1000).optional(),
});

export const insuranceDocumentUploadSchema = z.object({
  category: z.string().trim().min(2).max(60),
});

export const insuranceConsentSchema = z.object({
  providerId: z.string().trim().min(1).max(64),
  purpose: z.string().trim().min(5).max(300),
  dataCategories: z.array(z.string().max(60)).min(1).max(10),
  sharedFields: z.array(z.string().max(80)).max(50).default([]),
  version: z.string().trim().min(3).max(40),
});

export const insuranceWebhookSchema = z.object({
  eventType: z.string().trim().min(3).max(80),
  eventId: z.string().trim().min(3).max(180),
  providerRef: z.string().trim().max(180).optional(),
  signature: z.string().trim().min(8).max(500),
  timestamp: z.string().trim().min(3).max(40),
  payload: z.record(z.unknown()),
});

export type InsuranceQueryInput = z.infer<typeof insuranceQuerySchema>;
export type InsuranceCompareInput = z.infer<typeof insuranceCompareSchema>;
export type InsuranceQuoteCreateInput = z.infer<typeof insuranceQuoteCreateSchema>;
export type InsuranceApplicationCreateInput = z.infer<typeof insuranceApplicationCreateSchema>;
export type InsuranceClaimCreateInput = z.infer<typeof insuranceClaimCreateSchema>;
export type InsuranceDocumentUploadInput = z.infer<typeof insuranceDocumentUploadSchema>;
export type InsuranceConsentInput = z.infer<typeof insuranceConsentSchema>;
export type InsuranceWebhookInput = z.infer<typeof insuranceWebhookSchema>;

// ---------------------------------------------------------------------------
// Release 11 — Credit marketplace and loan management
// ---------------------------------------------------------------------------

export const creditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  type: z.string().max(60).optional(),
  status: z.string().max(60).optional(),
  providerId: z.string().max(64).optional(),
});

export const eligibilitySchema = z.object({
  productId: z.string().trim().min(1).max(64),
  employmentCategory: z.enum(["SALARIED", "SELF_EMPLOYED", "BUSINESS", "OTHER"]),
  monthlyIncomeRange: z.enum(["BELOW_25000", "25000_50000", "50000_100000", "ABOVE_100000"]),
  employmentMonths: z.number().int().min(0).max(600),
  existingObligationsMinor: z.number().int().min(0).max(10_000_000).default(0),
  requestedAmountMinor: z.number().int().min(1000).max(100_000_000),
  requestedTenureMonths: z.number().int().min(1).max(360),
  purpose: z.string().trim().min(3).max(120),
});

export const applicationCreateSchema = z.object({
  offerId: z.string().trim().min(1).max(64),
  employmentCategory: z.enum(["SALARIED", "SELF_EMPLOYED", "BUSINESS", "OTHER"]),
  monthlyIncomeRange: z.enum(["BELOW_25000", "25000_50000", "50000_100000", "ABOVE_100000"]),
  employmentMonths: z.number().int().min(0).max(600),
  existingObligationsMinor: z.number().int().min(0).max(10_000_000).default(0),
  requestedAmountMinor: z.number().int().min(1000).max(100_000_000),
  requestedTenureMonths: z.number().int().min(1).max(360),
  purpose: z.string().trim().min(3).max(120),
  idempotencyKey: z.string().trim().min(8).max(160),
  disclosuresAccepted: z.literal(true, { errorMap: () => ({ message: "You must accept the lending disclosures" }) }),
  consentVersion: z.string().trim().min(3).max(40),
});

export const applicationUpdateSchema = z.object({
  employmentCategory: z.enum(["SALARIED", "SELF_EMPLOYED", "BUSINESS", "OTHER"]).optional(),
  monthlyIncomeRange: z.enum(["BELOW_25000", "25000_50000", "50000_100000", "ABOVE_100000"]).optional(),
  employmentMonths: z.number().int().min(0).max(600).optional(),
  existingObligationsMinor: z.number().int().min(0).max(10_000_000).optional(),
  requestedAmountMinor: z.number().int().min(1000).max(100_000_000).optional(),
  requestedTenureMonths: z.number().int().min(1).max(360).optional(),
  purpose: z.string().trim().min(3).max(120).optional(),
}).refine((value) => Object.keys(value).length > 0, "Nothing to update");

export const documentUploadSchema = z.object({
  category: z.enum(["IDENTITY", "ADDRESS", "INCOME", "EMPLOYMENT", "BANK_STATEMENT", "BUSINESS", "AGREEMENT", "SCHEDULE", "OTHER"]),
});

export const affordabilitySchema = z.object({
  amountMinor: z.number().int().min(1000).max(100_000_000),
  tenureMonths: z.number().int().min(1).max(360),
  interestRateBps: z.number().int().min(0).max(10_000),
});

export const creditWebhookSchema = z.object({
  eventType: z.string().trim().min(3).max(80),
  eventId: z.string().trim().min(3).max(180),
  providerRef: z.string().trim().max(180).optional(),
  signature: z.string().trim().min(8).max(500),
  timestamp: z.string().trim().min(3).max(40),
  payload: z.record(z.unknown()),
});

export type CreditQueryInput = z.infer<typeof creditQuerySchema>;
export type EligibilityInput = z.infer<typeof eligibilitySchema>;
export type ApplicationCreateInput = z.infer<typeof applicationCreateSchema>;
export type ApplicationUpdateInput = z.infer<typeof applicationUpdateSchema>;
export type DocumentUploadInput = z.infer<typeof documentUploadSchema>;
export type AffordabilityInput = z.infer<typeof affordabilitySchema>;
export type CreditWebhookInput = z.infer<typeof creditWebhookSchema>;

