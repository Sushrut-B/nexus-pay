import { prisma } from "@nexus/database";
import type { AdminCreateInput, AdminRoleUpdateInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { hashPassword } from "@/lib/security/passwords";
import { recordAdminAudit } from "@/lib/control/audit";

export async function listAdmins() {
  const admins = await prisma.adminUser.findMany({
    orderBy: [{ role: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      email: true,
      username: true,
      role: true,
      isActive: true,
      createdAt: true,
      lastLoginAt: true,
    },
  });
  return admins.map((admin) => ({
    ...admin,
    createdAt: admin.createdAt.toISOString(),
    lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
  }));
}

export async function createAdmin(
  input: AdminCreateInput,
  actor: { id: string; email: string; roleName: string },
  requestId: string,
) {
  const admin = await prisma.adminUser.create({
    data: {
      email: input.email.toLowerCase(),
      username: input.username.toLowerCase(),
      passwordHash: await hashPassword(input.password),
      role: input.role,
    },
  });
  await recordAdminAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    actorRole: actor.roleName,
    action: "ADMIN_ACCOUNT_CREATED",
    targetType: "admin_user",
    targetId: admin.id,
    requestId,
    outcome: "SUCCESS",
    metadata: { role: admin.role },
  });
  return { id: admin.id, email: admin.email, username: admin.username, role: admin.role, isActive: admin.isActive };
}

export async function updateAdmin(
  id: string,
  input: AdminRoleUpdateInput,
  actor: { id: string; email: string; roleName: string },
  requestId: string,
) {
  if (actor.roleName !== "SUPER_ADMIN") {
    throw new ApiError(403, "AUTHORIZATION_ERROR", "Only a super admin can change roles.");
  }
  const existing = await prisma.adminUser.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "AUTHORIZATION_ERROR", "That administrator could not be found.");
  if (existing.id === actor.id && (input.role !== "SUPER_ADMIN" || input.isActive === false)) {
    throw new ApiError(409, "AUTHORIZATION_ERROR", "You cannot demote or disable your own account.");
  }
  const updated = await prisma.adminUser.update({
    where: { id },
    data: { role: input.role, isActive: input.isActive },
  });
  await recordAdminAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    actorRole: actor.roleName,
    action: "ADMIN_ROLE_CHANGED",
    targetType: "admin_user",
    targetId: id,
    requestId,
    outcome: "SUCCESS",
    metadata: { role: updated.role, isActive: updated.isActive },
  });
  return { id: updated.id, email: updated.email, username: updated.username, role: updated.role, isActive: updated.isActive };
}
