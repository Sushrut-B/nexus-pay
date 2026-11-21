/** Release 19 — versioned Help Centre with content review workflow. */
import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import type { HelpArticleView } from "@nexus/shared-types";
import { recordSupportAudit } from "@/lib/support/support-audit";

const DEFAULT_CATEGORIES = [
  { code: "ACCOUNT_LOGIN", label: "Account and login", sortOrder: 1 },
  { code: "WALLET_PAYMENTS", label: "Wallet and payments", sortOrder: 2 },
  { code: "MERCHANT", label: "Merchant purchases", sortOrder: 3 },
  { code: "SUBSCRIPTIONS", label: "Subscriptions", sortOrder: 4 },
  { code: "BILLS_RECHARGES", label: "Bills and recharges", sortOrder: 5 },
  { code: "TRAVEL", label: "Travel", sortOrder: 6 },
  { code: "INVESTMENTS", label: "Investments", sortOrder: 7 },
  { code: "TAX_CENTRE", label: "Tax Centre", sortOrder: 8 },
  { code: "INTERNATIONAL", label: "International finance", sortOrder: 9 },
  { code: "PRIVACY_SECURITY", label: "Privacy and security", sortOrder: 10 },
  { code: "TROUBLESHOOTING", label: "General troubleshooting", sortOrder: 11 },
];

export async function ensureHelpCategories() {
  for (const category of DEFAULT_CATEGORIES) {
    await prisma.helpArticleCategory.upsert({
      where: { code: category.code },
      create: category,
      update: { label: category.label, sortOrder: category.sortOrder },
    });
  }
  return prisma.helpArticleCategory.findMany({ orderBy: { sortOrder: "asc" } });
}

async function toView(
  row: {
    id: string; slug: string; categoryCode: string; title: string; status: string;
    currentVersion: number; relatedSlugs: unknown; lastReviewedAt: Date;
  },
  userId?: string,
): Promise<HelpArticleView> {
  const version = await prisma.helpArticleVersion.findUnique({
    where: { articleId_version: { articleId: row.id, version: row.currentVersion } },
  });
  const related = await prisma.helpArticle.findMany({
    where: { slug: { in: (row.relatedSlugs as string[]) ?? [] }, status: "PUBLISHED" },
    select: { id: true, title: true }, take: 8,
  });
  let helpful: boolean | null = null;
  if (userId) {
    const feedback = await prisma.helpArticleFeedback.findUnique({
      where: { articleId_userId: { articleId: row.id, userId } },
    });
    helpful = feedback?.helpful ?? null;
  }
  return {
    id: row.id, slug: row.slug, categoryCode: row.categoryCode, title: row.title,
    body: version?.body ?? "This article has no published content yet.",
    version: row.currentVersion, lastReviewedAt: row.lastReviewedAt.toISOString(),
    related, helpful, status: row.status,
  };
}

export async function listArticles(filters: { categoryCode?: string; search?: string } = {}, userId?: string) {
  await ensureHelpCategories();
  const rows = await prisma.helpArticle.findMany({
    where: {
      status: "PUBLISHED",
      ...(filters.categoryCode ? { categoryCode: filters.categoryCode } : {}),
      ...(filters.search
        ? { OR: [
            { title: { contains: filters.search, mode: "insensitive" } },
            { slug: { contains: filters.search, mode: "insensitive" } },
          ] }
        : {}),
    },
    orderBy: { title: "asc" }, take: 100,
  });
  return Promise.all(rows.map((row) => toView(row, userId)));
}

export async function getArticle(slug: string, userId?: string) {
  const row = await prisma.helpArticle.findUnique({ where: { slug } });
  if (!row || row.status !== "PUBLISHED") throw new ApiError(404, "VALIDATION_ERROR", "Article not found");
  return toView(row, userId);
}

export async function recordFeedback(userId: string, articleId: string, helpful: boolean) {
  const article = await prisma.helpArticle.findFirst({ where: { id: articleId, status: "PUBLISHED" } });
  if (!article) throw new ApiError(404, "VALIDATION_ERROR", "Article not found");
  await prisma.helpArticleFeedback.upsert({
    where: { articleId_userId: { articleId, userId } },
    create: { articleId, userId, helpful },
    update: { helpful },
  });
  await recordSupportAudit({ actorType: "CUSTOMER", actorId: userId, action: "HELP_FEEDBACK_RECORDED", targetType: "HELP_ARTICLE", targetId: articleId, metadata: { helpful } });
}

export async function createArticle(actorId: string, input: {
  categoryCode: string; title: string; body: string;
  status?: "DRAFT" | "PUBLISHED" | "ARCHIVED"; relatedSlugs?: string[];
}) {
  const slug = input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 140);
  const existing = await prisma.helpArticle.findUnique({ where: { slug } });
  if (existing) throw new ApiError(409, "VALIDATION_ERROR", "An article with this title already exists");
  const row = await prisma.helpArticle.create({
    data: {
      slug, categoryCode: input.categoryCode, title: input.title,
      status: input.status ?? "DRAFT", relatedSlugs: (input.relatedSlugs ?? []) as object,
      currentVersion: 1, lastReviewedAt: new Date(),
    },
  });
  await prisma.helpArticleVersion.create({
    data: { articleId: row.id, version: 1, title: input.title, body: input.body, createdBy: actorId },
  });
  await recordSupportAudit({ actorType: "STAFF", actorId, action: "HELP_ARTICLE_CREATED", targetType: "HELP_ARTICLE", targetId: row.id, metadata: { slug } });
  return row.id;
}

export async function publishNewVersion(actorId: string, articleId: string, input: {
  title: string; body: string;
}) {
  const row = await prisma.helpArticle.findUnique({ where: { id: articleId } });
  if (!row) throw new ApiError(404, "VALIDATION_ERROR", "Article not found");
  const nextVersion = row.currentVersion + 1;
  await prisma.helpArticleVersion.create({
    data: { articleId, version: nextVersion, title: input.title, body: input.body, createdBy: actorId },
  });
  await prisma.helpArticle.update({
    where: { id: articleId },
    data: { currentVersion: nextVersion, title: input.title, status: "PUBLISHED", lastReviewedAt: new Date() },
  });
  await recordSupportAudit({ actorType: "STAFF", actorId, action: "HELP_ARTICLE_VERSION_PUBLISHED", targetType: "HELP_ARTICLE", targetId: articleId, metadata: { version: nextVersion } });
  return nextVersion;
}

/** Identifies articles needing review; used by the help-review worker and Control. */
export async function articlesNeedingReview() {
  const reviewDays = getServerEnv().NEXUS_SUPPORT_HELP_REVIEW_DAYS;
  const cutoff = new Date(Date.now() - reviewDays * 86400000);
  return prisma.helpArticle.findMany({
    where: { status: "PUBLISHED", lastReviewedAt: { lt: cutoff } },
    orderBy: { lastReviewedAt: "asc" }, take: 100,
  });
}
