/** Release 8 — Rewards, cashback, loyalty and offers transport contracts. */

export const REWARD_ACTIVITY_TYPES = [
  "POINTS_EARNED", "POINTS_REDEEMED", "POINTS_EXPIRED", "POINTS_REVERSED",
  "CASHBACK_PENDING", "CASHBACK_CREDITED", "CASHBACK_FAILED", "PROMO_DISCOUNT",
  "REFERRAL_REWARD", "CAMPAIGN_BONUS", "MANUAL_ADJUSTMENT",
] as const;
export type RewardActivityType = (typeof REWARD_ACTIVITY_TYPES)[number];

export const REWARD_CAMPAIGN_TYPES = [
  "POINTS_MULTIPLIER", "CASHBACK", "FIXED_DISCOUNT", "PERCENTAGE_DISCOUNT",
  "BONUS_POINTS", "REFERRAL_BONUS", "FIRST_TRANSACTION", "MERCHANT_SPECIFIC", "LIMITED_TIME_OFFER",
] as const;
export type RewardCampaignType = (typeof REWARD_CAMPAIGN_TYPES)[number];

export const REWARD_CAMPAIGN_STATUSES = [
  "DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED", "ACTIVE", "PAUSED",
  "EXHAUSTED", "EXPIRED", "REJECTED", "CANCELLED",
] as const;
export type RewardCampaignStatus = (typeof REWARD_CAMPAIGN_STATUSES)[number];

export const CASHBACK_STATUSES = [
  "ELIGIBILITY_PENDING", "ELIGIBLE", "PENDING_CREDIT", "PROCESSING", "CREDITED",
  "FAILED", "REQUIRES_RECONCILIATION", "REVERSED", "CANCELLED",
] as const;
export type CashbackStatus = (typeof CASHBACK_STATUSES)[number];

export interface RewardSummary {
  availablePoints: number;
  lifetimeEarnedPoints: number;
  lifetimeRedeemedPoints: number;
  pendingPoints: number;
  expiringSoonPoints: number;
  cashbackEarnedMinor: number;
  cashbackPendingMinor: number;
  cashbackCreditedMinor: number;
  activeOffers: number;
  membership: { tierName: string; rank: number; nextTier: string | null; progressBps: number | null };
  currency: string;
  notice: string;
}

export interface RewardLedgerView {
  id: string;
  type: string;
  points: number;
  balanceAfter: number;
  description: string;
  merchantName: string | null;
  transactionRef: string | null;
  status: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface RewardCatalogueView {
  id: string;
  name: string;
  description: string;
  merchantName: string | null;
  pointsCost: number;
  remaining: number | null;
  expiresAt: string | null;
  terms: string | null;
  active: boolean;
  redeemedByUser: number;
}

export interface CampaignView {
  id: string;
  merchantId: string | null;
  ownerType: string;
  name: string;
  description: string;
  type: RewardCampaignType;
  status: RewardCampaignStatus;
  startAt: string;
  endAt: string;
  minSpendMinor: number;
  maxRewardMinor: number;
  budgetMinor: number;
  consumedMinor: number;
  reservedMinor: number;
  perUserLimit: number;
  promoCode: string | null;
  eligibleCategories: string[];
  terms: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

export interface CashbackView {
  id: string;
  campaignId: string;
  transactionRef: string;
  amountMinor: number;
  currency: string;
  status: CashbackStatus;
  paymentRef: string | null;
  failureCategory: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface OfferSummary {
  id: string;
  merchantId: string | null;
  merchantName: string | null;
  name: string;
  description: string;
  type: RewardCampaignType;
  typeLabel: string;
  minSpendMinor: number;
  maxRewardMinor: number;
  pointsPerMinor: number;
  cashbackBps: number;
  startAt: string;
  endAt: string;
  eligible: boolean;
  eligibilityReason: string | null;
  remainingBudgetMinor: number;
  promoCode: string | null;
}

export interface PromoValidation {
  valid: boolean;
  campaignId: string | null;
  discountMinor: number;
  originalMinor: number;
  payableMinor: number;
  reason: string | null;
  reservationId: string | null;
}

export interface MembershipView {
  tierName: string;
  rank: number;
  pointsMultiplierBps: number;
  benefits: string[];
  qualifyingSpendMinor: number;
  qualifyingTxCount: number;
  periodStart: string;
  reviewAt: string | null;
  nextTier: string | null;
  progressBps: number | null;
  history: Array<{ toTier: string; direction: string; reason: string; at: string }>;
}

export interface ReferralView {
  code: string;
  link: string;
  referredCount: number;
  qualifiedCount: number;
  pointsEarned: number;
  cashbackEarnedMinor: number;
  history: Array<{ type: string; status: string; createdAt: string }>;
}

export interface AdminRewardsOverview {
  points: { issued: number; redeemed: number; expired: number; outstanding: number };
  cashback: { entitlements: number; creditedMinor: number; pendingMinor: number; failed: number };
  campaigns: { active: number; exhausted: number; total: number };
  redemptions: number;
  referralRewardsIssued: number;
  riskEvents: number;
  currency: string;
  notice: string;
}

export interface ReconciliationView {
  pointsLedgerBalance: number;
  computedBalance: number;
  cashbackReservedMinor: number;
  cashbackConsumedMinor: number;
  pendingEntitlements: number;
  openReservations: number;
  referralQualifiedUnrewarded: number;
  discrepancies: string[];
  currency: string;
}
