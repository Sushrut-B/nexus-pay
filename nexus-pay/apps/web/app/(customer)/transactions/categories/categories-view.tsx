"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@nexus/ui";
import type {
  CategoryRuleView,
  CategoryView,
  TransactionListResult,
  TransactionSummary,
} from "@nexus/shared-types";
import {
  CATEGORY_TYPE_LABELS,
  PAYMENT_STATUS_LABELS,
  RULE_CONDITION_TYPES,
  type RuleConditionType,
} from "@nexus/shared-types";
import { Plus, Tag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { formatDateTime, formatMoney } from "@/lib/format";

interface CategoriesResponse {
  categories: CategoryView[];
  categorizations: Array<{ paymentRef: string; categoryId: string; note: string | null }>;
}

export function CategoriesView() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"transactions" | "rules">("transactions");
  const [conditionType, setConditionType] = useState<RuleConditionType>("CONTAINS");
  const [conditionValue, setConditionValue] = useState("");
  const [ruleCategory, setRuleCategory] = useState("");
  const [priority, setPriority] = useState("100");

  const categories = useQuery({
    queryKey: ["finance", "categories"],
    queryFn: () => apiFetch<CategoriesResponse>("/api/transactions/categories"),
  });
  const rules = useQuery({
    queryKey: ["finance", "rules"],
    queryFn: () => apiFetch<{ items: CategoryRuleView[] }>("/api/transactions/category-rules"),
    enabled: activeTab === "rules",
  });
  const transactions = useQuery({
    queryKey: ["finance", "transactions"],
    queryFn: () => apiFetch<TransactionListResult>("/api/payments?pageSize=50"),
  });

  const categorize = useMutation({
    mutationFn: ({ paymentRef, categoryId }: { paymentRef: string; categoryId: string }) =>
      apiFetch(`/api/transactions/${encodeURIComponent(paymentRef)}/category`, {
        method: "PATCH",
        body: JSON.stringify({ categoryId }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["finance"] });
      toast.success("Category saved");
    },
    onError: (error) => toast.error(error instanceof ApiClientError ? error.message : "Could not save category."),
  });

  const createRule = useMutation({
    mutationFn: () =>
      apiFetch("/api/transactions/category-rules", {
        method: "POST",
        body: JSON.stringify({
          conditionType,
          conditionValue,
          categoryId: ruleCategory,
          priority: Number(priority),
        }),
      }),
    onSuccess: () => {
      setConditionValue("");
      void queryClient.invalidateQueries({ queryKey: ["finance", "rules"] });
      void queryClient.invalidateQueries({ queryKey: ["finance", "categories"] });
      toast.success("Rule created");
    },
    onError: (error) => toast.error(error instanceof ApiClientError ? error.message : "Could not create rule."),
  });

  const deleteRule = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/transactions/category-rules/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["finance", "rules"] });
      toast.success("Rule removed");
    },
    onError: (error) => toast.error(error instanceof ApiClientError ? error.message : "Could not remove rule."),
  });

  const categorizationByRef = new Map(
    (categories.data?.categorizations ?? []).map((row) => [row.paymentRef, row.categoryId]),
  );

  const filteredTransactions = (transactions.data?.items ?? []).filter((transaction) => {
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return [transaction.counterpartyName, transaction.description, transaction.paymentRef]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          Categorization
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
          Make sense of your transactions.
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Categories are metadata only. Changing a category never changes the underlying Raftline transaction or its financial status.
        </p>
      </div>

      <div className="flex gap-1 rounded-xl border border-border bg-secondary/40 p-1">
        <Button size="sm" variant={activeTab === "transactions" ? "default" : "ghost"} onClick={() => setActiveTab("transactions")}>
          Transactions
        </Button>
        <Button size="sm" variant={activeTab === "rules" ? "default" : "ghost"} onClick={() => setActiveTab("rules")}>
          My rules
        </Button>
      </div>

      {activeTab === "transactions" ? (
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-base">Recent transactions</CardTitle>
              <CardDescription>Assign or correct a category for verified records</CardDescription>
            </div>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search transactions" aria-label="Search transactions" className="h-9 w-56" />
          </CardHeader>
          <CardContent>
            {filteredTransactions.length === 0 ? (
              <p className="py-10 text-center text-xs text-muted-foreground">No confirmed transactions yet.</p>
            ) : (
              <div className="divide-y divide-border/70">
                {filteredTransactions.map((transaction) => (
                  <TransactionCategoryRow
                    key={transaction.id}
                    transaction={transaction}
                    categories={categories.data?.categories ?? []}
                    currentCategoryId={categorizationByRef.get(transaction.paymentRef ?? "")}
                    onSave={(categoryId) =>
                      transaction.paymentRef && categorize.mutate({ paymentRef: transaction.paymentRef, categoryId })
                    }
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Create a rule</CardTitle>
              <CardDescription>
                Highest priority wins; ties are resolved by creation order. Rules apply to uncategorized and future transactions.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="rule-condition">If the description</Label>
                <select id="rule-condition" value={conditionType} onChange={(e) => setConditionType(e.target.value as RuleConditionType)} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
                  {RULE_CONDITION_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {value === "CONTAINS" ? "contains" : value === "STARTS_WITH" ? "starts with" : value === "ENDS_WITH" ? "ends with" : "is exactly"}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="rule-value">Text</Label>
                <Input id="rule-value" value={conditionValue} onChange={(e) => setConditionValue(e.target.value)} placeholder="e.g. Netflix" className="mt-1.5" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="rule-category">Category</Label>
                  <select id="rule-category" value={ruleCategory} onChange={(e) => setRuleCategory(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
                    <option value="">Choose…</option>
                    {(categories.data?.categories ?? []).map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="rule-priority">Priority</Label>
                  <Input id="rule-priority" value={priority} onChange={(e) => setPriority(e.target.value)} inputMode="numeric" className="mt-1.5" />
                </div>
              </div>
              <Button
                className="w-full"
                disabled={conditionValue.trim().length < 2 || !ruleCategory || createRule.isPending}
                onClick={() => createRule.mutate()}
              >
                <Plus className="h-4 w-4" aria-hidden="true" /> Create rule
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Tag className="h-4 w-4" aria-hidden="true" /> Your rules</CardTitle>
              <CardDescription>Deterministic and fully under your control</CardDescription>
            </CardHeader>
            <CardContent>
              {(rules.data?.items ?? []).length === 0 ? (
                <p className="py-10 text-center text-xs text-muted-foreground">
                  No rules yet. Create one to categorize future payments automatically.
                </p>
              ) : (
                <div className="divide-y divide-border/70">
                  {rules.data?.items.map((rule) => (
                    <div key={rule.id} className="flex items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">
                          If description <span className="font-semibold">{rule.conditionType.toLowerCase().replaceAll("_", " ")}</span> “{rule.conditionValue}”
                        </p>
                        <p className="text-xs text-muted-foreground">
                          → {rule.categoryName} · priority {rule.priority}
                        </p>
                      </div>
                      <Badge variant={rule.isEnabled ? "success" : "secondary"}>
                        {rule.isEnabled ? "Enabled" : "Disabled"}
                      </Badge>
                      <Button size="sm" variant="ghost" aria-label="Delete rule" onClick={() => deleteRule.mutate(rule.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function TransactionCategoryRow({
  transaction,
  categories,
  currentCategoryId,
  onSave,
}: {
  transaction: TransactionSummary;
  categories: CategoryView[];
  currentCategoryId?: string;
  onSave: (categoryId: string) => void;
}) {
  const [value, setValue] = useState(currentCategoryId ?? "");
  const category = currentCategoryId ? categories.find((c) => c.id === currentCategoryId) : null;

  return (
    <div className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {transaction.counterpartyName ?? (transaction.kind === "FUNDING" ? "Simulated sandbox funding" : "Nexus Pay customer")}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {transaction.description ?? "No note"} · {formatDateTime(transaction.occurredAt)}
        </p>
      </div>
      <p className="text-sm font-semibold tabular-nums">
        {transaction.direction === "RECEIVED" ? "+" : "−"}{formatMoney(transaction.amountMinor, transaction.currency)}
      </p>
      <Badge variant="secondary">{transaction.status === "SUCCESSFUL" ? "Verified" : PAYMENT_STATUS_LABELS[transaction.status as keyof typeof PAYMENT_STATUS_LABELS] ?? transaction.status}</Badge>
      <select
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          if (event.target.value) onSave(event.target.value);
        }}
        aria-label={`Category for ${transaction.paymentRef ?? transaction.id}`}
        className="h-9 rounded-lg border border-input bg-background px-2 text-xs"
      >
        <option value="">{category ? CATEGORY_TYPE_LABELS[category.categoryType] : "Uncategorized"}</option>
        {categories.map((item) => (
          <option key={item.id} value={item.id}>{item.name}</option>
        ))}
      </select>
    </div>
  );
}
