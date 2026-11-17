import { ApiError } from "@/lib/api/response";

const MAX_BODY_BYTES = 64 * 1024;

export async function readJsonBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new ApiError(413, "VALIDATION_ERROR", "Request body is too large.");
  }

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    throw new ApiError(413, "VALIDATION_ERROR", "Request body is too large.");
  }
  if (!text.trim()) {
    throw new ApiError(400, "VALIDATION_ERROR", "A JSON request body is required.");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "VALIDATION_ERROR", "The request body must be valid JSON.");
  }
}
