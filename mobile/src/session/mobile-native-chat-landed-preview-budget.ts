export const MOBILE_NATIVE_CHAT_LANDED_PREVIEW_CHAR_BUDGET = 32 * 1024 * 1024

export type LandedImagePreviewsBySession = Record<string, Record<string, string[]>>

const INLINE_IMAGE_URI = /^data:image\//i

/** Returns only scopes whose landed previews need replacement. Iteration order is oldest first. */
export function trimLandedImagePreviewDataUris(
  previewsByScope: ReadonlyMap<string, LandedImagePreviewsBySession>,
  maxChars: number
): Map<string, LandedImagePreviewsBySession> {
  let retainedChars = 0
  for (const sessions of previewsByScope.values()) {
    for (const messages of Object.values(sessions)) {
      for (const images of Object.values(messages)) {
        for (const uri of images) {
          if (INLINE_IMAGE_URI.test(uri)) {
            retainedChars += uri.length
          }
        }
      }
    }
  }
  if (retainedChars <= maxChars) {
    return new Map()
  }

  const changed = new Map<string, LandedImagePreviewsBySession>()
  for (const [scopeKey, sessions] of previewsByScope) {
    let nextSessions = sessions
    for (const [sessionKey, messages] of Object.entries(sessions)) {
      let nextMessages = messages
      for (const [messageId, images] of Object.entries(messages)) {
        let nextImages = images
        for (const [index, uri] of images.entries()) {
          if (retainedChars <= maxChars) {
            break
          }
          if (!INLINE_IMAGE_URI.test(uri)) {
            continue
          }
          if (nextImages === images) {
            nextImages = [...images]
          }
          nextImages[index] = ''
          retainedChars -= uri.length
        }
        if (nextImages !== images) {
          if (nextMessages === messages) {
            nextMessages = { ...messages }
          }
          nextMessages[messageId] = nextImages
        }
      }
      if (nextMessages !== messages) {
        if (nextSessions === sessions) {
          nextSessions = { ...sessions }
        }
        nextSessions[sessionKey] = nextMessages
      }
    }
    if (nextSessions !== sessions) {
      changed.set(scopeKey, nextSessions)
    }
  }
  return changed
}

/** Applies the pure trim to existing runtime scopes without changing their ownership order. */
export function applyLandedImagePreviewDataUriBudget<
  Scope extends { imagePreviewsBySession: LandedImagePreviewsBySession }
>(scopes: ReadonlyMap<string, Scope>, maxChars: number): string[] {
  const previews = new Map([...scopes].map(([key, scope]) => [key, scope.imagePreviewsBySession]))
  const changed = trimLandedImagePreviewDataUris(previews, maxChars)
  for (const [key, next] of changed) {
    const scope = scopes.get(key)
    if (scope) {
      scope.imagePreviewsBySession = next
    }
  }
  return [...changed.keys()]
}
