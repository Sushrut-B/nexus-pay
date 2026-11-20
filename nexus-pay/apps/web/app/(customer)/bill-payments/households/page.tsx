"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import { toast } from "sonner";

interface Household {
  id: string; name: string; ownerId: string; members: Array<{ id: string; userId: string; role: string }>;
}

export default function HouseholdsPage() {
  const queryClient = useQueryClient();
  const households = useQuery({ queryKey: ["billing", "households"], queryFn: () => apiFetch<{ items: Household[] }>("/api/households") });
  const [name, setName] = useState("");
  const [invitee, setInvitee] = useState("");
  const [activeId, setActiveId] = useState("");
  const create = useMutation({
    mutationFn: () => apiFetch("/api/households", { method: "POST", body: JSON.stringify({ name }) }),
    onSuccess: () => { setName(""); void queryClient.invalidateQueries({ queryKey: ["billing", "households"] }); },
  });
  const invite = useMutation({
    mutationFn: () => apiFetch(`/api/households/${activeId}/invitations`, { method: "POST", body: JSON.stringify({ userId: invitee, role: "MEMBER" }) }),
    onSuccess: () => { setInvitee(""); toast.success("Member added"); void queryClient.invalidateQueries({ queryKey: ["billing", "households"] }); },
    onError: () => toast.error("Could not add the member"),
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Household</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Household bills</h1>
      </div>
      <p className="text-xs text-muted-foreground">Sharing a bill records responsibility only. It never moves money, creates a group debt, or authorises another member to pay.</p>
      <Card>
        <CardHeader><CardTitle className="text-base">Create a household</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div><Label htmlFor="name">Name</Label><Input id="name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 w-56" /></div>
          <Button disabled={name.length < 2 || create.isPending} onClick={() => create.mutate()}>Create</Button>
        </CardContent>
      </Card>
      {(households.data?.items ?? []).map((household) => (
        <Card key={household.id}>
          <CardHeader><CardTitle className="text-base">{household.name}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="text-xs text-muted-foreground">
              {household.members.map((member) => <span key={member.id} className="mr-3">{member.role}: {member.userId.slice(-8)}</span>)}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <input type="hidden" value={household.id} onChange={() => setActiveId(household.id)} />
              <div><Label>Invite user ID</Label><Input value={invitee} onChange={(e) => { setInvitee(e.target.value); setActiveId(household.id); }} className="mt-1.5 w-64" /></div>
              <Button size="sm" variant="outline" disabled={invitee.length < 2 || invite.isPending} onClick={() => invite.mutate()}>Add member</Button>
            </div>
          </CardContent>
        </Card>
      ))}
      {(households.data?.items ?? []).length === 0 ? <Card><CardContent className="py-10 text-center text-xs text-muted-foreground">No households yet.</CardContent></Card> : null}
    </div>
  );
}
