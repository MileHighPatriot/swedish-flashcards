import { NavLink, Link } from 'react-router-dom';

interface Row {
  to: string;
  title: string;
  blurb: string;
}

function Hub({ title, intro, rows }: { title: string; intro: string; rows: Row[] }) {
  return (
    <section>
      <header className="page-head">
        <h1>{title}</h1>
        <p className="muted">{intro}</p>
      </header>
      <ul className="list">
        {rows.map((r) => (
          <li key={r.to} className="list-item">
            <Link className="list-link tool-link" to={r.to}>
              <span>
                <span className="list-title">{r.title}</span>
                <span className="tool-blurb">{r.blurb}</span>
              </span>
              <span aria-hidden="true">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export const LEARN_ROWS: Row[] = [
  { to: '/grammar', title: 'Grammar notes', blurb: 'Your notes pages, one per rule, and your weak spots.' },
  { to: '/words', title: 'Browse', blurb: 'Every card you have: search, edit, add.' },
  { to: '/verbs', title: 'Verbs', blurb: 'The verb table with all forms, and the verb drill.' },
];

export function Learn() {
  return <Hub title="Learn" intro="Look things up: the rules, your cards and your verbs." rows={LEARN_ROWS} />;
}

export const MORE_ROWS: Row[] = [
  { to: '/add', title: 'Add', blurb: 'Paste a lesson, add one card, import and back up files.' },
  { to: '/progress', title: 'Progress', blurb: 'Checkpoints, hours against the plan, streak and stats.' },
  { to: '/decks', title: 'Decks', blurb: 'All decks by plan week and lesson.' },
  { to: '/settings', title: 'Settings', blurb: 'Daily limits, audio, sync, reminders, your data.' },
];

export function More() {
  return <Hub title="More" intro="Everything that is not part of today’s study." rows={MORE_ROWS} />;
}

/** The three places under the Learn tab. */
export function LearnNav() {
  return (
    <nav className="subnav" aria-label="Learn">
      {[
        { to: '/grammar', label: 'Grammar' },
        { to: '/words', label: 'Browse' },
        { to: '/verbs', label: 'Verbs' },
      ].map((i) => (
        <NavLink key={i.to} to={i.to} className={({ isActive }) => (isActive ? 'subnav-link is-on' : 'subnav-link')}>
          {i.label}
        </NavLink>
      ))}
    </nav>
  );
}
