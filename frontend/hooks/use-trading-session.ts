"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type {
  TradePreviewMessage,
  TradePreviewMessagePhase,
} from "@/types/openclaw"

export type TradingSessionStatus = "idle" | "starting" | "started" | "error"

type PersistedTradingSession = {
  isActive: boolean
  startedAt: string | null
  previewMessages: TradePreviewMessage[]
}

type TradingSessionState = PersistedTradingSession & {
  status: TradingSessionStatus
  errorMessage: string | null
}

const STORAGE_KEY = "s24.trading-session.v1"
const EVENT_NAME = "s24:trading-session:update"

const EMPTY_PERSISTED: PersistedTradingSession = {
  isActive: false,
  startedAt: null,
  previewMessages: [],
}

type AppendTradePreviewMessageInput = {
  id?: string
  role: TradePreviewMessage["role"]
  text: string
  ts?: string
  phase?: TradePreviewMessagePhase
}

function isTradePreviewMessage(value: unknown): value is TradePreviewMessage {
  if (!value || typeof value !== "object") return false
  const v = value as Partial<TradePreviewMessage>
  return (
    typeof v.id === "string"
    && (v.role === "user" || v.role === "assistant" || v.role === "system")
    && typeof v.text === "string"
    && typeof v.ts === "string"
    && (
      v.phase === "pending"
      || v.phase === "streaming"
      || v.phase === "completed"
      || v.phase === "error"
    )
  )
}

function readPersistedSession(): PersistedTradingSession {
  if (typeof window === "undefined") return EMPTY_PERSISTED

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY_PERSISTED

    const parsed = JSON.parse(raw) as Partial<PersistedTradingSession>
    const startedAt =
      typeof parsed.startedAt === "string" && !Number.isNaN(Date.parse(parsed.startedAt))
        ? parsed.startedAt
        : null
    const previewMessages = Array.isArray(parsed.previewMessages)
      ? parsed.previewMessages.filter(isTradePreviewMessage)
      : []
    const isActive = parsed.isActive === true && Boolean(startedAt)
    return {
      isActive,
      startedAt: isActive ? startedAt : null,
      previewMessages: isActive ? previewMessages : [],
    }
  } catch {
    return EMPTY_PERSISTED
  }
}

function stateFromPersisted(session: PersistedTradingSession): TradingSessionState {
  if (session.isActive && session.startedAt) {
    return {
      isActive: true,
      startedAt: session.startedAt,
      previewMessages: session.previewMessages,
      status: "started",
      errorMessage: null,
    }
  }

  return {
    isActive: false,
    startedAt: null,
    previewMessages: [],
    status: "idle",
    errorMessage: null,
  }
}

function writePersistedSession(session: PersistedTradingSession) {
  if (typeof window === "undefined") return

  if (session.isActive && session.startedAt) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } else {
    window.localStorage.removeItem(STORAGE_KEY)
  }

  const dispatchSync = () => window.dispatchEvent(new Event(EVENT_NAME))
  if (typeof queueMicrotask === "function") {
    queueMicrotask(dispatchSync)
  } else {
    window.setTimeout(dispatchSync, 0)
  }
}

export function useTradingSession() {
  const [state, setState] = useState<TradingSessionState>(() =>
    stateFromPersisted(readPersistedSession())
  )

  const syncFromStorage = useCallback(() => {
    const persisted = readPersistedSession()
    const next = stateFromPersisted(persisted)
    setState((prev) => {
      const shouldKeepTransientError =
        prev.status === "error" && next.status === "idle"
      if (shouldKeepTransientError) return prev

      const unchanged =
        prev.isActive === next.isActive
        && prev.startedAt === next.startedAt
        && prev.previewMessages.length === next.previewMessages.length
        && prev.previewMessages.every((message, index) => {
          const nextMessage = next.previewMessages[index]
          return (
            message.id === nextMessage?.id
            && message.text === nextMessage?.text
            && message.role === nextMessage?.role
            && message.ts === nextMessage?.ts
            && message.phase === nextMessage?.phase
          )
        })
        && prev.status === next.status
        && prev.errorMessage === next.errorMessage
      return unchanged ? prev : next
    })
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return

    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) syncFromStorage()
    }
    const onLocalSync = () => syncFromStorage()

    window.addEventListener("storage", onStorage)
    window.addEventListener(EVENT_NAME, onLocalSync)

    return () => {
      window.removeEventListener("storage", onStorage)
      window.removeEventListener(EVENT_NAME, onLocalSync)
    }
  }, [syncFromStorage])

  const setStarting = useCallback(() => {
    setState({
      isActive: false,
      startedAt: null,
      previewMessages: [],
      status: "starting",
      errorMessage: null,
    })
  }, [])

  const setIdle = useCallback(() => {
    setState({
      isActive: false,
      startedAt: null,
      previewMessages: [],
      status: "idle",
      errorMessage: null,
    })
  }, [])

  const setError = useCallback((message?: string) => {
    setState((prev) => ({
      isActive: false,
      startedAt: null,
      previewMessages: prev.previewMessages,
      status: "error",
      errorMessage: message ?? "Failed to start trading session",
    }))
  }, [])

  const startSession = useCallback((startedAtIso: string) => {
    setState((prev) => {
      const persisted: PersistedTradingSession = {
        isActive: true,
        startedAt: startedAtIso,
        previewMessages: prev.previewMessages,
      }
      writePersistedSession(persisted)
      return {
        isActive: true,
        startedAt: startedAtIso,
        previewMessages: prev.previewMessages,
        status: "started",
        errorMessage: null,
      }
    })
  }, [])

  const endSession = useCallback(() => {
    writePersistedSession(EMPTY_PERSISTED)
    setState({
      isActive: false,
      startedAt: null,
      previewMessages: [],
      status: "idle",
      errorMessage: null,
    })
  }, [])

  const clearPreviewMessages = useCallback(() => {
    setState((prev) => {
      if (!prev.previewMessages.length) return prev

      if (prev.isActive && prev.startedAt) {
        writePersistedSession({
          isActive: true,
          startedAt: prev.startedAt,
          previewMessages: [],
        })
      }

      return {
        ...prev,
        previewMessages: [],
      }
    })
  }, [])

  const appendPreviewMessage = useCallback((message: AppendTradePreviewMessageInput) => {
    setState((prev) => {
      const nextMessage: TradePreviewMessage = {
        id: message.id ?? crypto.randomUUID(),
        role: message.role,
        text: message.text,
        ts: message.ts ?? new Date().toISOString(),
        phase: message.phase ?? "completed",
      }
      const nextPreviewMessages = [...prev.previewMessages, nextMessage]

      if (prev.isActive && prev.startedAt) {
        writePersistedSession({
          isActive: true,
          startedAt: prev.startedAt,
          previewMessages: nextPreviewMessages,
        })
      }

      return {
        ...prev,
        previewMessages: nextPreviewMessages,
      }
    })
  }, [])

  const appendPreviewMessageText = useCallback((
    id: string,
    textChunk: string,
    phase: TradePreviewMessagePhase = "streaming"
  ) => {
    if (!textChunk) return

    setState((prev) => {
      const nextPreviewMessages = prev.previewMessages.map((message) =>
        message.id === id
          ? {
            ...message,
            text: `${message.text}${textChunk}`,
            phase,
          }
          : message
      )

      if (prev.isActive && prev.startedAt) {
        writePersistedSession({
          isActive: true,
          startedAt: prev.startedAt,
          previewMessages: nextPreviewMessages,
        })
      }

      return {
        ...prev,
        previewMessages: nextPreviewMessages,
      }
    })
  }, [])

  const setPreviewMessagePhase = useCallback((id: string, phase: TradePreviewMessagePhase) => {
    setState((prev) => {
      const nextPreviewMessages = prev.previewMessages.map((message) =>
        message.id === id
          ? { ...message, phase }
          : message
      )

      if (prev.isActive && prev.startedAt) {
        writePersistedSession({
          isActive: true,
          startedAt: prev.startedAt,
          previewMessages: nextPreviewMessages,
        })
      }

      return {
        ...prev,
        previewMessages: nextPreviewMessages,
      }
    })
  }, [])

  return useMemo(
    () => ({
      ...state,
      setStarting,
      setIdle,
      setError,
      startSession,
      endSession,
      clearPreviewMessages,
      appendPreviewMessage,
      appendPreviewMessageText,
      setPreviewMessagePhase,
    }),
    [
      state,
      setStarting,
      setIdle,
      setError,
      startSession,
      endSession,
      clearPreviewMessages,
      appendPreviewMessage,
      appendPreviewMessageText,
      setPreviewMessagePhase,
    ]
  )
}
