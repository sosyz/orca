import { StatusBar as NativeStatusBar } from 'react-native'

export function StatusBar({ style = 'auto' }: { style?: 'auto' | 'dark' | 'light' }) {
  const barStyle =
    style === 'light' ? 'light-content' : style === 'dark' ? 'dark-content' : 'default'
  return <NativeStatusBar barStyle={barStyle} />
}
