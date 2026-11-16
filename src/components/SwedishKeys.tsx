import { useEffect, useRef, type RefObject } from 'react';

const LETTERS = ['å', 'ä', 'ö', 'Å', 'Ä', 'Ö'];

type TextEl = HTMLInputElement | HTMLTextAreaElement;

/** Insert text at the cursor of a React-controlled input, so onChange fires. */
export function insertAtCursor(el: TextEl, text: string): void {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, el.value.slice(0, start) + text + el.value.slice(end));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.focus();
  try {
    el.setSelectionRange(start + text.length, start + text.length);
  } catch {
    /* input types without a selection (number, search on some browsers) */
  }
}

/**
 * A row of å ä ö buttons for a form. They type into whichever text box inside
 * `container` was used last, so one row serves the whole form.
 */
export function SwedishKeys({ container }: { container: RefObject<HTMLElement | null> }) {
  const last = useRef<TextEl | null>(null);
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    const onFocus = (e: FocusEvent) => {
      const t = e.target;
      if (t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && ['text', 'search'].includes(t.type))) last.current = t;
    };
    root.addEventListener('focusin', onFocus);
    return () => root.removeEventListener('focusin', onFocus);
  }, [container]);

  return (
    <div className="special-keys keys-bar" role="group" aria-label="Swedish letters">
      {LETTERS.map((ch) => (
        <button
          key={ch}
          type="button"
          className="key-btn"
          aria-label={`Insert ${ch}`}
          // Keep focus (and the phone keyboard) in the text box.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const el = last.current ?? container.current?.querySelector<TextEl>('input[lang="sv"], textarea[lang="sv"]') ?? null;
            if (el && el.isConnected) insertAtCursor(el, ch);
          }}
        >
          {ch}
        </button>
      ))}
    </div>
  );
}
