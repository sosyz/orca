export function shouldOfferMobileTerminalPaste(
  platform: string,
  hasString: boolean,
  hasImage: boolean
): boolean {
  return platform === 'harmony' || hasString || hasImage
}
