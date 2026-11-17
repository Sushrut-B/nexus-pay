"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import { ADMIN_ROLES, type AdminRole } from "@nexus/shared-types";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";

interface AdminRecord {
  id: string; email: string; username: string; role: AdminRole; isActive: boolean;
  createdAt: string; lastLoginAt: string | null;
}

export default function AdminPage() {
  const queryClient = useQueryClient();
  const session = useQuery({ queryKey: ["control", "session"], queryFn: () => apiFetch<{ role: AdminRole }>("/api/control/session") });
  const admins = useQuery({ queryKey: ["control", "admins"], queryFn: () => apiFetch<{ items: AdminRecord[] }>("/api/control/admin") });
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AdminRole>("VIEWER");

  const create = useMutation({
    mutationFn: () => apiFetch("/api/control/admin", { method: "POST", body: JSON.stringify({ email, username, password, role }) }),
    onSuccess: () => {
      setEmail(""); setUsername(""); setPassword("");
      void queryClient.invalidateQueries({ queryKey: ["control", "admins"] });
      toast.success("Administrator created");
    },
    onError: (error) => toast.error(error instanceof ApiClientError ? error.message : "Could not create administrator."),
  });
  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: AdminRole }) =>
      apiFetch("/api/control/admin", { method: "PATCH", body: JSON.stringify({ id, role }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["control", "admins"] }),
    onError: (error) => toast.error(error instanceof ApiClientError ? error.message : "Could not change role."),
  });

  const isSuper = session.data?.role === "SUPER_ADMIN";
  return (
    <div>
      <ControlPageHeader eyebrow="Access control" title="Administration" description="Roles are enforced on the server. Bootstrap credentials come only from environment variables." />
      {admins.isLoading || session.isLoading ? <LoadingState /> : null}
      {!isSuper ? (
        <Card><CardContent className="py-10 text-center text-xs text-slate-600">Only a super admin can manage administrative accounts.</CardContent></Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
          <Card>
            <CardHeader><CardTitle className="text-sm">Create administrator</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div><Label htmlFor="admin-email">Email</Label><Input id="admin-email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5" /></div>
              <div><Label htmlFor="admin-username">Username</Label><Input id="admin-username" value={username} onChange={(e) => setUsername(e.target.value)} className="mt-1.5" /></div>
              <div><Label htmlFor="admin-password">Password</Label><Input id="admin-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5" /></div>
              <div>
                <Label htmlFor="admin-role">Role</Label>
                <select id="admin-role" value={role} onChange={(e) => setRole(e.target.value as AdminRole)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm">
                  {ADMIN_ROLES.map((value) => <option key={value} value={value}>{value.replace("_", " ")}</option>)}
                </select>
              </div>
              <Button disabled={create.isPending} onClick={() => create.mutate()}>Create administrator</Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Administrators</CardTitle></CardHeader>
            <CardContent>
              <div className="divide-y divide-slate-100">
                {admins.data?.items.map((admin) => (
                  <div key={admin.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-slate-900">{admin.email}</p>
                      <p className="text-[10px] text-slate-500">@{admin.username} · created {formatDateTime(admin.createdAt)}</p>
                    </div>
                    <select
                      value={admin.role}
                      onChange={(e) => changeRole.mutate({ id: admin.id, role: e.target.value as AdminRole })}
                      aria-label={`Role for ${admin.email}`}
                      className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs"
                    >
                      {ADMIN_ROLES.map((value) => <option key={value} value={value}>{value.replace("_", " ")}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
