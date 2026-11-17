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
import type {
  PaymentRequestStatus,
  RequestListResult,
  RequestSummary,
  RequestView,
} from "@nexus/shared-types";
import { PAYMENT_REQUEST_STATUS_LABELS, parseMajorToMinor } from "@nexus/shared-types";
import { Check, Clock3, Plus, Search, Send, X } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { formatDate, formatMoney } from "@/lib/format";

const STATUS_TONE: Record<PaymentRequestStatus, "info" | "success" | "danger" | "warning" | "secondary"> = {
  PENDING: "info",
  ACCEPTED: "warning",
  DECLINED: "danger",
  PAID: "success",
  CANCELLED: "secondary",
  EXPIRED: "secondary",
};

export function RequestsView({
  summary,
  initialReceived,
  initialSent,
  initialRecipientQuery,
  initialDirection,
}: {
  summary: RequestSummary;
  initialReceived: RequestListResult;
  initialSent: RequestListResult;
  initialRecipientQuery: string;
  initialDirection: "received" | "sent";
}) {
  const queryClient = useQueryClient();
  const [direction, setDirection] = useState<"received" | "sent">(initialDirection);
  const [status, setStatus] = useState<PaymentRequestStatus | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(Boolean(initialRecipientQuery));
  const [recipient, setRecipient] = useState(initialRecipientQuery);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<RequestView | null>(null);

  const summaryQuery = useQuery({
    queryKey: ["requests", "summary"],
    queryFn: () => apiFetch<RequestSummary>("/api/requests/summary"),
    initialData: summary,
  });

  const listKey = ["requests", direction, status] as const;
  const list = useQuery({
    queryKey: listKey,
    queryFn: () =>
      apiFetch<RequestListResult>(
        `/api/requests?direction=${direction}${status === "ALL" ? "" : `&status=${status}`}`,
      ),
    initialData: direction === "received" && status === "ALL" ? initialReceived : initialSent,
    refetchOnMount: "always",
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["requests"] });
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  const create = useMutation({
    mutationFn: () => {
      const parsed = parseMajorToMinor(amount);
      if (!parsed.ok) {
        throw new Error(
          parsed.reason === "NON_POSITIVE"
            ? "Enter an amount greater than zero."
            : "Enter a valid amount with up to two decimal places.",
        );
      }
      return apiFetch<RequestView>("/api/requests", {
        method: "POST",
        body: JSON.stringify({
          payerQuery: recipient,
          amountMinor: parsed.amountMinor,
          description: description.trim() || undefined,
          dueAt: dueAt ? new Date(`${dueAt}T23:59:59.000Z`).toISOString() : undefined,
        }),
      });
    },
    onSuccess: () => {
      setDirection("sent");
      setShowCreate(false);
      setRecipient("");
      setAmount("");
      setDescription("");
      setDueAt("");
      setFormError(null);
      refresh();
      toast.success("Request sent.");
    },
    onError: (error) =>
      setFormError(
        error instanceof ApiClientError || error instanceof Error
          ? error.message
          : "Could not send the request.",
      ),
  });

  const act = useMutation({
    mutationFn: ({ request, action }: { request: RequestView; action: "accept" | "decline" | "cancel" | "pay" }) =>
      apiFetch<RequestView | { request: RequestView; paymentStatus: string }>(
        `/api/requests/${encodeURIComponent(request.id)}/${action}`,
        { method: "POST", body: "{}" },
      ),
    onSuccess: (result, variables) => {
      setConfirming(null);
      refresh();
      toast.success(
        variables.action === "pay"
          ? (result as { paymentStatus: string }).paymentStatus === "SETTLED"
            ? "Payment completed."
            : "Payment is being verified."
          : `${variables.action[0]!.toUpperCase()}${variables.action.slice(1)}ed.`,
      );
    },
    onError: (error) =>
      toast.error(error instanceof ApiClientError ? error.message : "Could not update the request."),
  });

  const items = (list.data?.items ?? []).filter((request) => {
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return [
      request.requester.displayName,
      request.payer.displayName,
      request.requester.username,
      request.payer.username,
      request.description ?? "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Money requests
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
            Ask, pay and track.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            A request is a message, not a debit. Payment always needs your explicit confirmation.
          </p>
        </div>
        <Button onClick={() => setShowCreate((value) => !value)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New request
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SummaryCard label="Waiting for you" value={summaryQuery.data?.receivedPendingCount ?? 0} sub={formatMoney(summaryQuery.data?.receivedPendingMinor ?? 0, "INR")} tone="primary" />
        <SummaryCard label="Waiting on others" value={summaryQuery.data?.sentPendingCount ?? 0} sub={formatMoney(summaryQuery.data?.sentPendingMinor ?? 0, "INR")} tone="neutral" />
      </div>

      {showCreate ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Request money</CardTitle>
            <CardDescription>Enter an exact Nexus Pay handle, email or mobile number.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="request-recipient">Request from</Label>
                <Input id="request-recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="@username or email" className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="request-amount">Amount (INR)</Label>
                <Input id="request-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="request-description">What is it for?</Label>
                <Input id="request-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Shared cab" maxLength={200} className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="request-due">Due date (optional)</Label>
                <Input id="request-due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="mt-1.5" />
              </div>
            </div>
            {formError ? (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}
            <Button disabled={recipient.trim().length < 3 || create.isPending} onClick={() => create.mutate()}>
              <Send className="h-4 w-4" aria-hidden="true" />
              {create.isPending ? "Sending…" : "Send request"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div className="flex gap-1 rounded-xl border border-border bg-secondary/40 p-1">
            {(["received", "sent"] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={direction === value ? "default" : "ghost"}
                onClick={() => setDirection(value)}
              >
                {value === "received" ? "Received" : "Sent"}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filter by status"
              value={status}
              onChange={(event) => setStatus(event.target.value as PaymentRequestStatus | "ALL")}
              className="h-9 rounded-lg border border-input bg-background px-2.5 text-xs"
            >
              <option value="ALL">All statuses</option>
              {(Object.keys(PAYMENT_REQUEST_STATUS_LABELS) as PaymentRequestStatus[]).map((value) => (
                <option key={value} value={value}>{PAYMENT_REQUEST_STATUS_LABELS[value]}</option>
              ))}
            </select>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" aria-label="Search requests" className="h-9 w-40 pl-8 text-xs" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-5 py-12 text-center">
              <Clock3 className="mx-auto h-7 w-7 text-muted-foreground/50" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-foreground">Nothing here yet</p>
              <p className="mt-1 text-xs text-muted-foreground">Requests you create or receive will appear here.</p>
            </div>
          ) : (
            <div className="divide-y divide-border/70">
              {items.map((request) => (
                <div key={request.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/requests/${encodeURIComponent(request.id)}`} className="block truncate text-sm font-semibold hover:text-primary">
                      {direction === "received" ? request.requester.displayName : request.payer.displayName}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {request.description ?? "No note"} · {formatDate(request.createdAt)}
                      {request.groupName ? ` · ${request.groupName}` : ""}
                    </p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-foreground">
                    {formatMoney(request.amountMinor, request.currency)}
                  </p>
                  <Badge variant={STATUS_TONE[request.status]}>
                    {PAYMENT_REQUEST_STATUS_LABELS[request.status]}
                  </Badge>
                  <div className="flex gap-1">
                    {request.canAccept ? (
                      <Button size="sm" onClick={() => act.mutate({ request, action: "accept" })} disabled={act.isPending}>
                        <Check className="h-3.5 w-3.5" aria-hidden="true" /> Accept
                      </Button>
                    ) : null}
                    {request.canPay ? (
                      <Button size="sm" onClick={() => setConfirming(request)} disabled={act.isPending}>
                        <Send className="h-3.5 w-3.5" aria-hidden="true" /> Pay
                      </Button>
                    ) : null}
                    {request.canDecline ? (
                      <Button size="sm" variant="ghost" onClick={() => act.mutate({ request, action: "decline" })} disabled={act.isPending}>
                        <X className="h-3.5 w-3.5" aria-hidden="true" /> Decline
                      </Button>
                    ) : null}
                    {request.canCancel ? (
                      <Button size="sm" variant="ghost" onClick={() => act.mutate({ request, action: "cancel" })} disabled={act.isPending}>
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {confirming ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy/40 p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-base">Confirm this payment</CardTitle>
              <CardDescription>
                Paying {confirming.requester.displayName} (@{confirming.requester.username}){" "}
                {formatMoney(confirming.amountMinor, confirming.currency)} through Nexus Pay. The
                ledger must confirm before this request is marked paid.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setConfirming(null)}>Not now</Button>
              <Button className="flex-1" disabled={act.isPending} onClick={() => act.mutate({ request: confirming, action: "pay" })}>
                Confirm and pay
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function SummaryCard({ label, value, sub, tone }: { label: string; value: number; sub: string; tone: "primary" | "neutral" }) {
  return (
    <Card className={tone === "primary" ? "border-primary/20 bg-accent/40" : ""}>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
          <p className="mt-1 font-display text-2xl font-semibold text-navy">{value}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
        </div>
        <Badge variant={tone === "primary" ? "info" : "secondary"}>Pending</Badge>
      </CardContent>
    </Card>
  );
}
