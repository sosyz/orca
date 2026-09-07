import {
  addHarmonyNativeListener,
  HarmonyNative,
  hasHarmonyNativeModule
} from '../native/harmony-native-module'

export type NetworkState = {
  isConnected: boolean
  isInternetReachable: boolean
  type: string
}

const fallbackState: NetworkState = {
  isConnected: false,
  isInternetReachable: false,
  type: 'UNKNOWN'
}

export async function getNetworkStateAsync(): Promise<NetworkState> {
  return hasHarmonyNativeModule() ? HarmonyNative.getNetworkState() : fallbackState
}

export function addNetworkStateListener(listener: (state: NetworkState) => void) {
  return addHarmonyNativeListener<NetworkState>('OrcaHarmonyNetworkChange', listener)
}
