import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applySnapshotTo, createThemeController } from '../src/dom.js';
import { resolveThemeAt } from '../src/core.js';
import { createManualClock } from '../src/testing.js';
import { createFixtureSystem } from './fixture.js';

const system = createFixtureSystem();
const controllers: { dispose: () => void }[] = [];

function track<T extends { dispose: () => void }>(controller: T): T {
  controllers.push(controller);
  return controller;
}

beforeEach(() => {
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('class');
  delete document.documentElement.dataset.themeMode;
  delete document.documentElement.dataset.themePhase;
  document.body.innerHTML = '';
});

afterEach(() => {
  while (controllers.length > 0) {
    controllers.pop()?.dispose();
  }
});

function createPanel(): HTMLElement {
  const panel = document.createElement('div');
  document.body.append(panel);
  return panel;
}

describe('CSS variable naming', () => {
  it('namespaces with the default prefix', () => {
    track(
      createThemeController({
        system,
        document,
        defaultMode: 'dark',
        clock: createManualClock({ now: new Date('2026-08-16T12:00:00Z') })
      })
    ).start();

    expect(
      document.documentElement.style.getPropertyValue('--tat-background')
    ).toMatch(/^oklch\(/);
  });

  it('emits bare names when the prefix is null', () => {
    const panel = createPanel();
    track(
      createThemeController({
        system,
        document,
        target: panel,
        cssVariablePrefix: null,
        defaultMode: 'dark',
        clock: createManualClock({ now: new Date('2026-08-16T12:00:00Z') })
      })
    ).start();

    expect(panel.style.getPropertyValue('--background')).toMatch(/^oklch\(/);
    expect(panel.style.getPropertyValue('--tat-background')).toBe('');
  });

  it('supports the Tailwind v4 colour namespace', () => {
    const panel = createPanel();
    track(
      createThemeController({
        system,
        document,
        target: panel,
        cssVariablePrefix: 'color',
        defaultMode: 'dark',
        clock: createManualClock({ now: new Date('2026-08-16T12:00:00Z') })
      })
    ).start();

    expect(panel.style.getPropertyValue('--color-background')).toMatch(
      /^oklch\(/
    );
  });
});

describe('scoped controller isolation', () => {
  function createScoped(target: HTMLElement, storage: Map<string, string>) {
    return track(
      createThemeController({
        system,
        document,
        window,
        target,
        defaultMode: 'dark',
        clock: createManualClock({ now: new Date('2026-08-16T12:00:00Z') }),
        storage: {
          getItem: (key) => storage.get(key) ?? null,
          setItem: (key, value) => {
            storage.set(key, value);
          },
          removeItem: (key) => {
            storage.delete(key);
          }
        }
      })
    );
  }

  it('writes to its target and leaves the document element untouched', () => {
    const panel = createPanel();
    createScoped(panel, new Map()).start();

    expect(panel.style.getPropertyValue('--tat-background')).toMatch(
      /^oklch\(/
    );
    expect(
      document.documentElement.style.getPropertyValue('--tat-background')
    ).toBe('');
    expect(document.documentElement.dataset.themeMode).toBeUndefined();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('does not write color-scheme', () => {
    const panel = createPanel();
    createScoped(panel, new Map()).start();

    // color-scheme governs UA-rendered surfaces and is only meaningful at the
    // root; a preview swatch setting it would restyle native controls.
    expect(panel.style.getPropertyValue('color-scheme')).toBe('');
  });

  it('never persists mode', () => {
    const panel = createPanel();
    const storage = new Map<string, string>();
    const controller = createScoped(panel, storage);
    controller.start();
    controller.setMode('light');

    expect(storage.size).toBe(0);
  });

  it('ignores a previously persisted mode', () => {
    const panel = createPanel();
    const storage = new Map([['time-aware-theme:mode', 'light']]);
    const controller = createScoped(panel, storage);

    // The primary controller owns global mode; a scoped preview must not
    // inherit it, or every swatch would follow the user's page-level choice.
    expect(controller.start().mode).toBe('dark');
  });

  it('still toggles the dark class on its own subtree', () => {
    const panel = createPanel();
    createScoped(panel, new Map()).start();
    expect(panel.classList.contains('dark')).toBe(true);
  });

  it('does not disturb a primary controller on the same page', () => {
    const panel = createPanel();

    const primary = track(
      createThemeController({
        system,
        document,
        defaultMode: 'light',
        clock: createManualClock({ now: new Date('2026-08-16T12:00:00Z') })
      })
    );
    primary.start();

    createScoped(panel, new Map()).start();

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(panel.classList.contains('dark')).toBe(true);
    expect(
      document.documentElement.style.getPropertyValue('color-scheme')
    ).toBe('light');
  });

  it('keeps memoisation per instance', () => {
    const first = createPanel();
    const second = createPanel();
    createScoped(first, new Map()).start();
    createScoped(second, new Map()).start();

    // Both instances must have written, rather than the second short-circuiting
    // on the first's memoised css text.
    expect(first.style.getPropertyValue('--tat-background')).toMatch(
      /^oklch\(/
    );
    expect(second.style.getPropertyValue('--tat-background')).toMatch(
      /^oklch\(/
    );
  });
});

describe('lifecycle', () => {
  it('releases every timer on dispose', () => {
    const clock = createManualClock({ now: new Date('2026-08-16T12:00:00Z') });
    const controller = createThemeController({
      system,
      document,
      window,
      defaultMode: 'time-aware',
      clock
    });

    controller.start();
    expect(clock.pendingTimers()).toBeGreaterThan(0);

    controller.dispose();
    expect(clock.pendingTimers()).toBe(0);
  });

  it('does not accumulate timers across scoped instances', () => {
    const clock = createManualClock({ now: new Date('2026-08-16T12:00:00Z') });
    const panels = [createPanel(), createPanel(), createPanel()];
    const instances = panels.map((panel) =>
      createThemeController({
        system,
        document,
        window,
        target: panel,
        defaultMode: 'time-aware',
        clock
      })
    );

    for (const instance of instances) {
      instance.start();
    }
    for (const instance of instances) {
      instance.dispose();
    }

    expect(clock.pendingTimers()).toBe(0);
  });
});

describe('applySnapshotTo', () => {
  it('writes a snapshot with no lifecycle attached', () => {
    const panel = createPanel();
    const snapshot = resolveThemeAt(system, 12 * 60);

    applySnapshotTo(panel, snapshot, {
      tokenKeys: system.tokenKeys,
      cssVariablePrefix: null
    });

    expect(panel.style.getPropertyValue('--background')).toMatch(/^oklch\(/);
    expect(panel.dataset.themePhase).toBe(snapshot.phase);
    expect(
      document.documentElement.style.getPropertyValue('--background')
    ).toBe('');
  });
});

describe('the switch signal', () => {
  /**
   * Holds the frame callback instead of running it, so the flagged frame can
   * be observed. The manual clock runs a zero-delay timeout inside the same
   * advance that scheduled it, which collapses the frame the browser would
   * actually draw.
   */
  function heldScheduler() {
    const queue: (() => void)[] = [];
    return {
      requestAnimationFrame(callback: (timestamp: number) => void) {
        queue.push(() => {
          callback(0);
        });
        return queue.length;
      },
      cancelAnimationFrame() {
        queue.length = 0;
      },
      runFrame() {
        const pending = [...queue];
        queue.length = 0;
        for (const run of pending) run();
      }
    };
  }

  function atFixtureSwitch() {
    const panel = createPanel();
    const clock = createManualClock({
      now: new Date('2026-08-16T05:59:30Z'),
      timezoneOffsetMinutes: 0
    });
    const scheduler = heldScheduler();
    const controller = track(
      createThemeController({
        system,
        document,
        target: panel,
        defaultMode: 'time-aware',
        clock,
        scheduler
      })
    );
    controller.start();
    return { panel, clock, scheduler };
  }

  it('flags the frame where the theme changes discontinuously', () => {
    const { panel, clock, scheduler } = atFixtureSwitch();

    // 05:59 is an ordinary interval; nothing has changed discontinuously.
    expect(panel.hasAttribute('data-theme-flip')).toBe(false);

    // 06:00 is the declared hold — same values, still nothing to suppress.
    clock.advanceBy(60_000);
    expect(panel.hasAttribute('data-theme-flip')).toBe(false);

    // 06:01 is the instant change. The resolver never blends it, but a CSS
    // transition would, so the frame is flagged.
    clock.advanceBy(60_000);
    expect(panel.hasAttribute('data-theme-flip')).toBe(true);

    // Cleared once that frame has painted, so ordinary drift still eases.
    scheduler.runFrame();
    expect(panel.hasAttribute('data-theme-flip')).toBe(false);
  });

  it('leaves the target clean when disposed mid-switch', () => {
    const { panel, clock } = atFixtureSwitch();
    clock.advanceBy(60_000);
    clock.advanceBy(60_000);
    expect(panel.hasAttribute('data-theme-flip')).toBe(true);
    while (controllers.length > 0) controllers.pop()?.dispose();
    expect(panel.hasAttribute('data-theme-flip')).toBe(false);
  });

  it('degrades when the target cannot carry attributes', () => {
    // A minimal document stub is a legitimate thing to pass; a missing
    // attribute API should mean "no signal", not a throw mid-apply.
    const stub = {
      style: { setProperty: () => undefined },
      classList: { toggle: () => undefined },
      dataset: {} as Record<string, string>
    } as unknown as HTMLElement;
    const clock = createManualClock({
      now: new Date('2026-08-16T05:59:30Z'),
      timezoneOffsetMinutes: 0
    });
    const controller = track(
      createThemeController({
        system,
        document,
        target: stub,
        defaultMode: 'time-aware',
        clock,
        scheduler: heldScheduler()
      })
    );
    expect(() => {
      controller.start();
      clock.advanceBy(60_000);
      clock.advanceBy(60_000);
    }).not.toThrow();
  });

  it('can be turned off', () => {
    const panel = createPanel();
    const clock = createManualClock({
      now: new Date('2026-08-16T05:59:30Z'),
      timezoneOffsetMinutes: 0
    });
    track(
      createThemeController({
        system,
        document,
        target: panel,
        defaultMode: 'time-aware',
        clock,
        scheduler: heldScheduler(),
        flipAttribute: null
      })
    ).start();
    clock.advanceBy(60_000);
    clock.advanceBy(60_000);
    expect(panel.hasAttribute('data-theme-flip')).toBe(false);
  });
});
