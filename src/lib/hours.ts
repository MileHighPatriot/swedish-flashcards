// The hours log: what counts as study time, per day and per plan week.

import type { ReviewLog } from '../db/types';

/** A single review counts for at most this long, so a card left open does not log idle time. */
export const REVIEW_CAP_MS = 60_000;
/** The plan's minimum day: 15 minutes of flashcards. */
export const MIN_FLASHCARD_MINUTES = 15;

/** Time spent on these reviews, each one capped. Cram reviews count: they are time with the cards too. */
export function flashcardMs(reviews: Pick<ReviewLog, 'durationMs' | 'deletedAt'>[]): number {
  return reviews.reduce((sum, r) => (r.deletedAt == null ? sum + Math.min(Math.max(r.durationMs, 0), REVIEW_CAP_MS) : sum), 0);
}
