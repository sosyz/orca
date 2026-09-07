import { audio } from '@kit.AudioKit';
import { deviceInfo } from '@kit.BasicServicesKit';
import { HarmonyPermissionService } from './HarmonyPermissionService';

const MICROPHONE_PERMISSION = 'ohos.permission.MICROPHONE';
const AUDIO_START_TIMEOUT_MS = 3000;

enum AudioStartOutcome {
  STARTED,
  FAILED,
  CANCELLED,
  TIMED_OUT,
}

interface MicrophoneDataPayload {
  data: number[];
}

interface AudioInterruptionPayload {
  data: string;
}

interface PendingAudioStart {
  capturer: audio.AudioCapturer;
  cancel: () => void;
}

export class HarmonyAudioService {
  private capturer: audio.AudioCapturer | null = null;
  private desiredRecording = false;
  private generation = 0;
  private lifecycleTail: Promise<void> = Promise.resolve();
  private pendingStart: PendingAudioStart | null = null;
  private readonly releasePromises = new Map<audio.AudioCapturer, Promise<void>>();
  private readonly permissions: HarmonyPermissionService;
  private readonly emit: (eventName: string, payload: Object) => void;

  constructor(
    permissions: HarmonyPermissionService,
    emit: (eventName: string, payload: Object) => void,
  ) {
    this.permissions = permissions;
    this.emit = emit;
  }

  requestPermission(): Promise<boolean> {
    return this.permissions.request(MICROPHONE_PERMISSION);
  }

  getPermission(): Promise<boolean> {
    return Promise.resolve(this.permissions.isGranted(MICROPHONE_PERMISSION));
  }

  async initialize(): Promise<boolean> {
    // API 12 cannot cancel a start blocked by an emulator without a microphone.
    if (deviceInfo.productModel === 'emulator') {
      return false;
    }
    if (!this.permissions.isGranted(MICROPHONE_PERMISSION)) {
      return false;
    }
    const generation = this.generation;
    let initialized = false;
    await this.enqueue(async () => {
      if (generation !== this.generation) {
        return;
      }
      if (this.capturer) {
        initialized = true;
        return;
      }
      initialized = await this.createCapturer(generation);
    });
    return initialized;
  }

  private async createCapturer(generation: number): Promise<boolean> {
    const streamInfo: audio.AudioStreamInfo = {
      samplingRate: audio.AudioSamplingRate.SAMPLE_RATE_16000,
      channels: audio.AudioChannel.CHANNEL_1,
      sampleFormat: audio.AudioSampleFormat.SAMPLE_FORMAT_S16LE,
      encodingType: audio.AudioEncodingType.ENCODING_TYPE_RAW,
    };
    const capturerInfo: audio.AudioCapturerInfo = {
      source: audio.SourceType.SOURCE_TYPE_VOICE_RECOGNITION,
      capturerFlags: 0,
    };
    const options: audio.AudioCapturerOptions = {
      streamInfo: streamInfo,
      capturerInfo: capturerInfo,
    };
    let capturer: audio.AudioCapturer | null = null;
    try {
      const createdCapturer = await audio.createAudioCapturer(options);
      capturer = createdCapturer;
      if (generation !== this.generation) {
        await this.releaseCapturer(createdCapturer);
        return false;
      }
      createdCapturer.on('readData', (data) => this.handleData(createdCapturer, data));
      createdCapturer.on('audioInterrupt', (event) =>
        this.handleInterruption(createdCapturer, event)
      );
      this.capturer = createdCapturer;
      return true;
    } catch (_) {
      if (capturer) {
        await this.releaseCapturer(capturer);
      }
      return false;
    }
  }

  setRecording(enabled: boolean): boolean {
    this.desiredRecording = enabled;
    if (!this.capturer) {
      return false;
    }
    if (!enabled && this.interruptPendingStart()) {
      return true;
    }
    const generation = this.generation;
    void this.enqueue(() => this.synchronizeRecording(generation)).catch(() => undefined);
    return true;
  }

  tearDown(): void {
    this.desiredRecording = false;
    this.generation += 1;
    this.interruptPendingStart();
    const capturer = this.capturer;
    this.capturer = null;
    if (!capturer) {
      return;
    }
    void this.releaseCapturer(capturer, true).catch(() => undefined);
  }

  private async synchronizeRecording(generation: number): Promise<void> {
    const capturer = this.capturer;
    if (!capturer || generation !== this.generation) {
      return;
    }
    if (!this.desiredRecording) {
      await this.stopCapturer(capturer);
      return;
    }
    if (!this.canStart(capturer.state)) {
      return;
    }
    const outcome = await this.startCapturer(capturer);
    if (outcome === AudioStartOutcome.STARTED) {
      if (
        generation !== this.generation ||
        capturer !== this.capturer ||
        !this.desiredRecording
      ) {
        await this.releaseCapturer(capturer, true);
      }
      return;
    }
    if (
      outcome !== AudioStartOutcome.CANCELLED &&
      generation === this.generation &&
      this.desiredRecording
    ) {
      this.abandonCapturer(capturer);
      this.emitInterruption('blocked');
    }
  }

  private async startCapturer(capturer: audio.AudioCapturer): Promise<AudioStartOutcome> {
    let cancelStart: () => void = () => undefined;
    const cancellation = new Promise<AudioStartOutcome>((resolve) => {
      cancelStart = () => resolve(AudioStartOutcome.CANCELLED);
    });
    const attempt: PendingAudioStart = { capturer: capturer, cancel: cancelStart };
    this.pendingStart = attempt;
    let startResult: Promise<AudioStartOutcome>;
    try {
      startResult = capturer.start().then(
        () => AudioStartOutcome.STARTED,
        () => AudioStartOutcome.FAILED,
      );
    } catch (_) {
      this.pendingStart = null;
      return AudioStartOutcome.FAILED;
    }
    let timeoutId = -1;
    const timeout = new Promise<AudioStartOutcome>((resolve) => {
      timeoutId = setTimeout(() => {
        if (this.pendingStart !== attempt) {
          return;
        }
        resolve(AudioStartOutcome.TIMED_OUT);
        this.abandonCapturer(capturer);
      }, AUDIO_START_TIMEOUT_MS);
    });
    const outcome = await Promise.race([startResult, cancellation, timeout]);
    clearTimeout(timeoutId);
    if (this.pendingStart === attempt) {
      this.pendingStart = null;
    }
    if (
      outcome === AudioStartOutcome.CANCELLED ||
      outcome === AudioStartOutcome.TIMED_OUT
    ) {
      void startResult
        .then(() => this.releaseAfterAbandonedStart(capturer))
        .catch(() => this.emitInterruption('blocked'));
    }
    return outcome;
  }

  private async releaseAfterAbandonedStart(capturer: audio.AudioCapturer): Promise<void> {
    const previousRelease = this.releasePromises.get(capturer);
    if (previousRelease) {
      try {
        await previousRelease;
      } catch (_) {
      }
    }
    if (capturer.state === audio.AudioState.STATE_RELEASED) {
      return;
    }
    await this.releaseCapturer(capturer);
  }

  private interruptPendingStart(): boolean {
    const attempt = this.pendingStart;
    if (!attempt) {
      return false;
    }
    this.pendingStart = null;
    attempt.cancel();
    this.abandonCapturer(attempt.capturer);
    return true;
  }

  private abandonCapturer(capturer: audio.AudioCapturer): void {
    if (capturer === this.capturer) {
      this.capturer = null;
    }
    void this.releaseCapturer(capturer, true).catch(() => undefined);
  }

  private async stopCapturer(capturer: audio.AudioCapturer): Promise<void> {
    if (!this.canStop(capturer.state)) {
      return;
    }
    try {
      await capturer.stop();
    } catch (_) {
    }
  }

  private releaseCapturer(
    capturer: audio.AudioCapturer,
    skipStop: boolean = false,
  ): Promise<void> {
    const existing = this.releasePromises.get(capturer);
    if (existing) {
      return existing;
    }
    const release = this.releaseCapturerOnce(capturer, skipStop);
    this.releasePromises.set(capturer, release);
    void release
      .finally(() => {
        if (this.releasePromises.get(capturer) === release) {
          this.releasePromises.delete(capturer);
        }
      })
      .catch(() => undefined);
    return release;
  }

  private async releaseCapturerOnce(
    capturer: audio.AudioCapturer,
    skipStop: boolean,
  ): Promise<void> {
    try {
      capturer.off('readData');
    } catch (_) {
    }
    try {
      capturer.off('audioInterrupt');
    } catch (_) {
    }
    if (!skipStop) {
      await this.stopCapturer(capturer);
    }
    if (
      capturer.state === audio.AudioState.STATE_NEW ||
      capturer.state === audio.AudioState.STATE_RELEASED
    ) {
      return;
    }
    try {
      await capturer.release();
    } catch (error) {
      throw error as Error;
    }
  }

  private canStart(state: audio.AudioState): boolean {
    return (
      state === audio.AudioState.STATE_PREPARED ||
      state === audio.AudioState.STATE_PAUSED ||
      state === audio.AudioState.STATE_STOPPED
    );
  }

  private canStop(state: audio.AudioState): boolean {
    return (
      state === audio.AudioState.STATE_RUNNING ||
      state === audio.AudioState.STATE_PAUSED
    );
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const pending = this.lifecycleTail.then(operation, operation);
    this.lifecycleTail = pending.catch(() => undefined);
    return pending;
  }

  private handleData(capturer: audio.AudioCapturer, data: ArrayBuffer): void {
    if (capturer !== this.capturer || !this.desiredRecording) {
      return;
    }
    const bytes = Array.from(new Uint8Array(data));
    const payload: MicrophoneDataPayload = { data: bytes };
    this.emit('onMicrophoneData', payload);
  }

  private handleInterruption(
    capturer: audio.AudioCapturer,
    event: audio.InterruptEvent,
  ): void {
    if (capturer !== this.capturer) {
      return;
    }
    if (event.eventType === audio.InterruptType.INTERRUPT_TYPE_BEGIN) {
      this.emitInterruption('began');
    }
  }

  private emitInterruption(value: string): void {
    const payload: AudioInterruptionPayload = { data: value };
    this.emit('onAudioInterruption', payload);
  }
}
