import type { Want } from '@kit.AbilityKit';

const NOTIFICATION_ID_KEY = 'orca.notification.id';
const NOTIFICATION_DATA_KEY = 'orca.notification.data';

interface NotificationContent {
  data?: Object;
}

interface NotificationRequest {
  content: NotificationContent;
  identifier: string;
}

interface Notification {
  request: NotificationRequest;
}

export interface HarmonyNotificationResponse {
  actionIdentifier: string;
  notification: Notification;
}

export class HarmonyNotificationState {
  private static lastResponse: HarmonyNotificationResponse | null = null;
  private static listener: ((response: HarmonyNotificationResponse) => void) | null = null;
  private static listenerToken = 0;

  static attach(listener: (response: HarmonyNotificationResponse) => void): number {
    const token = HarmonyNotificationState.listenerToken + 1;
    HarmonyNotificationState.listenerToken = token;
    HarmonyNotificationState.listener = listener;
    return token;
  }

  static detach(token: number): void {
    if (token !== HarmonyNotificationState.listenerToken) {
      return;
    }
    HarmonyNotificationState.listener = null;
  }

  static getLast(): HarmonyNotificationResponse | null {
    return HarmonyNotificationState.lastResponse;
  }

  static clear(): void {
    HarmonyNotificationState.lastResponse = null;
  }

  static clearIfMatches(identifier: string): boolean {
    if (HarmonyNotificationState.lastResponse?.notification.request.identifier !== identifier) {
      return false;
    }
    HarmonyNotificationState.lastResponse = null;
    return true;
  }

  static receiveWant(want: Want): void {
    const identifier = want.parameters?.[NOTIFICATION_ID_KEY];
    if (typeof identifier !== 'string' || identifier.length === 0) {
      return;
    }
    const content: NotificationContent = {};
    const encodedData = want.parameters?.[NOTIFICATION_DATA_KEY];
    if (typeof encodedData === 'string' && encodedData.length > 0) {
      try {
        content.data = JSON.parse(encodedData) as Object;
      } catch (_) {
      }
    }
    const request: NotificationRequest = { content: content, identifier: identifier };
    const notification: Notification = { request: request };
    const response: HarmonyNotificationResponse = {
      actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
      notification: notification,
    };
    HarmonyNotificationState.lastResponse = response;
    HarmonyNotificationState.listener?.(response);
  }

  static identifierKey(): string {
    return NOTIFICATION_ID_KEY;
  }

  static dataKey(): string {
    return NOTIFICATION_DATA_KEY;
  }
}
