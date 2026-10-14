import { useState, type KeyboardEvent } from 'react';
import { TEXTURES, heightLabel, widthLabel } from '@memento/shared';
import type { LibraryBook } from '../api/types';
import { RING_OFF, RING_ON, Segmented } from './controls';
import s from './CoverControls.module.css';

type Patch = (p: Partial<LibraryBook>) => void;
const TEX_OPTS = (Object.keys(TEXTURES) as (keyof typeof TEXTURES)[]).map((k) => ({ value: k, label: TEXTURES[k].label }));

export function TexturePicker({ texture, color, onChange, custom, size = 22 }: { texture: LibraryBook['texture']; color: string; onChange: Patch; custom?: boolean; size?: number }) {
  const colors: readonly string[] = TEXTURES[texture].colors;
  return (
    <>
      <Segmented size="sm" options={TEX_OPTS} value={texture} onChange={(t) => onChange({ texture: t, color: TEXTURES[t].colors[0] })} />
      <div className={s.swatches} style={{ gap: custom ? 8 : 10, paddingTop: custom ? 0 : 4 }}>
        {custom && (
          <label title="Any colour" className={s.custom} style={{ boxShadow: colors.includes(color) ? RING_OFF : RING_ON }}>
            <input type="color" value={color} onChange={(e) => onChange({ color: e.target.value.toUpperCase() })} aria-label="Custom colour" />
          </label>
        )}
        {colors.map((c) => (
          <button key={c} type="button" className={s.swatch} aria-label={`Colour ${c}`} onClick={() => onChange({ color: c })} style={{ width: size, height: size, background: c, boxShadow: c === color ? RING_ON : RING_OFF }} />
        ))}
      </div>
    </>
  );
}

/** Height and thickness, each with a slider and a number box, as in the prototype's sizeCtl(). */
export function SizeControls({ id, width, height, minH = 280, onChange }: { id: string; width: number; height: number; minH?: number; onChange: Patch }) {
  const [draft, setDraft] = useState<{ key: string; text: string } | null>(null);
  const lim = { h: [280, 460], w: [60, 110] } as const;
  const key = (f: 'h' | 'w') => `${id}:${f}`;
  const set = (f: 'h' | 'w', v: number) => onChange(f === 'h' ? { height: v } : { width: v });
  const onNum = (f: 'h' | 'w') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = e.target.value;
    const v = Math.round(+t);
    setDraft({ key: key(f), text: t });
    if (t !== '' && v >= lim[f][0] && v <= lim[f][1]) set(f, v);
  };
  const onBlur = (f: 'h' | 'w') => (e: React.FocusEvent<HTMLInputElement>) => {
    const v = Math.round(+e.target.value);
    if (e.target.value !== '' && v) set(f, Math.max(lim[f][0], Math.min(lim[f][1], v)));
    setDraft(null);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && e.currentTarget.blur();
  const num = (f: 'h' | 'w', v: number) => (draft?.key === key(f) ? draft.text : String(v));

  return (
    <div className={s.sizes}>
      <label className={s.size}>
        <span className={s.sizeHead}>
          <span>Height</span>
          <span className={s.sizeRight}>
            <span>{heightLabel(height)}</span>
            <input type="number" min={280} max={460} step={1} value={num('h', height)} onChange={onNum('h')} onBlur={onBlur('h')} onKeyDown={onKey} aria-label="Height in px" className={s.num} />
          </span>
        </span>
        <input type="range" min={minH} max={460} step={2} value={height} onChange={(e) => set('h', +e.target.value)} className={s.range} />
      </label>
      <label className={s.size}>
        <span className={s.sizeHead}>
          <span>Thickness</span>
          <span className={s.sizeRight}>
            <span>{widthLabel(width)}</span>
            <input type="number" min={60} max={110} step={1} value={num('w', width)} onChange={onNum('w')} onBlur={onBlur('w')} onKeyDown={onKey} aria-label="Thickness in px" className={s.num} />
          </span>
        </span>
        <input type="range" min={60} max={110} step={2} value={width} onChange={(e) => set('w', +e.target.value)} className={s.range} />
      </label>
    </div>
  );
}
