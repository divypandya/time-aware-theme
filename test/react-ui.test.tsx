import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createThemeController } from '../src/dom.js';
import { TimeAwareThemeProvider } from '../src/react.js';
import {
  PhaseLabel,
  ThemeModeSelect,
  ThemeSelector,
  TimePreviewSlider,
  formatMinute
} from '../src/react-ui.js';
import { createManualClock } from '../src/testing.js';
import { createFixtureSystem } from './fixture.js';

const system = createFixtureSystem();
let root: Root | null = null;
let container: HTMLElement | null = null;

function render(node: React.ReactNode, mount: HTMLElement) {
  container = mount;
  root = createRoot(mount);
  act(() => {
    root?.render(node);
  });
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
});

function mountWith(
  node: React.ReactNode,
  options: { mode?: 'light' | 'dark' | 'time-aware' } = {}
) {
  const host = document.createElement('div');
  document.body.append(host);
  const target = document.createElement('div');
  document.body.append(target);

  // Pin both the clock and the scheduler to the manual clock so preview
  // updates, which are queued rather than applied synchronously, can be
  // flushed deterministically.
  const clock = createManualClock({
    now: new Date('2026-08-16T12:00:00Z'),
    timezoneOffsetMinutes: 0
  });
  const controller = createThemeController({
    system,
    document,
    target,
    defaultMode: options.mode ?? 'time-aware',
    clock,
    scheduler: null
  });
  controller.start();

  render(
    <TimeAwareThemeProvider controller={controller}>
      {node}
    </TimeAwareThemeProvider>,
    host
  );
  return { host, controller, clock };
}

/**
 * React tracks the previous value on the DOM node itself, so assigning
 * `input.value` directly is invisible to it and onChange never fires. Going
 * through the native setter is what makes the change observable.
 */
function setRangeValue(input: HTMLInputElement, value: number) {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  ) as { set?: (this: HTMLInputElement, next: string) => void } | undefined;
  const setter = descriptor?.set;
  if (setter) {
    setter.call(input, String(value));
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('formatMinute', () => {
  it('renders a wall clock and wraps', () => {
    expect(formatMinute(0)).toBe('00:00');
    expect(formatMinute(9 * 60 + 5)).toBe('09:05');
    expect(formatMinute(1439)).toBe('23:59');
    expect(formatMinute(1440)).toBe('00:00');
    expect(formatMinute(-1)).toBe('23:59');
  });
});

describe('ThemeModeSelect', () => {
  it('renders an accessible radio group reflecting current mode', () => {
    const { host } = mountWith(<ThemeModeSelect />, { mode: 'dark' });

    const group = host.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute('aria-label')).toBe('Theme mode');

    const radios = [...host.querySelectorAll('[role="radio"]')];
    expect(radios).toHaveLength(3);

    const checked = radios.filter(
      (radio) => radio.getAttribute('aria-checked') === 'true'
    );
    expect(checked).toHaveLength(1);
    expect(checked[0]?.getAttribute('data-mode')).toBe('dark');
    // Roving tabindex: only the selected option is in the tab order.
    expect(
      radios.filter((radio) => radio.getAttribute('tabindex') === '0')
    ).toHaveLength(1);
  });

  it('exposes state through data attributes for styling', () => {
    const { host } = mountWith(<ThemeModeSelect />, { mode: 'light' });
    const selected = host.querySelector('[data-mode="light"]');
    const other = host.querySelector('[data-mode="dark"]');
    expect(selected?.getAttribute('data-state')).toBe('on');
    expect(other?.getAttribute('data-state')).toBe('off');
  });

  it('changes mode on click', () => {
    const { host, controller } = mountWith(<ThemeModeSelect />, {
      mode: 'light'
    });
    const darkButton =
      host.querySelector<HTMLButtonElement>('[data-mode="dark"]');
    act(() => {
      darkButton?.click();
    });
    expect(controller.getSnapshot().mode).toBe('dark');
    expect(
      host.querySelector('[data-mode="dark"]')?.getAttribute('aria-checked')
    ).toBe('true');
  });

  it('honours custom labels and a restricted mode list', () => {
    const { host } = mountWith(
      <ThemeModeSelect modes={['light', 'dark']} labels={{ light: 'Day' }} />
    );
    expect(host.querySelectorAll('[role="radio"]')).toHaveLength(2);
    expect(host.querySelector('[data-mode="light"]')?.textContent).toBe('Day');
  });
});

describe('TimePreviewSlider', () => {
  it('is disabled when there is no schedule to scrub', () => {
    const { host } = mountWith(<TimePreviewSlider />, { mode: 'dark' });
    const input = host.querySelector<HTMLInputElement>('input[type="range"]');
    expect(input?.disabled).toBe(true);
    expect(host.querySelector('[data-disabled]')).not.toBeNull();
  });

  it('is labelled and spans exactly one day', () => {
    const { host } = mountWith(<TimePreviewSlider />);
    const input = host.querySelector<HTMLInputElement>('input[type="range"]');
    expect(input?.min).toBe('0');
    expect(input?.max).toBe('1439');
    // A range input announces a bare number without this.
    expect(input?.getAttribute('aria-valuetext')).toMatch(/^\d\d:\d\d$/);

    const label = host.querySelector('label');
    expect(label?.getAttribute('for')).toBe(input?.id);
  });

  it('previews on input and returns to live time on release', () => {
    const { host, controller, clock } = mountWith(<TimePreviewSlider />);
    const input = host.querySelector<HTMLInputElement>('input[type="range"]');
    if (!input) {
      throw new Error('range input not rendered');
    }

    act(() => {
      setRangeValue(input, 1080);
      clock.advanceBy(32);
    });
    // 1080 is the holdThenSnap hold, which still carries the light phase;
    // the snap to 'sunset' lands at 1081.
    expect(controller.getSnapshot().phase).toBe('dusk');
    expect(host.querySelector('[data-previewing]')).not.toBeNull();

    act(() => {
      // React's onBlur is delegated from the native focusout event.
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      clock.advanceBy(32);
    });
    // Releasing must not strand the theme at the previewed time.
    expect(host.querySelector('[data-previewing]')).toBeNull();
    expect(controller.getSnapshot().phase).toBe('noon');
  });
});

describe('PhaseLabel', () => {
  it('announces politely and exposes phase state', () => {
    const { host } = mountWith(<PhaseLabel />);
    const label = host.querySelector('span');
    expect(label?.getAttribute('aria-live')).toBe('polite');
    expect(label?.getAttribute('data-phase')).toBe('noon');
    expect(label?.getAttribute('data-next-phase')).toBe('afternoon');
    expect(label?.textContent).toContain('noon');
  });

  it('supports a render prop', () => {
    const { host } = mountWith(
      <PhaseLabel>
        {({ phase, nextPhase }) => `${phase} then ${nextPhase}`}
      </PhaseLabel>
    );
    expect(host.querySelector('span')?.textContent).toBe('noon then afternoon');
  });
});

describe('ThemeSelector', () => {
  it('composes the three parts', () => {
    const { host } = mountWith(<ThemeSelector />);
    expect(
      host.querySelector('[data-time-aware-theme-selector]')
    ).not.toBeNull();
    expect(host.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(host.querySelector('input[type="range"]')).not.toBeNull();
    expect(host.querySelector('[data-phase]')).not.toBeNull();
  });

  it('can omit the optional parts', () => {
    const { host } = mountWith(
      <ThemeSelector showPreview={false} showPhase={false} />
    );
    expect(host.querySelector('input[type="range"]')).toBeNull();
    expect(host.querySelector('[data-phase]')).toBeNull();
  });

  it('ships no stylesheet and sets no inline styles', () => {
    const { host } = mountWith(<ThemeSelector />);
    for (const element of host.querySelectorAll('*')) {
      expect(element.getAttribute('style')).toBeNull();
      expect(element.getAttribute('class')).toBeNull();
    }
  });
});
