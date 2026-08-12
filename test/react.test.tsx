import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { TimeAwareThemeProvider, useTimeAwareTheme } from '../src/react.js';
import { createThemeController } from '../src/dom.js';
import { createFixtureSystem } from './fixture.js';
import { createManualClock } from '../src/testing.js';

const mountPoint = document.createElement('div');
document.body.appendChild(mountPoint);

afterEach(() => {
  mountPoint.innerHTML = '';
});

describe('react adapter', () => {
  it('exposes controller state and avoids rerenders for minute-only ticks', () => {
    const clock = createManualClock({
      now: new Date('2026-08-12T03:05:00.000Z'),
      timezoneOffsetMinutes: 0
    });
    const controller = createThemeController({
      system: createFixtureSystem(),
      clock,
      document,
      window: null,
      storage: null,
      defaultMode: 'time-aware'
    });
    controller.start();

    const renders: string[] = [];

    function Probe() {
      const theme = useTimeAwareTheme();
      renders.push(`${theme.mode}:${theme.appearance}:${theme.phase}`);
      return (
        <div
          data-mode={theme.mode}
          data-appearance={theme.appearance}
          data-phase={theme.phase}
        />
      );
    }

    const root = createRoot(mountPoint);

    act(() => {
      root.render(
        <TimeAwareThemeProvider controller={controller}>
          <Probe />
        </TimeAwareThemeProvider>
      );
    });

    expect(renders).toHaveLength(1);

    act(() => {
      clock.advanceBy(60_000);
    });

    expect(renders).toHaveLength(1);

    act(() => {
      root.unmount();
    });
    controller.dispose();
  });
});
