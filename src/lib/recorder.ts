// Record my own voice with the microphone, to play back next to the Swedish
// voice. Nothing is saved: the recording lives until the next one replaces it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { stopSpeaking } from './speech';

export type RecorderState = 'idle' | 'starting' | 'recording' | 'denied' | 'error';

export const recorderSupported = (): boolean =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

export function useRecorder() {
  const [state, setState] = useState<RecorderState>('idle');
  const [url, setUrl] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const release = useCallback(() => {
    recorder.current?.stream.getTracks().forEach((t) => t.stop());
    recorder.current = null;
  }, []);

  const clear = useCallback(() => {
    audio.current?.pause();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setUrl(null);
  }, []);

  useEffect(
    () => () => {
      release();
      audio.current?.pause();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [release],
  );

  const start = useCallback(async () => {
    if (!recorderSupported() || recorder.current) return;
    stopSpeaking();
    clear();
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
        const blob = new Blob(chunks, { type: rec.mimeType || chunks[0]?.type || 'audio/webm' });
        if (blob.size) {
          urlRef.current = URL.createObjectURL(blob);
          setUrl(urlRef.current);
        }
        setState('idle');
      };
      recorder.current = rec;
      rec.start();
      setState('recording');
    } catch (e) {
      release();
      setState(e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'error');
    }
  }, [clear, release]);

  const stop = useCallback(() => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }, []);

  const play = useCallback(() => {
    if (!urlRef.current) return;
    stopSpeaking();
    audio.current ??= new Audio();
    audio.current.src = urlRef.current;
    void audio.current.play().catch(() => undefined);
  }, []);

  return { state, hasRecording: url != null, start, stop, play, clear };
}
