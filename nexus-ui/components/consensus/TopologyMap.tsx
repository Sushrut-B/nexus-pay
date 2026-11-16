"use client";

import { ClusterNodeStatus } from "@/lib/raft/types";
import { Server, Activity, ShieldCheck, Zap, AlertCircle } from "lucide-react";

interface TopologyMapProps {
  nodes: ClusterNodeStatus[];
  activeLeaderId: string | null;
}

export function TopologyMap({ nodes, activeLeaderId }: TopologyMapProps) {
  return (
    <div className="p-5 rounded-2xl bg-[#101725] border border-[#263244] space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-sm text-white flex items-center gap-2">
            <Server className="w-4 h-4 text-[#10B981]" />
            <span>Five-Node Consensus Quorum Topology</span>
          </h3>
          <p className="text-xs text-[#94A3B8] mt-0.5">
            Active mesh interconnected via high-speed Netty gRPC (9001..9005).
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="px-2.5 py-1 rounded-full bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/30">
            Quorum: 3 of 5 Required
          </span>
        </div>
      </div>

      {/* 5 Nodes Grid / Interconnect Layout */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5 pt-2">
        {nodes.map((node) => {
          const isLeader = node.role === "LEADER" || node.nodeId === activeLeaderId;
          const isReachable = node.reachable !== false;

          return (
            <div
              key={node.nodeId}
              className={`relative p-4 rounded-xl border transition-all duration-300 flex flex-col justify-between overflow-hidden ${
                !isReachable
                  ? "bg-[#080C14]/80 border-[#F43F5E]/40 opacity-70"
                  : isLeader
                  ? "bg-gradient-to-b from-[#10B981]/15 via-[#141E2D] to-[#101725] border-[#10B981] shadow-xl shadow-[#10B981]/10"
                  : "bg-[#141E2D] border-[#263244] hover:border-[#334155]"
              }`}
            >
              {/* Leader Glow Accent */}
              {isLeader && (
                <div className="absolute top-0 right-0 left-0 h-1 bg-gradient-to-r from-[#10B981] via-[#06B6D4] to-[#10B981]" />
              )}

              <div>
                {/* Node Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        !isReachable
                          ? "bg-[#F43F5E]"
                          : isLeader
                          ? "bg-[#10B981] pulse-dot shadow-[0_0_8px_#10B981]"
                          : "bg-[#38BDF8]"
                      }`}
                    />
                    <strong className="text-white text-sm font-mono">{node.nodeId}</strong>
                  </div>

                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold uppercase ${
                      !isReachable
                        ? "bg-[#F43F5E]/15 text-[#FB7185] border border-[#F43F5E]/30"
                        : isLeader
                        ? "bg-[#10B981]/20 text-[#34D399] border border-[#10B981]/40"
                        : "bg-[#141E2D] text-[#94A3B8] border border-[#263244]"
                    }`}
                  >
                    {!isReachable ? "OFFLINE" : isLeader ? "LEADER" : "FOLLOWER"}
                  </span>
                </div>

                {/* Ports */}
                <div className="mt-3 space-y-1 font-mono text-[11px] text-[#94A3B8]">
                  <div className="flex justify-between">
                    <span>HTTP REST:</span>
                    <strong className="text-white">:{node.httpPort || "--"}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>gRPC Mesh:</span>
                    <strong className="text-white">:{node.grpcPort || "--"}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Term:</span>
                    <strong className="text-[#38BDF8]">{node.term || 0}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Commit Idx:</span>
                    <strong className="text-[#A78BFA]">#{node.commitIndex || 0}</strong>
                  </div>
                </div>
              </div>

              {/* Node Footer / Ping */}
              <div className="mt-4 pt-2.5 border-t border-[#263244] flex items-center justify-between text-[10px] font-mono">
                <span className="text-[#94A3B8]">Ping Latency:</span>
                <span className={isReachable ? "text-[#34D399] font-bold" : "text-[#FB7185]"}>
                  {isReachable ? `${node.latencyMs ?? 1}ms` : "Timeout"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

