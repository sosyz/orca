export const TERMINAL_WEBVIEW_FONT_READINESS_JS = `
  var terminalFontReady = null;
  function waitForTerminalFont() {
    if (terminalFontReady) return terminalFontReady;
    if (!document.fonts || typeof document.fonts.load !== 'function') return Promise.resolve();
    var symbolSample = String.fromCharCode(0xe0b0);
    var emojiSample = String.fromCodePoint(0x1f642) + String.fromCodePoint(0x1f680);
    var loads = [
      document.fonts.load('normal 400 13px "Orca Emoji"', emojiSample),
      document.fonts.load('normal 400 13px "MesloLGS NF"', 'MW' + symbolSample),
      document.fonts.load('normal 400 13px "Orca Nerd Font Symbols"', symbolSample)
    ];
    var timeout = new Promise(function(resolve) { setTimeout(resolve, 2000); });
    terminalFontReady = Promise.race([Promise.all(loads), timeout]).then(
      function() {},
      function() {}
    );
    return terminalFontReady;
  }
`
