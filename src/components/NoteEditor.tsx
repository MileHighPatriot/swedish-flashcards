import { useId, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { listTags } from '../db/repo';
import { SwedishKeys } from './SwedishKeys';
import {
  CARD_TYPE_LABELS,
  PARTS_OF_SPEECH,
  VOCAB_CARD_TYPES,
  type Draft,
  type Gender,
  type NoteKind,
  type PartOfSpeech,
  type VocabCardType,
} from '../db/types';
import { parseTags } from '../lib/parser';

const KINDS: { value: NoteKind; label: string }[] = [
  { value: 'vocab', label: 'Word or phrase' },
  { value: 'rule', label: CARD_TYPE_LABELS.rule },
  { value: 'fix', label: CARD_TYPE_LABELS.fix },
  { value: 'reorder', label: CARD_TYPE_LABELS.reorder },
  { value: 'translate', label: CARD_TYPE_LABELS.translate },
];

const GRAMMAR_HELP: Record<Exclude<NoteKind, 'vocab'>, { prompt: string; answer: string }> = {
  rule: { prompt: 'Question about the rule', answer: 'Answer, with examples' },
  fix: { prompt: 'Sentence with the mistake', answer: 'Corrected sentence' },
  reorder: { prompt: 'Words to arrange, separated by " / "', answer: 'Correct sentence. Separate other valid orders with " // "' },
  translate: { prompt: 'English sentence', answer: 'Swedish sentence. Separate other valid answers with " // "' },
};

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="muted small">{hint}</span>}
    </label>
  );
}

const svProps = { lang: 'sv', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false } as const;

function Text(props: { value: string; onChange: (v: string) => void; sv?: boolean; rows?: number; placeholder?: string; required?: boolean }) {
  const { value, onChange, sv, rows, placeholder, required } = props;
  const common = { value, placeholder, required, ...(sv ? svProps : {}) };
  return rows ? (
    <textarea rows={rows} {...common} onChange={(e) => onChange(e.target.value)} />
  ) : (
    <input type="text" {...common} onChange={(e) => onChange(e.target.value)} />
  );
}

/** Comma-separated tags. Keeps its own text so typing ", " isn't swallowed. */
export function TagsInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [text, setText] = useState(tags.join(', '));
  const known = useLiveQuery(listTags, []) ?? [];
  const have = new Set(tags.map((t) => t.toLowerCase()));
  const suggestions = known.filter((t) => !have.has(t.toLowerCase())).slice(0, 14);
  const add = (t: string) => {
    const next = [...tags, t];
    setText(next.join(', '));
    onChange(next);
  };
  return (
    <>
    <input
      type="text"
      value={text}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      placeholder="family, food, verbs"
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseTags(e.target.value));
      }}
    />
      {suggestions.length > 0 && (
        <span className="tag-suggest" role="group" aria-label="Existing tags">
          {suggestions.map((t) => (
            <button key={t} type="button" className="pill pill-tag pill-btn" onClick={() => add(t)} aria-label={`Add tag ${t}`}>
              +{t}
            </button>
          ))}
        </span>
      )}
    </>
  );
}

export function CardTypePicker({ value, onChange }: { value: VocabCardType[]; onChange: (v: VocabCardType[]) => void }) {
  return (
    <fieldset className="checks">
      <legend className="field-label">Cards to make for each word</legend>
      {VOCAB_CARD_TYPES.map((t) => (
        <label key={t} className="check">
          <input
            type="checkbox"
            checked={t === 'basic' || value.includes(t)}
            disabled={t === 'basic'}
            onChange={(e) => onChange(e.target.checked ? [...value, t] : value.filter((x) => x !== t))}
          />
          {CARD_TYPE_LABELS[t]}
        </label>
      ))}
    </fieldset>
  );
}

export function NoteEditor({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  const uid = useId();
  const root = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });

  const setKind = (kind: NoteKind) => {
    if (kind === 'vocab') set({ kind, grammar: null });
    else set({ kind, grammar: draft.grammar ?? { prompt: '', answer: '', explanation: '', topic: null } });
  };

  const setPos = (pos: PartOfSpeech) => {
    const patch: Partial<Draft> = { pos };
    if (pos === 'noun' && !draft.noun) patch.noun = { gender: null, definite: '', plural: '' };
    if (pos === 'verb' && !draft.verb) patch.verb = { infinitive: draft.swedish, present: '', past: '', supine: '' };
    if (pos === 'adjective' && !draft.adjective) patch.adjective = { common: draft.swedish, neuter: '', plural: '' };
    set(patch);
  };

  const g = draft.grammar;
  const noun = draft.noun ?? { gender: null, definite: '', plural: '' };
  const verb = draft.verb ?? { infinitive: '', present: '', past: '', supine: '' };
  const adj = draft.adjective ?? { common: '', neuter: '', plural: '' };

  return (
    <div className="editor" ref={root}>
      <SwedishKeys container={root} />
      <Field label="Card type">
        <select value={draft.kind} onChange={(e) => setKind(e.target.value as NoteKind)}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </Field>

      {draft.kind !== 'vocab' && g ? (
        <>
          <Field label={GRAMMAR_HELP[draft.kind].prompt}>
            <Text value={g.prompt} rows={2} sv={draft.kind !== 'rule' && draft.kind !== 'translate'} onChange={(prompt) => set({ grammar: { ...g, prompt } })} />
          </Field>
          <Field label={GRAMMAR_HELP[draft.kind].answer}>
            <Text value={g.answer} rows={2} sv onChange={(answer) => set({ grammar: { ...g, answer } })} />
          </Field>
          <Field label="Explanation (shown on the back)">
            <Text value={g.explanation} rows={2} onChange={(explanation) => set({ grammar: { ...g, explanation } })} />
          </Field>
        </>
      ) : (
        <>
          <div className="field-grid">
            <Field label="Swedish">
              <Text value={draft.swedish} sv onChange={(swedish) => set({ swedish })} />
            </Field>
            <Field label="English">
              <Text value={draft.english} onChange={(english) => set({ english })} />
            </Field>
            <Field label="Part of speech">
              <select value={draft.pos} onChange={(e) => setPos(e.target.value as PartOfSpeech)}>
                {PARTS_OF_SPEECH.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {draft.pos === 'noun' && (
            <div className="field-grid">
              <fieldset className="segmented">
                <legend className="field-label">Gender</legend>
                {(['en', 'ett', null] as (Gender | null)[]).map((gen) => (
                  <label key={gen ?? 'none'} className={`seg ${noun.gender === gen ? `seg-on ${gen ? `seg-${gen}` : ''}` : ''}`}>
                    <input
                      type="radio"
                      name={`${uid}-gender`}
                      checked={noun.gender === gen}
                      onChange={() => set({ noun: { ...noun, gender: gen } })}
                    />
                    {gen ?? 'not set'}
                  </label>
                ))}
              </fieldset>
              <Field label="Definite (the …)">
                <Text value={noun.definite} sv placeholder="hunden" onChange={(definite) => set({ noun: { ...noun, definite } })} />
              </Field>
              <Field label="Plural">
                <Text value={noun.plural} sv placeholder="hundar" onChange={(plural) => set({ noun: { ...noun, plural } })} />
              </Field>
            </div>
          )}

          {draft.pos === 'verb' && (
            <div className="field-grid">
              {(['infinitive', 'present', 'past', 'supine'] as const).map((k) => (
                <Field key={k} label={k[0].toUpperCase() + k.slice(1)}>
                  <Text value={verb[k]} sv onChange={(v) => set({ verb: { ...verb, [k]: v } })} />
                </Field>
              ))}
            </div>
          )}

          {draft.pos === 'adjective' && (
            <div className="field-grid">
              <Field label="en form">
                <Text value={adj.common} sv placeholder="stor" onChange={(common) => set({ adjective: { ...adj, common } })} />
              </Field>
              <Field label="ett form">
                <Text value={adj.neuter} sv placeholder="stort" onChange={(neuter) => set({ adjective: { ...adj, neuter } })} />
              </Field>
              <Field label="Plural">
                <Text value={adj.plural} sv placeholder="stora" onChange={(plural) => set({ adjective: { ...adj, plural } })} />
              </Field>
            </div>
          )}

          <Field label="Example sentence (Swedish)">
            <Text value={draft.exampleSv} sv onChange={(exampleSv) => set({ exampleSv })} />
          </Field>
          <Field label="Example sentence (English)">
            <Text value={draft.exampleEn} onChange={(exampleEn) => set({ exampleEn })} />
          </Field>
          <Field label="Notes">
            <Text value={draft.notes} rows={2} onChange={(notes) => set({ notes })} />
          </Field>
        </>
      )}

      <Field label="Tags" hint="Separate with commas.">
        <TagsInput tags={draft.tags} onChange={(tags) => set({ tags })} />
      </Field>
    </div>
  );
}

/** Is there enough in this draft to save it? */
export function draftProblem(d: Draft): string | null {
  if (d.kind === 'vocab') return d.swedish.trim() && d.english.trim() ? null : 'Fill in both the Swedish and the English.';
  return d.grammar?.prompt.trim() && d.grammar.answer.trim() ? null : 'Fill in both the prompt and the answer.';
}
