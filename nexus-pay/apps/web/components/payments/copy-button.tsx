"use client";

import { useState } from "react";
import { Button } from "@nexus/ui";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

export function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  variant = "outline",
  className,
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  variant?: "default" | "outline" | "ghost" | "secondary";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied to clipboard");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Your browser blocked clipboard access. Select and copy the value manually.");
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      className={className}
      onClick={() => void copy()}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {copied ? copiedLabel : label}
    </Button>
  );
}
