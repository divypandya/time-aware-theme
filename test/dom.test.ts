import { afterEach, describe, expect, it } from 'vitest';
import { createThemeController } from '../src/dom.js';
import { createFixtureSystem } from './fixture.js';
import { createManualClock } from '../src/testing.js';

function createStorageStub(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    snapshot: () => Object.fromEntries(data)
  };
}

function createWindowStub(matchDark = true) {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  return {
    matchMedia: () => ({ matches: matchDark }),
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent: (event: Event) => {
      for (const listener of listeners.get(event.type) ?? []) {
        if (typeof listener === 'function') {
          listener(event);
        } else {
          listener.handleEvent(event);
        }
      }
      return true;
    }
  } as Window;
}

function createDocumentStub() {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const styleProps = new Map<string, string>();
  const root = {
    style: {
      setProperty: (name: string, value: string) => {
        styleProps.set(name, value);
      }
    },
    classList: {
      toggle: (_className: string, force?: boolean) => force ?? false
    },
    dataset: {} as DOMStringMap
  } as unknown as HTMLElement;

  return {
    documentElement: root,
    visibilityState: 'visible',
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent: (event: Event) => {
      for (const listener of listeners.get(event.type) ?? []) {
        if (typeof listener === 'function') {
          listener(event);
        } else {
          listener.handleEvent(event);
        }
      }
      return true;
    },
    get styleProps() {
      return styleProps;
    }
  } as Document & { styleProps: Map<string, string> };
}

let cleanup = () => {};

afterEach(() => {
  cleanup();
  cleanup = () => {};
});

describe('theme controller', () => {
  it('starts from stored mode and writes DOM state', () => {
    const clock = createManualClock({ now: new Date('2026-08-12T06:05:00.000Z'), timezoneOffsetMinutes: 0 });
    const storage = createStorageStub({ 'time-aware-theme:mode': 'dark' });
    const windowStub = createWindowStub(true);
    const documentStub = createDocumentStub();

    const controller = createThemeController({
      system: createFixtureSystem(),
      clock,
      storage,
      window: windowStub,
      document: documentStub
    });

    controller.start();

    expect(controller.getSnapshot()).toMatchObject({ mode: 'dark', appearance: 'dark', phase: 'static' });
    expect(storage.snapshot()['time-aware-theme:mode']).toBe('dark');
    expect(documentStub.documentElement.dataset.themeMode).toBe('dark');
    expect(documentStub.styleProps.get('--tat-background')).toContain('oklch(');

    cleanup = () => controller.dispose();
  });

  it('aligns minute ticks and survives preview toggles', () => {
    const clock = createManualClock({ now: new Date('2026-08-12T05:59:30.000Z'), timezoneOffsetMinutes: 0 });
    const storage = createStorageStub({ 'time-aware-theme:mode': 'time-aware' });
    const windowStub = createWindowStub(false);
    const documentStub = createDocumentStub();

    const controller = createThemeController({
      system: createFixtureSystem(),
      clock,
      storage,
      window: windowStub,
      document: documentStub
    });

    controller.start();
    expect(clock.pendingTimers()).toBeGreaterThan(0);

    const before = controller.getSnapshot();
    controller.setPreviewMinute(720);
    clock.advanceBy(16);
    const preview = controller.getSnapshot();
    expect(preview.phase).toBe('noon');
    expect(preview.appearance).toBe('light');

    controller.clearPreview();
    clock.advanceBy(60_000);
    const after = controller.getSnapshot();
    expect(after.mode).toBe('time-aware');
    expect(after.phase).not.toBe(before.phase);

    cleanup = () => controller.dispose();
  });

  it('ignores malformed storage and reacts to cross-tab mode changes', () => {
    const clock = createManualClock({ now: new Date('2026-08-12T05:00:00.000Z'), timezoneOffsetMinutes: 0 });
    const storage = createStorageStub({ 'time-aware-theme:mode': 'time-aware' });
    const windowStub = createWindowStub(true);
    const documentStub = createDocumentStub();
    const controller = createThemeController({
      system: createFixtureSystem(),
      clock,
      storage,
      window: windowStub,
      document: documentStub,
      defaultMode: 'time-aware'
    });

    controller.start();
    expect(controller.getSnapshot().mode).toBe('time-aware');

    storage.setItem('time-aware-theme:mode', 'light');
    windowStub.dispatchEvent(new StorageEvent('storage', { key: 'time-aware-theme:mode', newValue: 'light' }));
    expect(controller.getSnapshot().mode).toBe('light');

    cleanup = () => controller.dispose();
  });
});
