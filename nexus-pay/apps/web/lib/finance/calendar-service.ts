import { prisma } from "@nexus/database";
import type { CalendarEventView } from "@nexus/shared-types";
import { currentBudgetPeriod } from "@/lib/finance/budget-service";

function inWindow(date: Date, from: Date, to: Date): boolean {
  return date >= from && date <= to;
}

/**
 * Calendar combines confirmed scheduled executions, budget boundaries and
 * savings target dates. Recurring estimates are labelled separately and are
 * never presented as confirmed payments.
 */
export async function getCalendarEvents(
  userId: string,
  from: string,
  to: string,
): Promise<CalendarEventView[]> {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T23:59:59.999Z`);
  const events: CalendarEventView[] = [];

  const schedules = await prisma.scheduledPayment.findMany({
    where: { userId, status: { in: ["ACTIVE", "PAUSED", "REQUIRES_ATTENTION"] } },
    include: { recipient: { include: { profile: true } } },
  });
  for (const schedule of schedules) {
    if (inWindow(schedule.nextExecutionAt, start, end)) {
      events.push({
        id: `schedule-${schedule.id}`,
        type: "SCHEDULED_PAYMENT",
        title: `Payment to ${schedule.recipient.profile?.displayName ?? schedule.recipient.fullName}`,
        date: schedule.nextExecutionAt.toISOString(),
        amountMinor: Number(schedule.amountMinor),
        status: schedule.status,
        reference: schedule.id,
      });
    }
  }

  const budgets = await prisma.budget.findMany({
    where: { userId, status: { in: ["ACTIVE", "PAUSED"] } },
    include: { category: true },
  });
  for (const budget of budgets) {
    const period = currentBudgetPeriod(budget);
    if (inWindow(period.start, start, end)) {
      events.push({
        id: `budget-start-${budget.id}`,
        type: "BUDGET_PERIOD",
        title: `${budget.name} budget starts`,
        date: period.start.toISOString(),
        amountMinor: Number(budget.amountMinor),
        status: budget.status,
        reference: budget.id,
      });
    }
    if (inWindow(period.end, start, end)) {
      events.push({
        id: `budget-end-${budget.id}`,
        type: "BUDGET_PERIOD",
        title: `${budget.name} budget ends`,
        date: period.end.toISOString(),
        amountMinor: Number(budget.amountMinor),
        status: budget.status,
        reference: budget.id,
      });
    }
  }

  const goals = await prisma.savingsGoal.findMany({
    where: { userId, status: { in: ["ACTIVE", "PAUSED"] }, targetDate: { not: null } },
  });
  for (const goal of goals) {
    if (goal.targetDate && inWindow(goal.targetDate, start, end)) {
      events.push({
        id: `goal-${goal.id}`,
        type: "SAVINGS_GOAL",
        title: `${goal.name} target date`,
        date: goal.targetDate.toISOString(),
        amountMinor: Number(goal.targetAmountMinor),
        status: goal.status,
        reference: goal.id,
      });
    }
  }

  const suggestions = await prisma.recurringPaymentSuggestion.findMany({
    where: { userId, status: "SUGGESTED", nextExpectedAt: { not: null } },
  });
  for (const suggestion of suggestions) {
    if (suggestion.nextExpectedAt && inWindow(suggestion.nextExpectedAt, start, end)) {
      events.push({
        id: `recurring-${suggestion.id}`,
        type: "RECURRING_ESTIMATE",
        title: `Estimated recurring payment to ${suggestion.counterparty}`,
        date: suggestion.nextExpectedAt.toISOString(),
        amountMinor: Number(suggestion.amountMinor),
        status: "ESTIMATED",
        reference: suggestion.id,
      });
    }
  }

  return events.sort((a, b) => a.date.localeCompare(b.date));
}
