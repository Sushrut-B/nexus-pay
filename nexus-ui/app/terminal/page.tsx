"use client";

import { useQuery } from "@tanstack/react-query";
import { PaymentAccount, PaymentHold } from "@/lib/raft/types";
import { AuthorizationForm } from "@/components/terminal/AuthorizationForm";
import { ActiveHoldsTable } from "@/components/terminal/ActiveHoldsTable";

export default function TerminalPage() {
  const { data: accountsData, refetch: refetchAccounts } = useQuery<{ accounts: PaymentAccount[] }>({
    queryKey: ["payments-accounts"],
    queryFn: async () => {
      const res = await fetch("/api/raft/payments/accounts");
      if (!res.ok) throw new Error("Failed to load accounts");
      return res.json();
    },
    refetchInterval: 3000,
  });

  const { data: holdsData, isLoading: isLoadingHolds, refetch: refetchHolds } = useQuery<{ holds: PaymentHold[] }>({
    queryKey: ["payments-holds"],
    queryFn: async () => {
      const res = await fetch("/api/raft/payments/holds");
      if (!res.ok) throw new Error("Failed to load holds");
      return res.json();
    },
    refetchInterval: 2500,
  });

  const accounts = accountsData?.accounts || [];
  const holds = holdsData?.holds || [];

  function handleDataRefresh() {
    refetchAccounts();
    refetchHolds();
  }

  return (
    <div className="space-y-6">
      {/* Page Title & Context */}
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">
          Merchant Terminal &amp; Two-Phase Holds
        </h2>
        <p className="text-xs text-[#94A3B8] mt-1">
          Two-phase authorization holds, card pre-authorizations, and guaranteed settlement clearing.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Pre-Auth Form */}
        <div className="lg:col-span-5">
          <AuthorizationForm accounts={accounts} onHoldCreated={handleDataRefresh} />
        </div>

        {/* Right Column: Active Holds Table */}
        <div className="lg:col-span-7">
          <ActiveHoldsTable
            holds={holds}
            isLoading={isLoadingHolds}
            onHoldActionComplete={handleDataRefresh}
          />
        </div>
      </div>
    </div>
  );
}

