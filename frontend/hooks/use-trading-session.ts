"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

export type TradingSessionStatus = "idle" | "starting" | "started" | "error"

type PersistedTradingSession = {
  isActive: boolean
  startedAt: string | null
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
    const isActive = parsed.isActive === true && Boolean(startedAt)
    return { isActive, startedAt: isActive ? startedAt : null }
  } catch {
    return EMPTY_PERSISTED
  }
}

function stateFromPersisted(session: PersistedTradingSession): TradingSessionState {
  if (session.isActive && session.startedAt) {
    return {
      isActive: true,
      startedAt: session.startedAt,
      status: "started",
      errorMessage: null,
    }
  }

  return {
    isActive: false,
    startedAt: null,
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

  window.dispatchEvent(new Event(EVENT_NAME))
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
      status: "starting",
      errorMessage: null,
    })
  }, [])

  const setIdle = useCallback(() => {
    setState({
      isActive: false,
      startedAt: null,
      status: "idle",
      errorMessage: null,
    })
  }, [])

  const setError = useCallback((message?: string) => {
    setState({
      isActive: false,
      startedAt: null,
      status: "error",
      errorMessage: message ?? "Failed to start trading session",
    })
  }, [])

  const startSession = useCallback((startedAtIso: string) => {
    const persisted: PersistedTradingSession = {
      isActive: true,
      startedAt: startedAtIso,
    }
    writePersistedSession(persisted)
    setState({
      isActive: true,
      startedAt: startedAtIso,
      status: "started",
      errorMessage: null,
    })
  }, [])

  const endSession = useCallback(() => {
    writePersistedSession(EMPTY_PERSISTED)
    setState({
      isActive: false,
      startedAt: null,
      status: "idle",
      errorMessage: null,
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
    }),
    [state, setStarting, setIdle, setError, startSession, endSession]
  )
}
