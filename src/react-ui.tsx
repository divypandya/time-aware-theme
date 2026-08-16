import React, {
  useCallback,
  useId,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import { MINUTES_PER_DAY, type ThemeMode } from './core.js';
import { useTimeAwareTheme } from './react.js';

/**
 * Headless components: structure, state and accessibility, no styling.
 *
 * Every element exposes its state through `data-*` attributes so consumers can
 * style with CSS (or Tailwind's `data-[state=on]:` variants) without this
 * package shipping a stylesheet or owning any visual decisions. No CSS import
 * exists, and none should.
 */

const MODES: readonly ThemeMode[] = ['light', 'dark', 'time-aware'];

const DEFAULT_LABELS: Readonly<Record<ThemeMode, string>> = {
  light: 'Light',
  dark: 'Dark',
  'time-aware': 'Time of day'
};

export function formatMinute(minute: number): string {
  const normalized =
    ((Math.trunc(minute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) %
    MINUTES_PER_DAY;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export interface ThemeModeSelectProps {
  readonly modes?: readonly ThemeMode[];
  readonly labels?: Partial<Record<ThemeMode, string>>;
  readonly className?: string;
  readonly buttonClassName?: string;
  readonly 'aria-label'?: string;
}

/**
 * Radio group for choosing light / dark / time-aware.
 *
 * A radio group rather than a set of buttons, because the modes are mutually
 * exclusive and arrow-key navigation is what a screen reader user expects.
 */
export function ThemeModeSelect({
  modes = MODES,
  labels,
  className,
  buttonClassName,
  'aria-label': ariaLabel = 'Theme mode'
}: ThemeModeSelectProps): React.ReactElement {
  const { mode, setMode } = useTimeAwareTheme();

  return (
    <div role="radiogroup" aria-label={ariaLabel} className={className}>
      {modes.map((candidate) => {
        const selected = candidate === mode;
        return (
          <button
            key={candidate}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            data-mode={candidate}
            data-state={selected ? 'on' : 'off'}
            className={buttonClassName}
            onClick={() => {
              setMode(candidate);
            }}
          >
            {labels?.[candidate] ?? DEFAULT_LABELS[candidate]}
          </button>
        );
      })}
    </div>
  );
}

export interface TimePreviewSliderProps {
  readonly stepMinutes?: number;
  readonly label?: string;
  readonly className?: string;
  readonly inputClassName?: string;
  readonly children?: (state: {
    readonly minute: number;
    readonly previewing: boolean;
  }) => ReactNode;
}

/**
 * Scrubs the schedule without changing the clock.
 *
 * Disabled outside time-aware mode, since the static themes have no schedule
 * to scrub. Releasing the control clears the preview and returns to live time,
 * so a consumer cannot accidentally strand the theme at 3am.
 */
export function TimePreviewSlider({
  stepMinutes = 5,
  label = 'Preview time of day',
  className,
  inputClassName,
  children
}: TimePreviewSliderProps): React.ReactElement {
  const { mode, setPreviewMinute, clearPreview } = useTimeAwareTheme();
  const [minute, setMinute] = useState(() => currentMinute());
  const [previewing, setPreviewing] = useState(false);
  const id = useId();
  const disabled = mode !== 'time-aware';

  const handleChange = useCallback(
    (next: number) => {
      setMinute(next);
      setPreviewing(true);
      setPreviewMinute(next);
    },
    [setPreviewMinute]
  );

  const handleRelease = useCallback(() => {
    setPreviewing(false);
    clearPreview();
  }, [clearPreview]);

  return (
    <div
      className={className}
      data-disabled={disabled ? '' : undefined}
      data-previewing={previewing ? '' : undefined}
    >
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={0}
        max={MINUTES_PER_DAY - 1}
        step={stepMinutes}
        value={minute}
        disabled={disabled}
        className={inputClassName}
        aria-valuetext={formatMinute(minute)}
        onChange={(event) => {
          handleChange(Number(event.target.value));
        }}
        onPointerUp={handleRelease}
        onBlur={handleRelease}
      />
      {children?.({ minute, previewing })}
    </div>
  );
}

export interface PhaseLabelProps {
  readonly className?: string;
  readonly children?: (state: {
    readonly phase: string;
    readonly nextPhase: string;
    readonly appearance: 'light' | 'dark';
    readonly mode: ThemeMode;
  }) => ReactNode;
}

/**
 * Announces the current phase.
 *
 * `aria-live="polite"` because the phase changes on its own as time passes;
 * a screen reader user should hear about it without the focus moving.
 */
export function PhaseLabel({
  className,
  children
}: PhaseLabelProps): React.ReactElement {
  const { phase, nextPhase, appearance, mode } = useTimeAwareTheme();

  const state = useMemo(
    () => ({ phase, nextPhase, appearance, mode }),
    [phase, nextPhase, appearance, mode]
  );

  return (
    <span
      className={className}
      aria-live="polite"
      data-phase={phase}
      data-next-phase={nextPhase}
      data-appearance={appearance}
      data-mode={mode}
    >
      {children ? children(state) : `${phase} · ${appearance}`}
    </span>
  );
}

export interface ThemeSelectorProps
  extends ThemeModeSelectProps, Pick<TimePreviewSliderProps, 'stepMinutes'> {
  readonly showPreview?: boolean;
  readonly showPhase?: boolean;
}

/** Mode selector, preview slider and phase label, composed. */
export function ThemeSelector({
  showPreview = true,
  showPhase = true,
  stepMinutes,
  ...modeProps
}: ThemeSelectorProps): React.ReactElement {
  return (
    <div data-time-aware-theme-selector="">
      <ThemeModeSelect {...modeProps} />
      {showPreview ? (
        <TimePreviewSlider
          {...(stepMinutes === undefined ? {} : { stepMinutes })}
        />
      ) : null}
      {showPhase ? <PhaseLabel /> : null}
    </div>
  );
}

function currentMinute(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}
