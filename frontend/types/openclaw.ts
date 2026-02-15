// ─── Gateway Health (from RPC "health" method) ───
export interface GatewayHealthChannel {
  configured: boolean
  running: boolean
  lastStartAt: string | null
  lastStopAt: string | null
  lastError: string | null
  accountId: string
}

export interface GatewayHealth {
  ok: boolean
  ts: number
  durationMs: number
  channels: Record<string, GatewayHealthChannel>
  channelOrder: string[]
  channelLabels: Record<string, string>
  heartbeatSeconds: number
  defaultAgentId: string
  agents: GatewayAgent[]
}

// ─── Gateway Status (from RPC "status" method) ───
export interface GatewayAgent {
  agentId: string
  isDefault?: boolean
  heartbeat?: {
    enabled: boolean
    every: string
    everyMs: number
  }
  sessions?: {
    count: number
    recent: GatewaySession[]
  }
}

export interface GatewaySession {
  agentId: string
  key: string
  kind: string
  sessionId: string
  updatedAt: number
  age: number
  systemSent: boolean
  inputTokens: number
  outputTokens: number
  totalTokens: number
  remainingTokens: number
  percentUsed: number
  model: string
  contextTokens: number
}

export interface GatewayStatus {
  linkChannel: {
    id: string
    label: string
    linked: boolean
  }
  heartbeat: {
    defaultAgentId: string
    agents: {
      agentId: string
      enabled: boolean
      every: string
      everyMs: number
    }[]
  }
  channelSummary: string[]
  queuedSystemEvents: string[]
  sessions: {
    count: number
    recent: GatewaySession[]
  }
}

// ─── Agent RPC Response (from RPC "agent" method) ───
export interface AgentResponse {
  runId: string
  status: string
  summary: string
  result: {
    payloads: {
      text: string
      mediaUrl: string | null
    }[]
    meta: {
      durationMs: number
      agentMeta?: {
        sessionId: string
        provider: string
        model: string
        usage: {
          input: number
          output: number
          total: number
        }
      }
      aborted: boolean
    }
  }
}

// ─── Send Message Payload ───
export interface SendAgentMessagePayload {
  message: string
  agentId?: string
  idempotencyKey?: string
  expectFinal?: boolean
}
