"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@nexus/ui";
import type { ContactListResult, ContactView } from "@nexus/shared-types";
import {
  ArrowRight,
  Search,
  Send,
  Trash2,
  UserPlus,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { formatDate, initials } from "@/lib/format";

export function ContactsView({ initialContacts }: { initialContacts: ContactListResult }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [label, setLabel] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const contactsQuery = useQuery({
    queryKey: ["contacts"],
    queryFn: () => apiFetch<ContactListResult>("/api/contacts"),
    initialData: initialContacts,
  });

  const add = useMutation({
    mutationFn: () =>
      apiFetch<ContactView>("/api/contacts", {
        method: "POST",
        body: JSON.stringify({ query, displayLabel: label.trim() || undefined }),
      }),
    onSuccess: (contact) => {
      void queryClient.invalidateQueries({ queryKey: ["contacts"] });
      setQuery("");
      setLabel("");
      setFormError(null);
      toast.success(`${contact.user.displayName} added to contacts`);
    },
    onError: (error) =>
      setFormError(
        error instanceof ApiClientError ? error.message : "Could not add that contact.",
      ),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/contacts/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["contacts"] });
      setPendingDelete(null);
      toast.success("Contact removed");
    },
    onError: (error) =>
      toast.error(error instanceof ApiClientError ? error.message : "Could not remove contact."),
  });

  const items = (contactsQuery.data?.items ?? []).filter((contact) => {
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return [contact.user.displayName, contact.user.username, contact.displayLabel ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Your people</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
          Contacts
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The Nexus Pay customers you pay and share expenses with most.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">All contacts</CardTitle>
                <CardDescription>
                  {contactsQuery.data?.total ?? 0} saved · alphabetical order
                </CardDescription>
              </div>
              <div className="relative w-full max-w-[220px]">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search contacts"
                  aria-label="Search contacts"
                  className="pl-9"
                />
              </div>
            </CardHeader>
            <CardContent>
              {contactsQuery.isFetching ? (
                <p className="py-8 text-center text-xs text-muted-foreground">Refreshing…</p>
              ) : items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-5 py-12 text-center">
                  <UserPlus className="mx-auto h-7 w-7 text-muted-foreground/50" aria-hidden="true" />
                  <p className="mt-3 text-sm font-medium text-foreground">
                    {search ? "No contacts match that search" : "No contacts yet"}
                  </p>
                  <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                    Add someone by their exact Nexus Pay username, email address or mobile number.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border/70">
                  {items.map((contact) => (
                    <div key={contact.id} className="flex items-center gap-3 py-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary text-sm font-semibold text-navy">
                        {initials(contact.user.displayName)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/contacts/${encodeURIComponent(contact.id)}`}
                          className="block truncate text-sm font-semibold text-foreground hover:text-primary"
                        >
                          {contact.displayLabel ?? contact.user.displayName}
                        </Link>
                        <p className="truncate text-xs text-muted-foreground">
                          @{contact.user.username}
                          {contact.recentInteractionAt
                            ? ` · last payment ${formatDate(contact.recentInteractionAt)}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`/send?to=${encodeURIComponent(contact.user.username)}`}>
                            <Send className="h-3.5 w-3.5" aria-hidden="true" />
                            Send
                          </Link>
                        </Button>
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`/requests?to=${encodeURIComponent(contact.user.username)}`}>
                            <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
                            Request
                          </Link>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Remove ${contact.user.displayName}`}
                          onClick={() => setPendingDelete(contact.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add a contact</CardTitle>
              <CardDescription>
                Search by exact username, registered email or mobile number.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="contact-query">Nexus Pay user</Label>
                <Input
                  id="contact-query"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setFormError(null);
                  }}
                  placeholder="@username, email or mobile"
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="contact-label">Label (optional)</Label>
                <Input
                  id="contact-label"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="e.g. Flatmate"
                  maxLength={60}
                  className="mt-1.5"
                />
              </div>
              {formError ? (
                <Alert variant="destructive">
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              ) : null}
              <Button
                className="w-full"
                disabled={query.trim().length < 3 || add.isPending}
                onClick={() => add.mutate()}
              >
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                {add.isPending ? "Adding…" : "Add contact"}
              </Button>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Only display names and handles are stored. Ledger account details are never shared.
              </p>
            </CardContent>
          </Card>

          <Card className="border-primary/15 bg-accent/40">
            <CardContent className="flex items-start gap-3 p-5">
              <ArrowRight className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-foreground">Sharing is easier together</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Create a group to record shared expenses and settle up later with a real payment.
                </p>
                <Button asChild variant="outline" size="sm" className="mt-3">
                  <Link href="/groups">Split expenses</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {pendingDelete ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy/40 p-4">
          <Card className="w-full max-w-sm">
            <CardHeader>
              <CardTitle className="text-base">Remove this contact?</CardTitle>
              <CardDescription>
                They will leave your contact list. Shared group history and payments stay intact.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setPendingDelete(null)}
                disabled={remove.isPending}
              >
                Keep contact
              </Button>
              <Button className="flex-1" onClick={() => remove.mutate(pendingDelete)} disabled={remove.isPending}>
                Remove
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
