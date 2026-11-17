import type { Metadata } from "next";
import Link from "next/link";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@nexus/ui";
import {
  HISTORY_FILTERS,
  HISTORY_SORTS,
  type HistoryFilter,
  type HistorySort,
} from "@nexus/shared-types";
import { ChevronLeft, ChevronRight, ListFilter, Search } from "lucide-react";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { listTransactions } from "@/lib/payments/transaction-service";
import { TransactionRow } from "@/components/payments/transaction-row";
import { historyQuerySchema, type HistoryQueryInput } from "@nexus/validation";

export const metadata: Metadata = {
  title: "Transactions",
};

const FILTER_LABELS: Record<HistoryFilter, string> = {
  ALL: "All activity",
  SENT: "Money sent",
  RECEIVED: "Money received",
  SUCCESSFUL: "Successful",
  FAILED: "Failed",
  PROCESSING: "Awaiting confirmation",
};

const SORT_LABELS: Record<HistorySort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
};

function readQuery(
  input: Record<string, string | string[] | undefined>,
): HistoryQueryInput {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.trim().length > 0) flat[key] = value;
  }
  const parsed = historyQuerySchema.safeParse(flat);
  return parsed.success ? parsed.data : historyQuerySchema.parse({});
}

function pageHref(query: HistoryQueryInput, page: number): string {
  const params = new URLSearchParams();
  params.set("filter", query.filter);
  params.set("sort", query.sort);
  if (query.search) params.set("search", query.search);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  params.set("pageSize", String(query.pageSize));
  if (page > 1) params.set("page", String(page));
  return `/transactions?${params.toString()}`;
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireOnboardedUser("/transactions");
  const query = readQuery(await searchParams);
  const result = await listTransactions(auth.user.id, query);

  const hasFilters =
    query.filter !== "ALL" ||
    Boolean(query.search) ||
    Boolean(query.from) ||
    Boolean(query.to) ||
    query.sort !== "newest";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Transactions
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
            Every movement, accounted for.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {result.total === 0
              ? "No transactions match the current view."
              : `${result.total} transaction${result.total === 1 ? "" : "s"} · ${FILTER_LABELS[result.filter]} · ${SORT_LABELS[result.sort]}`}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/wallet">
            <ListFilter className="h-4 w-4" aria-hidden="true" />
            Wallet overview
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filter activity</CardTitle>
          <CardDescription>
            Search by name, username, reference or note. Dates are inclusive.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form method="get" action="/transactions" className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2">
                <Label htmlFor="search">Search</Label>
                <div className="relative mt-1.5">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    id="search"
                    name="search"
                    defaultValue={query.search ?? ""}
                    placeholder="Name, @username, reference"
                    maxLength={80}
                    className="pl-9"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="filter">Type</Label>
                <select
                  id="filter"
                  name="filter"
                  defaultValue={query.filter}
                  className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-primary/60 focus-visible:ring-4 focus-visible:ring-primary/10"
                >
                  {HISTORY_FILTERS.map((filter) => (
                    <option key={filter} value={filter}>
                      {FILTER_LABELS[filter]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label htmlFor="sort">Order</Label>
                <select
                  id="sort"
                  name="sort"
                  defaultValue={query.sort}
                  className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-primary/60 focus-visible:ring-4 focus-visible:ring-primary/10"
                >
                  {HISTORY_SORTS.map((sort) => (
                    <option key={sort} value={sort}>
                      {SORT_LABELS[sort]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label htmlFor="from">From</Label>
                <Input id="from" name="from" type="date" defaultValue={query.from ?? ""} className="mt-1.5" />
              </div>

              <div>
                <Label htmlFor="to">To</Label>
                <Input id="to" name="to" type="date" defaultValue={query.to ?? ""} className="mt-1.5" />
              </div>

              <div>
                <Label htmlFor="pageSize">Rows</Label>
                <select
                  id="pageSize"
                  name="pageSize"
                  defaultValue={String(query.pageSize)}
                  className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-primary/60 focus-visible:ring-4 focus-visible:ring-primary/10"
                >
                  {[10, 25, 50].map((size) => (
                    <option key={size} value={size}>
                      {size} per page
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end gap-2">
                <Button type="submit" className="flex-1">
                  Apply
                </Button>
                {hasFilters || result.page > 1 ? (
                  <Button asChild variant="outline">
                    <Link href="/transactions">Clear</Link>
                  </Button>
                ) : null}
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Activity</CardTitle>
            <CardDescription>
              Only ledger-verified outcomes are labelled successful.
            </CardDescription>
          </div>
          <span className="text-xs text-muted-foreground">
            Page {result.page} of {result.totalPages}
          </span>
        </CardHeader>
        <CardContent>
          {result.items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-5 py-12 text-center">
              <ListFilter
                className="mx-auto h-7 w-7 text-muted-foreground/50"
                aria-hidden="true"
              />
              <p className="mt-3 text-sm font-medium text-foreground">Nothing here yet</p>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                {hasFilters
                  ? "No transactions match these filters. Try a wider date range or clear the search."
                  : "Add simulated sandbox funds or send money to another Nexus Pay customer to start your history."}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {hasFilters ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href="/transactions">Clear filters</Link>
                  </Button>
                ) : null}
                <Button asChild size="sm">
                  <Link href="/wallet/add-money">Add money</Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border/70">
              {result.items.map((transaction) => (
                <TransactionRow key={transaction.id} transaction={transaction} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {result.totalPages > 1 ? (
        <nav className="flex items-center justify-between gap-3" aria-label="Pagination">
          <Button
            asChild={result.page > 1}
            variant="outline"
            size="sm"
            disabled={result.page <= 1}
          >
            {result.page > 1 ? (
              <Link href={pageHref(query, result.page - 1)} rel="prev">
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Previous
              </Link>
            ) : (
              <span>
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Previous
              </span>
            )}
          </Button>
          <p className="text-xs text-muted-foreground">
            Showing {(result.page - 1) * result.pageSize + 1}–
            {Math.min(result.page * result.pageSize, result.total)} of {result.total}
          </p>
          <Button
            asChild={result.page < result.totalPages}
            variant="outline"
            size="sm"
            disabled={result.page >= result.totalPages}
          >
            {result.page < result.totalPages ? (
              <Link href={pageHref(query, result.page + 1)} rel="next">
                Next
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            ) : (
              <span>
                Next
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </span>
            )}
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
