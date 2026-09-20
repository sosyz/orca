const onboarding = {
  mobile: {
    onboarding: {
      errors: {
        notifications: 'Notification settings could not be updated. Try again.',
        sessionView: 'Your choice could not be saved. Try again.'
      },
      notifications: {
        body: 'Get notified on this device when an agent needs your input or finishes a task.',
        enable: 'Enable notifications',
        enableA11y: 'Enable agent notifications',
        skip: 'Not now',
        skipA11y: 'Skip notifications for now',
        title: 'Stay updated while away'
      },
      progressLabel: 'Onboarding progress',
      progressValue: 'Step {{current}} of {{total}}',
      sessionView: {
        body: 'Choose whether supported agent sessions open in the terminal or Chat UI on this device. Press and hold a session tab to switch its view, or change the default later in Settings.',
        chat: 'Use Chat UI',
        chatA11y: 'Open sessions in Chat UI',
        terminal: 'Keep terminal',
        terminalA11y: 'Open sessions in the terminal',
        title: 'How should sessions open?'
      }
    }
  }
} as const

export default onboarding
