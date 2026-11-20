"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { DeviceView } from "@nexus/shared-types";
import { apiFetch } from "@/lib/api/client";
import { toast } from "sonner";

export default function SecurityDevicesPage() {
  const queryClient = useQueryClient();
  const devices = useQuery({ queryKey: ["security", "devices"], queryFn: () => apiFetch<{ items: DeviceView[] }>("/api/security/devices") });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => apiFetch(`/api/security/devices/${encodeURIComponent(id)}`, { method: "PATCH", body }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["security", "devices"] }); toast.success("Device updated"); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/security/devices/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["security", "devices"] }); toast.success("Device removed"); },
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Devices</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Trusted devices</h1>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Known devices</CardTitle></CardHeader>
        <CardContent>
          {(devices.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No devices recorded yet.</p> : (
            <div className="divide-y divide-border/70">
              {devices.data?.items.map((device) => (
                <div key={device.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="font-medium">{device.description} {device.current ? "(current)" : ""}</p>
                    <p className="text-xs text-muted-foreground">First seen {new Date(device.firstSeen).toLocaleDateString("en-IN")} · {device.trusted ? "Trusted" : "Not trusted"}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => update.mutate({ id: device.deviceId, body: JSON.stringify({ deviceId: device.deviceId, trusted: !device.trusted }) })}>
                      {device.trusted ? "Remove trust" : "Trust"}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(device.deviceId)}>Remove</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
