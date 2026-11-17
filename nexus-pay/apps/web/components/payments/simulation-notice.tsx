import { FlaskConical } from "lucide-react";
import { SIMULATED_FUNDING_DISCLOSURE } from "@nexus/shared-types";

export function SimulationNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 ${
        compact ? "px-3 py-2.5" : "px-4 py-3"
      }`}
    >
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className={`${compact ? "text-xs" : "text-sm"} leading-relaxed`}>
        <span className="font-semibold">{SIMULATED_FUNDING_DISCLOSURE}.</span>{" "}
        {compact
          ? "Test money only. No bank, UPI or real funds are involved."
          : "Money added here is sandbox test money created on the local Raftline ledger. It is not a bank deposit, UPI transfer, card payment or real-world funds."}
      </p>
    </div>
  );
}
