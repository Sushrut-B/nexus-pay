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
} from "@nexus/ui";
import type { RequestView } from "@nexus/shared-types";
import { PAYMENT_REQUEST_STATUS_LABELS } from "@nexus/shared-types";
import { ArrowLeft, Check, Send, X } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";

export function RequestDetailView({
  initialRequest,
  viewerId,
}: {
  initialRequest: RequestView;
  viewerId: string;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const requestQuery = useQuery({
    queryKey: ["request", initialRequest.id],
    queryFn: () => apiFetch<RequestView>(`/api/requests/${encodeURIComponent(initialRequest.id)}`),
    initialData: initialRequest,
    refetchInterval: 20_000,
  });
  const request = requestQuery.data;

  const act = useMutation({
    mutationFn: (action: "accept" | "decline" | "cancel" | "pay") =>
      apiFetch(`/api/requests/${encodeURIComponent(request.id)}/${action}`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: (_data, action) => {
      setConfirming(false);
      void requestQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ["requests"] });
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success(action === "pay" ? "Payment completed." : `Request ${action}ed.`);
    },
    onError: (error) =>
      toast.error(error instanceof ApiClientError ? error.message : "Could not update the request."),
  });

  const isPayer = request.payer.userId === viewerId;
  const counterparty = isPayer ? request.requester : request.payer;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/requests">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Payment requests
        </Link>
      </Button>

      <Card>
        <CardHeader className="items-center text-center">
          <Badge variant="info">{PAYMENT_REQUEST_STATUS_LABELS[request.status]}</Badge>
          <CardTitle className="pt-2 font-display text-3xl font-semibold text-navy">
            {formatMoney(request.amountMinor, request.currency)}
          </CardTitle>
          <CardDescription>
            {isPayer ? `${request.requester.displayName} requested this from you` : `You requested this from ${request.payer.displayName}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-xl border border-border bg-secondary/40 px-4 py-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{isPayer ? "From" : "Payer"}</span>
              <span className="font-medium">@{counterparty.username}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Note</span>
              <span className="text-right font-medium">{request.description ?? "No note"}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Created</span>
              <span className="font-medium">{formatDateTime(request.createdAt)}</span>
            </div>
            {request.dueAt ? (
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Due</span>
                <span className="font-medium">{formatDate(request.dueAt)}</span>
              </div>
            ) : null}
            {request.groupName ? (
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Group</span>
                <span className="font-medium">{request.groupName}</span>
              </div>
            ) : null}
            {request.paymentRef ? (
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Payment</span>
                <Link href={`/transactions/${encodeURIComponent(request.paymentRef)}`} className="font-mono text-xs text-primary underline-offset-4 hover:underline">
                  {request.paymentRef}
                </Link>
              </div>
            ) : null}
          </div>

          {request.status === "EXPIRED" ? (
            <Alert variant="warning">
              <AlertDescription>This request has expired and cannot be paid.</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {request.canAccept ? (
              <Button onClick={() => act.mutate("accept")} disabled={act.isPending}>
                <Check className="h-4 w-4" aria-hidden="true" /> Accept request
              </Button>
            ) : null}
            {request.canPay ? (
              <Button onClick={() => setConfirming(true)} disabled={act.isPending}>
                <Send className="h-4 w-4" aria-hidden="true" /> Review &amp; pay
              </Button>
            ) : null}
            {request.canDecline ? (
              <Button variant="outline" onClick={() => act.mutate("decline")} disabled={act.isPending}>
                <X className="h-4 w-4" aria-hidden="true" /> Decline
              </Button>
            ) : null}
            {request.canCancel ? (
              <Button variant="ghost" onClick={() => act.mutate("cancel")} disabled={act.isPending}>
                Cancel request
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {confirming ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy/40 p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-base">Confirm payment</CardTitle>
              <CardDescription>
                You are paying {request.requester.displayName} ({formatMoney(request.amountMinor, request.currency)})
                through the existing Nexus Pay settlement flow. Accepting alone never moves money.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setConfirming(false)}>Not now</Button>
              <Button className="flex-1" disabled={act.isPending} onClick={() => act.mutate("pay")}>Confirm and pay</Button>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
