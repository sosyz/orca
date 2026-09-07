# Terminal WebView fonts

`MesloLGS-NF-Regular.woff2` is the build-time source for the generated terminal
WebView data URL. It stays outside Harmony rawfile resources so release HAPs do
not package a duplicate WOFF2 next to the embedded HBC payload.

Harmony native text still registers the matching TTF from
`../../harmony/entry/src/main/resources/rawfile/fonts/MesloLGS-NF-Regular.ttf`.
The Meslo and Nerd Font license texts remain packaged beside that native font.
