import type { RpcClient } from '../transport/rpc-client'
import type { RpcFailure, RpcSuccess } from '../transport/types'
import { isFloatingWorkspaceWorktreeId } from './floating-workspace'
import { resolveMobileWorktreeExecutionConnectionId } from './mobile-worktree-execution-connection'
import {
  buildMobileNewTabAgentOptions,
  type MobileNewTabAgentOption,
  type MobileNewTabAgentSettings
} from './mobile-new-tab-agent-options'

export async function loadMobileNewTabAgentOptions(args: {
  client: RpcClient
  worktreeId: string
}): Promise<MobileNewTabAgentOption[]> {
  const { client, worktreeId } = args
  // Why: the floating workspace runs on the paired host, so it has no repo connection to resolve.
  const detectedAgentsRequest = isFloatingWorkspaceWorktreeId(worktreeId)
    ? client.sendRequest('preflight.detectAgents')
    : loadWorkspaceDetectedAgents(client, worktreeId)
  const [settingsResponse, detectedResponse] = await Promise.all([
    client.sendRequest('settings.get'),
    detectedAgentsRequest
  ])
  if (!settingsResponse.ok) {
    throw new Error((settingsResponse as RpcFailure).error.message)
  }
  if (!detectedResponse.ok) {
    throw new Error((detectedResponse as RpcFailure).error.message)
  }
  const settings = (
    (settingsResponse as RpcSuccess).result as {
      settings?: MobileNewTabAgentSettings
    }
  ).settings
  return buildMobileNewTabAgentOptions(
    settings,
    (detectedResponse as RpcSuccess).result as unknown[]
  )
}

async function loadWorkspaceDetectedAgents(client: RpcClient, worktreeId: string) {
  const connectionId = await resolveMobileWorktreeExecutionConnectionId(client, worktreeId)
  return connectionId
    ? client.sendRequest('preflight.detectRemoteAgents', { connectionId })
    : client.sendRequest('preflight.detectAgents')
}
