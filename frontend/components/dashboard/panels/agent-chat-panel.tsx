"use client"

import { useState, useRef, useEffect, type FormEvent } from "react"
import { useSendAgentMessage } from "@/hooks/use-openclaw"
import { Panel, EmptyState } from "../panel"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { MessageSquare, Send, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
}

export function AgentChatPanel() {
  const sendMutation = useSendAgentMessage()
  const [input, setInput] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || sendMutation.isPending) return

    // Add user message immediately
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, userMsg])
    setInput("")

    sendMutation.mutate(
      { message: trimmed },
      {
        onSuccess: (data) => {
          const replyText =
            data.result?.payloads
              ?.map((p) => p.text)
              .filter(Boolean)
              .join("\n\n") ?? "No response"

          const assistantMsg: ChatMessage = {
            id: data.runId ?? `assistant-${Date.now()}`,
            role: "assistant",
            content: replyText,
            timestamp: new Date(),
          }
          setMessages((prev) => [...prev, assistantMsg])
        },
      }
    )
  }

  return (
    <Panel
      title="Agent Chat"
      icon={<MessageSquare className="h-3.5 w-3.5" />}
      className="flex flex-col"
    >
      <div className="flex flex-col" style={{ minHeight: 320 }}>
        {/* Messages */}
        <ScrollArea className="flex-1 pr-2" style={{ maxHeight: 400 }}>
          <div ref={scrollRef} className="flex flex-col gap-2 py-1">
            {messages.length === 0 ? (
              <EmptyState message="No messages yet. Send a message to talk to the agent." />
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "rounded-md px-3 py-2 text-xs",
                    msg.role === "user"
                      ? "ml-8 bg-primary/10 text-foreground"
                      : "mr-8 border border-border bg-secondary/40 text-foreground"
                  )}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span
                      className={cn(
                        "text-[10px] font-semibold uppercase",
                        msg.role === "user"
                          ? "text-primary"
                          : "text-muted-foreground"
                      )}
                    >
                      {msg.role}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {msg.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>
              ))
            )}
            {sendMutation.isPending && (
              <div className="mr-8 flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Agent is thinking...</span>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input */}
        <form
          onSubmit={handleSubmit}
          className="mt-3 flex items-center gap-2 border-t border-border pt-3"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Send a message..."
            className="flex-1 text-xs"
            disabled={sendMutation.isPending}
          />
          <Button
            type="submit"
            size="sm"
            disabled={!input.trim() || sendMutation.isPending}
            className="h-8 gap-1.5"
          >
            {sendMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </Button>
        </form>
      </div>
    </Panel>
  )
}
