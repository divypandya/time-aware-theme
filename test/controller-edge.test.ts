import { afterEach, describe, expect, it, vi } from 'vitest';
import { createThemeController } from '../src/dom.js';
import { createManualClock } from '../src/testing.js';
import { createFixtureSystem } from './fixture.js';

const system = createFixtureSystem();
const created: { dispose: () => void }[] = [];

function make(options: Parameters<typeof createThemeController>[0]) {
  const controller = createThemeController(options);
  created.push(controller);
  return controller;
}

afterEach(() => {
  while (created.length > 0) {
    created.pop()?.dispose();
  }
});

function clockAt(iso = '2026-08-16T12:00:00Z') {
  return createManualClock({ now: new Date(iso), timezoneOffsetMinutes: 0 });
}

describe('server-side safety', () => {
  it('stays inert without a document or window', () => {
    const controller = make({ system, clock: clockAt() });
    // Constructing and starting during SSR must not throw and must not
    // require any DOM globals to exist.
    expect(() => controller.start()).not.toThrow();
    expect(controller.getSnapshot().mode).toBeDefined();
  });

  it('survives a window without matchMedia', () => {
    const controller = make({
      system,
      clock: clockAt(),
      window: {} as unknown as Window
    });
    expect(() => controller.start()).not.toThrow();
  });

  it('treats an explicit null as opting out, not as unset', () => {
    // These options are typed `| null` so callers can refuse the default.
    // Resolving them with `??` would hand back the very default being refused;
    // passing null here must genuinely disable each one.
    const clock = clockAt('2026-08-16T00:30:00Z');
    const controller = make({
      system,
      clock,
      document,
      window: null,
      storage: null,
      scheduler: null,
      defaultMode: 'time-aware'
    });
    controller.start();

    // With no scheduler the preview update is driven by the clock's timeout,
    // so the manual clock can flush it.
    controller.setPreviewMinute(720);
    clock.advanceBy(32);
    expect(controller.getSnapshot().phase).toBe('noon');
  });

  it('falls back to a timeout when no animation scheduler exists', () => {
    const clock = clockAt();
    const controller = make({
      system,
      clock,
      document,
      scheduler: null,
      defaultMode: 'time-aware'
    });
    controller.start();
    controller.setPreviewMinute(720);
    clock.advanceBy(32);
    expect(controller.getSnapshot().phase).toBe('noon');
  });
});

describe('storage resilience', () => {
  it('ignores a storage that throws on read', () => {
    const controller = make({
      system,
      clock: clockAt(),
      storage: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => undefined,
        removeItem: () => undefined
      }
    });
    expect(() => controller.start()).not.toThrow();
  });

  it('ignores a storage that throws on write', () => {
    const controller = make({
      system,
      clock: clockAt(),
      document,
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('quota');
        },
        removeItem: () => undefined
      }
    });
    controller.start();
    // A full or blocked quota must never break theme switching.
    expect(() => {
      controller.setMode('dark');
    }).not.toThrow();
    expect(controller.getSnapshot().mode).toBe('dark');
  });

  it('ignores a malformed persisted value', () => {
    const controller = make({
      system,
      clock: clockAt(),
      defaultMode: 'dark',
      storage: {
        getItem: () => 'chartreuse',
        setItem: () => undefined,
        removeItem: () => undefined
      }
    });
    expect(controller.start().mode).toBe('dark');
  });
});

describe('lifecycle guards', () => {
  it('is idempotent on start and dispose', () => {
    const controller = make({ system, clock: clockAt(), document });
    const first = controller.start();
    expect(controller.start()).toBe(first);
    controller.dispose();
    expect(() => {
      controller.dispose();
    }).not.toThrow();
  });

  it('refuses to be used after disposal', () => {
    const controller = make({ system, clock: clockAt(), document });
    controller.start();
    controller.dispose();

    expect(() => controller.start()).toThrow(/disposed/);
    expect(() => {
      controller.setMode('dark');
    }).toThrow(/disposed/);
    expect(() => {
      controller.setPreviewMinute(60);
    }).toThrow(/disposed/);
    expect(() => {
      controller.clearPreview();
    }).toThrow(/disposed/);
  });

  it('rejects an invalid mode', () => {
    const controller = make({ system, clock: clockAt(), document });
    controller.start();
    expect(() => {
      controller.setMode('sepia' as never);
    }).toThrow(/Invalid theme mode/);
  });
});

describe('preview', () => {
  it('is ignored outside time-aware mode', () => {
    const controller = make({
      system,
      clock: clockAt(),
      document,
      defaultMode: 'dark'
    });
    controller.start();
    controller.setPreviewMinute(720);
    // Static modes have no schedule to preview against.
    expect(controller.getSnapshot().phase).toBe('static');
  });

  it('is a no-op to clear when nothing is previewed', () => {
    const controller = make({
      system,
      clock: clockAt(),
      document,
      defaultMode: 'time-aware'
    });
    controller.start();
    expect(() => {
      controller.clearPreview();
    }).not.toThrow();
  });

  it('returns to live time when cleared', () => {
    const clock = clockAt('2026-08-16T00:30:00Z');
    const controller = make({
      system,
      clock,
      document,
      // Without this the controller picks up jsdom's real rAF via
      // document.defaultView, and the manual clock can no longer flush it.
      scheduler: null,
      defaultMode: 'time-aware'
    });
    controller.start();
    const live = controller.getSnapshot().phase;

    controller.setPreviewMinute(720);
    clock.advanceBy(32);
    expect(controller.getSnapshot().phase).toBe('noon');

    controller.clearPreview();
    clock.advanceBy(32);
    expect(controller.getSnapshot().phase).toBe(live);
  });
});

describe('subscriptions', () => {
  it('notifies only when the snapshot actually changes', () => {
    const clock = clockAt('2026-08-16T00:00:00Z');
    const controller = make({
      system,
      clock,
      document,
      defaultMode: 'time-aware'
    });
    controller.start();

    const listener = vi.fn();
    controller.subscribe(listener);

    // Ticking within a phase changes token values but not mode/appearance/
    // phase, so subscribers must not be woken. This is what keeps `progress`
    // out of the controller snapshot: a per-minute field would defeat it.
    clock.advanceBy(60_000);
    expect(listener).not.toHaveBeenCalled();

    controller.setMode('dark');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops notifying after unsubscribe', () => {
    const controller = make({
      system,
      clock: clockAt(),
      document,
      defaultMode: 'time-aware'
    });
    controller.start();

    const listener = vi.fn();
    controller.subscribe(listener)();
    controller.setMode('dark');
    expect(listener).not.toHaveBeenCalled();
  });
});
