"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Wallet,
  Store,
  Layers,
  Activity,
  CheckCircle2,
  RefreshCw,
  GitCommit,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  {
    name: "Customer Wallet",
    href: "/wallet",
    icon: Wallet,
    badge: "Consumer",
    description: "Mobile Neobank, Double-Entry & Idempotency Blaster",
  },
  {
    name: "Merchant Terminal",
    href: "/terminal",
    icon: Store,
    badge: "Two-Phase",
    description: "Pre-Auth Reservation Holds, Capture & Escrow",
  },
  {
    name: "Corporate Treasury",
    href: "/treasury",
    icon: Layers,
    badge: "Ledger",
    description: "High-Density Audit Trail & ISO 20022 XML Engine",
  },
  {
    name: "Consensus Quorum",
    href: "/consensus",
    icon: Activity,
    badge: "Chaos",
    description: "5-Node Topology Map, Telemetry & Disaster Suite",
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-full md:w-64 bg-[#0A0F1A] border-r border-[#263244] flex flex-col justify-between shrink-0">
      {/* Top Nav Links */}
      <div className="p-4 space-y-1.5">
        <div className="px-3 py-2 text-[11px] font-mono tracking-wider uppercase text-[#94A3B8]/60 font-semibold">
          Platform Modules
        </div>

        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || (item.href === "/wallet" && pathname === "/");
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-start gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 border",
                isActive
                  ? "bg-[#141E2D] border-[#10B981]/40 text-white shadow-md shadow-[#10B981]/5"
                  : "border-transparent text-[#94A3B8] hover:bg-[#101725] hover:text-white"
              )}
            >
              <div
                className={cn(
                  "p-2 rounded-lg transition-colors mt-0.5",
                  isActive
                    ? "bg-[#10B981]/15 text-[#34D399]"
                    : "bg-[#141E2D] text-[#94A3B8] group-hover:text-white"
                )}
              >
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold truncate">
                    {item.name}
                  </span>
                  {isActive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                  )}
                </div>
                <p className="text-[11px] text-[#94A3B8]/70 line-clamp-1 mt-0.5">
                  {item.description}
                </p>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Bottom Invariant Banner */}
      <div className="p-4 border-t border-[#263244] bg-[#080C14]/50">
        <div className="p-3 rounded-xl bg-[#141E2D]/60 border border-[#263244] space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-[#34D399] font-medium font-mono">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Strict Invariant</span>
          </div>
          <p className="text-[11px] text-[#94A3B8] leading-relaxed">
            Double-entry ledger rules &amp; client session deduplication tables guarantee zero duplicate debits.
          </p>
        </div>
      </div>
    </aside>
  );
}

