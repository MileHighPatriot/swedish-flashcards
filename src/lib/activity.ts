// Active time in the practice tools, for the hours log. Time counts while the
// screen is visible and I have touched it in the last 60 seconds; it is added
// to this device's row for the day and the category.

import { useEffect } from 'react';
import { addAutoHours } from '../db/repo';
import type { HoursCategory } from '../db/types';
import { isoDate } from './plan';

/** Without a touch, a key or a pointer move for this long, the clock stops. */
export const IDLE_MS = 60_000;

export interface Meter {
  /** Call on any interaction. */
  touch(now: number): void;
  /** Call when the page is hidden or shown. */
  setVisible(visible: boolean, now: number): void;
  /** Active milliseconds since the last call, and reset. */
  take(now: number): number;
}

/** Pure bookkeeping, driven by timestamps, so it can be tested with a fake clock. */
export function createMeter(start: number, idleMs = IDLE_MS): Meter {
  let lastTouch = start;
  let mark = start; // counted up to here
  let visible = true;
  let total = 0;
  // Time counts from `mark` to `now`, but never past the moment I went idle.
  const settle = (now: number) => {
    if (visible) total += Math.max(0, Math.min(now, lastTouch + idleMs) - mark);
    mark = now;
  };
  return {
    touch(now) {
      settle(now);
      lastTouch = now;
    },
    setVisible(v, now) {
      settle(now);
      visible = v;
      if (v) lastTouch = now;
    },
    take(now) {
      settle(now);
      const out = total;
      total = 0;
      return out;
    },
  };
}

/** Log active time on this screen under a category of the hours log. */
export function useActivity(category: HoursCategory): void {
  useEffect(() => {
    const meter = createMeter(Date.now());
    const flush = () => {
      const ms = meter.take(Date.now());
      if (ms >= 1000) void addAutoHours(isoDate(Date.now()), category, ms).catch(() => undefined);
    };
    const touch = () => meter.touch(Date.now());
    const visibility = () => {
      meter.setVisible(document.visibilityState === 'visible', Date.now());
      if (document.visibilityState !== 'visible') flush();
    };
    const events = ['pointerdown', 'keydown', 'input', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', flush);
    const id = window.setInterval(flush, 30_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', flush);
      window.clearInterval(id);
      flush();
    };
  }, [category]);
}
