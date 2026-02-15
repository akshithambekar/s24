"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useKillSwitch } from "@/hooks/use-api"
import { useTradingSession } from "@/hooks/use-trading-session"
import { useOpenClawResponsesStream } from "@/hooks/use-openclaw-responses-stream"
import { Panel } from "../panel"
import { Play, AlertTriangle, Loader2, CheckCircle2, MessageSquareDashed } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

const NEW_SESSION_PROMPT = "/new"
const START_PAPER_TRADING_PROMPT = "start paper trading on solana devnet"
const STREAM_WAIT_TIMEOUT_MS = 90_000
const STREAM_ASSISTANT_SETTLE_MS = 1_000

type StreamHandshakeStatus = {
  hasAssistantReply: boolean
  completed: boolean
  error?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content

  const record = asRecord(content)
  if (record) {
    if (typeof record.text === "string") return record.text
    if (typeof record.delta === "string") return record.delta
    if ("content" in record) {
      return extractTextFromContent(record.content)
    }
  }

  if (!Array.isArray(content)) return ""

  const parts: string[] = []
  for (const block of content) {
    const text = extractTextFromContent(block)
    if (text) parts.push(text)
  }
  return parts.join("\n\n")
}

function extractLatestAssistantText(raw: unknown): string | null {
  const record = asRecord(raw)
  if (!record) return null

  if (typeof record.text === "string" && record.text.trim().length) {
    return record.text.trim()
  }
  if (typeof record.delta === "string" && record.delta.trim().length) {
    return record.delta.trim()
  }

  const candidates: unknown[] = []
  const keys = ["messages", "history", "items", "entries", "turns", "events"]
  for (const key of keys) {
    if (Array.isArray(record[key])) {
      candidates.push(...record[key] as unknown[])
    }
  }

  const response = asRecord(record.response)
  if (response && Array.isArray(response.output)) {
    candidates.push(...response.output)
  }

  if (!candidates.length) return null

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const item = asRecord(candidates[i])
    if (!item) continue

    const role =
      typeof item.role === "string"
        ? item.role
        : typeof item.author === "string"
          ? item.author
          : ""

    const normalizedRole = role.toLowerCase()
    if (!["assistant", "agent", "bot"].includes(normalizedRole)) continue

    const text = extractTextFromContent(
      "content" in item ? item.content : item
    ).trim()
    if (text) return text
  }

  return null
}

export function TradeCyclePanel() {
  const qc = useQueryClient()
  const killSwitch = useKillSwitch()
  const tradingSession = useTradingSession()
  const {
    state: responsesState,
    events: responsesEvents,
    error: responsesError,
    start: startResponsesStream,
    cancel: cancelResponsesStream,
    clearEvents: clearResponsesEvents,
  } = useOpenClawResponsesStream()
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const assistantMessageByStreamRef = useRef<Map<string, string>>(new Map())
  const assistantTextByStreamRef = useRef<Map<string, string>>(new Map())
  const streamStatusRef = useRef<Map<string, StreamHandshakeStatus>>(new Map())
  const streamWaitersRef = useRef<Map<string, Set<(status: StreamHandshakeStatus) => void>>>(new Map())
  const processedEventsRef = useRef(0)
  const responsesStateRef = useRef(responsesState)

  const isKillSwitchActive = killSwitch.data?.enabled === true
  const isStarting = tradingSession.status === "starting"
  const isStarted = tradingSession.status === "started"
  const isDisabled = isKillSwitchActive || isStarting || isStarted

  const notifyStreamWaiters = useCallback((streamId: string, status: StreamHandshakeStatus) => {
    const waiters = streamWaitersRef.current.get(streamId)
    if (!waiters?.size) return
    for (const waiter of Array.from(waiters)) {
      waiter(status)
    }
  }, [])

  const setStreamStatus = useCallback((
    streamId: string,
    update: Partial<StreamHandshakeStatus>
  ) => {
    const prev = streamStatusRef.current.get(streamId) ?? {
      hasAssistantReply: false,
      completed: false,
    }
    const next: StreamHandshakeStatus = { ...prev, ...update }
    streamStatusRef.current.set(streamId, next)
    notifyStreamWaiters(streamId, next)
  }, [notifyStreamWaiters])

  const waitForAssistantTurn = useCallback((streamId: string, prompt: string) => (
    new Promise<void>((resolve, reject) => {
      let settleTimerId: number | null = null

      function cleanup() {
        window.clearTimeout(timeoutId)
        if (settleTimerId !== null) {
          window.clearTimeout(settleTimerId)
        }
        const waiters = streamWaitersRef.current.get(streamId)
        if (!waiters) return
        waiters.delete(onStatus)
        if (!waiters.size) {
          streamWaitersRef.current.delete(streamId)
        }
      }

      const timeoutId = window.setTimeout(() => {
        cleanup()
        reject(new Error(`Timed out waiting for OpenClaw reply after "${prompt}"`))
      }, STREAM_WAIT_TIMEOUT_MS)

      const onStatus = (status: StreamHandshakeStatus) => {
        if (status.error) {
          cleanup()
          reject(new Error(status.error))
          return
        }

        if (status.hasAssistantReply) {
          if (status.completed) {
            cleanup()
            resolve()
            return
          }

          if (settleTimerId !== null) {
            window.clearTimeout(settleTimerId)
          }
          settleTimerId = window.setTimeout(() => {
            cleanup()
            resolve()
          }, STREAM_ASSISTANT_SETTLE_MS)
          return
        }

        if (status.completed) {
          cleanup()
          reject(new Error(`OpenClaw did not send an assistant reply after "${prompt}"`))
        }
      }

      const waiters = streamWaitersRef.current.get(streamId) ?? new Set()
      waiters.add(onStatus)
      streamWaitersRef.current.set(streamId, waiters)

      if (responsesStateRef.current === "aborted") {
        cleanup()
        reject(new Error("Trading handshake was cancelled"))
        return
      }

      const current = streamStatusRef.current.get(streamId)
      if (current) {
        onStatus(current)
      }
    })
  ), [])

  useEffect(() => {
    responsesStateRef.current = responsesState

    if (responsesState !== "aborted") return

    const cancellation: StreamHandshakeStatus = {
      hasAssistantReply: false,
      completed: true,
      error: "Trading handshake was cancelled",
    }

    for (const [streamId] of Array.from(streamWaitersRef.current.entries())) {
      notifyStreamWaiters(streamId, cancellation)
      streamStatusRef.current.set(streamId, cancellation)
    }
    streamWaitersRef.current.clear()
  }, [notifyStreamWaiters, responsesState])

  useEffect(() => {
    if (processedEventsRef.current > responsesEvents.length) {
      processedEventsRef.current = responsesEvents.length
    }

    const nextEvents = responsesEvents.slice(processedEventsRef.current)
    if (!nextEvents.length) return

    processedEventsRef.current = responsesEvents.length

    for (const event of nextEvents) {
      const existingMessageId = assistantMessageByStreamRef.current.get(event.streamId)
      const messageId = existingMessageId ?? `assistant-${event.streamId}`

      if (!existingMessageId) {
        assistantMessageByStreamRef.current.set(event.streamId, messageId)
      }

      if (event.phase === "started") {
        if (!assistantTextByStreamRef.current.has(event.streamId)) {
          assistantTextByStreamRef.current.set(event.streamId, "")
        }
        if (!existingMessageId) {
          tradingSession.appendPreviewMessage({
            id: messageId,
            role: "assistant",
            text: "",
            phase: "streaming",
          })
        }
        continue
      }

      if (event.phase === "delta") {
        const deltaText = event.text ?? ""
        if (deltaText.trim().length > 0) {
          const previousText = assistantTextByStreamRef.current.get(event.streamId) ?? ""
          assistantTextByStreamRef.current.set(event.streamId, `${previousText}${deltaText}`)
          setStreamStatus(event.streamId, { hasAssistantReply: true })
        }
        if (!existingMessageId) {
          tradingSession.appendPreviewMessage({
            id: messageId,
            role: "assistant",
            text: "",
            phase: "streaming",
          })
        }
        tradingSession.appendPreviewMessageText(messageId, deltaText, "streaming")
        continue
      }

      if (event.phase === "completed") {
        const currentText = assistantTextByStreamRef.current.get(event.streamId) ?? ""
        const completionText = extractLatestAssistantText(event.raw)
        if (completionText && completionText !== currentText) {
          const delta = completionText.startsWith(currentText)
            ? completionText.slice(currentText.length)
            : completionText
          if (delta.length) {
            tradingSession.appendPreviewMessageText(messageId, delta, "completed")
          }
          assistantTextByStreamRef.current.set(event.streamId, completionText)
        }
        const hasAssistantReply =
          (assistantTextByStreamRef.current.get(event.streamId) ?? "").trim().length > 0
        setStreamStatus(event.streamId, { completed: true, hasAssistantReply })
        tradingSession.setPreviewMessagePhase(messageId, "completed")
        continue
      }

      if (event.phase === "error") {
        setStreamStatus(event.streamId, {
          completed: true,
          error: event.error ?? "OpenClaw stream failed.",
        })
        if (!existingMessageId) {
          tradingSession.appendPreviewMessage({
            id: messageId,
            role: "assistant",
            text: event.error ?? "OpenClaw stream failed.",
            phase: "error",
          })
        } else if (event.error) {
          tradingSession.appendPreviewMessageText(
            messageId,
            `\n${event.error}`,
            "error"
          )
        }
        tradingSession.setPreviewMessagePhase(messageId, "error")
      }
    }
  }, [responsesEvents, setStreamStatus, tradingSession])

  useEffect(() => {
    if (!isKillSwitchActive) return
    cancelResponsesStream()
  }, [isKillSwitchActive, cancelResponsesStream])

  async function handleLaunch() {
    if (isDisabled) return

    setErrorMsg(null)
    clearResponsesEvents()
    processedEventsRef.current = 0
    assistantMessageByStreamRef.current.clear()
    assistantTextByStreamRef.current.clear()
    streamStatusRef.current.clear()
    streamWaitersRef.current.clear()
    tradingSession.clearPreviewMessages()
    tradingSession.setStarting()

    try {
      tradingSession.appendPreviewMessage({
        role: "system",
        text: "Starting OpenClaw trading handshake...",
        phase: "completed",
      })

      tradingSession.appendPreviewMessage({
        role: "user",
        text: NEW_SESSION_PROMPT,
        phase: "completed",
      })
      const newSessionStream = await startResponsesStream(NEW_SESSION_PROMPT)
      await waitForAssistantTurn(newSessionStream.streamId, NEW_SESSION_PROMPT)

      tradingSession.appendPreviewMessage({
        role: "user",
        text: START_PAPER_TRADING_PROMPT,
        phase: "completed",
      })
      const paperTradingStream = await startResponsesStream(START_PAPER_TRADING_PROMPT)
      await waitForAssistantTurn(paperTradingStream.streamId, START_PAPER_TRADING_PROMPT)

      tradingSession.startSession(new Date().toISOString())
      qc.invalidateQueries({ queryKey: ["orders"] })
      qc.invalidateQueries({ queryKey: ["fills"] })
      toast.success("Trading session started")
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to start trading session"
      tradingSession.setError(msg)
      setErrorMsg(msg)
    }
  }

  const buttonLabel = isStarting
    ? "Starting trading session..."
    : isStarted
      ? "Trading Session Started"
      : "Start Trading Session"

  return (
    <Panel
      title="Trade Cycle Control"
      icon={<Play className="h-3.5 w-3.5" />}
    >
      {isKillSwitchActive && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span className="font-semibold">
            Kill switch is ACTIVE. Trade triggers are disabled.
          </span>
        </div>
      )}

      <div className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">
          Starts OpenClaw via <code>{NEW_SESSION_PROMPT}</code>, then sends{" "}
          <code>{START_PAPER_TRADING_PROMPT}</code> after the assistant responds.
          This panel shows a live
          preview transcript only for the current session.
        </p>

        <Button
          onClick={handleLaunch}
          disabled={isDisabled}
          className="h-8 w-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold"
        >
          {isStarting ? (
            <>
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              {buttonLabel}
            </>
          ) : (
            buttonLabel
          )}
        </Button>

        <div className="rounded-md border border-border bg-secondary/20 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <MessageSquareDashed className="h-3.5 w-3.5" />
              <span>OpenClaw Preview</span>
            </div>
            {(responsesState === "starting" || responsesState === "streaming") && (
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Streaming</span>
              </div>
            )}
          </div>
          <ScrollArea className="h-44 pr-2">
            <div className="flex flex-col gap-2">
              {!tradingSession.previewMessages.length ? (
                <p className="py-8 text-center text-xs text-muted-foreground">
                  Start a trading session to preview OpenClaw responses.
                </p>
              ) : (
                tradingSession.previewMessages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "rounded-md px-3 py-2 text-xs",
                      message.role === "user"
                        ? "ml-6 bg-primary/10 text-foreground"
                        : message.role === "assistant"
                          ? "mr-6 border border-border bg-background/80 text-foreground"
                          : "border border-border/70 bg-secondary/60 text-muted-foreground"
                    )}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase">
                        {message.role}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(message.ts).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap">
                      {message.text || (
                        message.phase === "streaming"
                          ? "..."
                          : ""
                      )}
                    </p>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Success */}
        {isStarted && (
          <div className="flex items-center gap-2 rounded-md border border-success/50 bg-success/10 px-3 py-2 text-xs text-success">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
            <span className="font-semibold">
              Trading session started. Start is locked until kill switch turns on.
            </span>
          </div>
        )}

        {/* Error */}
        {tradingSession.status === "error" && (errorMsg || tradingSession.errorMessage || responsesError) && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>{errorMsg ?? tradingSession.errorMessage ?? responsesError}</span>
          </div>
        )}
      </div>
    </Panel>
  )
}
