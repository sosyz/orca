# MesloLGS NF

The terminal uses the MesloLGS NF face recommended by Powerlevel10k. The
generated WebView engine reads the build-time WOFF2 source at
`../../../../../../../assets/fonts/MesloLGS-NF-Regular.woff2` and embeds it as a
data URL. The WOFF2 is intentionally not packaged as a rawfile resource because
the release HBC already contains the embedded payload.

React Native text cannot load WOFF2 through ArkUI, so the verified upstream TTF
is also packaged as `MesloLGS-NF-Regular.ttf` and registered as `MesloLGS NF`.
Harmony code, file, diff, and terminal-adjacent text uses that registered family
while the platform font fallback continues to cover glyphs absent from Meslo.

Source: `romkatv/powerlevel10k-media` commit
`145eb9fbc2f42ee408dacd9b22d8e6e0e553f83d`.

The upstream TTF was losslessly encoded as WOFF2 with FontTools 4.60.2. ArkWeb
blocks `resource://` cross-origin font subrequests from inline HTML, so embedding
avoids a five-second fallback on every document load. Bold and italic terminal
cells use browser synthesis from this face.

| Style   | Packaged TTF SHA-256                                               | Embedded WOFF2 SHA-256                                             |
| ------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Regular | `d97946186e97f8d7c0139e8983abf40a1d2d086924f2c5dbf1c29bd8f2c6e57d` | `b5ac39171de40b640726146502023aa0c4dc5220b718e957d00ddc8fe4e0d73c` |

The files are distributed under `MesloLGS-NF-License.txt` and the complete
`Apache-2.0.txt` license text.

The shared terminal WebView code embeds a generated base64 WOFF2 payload
(`XTERM_NERD_FONT_WOFF2_BASE64`) from `SymbolsNerdFontMono-Regular.woff2` as a
cross-platform glyph fallback. Its notice and SIL OFL 1.1 terms are included
in `SymbolsNerdFontMono-OFL.txt`.
