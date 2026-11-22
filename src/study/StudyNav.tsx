import { NavLink } from 'react-router-dom';

const ITEMS = [
  { to: '/study', label: 'Cards' },
  { to: '/mistakes', label: 'My mistakes' },
  { to: '/decks', label: 'Decks' },
];

/** The three places under the Study tab. */
export function StudyNav() {
  return (
    <nav className="subnav" aria-label="Study">
      {ITEMS.map((i) => (
        <NavLink key={i.to} to={i.to} className={({ isActive }) => (isActive ? 'subnav-link is-on' : 'subnav-link')}>
          {i.label}
        </NavLink>
      ))}
    </nav>
  );
}
