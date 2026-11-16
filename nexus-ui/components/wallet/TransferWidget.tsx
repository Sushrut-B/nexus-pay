"use client";

import { useState } from "react";
import { PaymentAccount, PaymentRail, PaymentResult } from "@/lib/raft/types";
import { getCurrencySymbol, formatCurrency } from "@/lib/utils";
import { Send, Zap, CheckCircle2, AlertTriangle, Clock } from "lucide-react";

interface TransferWidgetProps {
  sourceAccount: PaymentAccount | null;
  accounts: PaymentAccount[];
  onSettlementComplete: () => void;
}

const RAILS: { id: PaymentRail; label: string; desc: string; badgeColor: string }[] = [
  { id: "FEDNOW", label: "⚡ FedNow", desc: "US Federal Reserve", badgeColor: "text-emerald-400 border-emerald-500/30" },
  { id: "SEPA_INSTANT", label: "🇪🇺 SEPA Inst", desc: "EU SCT Inst", badgeColor: "text-blue-400 border-blue-500/30" },
  { id: "UPI", label: "🇮🇳 UPI", desc: "India Real-Time", badgeColor: "text-amber-400 border-amber-500/30" },
  { id: "FASTER_PAYMENTS", label: "🇬🇧 Faster Pay", desc: "UK Instant Rails", badgeColor: "text-purple-400 border-purple-500/30" },
  { id: "INTERNAL_BOOK", label: "📖 Book Transfer", desc: "Internal Ledger", badgeColor: "text-cyan-400 border-cyan-500/30" },
];

export function TransferWidget({
  sourceAccount,
  accounts,
  onSettlementComplete,
}: TransferWidgetProps) {
  const [selectedRail, setSelectedRail] = useState<PaymentRail>("FEDNOW");
  const [destinationAccountId, setDestinationAccountId] = useState<string>("");
  const [amountStr, setAmountStr] = useState<string>("50.00");
  const [description, setDescription] = useState<string>("Invoice settlement via Nexus Clearing");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<{ result: PaymentResult | null; latencyMs: number; error: string | null } | null>(null);

  const currency = sourceAccount?.currency || "USD";
  const currencySym = getCurrencySymbol(currency);
  const maxAvailableDollars = ((sourceAccount?.availableBalanceCents || 0) / 100).toFixed(2);

  // Available destinations (excluding active source)
  const destinationOptions = accounts.filter(
    (a) => a.accountId !== sourceAccount?.accountId
  );

  function handleQuickAmount(addDollars: number) {
    const cur = parseFloat(amountStr) || 0;
    setAmountStr((cur + addDollars).toFixed(2));
  }

  function handleMaxAmount() {
    setAmountStr(maxAvailableDollars);
  }

  async function handleSubmitPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!sourceAccount) return;

    const targetDest = destinationAccountId || (destinationOptions[0]?.accountId ?? "");
    if (!targetDest) {
      alert("Please select a destination account.");
      return;
    }

    const amt = parseFloat(amountStr);
    if (isNaN(amt) || amt <= 0) {
      alert("Please enter a valid transfer amount.");
      return;
    }

    const amtCents = Math.round(amt * 100);
    const idempKey = `pmt_${selectedRail.toLowerCase()}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    setIsSubmitting(true);
    setLastResult(null);
    const start = performance.now();

    try {
      const res = await fetch("/api/raft/payments/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: idempKey,
          rail: selectedRail,
          sourceAccountId: sourceAccount.accountId,
          destinationAccountId: targetDest,
          amountCents: amtCents,
          currency: sourceAccount.currency,
          description: description,
        }),
      });

      const latencyMs = Math.round(performance.now() - start);
      const data = await res.json();

      if (res.ok && data.status === "SETTLED") {
        setLastResult({ result: data as PaymentResult, latencyMs, error: null });
        onSettlementComplete();
      } else {
        setLastResult({
          result: data,
          latencyMs,
          error: data.rejectionReason || data.error || "Payment declined by consensus rules",
        });
        onSettlementComplete();
      }
    } catch (err: unknown) {
      const latencyMs = Math.round(performance.now() - start);
      setLastResult({
        result: null,
        latencyMs,
        error: err instanceof Error ? err.message : "Network error",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="p-5 rounded-2xl bg-[#101725] border border-[#263244] space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-sm text-white flex items-center gap-2">
          <Zap className="w-4 h-4 text-[#10B981]" />
          <span>Instant Real-Time Transfer</span>
        </h3>
        <span className="text-[11px] font-mono text-[#94A3B8]">
          Quorum Commit (§5.4.2)
        </span>
      </div>

      <form onSubmit={handleSubmitPayment} className="space-y-4">
        {/* Payment Rail Selector */}
        <div>
          <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">
            Instant Payment Rail
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {RAILS.map((r) => {
              const isSelected = selectedRail === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedRail(r.id)}
                  className={`p-2.5 rounded-xl border text-left transition-all ${
                    isSelected
                      ? "bg-[#141E2D] border-[#06B6D4] shadow-md shadow-[#06B6D4]/10"
                      : "bg-[#080C14]/60 border-[#263244] hover:border-[#334155]"
                  }`}
                >
                  <div className="text-xs font-semibold text-white truncate">
                    {r.label}
                  </div>
                  <div className="text-[10px] text-[#94A3B8] truncate mt-0.5">
                    {r.desc}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Destination Account */}
        <div>
          <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">
            Destination Recipient
          </label>
          <select
            value={destinationAccountId || (destinationOptions[0]?.accountId ?? "")}
            onChange={(e) => setDestinationAccountId(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl bg-[#080C14] border border-[#263244] text-xs text-white focus:outline-none focus:border-[#10B981] transition-colors"
          >
            {destinationOptions.length === 0 ? (
              <option value="">No other accounts found</option>
            ) : (
              destinationOptions.map((acc) => (
                <option key={acc.accountId} value={acc.accountId}>
                  {acc.metadata?.holder || acc.accountId} ({acc.accountId}) — {acc.currency}
                </option>
              ))
            )}
          </select>
        </div>

        {/* Amount Input & Quick Chips */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-[#94A3B8]">
              Amount ({currencySym})
            </label>
            <span className="text-[11px] text-[#94A3B8] font-mono">
              Available: {currencySym}{maxAvailableDollars}
            </span>
          </div>

          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-[#94A3B8]">
              {currencySym}
            </span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              className="w-full pl-8 pr-4 py-2.5 rounded-xl bg-[#080C14] border border-[#263244] text-sm font-semibold text-white focus:outline-none focus:border-[#10B981] transition-colors font-mono"
            />
          </div>

          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <button
              type="button"
              onClick={() => handleQuickAmount(10)}
              className="px-2.5 py-1 rounded-lg bg-[#141E2D] hover:bg-[#1E293B] border border-[#263244] text-[11px] font-mono text-[#94A3B8] hover:text-white transition-colors"
            >
              +{currencySym}10
            </button>
            <button
              type="button"
              onClick={() => handleQuickAmount(25)}
              className="px-2.5 py-1 rounded-lg bg-[#141E2D] hover:bg-[#1E293B] border border-[#263244] text-[11px] font-mono text-[#94A3B8] hover:text-white transition-colors"
            >
              +{currencySym}25
            </button>
            <button
              type="button"
              onClick={() => handleQuickAmount(100)}
              className="px-2.5 py-1 rounded-lg bg-[#141E2D] hover:bg-[#1E293B] border border-[#263244] text-[11px] font-mono text-[#94A3B8] hover:text-white transition-colors"
            >
              +{currencySym}100
            </button>
            <button
              type="button"
              onClick={handleMaxAmount}
              className="px-2.5 py-1 rounded-lg bg-[#06B6D4]/10 hover:bg-[#06B6D4]/20 border border-[#06B6D4]/30 text-[11px] font-mono text-[#38BDF8] font-semibold transition-colors"
            >
              Max Available
            </button>
          </div>
        </div>

        {/* Remittance Description */}
        <div>
          <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">
            Remittance Note / Reference
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl bg-[#080C14] border border-[#263244] text-xs text-white focus:outline-none focus:border-[#10B981] transition-colors"
          />
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isSubmitting || !sourceAccount}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-[#10B981] to-[#059669] text-white font-semibold text-xs tracking-wide uppercase flex items-center justify-center gap-2 hover:brightness-110 active:scale-[0.99] transition-all shadow-lg shadow-[#10B981]/25 disabled:opacity-50"
        >
          <Send className="w-3.5 h-3.5" />
          <span>{isSubmitting ? "Committing to Raft Quorum..." : "Execute Instant Settlement"}</span>
        </button>
      </form>

      {/* Live Settlement Receipt Banner */}
      {lastResult && (
        <div
          className={`p-4 rounded-xl border text-xs font-mono space-y-1.5 ${
            lastResult.result?.status === "SETTLED"
              ? "bg-[#10B981]/10 border-[#10B981]/40 text-[#34D399]"
              : "bg-[#F43F5E]/10 border-[#F43F5E]/40 text-[#FB7185]"
          }`}
        >
          <div className="flex items-center justify-between font-sans font-bold">
            <span className="flex items-center gap-1.5">
              {lastResult.result?.status === "SETTLED" ? (
                <CheckCircle2 className="w-4 h-4 text-[#10B981]" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-[#F43F5E]" />
              )}
              {lastResult.result?.status === "SETTLED" ? "SETTLED INSTANTLY" : "TRANSACTION REJECTED"}
            </span>
            <span className="flex items-center gap-1 text-[11px] text-[#94A3B8]">
              <Clock className="w-3 h-3" />
              <span>{lastResult.latencyMs}ms consensus latency</span>
            </span>
          </div>

          {lastResult.result?.status === "SETTLED" ? (
            <div className="space-y-0.5 text-[11px] text-white/90">
              <div>Payment Ref: <strong className="text-white">{lastResult.result.paymentRef}</strong></div>
              <div>Raft Log Index: <strong className="text-[#38BDF8]">#{lastResult.result.raftLogIndex}</strong></div>
              <div>
                Debtor Balance: {formatCurrency(lastResult.result.sourceBalanceAfter, currency)} | Creditor Balance: {formatCurrency(lastResult.result.destinationBalanceAfter, currency)}
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-[#FB7185]">
              Reason: <strong>{lastResult.error || "Overdraft prevented by double-entry invariant."}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

