import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../api/client';
import { qk } from '../api/hooks';
import { useViewport } from '../lib/useViewport';
import s from './Login.module.css';

/** Only same-origin paths: rejects `//evil.com`, `/\evil.com` and absolute URLs. */
function safeNext(next: string | null) {
  if (!next || next[0] !== '/' || next[1] === '/' || next[1] === '\\') return '/';
  try {
    return new URL(next, location.origin).origin === location.origin ? next : '/';
  } catch {
    return '/';
  }
}

function LockIcon({ open, color }: { open: boolean; color: string }) {
  return (
    <div className={s.icon} style={{ color }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ overflow: 'visible' }}>
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path
          d="M8 11V7a4 4 0 0 1 8 0v4"
          style={{ transformBox: 'view-box', transformOrigin: '16px 11px', transform: open ? 'translateY(-3px) rotate(28deg)' : 'none', transition: 'transform .38s cubic-bezier(.3,1.5,.5,1)' }}
        />
      </svg>
    </div>
  );
}

export function Login() {
  const { vw } = useViewport();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const [shake, setShake] = useState(0);
  const [requesting, setRequesting] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (state === 'sending') return;
    setState('sending');
    try {
      await api('/auth/magic-link', { body: { email } });
      setState('sent');
      setMsg('');
    } catch (err) {
      setState('error');
      setMsg(errorMessage(err));
      setShake((n) => n + 1);
    }
  }

  const signedIn = async () => {
    await qc.invalidateQueries({ queryKey: qk.me });
    nav(safeNext(params.get('next')), { replace: true });
  };

  if (requesting) {
    return (
      <RequestCard
        email={email}
        onBack={() => {
          setRequesting(false);
          setState('idle');
        }}
      />
    );
  }

  if (state === 'sent') {
    return (
      <CodeCard
        onRequest={() => setRequesting(true)}
        email={email.trim()}
        onResend={() => void submit()}
        onChangeEmail={() => {
          setState('idle');
          setTimeout(() => ref.current?.focus(), 50);
        }}
        onSignedIn={signedIn}
      />
    );
  }

  return (
    <div className={s.stage}>
      <form
        className={s.card}
        onSubmit={submit}
        style={{ padding: vw < 600 ? 22 : 30, animation: shake ? `kshake${shake % 2} .42s ease` : 'kpop .3s cubic-bezier(.3,1.4,.5,1) both' }}
      >
        <div className={s.head}>
          <LockIcon open={false} color="var(--ink)" />
          <div>
            <div className={s.title}>Sign in to Memento</div>
            <div className={s.sub}>We'll email you a code and a link. No password needed.</div>
          </div>
        </div>
        <div className={s.row}>
          <input
            ref={ref}
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (state === 'error') setState('idle');
            }}
            placeholder="you@email.com"
            aria-label="Email"
            autoComplete="email"
            className={s.input}
            style={{ borderColor: state === 'error' ? '#C0443A' : 'var(--line)' }}
          />
          <button type="submit" className={s.btn} disabled={state === 'sending'}>
            {state === 'sending' ? 'Sending…' : 'Send code'}
          </button>
        </div>
        <div className={s.msg} style={{ color: state === 'error' ? '#C0443A' : 'var(--ink2)' }}>
          {msg || 'Use the email your family invited.'}
        </div>
        <div className={s.links}>
          <button type="button" className={s.link} onClick={() => setRequesting(true)}>
            New here? Request access
          </button>
        </div>
      </form>
    </div>
  );
}

/** Six boxes for the emailed code, styled like the PIN modal. Submits on the sixth digit. */
function CodeCard({ email, onResend, onChangeEmail, onSignedIn, onRequest }: { email: string; onResend: () => void; onChangeEmail: () => void; onSignedIn: () => Promise<void>; onRequest: () => void }) {
  const { vw } = useViewport();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const [resent, setResent] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => ref.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  async function onChange(v: string) {
    const next = v.replace(/\D/g, '').slice(0, 6);
    setCode(next);
    setError(null);
    if (next.length < 6 || busy) return;
    setBusy(true);
    try {
      await api('/auth/verify-code', { body: { email, code: next } });
      setSuccess(true);
      setTimeout(() => void onSignedIn(), 600);
    } catch (e) {
      setCode('');
      setShake((n) => n + 1);
      setError(errorMessage(e));
      ref.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  const narrow = vw < 600;
  const box = narrow ? 42 : 48;
  return (
    <div className={s.stage}>
      <div
        className={s.card}
        style={{ padding: narrow ? 22 : 30, animation: success ? 'none' : shake ? `kshake${shake % 2} .42s ease` : 'kpop .3s cubic-bezier(.3,1.4,.5,1) both' }}
      >
        <div className={s.head}>
          <LockIcon open={success} color={success ? '#5E8B5A' : 'var(--ink)'} />
          <div>
            <div className={s.title}>Check your email</div>
            <div className={s.sub}>
              We sent a code and a link to <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{email}</b>. Type the code here, or tap the link.
            </div>
          </div>
        </div>
        <div className={s.boxes} onClick={() => ref.current?.focus()}>
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const n = code.length;
            const border = success ? '#5E8B5A' : error ? '#C0443A' : i === n ? 'var(--accent)' : 'var(--line)';
            return (
              <div key={i} className={s.box} style={{ width: box, height: box + 8, borderColor: border, transform: `scale(${!success && i === n ? 1.04 : 1})`, marginLeft: i === 3 ? 8 : 0 }}>
                {code[i] ?? ''}
              </div>
            );
          })}
          <input
            ref={ref}
            value={code}
            onChange={(e) => void onChange(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            aria-label="6-digit code"
            className={s.hidden}
          />
        </div>
        <div className={s.msg} style={{ color: success ? '#5E8B5A' : error ? '#C0443A' : 'var(--ink2)' }}>
          {success ? 'Signed in. Opening the library…' : error ?? (resent ? 'A new code is on its way.' : 'The code works once, for 15 minutes.')}
        </div>
        {!success && (
          <div className={s.links}>
            <button
              type="button"
              className={s.link}
              onClick={() => {
                onResend();
                setResent(true);
                setCode('');
                setError(null);
                ref.current?.focus();
              }}
            >
              Send a new code
            </button>
            <button type="button" className={s.link} onClick={onChangeEmail}>
              Use a different email
            </button>
          </div>
        )}
        {!success && (
          <div className={s.sub} style={{ marginTop: -4 }}>
            No email after a few minutes? Your address may not be on the family list yet.{' '}
            <button type="button" className={s.link} onClick={onRequest}>
              Request access
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Asks the family admin to let a new email in. */
function RequestCard({ email: initialEmail, onBack }: { email: string; onBack: () => void }) {
  const { vw } = useViewport();
  const [name, setName] = useState('');
  const [email, setEmail] = useState(initialEmail);
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(0);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (state !== 'idle') return;
    setState('sending');
    setError('');
    try {
      await api('/auth/request-access', { body: { email, name, note } });
      setState('sent');
    } catch (err) {
      setState('idle');
      setError(errorMessage(err));
      setShake((n) => n + 1);
    }
  }

  const pad = vw < 600 ? 22 : 30;
  if (state === 'sent') {
    return (
      <div className={s.stage}>
        <div className={s.card} style={{ padding: pad, animation: 'kpop .3s cubic-bezier(.3,1.4,.5,1) both' }}>
          <div className={s.head}>
            <LockIcon open color="#5E8B5A" />
            <div>
              <div className={s.title}>Request sent</div>
              <div className={s.sub}>We've asked the family admin to let you in. You'll get an email with your invite once they approve it. If you're already a member, we've emailed you a sign-in code instead.</div>
            </div>
          </div>
          <div className={s.links}>
            <button type="button" className={s.link} onClick={onBack}>Back to sign in</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={s.stage}>
      <form className={s.card} onSubmit={submit} style={{ padding: pad, animation: shake ? `kshake${shake % 2} .42s ease` : 'kpop .3s cubic-bezier(.3,1.4,.5,1) both' }}>
        <div className={s.head}>
          <LockIcon open={false} color="var(--ink)" />
          <div>
            <div className={s.title}>Request access</div>
            <div className={s.sub}>Memento is private to the family. Tell us who you are and the admin will let you in.</div>
          </div>
        </div>
        <input ref={nameRef} className={s.input} style={{ flex: 'none' }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" aria-label="Your name" autoComplete="name" />
        <input className={s.input} style={{ flex: 'none' }} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" aria-label="Email" autoComplete="email" />
        <textarea
          className={s.input}
          style={{ flex: 'none', height: 'auto', padding: '12px 14px', resize: 'vertical', lineHeight: 1.4 }}
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="How are you family? e.g. Nadia's daughter (optional)"
          aria-label="Note"
          maxLength={300}
        />
        <button type="submit" className={s.btn} disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Send request'}
        </button>
        <div className={s.msg} style={{ color: error ? '#C0443A' : 'var(--ink2)', marginTop: -6 }}>{error}</div>
        <div className={s.links} style={{ marginTop: -12 }}>
          <button type="button" className={s.link} onClick={onBack}>Back to sign in</button>
        </div>
      </form>
    </div>
  );
}

export function Verify() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const token = params.get('token') ?? '';
    api('/auth/verify', { body: { token } })
      .then(async () => {
        await qc.invalidateQueries({ queryKey: qk.me });
        nav('/', { replace: true });
      })
      .catch((e) => setError(errorMessage(e)));
  }, [params, nav, qc]);

  return (
    <div className={s.stage}>
      <div className={s.card} style={{ padding: 30, animation: 'kpop .3s cubic-bezier(.3,1.4,.5,1) both' }}>
        <div className={s.head}>
          <LockIcon open={!error} color={error ? '#C0443A' : 'var(--ink)'} />
          <div>
            <div className={s.title}>{error ? "That link didn't work" : 'Signing you in…'}</div>
            <div className={s.sub}>{error || 'One moment.'}</div>
          </div>
        </div>
        {error && (
          <button className={s.btn} style={{ alignSelf: 'flex-start' }} onClick={() => nav('/login')}>
            Get a new link
          </button>
        )}
      </div>
    </div>
  );
}
