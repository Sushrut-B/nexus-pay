import { Card, CardContent } from "@nexus/ui";

export function ControlPageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-600">{eyebrow}</p>
      <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
      {description ? <p className="mt-1.5 text-sm text-slate-500">{description}</p> : null}
    </div>
  );
}

export function StatusPill({
  state,
  tone,
}: {
  state: string;
  tone: "healthy" | "warning" | "critical" | "neutral" | "info";
}) {
  const tones: Record<string, string> = {
    healthy: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warning: "border-amber-200 bg-amber-50 text-amber-700",
    critical: "border-red-200 bg-red-50 text-red-700",
    neutral: "border-slate-200 bg-slate-50 text-slate-600",
    info: "border-blue-200 bg-blue-50 text-blue-700",
  };
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tones[tone]}`}>
      {state}
    </span>
  );
}

export function DataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2.5 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-right text-xs font-medium text-slate-900">{value}</span>
    </div>
  );
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <p className="text-sm font-medium text-slate-900">{title}</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">{message}</p>
      </CardContent>
    </Card>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <Card>
      <CardContent className="py-12 text-center text-xs text-slate-500">{label}</CardContent>
    </Card>
  );
}
