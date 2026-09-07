import {
  XTERM_MESLO_FONT_WOFF2_BASE64,
  XTERM_NERD_FONT_WOFF2_BASE64
} from './terminal-webview-engine.generated'

export const TERMINAL_WEBVIEW_FONT_FACE_CSS = `
@font-face {
  font-family: "MesloLGS NF";
  src: url("data:font/woff2;base64,${XTERM_MESLO_FONT_WOFF2_BASE64}") format("woff2");
  font-style: normal; font-weight: 400; font-display: block;
}
@font-face {
  font-family: "Orca Nerd Font Symbols";
  src: url("data:font/woff2;base64,${XTERM_NERD_FONT_WOFF2_BASE64}") format("woff2");
  font-style: normal; font-weight: 400; font-display: block;
  unicode-range: U+E000-F8FF, U+F0000-FFFFD, U+100000-10FFFD;
}`
