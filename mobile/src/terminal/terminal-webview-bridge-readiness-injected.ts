export const TERMINAL_WEBVIEW_BRIDGE_READINESS_JS = `
  var bridgeReadyId = String(Date.now()) + '-' + String(Math.random());
  var bridgeReadyAcknowledged = false;
  var webReadyAnnounced = false;

  function announceWebReady() {
    if (webReadyAnnounced) return;
    webReadyAnnounced = true;
    if (window.Terminal) {
      waitForTerminalFont().then(function() { notify({ type: 'web-ready' }); });
    } else {
      reportEngineError('terminal engine missing', 'xterm failed to load', true);
    }
  }

  function announceInitialEngineState(attemptsLeft) {
    if (bridgeReadyAcknowledged) return;
    if (!window.ReactNativeWebView) {
      if (attemptsLeft > 0) {
        setTimeout(function() { announceInitialEngineState(attemptsLeft - 1); }, 50);
      }
      return;
    }
    notify({ type: 'bridge-ready', bridgeId: bridgeReadyId });
    if (window.__ORCA_HARMONY_WEBVIEW__ === true) {
      if (attemptsLeft > 0) {
        setTimeout(function() { announceInitialEngineState(attemptsLeft - 1); }, 50);
      }
      return;
    }
    announceWebReady();
  }
`
