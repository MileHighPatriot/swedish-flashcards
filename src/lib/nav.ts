// The five tabs, and which tab every screen belongs to.

export interface NavTab {
  to: string;
  label: string;
  icon: string;
  /** Path prefixes that light this tab up. */
  owns: string[];
}

export const NAV_TABS: NavTab[] = [
  { to: '/', label: 'Today', icon: 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z', owns: [] },
  { to: '/study', label: 'Study', icon: 'M5 4h11a2 2 0 0 1 2 2v11H7a2 2 0 0 1-2-2zm3 4v2h7V8zm0 4v2h5v-2zM8 19h12V8h1.5v12.5H8z', owns: ['/study', '/mistakes', '/decks'] },
  { to: '/practice', label: 'Practice', icon: 'M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zm-6 8a6 6 0 0 0 5 5.9V20H8v2h8v-2h-3v-3.1A6 6 0 0 0 18 11h-2a4 4 0 0 1-8 0z', owns: ['/practice'] },
  { to: '/learn', label: 'Learn', icon: 'M5 3h11l3 3v15H5zm3 5v2h8V8zm0 4v2h8v-2zm0 4v2h5v-2z', owns: ['/learn', '/grammar', '/words', '/edit', '/verbs'] },
  { to: '/more', label: 'More', icon: 'M5 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z', owns: ['/more', '/add', '/settings', '/progress', '/checkpoints', '/stats', '/hours'] },
];

/** The tab a path sits under. Anything unknown is Today. */
export function tabFor(pathname: string): NavTab {
  const path = pathname === '' ? '/' : pathname;
  return NAV_TABS.find((t) => t.owns.some((p) => path === p || path.startsWith(`${p}/`))) ?? NAV_TABS[0];
}
