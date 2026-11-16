import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(cents: number, currency = "USD"): string {
  const amount = (cents || 0) / 100;
  const symbolMap: Record<string, string> = {
    USD: "$",
    EUR: "€",
    INR: "₹",
    GBP: "£",
  };
  const sym = symbolMap[currency.toUpperCase()] || "$";

  return `${sym}${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function getCurrencySymbol(currency = "USD"): string {
  const symbolMap: Record<string, string> = {
    USD: "$",
    EUR: "€",
    INR: "₹",
    GBP: "£",
  };
  return symbolMap[currency.toUpperCase()] || "$";
}

export function formatDate(timestamp: number): string {
  if (!timestamp) return "--";
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatDateTime(timestamp: number): string {
  if (!timestamp) return "--";
  const d = new Date(timestamp);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

export function truncateHash(hash: string, start = 8, end = 6): string {
  if (!hash) return "";
  if (hash.length <= start + end) return hash;
  return `${hash.slice(0, start)}...${hash.slice(-end)}`;
}

