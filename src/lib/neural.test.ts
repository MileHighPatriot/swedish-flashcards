import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { exportBackup, restoreBackup } from './backup';
import { MAX_PER_MINUTE, NEURAL_KV, clipKey, getClip, loadNeural, missingClips, prefetch, resetSlots, saveNeural, spokenTexts, ssml, takeSlot } from './neural';

const cfg = { key: 'secret-key', region: 'westus2', voice: 'sv-SE-SofieNeural' };
const audio = () => new Response(new Uint8Array([1, 2, 3]), { status: 200 });
const note = (over: Record<string, unknown>) => ({ swedish: '', exampleSv: '', kind: 'vocab', grammar: null, audioId: null, deletedAt: null, ...over }) as never;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await loadNeural();
  resetSlots();
  fetchMock = vi.fn(async () => audio());
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('what gets a clip', () => {
  it('takes words, examples and the first accepted grammar answer, without repeats', () => {
    const texts = spokenTexts([
      note({ swedish: 'hund', exampleSv: 'Jag har en hund.' }),
      note({ swedish: 'hund' }),
      note({ kind: 'translate', grammar: { prompt: 'x', answer: 'Igår städade vi. // Vi städade igår.', explanation: '', topic: '' } }),
      note({ kind: 'rule', grammar: { prompt: 'When?', answer: 'Verb second.', explanation: '', topic: '' } }),
      note({ swedish: 'katt', audioId: 'rec1' }),
      note({ swedish: 'borta', deletedAt: 5 }),
    ]);
    expect(texts).toEqual(['hund', 'Jag har en hund.', 'Igår städade vi.']);
  });

  it('keys clips by voice and tidied text', () => {
    expect(clipKey('v', '  Hej   då ')).toBe('v|Hej då');
  });

  it('escapes text inside the request and leaves the Swedish alone', () => {
    expect(ssml('sv-SE-SofieNeural', 'Tom & <Anna> åäö')).toBe(
      "<speak version='1.0' xml:lang='sv-SE'><voice name='sv-SE-SofieNeural'>Tom &amp; &lt;Anna&gt; åäö</voice></speak>",
    );
  });
});

describe('clips', () => {
  it('does nothing until a key is saved', async () => {
    expect(await getClip('hund')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches a clip once, then plays it from the device', async () => {
    await saveNeural(cfg);
    fetchMock.mockClear();
    const first = await getClip('hund');
    const second = await getClip('hund');
    expect(first?.data.byteLength).toBe(3);
    expect(second?.data.byteLength).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://westus2.tts.speech.microsoft.com/cognitiveservices/v1');
    expect((init.headers as Record<string, string>)['Ocp-Apim-Subscription-Key']).toBe('secret-key');
  });

  it('falls back quietly when Azure refuses', async () => {
    await saveNeural(cfg);
    fetchMock.mockImplementation(async () => new Response('', { status: 401 }));
    expect(await getClip('katt')).toBeNull();
    expect(await db.tts.count()).toBe(0);
  });

  it('stays under the per-minute limit', () => {
    const t = 1_000_000;
    for (let i = 0; i < MAX_PER_MINUTE; i++) expect(takeSlot(t + i)).toBe(0);
    expect(takeSlot(t + 100)).toBeGreaterThan(59_000);
    expect(takeSlot(t + 61_000)).toBe(0);
  });

  it('downloads every missing clip in the background, and only the missing ones', async () => {
    await db.notes.bulkAdd([
      { id: 'n1', swedish: 'hund', exampleSv: 'Jag har en hund.', kind: 'vocab', updatedAt: 1, deletedAt: null },
      { id: 'n2', swedish: 'katt', exampleSv: '', kind: 'vocab', updatedAt: 1, deletedAt: null },
    ] as never);
    await saveNeural(cfg);
    await prefetch(async () => resetSlots());
    expect((await missingClips(cfg)).missing).toEqual([]);
    expect(await db.tts.count()).toBe(3);
    fetchMock.mockClear();
    await prefetch(async () => resetSlots());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the key stays on the device', () => {
  it('is left out of backup files and survives a full restore', async () => {
    await saveNeural(cfg);
    await getClip('hund');
    const backup = await exportBackup();
    expect(JSON.stringify(backup)).not.toContain('secret-key');
    expect(backup.tables.kv.some((r) => r.key === NEURAL_KV)).toBe(false);
    await restoreBackup(JSON.parse(JSON.stringify(backup)), 'replace');
    expect((await loadNeural())?.key).toBe('secret-key');
    expect(await db.tts.count()).toBe(1);
  });
});
