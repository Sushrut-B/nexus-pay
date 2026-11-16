"use client";

import { useState } from "react";
import { PaymentAccount, PaymentResult } from "@/lib/raft/types";
import { formatCurrency, getCurrencySymbol } from "@/lib/utils";
import { Lock, CheckCircle2, AlertTriangle, ShieldCheck } from "lucide-react";

interface AuthorizationFormProps {
  accounts: PaymentAccount[];
  onHoldCreated: () => void;
}

export function AuthorizationForm({ accounts, onHoldCreated }: AuthorizationFormProps) {
  const [sourceId, setSourceId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [amountStr, setAmountStr] = useState("120.00");
  const [description, setDescription] = useState("Grand Hotel Room Pre-Authorization (2 Nights)");
  const [ttlHours, setTtlHours] = useState(24);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<{ result: PaymentResult | null; error: string | null } | null>(null);

  const customerAccounts = accounts;
  const merchantAccounts = accounts;

  const activeCustomer = accounts.find((a) => a.accountId === (sourceId || accounts[0]?.accountId));
  const activeMerchant = accounts.find((a) => a.accountId === (destinationId || accounts[1]?.accountId));
  const currency = activeCustomer?.currency || "USD";
  const currencySym = getCurrencySymbol(currency);

  async function handleAuthorize(e: React.FormEvent) {
    e.preventDefault();
    const debtor = sourceId || accounts[0]?.accountId;
    const creditor = destinationId || accounts[1]?.accountId;

    if (!debtor || !creditor) {
      alert("Please select customer and merchant accounts.");
      return;
    }
    if (debtor === creditor) {
      alert("Customer and merchant accounts must be distinct.");
      return;
    }

    const amt = parseFloat(amountStr);
    if (isNaN(amt) || amt <= 0) {
      alert("Please enter a valid authorization amount.");
      return;
    }

    const amtCents = Math.round(amt * 100);
    const holdId = `hld_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const idempKey = `auth_${holdId}`;
    const ttlMillis = ttlHours * 3600 * 1000;

    setIsSubmitting(true);
    setLastResult(null);

    try {
      const res = await fetch("/api/raft/payments/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: idempKey,
          holdId: holdId,
          rail: "INTERNAL_BOOK",
          sourceAccountId: debtor,
          destinationAccountId: creditor,
          amountCents: amtCents,
          currency: currency,
          ttlMillis: ttlMillis,
          description: description,
        }),
      });

      const data = await res.json();
      if (res.ok && data.status === "AUTHORIZED") {
        setLastResult({ result: data as PaymentResult, error: null });
        onHoldCreated();
      } else {
        setLastResult({
          result: null,
          error: data.rejectionReason || data.error || "Pre-authorization hold declined",
        });
      }
    } catch (err: unknown) {
      setLastResult({
        result: null,
        error: err instanceof Error ? err.message : "Network error",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="p-5 rounded-2xl bg-[#101725] border border-[#263244] space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-sm text-white flex items-center gap-2">
          <Lock className="w-4 h-4 text-[#F59E0B]" />
          <span>Stage 1: Pre-Authorization Hold Reservation</span>
        </h3>
        <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[#F59E0B]/15 text-[#FBBF24] border border-[#F59E0B]/30">
          Two-Phase Locking
        </span>
      </div>

      <p className="text-xs text-[#94A3B8] leading-relaxed">
        Reserves customer funds in consensus state without debiting gross book balance.
        Guarantees solvency for subsequent merchant capture.
      </p>

      <form onSubmit={handleAuthorize} className="space-y-3.5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Customer */}
          <div>
            <label className="block text-xs font-medium text-[#94A3B8] mb-1">
              Customer Account (Debtor)
            </label>
            <select
              value={sourceId || (accounts[0]?.accountId ?? "")}
              onChange={(e) => setSourceId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-[#080C14] border border-[#263244] text-xs text-white focus:outline-none focus:border-[#F59E0B]"
            >
              {customerAccounts.map((a) => (
                <option key={a.accountId} value={a.accountId}>
                  {a.metadata?.holder || a.accountId} (Avail: {formatCurrency(a.availableBalanceCents, a.currency)})
                </option>
              ))}
            </select>
          </div>

          {/* Merchant */}
          <div>
            <label className="block text-xs font-medium text-[#94A3B8] mb-1">
              Merchant / Escrow (Creditor)
            </label>
            <select
              value={destinationId || (accounts[1]?.accountId ?? "")}
              onChange={(e) => setDestinationId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-[#080C14] border border-[#263244] text-xs text-white focus:outline-none focus:border-[#F59E0B]"
            >
              {merchantAccounts.map((a) => (
                <option key={a.accountId} value={a.accountId}>
                  {a.metadata?.holder || a.accountId} ({a.accountId})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Amount */}
          <div>
            <label className="block text-xs font-medium text-[#94A3B8] mb-1">
              Hold Amount ({currencySym})
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-[#080C14] border border-[#263244] text-xs font-mono font-semibold text-white focus:outline-none focus:border-[#F59E0B]"
            />
          </div>

          {/* TTL */}
          <div>
            <label className="block text-xs font-medium text-[#94A3B8] mb-1">
              Hold Expiry TTL
            </label>
            <select
              value={ttlHours}
              onChange={(e) => setTtlHours(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-xl bg-[#080C14] border border-[#263244] text-xs text-white focus:outline-none focus:border-[#F59E0B]"
            >
              <option value={1}>1 Hour</option>
              <option value={12}>12 Hours</option>
              <option value={24}>24 Hours (Standard Hotel/Rental)</option>
              <option value={72}>72 Hours</option>
            </select>
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-medium text-[#94A3B8] mb-1">
            Merchant Reservation Reference / Description
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 rounded-xl bg-[#080C14] border border-[#263244] text-xs text-white focus:outline-none focus:border-[#F59E0B]"
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#F59E0B] to-[#D97706] text-white font-semibold text-xs uppercase tracking-wide flex items-center justify-center gap-2 hover:brightness-110 active:scale-[0.99] transition-all shadow-md shadow-[#F59E0B]/20 disabled:opacity-50"
        >
          <Lock className="w-3.5 h-3.5" />
          <span>{isSubmitting ? "Locking Reservation in WAL..." : "Authorize Reservation Hold"}</span>
        </button>
      </form>

      {/* Result feedback */}
      {lastResult && (
        <div
          className={`p-3 rounded-xl border text-xs font-mono ${
            lastResult.result
              ? "bg-[#10B981]/10 border-[#10B981]/40 text-[#34D399]"
              : "bg-[#F43F5E]/10 border-[#F43F5E]/40 text-[#FB7185]"
          }`}
        >
          {lastResult.result ? (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#10B981] shrink-0" />
              <div>
                <strong>✓ HOLD AUTHORIZED (Raft Log #{lastResult.result.raftLogIndex})</strong>
                <div className="text-[11px] text-white/80">
                  Ref: {lastResult.result.paymentRef} | Debtor Available Balance: {formatCurrency(lastResult.result.sourceBalanceAfter, currency)}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-[#F43F5E] shrink-0" />
              <span><strong>HOLD REJECTED:</strong> {lastResult.error}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

