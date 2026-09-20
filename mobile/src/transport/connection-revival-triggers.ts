import { AppState } from 'react-native'
import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from 'expo-network'

// Why: Android/iOS suspend JS timers and silently kill sockets while the app
// is backgrounded, and network handoffs (Wi-Fi → cellular) kill the TCP path
// without an onclose. Both leave clients waiting out long backoff timers or
// parked at the reconnect give-up cap (issue #5049). Surface every "the link
// probably just came back" OS signal as a single nudge callback.
export function subscribeConnectionRevivalTriggers(
  nudge: (reason: 'app-resume' | 'network-change') => void
): () => void {
  let disposed = false
  const appStateSub = AppState.addEventListener('change', (next) => {
    if (!disposed && next === 'active') {
      nudge('app-resume')
    }
  })
  let lastNetwork: Pick<NetworkState, 'isConnected' | 'type'> | null = null
  // Seed the baseline when available; native events can beat this async read.
  void getNetworkStateAsync()
    .then((state) => {
      if (!disposed && lastNetwork == null) {
        lastNetwork = { isConnected: state.isConnected, type: state.type }
      }
    })
    .catch(() => {})
  const networkSub = addNetworkStateListener((state) => {
    if (disposed) {
      return
    }
    const previous = lastNetwork
    lastNetwork = { isConnected: state.isConnected, type: state.type }
    if (state.isConnected !== true) {
      return
    }
    // A native online event can beat the async initial snapshot.
    const cameOnline = previous == null || previous.isConnected !== true
    // Why: a type change while staying "connected" is the Wi-Fi → cellular
    // handoff case — the old socket is dead even though we never went offline.
    const switchedNetworks = previous?.type != null && state.type !== previous.type
    if (cameOnline || switchedNetworks) {
      console.log('[net] network changed — nudging clients', {
        type: state.type,
        cameOnline
      })
      nudge('network-change')
    }
  })
  return () => {
    if (disposed) {
      return
    }
    disposed = true
    appStateSub.remove()
    networkSub.remove()
  }
}
