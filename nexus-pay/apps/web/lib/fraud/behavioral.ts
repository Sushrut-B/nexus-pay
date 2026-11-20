/** Release 13 — transparent behavioral analytics. No opaque machine learning. */

import { prisma, type BehavioralMetric } from "@nexus/database";

export interface BaselineState {
  sampleCount: number;
  mean: number;
  mdev: number;
  ewma: number;
  last: number;
  coldStart: boolean;
}

export const MIN_BASELINE_SAMPLES = 5;
export const EWMA_ALPHA = 0.2;

export function emptyBaseline(): BaselineState {
  return { sampleCount: 0, mean: 0, mdev: 0, ewma: 0, last: 0, coldStart: true };
}

/** Median absolute deviation around the mean — robust to outliers. */
export function medianAbsoluteDeviation(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  const deviations = values.map((value) => Math.abs(value - mean)).sort((a, b) => a - b);
  const mid = Math.floor(deviations.length / 2);
  const median = deviations.length % 2 === 0 ? (deviations[mid - 1]! + deviations[mid]!) / 2 : deviations[mid]!;
  return 1.4826 * median;
}

export function updateBaseline(previous: BaselineState, value: number, alpha = EWMA_ALPHA): BaselineState {
  if (!Number.isFinite(value)) return previous;
  const count = previous.sampleCount + 1;
  const mean = previous.sampleCount === 0 ? value : previous.mean + (value - previous.mean) / count;
  const mdev = previous.sampleCount === 0 ? 0 : previous.mdev + alpha * (Math.abs(value - previous.mean) - previous.mdev);
  const ewma = previous.sampleCount === 0 ? value : alpha * value + (1 - alpha) * previous.ewma;
  return {
    sampleCount: count,
    mean,
    mdev: Math.max(0, mdev),
    ewma,
    last: value,
    coldStart: count < MIN_BASELINE_SAMPLES,
  };
}

export function isColdStart(sampleCount: number): boolean {
  return sampleCount < MIN_BASELINE_SAMPLES;
}

/** 0–100 anomaly indicator from a robust deviation score. Cold start returns 0. */
export function anomalyScore(value: number, state: BaselineState): number {
  if (state.coldStart || state.sampleCount < MIN_BASELINE_SAMPLES) return 0;
  const scale = Math.max(state.mdev, 1);
  const z = Math.abs(value - state.mean) / scale;
  return Math.max(0, Math.min(100, Math.round((z / 6) * 100)));
}

export async function getBaseline(userId: string, metric: BehavioralMetric): Promise<BaselineState> {
  const row = await prisma.behavioralBaseline.findUnique({ where: { userId_metric: { userId, metric } } });
  if (!row) return emptyBaseline();
  return {
    sampleCount: row.sampleCount,
    mean: row.meanValue ?? 0,
    mdev: row.mdevValue ?? 0,
    ewma: row.ewmaValue ?? 0,
    last: row.lastValue ?? 0,
    coldStart: row.coldStart,
  };
}

export async function recordObservation(userId: string, metric: BehavioralMetric, value: number): Promise<BaselineState> {
  const current = await getBaseline(userId, metric);
  const next = updateBaseline(current, value);
  await prisma.behavioralBaseline.upsert({
    where: { userId_metric: { userId, metric } },
    create: {
      userId, metric, sampleCount: next.sampleCount, meanValue: next.mean, mdevValue: next.mdev,
      ewmaValue: next.ewma, lastValue: next.last, coldStart: next.coldStart,
    },
    update: {
      sampleCount: next.sampleCount, meanValue: next.mean, mdevValue: next.mdev,
      ewmaValue: next.ewma, lastValue: next.last, coldStart: next.coldStart,
    },
  });
  return next;
}
