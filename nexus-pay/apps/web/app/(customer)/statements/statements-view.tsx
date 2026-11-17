"use client";

import { useState } from "react";
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
import type { StatementFormat, StatementView } from "@nexus/shared-types";
import { STATEMENT_FORMATS } from "@nexus/shared-types";
import { Download, FileText } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { formatDateTime, formatMoney } from "@/lib/format";

export function StatementsView() {
  const queryClient = useQueryClient();
  const [format, setFormat] = useState<StatementFormat>("PDF");
  const [start, setStart] = useState(() => {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  });
  const [end, setEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  const statements = useQuery({
    queryKey: ["finance", "statements"],
    queryFn: () => apiFetch<{ items: StatementView[] }>("/api/statements"),
  });

  const generate = useMutation({
    mutationFn: () =>
      apiFetch<StatementView>("/api/statements/generate", {
        method: "POST",
        body: JSON.stringify({ format, periodStart: start, periodEnd: end }),
      }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["finance", "statements"] });
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Statement is ready");
    },
    onError: (failure) => setError(failure instanceof ApiClientError || failure instanceof Error ? failure.message : "Could not generate statement."),
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Statements</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
          Your records, ready to download.
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Statements include only verified transactions. Opening and closing balances are shown only when they can be reconstructed from ledger receipts.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Generate a statement</CardTitle>
            <CardDescription>Choose a monthly or custom period and an export format.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Format</Label>
              <div className="mt-2 flex gap-2">
                {STATEMENT_FORMATS.map((value) => (
                  <Button key={value} size="sm" variant={format === value ? "default" : "outline"} onClick={() => setFormat(value)}>
                    {value}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="statement-start">Period start</Label>
              <Input id="statement-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="statement-end">Period end</Label>
              <Input id="statement-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1.5" />
            </div>
            {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
            <Button className="w-full" disabled={generate.isPending} onClick={() => generate.mutate()}>
              <FileText className="h-4 w-4" aria-hidden="true" />
              {generate.isPending ? "Generating…" : "Generate statement"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Generated statements</CardTitle>
            <CardDescription>Downloads require authentication and ownership.</CardDescription>
          </CardHeader>
          <CardContent>
            {(statements.data?.items ?? []).length === 0 ? (
              <p className="py-12 text-center text-xs text-muted-foreground">No statements generated yet.</p>
            ) : (
              <div className="space-y-3">
                {statements.data?.items.map((statement) => (
                  <div key={statement.id} className="rounded-xl border border-border/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">
                          {statement.periodStart.slice(0, 10)} → {statement.periodEnd.slice(0, 10)}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatDateTime(statement.createdAt)} · {statement.format}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={statement.status === "READY" ? "success" : statement.status === "FAILED" ? "danger" : "warning"}>
                          {statement.status}
                        </Badge>
                        {statement.status === "READY" ? (
                          <Button asChild size="sm">
                            <a href={`/api/statements/${encodeURIComponent(statement.id)}/download`}>
                              <Download className="h-3.5 w-3.5" aria-hidden="true" />
                              Download {statement.format}
                            </a>
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
                      <div>
                        <p className="text-muted-foreground">Inflow</p>
                        <p className="font-semibold">{formatMoney(statement.totals.inflowMinor, "INR")}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Outflow</p>
                        <p className="font-semibold">{formatMoney(statement.totals.outflowMinor, "INR")}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Net</p>
                        <p className="font-semibold">{formatMoney(statement.totals.netMinor, "INR")}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Transactions</p>
                        <p className="font-semibold">{statement.totals.transactionCount}</p>
                      </div>
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Opening: {statement.totals.openingBalanceAvailable ? formatMoney(statement.totals.openingBalanceMinor ?? 0, "INR") : "Not available"} ·
                      Closing: {statement.totals.closingBalanceAvailable ? formatMoney(statement.totals.closingBalanceMinor ?? 0, "INR") : "Not available"}
                    </p>
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
