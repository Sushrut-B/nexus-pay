"use client";

import { PaymentResult, PaymentHold, PaymentAccount } from "@/lib/raft/types";
import { formatCurrency } from "@/lib/utils";
import { DollarSign, ArrowLeftRight, Lock, AlertTriangle, Users, Layers } from "lucide-react";

interface TreasuryMetricsProps {
  transactions: PaymentResult[];
  holds: PaymentHold[];
  accounts: PaymentAccount[];
  commitIndex: number;
}

export function TreasuryMetrics({
  transactions,
  holds,
  accounts,
  commitIndex,
}: TreasuryMetricsProps) {
  const settledTxs = transactions.filter(
    (t) => t.status === "SETTLED" || t.status === "CAPTURED"
  );
  const totalSettledCents = settledTxs.reduce((sum, t) => sum + (t.amountCents || 0), 0);
  const rejectedCount = transactions.filter((t) => t.status === "REJECTED").length;
  const activeHoldsCount = holds.filter((h) => h.status === "AUTHORIZED").length;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {/* 1. Settled Volume */}
      <div className="p-4 rounded-xl bg-[#101725] border border-[#263244] space-y-1">
        <div className="flex items-center justify-between text-[11px] text-[#94A3B8]">
          <span className="font-semibold uppercase tracking-wider">Settled Volume</span>
          <DollarSign className="w-3.5 h-3.5 text-[#10B981]" />
        </div>
        <div className="text-xl font-bold text-[#34D399] font-mono">
          {formatCurrency(totalSettledCents, "USD")}
        </div>
        <div className="text-[10px] text-[#94A3B8]">Gross cleared funds</div>
      </div>

      {/* 2. Total Transactions */}
      <div className="p-4 rounded-xl bg-[#101725] border border-[#263244] space-y-1">
        <div className="flex items-center justify-between text-[11px] text-[#94A3B8]">
          <span className="font-semibold uppercase tracking-wider">Total Txs</span>
          <ArrowLeftRight className="w-3.5 h-3.5 text-[#06B6D4]" />
        </div>
        <div className="text-xl font-bold text-white font-mono">
          {transactions.length}
        </div>
        <div className="text-[10px] text-[#94A3B8]">{settledTxs.length} settled</div>
      </div>

      {/* 3. Active Holds */}
      <div className="p-4 rounded-xl bg-[#101725] border border-[#263244] space-y-1">
        <div className="flex items-center justify-between text-[11px] text-[#94A3B8]">
          <span className="font-semibold uppercase tracking-wider">Active Holds</span>
          <Lock className="w-3.5 h-3.5 text-[#F59E0B]" />
        </div>
        <div className="text-xl font-bold text-[#FBBF24] font-mono">
          {activeHoldsCount}
        </div>
        <div className="text-[10px] text-[#94A3B8]">Pre-auth reservations</div>
      </div>

      {/* 4. Rejected */}
      <div className="p-4 rounded-xl bg-[#101725] border border-[#263244] space-y-1">
        <div className="flex items-center justify-between text-[11px] text-[#94A3B8]">
          <span className="font-semibold uppercase tracking-wider">Rejected Invariants</span>
          <AlertTriangle className="w-3.5 h-3.5 text-[#F43F5E]" />
        </div>
        <div className="text-xl font-bold text-[#FB7185] font-mono">
          {rejectedCount}
        </div>
        <div className="text-[10px] text-[#94A3B8]">Overdrafts blocked</div>
      </div>

      {/* 5. Total Accounts */}
      <div className="p-4 rounded-xl bg-[#101725] border border-[#263244] space-y-1">
        <div className="flex items-center justify-between text-[11px] text-[#94A3B8]">
          <span className="font-semibold uppercase tracking-wider">Accounts</span>
          <Users className="w-3.5 h-3.5 text-[#8B5CF6]" />
        </div>
        <div className="text-xl font-bold text-[#A78BFA] font-mono">
          {accounts.length}
        </div>
        <div className="text-[10px] text-[#94A3B8]">Ledger entities</div>
      </div>

      {/* 6. Commit Index */}
      <div className="p-4 rounded-xl bg-[#101725] border border-[#263244] space-y-1">
        <div className="flex items-center justify-between text-[11px] text-[#94A3B8]">
          <span className="font-semibold uppercase tracking-wider">Consensus Commit</span>
          <Layers className="w-3.5 h-3.5 text-[#38BDF8]" />
        </div>
        <div className="text-xl font-bold text-[#38BDF8] font-mono">
          #{commitIndex}
        </div>
        <div className="text-[10px] text-[#94A3B8]">Quorum WAL index</div>
      </div>
    </div>
  );
}

