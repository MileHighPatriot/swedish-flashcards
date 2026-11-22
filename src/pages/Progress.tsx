import { useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSearchParams } from 'react-router-dom';
import { CHECKPOINTS } from '../data/plan';
import { listCheckpoints } from '../db/repo';
import { RESULT_LABELS, checkpointState, checkpointTitle } from '../lib/checkpoint';
import { useNow } from '../lib/hooks';
import { isRealSitting } from '../lib/plan';
import { CheckpointsOverview } from './Checkpoints';
import { HoursPanel } from './Hours';
import { StatsPanel } from './Stats';

const SECTIONS = [
  { id: 'checkpoints', label: 'Checkpoints' },
  { id: 'hours', label: 'Hours' },
  { id: 'stats', label: 'Stats' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

/** The next checkpoint's date and my last real result, in one line each. */
function CheckpointSummary() {
  const now = useNow();
  const rows = useLiveQuery(listCheckpoints, []);
  if (!rows) return null;
  const next = CHECKPOINTS.find((c) => !['taken', 'dismissed'].includes(checkpointState(c, now, rows)));
  const last = rows.filter(isRealSitting).sort((a, b) => b.at - a.at)[0];
  return (
    <dl className="progress-summary">
      <div>
        <dt>Next</dt>
        <dd>{next ? `${checkpointTitle(next.cp)}, ${day(next.date)}` : 'All checkpoints taken'}</dd>
      </div>
      <div>
        <dt>Last result</dt>
        <dd>{last ? `${last.label}: ${last.result ? RESULT_LABELS[last.result] : 'no result'}, production ${last.production == null ? '–' : `${Math.round(last.production * 100)}%`}` : 'None yet'}</dd>
      </div>
    </dl>
  );
}

/** One place for progress: checkpoints, hours, then the review stats. */
export function Progress() {
  const [params, setParams] = useSearchParams();
  const refs = useRef<Partial<Record<SectionId, HTMLElement | null>>>({});
  const wanted = params.get('section') as SectionId | null;

  // Old links (/stats, /hours, /checkpoints) land on their section.
  useEffect(() => {
    if (!wanted) return;
    const t = window.setTimeout(() => refs.current[wanted]?.scrollIntoView?.({ block: 'start' }), 60);
    return () => window.clearTimeout(t);
  }, [wanted]);

  return (
    <section>
      <header className="page-head">
        <h1>Progress</h1>
      </header>
      <nav className="subnav" aria-label="Sections of this page">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" className={wanted === s.id ? 'subnav-link is-on' : 'subnav-link'} aria-current={wanted === s.id ? 'true' : undefined} onClick={() => setParams({ section: s.id }, { replace: true })}>
            {s.label}
          </button>
        ))}
      </nav>

      <section
        aria-labelledby="progress-checkpoints"
        className="progress-section"
        ref={(el) => {
          refs.current.checkpoints = el;
        }}
      >
        <h2 id="progress-checkpoints">Checkpoints</h2>
        <p className="muted small">The 14 Sunday checkpoints and the Final from your B2 plan. Each is a 75-minute test: recall 15, production 20, writing 20, speaking 20.</p>
        <CheckpointSummary />
        <CheckpointsOverview />
      </section>

      <section
        aria-labelledby="progress-hours"
        className="progress-section"
        ref={(el) => {
          refs.current.hours = el;
        }}
      >
        <h2 id="progress-hours">Hours</h2>
        <HoursPanel />
      </section>

      <section
        aria-labelledby="progress-stats"
        className="progress-section"
        ref={(el) => {
          refs.current.stats = el;
        }}
      >
        <h2 id="progress-stats">Stats</h2>
        <StatsPanel />
      </section>
    </section>
  );
}
