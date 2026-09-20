import type { RpcClient } from '../transport/rpc-client'

export async function closeMobileSessionTabIfCurrent(args: {
  client: RpcClient
  worktreeId: string
  tabId: string
  isCurrent: () => boolean
}): Promise<boolean> {
  if (!args.isCurrent()) {
    return false
  }
  try {
    const response = await args.client.sendRequest('session.tabs.close', {
      worktree: `id:${args.worktreeId}`,
      tabId: args.tabId,
      reason: 'user'
    })
    return response.ok && args.isCurrent()
  } catch {
    return false
  }
}
