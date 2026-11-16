"use client";

import { useState, useMemo } from "react";
import { PaymentResult, PaymentRail, PaymentStatus } from "@/lib/raft/types";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { Search, Filter, FileText, ArrowRight } from "lucide-react";

interface LedgerTableProps {
  transactions: PaymentResult[];
  isLoading: boolean;
  onSelectTransaction: (tx: PaymentResult) => void;
}

export function LedgerTable({
  transactions,
  isLoading,
  onSelectTransaction,
}: LedgerTableProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRail, setSelectedRail] = useState<string>("ALL");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 12;

  // Filter transactions
  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      const matchesSearch =
        searchTerm === "" ||
        t.paymentRef.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.idempotencyKey.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.sourceAccountId.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.destinationAccountId.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesRail = selectedRail === "ALL" || t.rail === selectedRail;
      const matchesStatus = selectedStatus === "ALL" || t.status === selectedStatus;

      return matchesSearch && matchesRail && matchesStatus;
    });
  }, [transactions, searchTerm, selectedRail, selectedStatus]);

  const totalPages = Math.ceil(filtered.length / pageSize) || 1;
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="p-5 rounded-2xl bg-[#101725] border border-[#263244] space-y-4">
      {/* Table Header & Search Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-sm text-white">Settlement Audit Ledger</h3>
          <p className="text-xs text-[#94A3B8] mt-0.5">
            Immutable log of consensus settlements and double-entry adjustments.
          </p>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
            <input
              type="text"
              placeholder="Search ref, key, account..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="pl-8 pr-3 py-1.5 rounded-xl bg-[#080C14] border border-[#263244] text-xs text-white placeholder-[#94A3B8]/60 focus:outline-none focus:border-[#10B981] w-48 sm:w-60"
            />
          </div>

          {/* Rail Filter */}
          <select
            value={selectedRail}
            onChange={(e) => {
              setSelectedRail(e.target.value);
              setCurrentPage(1);
            }}
            className="px-2.5 py-1.5 rounded-xl bg-[#080C14] border border-[#263244] text-xs text-white focus:outline-none focus:border-[#10B981]"
          >
            <option value="ALL">All Rails</option>
            <option value="FEDNOW">FedNow</option>
            <option value="SEPA_INSTANT">SEPA Instant</option>
            <option value="UPI">UPI</option>
            <option value="FASTER_PAYMENTS">Faster Payments</option>
            <option value="INTERNAL_BOOK">Book Transfer</option>
          </select>

          {/* Status Filter */}
          <select
            value={selectedStatus}
            onChange={(e) => {
              setSelectedStatus(e.target.value);
              setCurrentPage(1);
            }}
            className="px-2.5 py-1.5 rounded-xl bg-[#080C14] border border-[#263244] text-xs text-white focus:outline-none focus:border-[#10B981]"
          >
            <option value="ALL">All Statuses</option>
            <option value="SETTLED">SETTLED</option>
            <option value="AUTHORIZED">AUTHORIZED</option>
            <option value="CAPTURED">CAPTURED</option>
            <option value="REJECTED">REJECTED</option>
          </select>
        </div>
      </div>

      {/* Table Element */}
      <div className="overflow-x-auto rounded-xl border border-[#263244]">
        <table className="w-full text-left text-xs font-mono">
          <thead className="bg-[#080C14] text-[#94A3B8] uppercase text-[10px] tracking-wider border-b border-[#263244]">
            <tr>
              <th className="py-3 px-3.5">Payment Ref / Log #</th>
              <th className="py-3 px-3.5">Timestamp</th>
              <th className="py-3 px-3.5">Rail</th>
              <th className="py-3 px-3.5">Debtor → Creditor</th>
              <th className="py-3 px-3.5 text-right">Amount</th>
              <th className="py-3 px-3.5">Status</th>
              <th className="py-3 px-3.5 text-right">ISO 20022</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#263244] bg-[#0A0F1A]">
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-[#94A3B8] font-sans">
                  {isLoading ? "Loading settlement ledger..." : "No matching transactions found."}
                </td>
              </tr>
            ) : (
              paginated.map((tx) => {
                const isSuccess = tx.status === "SETTLED" || tx.status === "CAPTURED";
                return (
                  <tr key={tx.paymentRef} className="hover:bg-[#141E2D]/50 transition-colors">
                    <td className="py-3 px-3.5">
                      <div className="font-semibold text-white">{tx.paymentRef}</div>
                      <div className="text-[10px] text-[#38BDF8] mt-0.5">
                        Log Index #{tx.raftLogIndex}
                      </div>
                    </td>
                    <td className="py-3 px-3.5 text-[#94A3B8]">
                      {formatDateTime(tx.settledAt)}
                    </td>
                    <td className="py-3 px-3.5">
                      <span className="px-2 py-0.5 rounded text-[10px] bg-[#141E2D] border border-[#263244] text-white">
                        {tx.rail || "FEDNOW"}
                      </span>
                    </td>
                    <td className="py-3 px-3.5">
                      <div className="flex items-center gap-1.5 text-white">
                        <span className="truncate max-w-[100px]">{tx.sourceAccountId}</span>
                        <ArrowRight className="w-3 h-3 text-[#94A3B8] shrink-0" />
                        <span className="text-[#38BDF8] truncate max-w-[100px]">{tx.destinationAccountId}</span>
                      </div>
                    </td>
                    <td className="py-3 px-3.5 text-right font-bold text-sm">
                      <span className={isSuccess ? "text-[#34D399]" : "text-[#FB7185]"}>
                        {formatCurrency(tx.amountCents, tx.currency)}
                      </span>
                    </td>
                    <td className="py-3 px-3.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          tx.status === "SETTLED"
                            ? "bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/30"
                            : tx.status === "AUTHORIZED"
                            ? "bg-[#F59E0B]/15 text-[#FBBF24] border border-[#F59E0B]/30"
                            : tx.status === "CAPTURED"
                            ? "bg-[#06B6D4]/15 text-[#38BDF8] border border-[#06B6D4]/30"
                            : "bg-[#F43F5E]/15 text-[#FB7185] border border-[#F43F5E]/30"
                        }`}
                      >
                        {tx.status}
                      </span>
                    </td>
                    <td className="py-3 px-3.5 text-right font-sans">
                      <button
                        onClick={() => onSelectTransaction(tx)}
                        className="flex items-center gap-1 ml-auto px-2.5 py-1 rounded-lg bg-[#8B5CF6]/15 hover:bg-[#8B5CF6]/25 text-[#A78BFA] border border-[#8B5CF6]/30 text-[11px] font-semibold transition-colors"
                      >
                        <FileText className="w-3 h-3" />
                        <span>pacs.008</span>
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="flex items-center justify-between text-xs text-[#94A3B8]">
        <div>
          Showing {filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1} to{" "}
          {Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} entries
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-3 py-1 rounded-lg bg-[#141E2D] hover:bg-[#1E293B] text-white border border-[#263244] disabled:opacity-40"
          >
            Prev
          </button>
          <span className="px-2 font-mono">
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            className="px-3 py-1 rounded-lg bg-[#141E2D] hover:bg-[#1E293B] text-white border border-[#263244] disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

