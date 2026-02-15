import { NextRequest } from "next/server"

const DEFAULT_OPENCLAW_HTTP_BASE_URL = "http://localhost:18789"
const DEFAULT_RESPONSES_TIMEOUT_MS = 180_000

function resolveOpenClawHttpBaseUrl() {
  return (
    process.env.OPENCLAW_HTTP_BASE_URL
    ?? process.env.OPENCLAW_GATEWAY_BASE_URL?.replace(/^ws:\/\//, "http://").replace(/^wss:\/\//, "https://")
    ?? DEFAULT_OPENCLAW_HTTP_BASE_URL
  ).replace(/\/+$/, "")
}

function resolveResponsesPath() {
  return process.env.OPENCLAW_RESPONSES_PATH ?? "/v1/responses"
}

function resolveTimeoutMs() {
  const raw = process.env.OPENCLAW_RESPONSES_TIMEOUT_MS
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_RESPONSES_TIMEOUT_MS
}

function buildAuthHeaders() {
  const headers: Record<string, string> = {}
  const token =
    process.env.OPENCLAW_HTTP_AUTH_TOKEN
    ?? process.env.OPENCLAW_GATEWAY_TOKEN
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

function normalizeRequestPayload(payload: unknown) {
  const raw =
    payload && typeof payload === "object"
      ? { ...(payload as Record<string, unknown>) }
      : {}

  if (typeof raw.prompt === "string" && raw.input == null) {
    raw.input = raw.prompt
    delete raw.prompt
  }

  raw.stream = true
  if (
    raw.model == null
    && process.env.OPENCLAW_RESPONSES_MODEL
  ) {
    raw.model = process.env.OPENCLAW_RESPONSES_MODEL
  }

  return raw
}

export async function POST(request: NextRequest) {
  let payload: Record<string, unknown> = {}
  try {
    const body = await request.json()
    payload = normalizeRequestPayload(body)
  } catch {
    payload = normalizeRequestPayload(null)
  }

  const baseUrl = resolveOpenClawHttpBaseUrl()
  const path = resolveResponsesPath()
  const timeoutMs = resolveTimeoutMs()
  const upstreamUrl = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs)

  const abortFromClient = () => controller.abort("client-abort")
  request.signal.addEventListener("abort", abortFromClient, { once: true })

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders(),
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    })

    if (!upstream.body) {
      const text = await upstream.text().catch(() => "")
      return Response.json(
        {
          error: {
            code: "OPENCLAW_RESPONSES_EMPTY",
            message: text || "OpenClaw responses stream body was empty",
          },
        },
        { status: upstream.status || 502 }
      )
    }

    const headers = new Headers()
    headers.set(
      "content-type",
      upstream.headers.get("content-type") ?? "text/event-stream; charset=utf-8"
    )
    headers.set("cache-control", "no-store")

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    })
  } catch (error) {
    const aborted = controller.signal.aborted
    const reason = controller.signal.reason
    const timeoutHit = aborted && reason === "timeout"
    return Response.json(
      {
        error: {
          code: timeoutHit ? "OPENCLAW_RESPONSES_TIMEOUT" : "OPENCLAW_RESPONSES_ERROR",
          message:
            timeoutHit
              ? `OpenClaw responses stream timed out after ${timeoutMs}ms`
              : error instanceof Error
                ? error.message
                : "Failed to connect to OpenClaw responses endpoint",
        },
      },
      { status: timeoutHit ? 504 : 502 }
    )
  } finally {
    clearTimeout(timeout)
    request.signal.removeEventListener("abort", abortFromClient)
  }
}
