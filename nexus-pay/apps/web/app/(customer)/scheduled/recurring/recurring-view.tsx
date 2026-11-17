"use client";

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
import type { RecurringSuggestionView } from "@nexus/shared-types";
import { RECURRING_FREQUENCY_LABELS } from "@nexus/shared-types";
import { Repeat2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { formatDateTime, formatMoney } from "@/lib/format";

export function RecurringView() {
  const queryClient = useQueryClient();
  const suggestions = useQuery({
    queryKey: ["finance", "recurring"],
    queryFn: () => apiFetch<{ items: RecurringSuggestionView[] }>("/api/recurring/suggestions"),
  });

  const action = useMutation({
    mutationFn: ({ id, verb }: { id: string; verb: "confirm" | "ignore" }) =>
      apiFetch(`/api/recurring/suggestions/${encodeURIComponent(id)}/${verb}`, { method: "POST", body: "{}" }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["finance", "recurring"] });
      void queryClient.invalidateQueries({ queryKey: ["finance", "scheduled"] });
      toast.success(variables.verb === "confirm" ? "Schedule created from suggestion" : "Suggestion ignored");
    },
    onError: (error) => toast.error(error instanceof ApiClientError ? error.message : "Could not update suggestion."),
  });

  const items = (suggestions.data?.items ?? []).filter((item) => item.status === "SUGGESTED");

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/scheduled">← Scheduled payments</Link>
        </Button>
        <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-primary">Recurring payments</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
          Patterns, not promises.
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          These are suggestions detected from your confirmed payment history. Nothing is scheduled automatically, and an observed pattern is not an active mandate.
        </p>
      </div>

      {suggestions.isError ? (
        <Alert variant="destructive"><AlertDescription>Could not load recurring suggestions.</AlertDescription></Alert>
      ) : null}

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center">
            <Repeat2 className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium">No recurring patterns yet</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              Make repeated payments to the same person at similar intervals and we will suggest a pattern here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((suggestion) => (
            <Card key={suggestion.id}>
              <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="text-base">
                    {suggestion.counterpartyUsername ? `@${suggestion.counterpartyUsername}` : suggestion.counterparty}
                  </CardTitle>
                  <CardDescription>{suggestion.explanation}</CardDescription>
                </div>
                <Badge variant="info">{suggestion.confidence}% confidence</Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3 text-sm">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Estimated amount</p>
                    <p className="font-semibold">{formatMoney(suggestion.amountMinor, suggestion.currency)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Suggested frequency</p>
                    <p className="font-semibold">{RECURRING_FREQUENCY_LABELS[suggestion.suggestedFrequency]}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Last observed</p>
                    <p className="font-semibold">{formatDateTime(suggestion.lastObservedAt)}</p>
                  </div>
                </div>
                {suggestion.nextExpectedAt ? (
                  <p className="text-xs text-muted-foreground">
                    Estimated next date: {formatDateTime(suggestion.nextExpectedAt)} (not confirmed)
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => action.mutate({ id: suggestion.id, verb: "confirm" })} disabled={action.isPending}>
                    Create schedule
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => action.mutate({ id: suggestion.id, verb: "ignore" })} disabled={action.isPending}>
                    Ignore
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
