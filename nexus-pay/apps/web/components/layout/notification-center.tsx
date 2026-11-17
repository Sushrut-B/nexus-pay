"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@nexus/ui";
import type { NotificationListResult } from "@nexus/shared-types";
import { Bell, CheckCheck } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { relativeTime } from "@/lib/format";

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiFetch<NotificationListResult>("/api/notifications?pageSize=8"),
    refetchInterval: 30_000,
    enabled: open,
  });

  const unread = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => apiFetch<{ unreadCount: number }>("/api/notifications/unread-count"),
    refetchInterval: 30_000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/notifications/${encodeURIComponent(id)}/read`, {
        method: "PATCH",
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      void notifications.refetch();
      void unread.refetch();
    },
  });

  useEffect(() => {
    function onPointer(event: MouseEvent) {
      if (container.current && !container.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, []);

  const count = unread.data?.unreadCount ?? 0;
  const items = notifications.data?.items ?? [];

  return (
    <div className="relative" ref={container}>
      <button
        type="button"
        aria-label={`Notifications${count > 0 ? `, ${count} unread` : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="relative grid h-9 w-9 place-items-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {count > 0 ? (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-foreground">Notifications</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: ["notifications"] });
                void unread.refetch();
              }}
            >
              <Bell className="h-3.5 w-3.5" aria-hidden="true" />
              Refresh
            </Button>
          </div>
          <div className="max-h-[22rem] overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                You&apos;re all caught up.
              </p>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (!item.readAt) markRead.mutate(item.id);
                  }}
                  className={`flex w-full gap-3 border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-secondary/50 ${
                    item.readAt ? "opacity-70" : ""
                  }`}
                >
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">{item.title}</span>
                    {item.body ? (
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {item.body}
                      </span>
                    ) : null}
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      {relativeTime(item.createdAt)}
                    </span>
                  </span>
                  {!item.readAt ? <CheckCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : null}
                </button>
              ))
            )}
          </div>
          <Link
            href="/requests"
            onClick={() => setOpen(false)}
            className="block px-4 py-3 text-center text-xs font-semibold text-primary hover:bg-secondary/50"
          >
            View payment requests
          </Link>
        </div>
      ) : null}
    </div>
  );
}
