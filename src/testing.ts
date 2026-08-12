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
