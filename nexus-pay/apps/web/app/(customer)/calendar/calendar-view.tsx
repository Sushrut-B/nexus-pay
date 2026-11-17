"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@nexus/ui";
import type { CalendarEventView } from "@nexus/shared-types";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";

const EVENT_TONE: Record<CalendarEventView["type"], "info" | "success" | "warning" | "secondary"> = {
  SCHEDULED_PAYMENT: "info",
  BUDGET_PERIOD: "secondary",
  SAVINGS_GOAL: "success",
  RECURRING_ESTIMATE: "warning",
};

export function CalendarView() {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  });
  const [filter, setFilter] = useState<CalendarEventView["type"] | "ALL">("ALL");

  const from = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const to = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)).getUTCDate()).padStart(2, "0")}`;

  const events = useQuery({
    queryKey: ["finance", "events", from, to],
    queryFn: () => apiFetch<{ items: CalendarEventView[] }>(`/api/calendar/events?from=${from}&to=${to}`),
  });

  const visible = (events.data?.items ?? []).filter((event) => filter === "ALL" || event.type === filter);
  const grouped = new Map<string, CalendarEventView[]>();
  for (const event of visible) {
    const day = event.date.slice(0, 10);
    grouped.set(day, [...(grouped.get(day) ?? []), event]);
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Calendar</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
          What&apos;s coming up.
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Scheduled payments, budget boundaries and goal dates. Estimated recurring dates are labelled clearly.
        </p>
      </div>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">
              {new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(cursor)}
            </CardTitle>
            <CardDescription>{visible.length} event{visible.length === 1 ? "" : "s"} in this view</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filter events"
              value={filter}
              onChange={(e) => setFilter(e.target.value as CalendarEventView["type"] | "ALL")}
              className="h-9 rounded-lg border border-input bg-background px-2.5 text-xs"
            >
              <option value="ALL">All events</option>
              <option value="SCHEDULED_PAYMENT">Scheduled payments</option>
              <option value="BUDGET_PERIOD">Budget periods</option>
              <option value="SAVINGS_GOAL">Savings goals</option>
              <option value="RECURRING_ESTIMATE">Recurring estimates</option>
            </select>
            <Button size="sm" variant="outline" aria-label="Previous month" onClick={() => setCursor(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - 1, 1)))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" aria-label="Next month" onClick={() => setCursor(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1)))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {visible.length === 0 ? (
            <div className="py-14 text-center">
              <CalendarDays className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium">Nothing scheduled</p>
              <p className="mt-1 text-xs text-muted-foreground">Create a scheduled payment or a savings goal to see dates here.</p>
              <Button asChild size="sm" variant="outline" className="mt-4"><Link href="/scheduled">Schedule a payment</Link></Button>
            </div>
          ) : (
            <div className="space-y-4">
              {[...grouped.entries()].map(([day, dayEvents]) => (
                <div key={day}>
                  <p className="mb-2 text-xs font-semibold text-muted-foreground">{formatDate(day)}</p>
                  <div className="space-y-2">
                    {dayEvents.map((event) => (
                      <div key={event.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 px-4 py-3">
                        <Badge variant={EVENT_TONE[event.type]}>
                          {event.type === "RECURRING_ESTIMATE" ? "Estimated" : event.type === "SCHEDULED_PAYMENT" ? "Scheduled" : event.type === "SAVINGS_GOAL" ? "Goal" : "Budget"}
                        </Badge>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{event.title}</p>
                          <p className="text-[11px] text-muted-foreground">{formatDateTime(event.date)}</p>
                        </div>
                        {event.amountMinor !== null ? (
                          <p className="text-sm font-semibold tabular-nums">{formatMoney(event.amountMinor, "INR")}</p>
                        ) : null}
                        {event.type === "SCHEDULED_PAYMENT" ? (
                          <Button asChild size="sm" variant="ghost"><Link href="/scheduled">View</Link></Button>
                        ) : null}
                      </div>
                    ))}
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
