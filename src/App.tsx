import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { ensureSeeded } from './db/seed';
import { useSettings, useTheme } from './lib/hooks';
import { setPreferredVoice } from './lib/speech';
import { Home } from './pages/Home';
import { EditNote, Words } from './pages/Words';
import { Add } from './pages/Add';
import { Study } from './pages/Study';
import { Grammar } from './pages/Grammar';
import { Stats } from './pages/Stats';
import { useReminder } from './lib/reminder';
import { useAutoSync } from './sync/auto';
import { SettingsPage } from './pages/SettingsPage';

const NAV = [
  { to: '/', label: 'Home', icon: 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { to: '/words', label: 'Browse', icon: 'M4 5h16v3H4zm0 5.5h16v3H4zM4 16h16v3H4z' },
  { to: '/add', label: 'Add', icon: 'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z' },
  { to: '/grammar', label: 'Grammar', icon: 'M5 3h11l3 3v15H5zm3 5v2h8V8zm0 4v2h8v-2zm0 4v2h5v-2z' },
  { to: '/stats', label: 'Stats', icon: 'M4 20V10h3v10zm6.5 0V4h3v16zM17 20v-7h3v7z' },
  { to: '/settings', label: 'Settings', icon: 'M4 6h9v2H4zm13 0h3v2h-3zM4 11h3v2H4zm7 0h9v2h-9zM4 16h9v2H4zm13 0h3v2h-3zM14 4.5h2v5h-2zM8 9.5h2v5H8zm6 5h2v5h-2z' },
];

export function App() {
  const settings = useSettings();
  useTheme(settings.theme);
  useEffect(() => setPreferredVoice(settings.ttsVoice), [settings.ttsVoice]);
  useReminder(settings);
  useAutoSync();
  // Ask the browser not to evict the database when the device runs low on space.
  useEffect(() => {
    void navigator.storage?.persist?.().catch(() => false);
  }, []);

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
            <Route path="/grammar/:slug?" element={<Grammar />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Home />} />
          </Routes>
        )}
      </main>
      <nav className="tabbar" aria-label="Main">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className="tab">
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <path d={n.icon} fill="currentColor" />
            </svg>
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
