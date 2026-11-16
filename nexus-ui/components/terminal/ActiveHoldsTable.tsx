"use client";

import { useState } from "react";
import { PaymentHold } from "@/lib/raft/types";
import { formatCurrency, formatDate } from "@/lib/utils";
import { CheckCircle2, XCircle, Clock, RefreshCw, AlertCircle } from "lucide-react";

interface ActiveHoldsTableProps {
  holds: PaymentHold[];
  isLoading: boolean;
  onHoldActionComplete: () => void;
}

export function ActiveHoldsTable({
  holds,
  isLoading,
  onHoldActionComplete,
}: ActiveHoldsTableProps) {
  const [selectedHold, setSelectedHold] = useState<{ hold: PaymentHold; action: "CAPTURE" | "VOID" } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const activeHolds = holds.filter((h) => h.status === "AUTHORIZED");

  async function handleConfirmAction() {
    if (!selectedHold) return;
    setIsProcessing(true);
    setActionError(null);

    const { hold, action } = selectedHold;

    try {
      if (action === "CAPTURE") {
        const res = await fetch("/api/raft/payments/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            holdId: hold.holdId,
            idempotencyKey: `cap_${hold.holdId}`,
          }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Capture failed");
        }
      } else {
        const res = await fetch("/api/raft/payments/void", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            holdId: hold.holdId,
          }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Void failed");
        }
      }

      setSelectedHold(null);
      onHoldActionComplete();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setIsProcessing(false);
    }
  }

  function formatTtl(expiresAt: number): string {
    const diff = expiresAt - Date.now();
    if (diff <= 0) return "EXPIRED";
    const hrs = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${hrs}h ${mins}m left`;
  }

  return (
    <div className="p-5 rounded-2xl bg-[#101725] border border-[#263244] space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-sm text-white">
            Active Pre-Authorization Holds
          </h3>
          <p className="text-xs text-[#94A3B8] mt-0.5">
            Stage 2 settlement: Capture into operating funds or Void to release reservation.
          </p>
        </div>
        <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-[#141E2D] border border-[#263244] text-[#94A3B8]">
          {activeHolds.length} Active
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#263244]">
        <table className="w-full text-left text-xs font-mono">
          <thead className="bg-[#080C14] text-[#94A3B8] uppercase text-[10px] tracking-wider border-b border-[#263244]">
            <tr>
              <th className="py-3 px-3.5">Hold ID / Created</th>
              <th className="py-3 px-3.5">Customer (Debtor)</th>
              <th className="py-3 px-3.5">Merchant (Creditor)</th>
              <th className="py-3 px-3.5">Reserved Amount</th>
              <th className="py-3 px-3.5">Remaining TTL</th>
              <th className="py-3 px-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#263244] bg-[#0A0F1A]">
            {activeHolds.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-[#94A3B8] font-sans">
                  {isLoading ? "Loading reservation holds..." : "No active authorization holds recorded."}
                </td>
              </tr>
            ) : (
              activeHolds.map((h) => (
                <tr key={h.holdId} className="hover:bg-[#141E2D]/50 transition-colors">
                  <td className="py-3 px-3.5">
                    <div className="font-semibold text-white">{h.holdId}</div>
                    <div className="text-[10px] text-[#94A3B8] mt-0.5">
                      {formatDate(h.createdAt)}
                    </div>
                  </td>
                  <td className="py-3 px-3.5 text-white">{h.sourceAccountId}</td>
                  <td className="py-3 px-3.5 text-[#38BDF8]">{h.destinationAccountId}</td>
                  <td className="py-3 px-3.5 font-bold text-[#FBBF24]">
                    {formatCurrency(h.amountCents, h.currency)}
                  </td>
                  <td className="py-3 px-3.5">
                    <span className="flex items-center gap-1 text-[11px] text-[#94A3B8]">
                      <Clock className="w-3 h-3 text-[#F59E0B]" />
                      <span>{formatTtl(h.expiresAt)}</span>
                    </span>
                  </td>
                  <td className="py-3 px-3.5 text-right">
                    <div className="flex items-center justify-end gap-1.5 font-sans">
                      <button
                        onClick={() => setSelectedHold({ hold: h, action: "CAPTURE" })}
                        className="px-2.5 py-1 rounded-lg bg-[#10B981]/15 hover:bg-[#10B981]/25 text-[#34D399] border border-[#10B981]/30 text-[11px] font-semibold transition-colors"
                      >
                        Capture
                      </button>
                      <button
                        onClick={() => setSelectedHold({ hold: h, action: "VOID" })}
                        className="px-2.5 py-1 rounded-lg bg-[#F43F5E]/15 hover:bg-[#F43F5E]/25 text-[#FB7185] border border-[#F43F5E]/30 text-[11px] font-semibold transition-colors"
                      >
                        Void
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Confirmation Modal */}
      {selectedHold && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-md p-6 rounded-2xl bg-[#101725] border border-[#263244] shadow-2xl space-y-4">
            <h4 className="text-base font-bold text-white flex items-center gap-2">
              {selectedHold.action === "CAPTURE" ? (
                <>
                  <CheckCircle2 className="w-5 h-5 text-[#10B981]" />
                  <span>Confirm Settlement Capture</span>
                </>
              ) : (
                <>
                  <XCircle className="w-5 h-5 text-[#F43F5E]" />
                  <span>Confirm Void Reservation</span>
                </>
              )}
            </h4>

            <p className="text-xs text-[#94A3B8] leading-relaxed">
              {selectedHold.action === "CAPTURE"
                ? `You are about to capture ${formatCurrency(
                    selectedHold.hold.amountCents,
                    selectedHold.hold.currency
                  )} from ${selectedHold.hold.sourceAccountId} into ${
                    selectedHold.hold.destinationAccountId
                  }'s operating ledger. This operation is finalized in the consensus WAL.`
                : `You are about to void the reservation of ${formatCurrency(
                    selectedHold.hold.amountCents,
                    selectedHold.hold.currency
                  )}. Funds will be returned to ${
                    selectedHold.hold.sourceAccountId
                  }'s available balance immediately.`}
            </p>

            {actionError && (
              <div className="p-3 rounded-lg bg-[#F43F5E]/15 border border-[#F43F5E]/30 text-[#FB7185] text-xs">
                {actionError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSelectedHold(null)}
                disabled={isProcessing}
                className="px-4 py-2 rounded-xl bg-[#141E2D] hover:bg-[#1E293B] text-xs font-semibold text-white border border-[#263244]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmAction}
                disabled={isProcessing}
                className={`px-4 py-2 rounded-xl text-xs font-semibold text-white shadow-lg ${
                  selectedHold.action === "CAPTURE"
                    ? "bg-[#10B981] hover:bg-[#059669]"
                    : "bg-[#F43F5E] hover:bg-[#E11D48]"
                }`}
              >
                {isProcessing
                  ? "Committing..."
                  : selectedHold.action === "CAPTURE"
                  ? "Yes, Capture Funds"
                  : "Yes, Void Hold"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

