"use client";

import { ReactNode } from "react";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-[#080C14] text-[#F1F5F9]">
      <Header />
      <div className="flex-1 flex flex-col md:flex-row">
        <Sidebar />
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">
          {children}
        </main>
      </div>
    </div>
  );
}

