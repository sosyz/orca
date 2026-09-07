import { buffer, util } from '@kit.ArkTS';
import type { BusinessError } from '@kit.BasicServicesKit';
import { preferences } from '@kit.ArkData';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { huks } from '@kit.UniversalKeystoreKit';
import type { common } from '@kit.AbilityKit';

const KEY_ALIAS = 'orca.mobile.harmony.secure-values.v3';
const LEGACY_KEY_ALIAS = 'orca.mobile.harmony.secure-values.v2';
const PREFERENCES_NAME = 'orca_secure_values_v2';
const ENVELOPE_VERSION = 'v3';
const LEGACY_ENVELOPE_VERSION = 'v2';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const STORAGE_LEVEL = huks.HuksAuthStorageLevel.HUKS_AUTH_STORAGE_LEVEL_ECE;
const HILOG_DOMAIN = 0x0a11;
const HILOG_TAG = 'OrcaSecureStore';
type EnvelopeVersion = 'v2' | 'v3';
interface KeyPresenceCheck {
  aliasCategory: 'v2' | 'v3';
  storageLevel: 'CE' | 'DE' | 'ECE' | 'DEFAULT';
  alias: string;
  options: huks.HuksOptions;
}

interface SecureEnvelope {
  version: EnvelopeVersion;
  nonce: Uint8Array;
  cipherText: Uint8Array;
  authenticationTag: Uint8Array;
}

function keyProperties(storageLevel?: huks.HuksAuthStorageLevel): huks.HuksParam[] {
  const properties: huks.HuksParam[] = [
    { tag: huks.HuksTag.HUKS_TAG_ALGORITHM, value: huks.HuksKeyAlg.HUKS_ALG_AES },
    { tag: huks.HuksTag.HUKS_TAG_KEY_SIZE, value: huks.HuksKeySize.HUKS_AES_KEY_SIZE_256 },
    {
      tag: huks.HuksTag.HUKS_TAG_PURPOSE,
      value:
      huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_ENCRYPT |
      huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_DECRYPT,
    },
  ];
  if (storageLevel !== undefined) {
    properties.push({
      tag: huks.HuksTag.HUKS_TAG_AUTH_STORAGE_LEVEL,
      value: storageLevel,
    });
  }
  return properties;
}

function operationProperties(
  purpose: huks.HuksKeyPurpose,
  nonce: Uint8Array,
  associatedData: Uint8Array,
  authenticationTag?: Uint8Array,
  storageLevel?: huks.HuksAuthStorageLevel,
): huks.HuksParam[] {
  const properties: huks.HuksParam[] = [
    { tag: huks.HuksTag.HUKS_TAG_ALGORITHM, value: huks.HuksKeyAlg.HUKS_ALG_AES },
    { tag: huks.HuksTag.HUKS_TAG_KEY_SIZE, value: huks.HuksKeySize.HUKS_AES_KEY_SIZE_256 },
    { tag: huks.HuksTag.HUKS_TAG_PURPOSE, value: purpose },
    { tag: huks.HuksTag.HUKS_TAG_PADDING, value: huks.HuksKeyPadding.HUKS_PADDING_NONE },
    { tag: huks.HuksTag.HUKS_TAG_BLOCK_MODE, value: huks.HuksCipherMode.HUKS_MODE_GCM },
    { tag: huks.HuksTag.HUKS_TAG_NONCE, value: nonce },
    { tag: huks.HuksTag.HUKS_TAG_ASSOCIATED_DATA, value: associatedData },
  ];
  if (authenticationTag) {
    properties.push({ tag: huks.HuksTag.HUKS_TAG_AE_TAG, value: authenticationTag });
  }
  if (storageLevel !== undefined) {
    properties.push({
      tag: huks.HuksTag.HUKS_TAG_AUTH_STORAGE_LEVEL,
      value: storageLevel,
    });
  }
  return properties;
}

function utf8Bytes(value: string): Uint8Array {
  const encoded = buffer.from(value, 'utf-8');
  return Uint8Array.from(encoded.values());
}

function utf8String(value: Uint8Array): string {
  return buffer.from(value).toString('utf-8');
}

function bridgeError(operation: string, error: Error): Error {
  const nativeError = error as BusinessError;
  const code = typeof nativeError.code === 'number' ? ` (${nativeError.code})` : '';
  const detail = error.message || 'Unknown native error';
  return new Error(`Secure storage ${operation} failed${code}: ${detail}`);
}

function nativeErrorCode(error: Error): number {
  const code = (error as BusinessError).code;
  return typeof code === 'number' ? code : -1;
}

function logHuksCode(operation: string, code: number): void {
  hilog.error(
    HILOG_DOMAIN,
    HILOG_TAG,
    'huks operation=%{public}s code=%{public}d',
    operation,
    code,
  );
}

function logKeyPresence(
  aliasCategory: string,
  storageLevel: string,
  exists: boolean | null,
  code: number,
): void {
  hilog.error(
    HILOG_DOMAIN,
    HILOG_TAG,
    'huks key-presence alias=%{public}s storage=%{public}s exists=%{public}s code=%{public}d',
    aliasCategory,
    storageLevel,
    exists === null ? 'unknown' : String(exists),
    code,
  );
}

async function runHuks<T>(operation: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    logHuksCode(operation, nativeErrorCode(error as Error));
    throw error as Error;
  }
}

export class SecureValueStore {
  private readonly base64 = new util.Base64Helper();
  private readonly preferencesPromise: Promise<preferences.Preferences>;
  private keyReady: Promise<void> | null = null;
  private keyPresenceDiagnosticLogged = false;
  private operationTail: Promise<void> = Promise.resolve();
  private durabilityError: Error | null = null;

  constructor(context: common.UIAbilityContext) {
    this.preferencesPromise = preferences.getPreferences(context, PREFERENCES_NAME);
  }

  async set(key: string, value: string): Promise<void> {
    try {
      await this.enqueueOperation(async () => {
        const store = await this.preferencesPromise;
        const encoded = await this.encryptV3Value(key, value, store);
        await this.putDurably(store, key, encoded);
      });
    } catch (error) {
      throw bridgeError('write', error as Error);
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.enqueueOperation(async () => {
        this.throwIfDurabilityUncertain();
        const store = await this.preferencesPromise;
        const encoded = await store.get(key, '');
        if (typeof encoded !== 'string' || encoded.length === 0) {
          return null;
        }
        const envelope = this.parseEnvelope(encoded);
        const legacy = envelope.version === LEGACY_ENVELOPE_VERSION;
        if (legacy) {
          const legacyOptions: huks.HuksOptions = { properties: keyProperties() };
          if (!(await runHuks('read-legacy-key-presence', () =>
            huks.hasKeyItem(LEGACY_KEY_ALIAS, legacyOptions)))) {
            throw new Error('Legacy HUKS key is unavailable');
          }
        } else {
          await this.requireKey();
        }
        let value: string;
        try {
          value = await this.decrypt(
            legacy ? LEGACY_KEY_ALIAS : KEY_ALIAS,
            envelope.version,
            key,
            envelope.cipherText,
            envelope.authenticationTag,
            envelope.nonce,
            legacy ? undefined : STORAGE_LEVEL,
          );
        } catch (error) {
          await this.logKeyPresenceDiagnosticOnce().catch(() => {});
          throw error as Error;
        }
        if (legacy) {
          await this.migrateLegacyValue(store, key, encoded, value);
        }
        return value;
      });
    } catch (error) {
      throw bridgeError('read', error as Error);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.enqueueOperation(async () => {
        const store = await this.preferencesPromise;
        await this.deleteDurably(store, key);
      });
    } catch (error) {
      throw bridgeError('delete', error as Error);
    }
  }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.operationTail.then(operation, operation);
    this.operationTail = pending.then(() => {}, () => {});
    return pending;
  }

  private markDurabilityUncertain(error: Error): void {
    this.durabilityError = error;
  }

  private markDurabilityConfirmed(): void {
    this.durabilityError = null;
  }

  private throwIfDurabilityUncertain(): void {
    if (this.durabilityError) {
      throw this.durabilityError;
    }
  }

  private async putDurably(
    store: preferences.Preferences,
    key: string,
    value: string,
  ): Promise<void> {
    const current = await store.get(key, '');
    if (current === value) {
      this.throwIfDurabilityUncertain();
      return;
    }
    try {
      await store.put(key, value);
      await store.flush();
      this.markDurabilityConfirmed();
    } catch (error) {
      this.markDurabilityUncertain(error as Error);
      throw error as Error;
    }
  }

  private async deleteDurably(store: preferences.Preferences, key: string): Promise<void> {
    if (!(await store.has(key))) {
      this.throwIfDurabilityUncertain();
      return;
    }
    try {
      await store.delete(key);
      await store.flush();
      this.markDurabilityConfirmed();
    } catch (error) {
      this.markDurabilityUncertain(error as Error);
      throw error as Error;
    }
  }

  private parseEnvelope(encoded: string): SecureEnvelope {
    const segments = encoded.split('.');
    if (
      segments.length !== 3 ||
      (segments[0] !== ENVELOPE_VERSION && segments[0] !== LEGACY_ENVELOPE_VERSION)
    ) {
      throw new Error('Secure value has an invalid envelope');
    }
    const nonce = this.base64.decodeSync(segments[1]);
    const encrypted = this.base64.decodeSync(segments[2]);
    if (nonce.length !== NONCE_BYTES || encrypted.length < TAG_BYTES) {
      throw new Error('Secure value has an invalid envelope');
    }
    return {
      version: segments[0] as EnvelopeVersion,
      nonce,
      cipherText: encrypted.slice(0, encrypted.length - TAG_BYTES),
      authenticationTag: encrypted.slice(encrypted.length - TAG_BYTES),
    };
  }

  private async ensureKeyForWrite(store: preferences.Preferences): Promise<void> {
    if (!this.keyReady) {
      this.keyReady = this.prepareKeyForWrite(store);
    }
    try {
      await this.keyReady;
    } catch (error) {
      this.keyReady = null;
      throw error as Error;
    }
  }

  private async prepareKeyForWrite(store: preferences.Preferences): Promise<void> {
    const options: huks.HuksOptions = { properties: keyProperties(STORAGE_LEVEL) };
    if (!(await runHuks('write-key-presence', () => huks.hasKeyItem(KEY_ALIAS, options)))) {
      if (await this.hasStoredV3Envelope(store)) {
        logHuksCode('write-key-missing-with-v3', 0);
        throw new Error('HUKS key is unavailable while v3 secure values exist');
      }
      await runHuks('write-key-generate', () => huks.generateKeyItem(KEY_ALIAS, options));
    }
  }

  private async requireKey(): Promise<void> {
    const options: huks.HuksOptions = { properties: keyProperties(STORAGE_LEVEL) };
    if (!(await runHuks('read-key-presence', () => huks.hasKeyItem(KEY_ALIAS, options)))) {
      logHuksCode('read-key-missing', 0);
      throw new Error('HUKS key is unavailable');
    }
  }

  private async hasStoredV3Envelope(store: preferences.Preferences): Promise<boolean> {
    const values = (await store.getAll()) as Record<string, preferences.ValueType>;
    const keys = Object.keys(values);
    for (const key of keys) {
      const value = values[key];
      if (typeof value === 'string' && value.startsWith(`${ENVELOPE_VERSION}.`)) {
        return true;
      }
    }
    return false;
  }

  private async encryptV3Value(
    key: string,
    value: string,
    store: preferences.Preferences,
  ): Promise<string> {
    await this.ensureKeyForWrite(store);
    const nonce = cryptoFramework.createRandom().generateRandomSync(NONCE_BYTES).data;
    const properties = operationProperties(
      huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_ENCRYPT,
      nonce,
      utf8Bytes(key),
      undefined,
      STORAGE_LEVEL,
    );
    const session = await runHuks('write-init', () =>
      huks.initSession(KEY_ALIAS, { properties: properties }));
    const result = await this.finishHuksSession('write-finish', session.handle, {
      properties: properties,
      inData: utf8Bytes(value),
    });
    if (!result.outData) {
      throw new Error('HUKS returned no encrypted data');
    }
    return `${ENVELOPE_VERSION}.${this.base64.encodeToStringSync(nonce)}.${this.base64.encodeToStringSync(result.outData)}`;
  }

  private async migrateLegacyValue(
    store: preferences.Preferences,
    key: string,
    originalEncoded: string,
    value: string,
  ): Promise<void> {
    const migrated = await this.encryptV3Value(key, value, store);
    try {
      await this.putDurably(store, key, migrated);
    } catch (error) {
      try {
        await this.restoreStoredValue(store, key, originalEncoded);
        this.markDurabilityConfirmed();
      } catch (_) {
      }
      throw error as Error;
    }
  }

  private async restoreStoredValue(
    store: preferences.Preferences,
    key: string,
    value: string,
  ): Promise<void> {
    const current = await store.get(key, '');
    if (current === value) {
      this.markDurabilityConfirmed();
      return;
    }
    await store.put(key, value);
    await store.flush();
    this.markDurabilityConfirmed();
  }

  private async logKeyPresenceDiagnosticOnce(): Promise<void> {
    if (this.keyPresenceDiagnosticLogged) {
      return;
    }
    this.keyPresenceDiagnosticLogged = true;
    const checks: KeyPresenceCheck[] = [
      {
        aliasCategory: 'v3',
        storageLevel: 'ECE',
        alias: KEY_ALIAS,
        options: {
          properties: keyProperties(huks.HuksAuthStorageLevel.HUKS_AUTH_STORAGE_LEVEL_ECE),
        },
      },
      {
        aliasCategory: 'v3',
        storageLevel: 'CE',
        alias: KEY_ALIAS,
        options: {
          properties: keyProperties(huks.HuksAuthStorageLevel.HUKS_AUTH_STORAGE_LEVEL_CE),
        },
      },
      {
        aliasCategory: 'v3',
        storageLevel: 'DE',
        alias: KEY_ALIAS,
        options: {
          properties: keyProperties(huks.HuksAuthStorageLevel.HUKS_AUTH_STORAGE_LEVEL_DE),
        },
      },
      {
        aliasCategory: 'v2',
        storageLevel: 'DEFAULT',
        alias: LEGACY_KEY_ALIAS,
        options: { properties: keyProperties() },
      },
    ];
    for (const check of checks) {
      try {
        const exists = await huks.hasKeyItem(check.alias, check.options);
        logKeyPresence(check.aliasCategory, check.storageLevel, exists, 0);
      } catch (error) {
        logKeyPresence(
          check.aliasCategory,
          check.storageLevel,
          null,
          nativeErrorCode(error as Error),
        );
      }
    }
  }

  private async decrypt(
    alias: string,
    envelopeVersion: EnvelopeVersion,
    key: string,
    cipherText: Uint8Array,
    authenticationTag: Uint8Array,
    nonce: Uint8Array,
    storageLevel?: huks.HuksAuthStorageLevel,
  ): Promise<string> {
    const properties = operationProperties(
      huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_DECRYPT,
      nonce,
      utf8Bytes(key),
      authenticationTag,
      storageLevel,
    );
    const session = await runHuks(`read-${envelopeVersion}-decrypt-init`, () =>
      huks.initSession(alias, { properties: properties }));
    const result = await this.finishHuksSession(
      `read-${envelopeVersion}-decrypt-finish`,
      session.handle,
      {
        properties: properties,
        inData: cipherText,
      },
    );
    if (!result.outData) {
      throw new Error('HUKS returned no decrypted data');
    }
    return utf8String(result.outData);
  }

  private async finishHuksSession(
    operation: string,
    handle: number,
    options: huks.HuksOptions,
  ): Promise<huks.HuksReturnResult> {
    let completed = false;
    try {
      const result = await runHuks(operation, () => huks.finishSession(handle, options));
      completed = true;
      return result;
    } finally {
      if (!completed) {
        try {
          await runHuks(`${operation}-abort`, () =>
            huks.abortSession(handle, { properties: options.properties }));
        } catch (_) {
        }
      }
    }
  }
}
