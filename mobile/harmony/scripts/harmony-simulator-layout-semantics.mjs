export const REQUIRED_EMPTY_HOME_TEXT = ['Connect your desktop', 'Pair Desktop', 'How it works']
export const REQUIRED_PAIRED_HOME_TEXT = ['Welcome back', 'DESKTOPS', 'TASKS']
export const REQUIRED_PAIRING_TEXT = ['Not a valid pairing code', 'Back to home']
const EMPTY_HOME_TEXT_ALIASES = new Map([['How it works', ['HOW IT WORKS']]])

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function missingVisibleText(visibleText, requiredText, aliases = new Map()) {
  return requiredText.filter(
    (text) =>
      ![text, ...(aliases.get(text) ?? [])].some((candidate) => visibleText.includes(candidate))
  )
}

function formatMissingText(missing) {
  return missing.length > 0 ? missing.join(', ') : '<none>'
}

function isExplicitlyHiddenLayoutNode(value) {
  return value.visible === false || value.visible === 'false'
}

export function extractLayoutText(layout) {
  let root = layout
  if (typeof root === 'string') {
    try {
      root = JSON.parse(root)
    } catch {
      return root
    }
  }
  const values = []
  const visit = (value, hidden = false) => {
    if (Array.isArray(value)) {
      value.forEach((child) => visit(child, hidden))
      return
    }
    if (!value || typeof value !== 'object') {
      return
    }
    const nodeHidden = hidden || isExplicitlyHiddenLayoutNode(value)
    for (const [key, child] of Object.entries(value)) {
      if (
        !nodeHidden &&
        (key === 'text' || key === 'originalText') &&
        typeof child === 'string' &&
        child
      ) {
        values.push(child)
      }
      visit(child, nodeHidden)
    }
  }
  visit(root)
  return values.join('\n')
}

export function classifyHomeLayout(layout) {
  const visibleText = extractLayoutText(layout)
  const pairedHomeMissing = missingVisibleText(visibleText, REQUIRED_PAIRED_HOME_TEXT)
  if (pairedHomeMissing.length === 0) {
    return { kind: 'paired-home', missing: { emptyHome: [], pairedHome: [] }, recognized: true }
  }
  const emptyHomeMissing = missingVisibleText(
    visibleText,
    REQUIRED_EMPTY_HOME_TEXT,
    EMPTY_HOME_TEXT_ALIASES
  )
  if (emptyHomeMissing.length === 0) {
    return { kind: 'empty-home', missing: { emptyHome: [], pairedHome: [] }, recognized: true }
  }
  return {
    kind: 'unknown-home',
    missing: {
      emptyHome: emptyHomeMissing,
      pairedHome: pairedHomeMissing
    },
    recognized: false
  }
}

export function assertHomeLayout(layout) {
  const result = classifyHomeLayout(layout)
  assert(
    result.recognized,
    `Home UI is not a recognized empty or paired state; empty-home missing: ${formatMissingText(
      result.missing.emptyHome
    )}; paired-home missing: ${formatMissingText(result.missing.pairedHome)}`
  )
  return result.kind
}

export function assertPairingErrorLayout(layout) {
  const visibleText = extractLayoutText(layout)
  const missing = missingVisibleText(visibleText, REQUIRED_PAIRING_TEXT)
  assert(missing.length === 0, `Pairing error UI is missing: ${missing.join(', ')}`)
  return true
}
