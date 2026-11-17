import { RaftlineError } from "./errors";

export interface RaftlineHttpResponse {
  status: number;
  headers: Headers;
  text: string;
  url: string;
}

export interface HttpTransport {
  request(url: string, init?: RequestInit, timeoutMs?: number): Promise<RaftlineHttpResponse>;
}

export class RaftlineHttp implements HttpTransport {
  constructor(
    private readonly defaultTimeoutMs: number,
    private readonly apiKey: string | null,
  ) {}

  async request(
    url: string,
    init: RequestInit = {},
    timeoutMs = this.defaultTimeoutMs,
  ): Promise<RaftlineHttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (this.apiKey) {
      headers.set("X-API-Key", this.apiKey);
    }

    try {
      const response = await fetch(url, {
        ...init,
        headers,
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
      });
      const text = await response.text();
      return {
        status: response.status,
        headers: response.headers,
        text,
        url,
      };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new RaftlineError("Raftline request timed out", {
          code: "TIMEOUT",
          ambiguous: init.method ? init.method.toUpperCase() !== "GET" : false,
          cause: error,
        });
      }
      throw new RaftlineError("Raftline is unavailable", {
        code: "UNAVAILABLE",
        ambiguous: init.method ? init.method.toUpperCase() !== "GET" : false,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
