// Speak instead of type: record a line with the microphone and let Azure
// Speech (the same key as the natural voice) write it down in Swedish.
// Nothing is saved: the recording is sent once and thrown away.

import { useCallback, useEffect, useRef, useState } from 'react';
import { NeuralError, neuralConfig, type NeuralConfig } from './neural';
import { recorderSupported } from './recorder';
import { stopSpeaking } from './speech';

/** Azure's short-audio service takes up to a minute; stop a little before. */
export const MAX_SECONDS = 50;
const RATE = 16000;

// ---------- pure helpers ----------

/** Mono samples (-1..1) as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate = RATE): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

/** What Azure heard, or '' when it heard no words. */
export function heardText(body: unknown): string {
  const b = body as { RecognitionStatus?: string; DisplayText?: string } | null;
  return b?.RecognitionStatus === 'Success' ? (b.DisplayText ?? '').trim() : '';
}

// ---------- browser work ----------

/** Whatever the browser recorded (webm, mp4…) as 16 kHz mono WAV. */
export async function toWav(recording: Blob): Promise<ArrayBuffer> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const data = await recording.arrayBuffer();
    // The callback form also works on older iPhones.
    const decoded = await new Promise<AudioBuffer>((resolve, reject) => {
      const p = ctx.decodeAudioData(data, resolve, reject);
      if (p) p.then(resolve, reject);
    });
    const length = Math.max(1, Math.ceil(decoded.duration * RATE));
    const offline = new OfflineAudioContext(1, length, RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return encodeWav(rendered.getChannelData(0), RATE);
  } finally {
    void ctx.close().catch(() => undefined);
  }
}

/** Send one WAV recording to Azure and get the Swedish text back. */
export async function transcribe(cfg: NeuralConfig, wav: ArrayBuffer): Promise<string> {
  let res: Response;
  try {
    res = await fetch(
      `https://${encodeURIComponent(cfg.region.trim())}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=sv-SE&format=simple`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': cfg.key.trim(),
          'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
          Accept: 'application/json',
        },
        body: wav,
      },
    );
  } catch {
    throw new NeuralError(0, 'Could not reach Azure. Check your connection.');
  }
  if (!res.ok) {
    throw new NeuralError(
      res.status,
      res.status === 401 || res.status === 403
        ? 'Azure did not accept the key. Check it in Settings.'
        : res.status === 429
          ? 'Azure is busy or the free allowance is used up. Try again in a minute.'
          : `Azure answered with an error (${res.status}).`,
    );
  }
  return heardText(await res.json());
}

export type ListenState = 'idle' | 'starting' | 'recording' | 'working' | 'denied' | 'error';

/** Whether speaking can work here: a microphone, and the Azure key on this device. */
export const listenReady = (): boolean => recorderSupported() && neuralConfig() != null;

/** Tap to talk, tap to stop; `onText` gets what was heard. */
export function useListen(onText: (text: string) => void) {
  const [state, setState] = useState<ListenState>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const deliver = useRef(onText);
  deliver.current = onText;

  const release = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    recorder.current?.stream.getTracks().forEach((t) => t.stop());
    recorder.current = null;
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      release();
    };
  }, [release]);

  const stop = useCallback(() => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }, []);

  const start = useCallback(async () => {
    const cfg = neuralConfig();
    if (!recorderSupported() || !cfg || recorder.current) return;
    stopSpeaking();
    setMessage(null);
    setState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onstop = () => {
        release();
        if (!alive.current) return;
        const blob = new Blob(chunks, { type: rec.mimeType || chunks[0]?.type || 'audio/webm' });
        setState('working');
        void (async () => {
          try {
            const text = blob.size ? await transcribe(cfg, await toWav(blob)) : '';
            if (!alive.current) return;
            if (text) deliver.current(text);
            else setMessage('I did not catch any words. Try again, a little closer to the microphone.');
            setState('idle');
          } catch (e) {
            if (!alive.current) return;
            setMessage(e instanceof NeuralError ? e.message : 'Could not turn that recording into text.');
            setState('idle');
          }
        })();
      };
      recorder.current = rec;
      rec.start();
      timer.current = setTimeout(stop, MAX_SECONDS * 1000);
      setState('recording');
    } catch (e) {
      release();
      setState(e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'error');
    }
  }, [release, stop]);

  return { state, message, start, stop };
}
