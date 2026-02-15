const BASE_URL =
  process.env.NEXT_PUBLIC_OPENCLAW_BASE_URL ?? "/api/openclaw"

export class OpenClawError extends Error {
  code: string
  details?: Record<string, unknown>
  status: number

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message)
    this.name = "OpenClawError"
    this.status = status
    this.code = code
    this.details = details
  }
}

function requestId(): string {
  return crypto.randomUUID()
}

export async function openclawFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const url = `${BASE_URL}${path}`
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Request-Id": requestId(),
    ...(init?.headers as Record<string, string>),
  }

  const res = await fetch(url, { ...init, headers })

  if (!res.ok) {
    let body: { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null = null
    try {
      body = await res.json()
    } catch {
      // ignore parse failure
    }
    throw new OpenClawError(
      res.status,
      body?.error?.code ?? "UNKNOWN",
      body?.error?.message ?? res.statusText,
      body?.error?.details
    )
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}
