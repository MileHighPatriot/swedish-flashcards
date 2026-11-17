import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useSearchParams } from 'react-router-dom';
import { getKV, updateSettings } from '../db/repo';
import { downloadBackup } from '../lib/backup';
import { askForNotifications, notificationPermission, sendTestNotification } from '../lib/reminder';
import { signInAndSync, signOutOfSync, syncNow, useSyncStatus } from '../sync/auto';
import type { Settings, ThemeSetting } from '../db/types';
import { useSettings } from '../lib/hooks';
import { MAX_RETENTION, MIN_RETENTION, clampRetention } from '../lib/scheduler';
import { say, setPreferredVoice, speechSupported, useSwedishVoices } from '../lib/speech';
import { DEFAULT_NEURAL_REGION, DEFAULT_NEURAL_VOICE, NEURAL_VOICES, clearClips, neuralConfig, parseKeyInput, requestClip, saveNeural, useNeuralStatus } from '../lib/neural';

function clampInt(value: string, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  if (value.trim() === '' || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function SyncCard() {
  const sync = useSyncStatus();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const go = async (create: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await signInAndSync(email.trim(), password, create);
      if (r === 'confirm-email') setMessage('Check your email and tap the confirmation link, then come back and press Sign in.');
      else setPassword('');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>Sync between devices</h2>
      {!sync.configured ? (
        <p className="muted">Sync is not switched on in this copy of the app, so your progress stays on this device. Use a backup file to move it.</p>
      ) : sync.email ? (
        <>
          <p>
            Signed in as <strong>{sync.email}</strong>.
          </p>
          <p className="muted small" role="status">
            {sync.state === 'syncing'
              ? 'Syncing…'
              : sync.state === 'error'
                ? `Could not sync: ${sync.error}`
                : sync.lastSyncedAt
                  ? `Up to date as of ${new Date(sync.lastSyncedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.`
                  : 'Not synced yet.'}
          </p>
          <div className="actions">
            <button type="button" className="btn btn-primary" disabled={sync.state === 'syncing'} onClick={() => void syncNow()}>
              Sync now
            </button>
            <button type="button" className="btn" onClick={() => void signOutOfSync()}>
              Sign out
            </button>
          </div>
          <p className="muted small">Sign in with the same account on your other devices. Changes sync on their own a few seconds after you make them.</p>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void go(false);
          }}
        >
          <p className="muted">Sign in on your Mac and your phone with the same account, and your cards, reviews and streak stay the same on both.</p>
          <label className="field">
            <span className="field-label">Email</span>
            <input type="email" autoComplete="username" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !email.trim() || password.length < 6}>
              Sign in
            </button>
            <button type="button" className="btn" disabled={busy || !email.trim() || password.length < 6} onClick={() => void go(true)}>
              Create account
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function NaturalVoice() {
  const st = useNeuralStatus();
  const saved = st.enabled ? neuralConfig() : null;
  const [key, setKey] = useState('');
  const [region, setRegion] = useState(DEFAULT_NEURAL_REGION);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const turnOn = async (k = key, r = region) => {
    setBusy(true);
    setMessage(null);
    const cfg = { ...parseKeyInput(k, r), voice: DEFAULT_NEURAL_VOICE };
    try {
      // One short clip proves the key and region before anything is saved.
      await requestClip(cfg, 'Hej!');
      await saveNeural(cfg);
      setKey('');
      say('Hej! Jag lär mig svenska.', 1);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  // A setup link (…#/settings?voicekey=…&region=…) fills this in without typing.
  // The key is taken out of the address straight away.
  const [params, setParams] = useSearchParams();
  const linkKey = params.get('voicekey');
  const linkRegion = params.get('region');
  useEffect(() => {
    if (!linkKey) return;
    setParams({}, { replace: true });
    void turnOn(linkKey, linkRegion || DEFAULT_NEURAL_REGION);
    // Runs once, when the link is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkKey]);

  if (busy && !key) return <p className="subcard muted">Setting up the natural voice…</p>;

  if (saved)
    return (
      <div className="subcard">
        <h3>Natural voice</h3>
        <label className="field">
          <span className="field-label">Voice</span>
          <select value={saved.voice} onChange={(e) => void saveNeural({ ...saved, voice: e.target.value })}>
            {NEURAL_VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small" role="status">
          {st.total === 0
            ? 'Checking your cards…'
            : st.ready >= st.total
              ? `All ${st.total} clips are saved on this device and play offline.`
              : `${st.ready} of ${st.total} clips saved on this device.${st.running ? ' Downloading the rest, about 12 a minute, while the app is open.' : ''}`}
          {st.error && ` ${st.error}`}
        </p>
        <p className="muted small">New cards get their clips the same way after you add a lesson. Until a clip is saved, the card uses the device voice below.</p>
        <div className="actions">
          <button type="button" className="btn btn-small" onClick={() => void clearClips()}>
            Download clips again
          </button>
          <button type="button" className="btn btn-small" onClick={() => void saveNeural(null)}>
            Turn off
          </button>
        </div>
      </div>
    );

  return (
    <details className="subcard">
      <summary>
        <strong>Natural voice</strong> <span className="muted small">a real-sounding Swedish voice, using your own Azure Speech key</span>
      </summary>
      <p className="muted small">
        Paste the key and region of your Azure Speech resource. The key stays on this device; it is not synced or put in backup files, so enter it once on
        each device.
      </p>
      <div className="field-grid">
        <label className="field">
          <span className="field-label">Key</span>
          <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Region</span>
          <input type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={region} onChange={(e) => setRegion(e.target.value)} />
        </label>
      </div>
      {message && (
        <p className="notice" role="alert">
          {message}
        </p>
      )}
      <div className="actions">
        <button type="button" className="btn btn-primary btn-small" disabled={busy || !key.trim() || !region.trim()} onClick={() => void turnOn()}>
          {busy ? 'Checking…' : 'Turn on'}
        </button>
      </div>
    </details>
  );
}

export function SettingsPage() {
  const s = useSettings();
  const voices = useSwedishVoices();
  const [permission, setPermission] = useState(notificationPermission);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const lastBackupAt = useLiveQuery(() => getKV<number>('lastBackupAt'), []);
  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted, () => setPersisted(null));
  }, []);
  const toggleReminder = async (on: boolean) => {
    if (on) setPermission(await askForNotifications());
    void updateSettings({ reminderEnabled: on });
  };
  // Every change is written straight to the database: no Save button to forget.
  const set = (patch: Partial<Settings>) => void updateSettings(patch);

  const num = (label: string, key: 'newPerDay' | 'reviewsPerDay' | 'dailyGoal' | 'leechThreshold', min: number, max: number) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={s[key]}
        onChange={(e) => set({ [key]: clampInt(e.target.value, min, max, s[key]) })}
      />
    </label>
  );

  return (
    <section>
      <header className="page-head">
        <h1>Settings</h1>
        <p className="muted">Changes save automatically.</p>
      </header>

      <div className="card">
        <h2>Appearance</h2>
        <fieldset className="segmented">
          <legend className="field-label">Theme</legend>
          {(['system', 'light', 'dark'] as ThemeSetting[]).map((t) => (
            <label key={t} className={s.theme === t ? 'seg seg-on' : 'seg'}>
              <input type="radio" name="theme" value={t} checked={s.theme === t} onChange={() => set({ theme: t })} />
              {t[0].toUpperCase() + t.slice(1)}
            </label>
          ))}
        </fieldset>
      </div>

      <div className="card">
        <h2>Scheduling</h2>
        <label className="field">
          <span className="field-label">
            Target retention: <strong>{Math.round(s.targetRetention * 100)}%</strong>
          </span>
          <input
            type="range"
            min={MIN_RETENTION * 100}
            max={MAX_RETENTION * 100}
            step={1}
            value={Math.round(s.targetRetention * 100)}
            onChange={(e) => set({ targetRetention: clampRetention(Number(e.target.value) / 100) })}
            aria-describedby="retention-help"
          />
          <span id="retention-help" className="muted small">
            How likely you should be to remember a card when it comes back. Higher means more reviews. 90% is a good
            default.
          </span>
        </label>

        <div className="field-grid">
          {num('New cards per day', 'newPerDay', 0, 500)}
          {num('Reviews per day', 'reviewsPerDay', 0, 5000)}
          {num('Daily goal (reviews)', 'dailyGoal', 1, 1000)}
          {num('Leech after this many lapses (0 = off)', 'leechThreshold', 0, 50)}
        </div>
      </div>

      <div className="card">
        <h2>Swedish audio</h2>
        <NaturalVoice />
        {!speechSupported() ? (
          <p className="notice">This browser cannot speak. Cards with their own recording still play.</p>
        ) : voices.length === 0 ? (
          <div className="notice">
            <p>
              <strong>No Swedish voice found on this device.</strong> Words may be read with the wrong accent until you add one:
            </p>
            <ul>
              <li>iPhone or iPad: Settings → Accessibility → Spoken Content → Voices → Swedish (Alva).</li>
              <li>Mac: System Settings → Accessibility → Spoken Content → System Voice → Manage Voices → Swedish.</li>
              <li>Windows: Settings → Time &amp; language → Speech → Add voices → Swedish.</li>
              <li>Android: Settings → System → Languages → Text-to-speech → install Swedish voice data.</li>
            </ul>
            <p>Then reopen the app.</p>
          </div>
        ) : (
          <label className="field">
            <span className="field-label">Device voice</span>
            <select
              value={voices.some((v) => v.voiceURI === s.ttsVoice) ? s.ttsVoice : ''}
              onChange={(e) => {
                setPreferredVoice(e.target.value);
                set({ ttsVoice: e.target.value });
              }}
            >
              <option value="">Automatic ({voices[0].name})</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang}){v.localService ? '' : ', needs internet'}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="check">
          <input type="checkbox" checked={s.autoPlayAudio} onChange={(e) => set({ autoPlayAudio: e.target.checked })} />
          Play the Swedish automatically while studying
        </label>

        <div className="field-grid">
          <label className="field">
            <span className="field-label">
              Normal speed: <strong>{s.ttsRate.toFixed(2)}×</strong>
            </span>
            <input type="range" min={0.6} max={1.3} step={0.05} value={s.ttsRate} onChange={(e) => set({ ttsRate: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span className="field-label">
              Slow speed: <strong>{s.ttsSlowRate.toFixed(2)}×</strong>
            </span>
            <input type="range" min={0.3} max={0.9} step={0.05} value={s.ttsSlowRate} onChange={(e) => set({ ttsSlowRate: Number(e.target.value) })} />
          </label>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-small" onClick={() => say('Hej! Jag lär mig svenska.', s.ttsRate)}>
            Test
          </button>
          <button type="button" className="btn btn-small" onClick={() => say('Hej! Jag lär mig svenska.', s.ttsSlowRate)}>
            Test slow
          </button>
        </div>
        <p className="muted small">
          On a Mac keyboard, Option+A types å, and Option+U followed by A or O types ä or ö. The å ä ö buttons appear wherever you type Swedish.
        </p>
      </div>

      <div className="card">
        <h2>en and ett</h2>
        <p>
          <span className="gender gender-en">en</span> words are always blue and <span className="gender gender-ett">ett</span> words always amber, on
          every screen, so the gender sticks along with the word.
        </p>
      </div>

      <div className="card">
        <h2>Daily reminder</h2>
        <label className="check">
          <input type="checkbox" checked={s.reminderEnabled} onChange={(e) => void toggleReminder(e.target.checked)} disabled={permission === 'unsupported'} />
          Remind me to study
        </label>
        <label className="field">
          <span className="field-label">At</span>
          <input type="time" value={s.reminderTime} onChange={(e) => e.target.value && set({ reminderTime: e.target.value })} disabled={!s.reminderEnabled} />
        </label>
        {permission === 'unsupported' && <p className="notice">This browser does not support notifications. On an iPhone, add the app to your Home Screen first, then open it from there.</p>}
        {permission === 'denied' && <p className="notice">Notifications are blocked for this site. Allow them in your browser's site settings, then turn this on again.</p>}
        {s.reminderEnabled && permission === 'granted' && (
          <button type="button" className="btn btn-small" onClick={() => void sendTestNotification()}>
            Send a test notification
          </button>
        )}
        <p className="muted small">
          You are only reminded if cards are waiting and your daily goal is not met. There is no server behind this app, so the reminder can only fire
          while the app is open or still running in the background. If it is fully closed, nothing can wake it.
        </p>
      </div>

      <SyncCard />

      <div className="card">
        <h2>Your data</h2>
        <p>
          Everything is stored on this device first, so the app always works offline.{' '}
          {persisted === true
            ? 'The browser has agreed to keep it even when space runs low.'
            : persisted === false
              ? 'The browser may clear it if the device runs very low on space, so keep a backup. Installing the app usually fixes this.'
              : ''}
        </p>
        <p className="muted small">Last backup: {lastBackupAt ? new Date(lastBackupAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : 'never'}.</p>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={() => void downloadBackup()}>
            Download backup
          </button>
          <Link className="btn" to="/add?tab=files">
            Restore, import, export
          </Link>
        </div>
      </div>

      <div className="card">
        <h2>Install</h2>
        <p className="muted">
          The app works offline once it has been opened. To put it on your phone: in Chrome on iPhone, tap Share, then “Add to Home Screen”. In Chrome on
          a computer, use the install icon in the address bar.
        </p>
      </div>
    </section>
  );
}
