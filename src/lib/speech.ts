// Swedish audio: the browser's text-to-speech (Web Speech API, sv-SE), or a
// recording attached to the card when there is one.

import { useEffect, useState } from 'react';
import { db } from '../db/db';
import type { ID } from '../db/types';

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

let currentAudio: HTMLAudioElement | null = null;

export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

/** Say something in Swedish with text-to-speech. Stops whatever was playing. */
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

/** Play a recording from the media table. Resolves false if it is missing. */
export async function playMedia(id: ID, rate = 1): Promise<boolean> {
  const row = await db.media.get(id);
  if (!row || row.deletedAt != null || row.blob.size === 0) return false;
  stopSpeaking();
  const url = URL.createObjectURL(row.blob);
  const audio = new Audio(url);
  audio.playbackRate = Math.min(2, Math.max(0.3, rate));
  audio.preservesPitch = true;
  audio.onended = audio.onerror = () => URL.revokeObjectURL(url);
  currentAudio = audio;
  try {
    await audio.play();
    return true;
  } catch {
    URL.revokeObjectURL(url);
    return false;
  }
}

/** Play the card's own recording if it has one, otherwise speak the text. */
export function say(text: string, rate = 1, audioId?: ID | null): void {
  if (!audioId) return speak(text, rate);
  void playMedia(audioId, rate).then((ok) => {
    if (!ok) speak(text, rate);
  });
}

/** Can this device make Swedish sound at all (a voice, or at least speech support)? */
export const hasSwedishVoice = (): boolean => swedishVoices().length > 0;
