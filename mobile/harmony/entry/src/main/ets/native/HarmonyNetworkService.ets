import { connection } from '@kit.NetworkKit';
import type { BusinessError } from '@kit.BasicServicesKit';

export interface HarmonyNetworkState {
  isConnected: boolean;
  isInternetReachable: boolean;
  type: string;
}

export class HarmonyNetworkService {
  private destroyed = false;
  private publicationGeneration = 0;
  private lastPublished: HarmonyNetworkState | null = null;
  private readonly netConnection = connection.createNetConnection();
  private readonly emit: (eventName: string, payload: Object) => void;
  private readonly networkCallback = (error: BusinessError): void => {
    if (error) {
      this.publishObserved(this.unknown());
      return;
    }
    this.publishCurrent();
  };

  constructor(emit: (eventName: string, payload: Object) => void) {
    this.emit = emit;
    this.netConnection.on('netAvailable', () => this.publishCurrent());
    this.netConnection.on('netLost', () => {
      this.publishObserved(this.disconnected());
      this.publishCurrent(false);
    });
    this.netConnection.on('netUnavailable', () => this.publishObserved(this.disconnected()));
    this.netConnection.on('netCapabilitiesChange', (info) => {
      this.publishObserved(this.fromCapabilities(info.netCap));
    });
    try {
      this.netConnection.register(this.networkCallback);
    } catch (_) {
      this.publishObserved(this.unknown());
    }
  }

  async getState(): Promise<HarmonyNetworkState> {
    try {
      return await this.readCurrentState();
    } catch (_) {
      return this.unknown();
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.publicationGeneration += 1;
    try {
      this.netConnection.unregister(this.networkCallback);
    } catch (_) {
    }
  }

  private async readCurrentState(): Promise<HarmonyNetworkState> {
    const handle = await connection.getDefaultNet();
    return this.fromCapabilities(await connection.getNetCapabilities(handle));
  }

  private publishCurrent(publishFailure = true): void {
    const generation = this.nextPublicationGeneration();
    void this.readCurrentState().then(
      (state) => {
        if (generation === this.publicationGeneration) {
          this.emitState(state);
        }
      },
      () => {
        if (publishFailure && generation === this.publicationGeneration) {
          this.emitState(this.unknown());
        }
      },
    );
  }

  private publishObserved(state: HarmonyNetworkState): void {
    this.nextPublicationGeneration();
    this.emitState(state);
  }

  private nextPublicationGeneration(): number {
    this.publicationGeneration += 1;
    return this.publicationGeneration;
  }

  private emitState(state: HarmonyNetworkState): void {
    if (this.destroyed) {
      return;
    }
    if (this.lastPublished && this.sameState(this.lastPublished, state)) {
      return;
    }
    this.lastPublished = state;
    this.emit('OrcaHarmonyNetworkChange', state);
  }

  private sameState(a: HarmonyNetworkState, b: HarmonyNetworkState): boolean {
    return a.isConnected === b.isConnected &&
      a.isInternetReachable === b.isInternetReachable &&
      a.type === b.type;
  }

  private disconnected(): HarmonyNetworkState {
    const state: HarmonyNetworkState = {
      isConnected: false,
      isInternetReachable: false,
      type: 'NONE',
    };
    return state;
  }

  private unknown(): HarmonyNetworkState {
    const state: HarmonyNetworkState = {
      isConnected: false,
      isInternetReachable: false,
      type: 'UNKNOWN',
    };
    return state;
  }

  private fromCapabilities(capabilities: connection.NetCapabilities): HarmonyNetworkState {
    const networkCapabilities = capabilities.networkCap ?? [];
    const state: HarmonyNetworkState = {
      isConnected: true,
      isInternetReachable:
      networkCapabilities.includes(connection.NetCap.NET_CAPABILITY_VALIDATED),
      type: this.networkType(capabilities.bearerTypes),
    };
    return state;
  }

  private networkType(bearerTypes: connection.NetBearType[]): string {
    if (bearerTypes.includes(connection.NetBearType.BEARER_WIFI)) {
      return 'WIFI';
    }
    if (bearerTypes.includes(connection.NetBearType.BEARER_CELLULAR)) {
      return 'CELLULAR';
    }
    if (bearerTypes.includes(connection.NetBearType.BEARER_ETHERNET)) {
      return 'ETHERNET';
    }
    if (bearerTypes.includes(connection.NetBearType.BEARER_VPN)) {
      return 'VPN';
    }
    if (bearerTypes.includes(connection.NetBearType.BEARER_BLUETOOTH)) {
      return 'BLUETOOTH';
    }
    return 'UNKNOWN';
  }
}
