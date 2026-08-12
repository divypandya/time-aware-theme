import { normalizeMinute, resolveThemeSnapshot, type ThemeAppearance, type ThemeMode, type ThemeSnapshot, type ThemeSystem } from './core.js';

export interface Clock {
  now(): Date;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AnimationScheduler {
  requestAnimationFrame(callback: (timestamp: number) => void): unknown;
  cancelAnimationFrame(handle: unknown): void;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ThemeControllerOptions<TPhase extends string = string> {
  readonly system: ThemeSystem<TPhase>;
  readonly clock?: Clock;
  readonly document?: Document | null;
  readonly window?: Window | null;
  readonly storage?: StorageLike | null;
  readonly scheduler?: AnimationScheduler | null;
  readonly storageKey?: string;
  readonly cssVariablePrefix?: string;
  readonly defaultMode?: ThemeMode;
}

export interface ThemeControllerSnapshot<TPhase extends string = string> {
  readonly mode: ThemeMode;
  readonly appearance: 'light' | 'dark';
  readonly phase: TPhase | 'static';
}

export interface ThemeController<TPhase extends string = string> {
  readonly start: () => ThemeControllerSnapshot<TPhase>;
  readonly dispose: () => void;
  readonly setMode: (mode: ThemeMode) => void;
  readonly setPreviewMinute: (minute: number | null) => void;
  readonly clearPreview: () => void;
  readonly getSnapshot: () => ThemeControllerSnapshot<TPhase>;
  readonly subscribe: (listener: (snapshot: ThemeControllerSnapshot<TPhase>) => void) => () => void;
}

const DEFAULT_STORAGE_KEY = 'time-aware-theme:mode';
const DEFAULT_PREFIX = 'tat';

export function createThemeController<TPhase extends string = string>(
  options: ThemeControllerOptions<TPhase>
): ThemeController<TPhase> {
  const clock = options.clock ?? systemClock;
  const doc = options.document ?? null;
  const win = options.window ?? doc?.defaultView ?? null;
  const storage = options.storage ?? safeStorageFromWindow(win);
  const scheduler = options.scheduler ?? createScheduler(win);
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const prefix = options.cssVariablePrefix ?? DEFAULT_PREFIX;

  let started = false;
  let disposed = false;
  let mode: ThemeMode = options.defaultMode ?? detectPreferredMode(win) ?? 'light';
  let previewMinute: number | null = null;
  let liveMinute = normalizeMinute(clock.now().getHours() * 60 + clock.now().getMinutes());
  let minuteTimer: unknown = null;
  let rafHandle: unknown = null;
  let rafQueued = false;
  let offsetMinutes = clock.now().getTimezoneOffset();
  let lastAppliedCssText = '';
  let lastAppliedAppearance: ThemeAppearance | null = null;
  let currentSnapshot = freezeControllerSnapshot({
    mode,
    appearance: mode === 'dark' ? 'dark' : 'light',
    phase: 'static'
  }) as ThemeControllerSnapshot<TPhase>;
  const listeners = new Set<(snapshot: ThemeControllerSnapshot<TPhase>) => void>();
  const detachListeners: Array<() => void> = [];

  function start(): ThemeControllerSnapshot<TPhase> {
    if (disposed) {
      throw new Error('Theme controller has been disposed.');
    }
    if (started) {
      return currentSnapshot;
    }

    started = true;
    mode = loadModeFromStorage(storage, storageKey) ?? options.defaultMode ?? detectPreferredMode(win) ?? 'light';
    previewMinute = null;
    updateFromCurrentTime('start');
    if (mode === 'time-aware') {
      attachTimeAwareListeners();
      scheduleNextMinute();
    }
    return currentSnapshot;
  }

  function dispose(): void {
    if (disposed) {
      return;
    }
    disposed = true;
    started = false;
    clearMinuteTimer();
    clearRaf();
    while (detachListeners.length > 0) {
      const detach = detachListeners.pop();
      detach?.();
    }
    listeners.clear();
  }

  function setMode(nextMode: ThemeMode): void {
    assertNotDisposed();
    assertValidMode(nextMode);

    mode = nextMode;
    previewMinute = null;
    persistMode(storage, storageKey, nextMode);
    updateFromCurrentTime('setMode');
    if (mode === 'time-aware') {
      attachTimeAwareListeners();
      scheduleNextMinute();
    } else {
      clearMinuteTimer();
      detachTimeAwareListeners();
    }
  }

  function setPreviewMinute(minute: number | null): void {
    assertNotDisposed();
    if (mode !== 'time-aware') {
      return;
    }

    previewMinute = minute === null ? null : normalizeMinute(minute);
    scheduleRafUpdate();
  }

  function clearPreview(): void {
    assertNotDisposed();
    if (previewMinute === null) {
      return;
    }
    previewMinute = null;
    scheduleRafUpdate();
  }

  function getSnapshot(): ThemeControllerSnapshot<TPhase> {
    return currentSnapshot;
  }

  function subscribe(listener: (snapshot: ThemeControllerSnapshot<TPhase>) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function updateFromCurrentTime(reason: string): void {
    if (!started || disposed) {
      return;
    }

    const now = clock.now();
    const currentOffset = now.getTimezoneOffset();
    const normalizedLiveMinute = normalizeMinute(now.getHours() * 60 + now.getMinutes());

    if (mode === 'time-aware') {
      liveMinute = normalizedLiveMinute;
    }

    if (currentOffset !== offsetMinutes) {
      offsetMinutes = currentOffset;
      if (mode === 'time-aware') {
        scheduleNextMinute();
      }
    }

    applyResolvedState(reason);
  }

  function applyResolvedState(reason: string): void {
    const effectiveMinute = previewMinute ?? liveMinute;
    const resolved = resolveThemeSnapshot(options.system, mode, effectiveMinute);
    const nextSummary = freezeControllerSnapshot({
      mode,
      appearance: resolved.appearance,
      phase: resolved.phase
    });

    if (!snapshotEquals(currentSnapshot, nextSummary)) {
      currentSnapshot = nextSummary as ThemeControllerSnapshot<TPhase>;
      emitSnapshot();
    }

    applyToDom(resolved);

    if (mode !== 'time-aware') {
      clearMinuteTimer();
      detachTimeAwareListeners();
      void reason;
    }
  }

  function emitSnapshot(): void {
    for (const listener of listeners) {
      listener(currentSnapshot);
    }
  }

  function applyToDom(snapshot: ThemeSnapshot<TPhase>): void {
    if (!doc?.documentElement) {
      return;
    }

    const root = doc.documentElement;

    if (
      snapshot.cssText === lastAppliedCssText &&
      snapshot.appearance === lastAppliedAppearance &&
      snapshot.mode === root.dataset.themeMode &&
      String(snapshot.phase) === root.dataset.themePhase
    ) {
      return;
    }

    const style = root.style;
    for (const key of options.system.tokenKeys) {
      style.setProperty(`--${prefix}-${key}`, serializeToken(snapshot.tokens[key] ?? failMissingToken(key)));
    }
    root.classList.toggle('dark', snapshot.appearance === 'dark');
    style.setProperty('color-scheme', snapshot.appearance);
    root.dataset.themeMode = snapshot.mode;
    root.dataset.themePhase = String(snapshot.phase);
    lastAppliedCssText = snapshot.cssText;
    lastAppliedAppearance = snapshot.appearance;
  }

  function scheduleNextMinute(): void {
    clearMinuteTimer();
    if (mode !== 'time-aware' || disposed || !started) {
      return;
    }

    const now = clock.now();
    const msIntoMinute = now.getSeconds() * 1000 + now.getMilliseconds();
    const delay = msIntoMinute === 0 ? 60_000 : 60_000 - msIntoMinute;
    minuteTimer = clock.setTimeout(() => {
      minuteTimer = null;
      updateFromCurrentTime('minute');
      scheduleNextMinute();
    }, delay);
  }

  function scheduleRafUpdate(): void {
    if (rafQueued) {
      return;
    }
    rafQueued = true;

    const run = () => {
      rafQueued = false;
      rafHandle = null;
      updateFromCurrentTime('raf');
      if (mode === 'time-aware') {
        scheduleNextMinute();
      }
    };

    if (scheduler) {
      rafHandle = scheduler.requestAnimationFrame(() => run());
    } else {
      rafHandle = clock.setTimeout(run, 16);
    }
  }

  function clearMinuteTimer(): void {
    if (minuteTimer !== null) {
      clock.clearTimeout(minuteTimer);
      minuteTimer = null;
    }
  }

  function clearRaf(): void {
    if (rafHandle !== null && scheduler) {
      scheduler.cancelAnimationFrame(rafHandle);
      rafHandle = null;
    } else if (rafHandle !== null) {
      clock.clearTimeout(rafHandle);
      rafHandle = null;
    }
    rafQueued = false;
  }

  function attachTimeAwareListeners(): void {
    if (!win || !doc || detachListeners.length > 0) {
      return;
    }

    const onVisibilityChange = (): void => {
      if (doc.visibilityState === 'visible') {
        updateFromCurrentTime('visibilitychange');
        scheduleNextMinute();
      }
    };
    const onPageShow = (): void => {
      updateFromCurrentTime('pageshow');
      scheduleNextMinute();
    };
    const onFocus = (): void => {
      updateFromCurrentTime('focus');
      scheduleNextMinute();
    };
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== storageKey) {
        return;
      }
      const stored = loadModeFromStorage(storage, storageKey);
      if (stored && stored !== mode) {
        mode = stored;
        previewMinute = null;
        updateFromCurrentTime('storage');
        if (mode !== 'time-aware') {
          clearMinuteTimer();
          detachTimeAwareListeners();
        }
      }
    };

    doc.addEventListener('visibilitychange', onVisibilityChange);
    win.addEventListener('pageshow', onPageShow);
    win.addEventListener('focus', onFocus);
    win.addEventListener('storage', onStorage);

    detachListeners.push(() => doc.removeEventListener('visibilitychange', onVisibilityChange));
    detachListeners.push(() => win.removeEventListener('pageshow', onPageShow));
    detachListeners.push(() => win.removeEventListener('focus', onFocus));
    detachListeners.push(() => win.removeEventListener('storage', onStorage));
  }

  function detachTimeAwareListeners(): void {
    while (detachListeners.length > 0) {
      const detach = detachListeners.pop();
      detach?.();
    }
  }

  function assertNotDisposed(): void {
    if (disposed) {
      throw new Error('Theme controller has been disposed.');
    }
  }

  function assertValidMode(candidate: string): asserts candidate is ThemeMode {
    if (candidate !== 'light' && candidate !== 'dark' && candidate !== 'time-aware') {
      throw new TypeError(`Invalid theme mode: ${candidate}`);
    }
  }

  function snapshotEquals(
    left: ThemeControllerSnapshot<TPhase>,
    right: ThemeControllerSnapshot<TPhase>
  ): boolean {
    return left.mode === right.mode && left.appearance === right.appearance && left.phase === right.phase;
  }

  return {
    start,
    dispose,
    setMode,
    setPreviewMinute,
    clearPreview,
    getSnapshot,
    subscribe
  };
}

function serializeToken(color: { readonly l: number; readonly c: number; readonly h: number | null; readonly alpha: number }): string {
  return `oklch(${formatNumber(color.l)} ${formatNumber(color.c)} ${color.h === null ? 'none' : formatNumber(color.h)} / ${formatNumber(color.alpha)})`;
}

function failMissingToken(key: string): never {
  throw new TypeError(`Missing token "${key}".`);
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 100000) / 100000;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(5).replace(/0+$/, '').replace(/\.$/, '');
  return text === '-0' ? '0' : text;
}

function freezeControllerSnapshot<TPhase extends string>(snapshot: ThemeControllerSnapshot<TPhase>): ThemeControllerSnapshot<TPhase> {
  return Object.freeze({ ...snapshot });
}

function safeStorageFromWindow(win: Window | null): StorageLike | null {
  try {
    return win?.localStorage ?? null;
  } catch {
    return null;
  }
}

function loadModeFromStorage(storage: StorageLike | null, key: string): ThemeMode | null {
  if (!storage) {
    return null;
  }

  try {
    const value = storage.getItem(key);
    if (value === 'light' || value === 'dark' || value === 'time-aware') {
      return value;
    }
  } catch {
    return null;
  }
  return null;
}

function persistMode(storage: StorageLike | null, key: string, mode: ThemeMode): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(key, mode);
  } catch {
    // ignored by design
  }
}

function detectPreferredMode(win: Window | null): ThemeMode | null {
  try {
    if (win?.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    if (win?.matchMedia) {
      return 'light';
    }
  } catch {
    return null;
  }
  return null;
}

function createScheduler(win: Window | null): AnimationScheduler | null {
  if (win?.requestAnimationFrame && win.cancelAnimationFrame) {
    return {
      requestAnimationFrame: (callback) => win.requestAnimationFrame(callback),
      cancelAnimationFrame: (handle) => win.cancelAnimationFrame(handle as number)
    };
  }

  return null;
}

const systemClock: Clock = {
  now: () => new Date(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as number)
};
