import { window } from '@kit.ArkUI';
import type { common } from '@kit.AbilityKit';

interface KeepAwakeCoordinator {
  applyTail: Promise<void>;
  owners: Set<HarmonyKeepAwakeService>;
}

export class HarmonyKeepAwakeService {
  private static readonly coordinators = new WeakMap<common.UIAbilityContext, KeepAwakeCoordinator>();
  private readonly coordinator: KeepAwakeCoordinator;
  private foreground = true;
  private readonly owners = new Set<string>();
  private readonly ownerTokens = new Map<string, number>();
  private nextOwnerToken = 0;
  private readonly context: common.UIAbilityContext;

  constructor(context: common.UIAbilityContext) {
    this.context = context;
    let coordinator = HarmonyKeepAwakeService.coordinators.get(context);
    if (!coordinator) {
      coordinator = { applyTail: Promise.resolve(), owners: new Set<HarmonyKeepAwakeService>() };
      HarmonyKeepAwakeService.coordinators.set(context, coordinator);
    }
    this.coordinator = coordinator;
  }

  async activate(tag: string): Promise<void> {
    const alreadyActive = this.owners.has(tag);
    const token = ++this.nextOwnerToken;
    this.owners.add(tag);
    this.ownerTokens.set(tag, token);
    this.coordinator.owners.add(this);
    try {
      await this.enqueueApply();
    } catch (error) {
      const activationError = error as Error;
      if (!alreadyActive && this.ownerTokens.get(tag) === token) {
        this.owners.delete(tag);
        this.ownerTokens.delete(tag);
        if (this.owners.size === 0) {
          this.coordinator.owners.delete(this);
        }
        await this.enqueueApply().catch(() => undefined);
      }
      throw activationError;
    }
  }

  async deactivate(tag: string): Promise<void> {
    this.owners.delete(tag);
    this.ownerTokens.delete(tag);
    if (this.owners.size === 0) {
      this.coordinator.owners.delete(this);
    }
    await this.enqueueApply();
  }

  async clear(): Promise<void> {
    this.owners.clear();
    this.ownerTokens.clear();
    this.coordinator.owners.delete(this);
    await this.enqueueApply();
  }

  async setForeground(foreground: boolean): Promise<void> {
    this.foreground = foreground;
    await this.enqueueApply();
  }

  private enqueueApply(): Promise<void> {
    const pending = this.coordinator.applyTail.then(() => this.apply(), () => this.apply());
    this.coordinator.applyTail = pending.catch(() => undefined);
    return pending;
  }

  private async apply(): Promise<void> {
    const mainWindow = await window.getLastWindow(this.context);
    const active = Array.from(this.coordinator.owners).some(
      (owner) => owner.foreground && owner.owners.size > 0,
    );
    await mainWindow.setWindowKeepScreenOn(active);
  }
}
