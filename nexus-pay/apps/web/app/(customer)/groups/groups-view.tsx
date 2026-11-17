"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@nexus/ui";
import type { GroupListResult, GroupView } from "@nexus/shared-types";
import { GROUP_CATEGORIES, GROUP_CATEGORY_LABELS } from "@nexus/shared-types";
import { ArrowRight, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { formatDate, formatMoney } from "@/lib/format";

export function GroupsView({ initialGroups }: { initialGroups: GroupListResult }) {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("TRAVEL");
  const [description, setDescription] = useState("");
  const [members, setMembers] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const groups = useQuery({
    queryKey: ["groups"],
    queryFn: () => apiFetch<GroupListResult>("/api/groups"),
    initialData: initialGroups,
  });

  const create = useMutation({
    mutationFn: () =>
      apiFetch<GroupView>("/api/groups", {
        method: "POST",
        body: JSON.stringify({
          name,
          category,
          description: description.trim() || undefined,
          memberQueries: members
            .split(/[\n,]/)
            .map((value) => value.trim())
            .filter(Boolean),
        }),
      }),
    onSuccess: (group) => {
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
      setShowCreate(false);
      setName("");
      setDescription("");
      setMembers("");
      setFormError(null);
      toast.success(`${group.name} created`);
    },
    onError: (error) =>
      setFormError(error instanceof ApiClientError ? error.message : "Could not create the group."),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Split expenses
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
            Shared lives, simplified.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Groups keep trips, homes and everything in between clear — with real payments to settle up.
          </p>
        </div>
        <Button onClick={() => setShowCreate((value) => !value)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New group
        </Button>
      </div>

      {showCreate ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create a group</CardTitle>
            <CardDescription>You become the administrator. Add people now or later.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="group-name">Group name</Label>
                <Input id="group-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Goa Trip 2026" className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="group-category">Category</Label>
                <select id="group-category" value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
                  {GROUP_CATEGORIES.map((value) => (
                    <option key={value} value={value}>{GROUP_CATEGORY_LABELS[value]}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="group-description">Description (optional)</Label>
                <Input id="group-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this group for?" maxLength={400} className="mt-1.5" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="group-members">Add members</Label>
                <textarea
                  id="group-members"
                  value={members}
                  onChange={(e) => setMembers(e.target.value)}
                  placeholder="One exact @username, email or mobile per line"
                  rows={3}
                  className="mt-1.5 w-full rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm outline-none focus-visible:border-primary/60 focus-visible:ring-4 focus-visible:ring-primary/10"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">Separate entries with commas or new lines.</p>
              </div>
            </div>
            {formError ? (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}
            <Button disabled={name.trim().length < 2 || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? "Creating…" : "Create group"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {groups.data?.items.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center">
            <Users className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium text-foreground">No groups yet</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              Start with a trip, a shared home or a dinner. Add expenses and settle up with a real payment.
            </p>
            <Button className="mt-4" onClick={() => setShowCreate(true)}>Create your first group</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.data?.items.map((group) => (
            <Link key={group.id} href={`/groups/${encodeURIComponent(group.id)}`} className="group">
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{group.name}</CardTitle>
                    <Badge variant="secondary">{GROUP_CATEGORY_LABELS[group.category]}</Badge>
                  </div>
                  <CardDescription className="line-clamp-2">
                    {group.description ?? "Shared expenses and settlements"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Users className="h-3.5 w-3.5" aria-hidden="true" /> {group.memberCount} members
                    {group.role === "ADMIN" ? " · You administer" : ""}
                  </p>
                  <BalanceLine netMinor={group.myBalanceMinor} currency="INR" />
                  <p className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{group.lastActivityAt ? `Activity ${formatDate(group.lastActivityAt)}` : "No activity yet"}</span>
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function BalanceLine({ netMinor, currency }: { netMinor: number; currency: string }) {
  if (netMinor === 0) {
    return <p className="text-sm font-semibold text-emerald-700">Everyone is settled</p>;
  }
  return (
    <p className={`text-sm font-semibold ${netMinor > 0 ? "text-emerald-700" : "text-amber-700"}`}>
      {netMinor > 0 ? "You're owed " : "You owe "}
      {formatMoney(Math.abs(netMinor), currency)}
    </p>
  );
}
