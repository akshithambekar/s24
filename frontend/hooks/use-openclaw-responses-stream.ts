"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import type {
  ResponsesStreamEvent,
  ResponsesStreamState,
} from "@/types/openclaw"

const MAX_STREAM_EVENTS = 1_000
const FALLBACK_CHAT_SESSION_KEY = "agent:main:main"
const FALLBACK_POLL_INTERVAL_MS = 1_500
const FALLBACK_MAX_POLL_MS = 90_000

type ParsedSseFrame = {
  event?: string
  data?: string
}

function splitSseFrames(buffer: string) {
  const normalized = buffer.replace(/\r\n/g, "\n")
  const parts = normalized.split("\n\n")
  return {
    frames: parts.slice(0, -1),
    rest: parts.at(-1) ?? "",
  }
}

function parseSseFrame(frame: string): ParsedSseFrame {
  const lines = frame.split("\n")
  let event: string | undefined
  const dataLines: string[] = []

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim()
      continue
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart())
    }
  }

  return {
    event,
    data: dataLines.length ? dataLines.join("\n") : undefined,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null
}

function extractType(raw: unknown, event?: string) {
  const record = asRecord(raw)
  const fromPayload = typeof record?.type === "string" ? record.type : ""
  return event || fromPayload
}

function isErrorEvent(eventType: string, raw: unknown) {
  const lower = eventType.toLowerCase()
  if (lower.includes("error")) return true
  const record = asRecord(raw)
  return Boolean(record?.error)
}

function isCompletedEvent(eventType: string, raw: unknown) {
  const lower = eventType.toLowerCase()
  if (lower.includes("completed") || lower.includes("done")) return true
  const record = asRecord(raw)
  if (record && typeof record.status === "string") {
    const status = record.status.toLowerCase()
    if (status === "completed" || status === "done") return true
  }
  return false
}

function extractErrorMessage(raw: unknown) {
  const record = asRecord(raw)
  const nested = asRecord(record?.error)
  if (typeof nested?.message === "string") return nested.message
  if (typeof record?.message === "string") return record.message
  return "OpenClaw responses stream error"
}

function extractDeltaText(raw: unknown): string | null {
  const record = asRecord(raw)
  if (!record) return null

  if (typeof record.delta === "string" && record.delta.length) {
    return record.delta
  }

  if (typeof record.text === "string" && record.text.length) {
    return record.text
  }

  const outputText = asRecord(record.output_text)
  if (typeof outputText?.delta === "string" && outputText.delta.length) {
    return outputText.delta
  }

  const response = asRecord(record.response)
  const responseOutput = Array.isArray(response?.output)
    ? response.output
    : []

  for (const item of responseOutput) {
    const outputItem = asRecord(item)
    const content = Array.isArray(outputItem?.content)
      ? outputItem.content
      : []
    for (const block of content) {
      const contentBlock = asRecord(block)
      if (typeof contentBlock?.text === "string" && contentBlock.text.length) {
        return contentBlock.text
      }
      if (typeof contentBlock?.delta === "string" && contentBlock.delta.length) {
        return contentBlock.delta
      }
    }
  }

  return null
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content

  const record = asRecord(content)
  if (record) {
    if (typeof record.text === "string" && record.text.length) {
      return record.text
    }
    if (typeof record.delta === "string" && record.delta.length) {
      return record.delta
    }
    if ("content" in record) {
      return extractTextFromContent(record.content)
    }
  }

  if (!Array.isArray(content)) return ""

  const parts: string[] = []
  for (const block of content) {
    const item =
      block && typeof block === "object"
        ? (block as Record<string, unknown>)
        : null
    if (!item) continue

    if (typeof item.text === "string" && item.text.length) {
      parts.push(item.text)
      continue
    }
    if (typeof item.delta === "string" && item.delta.length) {
      parts.push(item.delta)
      continue
    }

    if (Array.isArray(item.content)) {
      const nested = extractTextFromContent(item.content)
      if (nested) parts.push(nested)
    }
  }

  return parts.join("\n\n")
}

function extractLatestAssistantText(payload: unknown): string | null {
  const record = asRecord(payload)
  if (!record) return null

  if (typeof record.text === "string" && record.text.trim().length) {
    return record.text.trim()
  }
  if (typeof record.delta === "string" && record.delta.trim().length) {
    return record.delta.trim()
  }

  const candidates: unknown[] = []
  const messageKeys = ["messages", "history", "items", "entries", "turns", "events"]
  for (const key of messageKeys) {
    if (Array.isArray(record[key])) {
      candidates.push(...record[key] as unknown[])
    }
  }

  const response = asRecord(record.response)
  if (response && Array.isArray(response.output)) {
    candidates.push(...response.output)
  }

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const message = asRecord(candidates[i])
    if (!message) continue

    const role =
      typeof message.role === "string"
        ? message.role
        : typeof message.author === "string"
          ? message.author
          : ""

    if (!["assistant", "agent", "bot"].includes(role.toLowerCase())) continue

    const text = extractTextFromContent(
      "content" in message ? message.content : message
    ).trim()
    if (text) return text
  }

  return null
}

async function readErrorMessage(
  response: Response,
  fallbackMessage: string
) {
  try {
    const json = await response.json()
    if (typeof json?.error?.message === "string") {
      return json.error.message
    }
  } catch {
    // ignore invalid json
  }

  try {
    const text = await response.text()
    if (text.trim().length) return text.trim()
  } catch {
    // ignore unreadable body
  }

  return fallbackMessage
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"))
      return
    }
    const timeout = setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout)
        reject(new Error("aborted"))
      },
      { once: true }
    )
  })
}

export function useOpenClawResponsesStream() {
  const [state, setState] = useState<ResponsesStreamState>("idle")
  const [events, setEvents] = useState<ResponsesStreamEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const controllersRef = useRef<Map<string, AbortController>>(new Map())
  const activeStreamsRef = useRef(0)
  const cancelRequestedRef = useRef(false)

  const pushEvent = useCallback((event: ResponsesStreamEvent) => {
    setEvents((prev) => {
      const next = [...prev, event]
      return next.length > MAX_STREAM_EVENTS
        ? next.slice(next.length - MAX_STREAM_EVENTS)
        : next
    })
  }, [])

  const clearEvents = useCallback(() => {
    setEvents([])
  }, [])

  const cancel = useCallback(() => {
    cancelRequestedRef.current = true
    for (const controller of controllersRef.current.values()) {
      controller.abort("user-abort")
    }
    setState("aborted")
  }, [])

  const start = useCallback(async (prompt: string) => {
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) {
      throw new Error("Prompt cannot be empty")
    }

    const streamId = crypto.randomUUID()
    const controller = new AbortController()
    controllersRef.current.set(streamId, controller)
    activeStreamsRef.current += 1
    cancelRequestedRef.current = false
    setError(null)
    setState("starting")

    let resolveStarted!: (value: { streamId: string }) => void
    let rejectStarted!: (reason?: unknown) => void
    let started = false
    let completed = false

    const startedPromise = new Promise<{ streamId: string }>((resolve, reject) => {
      resolveStarted = resolve
      rejectStarted = reject
    })

    void (async () => {
      const markStarted = () => {
        if (started) return
        started = true
        setState("streaming")
        pushEvent({
          id: crypto.randomUUID(),
          streamId,
          phase: "started",
          ts: Date.now(),
        })
        resolveStarted({ streamId })
      }

      try {
        const response = await fetch("/api/openclaw/responses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: trimmedPrompt,
            stream: true,
          }),
          signal: controller.signal,
        })

        if (response.status === 405) {
          let baselineAssistantText = ""
          try {
            const baselineHistoryResponse = await fetch("/api/openclaw/chat.history", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionKey: FALLBACK_CHAT_SESSION_KEY,
                limit: 60,
              }),
              signal: controller.signal,
            })

            if (baselineHistoryResponse.ok) {
              const baselineHistory = await baselineHistoryResponse.json().catch(() => null)
              baselineAssistantText = extractLatestAssistantText(baselineHistory) ?? ""
            }
          } catch {
            // Ignore baseline fetch failures and continue with fallback send.
          }

          const idempotencyKey = `s24-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          const sendResponse = await fetch("/api/openclaw/chat.send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionKey: FALLBACK_CHAT_SESSION_KEY,
              message: trimmedPrompt,
              idempotencyKey,
              deliver: false,
            }),
            signal: controller.signal,
          })

          if (!sendResponse.ok) {
            const sendMessage = await readErrorMessage(
              sendResponse,
              `Fallback chat.send failed (${sendResponse.status})`
            )
            throw new Error(sendMessage)
          }

          markStarted()
          let lastAssistantText = baselineAssistantText
          let hasNewAssistantReply = false
          let unchangedPolls = 0
          const pollStartedAt = Date.now()

          while (!controller.signal.aborted) {
            const historyResponse = await fetch("/api/openclaw/chat.history", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionKey: FALLBACK_CHAT_SESSION_KEY,
                limit: 60,
              }),
              signal: controller.signal,
            })

            if (historyResponse.ok) {
              const history = await historyResponse.json().catch(() => null)
              const assistantText = extractLatestAssistantText(history)

              if (assistantText && assistantText !== lastAssistantText) {
                const delta = assistantText.startsWith(lastAssistantText)
                  ? assistantText.slice(lastAssistantText.length)
                  : assistantText
                if (delta.length) {
                  pushEvent({
                    id: crypto.randomUUID(),
                    streamId,
                    phase: "delta",
                    ts: Date.now(),
                    text: delta,
                    raw: history,
                  })
                  hasNewAssistantReply = true
                }
                lastAssistantText = assistantText
                unchangedPolls = 0
              } else {
                unchangedPolls += 1
              }

              const timedOut =
                Date.now() - pollStartedAt >= FALLBACK_MAX_POLL_MS
              const shouldComplete =
                timedOut || (hasNewAssistantReply && unchangedPolls >= 2)

              if (shouldComplete) {
                completed = true
                pushEvent({
                  id: crypto.randomUUID(),
                  streamId,
                  phase: "completed",
                  ts: Date.now(),
                  raw: history,
                })
                break
              }
            }

            await sleep(FALLBACK_POLL_INTERVAL_MS, controller.signal)
          }

          if (!completed && !controller.signal.aborted) {
            completed = true
            pushEvent({
              id: crypto.randomUUID(),
              streamId,
              phase: "completed",
              ts: Date.now(),
            })
          }
          return
        }

        if (!response.ok) {
          const message = await readErrorMessage(
            response,
            `Responses stream failed (${response.status})`
          )
          throw new Error(message)
        }

        if (!response.body) {
          throw new Error("OpenClaw responses stream returned an empty body")
        }

        markStarted()

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          const { frames, rest } = splitSseFrames(buffer)
          buffer = rest

          for (const frame of frames) {
            const parsed = parseSseFrame(frame)
            if (!parsed.data) continue

            if (parsed.data === "[DONE]") {
              completed = true
              pushEvent({
                id: crypto.randomUUID(),
                streamId,
                phase: "completed",
                ts: Date.now(),
              })
              continue
            }

            let raw: unknown = parsed.data
            try {
              raw = JSON.parse(parsed.data)
            } catch {
              raw = parsed.data
            }

            const eventType = extractType(raw, parsed.event)
            if (isErrorEvent(eventType, raw)) {
              const message = extractErrorMessage(raw)
              setError(message)
              setState("error")
              pushEvent({
                id: crypto.randomUUID(),
                streamId,
                phase: "error",
                ts: Date.now(),
                error: message,
                raw,
              })
              continue
            }

            const deltaText = extractDeltaText(raw)
            if (deltaText) {
              pushEvent({
                id: crypto.randomUUID(),
                streamId,
                phase: "delta",
                ts: Date.now(),
                text: deltaText,
                raw,
              })
            }

            if (isCompletedEvent(eventType, raw)) {
              completed = true
              pushEvent({
                id: crypto.randomUUID(),
                streamId,
                phase: "completed",
                ts: Date.now(),
                raw,
              })
            }
          }
        }

        if (!completed) {
          pushEvent({
            id: crypto.randomUUID(),
            streamId,
            phase: "completed",
            ts: Date.now(),
          })
        }
      } catch (streamError) {
        const aborted = controller.signal.aborted
        if (!aborted) {
          const message =
            streamError instanceof Error
              ? streamError.message
              : "Failed to stream OpenClaw responses"
          setError(message)
          setState("error")
          pushEvent({
            id: crypto.randomUUID(),
            streamId,
            phase: "error",
            ts: Date.now(),
            error: message,
          })
          if (!started) {
            rejectStarted(new Error(message))
          }
        } else if (!started) {
          rejectStarted(new Error("Responses stream was cancelled"))
        }
      } finally {
        controllersRef.current.delete(streamId)
        activeStreamsRef.current = Math.max(0, activeStreamsRef.current - 1)

        if (activeStreamsRef.current === 0) {
          if (cancelRequestedRef.current) {
            setState("aborted")
          } else {
            setState((prev) => (prev === "error" ? "error" : "done"))
          }
        } else {
          setState((prev) => (prev === "error" ? "error" : "streaming"))
        }
      }
    })()

    return startedPromise
  }, [pushEvent])

  return useMemo(
    () => ({
      state,
      events,
      error,
      start,
      cancel,
      clearEvents,
    }),
    [state, events, error, start, cancel, clearEvents]
  )
}
