import type { ConnectionLogEntry } from '../transport/types'

const SECRET_FIELD_NAME_PATTERN =
  'resume[_-]?token|device[_-]?token|authorization|credential|token|public[_-]?keyB64|access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|password|secret'
const SECRET_JSON_ASSIGNMENT = new RegExp(
  String.raw`(["'])(${SECRET_FIELD_NAME_PATTERN})\1(\s*:\s*)(["'])(?:Bearer\s+)?(?:\\.|(?!\4)[^\\\r\n])*\4`,
  'gi'
)
const SECRET_QUOTED_VALUE_ASSIGNMENT = new RegExp(
  String.raw`\b(${SECRET_FIELD_NAME_PATTERN})(\s*[:=]\s*)(["'])(?:Bearer\s+)?(?:\\.|(?!\3)[^\\\r\n])*\3`,
  'gi'
)
const SECRET_UNTERMINATED_JSON_ASSIGNMENT = new RegExp(
  String.raw`(["'])(${SECRET_FIELD_NAME_PATTERN})\1(\s*:\s*)(["'])(?:Bearer\s+)?(?:\\.|(?!\4)[^\\\r\n])*(?=\r?\n|$)`,
  'gi'
)
const SECRET_UNTERMINATED_QUOTED_VALUE_ASSIGNMENT = new RegExp(
  String.raw`\b(${SECRET_FIELD_NAME_PATTERN})(\s*[:=]\s*)(["'])(?:Bearer\s+)?(?:\\.|(?!\3)[^\\\r\n])*(?=\r?\n|$)`,
  'gi'
)
const SECRET_ASSIGNMENT = new RegExp(
  String.raw`\b(${SECRET_FIELD_NAME_PATTERN})(\s*[:=]\s*)(?:Bearer\s+)?([^\s;,&}#"']+)`,
  'gi'
)
const SECRET_QUERY = /([?&])([^=&#\s]+)=([^&#\s]*)/gi
const SECRET_QUERY_KEY_PATTERN = new RegExp(`^(?:code|${SECRET_FIELD_NAME_PATTERN})$`, 'i')
const PAIRING_FRAGMENT = /(orca:\/\/pair\/?(?:\?[^#\s]*)?#)[A-Za-z0-9+/_-]+={0,2}/gi
const URL_USERINFO = /((?:wss?|https?):\/\/)[^\s/?#]*@/gi

function decodeQueryKey(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

export function redactConnectionLogText(value: string): string {
  return value
    .replace(
      SECRET_JSON_ASSIGNMENT,
      (_match, keyQuote: string, label: string, separator: string, valueQuote: string) =>
        `${keyQuote}${label}${keyQuote}${separator}${valueQuote}[redacted]${valueQuote}`
    )
    .replace(
      SECRET_QUOTED_VALUE_ASSIGNMENT,
      (_match, label: string, separator: string, valueQuote: string) =>
        `${label}${separator}${valueQuote}[redacted]${valueQuote}`
    )
    .replace(
      SECRET_UNTERMINATED_JSON_ASSIGNMENT,
      (_match, keyQuote: string, label: string, separator: string, valueQuote: string) =>
        `${keyQuote}${label}${keyQuote}${separator}${valueQuote}[redacted]`
    )
    .replace(
      SECRET_UNTERMINATED_QUOTED_VALUE_ASSIGNMENT,
      (_match, label: string, separator: string, valueQuote: string) =>
        `${label}${separator}${valueQuote}[redacted]`
    )
    .replace(SECRET_ASSIGNMENT, (_match, label: string, separator: string) => {
      return `${label}${separator}[redacted]`
    })
    .replace(SECRET_QUERY, (match, marker: string, key: string) => {
      return SECRET_QUERY_KEY_PATTERN.test(decodeQueryKey(key))
        ? `${marker}${key}=[redacted]`
        : match
    })
    .replace(PAIRING_FRAGMENT, '$1[redacted]')
    .replace(URL_USERINFO, '$1[redacted]@')
}

export function redactConnectionLogEntry(entry: ConnectionLogEntry): ConnectionLogEntry {
  return {
    ...entry,
    message: redactConnectionLogText(entry.message),
    ...(entry.detail ? { detail: redactConnectionLogText(entry.detail) } : {})
  }
}
