export function logApiError(requestId: string, error: unknown): void {
  const safeMessage = error instanceof Error ? error.message : "Unknown error";
  const safeStack = error instanceof Error ? error.stack : undefined;
  console.error(`[api:${requestId}] ${safeMessage}`, safeStack ?? "");
}
