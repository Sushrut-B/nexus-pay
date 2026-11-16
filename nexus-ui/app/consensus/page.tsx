"use client";

import { useQuery } from "@tanstack/react-query";
import { ClusterNodeStatus, PaymentAccount } from "@/lib/raft/types";
import { TopologyMap } from "@/components/consensus/TopologyMap";
import { ChaosControls } from "@/components/consensus/ChaosControls";
import { PaymentContinuityTest } from "@/components/consensus/PaymentContinuityTest";

export default function ConsensusPage() {
  const { data: nodesData, refetch: refetchNodes } = useQuery<{ nodes: ClusterNodeStatus[] }>({
    queryKey: ["cluster-nodes"],
    queryFn: async () => {
      const res = await fetch("/api/raft/cluster/nodes");
      if (!res.ok) throw new Error("Failed to probe nodes");
      return res.json();
    },
    refetchInterval: 2000,
  });

  const { data: statusData, refetch: refetchStatus } = useQuery<ClusterNodeStatus>({
    queryKey: ["cluster-status"],
    queryFn: async () => {
      const res = await fetch("/api/raft/cluster/status");
      if (!res.ok) throw new Error("Failed to load status");
      return res.json();
    },
    refetchInterval: 2000,
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

  const nodes = nodesData?.nodes || [];
  const activeLeaderId = statusData?.discoveredLeaderId || statusData?.leaderId || "node-2";
  const accounts = accountsData?.accounts || [];

  function handleRefreshAll() {
    refetchNodes();
    refetchStatus();
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">
          Consensus Quorum &amp; Chaos Command Center
        </h2>
        <p className="text-xs text-[#94A3B8] mt-1">
          Live 5-node cluster topology inspection, heartbeat telemetry, and disaster engineering suite.
        </p>
      </div>

      {/* 5-Node Topology Map */}
      <TopologyMap nodes={nodes} activeLeaderId={activeLeaderId} />

      {/* Two columns: Chaos Controls & Payment Continuity Test */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-6">
          <ChaosControls currentLeaderId={activeLeaderId} onChaosEvent={handleRefreshAll} />
        </div>

        <div className="lg:col-span-6">
          <PaymentContinuityTest accounts={accounts} onTestComplete={handleRefreshAll} />
        </div>
      </div>
    </div>
  );
}

