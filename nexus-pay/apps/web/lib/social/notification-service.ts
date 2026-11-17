import { prisma } from "@nexus/database";
import type { NotificationListResult, NotificationView } from "@nexus/shared-types";
import type { NotificationListQueryInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";

export async function listNotifications(
  userId: string,
  query: NotificationListQueryInput,
): Promise<NotificationListResult> {
  const [total, unreadCount, records] = await Promise.all([
    prisma.notification.count({ where: { userId } }),
    prisma.notification.count({ where: { userId, readAt: null } }),
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    items: records.map((record) => ({
      id: record.id,
      type: record.type,
      title: record.title,
      body: record.body,
      data: record.data as NotificationView["data"],
      readAt: record.readAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
    })),
    unreadCount,
    total,
  };
}

export async function markNotificationRead(userId: string, notificationId: string): Promise<void> {
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
  });
  if (!notification) {
    throw new ApiError(404, "AUTHORIZATION_ERROR", "That notification could not be found.");
  }
  await prisma.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function getUnreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}
