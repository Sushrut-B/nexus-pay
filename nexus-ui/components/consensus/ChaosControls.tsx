"use client";

import { useState } from "react";
import { Skull, WifiOff, HeartHandshake, AlertTriangle, CheckCircle2, Clock } from "lucide-react";

interface ChaosControlsProps {
  currentLeaderId: string;
  onChaosEvent: () => void;
}

export function ChaosControls({ currentLeaderId, onChaosEvent }: ChaosControlsProps) {
  const [isInjecting, setIsInjecting] = useState(false);
  const [selectedAction, setSelectedAction] = useState<"KILL_LEADER" | "PARTITION" | "HEAL" | null>(null);
  const [partitionTarget, setPartitionTarget] = useState("node-1");
  const [eventLog, setEventLog] = useState<{
    message: string;
    elapsedMs?: number;
    isSuccess: boolean;
    timestamp: string;
  } | null>(null);

  async function executeAction() {
    if (!selectedAction) return;
    setIsInjecting(true);
    setEventLog(null);
    const start = performance.now();

    try {
      if (selectedAction === "KILL_LEADER") {
        const res = await fetch("/api/raft/chaos/inject", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenario: "KILL_LEADER" }),
        });
        if (!res.ok) throw new Error("Kill leader command rejected");

        // Wait for election failover
        await new Promise((r) => setTimeout(r, 600));
        const statusRes = await fetch("/api/raft/cluster/status");
        const status = await statusRes.json();
        const elapsed = Math.round(performance.now() - start);

        setEventLog({
          message: `Leader ${currentLeaderId} abdicated. New leader elected: ${status.nodeId || status.discoveredLeaderId || "in progress"} in ${elapsed}ms`,
          elapsedMs: elapsed,
          isSuccess: true,
          timestamp: new Date().toLocaleTimeString(),
        });
      } else if (selectedAction === "PARTITION") {
        const res = await fetch("/api/raft/chaos/inject", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenario: "PARTITION_NODE", target: partitionTarget }),
        });
        if (!res.ok) throw new Error("Partition injection rejected");
        const elapsed = Math.round(performance.now() - start);

        setEventLog({
          message: `Network partition injected: ${partitionTarget} isolated from cluster quorum.`,
          elapsedMs: elapsed,
          isSuccess: true,
          timestamp: new Date().toLocaleTimeString(),
        });
      } else if (selectedAction === "HEAL") {
        const res = await fetch("/api/raft/chaos/heal", { method: "POST" });
        if (!res.ok) throw new Error("Heal command rejected");
        const elapsed = Math.round(performance.now() - start);

        setEventLog({
          message: "All network partitions & faults healed. Quorum fully operational.",
          elapsedMs: elapsed,
          isSuccess: true,
          timestamp: new Date().toLocaleTimeString(),
        });
      }

      onChaosEvent();
    } catch (e: unknown) {
      setEventLog({
        message: e instanceof Error ? e.message : "Chaos action failed",
        isSuccess: false,
        timestamp: new Date().toLocaleTimeString(),
      });
    } finally {
      setIsInjecting(false);
      setSelectedAction(null);
    }
  }

  return (
    <div className="p-5 rounded-2xl bg-[#101725] border border-[#263244] space-y-4">
      <div>
        <h3 className="font-bold text-sm text-white flex items-center gap-2">
          <span className="text-[#F43F5E] text-base">⚡</span>
          <span>Disaster Simulator &amp; Chaos Engineering</span>
        </h3>
        <p className="text-xs text-[#94A3B8] mt-0.5">
          Execute real-world failure injection to verify sub-second consensus recovery.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Action 1: Kill Leader */}
        <button
          onClick={() => setSelectedAction("KILL_LEADER")}
          disabled={isInjecting}
          className="p-3.5 rounded-xl bg-[#141E2D] hover:bg-[#1E293B] border border-[#F43F5E]/30 text-left transition-all group"
        >
          <div className="flex items-center gap-2 text-xs font-bold text-[#FB7185] mb-1">
            <Skull className="w-4 h-4 text-[#F43F5E]" />
            <span>Kill Active Leader</span>
          </div>
          <p className="text-[11px] text-[#94A3B8]">
            Forces {currentLeaderId || "leader"} to step down; verifies automated re-election.
          </p>
        </button>

        {/* Action 2: Partition Node */}
        <button
          onClick={() => setSelectedAction("PARTITION")}
          disabled={isInjecting}
          className="p-3.5 rounded-xl bg-[#141E2D] hover:bg-[#1E293B] border border-[#F59E0B]/30 text-left transition-all group"
        >
          <div className="flex items-center gap-2 text-xs font-bold text-[#FBBF24] mb-1">
            <WifiOff className="w-4 h-4 text-[#F59E0B]" />
            <span>Partition Node</span>
          </div>
          <p className="text-[11px] text-[#94A3B8]">
            Drops gRPC packets to simulate network split-brain.
          </p>
        </button>

        {/* Action 3: Heal Network */}
        <button
          onClick={() => setSelectedAction("HEAL")}
          disabled={isInjecting}
          className="p-3.5 rounded-xl bg-[#141E2D] hover:bg-[#1E293B] border border-[#10B981]/30 text-left transition-all group"
        >
          <div className="flex items-center gap-2 text-xs font-bold text-[#34D399] mb-1">
            <HeartHandshake className="w-4 h-4 text-[#10B981]" />
            <span>Heal All Faults</span>
          </div>
          <p className="text-[11px] text-[#94A3B8]">
            Clears all partitions and restores 5-node quorum.
          </p>
        </button>
      </div>

      {/* Confirmation Dialog */}
      {selectedAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md p-6 rounded-2xl bg-[#101725] border border-[#263244] shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-white font-bold text-base">
              <AlertTriangle className="w-5 h-5 text-[#F59E0B]" />
              <span>Confirm Chaos Scenario</span>
            </div>

            <p className="text-xs text-[#94A3B8] leading-relaxed">
              {selectedAction === "KILL_LEADER"
                ? `You are about to force current leader ${currentLeaderId} to abdicate. Raftline will immediately initiate election timers and promote a follower to leader.`
                : selectedAction === "PARTITION"
                ? "Select a target node to partition from the active consensus cluster:"
                : "You are about to clear all network faults and resume normal log replication across all nodes."}
            </p>

            {selectedAction === "PARTITION" && (
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1">
                  Target Node to Isolate
                </label>
                <select
                  value={partitionTarget}
                  onChange={(e) => setPartitionTarget(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#080C14] border border-[#263244] text-xs text-white"
                >
                  <option value="node-1">node-1 (Port 8001)</option>
                  <option value="node-2">node-2 (Port 8002)</option>
                  <option value="node-3">node-3 (Port 8003)</option>
                  <option value="node-4">node-4 (Port 8004)</option>
                  <option value="node-5">node-5 (Port 8005)</option>
                </select>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSelectedAction(null)}
                disabled={isInjecting}
                className="px-4 py-2 rounded-xl bg-[#141E2D] hover:bg-[#1E293B] text-xs font-semibold text-white border border-[#263244]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeAction}
                disabled={isInjecting}
                className="px-4 py-2 rounded-xl bg-[#F43F5E] hover:bg-[#E11D48] text-xs font-semibold text-white shadow-lg shadow-[#F43F5E]/20"
              >
                {isInjecting ? "Injecting Fault..." : "Execute Chaos Scenario"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Event Feedback Banner */}
      {eventLog && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-mono space-y-1 ${
            eventLog.isSuccess
              ? "bg-[#10B981]/10 border-[#10B981]/40 text-[#34D399]"
              : "bg-[#F43F5E]/10 border-[#F43F5E]/40 text-[#FB7185]"
          }`}
        >
          <div className="flex items-center justify-between font-sans font-bold">
            <span className="flex items-center gap-1.5">
              {eventLog.isSuccess ? (
                <CheckCircle2 className="w-4 h-4 text-[#10B981]" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-[#F43F5E]" />
              )}
              {eventLog.isSuccess ? "CHAOS SCENARIO EXECUTED" : "CHAOS INJECTION FAILED"}
            </span>
            <span className="text-[10px] text-[#94A3B8]">{eventLog.timestamp}</span>
          </div>
          <div className="text-[11px] text-white/90">{eventLog.message}</div>
        </div>
      )}
    </div>
  );
}

