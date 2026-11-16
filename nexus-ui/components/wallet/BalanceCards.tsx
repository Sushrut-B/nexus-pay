"use client";

import { PaymentAccount } from "@/lib/raft/types";
import { formatCurrency } from "@/lib/utils";
import { ShieldCheck, Lock, Landmark, CheckCircle } from "lucide-react";

interface BalanceCardsProps {
  account: PaymentAccount | null;
  currency: string;
}

export function BalanceCards({ account, currency }: BalanceCardsProps) {
  const availCents = account?.availableBalanceCents ?? 0;
  const resCents = account?.reservedCents ?? 0;
  const totalCents = account?.balanceCents ?? 0;

  const availFormatted = formatCurrency(availCents, currency);
  const resFormatted = formatCurrency(resCents, currency);
  const totalFormatted = formatCurrency(totalCents, currency);

  return (
    <div className="space-y-4">
      {/* 3 Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Available to Settle */}
        <div className="relative p-5 rounded-2xl bg-gradient-to-br from-[#10B981]/10 via-[#141E2D] to-[#101725] border border-[#10B981]/30 shadow-lg shadow-[#10B981]/5 flex flex-col justify-between overflow-hidden">
          <div className="flex items-center justify-between text-xs text-[#94A3B8]">
            <span className="font-semibold tracking-wide uppercase text-[11px]">
              Available To Settle
            </span>
            <div className="flex items-center gap-1 text-[#34D399] font-mono text-[10px] bg-[#10B981]/15 px-2 py-0.5 rounded-full border border-[#10B981]/30">
              <ShieldCheck className="w-3 h-3" />
              <span>ReadIndex</span>
            </div>
          </div>
          <div className="my-3">
            <span className="text-3xl sm:text-4xl font-extrabold text-[#34D399] tracking-tight font-sans drop-shadow-[0_0_15px_rgba(16,185,129,0.3)]">
              {availFormatted}
            </span>
          </div>
          <p className="text-[11px] text-[#94A3B8] font-mono">
            Instantly clearable across payment rails
          </p>
        </div>

        {/* Reserved Holds */}
        <div className="relative p-5 rounded-2xl bg-gradient-to-br from-[#F59E0B]/10 via-[#141E2D] to-[#101725] border border-[#F59E0B]/30 shadow-lg shadow-[#F59E0B]/5 flex flex-col justify-between overflow-hidden">
          <div className="flex items-center justify-between text-xs text-[#94A3B8]">
            <span className="font-semibold tracking-wide uppercase text-[11px]">
              Pending Holds (Reserved)
            </span>
            <div className="flex items-center gap-1 text-[#FBBF24] font-mono text-[10px] bg-[#F59E0B]/15 px-2 py-0.5 rounded-full border border-[#F59E0B]/30">
              <Lock className="w-3 h-3" />
              <span>Two-Phase</span>
            </div>
          </div>
          <div className="my-3">
            <span className="text-3xl sm:text-4xl font-extrabold text-[#FBBF24] tracking-tight font-sans">
              {resFormatted}
            </span>
          </div>
          <p className="text-[11px] text-[#94A3B8] font-mono">
            Pre-auth reservations pending capture
          </p>
        </div>

        {/* Total Book Balance */}
        <div className="relative p-5 rounded-2xl bg-gradient-to-br from-[#06B6D4]/10 via-[#141E2D] to-[#101725] border border-[#06B6D4]/30 shadow-lg shadow-[#06B6D4]/5 flex flex-col justify-between overflow-hidden">
          <div className="flex items-center justify-between text-xs text-[#94A3B8]">
            <span className="font-semibold tracking-wide uppercase text-[11px]">
              Total Book Balance
            </span>
            <div className="flex items-center gap-1 text-[#38BDF8] font-mono text-[10px] bg-[#06B6D4]/15 px-2 py-0.5 rounded-full border border-[#06B6D4]/30">
              <Landmark className="w-3 h-3" />
              <span>WAL State</span>
            </div>
          </div>
          <div className="my-3">
            <span className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight font-sans">
              {totalFormatted}
            </span>
          </div>
          <p className="text-[11px] text-[#94A3B8] font-mono">
            Gross balance committed in replicated WAL
          </p>
        </div>
      </div>

      {/* Double-Entry Invariant Equation Banner */}
      <div className="p-3.5 rounded-xl bg-[#101725]/80 border border-dashed border-[#263244] flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-[#94A3B8]">
          <CheckCircle className="w-4 h-4 text-[#34D399]" />
          <span>
            <strong>Double-Entry Invariant:</strong> Balances are strictly verified by Raft quorum prior to debit. Overdrafts are mathematically rejected.
          </span>
        </div>
        <div className="font-mono text-xs text-[#38BDF8] bg-[#06B6D4]/10 px-3 py-1 rounded-lg border border-[#06B6D4]/20 font-semibold">
          Available ({availFormatted}) = Book ({totalFormatted}) - Holds ({resFormatted})
        </div>
      </div>
    </div>
  );
}

