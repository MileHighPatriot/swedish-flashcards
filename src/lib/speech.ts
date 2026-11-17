// Swedish audio: a recording attached to the card, the natural voice from
// Azure when it is set up (see neural.ts), or the browser's own text-to-speech.

import { useEffect, useState } from 'react';
import { db } from '../db/db';
import type { ID } from '../db/types';
import { getClip, neuralEnabled } from './neural';

export const speechSupported = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window;

let preferredURI = '';
let cachedVoice: SpeechSynthesisVoice | null | undefined;

/** Every Swedish voice on this device, best first (sv-SE, then offline voices). */
export function swedishVoices(): SpeechSynthesisVoice[] {
  if (!speechSupported()) return [];
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith('sv'));
  return voices.sort(
    (a, b) =>
      Number(b.lang.toLowerCase().endsWith('se')) - Number(a.lang.toLowerCase().endsWith('se')) ||
      Number(b.localService) - Number(a.localService) ||
      a.name.localeCompare(b.name),
  );
}

/** The voice chosen in Settings, or the best Swedish one available. */
export function swedishVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice !== undefined) return cachedVoice;
  const voices = swedishVoices();
  // Don't cache "none" while the browser is still loading its voice list.
  if (voices.length === 0) return null;
  cachedVoice = voices.find((v) => v.voiceURI === preferredURI) ?? voices[0];
  return cachedVoice;
}

/** Remember which voice to use ('' = choose automatically). */
export function setPreferredVoice(uri: string): void {
  preferredURI = uri;
  cachedVoice = undefined;
}

if (speechSupported()) {
  // Chrome loads voices asynchronously.
  window.speechSynthesis.addEventListener?.('voiceschanged', () => {
    cachedVoice = undefined;
  });
}

/** Live list of Swedish voices for the settings screen. */
export function useSwedishVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(swedishVoices);
  useEffect(() => {
    if (!speechSupported()) return;
    const update = () => setVoices(swedishVoices());
    update();
    window.speechSynthesis.addEventListener?.('voiceschanged', update);
    // Some browsers never fire the event; ask once more shortly after load.
    const t = window.setTimeout(update, 600);
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', update);
      window.clearTimeout(t);
    };
  }, []);
  return voices;
}

// One audio element for everything. On iPhone an element that has played once
// from a tap may play again later without one, which auto-play relies on.
let player: HTMLAudioElement | null = null;
let playerUrl = '';
let sayToken = 0;

export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel();
  player?.pause();
}

/** Say something in Swedish with the device's own voice. Stops whatever was playing. */
export function speak(text: string, rate = 1): void {
  stopSpeaking();
  if (!speechSupported() || !text.trim()) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'sv-SE';
  const voice = swedishVoice();
  if (voice) u.voice = voice;
  u.rate = Math.min(2, Math.max(0.3, rate));
  window.speechSynthesis.speak(u);
}

async function playBlob(blob: Blob, rate: number): Promise<boolean> {
  stopSpeaking();
  if (typeof Audio === 'undefined') return false;
  player ??= new Audio();
  if (playerUrl) URL.revokeObjectURL(playerUrl);
  playerUrl = URL.createObjectURL(blob);
  player.src = playerUrl;
  // Slowing a clip keeps its pitch, so slow playback still sounds natural.
  player.preservesPitch = true;
  player.defaultPlaybackRate = player.playbackRate = Math.min(2, Math.max(0.3, rate));
  try {
    await player.play();
    return true;
  } catch {
    return false;
  }
}

/** Play a recording from the media table. Resolves false if it is missing. */
export async function playMedia(id: ID, rate = 1): Promise<boolean> {
  const row = await db.media.get(id);
  if (!row || row.deletedAt != null || row.blob.size === 0) return false;
  return playBlob(row.blob, rate);
}

/**
 * Play Swedish: the card's own recording if it has one, then the natural
 * voice (saved clip, or fetched when online), then the device's voice.
 */
export function say(text: string, rate = 1, audioId?: ID | null): void {
  const token = ++sayToken;
  // Nothing to wait for: speak straight away, inside the tap.
  if (!audioId && !neuralEnabled()) return speak(text, rate);
  void (async () => {
    if (audioId && (await playMedia(audioId, rate))) return;
    if (token !== sayToken) return;
    const clip = await getClip(text);
    if (token !== sayToken) return;
    if (clip && (await playBlob(new Blob([clip.data], { type: clip.mime }), rate))) return;
    if (token === sayToken) speak(text, rate);
  })();
}

/** Can this device make Swedish sound at all (a voice, or at least speech support)? */
export const hasSwedishVoice = (): boolean => swedishVoices().length > 0;
