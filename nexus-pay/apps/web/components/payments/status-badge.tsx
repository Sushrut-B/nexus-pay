import { Badge } from "@nexus/ui";
import {
  TRANSACTION_STATUS_LABELS,
  TRANSACTION_STATUS_TONE,
  type TransactionStatus,
} from "@nexus/shared-types";

const VARIANTS: Record<
  TransactionStatus,
  "info" | "success" | "danger" | "warning"
> = {
  PROCESSING: "info",
  SUCCESSFUL: "success",
  FAILED: "danger",
  RECONCILIATION_REQUIRED: "warning",
};

export function TransactionStatusBadge({ status }: { status: TransactionStatus }) {
  return (
    <Badge variant={VARIANTS[status] ?? TRANSACTION_STATUS_TONE[status]}>
      {status === "PROCESSING" ? (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />
      ) : null}
      {TRANSACTION_STATUS_LABELS[status]}
    </Badge>
  );
}
