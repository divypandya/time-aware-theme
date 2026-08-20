import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { inspect } from '@divypandya/time-aware-theme/inspect';
import { useTimeAwareTheme } from '@divypandya/time-aware-theme/react';
import {
  PhaseLabel,
  ThemeModeSelect,
  TimePreviewSlider,
  formatMinute
} from '@divypandya/time-aware-theme/react-ui';
import type { PresetEntry } from './presets';
import { presets } from './presets';

export interface AppProps {
  readonly presetId: string;
  readonly onPresetChange: (id: string) => void;
}

function currentMinute(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * The React example, which deliberately shows different things to the vanilla
 * one.
 *
 * examples/vanilla-dom hand-wires createThemeController and drives a single
 * bespoke schedule, because that is the zero-build path. Repeating that with
 * JSX around it would demonstrate nothing about the React entry points, so
 * this one uses the components the package ships, switches between all ten
 * presets at runtime, and reads live contrast out of /inspect rather than
 * claiming in prose that the schedule stays legible.
 */
export function App({ presetId, onPresetChange }: AppProps) {
  const { mode, setPreviewMinute, clearPreview } = useTimeAwareTheme();
  const active = presets.find((entry) => entry.id === presetId) ?? presets[0];

  // The controller snapshot carries phase and appearance but not the minute -
  // it changes every tick and would defeat the value comparison that keeps
  // subscribers from re-rendering constantly. So the minute is owned here,
  // which is also what lets the play button and the slider agree.
  const [minute, setMinute] = useState(currentMinute);
  const [playing, setPlaying] = useState(false);

  const scrub = useCallback((next: number) => {
    setPlaying(false);
    setMinute(next);
  }, []);

  // A whole day in about twelve seconds. requestAnimationFrame rather than an
  // interval so it pauses with the tab: a background tab animating the theme
  // is work nobody can see.
  const frame = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) {
      return;
    }
    const step = () => {
      setMinute((current) => {
        const next = (current + 2) % 1440;
        setPreviewMinute(next);
        return next;
      });
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
      }
    };
  }, [playing, setPreviewMinute]);

  const disabled = mode !== 'time-aware';
  useEffect(() => {
    if (disabled) {
      setPlaying(false);
    }
  }, [disabled]);

  return (
    <main className="shell">
      <header className="masthead">
        <p className="clock">{formatMinute(minute)}</p>
        <PhaseLabel className="phase" />
        <p className="meta">
          {active?.label} · {mode}
          {playing ? ' · playing' : ''}
        </p>
      </header>

      <TimePreviewSlider
        className="scrub"
        stepMinutes={1}
        minute={minute}
        onMinuteChange={scrub}
      />

      <PresetPicker
        activeId={active?.id ?? ''}
        minute={minute}
        onChange={onPresetChange}
      />

      {active ? <Certification preset={active} minute={minute} /> : null}

      <div className="actions">
        <ThemeModeSelect className="modes" />
        <button
          className="play"
          type="button"
          aria-pressed={playing}
          disabled={disabled}
          onClick={() => {
            setPlaying((current) => {
              if (current) {
                clearPreview();
                setMinute(currentMinute());
                return false;
              }
              setPreviewMinute(minute);
              return true;
            });
          }}
        >
          {playing ? 'Pause' : '▶ Play 24h'}
        </button>
      </div>

      <p className="footnote">
        The slider, mode buttons and phase label are{' '}
        <code>@divypandya/time-aware-theme/react-ui</code>. No CSS ships with
        them — everything here is styled from <code>data-*</code> attributes.
      </p>
    </main>
  );
}

function PresetPicker({
  activeId,
  minute,
  onChange
}: {
  readonly activeId: string;
  readonly minute: number;
  readonly onChange: (id: string) => void;
}) {
  return (
    <section aria-label="Preset" className="presets">
      {presets.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className="preset"
          aria-pressed={entry.id === activeId}
          onClick={() => {
            onChange(entry.id);
          }}
        >
          <Swatches system={entry.system} minute={minute} />
          <span className="preset-label">{entry.label}</span>
          <span className="preset-note">{entry.note}</span>
        </button>
      ))}
    </section>
  );
}

/**
 * Each preset's colours at the current minute, read from that preset rather
 * than from the page.
 *
 * The picker is the one place a theme has to be shown without being applied,
 * so it resolves the schedule directly instead of reading the CSS custom
 * properties the active controller wrote.
 */
function Swatches({
  system,
  minute
}: {
  readonly system: PresetEntry['system'];
  readonly minute: number;
}) {
  const tokens = useMemo(
    () => inspect(system, minute).tokens,
    [system, minute]
  );
  return (
    <span aria-hidden="true" className="swatch-row">
      {['background', 'accent', 'foreground'].map((key) => (
        <span
          className="swatch"
          key={key}
          style={{
            background: tokens.find((entry) => entry.key === key)?.css
          }}
        />
      ))}
    </span>
  );
}

/**
 * Live contrast for every declared pair, plus whether this minute is held.
 *
 * The package's claim is that these stay above their level at every minute of
 * the day. This is that claim, checkable by dragging the slider, which is more
 * use than a badge - and would have made the invisible-text bug fixed in 0.2.0
 * obvious on sight instead of two releases later.
 */
function Certification({
  preset,
  minute
}: {
  readonly preset: PresetEntry;
  readonly minute: number;
}) {
  const report = useMemo(
    () => inspect(preset.system, minute),
    [preset, minute]
  );

  return (
    <section className="certification">
      <h2>
        Declared pairs, right now
        {report.snapshot.holding ? <span className="held">holding</span> : null}
      </h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Pair</th>
            <th scope="col">Ratio</th>
            <th scope="col">Needs</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {report.roles.map((role) => (
            <tr key={`${role.bg}-${role.fg}`}>
              <th scope="row">
                {role.fg} on {role.bg}
              </th>
              <td>{role.actual.toFixed(2)}:1</td>
              <td>{role.required}:1</td>
              <td data-pass={role.passes ? '' : undefined}>
                {role.passes ? 'pass' : 'FAIL'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
