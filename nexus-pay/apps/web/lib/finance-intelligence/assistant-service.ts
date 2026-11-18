import { prisma } from "@nexus/database";
import type { AssistantConversationView, AssistantResult } from "@nexus/shared-types";
import type { AssistantChatInput } from "@nexus/validation";
import { getCashFlow, getCategorySpend, getExtendedOverview } from "@/lib/finance-intelligence/aggregation-service";
import { getSubscriptionIntelligence } from "@/lib/finance-intelligence/subscription-intelligence-service";
import { listPatterns } from "@/lib/finance-intelligence/recurring-service";
import { listFinancialGoals } from "@/lib/finance-intelligence/goals-service";
import { generateForecast } from "@/lib/finance-intelligence/forecast-service";

const SUGGESTIONS = [
  "How much did I spend this month?",
  "Which category costs me the most?",
  "What are my upcoming subscriptions?",
  "How much do I spend on subscriptions annually?",
  "Which recurring payments are coming up?",
  "How close am I to my savings goals?",
  "How much can I plan to save this month?",
];

function money(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function privacyBlocked(message: string): boolean {
  const text = message.toLowerCase();
  return /\bbob\b|another user|other user|someone else|@[a-z0-9.-]+\.[a-z]{2,}/.test(text);
}

/** Deterministic structured-query assistant. No LLM or unrestricted DB access. */
export async function chat(userId: string, input: AssistantChatInput): Promise<AssistantResult> {
  const message = input.message.trim();
  const lower = message.toLowerCase();
  let conversationId = input.conversationId ?? "";
  if (!conversationId) {
    const conversation = await prisma.financeAssistantConversation.create({
      data: { userId, title: message.slice(0, 160) },
    });
    conversationId = conversation.id;
  } else {
    const owned = await prisma.financeAssistantConversation.findFirst({ where: { id: conversationId, userId } });
    if (!owned) {
      const conversation = await prisma.financeAssistantConversation.create({
        data: { userId, title: message.slice(0, 160) },
      });
      conversationId = conversation.id;
    }
  }
  await prisma.financeAssistantMessage.create({
    data: { conversationId, role: "USER", content: message },
  });

  let answer = "";
  let dataSource: AssistantResult["dataSource"] = "ACTUAL";
  let period: string | null = null;
  let calculation: string | null = null;
  const links: string[] = [];
  const references: string[] = [];

  if (privacyBlocked(message)) {
    answer = "I can only answer questions about your own financial records. I cannot retrieve information about other users.";
    dataSource = "INSUFFICIENT";
  } else if (/recurring|scheduled payment/.test(lower)) {
    const patterns = await listPatterns(userId);
    const confirmed = patterns.filter((pattern) => pattern.status === "CONFIRMED");
    answer = confirmed.length === 0
      ? "You have no confirmed recurring expense patterns yet. Potential patterns require your confirmation before they are tracked."
      : `You have ${confirmed.length} confirmed recurring pattern${confirmed.length === 1 ? "" : "s"}: ${confirmed.map((p) => `${p.merchant} about ${money(p.amountMinor)} ${p.frequency.toLowerCase()}`).join("; ")}.`;
    links.push("/finance/recurring");
  } else if (/subscription/.test(lower)) {
    const subscriptions = await getSubscriptionIntelligence(userId);
    if (/annual|year/.test(lower)) {
      answer = `Your active subscriptions imply about ${money(subscriptions.annualCommitmentMinor)} per year. This is an estimate from current plans, not money already paid.`;
    } else {
      answer = `You have ${subscriptions.activeCount} active subscription${subscriptions.activeCount === 1 ? "" : "s"}, with ${subscriptions.upcomingCount} upcoming renewal${subscriptions.upcomingCount === 1 ? "" : "s"}. Estimated monthly commitment is ${money(subscriptions.monthlyCommitmentMinor)}.`;
    }
    calculation = "Commitment normalizes each billing frequency to a monthly equivalent; annual = monthly × 12.";
    dataSource = "FORECAST";
    links.push("/finance/subscriptions");
  } else if (/goal|emergency fund|savings/.test(lower)) {
    const goals = await listFinancialGoals(userId);
    if (goals.length === 0) {
      answer = "You have no savings goals yet. Planned contributions do not move wallet money.";
      dataSource = "INSUFFICIENT";
    } else {
      answer = goals.map((goal) => `${goal.name}: ${(goal.progressBps / 100).toFixed(0)}% of ${money(goal.targetMinor)} (${money(goal.recordedMinor)} actually recorded, ${money(goal.plannedMinor)} planned)`).join("; ") + ".";
      calculation = "Progress uses recorded plus planned contributions; only recorded contributions reflect real money.";
      links.push("/finance/goals");
    }
  } else if (/save this month|can i save|forecast/.test(lower)) {
    const forecast = await generateForecast(userId, "MONTHLY_EXPENSE", "month");
    if (!forecast.available) {
      answer = forecast.reason ?? "There is not enough historical data to make a forecast.";
      dataSource = "INSUFFICIENT";
    } else {
      answer = `Based on ${forecast.historyCount} historical records, your forecast monthly spending is ${money(forecast.predictedMinor)} (range ${money(forecast.lowMinor)}–${money(forecast.highMinor)}). This is an estimate, not a guarantee.`;
      calculation = forecast.method;
      dataSource = "FORECAST";
    }
    links.push("/finance/forecasts");
  } else if (/more than last month|increase|compare/.test(lower)) {
    const overview = await getExtendedOverview(userId, "month");
    const change = overview.previous.outflowMinor > 0
      ? Math.round(((overview.outflowMinor - overview.previous.outflowMinor) / overview.previous.outflowMinor) * 100)
      : null;
    answer = change === null
      ? "There is not enough previous-period data for a comparison."
      : `Your recorded spending this month is ${money(overview.outflowMinor)} versus ${money(overview.previous.outflowMinor)} in the previous month, a ${change >= 0 ? "+" : ""}${change}% change.`;
    period = overview.period.label;
    calculation = "(current outflow − previous outflow) ÷ previous outflow × 100";
    links.push("/finance/cashflow");
  } else if (/category|costs me the most|biggest/.test(lower)) {
    const categories = await getCategorySpend(userId, "month");
    if (categories.length === 0) {
      answer = "There are no recorded expenses to analyse yet.";
      dataSource = "INSUFFICIENT";
    } else {
      const top = categories[0]!;
      answer = `Your largest recorded category this month is ${top.category.replaceAll("_", " ").toLowerCase()} at ${money(top.amountMinor)}.`;
      period = "This month";
      calculation = "Sum of successful outflow records grouped by category.";
      links.push("/finance/spending");
    }
  } else if (/spend|spent|expense|how much/.test(lower)) {
    const isLastMonth = /last month|october|previous month/.test(lower);
    const cashFlow = await getCashFlow(userId, isLastMonth ? "last_month" : "month");
    answer = `You recorded ${money(cashFlow.totalOutflowMinor)} of spending and ${money(cashFlow.totalInflowMinor)} of inflow${isLastMonth ? " last month" : " this month"}.`;
    period = isLastMonth ? "Last month" : "This month";
    calculation = cashFlow.definitions.outflowMinor;
    links.push("/finance/cashflow");
  } else {
    answer = "I can answer questions about your recorded spending, income, categories, subscriptions, recurring patterns, forecasts and goals.";
    dataSource = "INSUFFICIENT";
  }

  await prisma.financeAssistantMessage.create({
    data: { conversationId, role: "ASSISTANT", content: answer, data: { dataSource, period } },
  });
  return {
    conversationId, answer, dataSource, period, calculation, links, references,
    suggestedFollowUps: SUGGESTIONS.slice(0, 4), mode: "DETERMINISTIC",
  };
}

export async function listConversations(userId: string): Promise<AssistantConversationView[]> {
  const rows = await prisma.financeAssistantConversation.findMany({
    where: { userId }, include: { messages: true }, orderBy: { updatedAt: "desc" }, take: 50,
  });
  return rows.map((row) => ({
    id: row.id, title: row.title, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    messages: row.messages.map((message) => ({ role: message.role, content: message.content, at: message.createdAt.toISOString() })),
  }));
}

export async function getConversation(userId: string, id: string): Promise<AssistantConversationView> {
  const row = await prisma.financeAssistantConversation.findFirst({
    where: { id, userId }, include: { messages: true },
  });
  if (!row) {
    return { id, title: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [] };
  }
  return {
    id: row.id, title: row.title, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    messages: row.messages.map((message) => ({ role: message.role, content: message.content, at: message.createdAt.toISOString() })),
  };
}

export { SUGGESTIONS as ASSISTANT_SUGGESTIONS };
