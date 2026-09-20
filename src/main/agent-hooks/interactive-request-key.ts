import { createHash } from 'node:crypto'
import type { AgentHookEventPayload } from '../../shared/agent-hook-listener/listener-event'

/** Only Claude's permission hook supplies a tool identity for this exact request. */
export function claudeInteractiveRequestKey(event: AgentHookEventPayload): string | undefined {
  if (
    event.source !== 'claude' ||
    event.hookEventName !== 'PermissionRequest' ||
    (event.payload.state !== 'waiting' && event.payload.state !== 'blocked')
  ) {
    return undefined
  }
  const toolUseId = event.toolUseId?.trim()
  const sessionId = event.providerSession?.id.trim()
  const launchToken = event.launchToken?.trim()
  const namespace = sessionId
    ? `session:${sessionId}`
    : launchToken
      ? `launch:${launchToken}`
      : null
  if (!toolUseId || !namespace) {
    return undefined
  }
  const digest = createHash('sha256').update(namespace).update('\0').update(toolUseId).digest('hex')
  return `claude-tool:${digest}`
}
