"use client"

import { useQuery, useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { OpenClawError } from "@/lib/openclaw/client"
import * as oc from "@/lib/openclaw/endpoints"
import type { SendAgentMessagePayload } from "@/types/openclaw"

// ─── Helpers ───
function onOcError(err: unknown) {
  if (err instanceof OpenClawError) {
    toast.error(`[${err.code}] ${err.message}`)
  } else {
    toast.error("An unexpected error occurred")
  }
}

// ─── Query Keys ───
export const ocQk = {
  gatewayHealth: ["oc-gateway-health"],
  gatewayStatus: ["oc-gateway-status"],
} as const

// ─── Gateway Health (15s poll) ───
export function useGatewayHealth() {
  return useQuery({
    queryKey: ocQk.gatewayHealth,
    queryFn: oc.fetchGatewayHealth,
    refetchInterval: 15_000,
    retry: 1,
  })
}

// ─── Gateway Status (10s poll) ───
export function useGatewayStatus() {
  return useQuery({
    queryKey: ocQk.gatewayStatus,
    queryFn: oc.fetchGatewayStatus,
    refetchInterval: 10_000,
    retry: 1,
  })
}

// ─── Send Agent Message Mutation ───
export function useSendAgentMessage() {
  return useMutation({
    mutationFn: (payload: SendAgentMessagePayload) =>
      oc.sendAgentMessage(payload),
    onError: onOcError,
  })
}
