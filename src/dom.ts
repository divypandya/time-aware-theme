import {
  normalizeMinute,
  resolveThemeSnapshot,
  type ThemeAppearance,
  type ThemeMode,
  type ThemeSnapshot,
  type ThemeSystem
} from './core.js';

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
  /**
   * Namespace for emitted custom properties.
   *
   * - `'tat'` (default) -> `--tat-background`
   * - `'color'` -> `--color-background`, which matches Tailwind v4's native
   *   `@theme` namespace and needs no `@theme inline` remapping
   * - `null` -> bare `--background`; you own the namespace and are responsible
   *   for collisions
   */
  readonly cssVariablePrefix?: string | null;
  readonly defaultMode?: ThemeMode;
  /**
   * Element receiving custom properties and the `.dark` class.
   * Defaults to `document.documentElement`.
   */
  readonly target?: HTMLElement | null;
  /**
   * Marks this controller as a secondary, display-only instance.
   *
   * Scoped controllers do not persist mode, do not attach window listeners,
   * and do not write `color-scheme` — they render a theme into a subtree
   * without claiming ownership of global state. Inferred automatically when
   * `target` is not the document element.
   */
  readonly scoped?: boolean;
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
  readonly subscribe: (
    listener: (snapshot: ThemeControllerSnapshot<TPhase>) => void
  ) => () => void;
}

const DEFAULT_STORAGE_KEY = 'time-aware-theme:mode';
const DEFAULT_PREFIX = 'tat';

export function createThemeController<TPhase extends string = string>(
  options: ThemeControllerOptions<TPhase>
): ThemeController<TPhase> {
  const clock = options.clock ?? systemClock;
  const doc = options.document ?? null;
  // These three are typed `| null` so a caller can explicitly opt out. Using
  // `??` here would treat an explicit null as "unset" and hand back the very
  // default the caller was trying to refuse, so distinguish undefined instead.
  const win =
    options.window === undefined ? (doc?.defaultView ?? null) : options.window;
  const storage =
    options.storage === undefined
      ? safeStorageFromWindow(win)
      : options.storage;
  const scheduler =
    options.scheduler === undefined ? createScheduler(win) : options.scheduler;
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const prefix =
    options.cssVariablePrefix === undefined
      ? DEFAULT_PREFIX
      : options.cssVariablePrefix;
  const target = options.target ?? doc?.documentElement ?? null;
  const scoped =
    options.scoped ?? (target !== null && target !== doc?.documentElement);

  let started = false;
  let disposed = false;
  let mode: ThemeMode =
    options.defaultMode ?? detectPreferredMode(win) ?? 'light';
  let previewMinute: number | null = null;
  let liveMinute = normalizeMinute(
    clock.now().getHours() * 60 + clock.now().getMinutes()
  );
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
  const listeners = new Set<
    (snapshot: ThemeControllerSnapshot<TPhase>) => void
  >();
  const detachListeners: (() => void)[] = [];

  function start(): ThemeControllerSnapshot<TPhase> {
    if (disposed) {
      throw new Error('Theme controller has been disposed.');
    }
    if (started) {
      return currentSnapshot;
    }

    started = true;
    mode =
      (scoped ? null : loadModeFromStorage(storage, storageKey)) ??
      options.defaultMode ??
      detectPreferredMode(win) ??
      'light';
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
    if (!scoped) {
      persistMode(storage, storageKey, nextMode);
    }
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

  function subscribe(
    listener: (snapshot: ThemeControllerSnapshot<TPhase>) => void
  ): () => void {
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
    const normalizedLiveMinute = normalizeMinute(
      now.getHours() * 60 + now.getMinutes()
    );

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
    const resolved = resolveThemeSnapshot(
      options.system,
      mode,
      effectiveMinute
    );
    const nextSummary = freezeControllerSnapshot({
      mode,
      appearance: resolved.appearance,
      phase: resolved.phase
    });

    if (!snapshotEquals(currentSnapshot, nextSummary)) {
      currentSnapshot = nextSummary;
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
    if (!target) {
      return;
    }

    const root = target;

    if (
      snapshot.cssText === lastAppliedCssText &&
      snapshot.appearance === lastAppliedAppearance &&
      snapshot.mode === root.dataset.themeMode &&
      snapshot.phase === root.dataset.themePhase
    ) {
      return;
    }

    const style = root.style;
    for (const key of options.system.tokenKeys) {
      style.setProperty(
        cssVariableName(prefix, key),
        serializeToken(snapshot.tokens[key] ?? failMissingToken(key))
      );
    }
    root.classList.toggle('dark', snapshot.appearance === 'dark');
    // `color-scheme` governs UA-rendered surfaces (scrollbars, form controls)
    // and is only meaningful at the document root. A scoped instance setting it
    // would alter native control rendering in its subtree for no benefit.
    if (!scoped) {
      style.setProperty('color-scheme', snapshot.appearance);
    }
    root.dataset.themeMode = snapshot.mode;
    root.dataset.themePhase = snapshot.phase;
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
      rafHandle = scheduler.requestAnimationFrame(() => {
        run();
      });
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
    // A scoped instance is display-only: it must not multiply the page's
    // listener count, and it must not react to cross-tab mode changes that
    // belong to the primary controller.
    if (scoped || !win || !doc || detachListeners.length > 0) {
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

    detachListeners.push(() => {
      doc.removeEventListener('visibilitychange', onVisibilityChange);
    });
    detachListeners.push(() => {
      win.removeEventListener('pageshow', onPageShow);
    });
    detachListeners.push(() => {
      win.removeEventListener('focus', onFocus);
    });
    detachListeners.push(() => {
      win.removeEventListener('storage', onStorage);
    });
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
    if (
      candidate !== 'light' &&
      candidate !== 'dark' &&
      candidate !== 'time-aware'
    ) {
      throw new TypeError(`Invalid theme mode: ${candidate}`);
    }
  }

  function snapshotEquals(
    left: ThemeControllerSnapshot<TPhase>,
    right: ThemeControllerSnapshot<TPhase>
  ): boolean {
    return (
      left.mode === right.mode &&
      left.appearance === right.appearance &&
      left.phase === right.phase
    );
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

function cssVariableName(prefix: string | null, key: string): string {
  return prefix === null || prefix === '' ? `--${key}` : `--${prefix}-${key}`;
}

/**
 * Writes a resolved snapshot to an element, with no lifecycle attached.
 *
 * For static previews (swatches, docs demos) that never need to track time.
 * Anything that should follow the clock wants a scoped controller instead.
 */
export function applySnapshotTo<TPhase extends string = string>(
  element: HTMLElement,
  snapshot: ThemeSnapshot<TPhase>,
  options: {
    readonly tokenKeys: readonly string[];
    readonly cssVariablePrefix?: string | null;
  }
): void {
  const prefix =
    options.cssVariablePrefix === undefined
      ? DEFAULT_PREFIX
      : options.cssVariablePrefix;

  for (const key of options.tokenKeys) {
    element.style.setProperty(
      cssVariableName(prefix, key),
      serializeToken(snapshot.tokens[key] ?? failMissingToken(key))
    );
  }
  element.classList.toggle('dark', snapshot.appearance === 'dark');
  element.dataset.themeMode = snapshot.mode;
  element.dataset.themePhase = snapshot.phase;
}

function serializeToken(color: {
  readonly l: number;
  readonly c: number;
  readonly h: number | null;
  readonly alpha: number;
}): string {
  return `oklch(${formatNumber(color.l)} ${formatNumber(color.c)} ${color.h === null ? 'none' : formatNumber(color.h)} / ${formatNumber(color.alpha)})`;
}

function failMissingToken(key: string): never {
  throw new TypeError(`Missing token "${key}".`);
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 100000) / 100000;
  const text = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(5).replace(/0+$/, '').replace(/\.$/, '');
  return text === '-0' ? '0' : text;
}

function freezeControllerSnapshot<TPhase extends string>(
  snapshot: ThemeControllerSnapshot<TPhase>
): ThemeControllerSnapshot<TPhase> {
  return Object.freeze({ ...snapshot });
}

function safeStorageFromWindow(win: Window | null): StorageLike | null {
  try {
    return win?.localStorage ?? null;
  } catch {
    return null;
  }
}

function loadModeFromStorage(
  storage: StorageLike | null,
  key: string
): ThemeMode | null {
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

function persistMode(
  storage: StorageLike | null,
  key: string,
  mode: ThemeMode
): void {
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
    if (win?.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    if (win) {
      return 'light';
    }
  } catch {
    return null;
  }
  return null;
}

function createScheduler(win: Window | null): AnimationScheduler | null {
  const capabilities = win as {
    requestAnimationFrame?: Window['requestAnimationFrame'];
    cancelAnimationFrame?: Window['cancelAnimationFrame'];
  } | null;

  if (
    !capabilities?.requestAnimationFrame ||
    !capabilities.cancelAnimationFrame
  ) {
    return null;
  }

  const { requestAnimationFrame, cancelAnimationFrame } = capabilities;

  return {
    requestAnimationFrame: (callback) => requestAnimationFrame(callback),
    cancelAnimationFrame: (handle) => {
      cancelAnimationFrame(handle as number);
    }
  };
}

const systemClock: Clock = {
  now: () => new Date(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as number);
  }
};
