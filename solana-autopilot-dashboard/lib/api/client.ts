import type { ApiErrorBody } from "@/types/api"

const BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api/proxy"

export class ApiError extends Error {
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
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.details = details
  }
}

function requestId(): string {
  return crypto.randomUUID()
}

export async function apiFetch<T>(
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
    let body: ApiErrorBody | null = null
    try {
      body = (await res.json()) as ApiErrorBody
    } catch {
      // ignore parse failure
    }
    throw new ApiError(
      res.status,
      body?.error?.code ?? "UNKNOWN",
      body?.error?.message ?? res.statusText,
      body?.error?.details
    )
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}
