import { prisma } from "@nexus/database";
import type { DeviceView, SessionView } from "@nexus/shared-types";
import { hashDevice, hashIp } from "@/lib/fraud/event-service";
import { securityAudit } from "@/lib/fraud/audit-service";

/** Records a device sighting. `deviceId` is client-generated (not a browser fingerprint). */
export async function recordDeviceActivity(input: {
  userId: string;
  deviceId: string;
  description?: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  sessionId?: string;
}) {
  const existing = await prisma.deviceRecord.findUnique({
    where: { userId_deviceId: { userId: input.userId, deviceId: input.deviceId } },
  });
  const isNew = !existing;
  await prisma.deviceRecord.upsert({
    where: { userId_deviceId: { userId: input.userId, deviceId: input.deviceId } },
    create: {
      userId: input.userId,
      deviceId: input.deviceId,
      description: (input.description ?? "Unknown device").slice(0, 200),
      userAgentHash: hashDevice(input.userAgent),
      ipHash: hashIp(input.ipAddress),
      lastSessionId: input.sessionId ?? null,
    },
    update: {
      lastSeen: new Date(),
      userAgentHash: hashDevice(input.userAgent),
      ipHash: hashIp(input.ipAddress),
      lastSessionId: input.sessionId ?? null,
    },
  });
  if (isNew) {
    await prisma.trustedDevice.upsert({
      where: { userId_deviceId: { userId: input.userId, deviceId: input.deviceId } },
      create: {
        userId: input.userId, deviceId: input.deviceId,
        label: (input.description ?? "New device").slice(0, 160),
      },
      update: {},
    });
  }
  return { isNew, deviceId: input.deviceId };
}

export async function listDevices(userId: string, currentDeviceId?: string | null): Promise<DeviceView[]> {
  const [devices, trusted] = await Promise.all([
    prisma.deviceRecord.findMany({ where: { userId }, orderBy: { lastSeen: "desc" }, take: 100 }),
    prisma.trustedDevice.findMany({ where: { userId } }),
  ]);
  const trustById = new Map(trusted.map((item) => [item.deviceId, item]));
  return devices.map((device) => ({
    id: device.id,
    deviceId: device.deviceId,
    description: device.description,
    firstSeen: device.firstSeen.toISOString(),
    lastSeen: device.lastSeen.toISOString(),
    trusted: trustById.get(device.deviceId)?.trusted ?? false,
    revokedAt: trustById.get(device.deviceId)?.revokedAt?.toISOString() ?? null,
    current: device.deviceId === currentDeviceId,
  }));
}

export async function setDeviceTrust(userId: string, deviceId: string, trusted: boolean, actorId: string) {
  const row = await prisma.trustedDevice.update({
    where: { userId_deviceId: { userId, deviceId } },
    data: { trusted, revokedAt: trusted ? null : new Date() },
  });
  await securityAudit({
    actorType: "USER", actorId, action: trusted ? "DEVICE_TRUSTED" : "DEVICE_UNTRUSTED",
    targetType: "trusted_device", targetId: deviceId,
  });
  return row;
}

export async function removeDevice(userId: string, deviceId: string, actorId: string) {
  await prisma.trustedDevice.deleteMany({ where: { userId, deviceId } });
  await prisma.deviceRecord.deleteMany({ where: { userId, deviceId } });
  await securityAudit({
    actorType: "USER", actorId, action: "DEVICE_REMOVED", targetType: "trusted_device", targetId: deviceId,
  });
  return { deviceId, removed: true };
}

export async function listSessions(userId: string, currentSessionId?: string): Promise<SessionView[]> {
  const sessions = await prisma.userSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: "desc" },
    take: 100,
  });
  const risks = await prisma.userSessionRisk.findMany({ where: { userId } });
  const bySession = new Map(risks.map((risk) => [risk.sessionId, risk]));
  return sessions.map((session) => {
    const risk = bySession.get(session.id);
    return {
      id: session.id,
      sessionId: session.id,
      deviceId: risk?.deviceId ?? null,
      score: risk?.score ?? 0,
      classification: risk?.classification ?? "LOW",
      lastEvaluatedAt: (risk?.lastEvaluatedAt ?? session.lastUsedAt ?? session.createdAt).toISOString(),
      current: session.id === currentSessionId,
    };
  });
}

export async function revokeOtherSessions(userId: string, currentSessionId: string, actorId: string) {
  const result = await prisma.userSession.updateMany({
    where: { userId, id: { not: currentSessionId }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await securityAudit({
    actorType: "USER", actorId, action: "OTHER_SESSIONS_REVOKED",
    targetType: "user_session", targetId: currentSessionId, metadata: { count: result.count },
  });
  return { revoked: result.count };
}
