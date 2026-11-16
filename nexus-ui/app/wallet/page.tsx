"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DEMO_PROFILES } from "@/lib/demo-profiles";
import { DemoCustomerProfile, PaymentAccount } from "@/lib/raft/types";
import { CustomerSelector } from "@/components/wallet/CustomerSelector";
import { BalanceCards } from "@/components/wallet/BalanceCards";
import { DeviceFrame } from "@/components/wallet/DeviceFrame";
import { TransferWidget } from "@/components/wallet/TransferWidget";
import { IdempotencyBlaster } from "@/components/wallet/IdempotencyBlaster";

export default function WalletPage() {
  const [selectedProfile, setSelectedProfile] = useState<DemoCustomerProfile>(DEMO_PROFILES[0]);

  // Load all accounts from Raftline
  const { data: accountsData, refetch: refetchAccounts } = useQuery<{ accounts: PaymentAccount[] }>({
    queryKey: ["payments-accounts"],
    queryFn: async () => {
      const res = await fetch("/api/raft/payments/accounts");
      if (!res.ok) throw new Error("Failed to load accounts");
      return res.json();
    },
    refetchInterval: 2500,
  });

  const accounts = accountsData?.accounts || [];

  // Match selected profile to real backend account
  const activeAccount =
    accounts.find((a) => a.accountId === selectedProfile.accountId) ||
    accounts.find((a) => a.accountId.includes(selectedProfile.id)) ||
    accounts[0] ||
    null;

  // Destination account for blaster (e.g. Bob or any other account)
  const destinationForBlaster =
    accounts.find((a) => a.accountId !== activeAccount?.accountId) || null;

  return (
    <div className="space-y-6">
      {/* Page Title & Context */}
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">
          Customer Neobank Wallet
        </h2>
        <p className="text-xs text-[#94A3B8] mt-1">
          High-speed consumer &amp; business wallet powered by Raftline double-entry consensus.
        </p>
      </div>

      {/* Customer Profile Switcher & Faucet */}
      <CustomerSelector
        selectedProfile={selectedProfile}
        onSelectProfile={setSelectedProfile}
        account={activeAccount}
        onFundSuccess={() => refetchAccounts()}
      />

      {/* Financial Invariant Balance Cards */}
      <BalanceCards account={activeAccount} currency={selectedProfile.currency} />

      {/* Core Interactive Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Device Mockup (iPhone/Android POS) */}
        <div className="lg:col-span-6 flex justify-center">
          <DeviceFrame customerName={selectedProfile.name}>
            <TransferWidget
              sourceAccount={activeAccount}
              accounts={accounts}
              onSettlementComplete={() => refetchAccounts()}
            />
          </DeviceFrame>
        </div>

        {/* Right Column: Flaky Network Idempotency Blaster */}
        <div className="lg:col-span-6 space-y-4">
          <IdempotencyBlaster
            sourceAccount={activeAccount}
            destinationAccount={destinationForBlaster}
            onBlastComplete={() => refetchAccounts()}
          />
        </div>
      </div>
    </div>
  );
}

