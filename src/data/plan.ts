// My Swedish B2 Plan, as data: the Week Map (which lessons belong to which
// plan week) and the checkpoints. 58 weeks from Mon 2026-11-23 to 2028-01-01,
// Lessons 6 to 160. Lessons 1 to 5 came from the old plan and count as week 0.
// The Google Sheet stays the source of truth; change this file when it changes.

export interface PlanWeek {
  week: number;
  /** The Monday the week starts, "YYYY-MM-DD". */
  start: string;
  /** First and last lesson of the week, or null for a week with no lessons. */
  lessons: [number, number] | null;
  /** The checkpoint taken on this week's Sunday (the Final: Saturday), if any. */
  checkpoint: string | null;
}

// week | starts (Mon) | lessons | checkpoint
const ROWS: [number, string, number, number, string?][] = [
  [1, '2026-11-23', 6, 8],
  [2, '2026-11-30', 9, 11],
  [3, '2026-12-07', 12, 14],
  [4, '2026-12-14', 15, 16, 'CP1'],
  [5, '2026-12-21', 17, 18],
  [6, '2026-12-28', 19, 21],
  [7, '2027-01-04', 22, 24],
  [8, '2027-01-11', 25, 26, 'CP2'],
  [9, '2027-01-18', 27, 29],
  [10, '2027-01-25', 30, 32],
  [11, '2027-02-01', 33, 35],
  [12, '2027-02-08', 36, 37, 'CP3'],
  [13, '2027-02-15', 38, 40],
  [14, '2027-02-22', 41, 43],
  [15, '2027-03-01', 44, 46],
  [16, '2027-03-08', 47, 48, 'CP4'],
  [17, '2027-03-15', 49, 51],
  [18, '2027-03-22', 52, 54],
  [19, '2027-03-29', 55, 57],
  [20, '2027-04-05', 58, 59, 'CP5'],
  [21, '2027-04-12', 60, 62],
  [22, '2027-04-19', 63, 65],
  [23, '2027-04-26', 66, 68],
  [24, '2027-05-03', 69, 70, 'CP6'],
  [25, '2027-05-10', 71, 73],
  [26, '2027-05-17', 74, 76],
  [27, '2027-05-24', 77, 79],
  [28, '2027-05-31', 80, 81, 'CP7'],
  [29, '2027-06-07', 82, 84],
  [30, '2027-06-14', 85, 87],
  [31, '2027-06-21', 88, 90],
  [32, '2027-06-28', 91, 92, 'CP8'],
  [33, '2027-07-05', 93, 95],
  [34, '2027-07-12', 96, 98],
  [35, '2027-07-19', 99, 101],
  [36, '2027-07-26', 102, 103, 'CP9'],
  [37, '2027-08-02', 104, 106],
  [38, '2027-08-09', 107, 109],
  [39, '2027-08-16', 110, 112],
  [40, '2027-08-23', 113, 114, 'CP10'],
  [41, '2027-08-30', 115, 117],
  [42, '2027-09-06', 118, 120],
  [43, '2027-09-13', 121, 123],
  [44, '2027-09-20', 124, 125, 'CP11'],
  [45, '2027-09-27', 126, 128],
  [46, '2027-10-04', 129, 131],
  [47, '2027-10-11', 132, 134],
  [48, '2027-10-18', 135, 136, 'CP12'],
  [49, '2027-10-25', 137, 139],
  [50, '2027-11-01', 140, 142],
  [51, '2027-11-08', 143, 145],
  [52, '2027-11-15', 146, 147, 'CP13'],
  [53, '2027-11-22', 148, 150],
  [54, '2027-11-29', 151, 153],
  [55, '2027-12-06', 154, 156],
  [56, '2027-12-13', 157, 158, 'CP14'],
  [57, '2027-12-20', 159, 160],
];

export const WEEK_MAP: PlanWeek[] = [
  ...ROWS.map(([week, start, first, last, checkpoint]): PlanWeek => ({ week, start, lessons: [first, last], checkpoint: checkpoint ?? null })),
  // Week 58 has no lessons; the Final is on Saturday 2028-01-01.
  { week: 58, start: '2027-12-27', lessons: null, checkpoint: 'Final' },
];

/** Lessons 1 to 5 (the old plan) are "before the plan". */
export const WEEK_ZERO_LESSONS: [number, number] = [1, 5];
export const PLAN_START = '2026-11-23';
export const PLAN_END = '2028-01-01';
export const TOTAL_TARGET_HOURS = 634;
/** 11 hours every week, except the two holiday weeks. */
export const WEEK_HOURS = 11;
export const SHORT_WEEKS: Record<number, number> = { 5: 9, 57: 9 };

export interface PlanPhase {
  phase: number;
  name: string;
  weeks: [number, number];
}

export const PHASES: PlanPhase[] = [
  { phase: 1, name: 'A2 solid', weeks: [1, 12] },
  { phase: 2, name: 'B1 foundation', weeks: [13, 28] },
  { phase: 3, name: 'B1 to B2 entry', weeks: [29, 44] },
  { phase: 4, name: 'B2 build', weeks: [45, 58] },
];

export interface PlanCheckpoint {
  cp: string;
  week: number;
  /** The day it is taken, "YYYY-MM-DD". */
  date: string;
  /** Set on the three phase gates and the Final. */
  gate: string | null;
}

// From the plan's Checkpoints tab.
export const CHECKPOINTS: PlanCheckpoint[] = [
  { cp: 'CP1', week: 4, date: '2026-12-20', gate: null },
  { cp: 'CP2', week: 8, date: '2027-01-17', gate: null },
  { cp: 'CP3', week: 12, date: '2027-02-14', gate: 'Phase 1 gate: A2 exit' },
  { cp: 'CP4', week: 16, date: '2027-03-14', gate: null },
  { cp: 'CP5', week: 20, date: '2027-04-11', gate: null },
  { cp: 'CP6', week: 24, date: '2027-05-09', gate: null },
  { cp: 'CP7', week: 28, date: '2027-06-06', gate: 'Phase 2 gate: B1 mock' },
  { cp: 'CP8', week: 32, date: '2027-07-04', gate: null },
  { cp: 'CP9', week: 36, date: '2027-08-01', gate: null },
  { cp: 'CP10', week: 40, date: '2027-08-29', gate: null },
  { cp: 'CP11', week: 44, date: '2027-09-26', gate: 'Phase 3 gate: B2 entry' },
  { cp: 'CP12', week: 48, date: '2027-10-24', gate: null },
  { cp: 'CP13', week: 52, date: '2027-11-21', gate: null },
  { cp: 'CP14', week: 56, date: '2027-12-19', gate: null },
  { cp: 'Final', week: 58, date: '2028-01-01', gate: 'Final B2 exam' },
];

/** The grammar each of the first plan weeks covers, for checkpoint writing prompts. Later weeks are filled in from imported lessons. */
export const WEEK_TOPICS: Record<number, string[]> = {
  0: ['past tense: -ade, -te, -de and irregular verbs', 'verb second after a time word or sedan', 'modal + infinitive', 'object pronouns and min, mitt, mina'],
  1: ['negation: where inte goes', 'aldrig', 'ingen, inget, inga', 'ingenting', 'inte in a main clause and in a subordinate clause'],
  2: ['subordinate clauses with att, om, när, för att, eftersom', 'inte before the verb after the conjunction'],
  3: ['question words and indirect questions', 'prepositions of place: i, på, vid, under, över, bredvid'],
  4: ['review: past tense, modals, negation, subordinate clauses, pronouns and possessives'],
};
