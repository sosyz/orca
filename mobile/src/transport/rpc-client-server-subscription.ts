export function buildReadyStreamUnsubscribe(
  method: string,
  subscriptionId: string
): { method: string; params: { subscriptionId: string } } | null {
  if (method === 'browser.screencast') {
    return { method: 'browser.screencast.unsubscribe', params: { subscriptionId } }
  }
  if (method === 'runtime.clientEvents.subscribe') {
    return { method: 'runtime.clientEvents.unsubscribe', params: { subscriptionId } }
  }
  if (method === 'accounts.subscribe') {
    return { method: 'accounts.unsubscribe', params: { subscriptionId } }
  }
  if (method === 'notifications.subscribe') {
    return { method: 'notifications.unsubscribe', params: { subscriptionId } }
  }
  return null
}
