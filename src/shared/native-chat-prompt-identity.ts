export type NativeChatPromptIdentity = {
  contentKey: string | null
  requestKey?: string
  revision: number
}

/** Missing metadata cannot prove a new request; keep the most recent explicit baseline. */
export function advanceNativeChatPromptIdentity(
  previous: NativeChatPromptIdentity | null,
  contentKey: string | null,
  requestKey?: string
): NativeChatPromptIdentity {
  if (!previous || previous.contentKey !== contentKey) {
    return { contentKey, requestKey, revision: previous ? previous.revision + 1 : 0 }
  }
  if (requestKey && previous.requestKey !== requestKey) {
    return {
      contentKey,
      requestKey,
      revision: previous.revision + (previous.requestKey ? 1 : 0)
    }
  }
  return previous
}

export function nativeChatPromptIdentityKey(identity: NativeChatPromptIdentity): string | null {
  return identity.contentKey === null
    ? null
    : JSON.stringify([identity.contentKey, identity.revision])
}
