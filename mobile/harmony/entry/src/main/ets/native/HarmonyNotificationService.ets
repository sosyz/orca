import { common, type Want, wantAgent } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import type { BusinessError } from '@kit.BasicServicesKit';
import { notificationManager } from '@kit.NotificationKit';
import { HarmonyNotificationState } from './HarmonyNotificationState';

const NOTIFICATION_PREFERENCES = 'orca_notification_permissions';
const PROMPT_ATTEMPTED_KEY = 'prompt_attempted';
const PERMISSION_REFUSED_CODE = 1600004;
const MAX_NOTIFICATION_IDENTIFIER = 2_000_000_000;
const NOTIFICATION_IDENTIFIER_PATTERN = /^(0|[1-9][0-9]*)$/u;

export interface HarmonyNotificationInput {
  body?: string;
  data?: Object;
  title?: string;
}

export interface HarmonyNotificationPermission {
  canAskAgain: boolean;
  granted: boolean;
  status: string;
}

function parseNotificationIdentifier(identifier: string): number | null {
  if (!NOTIFICATION_IDENTIFIER_PATTERN.test(identifier)) {
    return null;
  }
  const id = Number.parseInt(identifier, 10);
  return Number.isSafeInteger(id) && id >= 0 && id < MAX_NOTIFICATION_IDENTIFIER ? id : null;
}

export class HarmonyNotificationService {
  private nextIdentifier = Date.now() % MAX_NOTIFICATION_IDENTIFIER;
  private permissionRequest: Promise<HarmonyNotificationPermission> | null = null;
  private readonly context: common.UIAbilityContext;
  private readonly permissionPreferences: preferences.Preferences;

  constructor(context: common.UIAbilityContext) {
    this.context = context;
    this.permissionPreferences = preferences.getPreferencesSync(context, {
      name: NOTIFICATION_PREFERENCES,
    });
  }

  async permission(): Promise<HarmonyNotificationPermission> {
    return this.permissionResult(
      await notificationManager.isNotificationEnabled(),
      this.wasPromptAttempted(),
    );
  }

  async requestPermission(): Promise<HarmonyNotificationPermission> {
    if (this.permissionRequest) {
      return this.permissionRequest;
    }
    const request = this.requestPermissionOnce();
    this.permissionRequest = request;
    try {
      return await request;
    } finally {
      if (this.permissionRequest === request) {
        this.permissionRequest = null;
      }
    }
  }

  private async requestPermissionOnce(): Promise<HarmonyNotificationPermission> {
    if (await notificationManager.isNotificationEnabled()) {
      return this.permissionResult(true, this.wasPromptAttempted());
    }
    try {
      await notificationManager.requestEnableNotification(this.context);
      await this.recordPromptAttempt();
    } catch (error) {
      const permissionError = error as BusinessError;
      if (permissionError.code === PERMISSION_REFUSED_CODE) {
        await this.recordPromptAttempt();
        return this.permissionResult(false, true);
      }
      throw new Error(permissionError.message);
    }
    return this.permission();
  }

  async schedule(input: HarmonyNotificationInput): Promise<string> {
    this.nextIdentifier = (this.nextIdentifier + 1) % MAX_NOTIFICATION_IDENTIFIER;
    const notificationId = this.nextIdentifier;
    const identifier = notificationId.toString();
    const parameters: Record<string, Object> = {};
    parameters[HarmonyNotificationState.identifierKey()] = identifier;
    parameters[HarmonyNotificationState.dataKey()] = JSON.stringify(input.data ?? {});
    const want: Want = {
      bundleName: this.context.abilityInfo.bundleName,
      abilityName: this.context.abilityInfo.name,
      parameters: parameters,
    };
    const agentInfo: wantAgent.WantAgentInfo = {
      wants: [want],
      actionType: wantAgent.OperationType.START_ABILITY,
      requestCode: notificationId,
      actionFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG],
    };
    const agent = await wantAgent.getWantAgent(agentInfo);
    const normal: notificationManager.NotificationBasicContent = {
      title: input.title ?? 'Orca',
      text: input.body ?? 'Task update',
    };
    const content: notificationManager.NotificationContent = {
      notificationContentType:
      notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
      normal: normal,
    };
    const request: notificationManager.NotificationRequest = {
      id: notificationId,
      content: content,
      notificationSlotType: notificationManager.SlotType.SERVICE_INFORMATION,
      tapDismissed: true,
      wantAgent: agent,
    };
    await notificationManager.publish(request);
    return identifier;
  }

  async dismiss(identifier: string): Promise<void> {
    const id = parseNotificationIdentifier(identifier);
    if (id !== null) {
      await notificationManager.cancel(id);
    }
  }

  private permissionResult(
    granted: boolean,
    promptAttempted: boolean,
  ): HarmonyNotificationPermission {
    const result: HarmonyNotificationPermission = {
      canAskAgain: granted || !promptAttempted,
      granted: granted,
      status: granted ? 'granted' : promptAttempted ? 'denied' : 'undetermined',
    };
    return result;
  }

  private wasPromptAttempted(): boolean {
    return this.permissionPreferences.getSync(PROMPT_ATTEMPTED_KEY, false) as boolean;
  }

  private async recordPromptAttempt(): Promise<void> {
    this.permissionPreferences.putSync(PROMPT_ATTEMPTED_KEY, true);
    await this.permissionPreferences.flush();
  }
}
