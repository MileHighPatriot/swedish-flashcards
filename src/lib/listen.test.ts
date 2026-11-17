import { describe, expect, it } from 'vitest';
import { encodeWav, heardText } from './listen';

describe('encodeWav', () => {
  it('writes a 16-bit mono WAV header and clamps the samples', () => {
    const wav = new DataView(encodeWav(new Float32Array([0, 1, -1, 2, -2]), 16000));
    const tag = (at: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => wav.getUint8(at + i)));
    expect(wav.byteLength).toBe(44 + 10);
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(wav.getUint32(4, true)).toBe(36 + 10);
    expect(wav.getUint16(22, true)).toBe(1);
    expect(wav.getUint32(24, true)).toBe(16000);
    expect(wav.getUint16(34, true)).toBe(16);
    expect(wav.getUint32(40, true)).toBe(10);
    expect([0, 1, 2, 3, 4].map((i) => wav.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767, -32768]);
  });
});

describe('heardText', () => {
  it('returns the text only when Azure recognised speech', () => {
    expect(heardText({ RecognitionStatus: 'Success', DisplayText: ' Hej, hur mår du? ' })).toBe('Hej, hur mår du?');
    expect(heardText({ RecognitionStatus: 'NoMatch' })).toBe('');
    expect(heardText({ RecognitionStatus: 'InitialSilenceTimeout', DisplayText: '' })).toBe('');
    expect(heardText(null)).toBe('');
  });
});
