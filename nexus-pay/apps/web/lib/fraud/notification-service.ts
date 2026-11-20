import { prisma } from "@nexus/database";
import type { NotificationType } from "@nexus/database";
import { createNotification } from "@/lib/social/shared";

export async function notifySecurity(input: {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string | number | boolean>;
}) {
  await createNotification(prisma, {
    userId: input.userId,
    type: input.type,
    title: input.title,
    body: input.body,
    data: input.data ?? {},
  });
  await prisma.securityNotification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: (input.data ?? {}) as object,
      status: "SENT",
      sentAt: new Date(),
    },
  });
}

export async function listSecurityNotifications(userId: string, limit = 50) {
  return prisma.securityNotification.findMany({
    where: { userId }, orderBy: { createdAt: "desc" }, take: limit,
  });
}
