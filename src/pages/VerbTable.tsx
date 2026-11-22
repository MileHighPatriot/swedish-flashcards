import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { listCards, listMistakeItems, listMistakes, listNotes } from '../db/repo';
import { GROUP_LABELS, MISSING_FORM, VERB_GROUPS, filterVerbs, toDrillVerb, troubleNotes, verbTable, verbWeight, type VerbGroup } from '../lib/verbtable';
import { VERB_FORM_LABELS, type VerbForm } from '../lib/verbdrill';
import { VerbDrill } from './Grammar';
import { LearnNav } from './Hubs';

const Form = ({ label, value }: { label: string; value: string }) => (
  <div className="verb-form">
    <dt>{label}</dt>
    <dd lang={value ? 'sv' : undefined} className={value ? '' : 'muted'}>
      {value || MISSING_FORM}
    </dd>
  </div>
);

/** Every verb on my cards with its forms, grouped by how the past is made. */
export function VerbTable() {
  const data = useLiveQuery(async () => {
    const [notes, cards, items, mistakes] = await Promise.all([listNotes(), listCards(), listMistakeItems(), listMistakes()]);
    return { verbs: verbTable(notes), trouble: troubleNotes({ items, mistakes, cards, now: Date.now() }) };
  }, []);
  const [group, setGroup] = useState<VerbGroup | 'all'>('all');
  const [lesson, setLesson] = useState<number | 'all'>('all');
  const [drilling, setDrilling] = useState(false);
  const [form, setForm] = useState<VerbForm | 'mixed'>('mixed');
  const lessons = useMemo(() => [...new Set((data?.verbs ?? []).flatMap((v) => v.lessons))].sort((a, b) => a - b), [data]);

  if (!data) return <p className="muted">Loading…</p>;
  if (data.verbs.length === 0) return <p className="muted">No verbs on your cards yet.</p>;
  const shown = filterVerbs(data.verbs, group, lesson);
  const drillable = shown.filter((v) => (form === 'mixed' ? v.present || v.past || v.supine : v[form]));

  if (drilling)
    return (
      <VerbDrill
        preset={{
          verbs: drillable.map(toDrillVerb),
          weight: (v) => verbWeight({ noteId: v.noteId, group: data.verbs.find((x) => x.noteId === v.noteId)?.group ?? 'ar' }, data.trouble),
          form,
          onExit: () => setDrilling(false),
        }}
      />
    );

  return (
    <>
      <p className="muted">Every verb from your lessons. The forms come only from your cards.</p>
      <ul className="verb-legend" aria-label="Verb groups">
        {VERB_GROUPS.map((g) => (
          <li key={g}>
            <span className={`verb-group verb-group-${g}`}>{GROUP_LABELS[g]}</span> {data.verbs.filter((v) => v.group === g).length}
          </li>
        ))}
      </ul>
      <div className="filters">
        <label className="field">
          <span className="field-label">Group</span>
          <select value={group} onChange={(e) => setGroup(e.target.value as VerbGroup | 'all')}>
            <option value="all">All groups</option>
            {VERB_GROUPS.map((g) => (
              <option key={g} value={g}>
                {GROUP_LABELS[g]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Lesson</span>
          <select value={lesson} onChange={(e) => setLesson(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
            <option value="all">All lessons</option>
            {lessons.map((l) => (
              <option key={l} value={l}>
                Lesson {l}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Drill</span>
          <select value={form} onChange={(e) => setForm(e.target.value as VerbForm | 'mixed')}>
            <option value="mixed">Mostly past, forms mixed</option>
            {(Object.keys(VERB_FORM_LABELS) as VerbForm[]).map((f) => (
              <option key={f} value={f}>
                {VERB_FORM_LABELS[f]} only
              </option>
            ))}
          </select>
        </label>
      </div>
      <button type="button" className="btn btn-primary btn-big" disabled={drillable.length === 0} onClick={() => setDrilling(true)}>
        Drill these ({drillable.length})
      </button>
      <p className="muted small">
        The drill runs here, on the verbs you have filtered. -er verbs, irregular verbs and the ones you have been getting wrong come up more often.
      </p>
      <p className="small" role="status">
        {shown.length} verb{shown.length === 1 ? '' : 's'}
      </p>
      <ul className="list">
        {shown.map((v) => (
          <li key={v.infinitive} className="list-item word">
            <div className="word-main">
              <span>
                <strong className="word-sv" lang="sv">
                  {v.infinitive}
                </strong>{' '}
                <span className="word-en">{v.english}</span>
              </span>
              <span className={`verb-group verb-group-${v.group}`}>{GROUP_LABELS[v.group]}</span>
            </div>
            <dl className="verb-forms">
              <Form label="Present" value={v.present} />
              <Form label="Past" value={v.past} />
              <Form label="Third form" value={v.supine} />
            </dl>
            <div className="word-tags">
              {v.lessons.map((l) => (
                <span key={l} className="pill pill-tag">
                  Lesson {l}
                </span>
              ))}
              {data.trouble.has(v.noteId) && <span className="pill pill-warn">needs work</span>}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The Verbs page under Learn: the table with its filters, and the drill on the same page. */
export function Verbs() {
  return (
    <section>
      <LearnNav />
      <header className="page-head">
        <h1>Verbs</h1>
      </header>
      <VerbTable />
    </section>
  );
}
