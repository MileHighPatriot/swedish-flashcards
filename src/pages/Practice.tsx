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

const TOOLS = [
  { id: 'dictation', title: 'Dictation', blurb: 'Hear a sentence, type what you heard.', skill: 'Listening', view: Dictation },
  { id: 'dialogue', title: 'Dialogue role-play', blurb: 'Pick a situation, from the café to the in-laws, and play your part.', skill: 'Speaking', view: Dialogue },
  { id: 'chat', title: 'Free conversation', blurb: 'Talk freely. A review at the end shows what to fix.', skill: 'Speaking', view: Chat },
  { id: 'journal', title: 'Journal', blurb: 'Write about your day. Mistakes come back as fix cards.', skill: 'Writing', view: Journal },
  { id: 'speak', title: 'Record and compare', blurb: 'Say a sentence, then hear yourself next to the Swedish voice.', skill: 'Speaking', view: Speak },
  { id: 'builder', title: 'Sentence builder', blurb: 'See a sentence in English, type it in Swedish, word by word feedback.', skill: 'Writing', view: Builder },
  { id: 'story', title: 'Story mode', blurb: 'Read a story, listen to it, then answer questions in Swedish.', skill: 'Reading', view: Story },
  { id: 'reader', title: 'Reader', blurb: 'Short texts where every word can be tapped.', skill: 'Reading', view: Reader },
  { id: 'en-ett', title: 'en or ett', blurb: 'Pick the right article for your nouns.', skill: 'Grammar', view: EnEtt },
];

export function Practice() {
  const { tool } = useParams();
  const current = TOOLS.find((t) => t.id === tool);
  // The verb drill moved to the Verbs page, next to the verb table.
  if (tool === 'verbs') return <Navigate to="/verbs" replace />;

  if (current) {
    const View = current.view;
    return (
      <section>
        <header className="page-head">
          <Link to="/practice" className="back-link">
            ← Practice
          </Link>
          <h1>{current.title}</h1>
        </header>
        <View />
      </section>
    );
  }

  return (
    <section>
      <header className="page-head">
        <h1>Practice</h1>
        <p className="muted">Beyond the cards: listening, speaking, writing and reading, all built from your own lessons.</p>
      </header>
      <ul className="list">
        {TOOLS.map((t) => (
          <li key={t.id} className="list-item">
            <Link className="list-link tool-link" to={`/practice/${t.id}`}>
              <span>
                <span className="list-title">{t.title}</span>
                <span className="tool-blurb">{t.blurb}</span>
              </span>
              <span className="pill pill-tag">{t.skill}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
