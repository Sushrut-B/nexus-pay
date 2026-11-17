"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { PaymentOperationView, ReconciliationCaseView } from "@nexus/shared-types";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { formatDateTime, formatMoney } from "@/lib/format";
import { toast } from "sonner";
import { ControlPageHeader, DataRow, LoadingState, StatusPill } from "@/components/control/ui";

export function PaymentDetailView({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const payment = useQuery({
    queryKey: ["control", "payment", id],
    queryFn: () => apiFetch<PaymentOperationView>(`/api/control/payments/${encodeURIComponent(id)}`),
  });
  const cases = useQuery({
    queryKey: ["control", "reconciliation"],
    queryFn: () => apiFetch<{ items: ReconciliationCaseView[] }>("/api/control/reconciliation"),
  });
  const openCase = useMutation({
    mutationFn: () =>
      apiFetch<ReconciliationCaseView>("/api/control/reconciliation/open", {
        method: "POST",
        body: JSON.stringify({ intentId: id }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["control", "reconciliation"] });
      toast.success("Reconciliation case opened");
    },
    onError: (error) => toast.error(error instanceof ApiClientError ? error.message : "Could not open case."),
  });
  const data = payment.data;
  const existingCase = cases.data?.items.find((item) => item.paymentIntentId === id);

  return (
    <div>
      <ControlPageHeader eyebrow="Payment investigation" title={data?.paymentRef ?? id} description="Application metadata only. Authoritative state is Raftline." />
      {payment.isLoading ? <LoadingState /> : null}
      {data ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-sm">Operation</CardTitle></CardHeader>
            <CardContent>
              <DataRow label="Intent id" value={<span className="font-mono">{data.intentId}</span>} />
              <DataRow label="Payment reference" value={data.paymentRef ?? "Not available"} />
              <DataRow label="Idempotency key" value={data.idempotencyKeyMasked} />
              <DataRow label="Sender wallet" value={data.senderWalletMasked} />
              <DataRow label="Recipient wallet" value={data.recipientWalletMasked} />
              <DataRow label="Amount" value={formatMoney(data.amountMinor, data.currency)} />
              <DataRow label="Rail" value={data.rail} />
              <DataRow label="Status" value={<StatusPill state={data.status} tone={data.status === "SETTLED" ? "healthy" : "warning"} />} />
              <DataRow label="Settlement interpretation" value={data.settlement.replaceAll("_", " ")} />
              <DataRow label="Idempotent replay" value={data.idempotentReplay ? "Yes (original result)" : "No"} />
              <DataRow label="Raft log index" value={data.raftLogIndex ?? "Not available"} />
              <DataRow label="Created" value={formatDateTime(data.createdAt)} />
              <DataRow label="Updated" value={formatDateTime(data.updatedAt)} />
              <DataRow label="Failure" value={data.failureMessage ?? data.rejectionCode ?? "None"} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Reconciliation</CardTitle></CardHeader>
            <CardContent>
              {existingCase ? (
                <>
                  <DataRow label="Case" value={existingCase.id} />
                  <DataRow label="Status" value={existingCase.status.replaceAll("_", " ")} />
                  <p className="mt-4"><Button asChild variant="outline" size="sm"><Link href="/control/reconciliation">Open case</Link></Button></p>
                </>
              ) : (
                <>
                  <p className="text-xs text-slate-600">
                    Opening a case records evidence queries only. It never resubmits a payment or creates a new idempotency key.
                  </p>
                  <Button className="mt-3" size="sm" disabled={openCase.isPending} onClick={() => openCase.mutate()}>
                    Open reconciliation case
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
