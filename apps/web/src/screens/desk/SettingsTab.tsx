import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../api/client';
import { qk, useLibrary } from '../../api/hooks';
import type { Library } from '../../api/types';
import { Segmented, Toggle } from '../../components/controls';
import { landingDefs } from '../../lib/landing';
import { useTheme } from '../../lib/theme';
import { useToast } from '../../lib/toast';
import d from './Desk.module.css';
import s from './SettingsTab.module.css';

export function SettingsTab() {
  const lib = useLibrary().data;
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const { dark, setDark } = useTheme();
  const [family, setFamily] = useState<string | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  if (!lib) return null;
  const st = lib.settings;

  /** Updates the cached library at once and saves after a pause. */
  const save = (patch: Partial<Library['settings']>, key = Object.keys(patch).join(), ms = 500) => {
    qc.setQueryData<Library>(qk.library, (l) => l && { ...l, settings: { ...l.settings, ...patch } });
    clearTimeout(timers.current.get(key));
    timers.current.set(
      key,
      setTimeout(() => {
        api('/settings', { method: 'PATCH', body: patch })
          .then(() => Promise.all([qc.invalidateQueries({ queryKey: qk.library }), qc.invalidateQueries({ queryKey: ['book'] })]))
          .catch((e) => toast(errorMessage(e)));
      }, ms),
    );
  };

  return (
    <>
      <h2 className={d.h2}>Settings</h2>
      <div className={s.card}>
        <div className={s.row}>
          <div>
            <div className={s.title}>Family name</div>
            <div className={s.sub}>Shown on covers, title pages and the shelf</div>
          </div>
          <input
            className={s.family}
            value={family ?? st.familyName}
            onChange={(e) => {
              setFamily(e.target.value);
              if (e.target.value.trim()) save({ familyName: e.target.value.trim() });
            }}
            onBlur={(e) => {
              // An empty name isn't saved, so say so as the field goes back to the saved one.
              if (!e.target.value.trim()) toast("The family name can't be empty, so it wasn't changed.");
              setFamily(null);
            }}
          />
        </div>
        <div className={s.row}>
          <div>
            <div className={s.title}>Appearance</div>
            <div className={s.sub}>Dark mode dims the room, not the pages. Saved on this device.</div>
          </div>
          <Segmented size="lg" options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} value={dark ? 'dark' : 'light'} onChange={(v) => setDark(v === 'dark')} />
        </div>
        <div className={s.row} style={{ borderBottom: 0 }}>
          <div>
            <div className={s.title}>Lock new books</div>
            <div className={s.sub}>New books need a PIN to edit</div>
          </div>
          <Toggle big on={st.lockNewBooks} onClick={() => save({ lockNewBooks: !st.lockNewBooks }, 'lock', 0)} />
        </div>
      </div>

      <div className={s.landingHead}>
        <div>
          <div className={s.h3}>Landing page</div>
          <div className={s.sub} style={{ marginTop: 4 }}>The words above the shelf. Leave a field blank to use the default.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={s.reset}
            onClick={() => {
              const snap = st.landing;
              save({ landing: {} }, 'landing', 0);
              toast('Landing text reset', 'Undo', () => save({ landing: snap }, 'landing', 0));
            }}
          >
            Reset
          </button>
          <button className={s.view} onClick={() => nav('/')}>View shelf</button>
        </div>
      </div>
      <div className={s.fields}>
        {landingDefs(st.familyName).map(([key, label, def]) => (
          <label key={key} className={s.field}>
            <span>{label}</span>
            {key === 'intro' ? (
              <textarea rows={3} value={st.landing[key] ?? ''} placeholder={def} onChange={(e) => save({ landing: { ...st.landing, [key]: e.target.value } }, 'landing')} />
            ) : (
              <input value={st.landing[key] ?? ''} placeholder={def} onChange={(e) => save({ landing: { ...st.landing, [key]: e.target.value } }, 'landing')} />
            )}
          </label>
        ))}
      </div>
    </>
  );
}
