export const REQUIRED_EMPTY_HOME_TEXT = [
  ['Connect your desktop', '连接你的桌面端'],
  ['Pair Desktop', '配对桌面端'],
  ['How it works', 'HOW IT WORKS', '使用方式']
]
export const REQUIRED_PAIRED_HOME_TEXT = [
  ['Welcome back', '欢迎回来'],
  ['DESKTOPS', '桌面端'],
  ['TASKS', '任务']
]
export const REQUIRED_PAIRING_TEXT = [
  ['Not a valid pairing code', '配对码无效'],
  ['Back to home', '返回首页']
]

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function textCandidates(requiredText) {
  return Array.isArray(requiredText) ? requiredText : [requiredText]
}

function textLabel(requiredText) {
  return textCandidates(requiredText)[0]
}

function missingVisibleText(visibleText, requiredText) {
  return requiredText.filter(
    (text) => !textCandidates(text).some((candidate) => visibleText.includes(candidate))
  )
}

function formatMissingText(missing) {
  return missing.length > 0 ? missing.map(textLabel).join(', ') : '<none>'
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
  const emptyHomeMissing = missingVisibleText(visibleText, REQUIRED_EMPTY_HOME_TEXT)
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

export function classifyPairingErrorLayout(layout) {
  const visibleText = extractLayoutText(layout)
  const missing = missingVisibleText(visibleText, REQUIRED_PAIRING_TEXT)
  return { missing, recognized: missing.length === 0 }
}

export function assertPairingErrorLayout(layout) {
  const result = classifyPairingErrorLayout(layout)
  assert(result.recognized, `Pairing error UI is missing: ${formatMissingText(result.missing)}`)
  return true
}
