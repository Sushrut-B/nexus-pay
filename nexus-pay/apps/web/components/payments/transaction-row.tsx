import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Landmark } from "lucide-react";
import type { TransactionSummary } from "@nexus/shared-types";
import { TransactionStatusBadge } from "@/components/payments/status-badge";
import { formatDateTime, formatMoney } from "@/lib/format";

export function TransactionRow({ transaction }: { transaction: TransactionSummary }) {
  const incoming = transaction.direction === "RECEIVED";
  const Icon = transaction.kind === "FUNDING" ? Landmark : incoming ? ArrowDownLeft : ArrowUpRight;
  const reference = transaction.paymentRef ?? transaction.id;

  return (
    <Link
      href={`/transactions/${encodeURIComponent(reference)}`}
      className="group flex items-center gap-4 rounded-xl px-2 py-3 transition-colors hover:bg-secondary/60"
      aria-label={`Open transaction ${reference}`}
    >
      <span
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
          transaction.kind === "FUNDING"
            ? "bg-accent text-primary"
            : incoming
              ? "bg-emerald-50 text-emerald-700"
              : "bg-secondary text-navy"
        }`}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">
          {transaction.counterpartyName ??
            (transaction.kind === "FUNDING" ? "Simulated sandbox funding" : "Nexus Pay customer")}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {transaction.description ??
            (transaction.kind === "FUNDING" ? "SIMULATED SANDBOX FUNDING" : "Nexus Pay transfer")}{" "}
          · {formatDateTime(transaction.occurredAt)}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p
          className={`text-sm font-semibold tabular-nums ${
            incoming ? "text-emerald-700" : "text-foreground"
          }`}
        >
          {incoming ? "+" : "−"}
          {formatMoney(transaction.amountMinor, transaction.currency)}
        </p>
        <div className="mt-1 flex justify-end">
          <TransactionStatusBadge status={transaction.status} />
        </div>
      </div>
    </Link>
  );
}
