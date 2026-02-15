import { openclawFetch } from "./client"
import type {
  GatewayHealth,
  GatewayStatus,
  AgentResponse,
  SendAgentMessagePayload,
} from "@/types/openclaw"

// ─── Health (RPC: health) ───
export const fetchGatewayHealth = () =>
  openclawFetch<GatewayHealth>("/health")

// ─── Status (RPC: status) ───
export const fetchGatewayStatus = () =>
  openclawFetch<GatewayStatus>("/status")

// ─── Send Agent Message (RPC: agent) ───
export const sendAgentMessage = (payload: SendAgentMessagePayload) =>
  openclawFetch<AgentResponse>("/agent", {
    method: "POST",
    body: JSON.stringify({
      message: payload.message,
      agentId: payload.agentId ?? "main",
      idempotencyKey:
        payload.idempotencyKey ?? `s24-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      expectFinal: payload.expectFinal ?? true,
    }),
  })
