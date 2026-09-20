import { pasteboard } from '@kit.BasicServicesKit';
import type { BusinessError } from '@kit.BasicServicesKit';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { i18n } from '@kit.LocalizationKit';
import { scanBarcode, scanCore } from '@kit.ScanKit';
import { vibrator } from '@kit.SensorServiceKit';
import { UITurboModule, UITurboModuleContext } from '@rnoh/react-native-openharmony/ts';
import { HarmonyAudioService } from './HarmonyAudioService';
import { HarmonyAppLifecycle, type HarmonyAppLifecycleListener } from './HarmonyAppLifecycle';
import { HarmonyFileService, type HarmonyPickedFile } from './HarmonyFileService';
import { type HarmonyClipboardImage, HarmonyImageService, type HarmonyManipulatedImage, } from './HarmonyImageService';
import { HarmonyKeepAwakeService } from './HarmonyKeepAwakeService';
import { type HarmonyUrlEvent, HarmonyLinkingState } from './HarmonyLinkingState';
import { HarmonyNetworkService, type HarmonyNetworkState } from './HarmonyNetworkService';
import {
  type HarmonyNotificationInput,
  type HarmonyNotificationPermission,
  HarmonyNotificationService,
} from './HarmonyNotificationService';
import { type HarmonyNotificationResponse, HarmonyNotificationState, } from './HarmonyNotificationState';
import { HarmonyPermissionService } from './HarmonyPermissionService';
import { SecureValueStore } from './SecureValueStore';
const PASTEBOARD_PERMISSION = 'ohos.permission.READ_PASTEBOARD';
const PASTEBOARD_PERMISSION_DENIED = 'Clipboard permission denied';
const SCAN_CANCELLED = 1000500002;
const MAX_EXTERNAL_URL_LENGTH = 8192;
const MAX_RANDOM_BYTES = 1024;
const ORCA_BUNDLE_NAME = 'ai.stably.orca.harmony';
const SAFE_EXTERNAL_URL_PATTERN = /^(https?):\/\/([^\/?#\s]+)(?:[\/?#].*)?$/i;

function hasAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) {
      return true;
    }
  }
  return false;
}

function isValidPort(port: string): boolean {
  if (port.length === 0 || !/^[0-9]+$/u.test(port)) {
    return false;
  }
  return Number(port) <= 65535;
}

function isSafeExternalUrl(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > MAX_EXTERNAL_URL_LENGTH ||
    hasAsciiControlCharacter(value) ||
    value.indexOf('\\') !== -1
  ) {
    return false;
  }
  const match = SAFE_EXTERNAL_URL_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const authority = match[2];
  if (
    authority.length === 0 ||
    authority.indexOf('@') !== -1 ||
    authority.indexOf('%') !== -1 ||
    authority.indexOf('\\') !== -1
  ) {
    return false;
  }
  if (authority.startsWith('[')) {
    const closingBracket = authority.indexOf(']');
    const host = closingBracket === -1 ? '' : authority.slice(1, closingBracket);
    const suffix = closingBracket === -1 ? '' : authority.slice(closingBracket + 1);
    if (host.length === 0 || host.indexOf(':') === -1) {
      return false;
    }
    if (suffix.length === 0) {
      return true;
    }
    return suffix.startsWith(':') && isValidPort(suffix.slice(1));
  }
  if (authority.indexOf('[') !== -1 || authority.indexOf(']') !== -1) {
    return false;
  }
  const colon = authority.indexOf(':');
  if (colon === -1) {
    return true;
  }
  if (colon === 0 || authority.indexOf(':', colon + 1) !== -1) {
    return false;
  }
  const port = authority.slice(colon + 1);
  return isValidPort(port);
}

export class OrcaHarmonyTurboModule extends UITurboModule implements HarmonyAppLifecycleListener {
  static readonly NAME = 'OrcaHarmony';
  private readonly audio: HarmonyAudioService;
  private readonly files: HarmonyFileService;
  private readonly images: HarmonyImageService;
  private readonly keepAwake: HarmonyKeepAwakeService;
  private readonly network: HarmonyNetworkService;
  private readonly notifications: HarmonyNotificationService;
  private readonly permissions: HarmonyPermissionService;
  private readonly secureValues: SecureValueStore;
  private readonly notificationListenerToken: number;
  private readonly urlListenerToken: number;
  private readonly lifecycleListenerToken: number;

  constructor(ctx: UITurboModuleContext) {
    super(ctx);
    const emit = (eventName: string, payload: Object): void => {
      ctx.rnInstance.emitDeviceEvent(eventName, payload);
    };
    this.permissions = new HarmonyPermissionService(ctx.uiAbilityContext);
    this.audio = new HarmonyAudioService(this.permissions, emit);
    this.files = new HarmonyFileService(ctx.uiAbilityContext);
    this.images = new HarmonyImageService(this.files);
    this.keepAwake = new HarmonyKeepAwakeService(ctx.uiAbilityContext);
    this.network = new HarmonyNetworkService(emit);
    this.notifications = new HarmonyNotificationService(ctx.uiAbilityContext);
    this.secureValues = new SecureValueStore(ctx.uiAbilityContext);
    this.notificationListenerToken = HarmonyNotificationState.attach((response) => {
      emit('OrcaHarmonyNotificationResponse', response);
    });
    this.urlListenerToken = HarmonyLinkingState.attach((event) => {
      emit('OrcaHarmonyUrl', event);
    });
    this.lifecycleListenerToken = HarmonyAppLifecycle.attach(this);
  }

  override __onDestroy__(): void {
    HarmonyAppLifecycle.detach(this.lifecycleListenerToken);
    this.audio.tearDown();
    this.network.destroy();
    HarmonyLinkingState.detach(this.urlListenerToken);
    HarmonyNotificationState.detach(this.notificationListenerToken);
    void this.keepAwake.clear().catch(() => undefined);
  }

  onHarmonyForeground(): void {
    void this.keepAwake.setForeground(true).catch(() => undefined);
  }

  onHarmonyBackground(): void {
    this.audio.tearDown();
    void this.keepAwake.setForeground(false).catch(() => undefined);
  }

  randomBytes(length: number): number[] {
    if (
      !Number.isFinite(length) ||
      Math.floor(length) !== length ||
      length < 0 ||
      length > MAX_RANDOM_BYTES
    ) {
      throw new Error(`Random byte length must be an integer from 0 to ${MAX_RANDOM_BYTES}`);
    }
    const data = cryptoFramework.createRandom().generateRandomSync(length).data;
    const result: number[] = [];
    data.forEach((value) => result.push(value));
    return result;
  }

  setSecureValue(key: string, value: string): Promise<void> {
    return this.secureValues.set(key, value);
  }

  getSecureValue(key: string): Promise<string | null> {
    return this.secureValues.get(key);
  }

  deleteSecureValue(key: string): Promise<void> {
    return this.secureValues.delete(key);
  }

  activateKeepAwake(tag: string): Promise<void> {
    return this.keepAwake.activate(tag);
  }

  deactivateKeepAwake(tag: string): Promise<void> {
    return this.keepAwake.deactivate(tag);
  }

  deleteFile(uri: string): void {
    this.files.delete(uri);
  }

  fileSize(uri: string): number {
    return this.files.size(uri);
  }

  readFileBytes(uri: string, offset: number, length: number): number[] {
    return this.files.read(uri, offset, length);
  }

  writeFile(uri: string, data: string, encoding: string): void {
    this.files.write(uri, data, encoding);
  }

  openFilePicker(kind: string, multiple: boolean): Promise<HarmonyPickedFile[]> {
    return this.files.pick(kind, multiple);
  }

  manipulateImage(
    uri: string,
    width: number,
    height: number,
  ): Promise<HarmonyManipulatedImage> {
    return this.images.manipulate(uri, width, height);
  }

  async setClipboardString(value: string): Promise<void> {
    const data = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, value);
    await pasteboard.getSystemPasteboard().setData(data);
  }

  async getClipboardString(): Promise<string> {
    if (!(await this.permissions.request(PASTEBOARD_PERMISSION))) {
      throw new Error(PASTEBOARD_PERMISSION_DENIED);
    }
    const systemPasteboard = pasteboard.getSystemPasteboard();
    if (
      !(await systemPasteboard.hasData()) ||
      !systemPasteboard.hasDataType(pasteboard.MIMETYPE_TEXT_PLAIN)
    ) {
      return '';
    }
    return (await systemPasteboard.getData()).getPrimaryText();
  }

  async hasClipboardString(): Promise<boolean> {
    if (!this.permissions.isGranted(PASTEBOARD_PERMISSION)) {
      return false;
    }
    const systemPasteboard = pasteboard.getSystemPasteboard();
    try {
      return (await systemPasteboard.hasData()) &&
        systemPasteboard.hasDataType(pasteboard.MIMETYPE_TEXT_PLAIN);
    } catch (_) {
      return false;
    }
  }

  async hasClipboardImage(): Promise<boolean> {
    if (!this.permissions.isGranted(PASTEBOARD_PERMISSION)) {
      return false;
    }
    const systemPasteboard = pasteboard.getSystemPasteboard();
    try {
      return (await systemPasteboard.hasData()) &&
        systemPasteboard.hasDataType(pasteboard.MIMETYPE_PIXELMAP);
    } catch (_) {
      return false;
    }
  }

  async getClipboardImage(): Promise<HarmonyClipboardImage | null> {
    if (!(await this.permissions.request(PASTEBOARD_PERMISSION))) {
      throw new Error(PASTEBOARD_PERMISSION_DENIED);
    }
    return this.images.clipboardImage();
  }

  async scanPairingCode(): Promise<string | null> {
    if (canIUse('SystemCapability.Multimedia.Scan.ScanBarcode')) {
      try {
        const result = await scanBarcode.startScanForResult(this.ctx.uiAbilityContext, {
          scanTypes: [scanCore.ScanType.QR_CODE],
          enableAlbum: true,
          enableMultiMode: false,
        });
        return result.originalValue;
      } catch (error) {
        const scanError = error as BusinessError;
        if (scanError.code === SCAN_CANCELLED) {
          return null;
        }
        throw new Error(`Scan Kit failed (${scanError.code ?? 'unknown'})`);
      }
    }
    throw new Error('Scan Kit is unavailable on this device');
  }

  getNetworkState(): Promise<HarmonyNetworkState> {
    return this.network.getState();
  }

  getNotificationPermission(): Promise<HarmonyNotificationPermission> {
    return this.notifications.permission();
  }

  requestNotificationPermission(): Promise<HarmonyNotificationPermission> {
    return this.notifications.requestPermission();
  }

  scheduleNotification(content: HarmonyNotificationInput): Promise<string> {
    return this.notifications.schedule(content);
  }

  dismissNotification(identifier: string): Promise<void> {
    return this.notifications.dismiss(identifier);
  }

  getLastNotificationResponse(): HarmonyNotificationResponse | null {
    return HarmonyNotificationState.getLast();
  }

  clearLastNotificationResponse(): void {
    HarmonyNotificationState.clear();
  }

  getLatestUrlEvent(): HarmonyUrlEvent | null {
    return HarmonyLinkingState.getLatest();
  }

  getSystemLocale(): string | null {
    if (!canIUse('SystemCapability.Global.I18n')) {
      return null;
    }
    try {
      return i18n.System.getSystemLocale();
    } catch (_) {
      return null;
    }
  }

  async openExternalUrl(uri: string): Promise<void> {
    const value = uri.trim();
    if (!isSafeExternalUrl(value)) {
      throw new Error('Unsupported external URL');
    }
    await this.ctx.uiAbilityContext.startAbility({
      action: 'ohos.want.action.viewData',
      entities: ['entity.system.browsable'],
      uri: value,
    });
  }

  async openApplicationSettings(): Promise<void> {
    await this.ctx.uiAbilityContext.startAbility({
      bundleName: 'com.huawei.hmos.settings',
      abilityName: 'com.huawei.hmos.settings.MainAbility',
      uri: 'application_info_entry',
      parameters: { pushParams: ORCA_BUNDLE_NAME },
    });
  }

  requestMicrophonePermission(): Promise<boolean> {
    return this.audio.requestPermission();
  }

  getMicrophonePermission(): Promise<boolean> {
    return this.audio.getPermission();
  }

  initializeAudio(): Promise<boolean> {
    return this.audio.initialize();
  }

  setAudioRecording(enabled: boolean): boolean {
    return this.audio.setRecording(enabled);
  }

  tearDownAudio(): void {
    this.audio.tearDown();
  }

  async vibrate(_kind: string): Promise<void> {
    try {
      await vibrator.startVibration(
        { type: 'time', duration: 20 },
        { id: 0, usage: 'unknown' },
      );
    } catch (error) {
      const vibrationError = error as Error;
      const code = (error as BusinessError).code;
      if (code !== 801 && code !== 14600101) {
        throw vibrationError;
      }
    }
  }

  addListener(_eventName: string): void {
  }

  removeListeners(_count: number): void {
  }
}
