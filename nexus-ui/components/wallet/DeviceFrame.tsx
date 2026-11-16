"use client";

import { ReactNode, useState } from "react";
import { Smartphone, Monitor, Wifi, Battery, Signal } from "lucide-react";

interface DeviceFrameProps {
  children: ReactNode;
  customerName: string;
}

export function DeviceFrame({ children, customerName }: DeviceFrameProps) {
  const [deviceMode, setDeviceMode] = useState<"iphone" | "android" | "expanded">("iphone");

  return (
    <div className="flex flex-col items-center space-y-4 w-full">
      {/* Device Viewport Selector Toggle */}
      <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[#101725] border border-[#263244] text-xs">
        <button
          onClick={() => setDeviceMode("iphone")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
            deviceMode === "iphone"
              ? "bg-[#141E2D] text-white font-semibold shadow border border-[#263244]"
              : "text-[#94A3B8] hover:text-white"
          }`}
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span>iOS Terminal</span>
        </button>
        <button
          onClick={() => setDeviceMode("android")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
            deviceMode === "android"
              ? "bg-[#141E2D] text-white font-semibold shadow border border-[#263244]"
              : "text-[#94A3B8] hover:text-white"
          }`}
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span>Android POS</span>
        </button>
        <button
          onClick={() => setDeviceMode("expanded")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
            deviceMode === "expanded"
              ? "bg-[#141E2D] text-white font-semibold shadow border border-[#263244]"
              : "text-[#94A3B8] hover:text-white"
          }`}
        >
          <Monitor className="w-3.5 h-3.5" />
          <span>Full Terminal</span>
        </button>
      </div>

      {/* Frame Container */}
      {deviceMode === "expanded" ? (
        <div className="w-full">{children}</div>
      ) : (
        <div
          className={`relative w-full max-w-[420px] transition-all duration-300 p-3 sm:p-4 rounded-[42px] border-[6px] shadow-2xl bg-[#030712] ${
            deviceMode === "iphone"
              ? "border-[#1E293B] shadow-[#10B981]/10"
              : "border-[#334155] rounded-[32px]"
          }`}
        >
          {/* Dynamic Island / Notch */}
          {deviceMode === "iphone" ? (
            <div className="flex justify-center mb-2">
              <div className="w-28 h-4 rounded-full bg-black border border-white/10 flex items-center justify-between px-3">
                <div className="w-2 h-2 rounded-full bg-[#10B981] pulse-dot" />
                <div className="w-2.5 h-2.5 rounded-full bg-neutral-800" />
              </div>
            </div>
          ) : (
            /* Android Camera Punch Hole */
            <div className="flex justify-center mb-2">
              <div className="w-3.5 h-3.5 rounded-full bg-black border border-white/20" />
            </div>
          )}

          {/* Status Bar */}
          <div className="flex items-center justify-between text-[11px] text-[#94A3B8] font-mono px-3 mb-3">
            <span>{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            <span className="text-[10px] text-white font-sans font-medium truncate max-w-[120px]">
              {customerName}
            </span>
            <div className="flex items-center gap-1.5 text-white/80">
              <Signal className="w-3 h-3" />
              <Wifi className="w-3 h-3 text-[#10B981]" />
              <Battery className="w-3.5 h-3.5 text-[#34D399]" />
            </div>
          </div>

          {/* Screen Content */}
          <div className="rounded-[28px] overflow-hidden bg-[#080C14] border border-[#263244]/60 p-2 sm:p-3 space-y-4">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

