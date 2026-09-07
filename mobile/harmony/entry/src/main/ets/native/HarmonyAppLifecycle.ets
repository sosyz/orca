export interface HarmonyAppLifecycleListener {
  onHarmonyBackground(): void;
  onHarmonyForeground(): void;
}

export class HarmonyAppLifecycle {
  private static foreground = true;
  private static listenerSequence = 0;
  private static readonly listeners = new Map<number, HarmonyAppLifecycleListener>();

  static attach(listener: HarmonyAppLifecycleListener): number {
    const token = ++HarmonyAppLifecycle.listenerSequence;
    HarmonyAppLifecycle.listeners.set(token, listener);
    if (!HarmonyAppLifecycle.foreground) {
      listener.onHarmonyBackground();
    }
    return token;
  }

  static detach(token: number): void {
    HarmonyAppLifecycle.listeners.delete(token);
  }

  static enterForeground(): void {
    HarmonyAppLifecycle.foreground = true;
    HarmonyAppLifecycle.listeners.forEach((listener) => listener.onHarmonyForeground());
  }

  static enterBackground(): void {
    HarmonyAppLifecycle.foreground = false;
    HarmonyAppLifecycle.listeners.forEach((listener) => listener.onHarmonyBackground());
  }
}
