import { Badge } from "@nexus/ui";
import type { WalletStatus } from "@nexus/shared-types";

const LABELS: Record<WalletStatus, string> = {
  PENDING: "Preparing",
  PROVISIONING: "Setting up",
  ACTIVE: "Active",
  FAILED: "Needs attention",
  RECONCILIATION_REQUIRED: "Verification needed",
};

const VARIANTS: Record<
  WalletStatus,
  "default" | "secondary" | "success" | "info" | "warning" | "danger" | "outline"
> = {
  PENDING: "secondary",
  PROVISIONING: "info",
  ACTIVE: "success",
  FAILED: "danger",
  RECONCILIATION_REQUIRED: "warning",
};

export function WalletStatusBadge({
  status,
  className,
}: {
  status: WalletStatus;
  className?: string;
}) {
  return (
    <Badge variant={VARIANTS[status]} className={className}>
      {status === "PROVISIONING" ? (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />
      ) : null}
      {LABELS[status]}
    </Badge>
  );
}

export function walletStatusLabel(status: WalletStatus): string {
  return LABELS[status];
}
