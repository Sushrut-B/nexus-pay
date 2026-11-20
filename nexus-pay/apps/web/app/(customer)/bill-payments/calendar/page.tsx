"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { BillReminderView, RecurringBillView } from "@nexus/shared-types";
import { apiFetch } from "@/lib/api/client";

export default function BillCalendarPage() {
  const reminders = useQuery({ queryKey: ["billing", "reminders"], queryFn: () => apiFetch<{ items: BillReminderView[] }>("/api/bill-payments/reminders") });
  const recurring = useQuery({ queryKey: ["billing", "recurring"], queryFn: () => apiFetch<{ items: RecurringBillView[] }>("/api/bill-payments/recurring") });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Calendar</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Bill calendar & recurring bills</h1>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Upcoming reminders</CardTitle></CardHeader>
          <CardContent>
            {(reminders.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No reminders yet.</p> : (
              <div className="divide-y divide-border/70">
                {reminders.data?.items.map((item) => (
                  <div key={item.id} className="flex justify-between py-2 text-xs">
                    <span>{item.kind}</span>
                    <span className="text-muted-foreground">{new Date(item.dueAt).toLocaleDateString("en-IN")} · {item.status}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Recurring bills</CardTitle></CardHeader>
          <CardContent>
            {(recurring.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No recurring bills detected from confirmed history.</p> : (
              <div className="divide-y divide-border/70">
                {recurring.data?.items.map((item) => (
                  <div key={item.id} className="flex justify-between py-2 text-xs">
                    <span>{item.pattern}</span>
                    <span className="text-muted-foreground">{item.confirmedByUser ? "Confirmed" : "Detected"} · {item.nextExpectedDate ? new Date(item.nextExpectedDate).toLocaleDateString("en-IN") : "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
