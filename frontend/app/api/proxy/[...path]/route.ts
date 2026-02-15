import { NextRequest } from "next/server"

const DEFAULT_BACKEND_BASE_URL = "http://localhost:3001"

type ProxyContext = {
  params: { path: string[] } | Promise<{ path: string[] }>
}

function resolveBackendBaseUrl() {
  const raw = process.env.BACKEND_API_BASE_URL ?? DEFAULT_BACKEND_BASE_URL
  return raw.replace(/\/+$/, "")
}

function buildTargetUrl(path: string[], search: string) {
  return `${resolveBackendBaseUrl()}/${path.join("/")}${search}`
}

function buildForwardHeaders(request: NextRequest) {
  const headers = new Headers()
  const contentType = request.headers.get("content-type")
  const accept = request.headers.get("accept")
  const requestId = request.headers.get("x-request-id")
  const authorization = request.headers.get("authorization")

  if (contentType) headers.set("content-type", contentType)
  if (accept) headers.set("accept", accept)
  if (requestId) headers.set("x-request-id", requestId)
  if (authorization) headers.set("authorization", authorization)

  return headers
}

async function proxyRequest(request: NextRequest, context: ProxyContext) {
  const { path } = await Promise.resolve(context.params)
  const targetUrl = buildTargetUrl(path, request.nextUrl.search)
  const method = request.method.toUpperCase()

  let body: string | undefined
  if (method !== "GET" && method !== "HEAD") {
    const raw = await request.text()
    body = raw.length > 0 ? raw : undefined
  }

  try {
    const upstream = await fetch(targetUrl, {
      method,
      headers: buildForwardHeaders(request),
      body,
      cache: "no-store",
    })

    const responseHeaders = new Headers(upstream.headers)
    responseHeaders.set("cache-control", "no-store")

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to reach backend"
    return Response.json(
      {
        error: {
          code: "PROXY_UPSTREAM_ERROR",
          message,
          details: { target: targetUrl },
        },
      },
      { status: 502 }
    )
  }
}

export async function GET(request: NextRequest, context: ProxyContext) {
  return proxyRequest(request, context)
}

export async function POST(request: NextRequest, context: ProxyContext) {
  return proxyRequest(request, context)
}

export async function PUT(request: NextRequest, context: ProxyContext) {
  return proxyRequest(request, context)
}

export async function PATCH(request: NextRequest, context: ProxyContext) {
  return proxyRequest(request, context)
}

export async function DELETE(request: NextRequest, context: ProxyContext) {
  return proxyRequest(request, context)
}

export async function OPTIONS(request: NextRequest, context: ProxyContext) {
  return proxyRequest(request, context)
}
