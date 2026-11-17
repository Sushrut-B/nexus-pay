export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly category: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  const entry = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : null;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (method !== "GET" && method !== "HEAD") {
    const csrf = readCookie("np_csrf");
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }

  const response = await fetch(path, {
    ...options,
    method,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const errorBody = payload as
      | { error?: { message?: string; category?: string; fields?: Record<string, string> } }
      | null;
    throw new ApiClientError(
      errorBody?.error?.message ?? "Something went wrong. Please try again.",
      response.status,
      errorBody?.error?.category ?? "INTERNAL_SERVER_ERROR",
      errorBody?.error?.fields ?? {},
    );
  }

  return (payload as { data: T }).data;
}
