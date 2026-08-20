import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { inspect } from '@divypandya/time-aware-theme/inspect';
import { useTimeAwareTheme } from '@divypandya/time-aware-theme/react';
import {
  PhaseLabel,
  ThemeModeSelect,
  TimePreviewSlider,
  formatMinute
} from '@divypandya/time-aware-theme/react-ui';
import { Inspector } from './Inspector';
import { Showcase } from './Showcase';
import type { PresetEntry } from './presets';
import { presetById, presets } from './presets';

export interface AppProps {
  readonly presetId: string;
  readonly onPresetChange: (id: string) => void;
}

function currentMinute(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

export function App({ presetId, onPresetChange }: AppProps) {
  const { mode, setPreviewMinute, clearPreview } = useTimeAwareTheme();
  const active = presetById(presetId);

  // The controller snapshot deliberately omits the minute - it changes every
  // tick and would defeat the value comparison that stops subscribers
  // re-rendering constantly. Owning it here is also what lets the slider and
  // the play button agree on what time it is.
  const [minute, setMinute] = useState(currentMinute);
  const [playing, setPlaying] = useState(false);

  const scrub = useCallback((next: number) => {
    setPlaying(false);
    setMinute(next);
  }, []);

  // A day in roughly twelve seconds. requestAnimationFrame rather than an
  // interval, so a backgrounded tab stops doing work nobody can see.
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

  const scrubbable = mode === 'time-aware';
  useEffect(() => {
    if (!scrubbable) {
      setPlaying(false);
    }
  }, [scrubbable]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="identity">
          <h1>time-aware-theme</h1>
          <p className="muted">
            Ten schedules that resolve OKLCH tokens against the clock, and stay
            legible at every minute of the day.
          </p>
        </div>
        <div className="links">
          <a href="https://www.npmjs.com/package/@divypandya/time-aware-theme">
            npm
          </a>
          <a href="https://github.com/divypandya/time-aware-theme">GitHub</a>
        </div>
      </header>

      <section aria-label="Presets" className="gallery">
        {presets.map((entry) => (
          <PresetCard
            active={entry.id === active.id}
            entry={entry}
            key={entry.id}
            minute={minute}
            onSelect={onPresetChange}
          />
        ))}
      </section>

      <section className="controls">
        <div className="clockline">
          <p className="clock">{formatMinute(minute)}</p>
          <PhaseLabel className="phase" />
          <span className="muted">
            {active.label} · step {active.step.toFixed(3)} · {active.level}
            {playing ? ' · playing' : ''}
          </span>
        </div>

        <TimePreviewSlider
          className="scrub"
          minute={minute}
          onMinuteChange={scrub}
          stepMinutes={1}
        />

        <div className="actions">
          <ThemeModeSelect className="modes" />
          <button
            className="btn play"
            disabled={!scrubbable}
            type="button"
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
      </section>

      <main className="stage" id="showcase">
        <Showcase />
        <Inspector minute={minute} preset={active} />
      </main>

      <footer className="foot muted">
        Every preset is certified at 86,400 samples a day — one per second, for
        every declared pair. The text still inverts instantly at the switch,
        because gliding it would carry it through mid-grey while the page is
        mid-grey; the page itself no longer lurches with it.
      </footer>
    </div>
  );
}

/**
 * A preset's own colours at the current minute, resolved from that preset.
 *
 * The gallery is the one place a theme has to be shown without being applied,
 * so each card reads its schedule directly rather than the custom properties
 * the active controller wrote to the document.
 */
function PresetCard({
  active,
  entry,
  minute,
  onSelect
}: {
  readonly active: boolean;
  readonly entry: PresetEntry;
  readonly minute: number;
  readonly onSelect: (id: string) => void;
}) {
  const tokens = useMemo(
    () => inspect(entry.system, minute).tokens,
    [entry, minute]
  );
  const at = (key: string) => tokens.find((token) => token.key === key)?.css;

  return (
    <button
      aria-pressed={active}
      className="card"
      type="button"
      onClick={() => {
        onSelect(entry.id);
      }}
    >
      <span
        aria-hidden="true"
        className="preview"
        style={{ background: at('background') }}
      >
        <span className="preview-bar" style={{ background: at('surface') }} />
        <span
          className="preview-text"
          style={{ background: at('foreground') }}
        />
        <span className="preview-accent" style={{ background: at('accent') }} />
      </span>
      <span className="card-label">
        {entry.label}
        {entry.level === 'AAA' ? <span className="badge">AAA</span> : null}
      </span>
      <span className="card-note muted">{entry.note}</span>
    </button>
  );
}
