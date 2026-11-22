import { describe, expect, it } from 'vitest';
import { NAV_TABS, tabFor } from './nav';

describe('the tab bar', () => {
  it('has five tabs with short labels', () => {
    expect(NAV_TABS.map((t) => [t.label, t.to])).toEqual([
      ['Today', '/'],
      ['Study', '/study'],
      ['Practice', '/practice'],
      ['Learn', '/learn'],
      ['More', '/more'],
    ]);
    expect(Math.max(...NAV_TABS.map((t) => t.label.length))).toBeLessThanOrEqual(8);
  });

  it('puts every screen under one tab', () => {
    const where = (p: string) => tabFor(p).label;
    expect(['/', '/nope'].map(where)).toEqual(['Today', 'Today']);
    expect(['/study', '/mistakes', '/decks'].map(where)).toEqual(['Study', 'Study', 'Study']);
    expect(['/practice', '/practice/story', '/practice/journal'].map(where)).toEqual(['Practice', 'Practice', 'Practice']);
    expect(['/learn', '/grammar', '/grammar/verb-second', '/words', '/edit/abc', '/verbs'].map(where)).toEqual(['Learn', 'Learn', 'Learn', 'Learn', 'Learn', 'Learn']);
    expect(['/more', '/add', '/settings', '/progress', '/checkpoints/CP1'].map(where)).toEqual(['More', 'More', 'More', 'More', 'More']);
    // A path that only starts with the same letters is not that screen.
    expect(where('/studying')).toBe('Today');
  });
});
