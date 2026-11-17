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
  ScheduledExecutionView,
  ScheduledPaymentView,
  ScheduleFrequency,
} from "@nexus/shared-types";
import { SCHEDULE_FREQUENCIES, SCHEDULE_STATUS_LABELS, EXECUTION_STATUS_LABELS } from "@nexus/shared-types";
import { CalendarClock, Plus } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { formatDateTime, formatMoney } from "@/lib/format";

export function ScheduledView() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [frequency, setFrequency] = useState<ScheduleFrequency>("MONTHLY");
  const [startDate, setStartDate] = useState(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const schedules = useQuery({
    queryKey: ["finance", "scheduled"],
    queryFn: () => apiFetch<{ items: ScheduledPaymentView[] }>("/api/scheduled-payments"),
  });

  const actions = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "pause" | "resume" | "cancel" | "run" }) =>
      apiFetch(action === "run" ? "/api/scheduled-payments/run" : `/api/scheduled-payments/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["finance", "scheduled"] });
      void queryClient.invalidateQueries({ queryKey: ["finance", "executions"] });
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Schedule updated");
    },
    onError: (failure) => toast.error(failure instanceof ApiClientError ? failure.message : "Could not update schedule."),
  });

  const create = useMutation({
    mutationFn: () => {
      const parsed = Number(amount);
      if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed * 100)) {
        throw new Error("Enter a valid payment amount.");
      }
      return apiFetch<ScheduledPaymentView>("/api/scheduled-payments", {
        method: "POST",
        body: JSON.stringify({
          recipientQuery: recipient,
          amountMinor: Math.round(parsed * 100),
          description: description.trim() || undefined,
          frequency,
          startDate: new Date(`${startDate}T09:00:00.000Z`).toISOString(),
        }),
      });
    },
    onSuccess: () => {
      setShowForm(false);
      setRecipient(""); setAmount(""); setDescription(""); setError(null);
      void queryClient.invalidateQueries({ queryKey: ["finance", "scheduled"] });
      void queryClient.invalidateQueries({ queryKey: ["finance", "events"] });
      toast.success("Payment scheduled");
    },
    onError: (failure) => setError(failure instanceof ApiClientError || failure instanceof Error ? failure.message : "Could not schedule payment."),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Scheduled payments</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
            Payments on your terms.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Nexus Pay schedules transfers inside its simulated environment. This is not a bank mandate or UPI AutoPay.
          </p>
        </div>
        <Button onClick={() => setShowForm((value) => !value)}><Plus className="h-4 w-4" aria-hidden="true" /> Schedule payment</Button>
      </div>

      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New scheduled payment</CardTitle>
            <CardDescription>Recipient and wallet accounts are resolved securely on the server.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="schedule-recipient">Recipient</Label>
                <Input id="schedule-recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="@username, email or mobile" className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="schedule-amount">Amount (INR)</Label>
                <Input id="schedule-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="1000" className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="schedule-frequency">Frequency</Label>
                <select id="schedule-frequency" value={frequency} onChange={(e) => setFrequency(e.target.value as ScheduleFrequency)} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
                  {SCHEDULE_FREQUENCIES.map((value) => <option key={value} value={value}>{value.toLowerCase()}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor="schedule-start">First execution date</Label>
                <Input id="schedule-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1.5" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="schedule-description">Description (optional)</Label>
                <Input id="schedule-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} className="mt-1.5" />
              </div>
            </div>
            {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
            <Button disabled={recipient.trim().length < 3 || create.isPending} onClick={() => create.mutate()}>Create schedule</Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => actions.mutate({ id: "run", action: "run" })} disabled={actions.isPending}>
          Run due payments now
        </Button>
        <Button asChild variant="ghost" size="sm"><Link href="/scheduled/recurring">Recurring suggestions</Link></Button>
      </div>

      {(schedules.data?.items ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center">
            <CalendarClock className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium">No scheduled payments</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">Schedule a future transfer and its execution will be handled by the server.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {schedules.data?.items.map((schedule) => (
            <Card key={schedule.id}>
              <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="text-base">To {schedule.recipient.displayName}</CardTitle>
                  <CardDescription>
                    {schedule.frequency.toLowerCase()} · next {formatDateTime(schedule.nextExecutionAt)}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={schedule.status === "ACTIVE" ? "success" : schedule.status === "REQUIRES_ATTENTION" ? "warning" : "secondary"}>
                    {SCHEDULE_STATUS_LABELS[schedule.status]}
                  </Badge>
                  <p className="font-display text-lg font-semibold text-navy">{formatMoney(schedule.amountMinor, schedule.currency)}</p>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  {schedule.executionCount} executed{schedule.maxExecutions ? ` of ${schedule.maxExecutions}` : ""}
                  {schedule.lastExecution ? ` · last: ${EXECUTION_STATUS_LABELS[schedule.lastExecution.status]}` : ""}
                </p>
                <div className="flex flex-wrap gap-2">
                  {schedule.status === "ACTIVE" ? (
                    <Button size="sm" variant="outline" onClick={() => actions.mutate({ id: schedule.id, action: "pause" })}>Pause</Button>
                  ) : schedule.status === "PAUSED" || schedule.status === "REQUIRES_ATTENTION" ? (
                    <Button size="sm" variant="outline" onClick={() => actions.mutate({ id: schedule.id, action: "resume" })}>Resume</Button>
                  ) : null}
                  {!["CANCELLED", "COMPLETED"].includes(schedule.status) ? (
                    <Button size="sm" variant="ghost" onClick={() => actions.mutate({ id: schedule.id, action: "cancel" })}>Cancel</Button>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => setExpanded(expanded === schedule.id ? null : schedule.id)}>
                    {expanded === schedule.id ? "Hide history" : "Execution history"}
                  </Button>
                </div>
                {expanded === schedule.id ? <ExecutionHistory scheduleId={schedule.id} /> : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ExecutionHistory({ scheduleId }: { scheduleId: string }) {
  const executions = useQuery({
    queryKey: ["finance", "executions", scheduleId],
    queryFn: () => apiFetch<{ items: ScheduledExecutionView[] }>(`/api/scheduled-payments/${encodeURIComponent(scheduleId)}/executions`),
  });
  return (
    <div className="rounded-xl border border-border/70 bg-background/60 p-3">
      <p className="mb-2 text-xs font-semibold">Execution history</p>
      {(executions.data?.items ?? []).length === 0 ? (
        <p className="text-xs text-muted-foreground">No executions yet.</p>
      ) : (
        <div className="divide-y divide-border/70">
          {executions.data?.items.map((execution) => (
            <div key={execution.id} className="flex items-center justify-between gap-3 py-2 text-xs">
              <span>{formatDateTime(execution.scheduledFor)}</span>
              <Badge variant={execution.status === "SETTLED" ? "success" : execution.status === "FAILED" ? "danger" : "warning"}>
                {EXECUTION_STATUS_LABELS[execution.status]}
              </Badge>
              {execution.paymentRef ? (
                <Link href={`/transactions/${encodeURIComponent(execution.paymentRef)}`} className="font-medium text-primary underline-offset-4 hover:underline">Receipt</Link>
              ) : (
                <span className="text-muted-foreground">Attempt {execution.attemptCount}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
