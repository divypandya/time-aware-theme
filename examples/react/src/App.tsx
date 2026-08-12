import { useEffect, useRef, useState } from 'react';
import { resolveThemeSnapshot } from '@divypandya/time-aware-theme';
import { useTimeAwareTheme } from '@divypandya/time-aware-theme/react';
import { demoThemeSystem } from './theme-system';

function formatMinute(minute: number): string {
  const hours = String(Math.floor(minute / 60)).padStart(2, '0');
  const mins = String(minute % 60).padStart(2, '0');
  return `${hours}:${mins}`;
}

function oklchCss(token: {
  l: number;
  c: number;
  h: number | null;
  alpha: number;
}): string {
  return `oklch(${token.l} ${token.c} ${token.h ?? 0} / ${token.alpha})`;
}

function currentLiveMinute(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

export function App() {
  const { mode, setMode, setPreviewMinute } = useTimeAwareTheme();
  const [minute, setMinute] = useState(currentLiveMinute);
  const [playing, setPlaying] = useState(false);
  const rafId = useRef<number | null>(null);

  const snapshot = resolveThemeSnapshot(demoThemeSystem, mode, minute);

  useEffect(() => {
    if (!playing) {
      return;
    }

    setMode('time-aware');

    const step = () => {
      setMinute((current) => {
        const next = (current + 4) % 1440;
        setPreviewMinute(next);
        return next;
      });
      rafId.current = requestAnimationFrame(step);
    };

    rafId.current = requestAnimationFrame(step);
    return () => {
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
      }
    };
  }, [playing, setMode, setPreviewMinute]);

  function handleSlide(next: number) {
    setPlaying(false);
    setMinute(next);
    setMode('time-aware');
    setPreviewMinute(next);
  }

  function handleModeChange(nextMode: typeof mode) {
    setPlaying(false);
    setMode(nextMode);
    if (nextMode === 'time-aware') {
      setPreviewMinute(minute);
    }
  }

  return (
    <main className="card">
      <p className="clock">{formatMinute(minute)}</p>
      <p className="phase">
        {snapshot.phase} · {mode}
      </p>

      <div className="swatches">
        {(['background', 'foreground', 'accent'] as const).map((key) => (
          <span className="swatch" key={key}>
            <span
              className="swatch-color"
              style={{ backgroundColor: oklchCss(snapshot.tokens[key]) }}
            />
            {key}
          </span>
        ))}
      </div>

      <input
        type="range"
        min={0}
        max={1439}
        step={1}
        value={minute}
        aria-label="Minute of the day"
        onChange={(event) => {
          handleSlide(Number(event.target.value));
        }}
      />

      <div className="modes">
        {(['time-aware', 'light', 'dark'] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={mode === option}
            onClick={() => {
              handleModeChange(option);
            }}
          >
            {option === 'time-aware' ? 'Auto' : option}
          </button>
        ))}
      </div>

      <button
        className="play-button"
        type="button"
        aria-pressed={playing}
        onClick={() => {
          setPlaying((current) => !current);
        }}
      >
        {playing ? 'Pause' : '▶ Play 24h'}
      </button>
    </main>
  );
}
