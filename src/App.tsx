import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ensureSeeded } from './db/seed';
import { useSettings, useTheme } from './lib/hooks';
import { setPreferredVoice } from './lib/speech';
import { Home } from './pages/Home';
import { EditNote, Words } from './pages/Words';
import { Add } from './pages/Add';
import { Study } from './pages/Study';
import { Grammar } from './pages/Grammar';
import { Practice } from './pages/Practice';
import { Mistakes } from './pages/Mistakes';
import { Checkpoints } from './pages/Checkpoints';
import { Progress } from './pages/Progress';
import { Learn, More } from './pages/Hubs';
import { Verbs } from './pages/VerbTable';
import { NAV_TABS, tabFor } from './lib/nav';
import { Decks } from './pages/Decks';
import { useReminder } from './lib/reminder';
import { useAutoSync } from './sync/auto';
import { useNeuralPrefetch } from './lib/neural';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  const settings = useSettings();
  useTheme(settings.theme);
  useEffect(() => setPreferredVoice(settings.ttsVoice), [settings.ttsVoice]);
  useReminder(settings);
  useAutoSync();
  useNeuralPrefetch();
  // Ask the browser not to evict the database when the device runs low on space.
  useEffect(() => {
    void navigator.storage?.persist?.().catch(() => false);
  }, []);

  const active = tabFor(useLocation().pathname);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    ensureSeeded().then(
      () => setReady(true),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <main id="main" className="main" tabIndex={-1}>
        {error ? (
          <div className="card" role="alert">
            <h1>Could not open the database</h1>
            <p>{error}</p>
            <p className="muted">Private browsing windows sometimes block local storage. Try a normal window.</p>
          </div>
        ) : !ready ? (
          <p className="muted" role="status">
            Loading…
          </p>
        ) : (
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/words" element={<Words />} />
            <Route path="/add" element={<Add />} />
            <Route path="/edit/:id" element={<EditNote />} />
            <Route path="/study" element={<Study />} />
            <Route path="/mistakes" element={<Mistakes />} />
            <Route path="/checkpoints/:cp?" element={<Checkpoints />} />
            <Route path="/hours" element={<Navigate to="/progress?section=hours" replace />} />
            <Route path="/decks" element={<Decks />} />
            <Route path="/learn" element={<Learn />} />
            <Route path="/verbs" element={<Verbs />} />
            <Route path="/more" element={<More />} />
            <Route path="/practice/:tool?" element={<Practice />} />
            <Route path="/grammar/:slug?" element={<Grammar />} />
            <Route path="/progress" element={<Progress />} />
            {/* Old addresses of the three progress screens. /checkpoints (the list) redirects from inside Checkpoints. */}
            <Route path="/stats" element={<Navigate to="/progress?section=stats" replace />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Home />} />
          </Routes>
        )}
      </main>
      <nav className="tabbar" aria-label="Main">
        {NAV_TABS.map((n) => (
          <Link key={n.to} to={n.to} className={n === active ? 'tab active' : 'tab'} aria-current={n === active ? 'page' : undefined}>
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <path d={n.icon} fill="currentColor" />
            </svg>
            <span>{n.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
