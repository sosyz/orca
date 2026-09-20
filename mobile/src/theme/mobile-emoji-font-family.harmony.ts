import type { TextStyle } from 'react-native'

export const mobileEmojiFontFamily = 'Orca Emoji'

export const mobileEmojiTextStyle = {
  fontFamily: mobileEmojiFontFamily
} satisfies Pick<TextStyle, 'fontFamily'>
