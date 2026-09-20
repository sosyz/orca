const pairing = {
  mobile: {
    pairing: {
      backToHome: 'Back to home',
      confirm: {
        body: 'You opened a pairing link from your desktop. Confirm to add it to your hosts.',
        pair: 'Pair',
        title: 'Pair with this desktop?'
      },
      errors: {
        failed: 'Pairing failed: {{message}}',
        invalidCode: 'Not a valid pairing code',
        invalidCodeWithHint:
          'Not a valid pairing code - copy it from your computer and paste again',
        invalidQr: 'Not a valid Orca QR code',
        missingCode: 'Missing pairing code',
        timeout: "Couldn't connect within {{seconds}}s - see log below for where it stalled",
        unknown: 'Unknown error'
      },
      logTitle: 'Pairing log',
      paste: {
        button: 'Paste code instead',
        message: 'Copy the code shown under the QR on your computer.',
        orButton: 'Or paste pairing code',
        placeholder: 'orca://pair?code=... or paste the code',
        title: 'Paste pairing code'
      },
      permission: {
        body: 'Scan the QR code from Orca on your desktop, or paste the pairing code instead.',
        disabledBody: 'Enable camera access in Settings, or paste the pairing code instead.',
        disabledTitle: 'Camera Access Disabled',
        title: 'Pair with desktop'
      },
      scanSteps: {
        open: 'Open Orca on your computer',
        scan: 'Scan the QR code',
        settings: 'Go to Settings > Mobile'
      }
    }
  }
} as const

export default pairing
