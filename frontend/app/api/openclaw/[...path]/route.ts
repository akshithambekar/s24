import { NextRequest } from "next/server"
import WebSocket from "ws"
import { randomUUID } from "crypto"

const DEFAULT_GATEWAY_WS_URL = "ws://localhost:18789"
const CONNECT_TIMEOUT_MS = 10_000
const DEFAULT_RPC_TIMEOUT_MS = 60_000
const DEFAULT_AGENT_RPC_TIMEOUT_MS = 300_000
const OPENCLAW_CLIENT_ID = "cli"

function buildGatewayFallback(
  method: string,
  message: string
): Record<string, unknown> | null {
  if (method === "health") {
    return {
      ok: false,
      ts: Date.now(),
      durationMs: 0,
      channels: {},
      channelOrder: [],
      channelLabels: {},
      heartbeatSeconds: 0,
      defaultAgentId: "",
      agents: [],
      error: message,
    }
  }

  if (method === "status") {
    return {
      linkChannel: {
        id: "unknown",
        label: "Gateway",
        linked: false,
      },
      heartbeat: {
        defaultAgentId: "",
        agents: [],
      },
      channelSummary: [],
      queuedSystemEvents: [message],
      sessions: {
        count: 0,
        recent: [],
      },
      error: message,
    }
  }

  return null
}

function resolveGatewayWsUrl() {
  const raw =
    process.env.OPENCLAW_GATEWAY_BASE_URL ?? DEFAULT_GATEWAY_WS_URL
  // Normalize http:// -> ws://
  return raw
    .replace(/^http:\/\//, "ws://")
    .replace(/^https:\/\//, "wss://")
    .replace(/\/+$/, "")
}

function resolveRpcTimeoutMs(method: string) {
  const raw =
    method === "agent"
      ? process.env.OPENCLAW_AGENT_RPC_TIMEOUT_MS
        ?? process.env.OPENCLAW_RPC_TIMEOUT_MS
      : process.env.OPENCLAW_RPC_TIMEOUT_MS
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN

  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed
  }

  return method === "agent"
    ? DEFAULT_AGENT_RPC_TIMEOUT_MS
    : DEFAULT_RPC_TIMEOUT_MS
}

/**
 * Connect to the OpenClaw WebSocket gateway, perform challenge-response auth,
 * then call an RPC method and return its result.
 */
async function callGateway(
  method: string,
  params: Record<string, unknown> = {},
  expectFinal = false
): Promise<unknown> {
  const token = process.env.OPENCLAW_GATEWAY_TOKEN
  const url = `${resolveGatewayWsUrl()}${token ? `?token=${encodeURIComponent(token)}` : ""}`

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    let connected = false
    let rpcSent = false

    const cleanup = () => {
      try {
        ws.close()
      } catch {
        // ignore
      }
    }

    const connectTimer = setTimeout(() => {
      reject(new Error("Gateway connection timeout"))
      cleanup()
    }, CONNECT_TIMEOUT_MS)

    ws.on("error", (err) => {
      clearTimeout(connectTimer)
      reject(err)
      cleanup()
    })

    ws.on("close", (code, reason) => {
      clearTimeout(connectTimer)
      if (!connected) {
        reject(new Error(`Gateway closed before connect: ${code} ${reason.toString()}`))
      }
    })

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString())

        // Handle challenge: gateway sends connect.challenge event
        if (msg.type === "event" && msg.event === "connect.challenge") {
          const nonce = msg.payload?.nonce
          // Respond with connect request
          const connectReq = {
            type: "req",
            id: randomUUID(),
            method: "connect",
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: OPENCLAW_CLIENT_ID,
                displayName: "s24 Dashboard",
                version: "1.0.0",
                platform: "node",
                mode: "backend",
              },
              caps: [],
              auth: token ? { token } : undefined,
              role: "operator",
              scopes: ["operator.admin"],
            },
          }
          ws.send(JSON.stringify(connectReq))
          return
        }

        // Handle RPC response
        if (msg.type === "res" || msg.id) {
          clearTimeout(connectTimer)

          // This is the connect response
          if (!connected && !rpcSent) {
            if (msg.ok === false) {
              reject(new Error(msg.error?.message ?? "Connect rejected"))
              cleanup()
              return
            }
            connected = true

            // Now send the actual RPC call
            rpcSent = true
            const rpcId = randomUUID()
            const rpcReq = {
              type: "req",
              id: rpcId,
              method,
              params,
            }

            const rpcTimer = setTimeout(() => {
              reject(new Error(`RPC timeout for method: ${method}`))
              cleanup()
            }, resolveRpcTimeoutMs(method))

            // Replace message handler for RPC response
            ws.removeAllListeners("message")
            ws.on("message", (rpcData) => {
              try {
                const rpcMsg = JSON.parse(rpcData.toString())

                // Skip intermediate "accepted" responses when expecting final
                if (
                  expectFinal &&
                  rpcMsg.id === rpcId &&
                  rpcMsg.payload?.status === "accepted"
                ) {
                  return
                }

                if (rpcMsg.id === rpcId) {
                  clearTimeout(rpcTimer)
                  if (rpcMsg.ok === false) {
                    reject(
                      new Error(rpcMsg.error?.message ?? "RPC call failed")
                    )
                  } else {
                    resolve(rpcMsg.payload)
                  }
                  cleanup()
                }
              } catch {
                // ignore parse errors on non-response frames
              }
            })

            ws.send(JSON.stringify(rpcReq))
            return
          }
        }
      } catch {
        // ignore parse errors
      }
    })
  })
}

type ProxyContext = {
  params: { path: string[] } | Promise<{ path: string[] }>
}

/**
 * Maps URL paths to gateway RPC methods:
 *   /api/openclaw/health        -> method: "health"
 *   /api/openclaw/status        -> method: "status"
 *   /api/openclaw/agent         -> method: "agent" (POST with params in body)
 *   /api/openclaw/system-presence -> method: "system-presence"
 */
async function handleRequest(request: NextRequest, context: ProxyContext) {
  const { path } = await Promise.resolve(context.params)
  const method = path.join("/")

  let params: Record<string, unknown> = {}
  let expectFinal = false

  if (request.method === "POST") {
    try {
      const body = await request.json()
      expectFinal = body.expectFinal === true

      if (body.params && typeof body.params === "object") {
        params = body.params
      } else {
        const {
          expectFinal: _expectFinal,
          ...rest
        } = body as Record<string, unknown>
        params = rest
      }
    } catch {
      // empty body is fine for some methods
    }
  }

  try {
    const result = await callGateway(method, params, expectFinal)
    return Response.json(result, {
      headers: { "cache-control": "no-store" },
    })
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Failed to reach OpenClaw gateway"

    const fallback = buildGatewayFallback(method, message)
    if (fallback) {
      return Response.json(fallback, {
        headers: {
          "cache-control": "no-store",
          "x-openclaw-fallback": "gateway-unavailable",
        },
      })
    }

    return Response.json(
      {
        error: {
          code: "OPENCLAW_GATEWAY_ERROR",
          message,
        },
      },
      { status: 502 }
    )
  }
}

export async function GET(request: NextRequest, context: ProxyContext) {
  return handleRequest(request, context)
}

export async function POST(request: NextRequest, context: ProxyContext) {
  return handleRequest(request, context)
}
