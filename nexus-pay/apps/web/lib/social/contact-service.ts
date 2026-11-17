import { prisma } from "@nexus/database";
import type { ContactListResult, ContactView } from "@nexus/shared-types";
import type { ContactCreateInput } from "@nexus/validation";
import { normalizeEmail } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { searchRecipient } from "@/lib/payments/recipient-service";
import { loadParty, toSocialParty } from "@/lib/social/shared";

export async function listContacts(userId: string): Promise<ContactListResult> {
  const contacts = await prisma.contact.findMany({
    where: { ownerUserId: userId },
    include: {
      contact: { include: { profile: true } },
    },
    orderBy: [{ displayLabel: "asc" }, { createdAt: "desc" }],
  });

  const items: ContactView[] = [];
  for (const contact of contacts) {
    const recent = await prisma.transactionRecord.findFirst({
      where: {
        userId,
        counterpartyUsername: contact.contact.username,
      },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true },
    });
    items.push({
      id: contact.id,
      user: toSocialParty(contact.contact),
      displayLabel: contact.displayLabel,
      createdAt: contact.createdAt.toISOString(),
      recentInteractionAt: recent?.occurredAt.toISOString() ?? null,
    });
  }

  items.sort((a, b) => {
    const aName = a.displayLabel ?? a.user.displayName;
    const bName = b.displayLabel ?? b.user.displayName;
    return aName.localeCompare(bName);
  });

  return { items, total: items.length };
}

export async function assertNotSelf(userId: string, query: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
  const normalized = query.trim().toLowerCase();
  const candidates = new Set([
    user.username.toLowerCase(),
    user.email.toLowerCase(),
    user.phoneNumber,
  ]);
  if (candidates.has(normalized) || candidates.has(normalizeEmail(normalized))) {
    throw new ApiError(400, "PAYMENT_ERROR", "You cannot add yourself as a contact.");
  }
}

export async function addContact(userId: string, input: ContactCreateInput): Promise<ContactView> {
  await assertNotSelf(userId, input.query);

  // Reuse the secure exact-match recipient lookup. It never returns a ledger id.
  const summary = await searchRecipient(userId, input.query).catch((error) => {
    if (error instanceof ApiError && error.category === "RECIPIENT_NOT_FOUND") {
      throw new ApiError(404, "RECIPIENT_NOT_FOUND", "No Nexus Pay customer matches that search.");
    }
    throw error;
  });

  const contactUser = await prisma.user.findUnique({ where: { username: summary.username } });
  if (!contactUser) {
    throw new ApiError(404, "RECIPIENT_NOT_FOUND", "No Nexus Pay customer matches that search.");
  }

  try {
    const contact = await prisma.contact.create({
      data: {
        ownerUserId: userId,
        contactUserId: contactUser.id,
        displayLabel: input.displayLabel ?? null,
      },
    });
    return {
      id: contact.id,
      user: await loadParty(prisma, contactUser.id),
      displayLabel: contact.displayLabel,
      createdAt: contact.createdAt.toISOString(),
      recentInteractionAt: null,
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      throw new ApiError(409, "VALIDATION_ERROR", "That person is already in your contacts.");
    }
    throw error;
  }
}

export async function getContact(userId: string, contactId: string): Promise<ContactView> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, ownerUserId: userId },
    include: { contact: { include: { profile: true } } },
  });
  if (!contact) {
    throw new ApiError(404, "AUTHORIZATION_ERROR", "That contact could not be found.");
  }
  const recent = await prisma.transactionRecord.findFirst({
    where: { userId, counterpartyUsername: contact.contact.username },
    orderBy: { occurredAt: "desc" },
    select: { occurredAt: true },
  });
  return {
    id: contact.id,
    user: toSocialParty(contact.contact),
    displayLabel: contact.displayLabel,
    createdAt: contact.createdAt.toISOString(),
    recentInteractionAt: recent?.occurredAt.toISOString() ?? null,
  };
}

export async function getContactContext(userId: string, contactId: string) {
  const contact = await getContact(userId, contactId);
  const recentPayments = await prisma.transactionRecord.findMany({
    where: { userId, counterpartyUsername: contact.user.username },
    orderBy: { occurredAt: "desc" },
    take: 5,
  });
  const memberships = await prisma.groupMember.findMany({
    where: { userId, removedAt: null },
    select: { groupId: true },
  });
  const sharedGroups = await prisma.expenseGroup.findMany({
    where: {
      id: { in: memberships.map((membership) => membership.groupId) },
      members: { some: { userId: contact.user.userId, removedAt: null } },
    },
    select: { id: true, name: true, category: true },
    orderBy: { name: "asc" },
  });
  return { contact, recentPayments, sharedGroups };
}

export async function removeContact(userId: string, contactId: string): Promise<void> {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, ownerUserId: userId } });
  if (!contact) {
    throw new ApiError(404, "AUTHORIZATION_ERROR", "That contact could not be found.");
  }
  await prisma.contact.delete({ where: { id: contact.id } });
}
