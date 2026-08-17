import {
  MINUTES_PER_DAY,
  resolveThemeAt,
  type ContrastLevel,
  type ThemeSnapshot,
  type ThemeSystem
} from './core.js';
import { contrastRatio, contrastThreshold } from './contrast.js';

export {
  contrastRatio,
  contrastThreshold,
  isOutOfSrgbGamut,
  meetsContrast,
  meetsWcagAA,
  relativeLuminance
} from './contrast.js';

export interface SampleScheduleOptions {
  readonly stepMinutes?: number;
}

/**
 * Resolves a schedule across the whole day.
 *
 * Default step of 1 minute is exhaustive rather than approximate:
 * `normalizeMinute` truncates, so integer minutes are the complete set of
 * states a consumer can ever observe.
 */
export function sampleSchedule<TPhase extends string = string>(
  system: ThemeSystem<TPhase>,
  options: SampleScheduleOptions = {}
): readonly ThemeSnapshot<TPhase>[] {
  const step = Math.max(1, Math.trunc(options.stepMinutes ?? 1));
  const samples: ThemeSnapshot<TPhase>[] = [];
  for (let minute = 0; minute < MINUTES_PER_DAY; minute += step) {
    samples.push(resolveThemeAt(system, minute));
  }
  return samples;
}

export interface ContrastViolation {
  readonly minute: number;
  readonly phase: string;
  readonly nextPhase: string;
  readonly progress: number;
  readonly bg: string;
  readonly fg: string;
  readonly level: ContrastLevel;
  readonly required: number;
  readonly actual: number;
}

export interface AssertContrastOptions {
  readonly level?: ContrastLevel;
  readonly stepMinutes?: number;
}

/**
 * Checks every declared role pair at every sampled minute.
 *
 * Returns violations rather than throwing so callers can report all of them at
 * once — a schedule that fails usually fails for a contiguous window, and
 * seeing the whole window is what identifies the offending stop pair.
 */
export function findContrastViolations<TPhase extends string = string>(
  system: ThemeSystem<TPhase>,
  options: AssertContrastOptions = {}
): readonly ContrastViolation[] {
  if (system.roles.length === 0) {
    throw new TypeError(
      'findContrastViolations() requires the theme system to declare roles. ' +
        'Add `roles: { pairs: [{ bg: "background", fg: "foreground" }] }` to ' +
        'defineThemeSystem().'
    );
  }

  const violations: ContrastViolation[] = [];
  for (const snapshot of sampleSchedule(system, options)) {
    for (const role of system.roles) {
      const level = options.level ?? role.min;
      const bg = snapshot.tokens[role.bg];
      const fg = snapshot.tokens[role.fg];
      if (!bg || !fg) {
        continue;
      }
      const actual = contrastRatio(bg, fg);
      const required = contrastThreshold(level);
      if (actual + 1e-9 < required) {
        violations.push({
          minute: snapshot.minute,
          phase: snapshot.phase,
          nextPhase: snapshot.nextPhase,
          progress: snapshot.progress,
          bg: role.bg,
          fg: role.fg,
          level,
          required,
          actual
        });
      }
    }
  }
  return violations;
}

function formatMinute(minute: number): string {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Throws if any declared role pair drops below its required contrast.
 *
 * The message names the failing window, the worst minute, and the stop pair
 * responsible, because "assertion failed" starts a debugging session whereas
 * "1.00:1 at 16:33 (afternoon->dusk, t=0.51)" points at the cause.
 */
export function assertContrast<TPhase extends string = string>(
  system: ThemeSystem<TPhase>,
  options: AssertContrastOptions = {}
): void {
  const violations = findContrastViolations(system, options);
  if (violations.length === 0) {
    return;
  }

  const worst = violations.reduce((left, right) =>
    right.actual < left.actual ? right : left
  );
  const minutes = violations.map((violation) => violation.minute);
  const first = Math.min(...minutes);
  const last = Math.max(...minutes);

  throw new Error(
    `Contrast below ${worst.level} on ${violations.length} sample(s) ` +
      `between ${formatMinute(first)} and ${formatMinute(last)}.\n` +
      `  Worst: ${worst.actual.toFixed(2)}:1 at ${formatMinute(worst.minute)} ` +
      `("${worst.fg}" on "${worst.bg}", needs ${worst.required}:1)\n` +
      `  Interval: ${worst.phase} -> ${worst.nextPhase} at t=` +
      `${worst.progress.toFixed(2)}\n` +
      `  If the pair swaps sides here, use holdThenSnap() so the crossing ` +
      `occupies a single minute.`
  );
}

export interface ManualClockOptions {
  readonly now?: number | Date;
  readonly timezoneOffsetMinutes?: number;
}

export interface ManualClock {
  now(): Date;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
  requestAnimationFrame(callback: (timestamp: number) => void): number;
  cancelAnimationFrame(handle: number): void;
  advanceBy(ms: number): void;
  jumpTo(time: number | Date): void;
  setTimezoneOffset(minutes: number): void;
  getTimezoneOffset(): number;
  pendingTimers(): number;
}

type TimerKind = 'timeout' | 'raf';

interface ScheduledTimer {
  readonly id: number;
  readonly kind: TimerKind;
  readonly time: number;
  readonly callback: (timestamp?: number) => void;
}

export function createManualClock(
  options: ManualClockOptions = {}
): ManualClock {
  let currentTime = normalizeTime(options.now ?? Date.now());
  let timezoneOffsetMinutes =
    options.timezoneOffsetMinutes ?? new Date(currentTime).getTimezoneOffset();
  let nextId = 1;
  const timers = new Map<number, ScheduledTimer>();

  function now(): Date {
    return new ManualDate(currentTime, timezoneOffsetMinutes);
  }

  function setTimeout(callback: () => void, delayMs: number): number {
    const id = nextId++;
    timers.set(id, {
      id,
      kind: 'timeout',
      time: currentTime + Math.max(0, Math.trunc(delayMs)),
      callback
    });
    return id;
  }

  function clearTimeout(handle: number): void {
    timers.delete(handle);
  }

  function requestAnimationFrame(
    callback: (timestamp: number) => void
  ): number {
    const id = nextId++;
    timers.set(id, {
      id,
      kind: 'raf',
      time: currentTime + 16,
      callback: () => {
        callback(currentTime);
      }
    });
    return id;
  }

  function cancelAnimationFrame(handle: number): void {
    timers.delete(handle);
  }

  function advanceBy(ms: number): void {
    jumpTo(currentTime + Math.trunc(ms));
  }

  function jumpTo(time: number | Date): void {
    currentTime = normalizeTime(time);
    runDueTimers();
  }

  function setTimezoneOffset(minutes: number): void {
    timezoneOffsetMinutes = Math.trunc(minutes);
  }

  function getTimezoneOffset(): number {
    return timezoneOffsetMinutes;
  }

  function pendingTimers(): number {
    return timers.size;
  }

  function runDueTimers(): void {
    let ran = true;
    while (ran) {
      ran = false;
      const due = [...timers.values()]
        .filter((timer) => timer.time <= currentTime)
        .sort((a, b) => a.time - b.time || a.id - b.id);
      if (due.length === 0) {
        break;
      }
      for (const timer of due) {
        timers.delete(timer.id);
        timer.callback(currentTime);
        ran = true;
      }
    }
  }

  return {
    now,
    setTimeout,
    clearTimeout,
    requestAnimationFrame,
    cancelAnimationFrame,
    advanceBy,
    jumpTo,
    setTimezoneOffset,
    getTimezoneOffset,
    pendingTimers
  };
}

class ManualDate extends Date {
  #offsetMinutes: number;

  constructor(epochMs: number, offsetMinutes: number) {
    super(epochMs);
    this.#offsetMinutes = offsetMinutes;
  }

  override getTimezoneOffset(): number {
    return this.#offsetMinutes;
  }

  override getHours(): number {
    return this.#shifted().getUTCHours();
  }

  override getMinutes(): number {
    return this.#shifted().getUTCMinutes();
  }

  override getSeconds(): number {
    return this.#shifted().getUTCSeconds();
  }

  override getMilliseconds(): number {
    return this.#shifted().getUTCMilliseconds();
  }

  override getDay(): number {
    return this.#shifted().getUTCDay();
  }

  override getDate(): number {
    return this.#shifted().getUTCDate();
  }

  override getMonth(): number {
    return this.#shifted().getUTCMonth();
  }

  override getFullYear(): number {
    return this.#shifted().getUTCFullYear();
  }

  #shifted(): Date {
    return new Date(this.getTime() - this.#offsetMinutes * 60_000);
  }
}

function normalizeTime(input: number | Date): number {
  return input instanceof Date ? input.getTime() : Math.trunc(input);
}
