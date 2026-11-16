// Daily study reminder. There is no server, so the browser can only notify
// while the app is open or still alive in the background; a fully closed app
// cannot wake itself. The check runs once a minute.

import { useEffect } from 'react';
import { getTodayCounts } from '../db/repo';
import type { Settings } from '../db/types';
import { studyDayKey } from './scheduler';

const LAST_KEY = 'svenska-kort:last-reminder';

export const notificationsSupported = (): boolean => typeof window !== 'undefined' && 'Notification' in window;

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

export async function askForNotifications(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

async function notify(title: string, body: string): Promise<void> {
  const options: NotificationOptions = { body, tag: 'daily-reminder', icon: './pwa-192.png', badge: './pwa-192.png' };
  // Installed apps (and Android) need the service worker to show it.
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  if (reg) await reg.showNotification(title, options);
  else new Notification(title, options);
}

/** Minutes since midnight for "HH:MM". */
export function minutesOf(time: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : 19 * 60;
}

/** Should the reminder fire now? Pure, so it can be tested. */
export function reminderDue(settings: Pick<Settings, 'reminderEnabled' | 'reminderTime' | 'dayStartHour'>, now: number, lastFiredDay: string | null): boolean {
  if (!settings.reminderEnabled) return false;
  const d = new Date(now);
  const minutes = d.getHours() * 60 + d.getMinutes();
  // After the day rolls over (e.g. 4 a.m.) but before the reminder time: not yet.
  if (minutes < minutesOf(settings.reminderTime)) return false;
  // Between midnight and the rollover we are still in "yesterday": stay quiet.
  if (d.getHours() < settings.dayStartHour) return false;
  return lastFiredDay !== studyDayKey(now, settings.dayStartHour);
}

export async function sendTestNotification(): Promise<void> {
  await notify('Svenska Kort', 'This is what your reminder will look like.');
}

/** Runs the once-a-minute check for as long as the app is open. */
export function useReminder(settings: Settings): void {
  const { reminderEnabled, reminderTime, dayStartHour, dailyGoal } = settings;
  useEffect(() => {
    if (!reminderEnabled || notificationPermission() !== 'granted') return;
    const check = async () => {
      const now = Date.now();
      let last: string | null = null;
      try {
        last = localStorage.getItem(LAST_KEY);
      } catch {
        /* ignore */
      }
      if (!reminderDue({ reminderEnabled, reminderTime, dayStartHour }, now, last)) return;
      const counts = await getTodayCounts(now);
      const waiting = counts.dueToday + counts.newToday;
      try {
        localStorage.setItem(LAST_KEY, studyDayKey(now, dayStartHour));
      } catch {
        /* ignore */
      }
      // Nothing to nag about once the goal is met or nothing is waiting.
      if (counts.doneToday >= dailyGoal || waiting === 0) return;
      await notify('Dags att plugga svenska!', `${waiting} card${waiting === 1 ? '' : 's'} waiting. ${counts.doneToday} of ${dailyGoal} done today.`);
    };
    void check();
    const id = window.setInterval(() => void check(), 60_000);
    return () => window.clearInterval(id);
  }, [reminderEnabled, reminderTime, dayStartHour, dailyGoal]);
}
