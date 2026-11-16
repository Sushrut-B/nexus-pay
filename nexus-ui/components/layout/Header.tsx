"use client";

import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, Activity, Terminal, ExternalLink } from "lucide-react";
import { ClusterNodeStatus } from "@/lib/raft/types";

export function Header() {
  const { data: status, isError } = useQuery<ClusterNodeStatus>({
    queryKey: ["cluster-status"],
    queryFn: async () => {
      const res = await fetch("/api/raft/cluster/status");
      if (!res.ok) throw new Error("Cluster unreachable");
      return res.json();
    },
    refetchInterval: 2500,
  });

  const leaderId = status?.discoveredLeaderId || status?.leaderId || "node-2";
  const term = status?.term || 0;
  const commitIndex = status?.commitIndex || 0;
  const isHealthy = !isError && status?.role !== undefined;

  return (
    <header className="sticky top-0 z-40 w-full h-16 bg-[#080C14]/90 backdrop-blur-xl border-b border-[#263244] px-4 md:px-8 flex items-center justify-between">
      {/* Brand & Tagline */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#10B981] via-[#06B6D4] to-[#8B5CF6] flex items-center justify-center shadow-lg shadow-[#10B981]/20">
          <span className="text-white text-lg font-bold">⚡</span>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-bold text-base tracking-tight text-white font-sans">
              Nexus Clearing
            </h1>
            <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/30">
              Raft Consensus
            </span>
          </div>
          <p className="text-xs text-[#94A3B8] hidden sm:block">
            Autonomous Real-Time Settlement & Idempotency Switch
          </p>
        </div>
      </div>

      {/* Cluster Telemetry Pills */}
      <div className="flex items-center gap-2 md:gap-3">
        {/* Consensus Leader Pill */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#141E2D] border border-[#263244] text-xs font-mono">
          <span
            className={`w-2 h-2 rounded-full pulse-dot ${
              isHealthy ? "bg-[#10B981] shadow-[0_0_8px_#10B981]" : "bg-[#F43F5E]"
            }`}
          />
          <span className="text-[#94A3B8]">Leader:</span>
          <strong className="text-white font-semibold">{leaderId}</strong>
        </div>

        {/* Term & Index Telemetry */}
        <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#141E2D] border border-[#263244] text-xs font-mono text-[#94A3B8]">
          <span>Term: <strong className="text-[#38BDF8]">{term}</strong></span>
          <span className="opacity-30">|</span>
          <span>Commit: <strong className="text-[#A78BFA]">#{commitIndex}</strong></span>
        </div>

        {/* Live Quorum Badge */}
        <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#10B981]/10 border border-[#10B981]/30 text-xs font-mono text-[#34D399]">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Quorum Active</span>
        </div>
      </div>
    </header>
  );
}

