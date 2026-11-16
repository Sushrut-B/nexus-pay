"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PaymentResult, PaymentHold, PaymentAccount, ClusterNodeStatus } from "@/lib/raft/types";
import { TreasuryMetrics } from "@/components/treasury/TreasuryMetrics";
import { LedgerTable } from "@/components/treasury/LedgerTable";
import { IsoInspectorModal } from "@/components/treasury/IsoInspectorModal";

export default function TreasuryPage() {
  const [selectedTxForIso, setSelectedTxForIso] = useState<PaymentResult | null>(null);

  const { data: txData, isLoading: isLoadingTxs } = useQuery<{ transactions: PaymentResult[] }>({
    queryKey: ["payments-transactions"],
    queryFn: async () => {
      const res = await fetch("/api/raft/payments/transactions?limit=100");
      if (!res.ok) throw new Error("Failed to load transactions");
      return res.json();
    },
    refetchInterval: 2500,
  });

  const { data: holdsData } = useQuery<{ holds: PaymentHold[] }>({
    queryKey: ["payments-holds"],
    queryFn: async () => {
      const res = await fetch("/api/raft/payments/holds");
      if (!res.ok) return { holds: [] };
      return res.json();
    },
    refetchInterval: 3000,
  });

  const { data: accountsData } = useQuery<{ accounts: PaymentAccount[] }>({
    queryKey: ["payments-accounts"],
    queryFn: async () => {
      const res = await fetch("/api/raft/payments/accounts");
      if (!res.ok) return { accounts: [] };
      return res.json();
    },
    refetchInterval: 3000,
  });

  const { data: clusterStatus } = useQuery<ClusterNodeStatus>({
    queryKey: ["cluster-status"],
    queryFn: async () => {
      const res = await fetch("/api/raft/cluster/status");
      if (!res.ok) return { commitIndex: 0 };
      return res.json();
    },
    refetchInterval: 2500,
  });

  const transactions = txData?.transactions || [];
  const holds = holdsData?.holds || [];
  const accounts = accountsData?.accounts || [];
  const commitIndex = clusterStatus?.commitIndex || 0;

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">
          Corporate Treasury &amp; Settlement Ledger
        </h2>
        <p className="text-xs text-[#94A3B8] mt-1">
          Institutional clearing ledger, double-entry audit trail, and ISO 20022 message inspection.
        </p>
      </div>

      {/* Financial Metrics Strip */}
      <TreasuryMetrics
        transactions={transactions}
        holds={holds}
        accounts={accounts}
        commitIndex={commitIndex}
      />

      {/* Ledger Table */}
      <LedgerTable
        transactions={transactions}
        isLoading={isLoadingTxs}
        onSelectTransaction={setSelectedTxForIso}
      />

      {/* ISO 20022 Modal */}
      <IsoInspectorModal
        transaction={selectedTxForIso}
        onClose={() => setSelectedTxForIso(null)}
      />
    </div>
  );
}

