"use client";

import { DemoCustomerProfile, PaymentAccount } from "@/lib/raft/types";
import { DEMO_PROFILES } from "@/lib/demo-profiles";
import { PlusCircle, Zap } from "lucide-react";
import { useState } from "react";

interface CustomerSelectorProps {
  selectedProfile: DemoCustomerProfile;
  onSelectProfile: (profile: DemoCustomerProfile) => void;
  account: PaymentAccount | null;
  onFundSuccess: () => void;
}

export function CustomerSelector({
  selectedProfile,
  onSelectProfile,
  account,
  onFundSuccess,
}: CustomerSelectorProps) {
  const [isFunding, setIsFunding] = useState(false);

  async function handleQuickFund() {
    if (!account) return;
    setIsFunding(true);
    try {
      const res = await fetch("/api/raft/payments/account/fund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: account.accountId,
          amountCents: 50000, // +$500.00
          idempotencyKey: `fund_${Date.now()}`,
        }),
      });
      if (res.ok) {
        onFundSuccess();
      }
    } catch (e) {
      console.error("Fund failed:", e);
    } finally {
      setIsFunding(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl bg-[#101725] border border-[#263244]">
      {/* Profile Switcher Chips */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 max-w-full">
        {DEMO_PROFILES.map((profile) => {
          const isSelected = selectedProfile.id === profile.id;
          return (
            <button
              key={profile.id}
              onClick={() => onSelectProfile(profile)}
              className={`flex items-center gap-2.5 px-3.5 py-2 rounded-xl text-xs font-medium transition-all shrink-0 border ${
                isSelected
                  ? "bg-[#141E2D] border-[#10B981] text-white shadow-md shadow-[#10B981]/15"
                  : "bg-[#080C14]/60 border-[#263244] text-[#94A3B8] hover:text-white hover:border-[#334155]"
              }`}
            >
              <div
                className={`w-6 h-6 rounded-lg bg-gradient-to-tr ${profile.avatarColor} flex items-center justify-center text-[10px] font-bold text-white uppercase`}
              >
                {profile.name[0]}
              </div>
              <div className="text-left">
                <div className="font-semibold text-white leading-tight">
                  {profile.name}
                </div>
                <div className="text-[10px] text-[#94A3B8] font-mono leading-tight">
                  {profile.currency}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Action Tools */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleQuickFund}
          disabled={isFunding || !account}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-[#10B981] to-[#059669] text-white text-xs font-semibold hover:brightness-110 active:scale-95 transition-all shadow-md shadow-[#10B981]/20 disabled:opacity-50"
        >
          <Zap className="w-3.5 h-3.5" />
          <span>{isFunding ? "Funding..." : "Instant Faucet (+500)"}</span>
        </button>
      </div>
    </div>
  );
}

