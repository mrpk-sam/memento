import type { ReactNode } from 'react';
import s from './controls.module.css';

/** The 36×18 pill switch used across the Desk. */
export function Toggle({ on, onClick, children, big }: { on: boolean; onClick: () => void; children?: ReactNode; big?: boolean }) {
  const knob = (
    <span className={big ? s.trackBig : s.track} style={{ background: on ? 'var(--accent)' : 'var(--tan)' }}>
      <span className={big ? s.knobBig : s.knob} style={{ transform: `translateX(${on ? (big ? 20 : 18) : 0}px)` }} />
    </span>
  );
  if (!children) {
    return (
      <button type="button" className={s.bare} onClick={onClick} aria-pressed={on}>
        {knob}
      </button>
    );
  }
  return (
    <button type="button" className={s.toggle} onClick={onClick} aria-pressed={on}>
      {knob}
      {children}
    </button>
  );
}

/** Pill segmented control (Leather / Linen / Modern matte, Light / Dark …). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  wrap,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md' | 'lg';
  wrap?: boolean;
}) {
  return (
    <div className={wrap ? s.segWrap : s.seg}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={size === 'sm' ? s.segBtnSm : size === 'lg' ? s.segBtnLg : s.segBtn}
          style={o.value === value ? { background: 'var(--ink)', color: 'var(--bg)' } : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const RING_ON = '0 0 0 2px var(--surface), 0 0 0 4px var(--ink)';
export const RING_OFF = 'inset 0 0 0 1px rgba(0,0,0,.1)';
