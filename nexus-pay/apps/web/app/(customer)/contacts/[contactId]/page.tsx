import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@nexus/ui";
import { ArrowLeft, ArrowRight, Send, Users, Wallet } from "lucide-react";
import { ApiError } from "@/lib/api/response";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { toTransactionSummary } from "@/lib/payments/dto";
import { getContactContext } from "@/lib/social/contact-service";
import { GROUP_CATEGORY_LABELS, type GroupCategory } from "@nexus/shared-types";
import { formatDate, initials } from "@/lib/format";
import { TransactionRow } from "@/components/payments/transaction-row";

export const metadata: Metadata = {
  title: "Contact detail",
};

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ contactId: string }>;
}) {
  const { contactId } = await params;
  const auth = await requireOnboardedUser(`/contacts/${contactId}`);
  let context;
  try {
    context = await getContactContext(auth.user.id, contactId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const { contact, recentPayments, sharedGroups } = context;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/contacts">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Contacts
        </Link>
      </Button>

      <Card>
        <CardHeader className="flex-row items-center gap-4 space-y-0">
          <span className="grid h-16 w-16 place-items-center rounded-2xl bg-navy text-lg font-semibold text-white">
            {initials(contact.user.displayName)}
          </span>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-xl">{contact.displayLabel ?? contact.user.displayName}</CardTitle>
            <CardDescription>
              {contact.displayLabel ? `${contact.user.displayName} · ` : ""}@{contact.user.username}
            </CardDescription>
            <p className="mt-1 text-xs text-muted-foreground">
              Added {formatDate(contact.createdAt)}
              {contact.recentInteractionAt
                ? ` · last payment ${formatDate(contact.recentInteractionAt)}`
                : ""}
            </p>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href={`/send?to=${encodeURIComponent(contact.user.username)}`}>
              <Send className="h-4 w-4" aria-hidden="true" />
              Send money
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/requests?to=${encodeURIComponent(contact.user.username)}`}>
              <Wallet className="h-4 w-4" aria-hidden="true" />
              Request money
            </Link>
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent shared payments</CardTitle>
            <CardDescription>Only payments recorded for this person.</CardDescription>
          </CardHeader>
          <CardContent>
            {recentPayments.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
                No payments with this person yet.
              </p>
            ) : (
              <div className="divide-y divide-border/70">
                {recentPayments.map((record) => (
                  <TransactionRow key={record.id} transaction={toTransactionSummary(record)} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Shared groups</CardTitle>
            <CardDescription>Groups you are both part of.</CardDescription>
          </CardHeader>
          <CardContent>
            {sharedGroups.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
                No shared groups yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {sharedGroups.map((group) => (
                  <li key={group.id}>
                    <Link
                      href={`/groups/${encodeURIComponent(group.id)}`}
                      className="flex items-center justify-between rounded-xl border border-border px-3.5 py-3 text-sm transition-colors hover:bg-secondary/50"
                    >
                      <span className="flex items-center gap-2 font-medium">
                        <Users className="h-4 w-4 text-primary" aria-hidden="true" />
                        {group.name}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        {GROUP_CATEGORY_LABELS[group.category as GroupCategory]}
                        <ArrowRight className="h-3 w-3" aria-hidden="true" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
