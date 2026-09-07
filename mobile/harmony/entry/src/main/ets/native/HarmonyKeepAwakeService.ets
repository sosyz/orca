import { window } from '@kit.ArkUI';
import type { common } from '@kit.AbilityKit';

export class HarmonyKeepAwakeService {
  private applyTail: Promise<void> = Promise.resolve();
  private foreground = true;
  private readonly owners = new Set<string>();
  private readonly context: common.UIAbilityContext;

  constructor(context: common.UIAbilityContext) {
    this.context = context;
  }

  async activate(tag: string): Promise<void> {
    const alreadyActive = this.owners.has(tag);
    this.owners.add(tag);
    try {
      await this.enqueueApply();
    } catch (error) {
      const activationError = error as Error;
      if (!alreadyActive) {
        this.owners.delete(tag);
        await this.enqueueApply().catch(() => undefined);
      }
      throw activationError;
    }
  }

  async deactivate(tag: string): Promise<void> {
    this.owners.delete(tag);
    await this.enqueueApply();
  }

  async clear(): Promise<void> {
    this.owners.clear();
    await this.enqueueApply();
  }

  async setForeground(foreground: boolean): Promise<void> {
    this.foreground = foreground;
    await this.enqueueApply();
  }

  private enqueueApply(): Promise<void> {
    const pending = this.applyTail.then(() => this.apply(), () => this.apply());
    this.applyTail = pending.catch(() => undefined);
    return pending;
  }

  private async apply(): Promise<void> {
    const mainWindow = await window.getLastWindow(this.context);
    await mainWindow.setWindowKeepScreenOn(this.foreground && this.owners.size > 0);
  }
}
