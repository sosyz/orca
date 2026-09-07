// Browsers skip unavailable faces, so one canonical chain covers every desktop OS.
const TERMINAL_FALLBACK_FONTS = [
  'SF Mono',
  'Menlo',
  'Monaco',
  'Cascadia Mono',
  'Consolas',
  'DejaVu Sans Mono',
  'Liberation Mono',
  'Orca Nerd Font Symbols',
  'Symbols Nerd Font Mono',
  'MesloLGS NF',
  'JetBrainsMono Nerd Font',
  'Hack Nerd Font',
  'monospace'
] as const

export function buildFontFamily(fontFamily: string): string {
  const trimmed = fontFamily.trim()
  const parts = trimmed ? [`"${trimmed}"`] : []
  const lowerParts = parts.map((part) => part.toLowerCase())
  for (const fallback of TERMINAL_FALLBACK_FONTS) {
    const lower = fallback.toLowerCase()
    if (!lowerParts.some((part) => part.includes(lower))) {
      parts.push(fallback === 'monospace' ? fallback : `"${fallback}"`)
    }
  }
  return parts.join(', ')
}
