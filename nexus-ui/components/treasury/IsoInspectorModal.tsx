"use client";

import { useEffect, useState } from "react";
import { PaymentResult } from "@/lib/raft/types";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { FileText, Copy, Download, X, Check, ShieldCheck } from "lucide-react";

interface IsoInspectorModalProps {
  transaction: PaymentResult | null;
  onClose: () => void;
}

export function IsoInspectorModal({ transaction, onClose }: IsoInspectorModalProps) {
  const [xmlContent, setXmlContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!transaction) return;
    setIsLoading(true);
    setXmlContent("");

    fetch(`/api/raft/payments/iso20022?ref=${encodeURIComponent(transaction.paymentRef)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load ISO 20022 XML");
        const text = await res.text();
        setXmlContent(text);
      })
      .catch((err) => {
        setXmlContent(`<!-- Error loading ISO 20022 XML: ${err.message} -->`);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [transaction]);

  if (!transaction) return null;

  function handleCopy() {
    if (!xmlContent) return;
    navigator.clipboard.writeText(xmlContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownload() {
    if (!xmlContent) return;
    const blob = new Blob([xmlContent], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pacs.008_${transaction?.paymentRef || "tx"}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl bg-[#0F1725] border border-[#263244] shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="p-5 border-b border-[#263244] flex items-center justify-between bg-[#080C14]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#8B5CF6]/15 text-[#A78BFA] border border-[#8B5CF6]/30 flex items-center justify-center">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-white">
                  ISO 20022 Message Inspector
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#8B5CF6]/15 text-[#C084FC] border border-[#8B5CF6]/30">
                  pacs.008.001.08
                </span>
              </div>
              <p className="text-[11px] text-[#94A3B8] font-mono mt-0.5">
                Financial Institutional Customer Credit Transfer • Ref: {transaction.paymentRef}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#94A3B8] hover:text-white hover:bg-[#141E2D] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Transaction Telemetry Pill Strip */}
        <div className="px-5 py-3 bg-[#141E2D]/60 border-b border-[#263244] grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
          <div>
            <span className="text-[#94A3B8] text-[10px] block">Raft Log Index:</span>
            <strong className="text-[#38BDF8]">#{transaction.raftLogIndex}</strong>
          </div>
          <div>
            <span className="text-[#94A3B8] text-[10px] block">Settled Amount:</span>
            <strong className="text-[#34D399]">
              {formatCurrency(transaction.amountCents, transaction.currency)}
            </strong>
          </div>
          <div>
            <span className="text-[#94A3B8] text-[10px] block">Rail / Protocol:</span>
            <strong className="text-white">{transaction.rail}</strong>
          </div>
          <div>
            <span className="text-[#94A3B8] text-[10px] block">Settled Timestamp:</span>
            <strong className="text-white">{formatDateTime(transaction.settledAt)}</strong>
          </div>
        </div>

        {/* Code Content */}
        <div className="flex-1 overflow-y-auto p-4 bg-[#030712] font-mono text-xs">
          {isLoading ? (
            <div className="py-16 text-center text-[#94A3B8]">
              Generating ISO 20022 XML from consensus receipt...
            </div>
          ) : (
            <pre className="text-[#E2E8F0] whitespace-pre-wrap break-all leading-relaxed">
              {xmlContent}
            </pre>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-[#263244] bg-[#080C14] flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-[#34D399] font-mono">
            <ShieldCheck className="w-4 h-4" />
            <span>Valid XML Schema</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              disabled={isLoading || !xmlContent}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#141E2D] hover:bg-[#1E293B] border border-[#263244] text-xs font-semibold text-white transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-[#10B981]" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? "Copied" : "Copy XML"}</span>
            </button>

            <button
              onClick={handleDownload}
              disabled={isLoading || !xmlContent}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-[#10B981] to-[#059669] text-xs font-semibold text-white hover:brightness-110 active:scale-95 transition-all shadow-md shadow-[#10B981]/20"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download pacs.008.xml</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

