import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { STICKER_PACKS } from '@memento/shared';
import { api, errorMessage } from '../../api/client';
import { qk, useLibrary, useThemes } from '../../api/hooks';
import type { Theme } from '../../api/types';
import { RING_ON, Segmented } from '../../components/controls';
import { useToast } from '../../lib/toast';
import { ScrapbookPage } from '../reader/ScrapbookPage';
import { samplePage } from '../reader/resolve';
import d from './Desk.module.css';
import s from './ThemesTab.module.css';

const PAPERS = ['#FBF7EF', '#FFF7EA', '#F4F7F4', '#FDF3F2', '#F1F4FA', '#F5EDDF'];
const ACCENTS = ['#B5623E', '#D2557A', '#2F5D50', '#27406B', '#E07A3F', '#6B4FA0'];
const ACCENTS2 = ['#E9A93A', '#3E9BB0', '#B23A3A', '#1F7A4A', '#7FB8B0', '#8C6A4A'];
const MOTIFS = [['none', 'None'], ['confetti', 'Confetti'], ['stars', 'Stars'], ['snow', 'Snow'], ['bunting', 'Bunting'], ['washi', 'Washi']] as const;
const RING_SWATCH = 'inset 0 0 0 1px rgba(0,0,0,.12)';
/** What the builder starts with. */
const START = { name: 'Game night', paper: '#FFF7EA', accent: '#D2557A', accent2: '#3E9BB0', motif: 'confetti', pack: 'hearts' };

export function ThemesTab() {
  const themes = useThemes().data;
  const family = useLibrary().data?.settings.familyName ?? '';
  const usage = useQuery({ queryKey: [...qk.themes, 'usage'], queryFn: () => api<Record<string, number>>('/themes/usage') }).data ?? {};
  const qc = useQueryClient();
  const toast = useToast();
  const [b, setB] = useState(START);
  // The custom theme loaded into the builder for editing, or null when making a new one.
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (!themes) return null;
  const refresh = () => qc.invalidateQueries({ queryKey: qk.themes });

  const preview: Theme = {
    id: 'builder',
    name: b.name || 'Custom theme',
    paper: b.paper,
    ink: '#3A3026',
    accent: b.accent,
    accent2: b.accent2,
    motif: b.motif,
    flags: [b.accent, b.paper === '#FFFFFF' ? '#F3ECE2' : '#FFFFFF', b.accent2],
    stickerPack: b.pack,
    builtin: false,
  };
  const swatches = (list: string[], key: 'paper' | 'accent' | 'accent2') => (
    <div className={s.swatches}>
      {list.map((c) => (
        <button key={c} className={s.swatch} aria-label={c} onClick={() => setB({ ...b, [key]: c })} style={{ background: c, boxShadow: b[key] === c ? RING_ON : RING_SWATCH }} />
      ))}
    </div>
  );

  return (
    <>
      <h2 className={d.h2}>Theme library</h2>
      <p className={d.lead} style={{ maxWidth: 'none' }}>Page backgrounds, motifs and colours for each chapter.</p>
      <div className={s.grid}>
        {themes.map((t) => (
          <div key={t.id} className={s.item}>
            <div className={s.preview}>
              <ScrapbookPage page={samplePage(t, t.id, 'none', family)} scale={0.36} />
              {!t.builtin && (
                <button
                  className={s.edit}
                  title="Edit theme"
                  aria-label={`Edit ${t.name}`}
                  onClick={() => {
                    setB({ name: t.name, paper: t.paper, accent: t.accent, accent2: t.accent2, motif: t.motif, pack: t.stickerPack });
                    setEditing(t.id);
                    document.getElementById('theme-builder')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                </button>
              )}
              {!t.builtin && (
                <button
                  className={s.del}
                  aria-label={`Delete ${t.name}`}
                  title="Delete theme"
                  onClick={async () => {
                    try {
                      await api(`/themes/${t.id}`, { method: 'DELETE' });
                      await refresh();
                      toast(`"${t.name}" deleted`, 'Undo', async () => {
                        await api(`/themes/${t.id}/restore`, { method: 'POST' });
                        await refresh();
                      });
                    } catch (e) {
                      toast(errorMessage(e));
                    }
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              )}
            </div>
            <div className={s.nameRow}>
              <span className={s.name}>{t.name}</span>
              <span className={s.used}>{usage[t.id] ?? 0} pages</span>
            </div>
            <div className={s.motif}>{t.motif === 'none' ? 'No motif' : t.motif.replace('+', ' + ')}</div>
          </div>
        ))}
      </div>

      <div className={s.builder} id="theme-builder">
        <div className={s.form}>
          <div>
            <div className={s.kicker}>Theme builder</div>
            <div className={s.title}>{editing ? 'Edit your theme' : 'Make your own'}</div>
          </div>
          <label className={s.label}>
            Name
            <input className={s.input} value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} />
          </label>
          <div className={s.row}><span className={s.label}>Paper</span>{swatches(PAPERS, 'paper')}</div>
          <div className={s.row}><span className={s.label}>Main colour</span>{swatches(ACCENTS, 'accent')}</div>
          <div className={s.row}><span className={s.label}>Second colour</span>{swatches(ACCENTS2, 'accent2')}</div>
          <div className={s.row}>
            <span className={s.label}>Motif</span>
            <Segmented wrap options={MOTIFS.map(([value, label]) => ({ value, label }))} value={b.motif as (typeof MOTIFS)[number][0]} onChange={(motif) => setB({ ...b, motif })} />
          </div>
          <div className={s.row}>
            <span className={s.label}>Stickers</span>
            <Segmented wrap options={Object.keys(STICKER_PACKS).map((k) => ({ value: k, label: STICKER_PACKS[k]!.name }))} value={b.pack} onChange={(pack) => setB({ ...b, pack })} />
          </div>
          <div className={s.saveRow}>
            <button
              className={s.save}
              disabled={saving}
              onClick={async () => {
                // One save at a time, so a double click can't add the theme twice.
                setSaving(true);
                const body = { name: b.name, paper: b.paper, accent: b.accent, accent2: b.accent2, motif: b.motif, stickerPack: b.pack };
                try {
                  if (editing) await api(`/themes/${editing}`, { method: 'PATCH', body });
                  else await api('/themes', { body });
                  await refresh();
                  toast(editing ? `"${b.name || 'Custom theme'}" updated.` : `"${b.name || 'Custom theme'}" saved. Pick it in any book's editor.`);
                  setEditing(null);
                } catch (e) {
                  toast(errorMessage(e));
                } finally {
                  setSaving(false);
                }
              }}
            >
              {editing ? 'Save changes' : 'Save to library'}
            </button>
            {editing && (
              <button
                className={s.stopEdit}
                onClick={() => {
                  setEditing(null);
                  setB(START);
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
        <div className={s.live}>
          <div className={s.livePage}>
            <ScrapbookPage page={samplePage(preview, 'builder', b.pack, family)} scale={0.55} />
          </div>
          <span className={s.used}>Live preview</span>
        </div>
      </div>
    </>
  );
}
