"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { FinancialPreferenceView } from "@nexus/shared-types";
import { apiFetch } from "@/lib/api/client";
import { toast } from "sonner";

export default function PreferencesPage() {
  const queryClient = useQueryClient();
  const preferences = useQuery({ queryKey: ["finance", "preferences"], queryFn: () => apiFetch<FinancialPreferenceView>("/api/finance/preferences") });
  const update = useMutation({
    mutationFn: (input: Partial<FinancialPreferenceView>) => apiFetch("/api/finance/preferences", { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["finance", "preferences"] }); toast.success("Preferences saved"); },
    onError: () => toast.error("Could not save preferences"),
  });
  const data = preferences.data;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Personalisation</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Financial preferences</h1>
      </div>
      {data ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Notifications & defaults</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Select label="Default reporting period" value={data.defaultPeriod} onChange={(value) => update.mutate({ defaultPeriod: value as never })} options={[["week", "This week"], ["month", "This month"], ["last_month", "Last month"], ["quarter", "Last 3 months"], ["year", "This year"]]} />
            <Toggle label="Insight notifications" checked={data.insightNotifications} onChange={(checked) => update.mutate({ insightNotifications: checked })} />
            <Toggle label="Forecast notifications" checked={data.forecastNotifications} onChange={(checked) => update.mutate({ forecastNotifications: checked })} />
            <Toggle label="Budget recommendation notifications" checked={data.budgetRecommendationNotifications} onChange={(checked) => update.mutate({ budgetRecommendationNotifications: checked })} />
            <Toggle label="Recurring expense detection" checked={data.recurringDetection} onChange={(checked) => update.mutate({ recurringDetection: checked })} />
            <Toggle label="Goal reminders" checked={data.goalReminders} onChange={(checked) => update.mutate({ goalReminders: checked })} />
            <p className="text-xs text-muted-foreground">Display timezone: {data.timezone} (Asia/Kolkata policy)</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}</label>;
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-lg border border-border bg-background px-2 text-xs">
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </label>
  );
}

