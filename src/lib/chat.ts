// Free conversation. The talk uses a non-reasoning model. One review at the end
// uses Grok 4.7 with thinking set to low. The key stays on this device: it is
// never synced or written into a backup. Scripted role-plays never call this.

import { db } from '../db/db';

export const CHAT_KV = 'xaiChat';
export const RESPONSES_URL = 'https://api.x.ai/v1/responses';
export const CHAT_MODEL = 'grok-4.20-0309-non-reasoning';
export const REVIEW_MODEL = 'grok-4.7';

/** Earlier exchanges resent with each reply. Older lines are dropped. The review still sees the whole chat. */
export const KEPT_TURNS = 8;
export const CHAT_MAX_OUTPUT = 180;
export const REVIEW_MAX_OUTPUT = 900;

/** USD per token. Short-context list prices: 4.20 non-reasoning, and 4.7. */
export const CHAT_INPUT_PER_TOKEN = 1.25 / 1_000_000;
export const CHAT_OUTPUT_PER_TOKEN = 2.5 / 1_000_000;
export const REVIEW_INPUT_PER_TOKEN = 2 / 1_000_000;
export const REVIEW_OUTPUT_PER_TOKEN = 6 / 1_000_000;

export type ChatLevel = 'starting' | 'comfortable';
export type ChatRole = 'user' | 'assistant';

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ReviewSections {
  wrong: string;
  instead: string;
  tips: string;
  raw: string;
}

const LEVEL_LINE: Record<ChatLevel, string> = {
  starting: 'They are just starting Swedish. Use very short sentences, the present tense, and common words.',
  comfortable: 'They can manage a simple conversation. Use everyday Swedish, including the simple past, and stay clear.',
};

export function conversationPrompt(level: ChatLevel, topic: string): string {
  const topicLine = topic.trim()
    ? `The topic is: ${topic.trim()}. Stay on it unless they change the subject.`
    : 'There is no set topic. Follow what they bring up.';
  return [
    'You are a Swedish conversation partner. Have a normal conversation.',
    LEVEL_LINE[level],
    topicLine,
    'Reply with only Swedish: two or three short sentences. No English, no corrections, no labels, no lesson.',
    'If they write in English, answer in Swedish as if they had said it in Swedish.',
    'Sound like a person talking, not a textbook.',
  ].join('\n');
}

export function reviewPrompt(): string {
  return [
    'You are a Swedish teacher reviewing one practice conversation.',
    'Write in plain English. The learner wants three things: what they got wrong, what they should have said, and a few tips.',
    'Use exactly these three headings, each alone on its own line:',
    'What you did wrong',
    'What to say instead',
    'Tips',
    'Quote their Swedish when you point out a mistake. Skip lines that were fine. If they made no mistakes, say so under the first heading.',
    'Under "What to say instead", give the Swedish they should have used, with the English in parentheses.',
    'Under Tips, give two or three short points tied to something they actually said.',
    'Do not continue the conversation.',
  ].join('\n');
}

export function trimHistory(turns: ChatTurn[], kept = KEPT_TURNS): ChatTurn[] {
  const max = kept * 2;
  return turns.length <= max ? turns : turns.slice(turns.length - max);
}

export function transcript(turns: ChatTurn[]): string {
  return turns.map((t) => `${t.role === 'user' ? 'Learner' : 'Partner'}: ${t.content}`).join('\n');
}

export function conversationBody(level: ChatLevel, topic: string, turns: ChatTurn[]) {
  return {
    model: CHAT_MODEL,
    store: false,
    temperature: 0.7,
    max_output_tokens: CHAT_MAX_OUTPUT,
    input: [{ role: 'system' as const, content: conversationPrompt(level, topic) }, ...trimHistory(turns)],
  };
}

export function reviewBody(turns: ChatTurn[]) {
  return {
    model: REVIEW_MODEL,
    store: false,
    temperature: 0.7,
    max_output_tokens: REVIEW_MAX_OUTPUT,
    reasoning: { effort: 'low' as const },
    input: [
      { role: 'system' as const, content: reviewPrompt() },
      { role: 'user' as const, content: transcript(turns) },
    ],
  };
}

export function replyCost(kind: 'chat' | 'review', inputTokens: number, outputTokens: number): number {
  if (kind === 'review') return inputTokens * REVIEW_INPUT_PER_TOKEN + outputTokens * REVIEW_OUTPUT_PER_TOKEN;
  return inputTokens * CHAT_INPUT_PER_TOKEN + outputTokens * CHAT_OUTPUT_PER_TOKEN;
}

/** A short price for the screen, from the token counts the API returned. */
export function formatCost(usd: number): string {
  const cents = usd * 100;
  if (!(cents > 0)) return 'about 0¢';
  if (cents < 0.1) return 'under 0.1¢';
  if (cents < 10) return `about ${cents.toFixed(1)}¢`;
  if (cents < 100) return `about ${Math.round(cents)}¢`;
  return `about $${usd.toFixed(2)}`;
}

const HEADING: Record<Exclude<keyof ReviewSections, 'raw'>, RegExp> = {
  wrong: /^what you did wrong$/i,
  instead: /^what to say instead$/i,
  tips: /^tips$/i,
};

function headingOf(line: string): keyof typeof HEADING | null {
  const t = line
    .trim()
    .replace(/^#{1,3}\s*/, '')
    .replace(/^\*\*(.*)\*\*$/, '$1')
    .replace(/:$/, '')
    .trim();
  for (const key of Object.keys(HEADING) as (keyof typeof HEADING)[]) {
    if (HEADING[key].test(t)) return key;
  }
  return null;
}

/** Split a review into the three sections. If the headings are missing, `raw` still holds the whole text. */
export function parseReview(raw: string): ReviewSections {
  const buckets: Record<keyof typeof HEADING, string[]> = { wrong: [], instead: [], tips: [] };
  let current: keyof typeof HEADING | null = null;
  for (const line of raw.replace(/\r\n/g, '\n').split('\n')) {
    const key = headingOf(line);
    if (key) {
      current = key;
      continue;
    }
    if (current) buckets[current].push(line);
  }
  const take = (key: keyof typeof HEADING) => buckets[key].join('\n').trim();
  return { wrong: take('wrong'), instead: take('instead'), tips: take('tips'), raw: raw.trim() };
}

export function reviewHasSections(review: ReviewSections): boolean {
  return Boolean(review.wrong || review.instead || review.tips);
}

interface ResponsesJson {
  output_text?: string;
  output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

export function textFromResponse(body: ResponsesJson): string {
  if (typeof body.output_text === 'string' && body.output_text.trim()) return body.output_text.trim();
  const parts: string[] = [];
  for (const item of body.output ?? []) {
    if (item.type === 'reasoning') continue;
    for (const part of item.content ?? []) {
      if (part.type === 'output_text' && part.text) parts.push(part.text);
    }
  }
  return parts.join('\n').trim();
}

export function usageFromResponse(body: ResponsesJson): ChatUsage | null {
  const inputTokens = body.usage?.input_tokens;
  const outputTokens = body.usage?.output_tokens;
  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') return null;
  return { inputTokens, outputTokens };
}

export class ChatError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function describeChatError(status: number): string {
  if (status === 401 || status === 403) return 'The API did not accept the key. Check it in Settings.';
  if (status === 402) return 'The API account has no credit left.';
  if (status === 429) return 'The API is busy. Wait a minute and try again.';
  if (status === 0) return 'No connection. Nothing was sent.';
  return `The API answered with an error (${status}).`;
}

async function callApi(key: string, body: unknown, fetchImpl: typeof fetch): Promise<{ text: string; usage: ChatUsage | null }> {
  let res: Response;
  try {
    res = await fetchImpl(RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ChatError(0, describeChatError(0));
  }
  const json = (await res.json().catch(() => null)) as ResponsesJson | null;
  if (!res.ok) throw new ChatError(res.status, json?.error?.message || describeChatError(res.status));
  const text = json ? textFromResponse(json) : '';
  if (!text) throw new ChatError(res.status, 'The API sent back an empty reply.');
  return { text, usage: json ? usageFromResponse(json) : null };
}

export function requestReply(key: string, level: ChatLevel, topic: string, turns: ChatTurn[], fetchImpl: typeof fetch = fetch) {
  return callApi(key, conversationBody(level, topic, turns), fetchImpl);
}

export function requestReview(key: string, turns: ChatTurn[], fetchImpl: typeof fetch = fetch) {
  return callApi(key, reviewBody(turns), fetchImpl);
}

export async function loadChatKey(): Promise<string | null> {
  const value = (await db.kv.get(CHAT_KV))?.value;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function saveChatKey(key: string | null): Promise<void> {
  if (key?.trim()) await db.kv.put({ key: CHAT_KV, value: key.trim(), updatedAt: Date.now() });
  else await db.kv.delete(CHAT_KV);
}
