"use client"

import { AgentStatusPanel } from "../panels/agent-status-panel"
import { AgentChatPanel } from "../panels/agent-chat-panel"

export function AgentSection() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <AgentStatusPanel />
        <AgentChatPanel />
      </div>
    </div>
  )
}
