import { prisma, type TransactionCategory } from "@nexus/database";
import type {
  CategoryRuleView,
  CategoryType,
  CategoryView,
  CategorizationSource,
  RuleConditionType,
} from "@nexus/shared-types";
import type {
  CategoryRuleCreateInput,
  CategoryRuleUpdateInput,
  CategorizeInput,
} from "@nexus/validation";
import { ApiError } from "@/lib/api/response";

interface SystemCategorySeed {
  name: string;
  categoryType: CategoryType;
  icon: string;
}

/**
 * System categories are vocabulary only. They never imply that a transaction
 * was spent on that category; categorization stays explicit (user rule or
 * manual choice) so analytics never invent a merchant or purpose.
 */
export const SYSTEM_CATEGORY_SEEDS: SystemCategorySeed[] = [
  { name: "Food & Dining", categoryType: "FOOD_DINING", icon: "utensils" },
  { name: "Groceries", categoryType: "GROCERIES", icon: "shopping-cart" },
  { name: "Shopping", categoryType: "SHOPPING", icon: "shopping-bag" },
  { name: "Transport", categoryType: "TRANSPORT", icon: "bus" },
  { name: "Travel", categoryType: "TRAVEL", icon: "plane" },
  { name: "Entertainment", categoryType: "ENTERTAINMENT", icon: "clapperboard" },
  { name: "Rent & Housing", categoryType: "RENT_HOUSING", icon: "home" },
  { name: "Utilities", categoryType: "UTILITIES", icon: "zap" },
  { name: "Healthcare", categoryType: "HEALTHCARE", icon: "heart-pulse" },
  { name: "Education", categoryType: "EDUCATION", icon: "graduation-cap" },
  { name: "Subscriptions", categoryType: "SUBSCRIPTIONS", icon: "repeat" },
  { name: "Personal Transfers", categoryType: "PERSONAL_TRANSFERS", icon: "arrow-left-right" },
  { name: "Group Expenses", categoryType: "GROUP_EXPENSES", icon: "users" },
  { name: "Income", categoryType: "INCOME", icon: "banknote" },
  { name: "Other", categoryType: "OTHER", icon: "tag" },
  { name: "Uncategorized", categoryType: "UNCATEGORIZED", icon: "help-circle" },
];

export async function ensureSystemCategories(): Promise<void> {
  for (const seed of SYSTEM_CATEGORY_SEEDS) {
    const existing = await prisma.transactionCategory.findFirst({
      where: { userId: null, name: seed.name },
    });
    if (!existing) {
      await prisma.transactionCategory.create({
        data: {
          userId: null,
          name: seed.name,
          categoryType: seed.categoryType,
          icon: seed.icon,
          isSystem: true,
        },
      });
    }
  }
}

export async function listCategories(userId: string): Promise<CategoryView[]> {
  await ensureSystemCategories();
  const categories = await prisma.transactionCategory.findMany({
    where: { OR: [{ userId: null }, { userId }] },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });
  return categories.map(toCategoryView);
}

export async function getCategoryOrThrow(categoryId: string, userId: string): Promise<TransactionCategory> {
  const category = await prisma.transactionCategory.findFirst({
    where: { id: categoryId, OR: [{ userId: null }, { userId }] },
  });
  if (!category) {
    throw new ApiError(404, "VALIDATION_ERROR", "That category could not be found.");
  }
  return category;
}

export function toCategoryView(category: TransactionCategory): CategoryView {
  return {
    id: category.id,
    name: category.name,
    categoryType: category.categoryType,
    icon: category.icon,
    isSystem: category.isSystem,
    createdAt: category.createdAt.toISOString(),
  };
}

function matchesCondition(value: string, conditionType: RuleConditionType, conditionValue: string): boolean {
  const subject = value.toLowerCase();
  const target = conditionValue.toLowerCase();
  switch (conditionType) {
    case "CONTAINS":
      return subject.includes(target);
    case "STARTS_WITH":
      return subject.startsWith(target);
    case "ENDS_WITH":
      return subject.endsWith(target);
    case "EXACT":
      return subject === target;
    default:
      return false;
  }
}

/**
 * Deterministic rule resolution: highest priority wins, then the oldest rule
 * id breaks ties. Only enabled rules participate.
 */
export function resolveRule(
  description: string,
  rules: Array<{ id: string; conditionType: RuleConditionType; conditionValue: string; priority: number }>,
): string | null {
  const sorted = [...rules].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  for (const rule of sorted) {
    if (matchesCondition(description, rule.conditionType, rule.conditionValue)) return rule.id;
  }
  return null;
}

export async function listRules(userId: string): Promise<CategoryRuleView[]> {
  await ensureSystemCategories();
  const rules = await prisma.categorizationRule.findMany({
    where: { userId },
    include: { category: true },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });
  return rules.map((rule) => ({
    id: rule.id,
    conditionType: rule.conditionType,
    conditionValue: rule.conditionValue,
    categoryId: rule.categoryId,
    categoryName: rule.category.name,
    priority: rule.priority,
    isEnabled: rule.isEnabled,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  }));
}

export async function createRule(userId: string, input: CategoryRuleCreateInput): Promise<CategoryRuleView> {
  await getCategoryOrThrow(input.categoryId, userId);
  const rule = await prisma.categorizationRule.create({
    data: {
      userId,
      conditionType: input.conditionType,
      conditionValue: input.conditionValue,
      categoryId: input.categoryId,
      priority: input.priority,
      isEnabled: input.isEnabled,
    },
    include: { category: true },
  });
  return {
    id: rule.id,
    conditionType: rule.conditionType,
    conditionValue: rule.conditionValue,
    categoryId: rule.categoryId,
    categoryName: rule.category.name,
    priority: rule.priority,
    isEnabled: rule.isEnabled,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  };
}

export async function updateRule(
  userId: string,
  ruleId: string,
  input: CategoryRuleUpdateInput,
): Promise<CategoryRuleView> {
  const existing = await prisma.categorizationRule.findFirst({ where: { id: ruleId, userId } });
  if (!existing) throw new ApiError(404, "AUTHORIZATION_ERROR", "That rule could not be found.");
  if (input.categoryId) await getCategoryOrThrow(input.categoryId, userId);
  const rule = await prisma.categorizationRule.update({
    where: { id: ruleId },
    data: {
      conditionType: input.conditionType,
      conditionValue: input.conditionValue,
      categoryId: input.categoryId,
      priority: input.priority,
      isEnabled: input.isEnabled,
    },
    include: { category: true },
  });
  return {
    id: rule.id,
    conditionType: rule.conditionType,
    conditionValue: rule.conditionValue,
    categoryId: rule.categoryId,
    categoryName: rule.category.name,
    priority: rule.priority,
    isEnabled: rule.isEnabled,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  };
}

export async function deleteRule(userId: string, ruleId: string): Promise<void> {
  const existing = await prisma.categorizationRule.findFirst({ where: { id: ruleId, userId } });
  if (!existing) throw new ApiError(404, "AUTHORIZATION_ERROR", "That rule could not be found.");
  await prisma.categorizationRule.delete({ where: { id: ruleId } });
}

/**
 * Assign a user category to one transaction. The immutable transaction record
 * is never modified; only the separate categorization metadata changes.
 */
export async function categorizeTransaction(
  userId: string,
  input: CategorizeInput,
): Promise<{ paymentRef: string; categoryId: string; categoryName: string; note: string | null }> {
  const record = await prisma.transactionRecord.findFirst({
    where: { userId, paymentRef: input.paymentRef },
  });
  if (!record) {
    throw new ApiError(404, "PAYMENT_ERROR", "That transaction could not be found.");
  }
  await getCategoryOrThrow(input.categoryId, userId);

  await prisma.transactionCategorization.upsert({
    where: { userId_paymentRef: { userId, paymentRef: input.paymentRef } },
    create: {
      userId,
      paymentRef: input.paymentRef,
      categoryId: input.categoryId,
      note: input.note ?? null,
      categorizationSource: "MANUAL",
    },
    update: {
      categoryId: input.categoryId,
      note: input.note ?? null,
      categorizationSource: "MANUAL",
    },
  });

  const category = await prisma.transactionCategory.findUniqueOrThrow({ where: { id: input.categoryId } });
  return {
    paymentRef: input.paymentRef,
    categoryId: category.id,
    categoryName: category.name,
    note: input.note ?? null,
  };
}

export async function listCategorizations(userId: string) {
  const rows = await prisma.transactionCategorization.findMany({
    where: { userId },
    include: { category: true },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return rows.map((row) => ({
    paymentRef: row.paymentRef,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    categoryType: row.category.categoryType,
    note: row.note,
    source: row.categorizationSource as CategorizationSource,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/**
 * Resolve the effective category for a transaction: manual categorization
 * wins, then the highest-priority enabled user rule, otherwise Uncategorized.
 */
export async function resolveTransactionCategory(
  userId: string,
  paymentRef: string,
  description: string | null,
): Promise<string> {
  const manual = await prisma.transactionCategorization.findUnique({
    where: { userId_paymentRef: { userId, paymentRef } },
  });
  if (manual) return manual.categoryId;

  const rules = await prisma.categorizationRule.findMany({
    where: { userId, isEnabled: true },
    orderBy: [{ priority: "desc" }, { id: "asc" }],
  });
  if (description && rules.length > 0) {
    const match = resolveRule(
      description,
      rules.map((rule) => ({
        id: rule.id,
        conditionType: rule.conditionType,
        conditionValue: rule.conditionValue,
        priority: rule.priority,
      })),
    );
    if (match) {
      const rule = rules.find((item) => item.id === match);
      if (rule) return rule.categoryId;
    }
  }

  const uncategorized = await prisma.transactionCategory.findFirst({
    where: { userId: null, categoryType: "UNCATEGORIZED" },
  });
  return uncategorized?.id ?? "";
}
