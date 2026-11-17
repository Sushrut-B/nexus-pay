import { NextResponse } from "next/server";
import { Prisma } from "@nexus/database";
import type { ApiErrorBody, ErrorCategory } from "@nexus/shared-types";
import { RaftlineError } from "@nexus/api-client";
import { ZodError } from "zod";
import { logApiError } from "@/lib/api/logger";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly category: ErrorCategory,
    message: string,
    readonly fields?: Record<string, string>,
    readonly headers?: HeadersInit,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
};

export function withRequestId(response: NextResponse, requestId: string): NextResponse {
  response.headers.set("X-Request-Id", requestId);
  return response;
}

export function jsonOk<T>(
  data: T,
  requestId: string,
  status = 200,
  headers?: HeadersInit,
): NextResponse {
  const response = NextResponse.json(
    { data, requestId },
    {
      status,
      headers: {
        ...NO_STORE_HEADERS,
        ...headers,
      },
    },
  );
  return withRequestId(response, requestId);
}

export function jsonError(
  requestId: string,
  status: number,
  category: ErrorCategory,
  message: string,
  fields?: Record<string, string>,
  headers?: HeadersInit,
): NextResponse {
  const body: ApiErrorBody = {
    error: { category, message, ...(fields ? { fields } : {}) },
    requestId,
  };
  const response = NextResponse.json(body, {
    status,
    headers: {
      ...NO_STORE_HEADERS,
      ...headers,
    },
  });
  return withRequestId(response, requestId);
}

function zodFields(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

export function handleRouteError(error: unknown, requestId: string): NextResponse {
  if (error instanceof ApiError) {
    return jsonError(
      requestId,
      error.status,
      error.category,
      error.message,
      error.fields,
      error.headers,
    );
  }

  if (error instanceof ZodError) {
    return jsonError(
      requestId,
      400,
      "VALIDATION_ERROR",
      "Please check the highlighted fields and try again.",
      zodFields(error),
    );
  }

  if (error instanceof RaftlineError) {
    if (error.code === "NOT_FOUND") {
      return jsonError(requestId, 404, "RAFTLINE_UNAVAILABLE", "The wallet account was not found.");
    }
    return jsonError(
      requestId,
      503,
      error.code === "TIMEOUT" ? "RAFTLINE_TIMEOUT" : "RAFTLINE_UNAVAILABLE",
      "The wallet service is temporarily unavailable. Please try again.",
    );
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return jsonError(
        requestId,
        409,
        "DATABASE_ERROR",
        "That value is already in use.",
      );
    }
    if (error.code === "P2025") {
      return jsonError(requestId, 404, "DATABASE_ERROR", "The requested record was not found.");
    }
  }

  logApiError(requestId, error);
  return jsonError(
    requestId,
    500,
    "INTERNAL_SERVER_ERROR",
    "Something went wrong on our side. Please try again.",
  );
}

export function getRequestId(request: Request): string {
  const candidate = request.headers.get("x-request-id");
  if (candidate && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)) {
    return candidate;
  }
  return crypto.randomUUID();
}
