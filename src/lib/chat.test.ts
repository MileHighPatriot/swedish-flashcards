import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { exportBackup, restoreBackup } from './backup';
import {
  CHAT_KV,
  CHAT_MODEL,
  KEPT_TURNS,
  REVIEW_MODEL,
  conversationBody,
  formatCost,
  loadChatKey,
  parseReview,
  replyCost,
  requestReply,
  requestReview,
  reviewBody,
  reviewHasSections,
  saveChatKey,
  textFromResponse,
  trimHistory,
  type ChatTurn,
} from './chat';

const turn = (role: ChatTurn['role'], content: string): ChatTurn => ({ role, content });

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('conversation requests', () => {
  it('keeps the latest lines and leaves the rest behind', () => {
    const turns = Array.from({ length: 30 }, (_, i) => turn(i % 2 ? 'assistant' : 'user', `line ${i}`));
    const kept = trimHistory(turns);
    expect(kept).toHaveLength(KEPT_TURNS * 2);
    expect(kept[0].content).toBe('line 14');
    expect(kept.at(-1)?.content).toBe('line 29');
  });

  it('asks the cheaper model to talk, with no thinking and no saved server copy', () => {
    const body = conversationBody('starting', 'at the café', [turn('user', 'Hej')]);
    expect(body.model).toBe(CHAT_MODEL);
    expect(body.store).toBe(false);
    expect(body).not.toHaveProperty('reasoning');
    expect(body.input[0].content).toContain('at the café');
    expect(body.input[0].content).toContain('only Swedish');
    expect(body.input.at(-1)).toEqual({ role: 'user', content: 'Hej' });
  });

  it('sends the whole chat to 4.7 with thinking set to low', () => {
    const turns = Array.from({ length: 20 }, (_, i) => turn('user', `säger ${i}`));
    const body = reviewBody(turns);
    expect(body.model).toBe(REVIEW_MODEL);
    expect(body.reasoning).toEqual({ effort: 'low' });
    expect(body.store).toBe(false);
    expect(body.input).toHaveLength(2);
    expect(body.input[1].content).toContain('säger 0');
    expect(body.input[1].content).toContain('säger 19');
  });
});

describe('the review', () => {
  it('splits the three headings and keeps a raw copy', () => {
    const review = parseReview('What you did wrong\n"jag vill kaffe" is missing a verb.\n\nWhat to say instead\nJag vill ha kaffe. (I want coffee.)\n\nTips\nPut ha after vill.');
    expect(review.wrong).toContain('vill kaffe');
    expect(review.instead).toContain('Jag vill ha kaffe');
    expect(review.tips).toContain('ha');
    expect(reviewHasSections(review)).toBe(true);
  });

  it('still has the whole text when the headings are missing', () => {
    const review = parseReview('You did well.');
    expect(reviewHasSections(review)).toBe(false);
    expect(review.raw).toBe('You did well.');
  });

  it('reads the spoken text and ignores the thinking trace', () => {
    const text = textFromResponse({
      output: [
        { type: 'reasoning', content: [{ type: 'output_text', text: 'hidden' }] },
        { type: 'message', content: [{ type: 'output_text', text: 'Hej! Vad vill du ha?' }] },
      ],
    });
    expect(text).toBe('Hej! Vad vill du ha?');
  });
});

describe('cost', () => {
  it('prices a short reply and a review from the published token rates', () => {
    expect(replyCost('chat', 1_700, 120)).toBeCloseTo(0.002425, 6);
    expect(replyCost('review', 5_000, 1_200)).toBeCloseTo(0.0172, 6);
    expect(formatCost(0.002425)).toBe('about 0.2¢');
    expect(formatCost(0.03)).toBe('about 3.0¢');
  });
});

describe('the key stays on the device', () => {
  it('is left out of backup files and survives a full restore', async () => {
    await saveChatKey('xai-secret');
    const backup = await exportBackup();
    expect(JSON.stringify(backup)).not.toContain('xai-secret');
    expect(backup.tables.kv.some((r) => r.key === CHAT_KV)).toBe(false);
    await restoreBackup(JSON.parse(JSON.stringify(backup)), 'replace');
    expect(await loadChatKey()).toBe('xai-secret');
  });
});

describe('calling the API', () => {
  it('sends the chat body and reports the token counts', async () => {
    let sent: { model?: string } = {};
    const fetchImpl: typeof fetch = async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hej!' }] }],
          usage: { input_tokens: 100, output_tokens: 10 },
        }),
        { status: 200 },
      );
    };
    const result = await requestReply('key', 'starting', '', [turn('user', 'Hej')], fetchImpl);
    expect(sent.model).toBe(CHAT_MODEL);
    expect(result.text).toBe('Hej!');
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 10 });
  });

  it('asks for the review with low thinking', async () => {
    let sent: { model?: string; reasoning?: unknown } = {};
    const fetchImpl: typeof fetch = async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ output_text: 'What you did wrong\nNone.' }), { status: 200 });
    };
    const result = await requestReview('key', [turn('user', 'Hej')], fetchImpl);
    expect(sent.model).toBe(REVIEW_MODEL);
    expect(sent.reasoning).toEqual({ effort: 'low' });
    expect(result.text).toContain('None');
  });
});
