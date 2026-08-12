import { describe, expect, it } from 'vitest';
import { createManualClock } from '../src/testing.js';

describe('manual clock', () => {
  it('advances timers and supports timezone jumps', () => {
    const clock = createManualClock({ now: new Date('2026-08-12T00:00:00.000Z'), timezoneOffsetMinutes: 0 });
    const calls: string[] = [];

    clock.setTimeout(() => calls.push('timeout'), 1_000);
    clock.requestAnimationFrame(() => calls.push('raf'));
    expect(clock.pendingTimers()).toBe(2);

    clock.advanceBy(1_000);
    expect(calls).toContain('timeout');

    clock.advanceBy(16);
    expect(calls).toContain('raf');

    clock.setTimezoneOffset(-330);
    expect(clock.now().getTimezoneOffset()).toBe(-330);
    expect(clock.now().getHours()).toBe(5);
  });
});

