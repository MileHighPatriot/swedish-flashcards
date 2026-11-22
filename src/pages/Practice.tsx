import { Link, Navigate, useParams } from 'react-router-dom';
import { Builder } from '../practice/Builder';
import { Chat } from '../practice/Chat';
import { Dialogue } from '../practice/Dialogue';
import { Dictation } from '../practice/Dictation';
import { EnEtt } from '../practice/EnEtt';
import { Journal } from '../practice/Journal';
import { Reader } from '../practice/Reader';
import { Speak } from '../practice/Speak';
import { Story } from '../practice/Story';
import { PRACTICE_TOOLS, SKILLS, suggestedForToday } from '../lib/practiceTools';
import { useToday } from '../lib/useToday';

// The screens behind the tools. Titles, blurbs and skills are in lib/practiceTools.
const VIEWS: Record<string, () => React.ReactNode> = {
  dictation: Dictation,
  dialogue: Dialogue,
  chat: Chat,
  journal: Journal,
  speak: Speak,
  builder: Builder,
  story: Story,
  reader: Reader,
  'en-ett': EnEtt,
};

export function Practice() {
  const { tool } = useParams();
  const info = PRACTICE_TOOLS.find((t) => t.id === tool);
  const t = useToday();
  // The verb drill moved to the Verbs page, next to the verb table.
  if (tool === 'verbs') return <Navigate to="/verbs" replace />;

  const View = tool ? VIEWS[tool] : undefined;
  if (info && View)
    return (
      <section>
        <header className="page-head">
          <Link to="/practice" className="back-link">
            ← Practice
          </Link>
          <h1>{info.title}</h1>
        </header>
        <View />
      </section>
    );

  const suggested = t ? suggestedForToday(t.today) : [];
  return (
    <section>
      <header className="page-head">
        <h1>Practice</h1>
        <p className="muted">Beyond the cards, by skill. Everything is built from your own lessons.</p>
      </header>

      {suggested.length > 0 && (
        <section className="card suggested" aria-labelledby="suggested-title">
          <h2 id="suggested-title">Suggested for today</h2>
          <ul className="list">
            {suggested.map((s) => (
              <li key={s.to} className="list-item">
                <Link className="list-link tool-link" to={s.to}>
                  <span>
                    <span className="list-title">{s.title}</span>
                    <span className="tool-blurb">{s.why}</span>
                  </span>
                  <span aria-hidden="true">›</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {SKILLS.map((skill) => (
        <section key={skill} aria-labelledby={`skill-${skill}`}>
          <h2 id={`skill-${skill}`}>{skill}</h2>
          <ul className="list">
            {PRACTICE_TOOLS.filter((x) => x.skill === skill).map((x) => (
              <li key={x.id} className="list-item">
                <Link className="list-link tool-link" to={x.to}>
                  <span>
                    <span className="list-title">{x.title}</span>
                    <span className="tool-blurb">{x.blurb}</span>
                  </span>
                  <span aria-hidden="true">›</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
