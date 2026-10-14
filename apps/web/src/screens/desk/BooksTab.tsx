import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { TEXTURES, poss, spineBg } from '@memento/shared';
import { api, errorMessage } from '../../api/client';
import { qk, useLibrary, usePeople } from '../../api/hooks';
import type { Library, LibraryBook } from '../../api/types';
import { Toggle } from '../../components/controls';
import { SizeControls, TexturePicker } from '../../components/CoverControls';
import { useBookPatch } from '../../lib/useBookPatch';
import { useToast } from '../../lib/toast';
import { useViewport } from '../../lib/useViewport';
import d from './Desk.module.css';
import s from './BooksTab.module.css';

interface Draft {
  parent: string;
  owner: string;
  name: string;
  surname: string;
  spineText: string;
  texture: LibraryBook['texture'];
  color: string;
  locked: boolean;
  pin: string;
}

const onlyDigits = (v: string) => v.replace(/\D/g, '').slice(0, 4);

export function BooksTab() {
  const lib = useLibrary().data;
  const people = usePeople().data;
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const patchBook = useBookPatch();
  const hhTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const newDraft = (parent = ''): Draft => ({
    parent,
    owner: '',
    name: '',
    surname: '',
    spineText: '',
    texture: 'linen',
    color: TEXTURES.linen.colors[0],
    locked: lib?.settings.lockNewBooks ?? true,
    pin: '',
  });

  // The shelf's "+ New book" slot links here with ?new=1.
  useEffect(() => {
    if (lib && params.get('new')) {
      setDraft(newDraft());
      params.delete('new');
      setParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib]);

  if (!lib) return null;
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: qk.library }), qc.invalidateQueries({ queryKey: qk.people })]);

  async function run<T>(fn: () => Promise<T>, ok?: (r: T) => void) {
    try {
      const r = await fn();
      await refresh();
      ok?.(r);
    } catch (e) {
      toast(errorMessage(e));
      await refresh();
    }
  }

  /** Household name and surname save after a pause, like book edits. */
  function patchHousehold(id: string, patch: { name?: string; surname?: string }) {
    qc.setQueryData<Library>(qk.library, (l) => l && { ...l, households: l.households.map((h) => (h.id === id ? { ...h, ...patch } : h)) });
    clearTimeout(hhTimers.current.get(id));
    hhTimers.current.set(
      id,
      setTimeout(() => {
        if (patch.name !== undefined && !patch.name.trim()) return;
        void run(() => api(`/households/${id}`, { method: 'PATCH', body: patch }));
      }, 500),
    );
  }

  async function createBook() {
    if (!draft) return;
    if (draft.locked && !/^\d{4}$/.test(draft.pin)) return toast('Set a 4-digit PIN, or turn the lock off');
    if (draft.parent && !draft.owner.trim()) return toast("Add whose book it is, e.g. your kid's name");
    if (!draft.parent && !draft.name.trim()) return toast('Name the household first');
    await run(
      () =>
        api<{ id: string }>('/books', {
          body: {
            parentHouseholdId: draft.parent || null,
            ownerName: draft.owner,
            householdName: draft.name,
            surname: draft.surname,
            spineText: draft.spineText,
            texture: draft.texture,
            color: draft.color,
            locked: draft.locked,
            pin: draft.locked ? draft.pin : undefined,
          },
        }),
      (r) => {
        const parentName = lib!.households.find((h) => h.id === draft.parent)?.name ?? '';
        setDraft(null);
        toast(draft.parent ? `${poss(draft.owner.trim())} book is next to ${poss(parentName)} book` : `${poss(draft.name.trim())} book is on the shelf`, 'Open it', () => nav(`/book/${r.id}`));
      },
    );
  }

  const hhName = (id: string) => lib.households.find((h) => h.id === id)?.name ?? '';

  return (
    <>
      <h2 className={d.h2}>Books</h2>
      <div className={d.headRow}>
        <p className={d.lead}>
          Each household has a main book, and can add smaller ones (e.g. for a kid) that sit beside it. Books are in shelf order, left to right; use the arrows to reorder. Set each cover and the PIN that lets someone edit it.
        </p>
        {!draft && (
          <button className={d.btnInk} style={{ height: 40 }} onClick={() => setDraft(newDraft())}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            New book
          </button>
        )}
      </div>

      {draft && <NewBookForm draft={draft} setDraft={setDraft} lib={lib} onCreate={createBook} />}

      <div className={s.list}>
        {lib.books.map((b) => {
          const pool = lib.books.filter((x) => (b.kind === 'main' ? x.kind === 'main' : x.kind === 'small' && x.householdId === b.householdId));
          const bi = pool.findIndex((x) => x.id === b.id);
          const hh = lib.households.find((h) => h.id === b.householdId);
          const members = people?.people.filter((p) => p.householdId === b.householdId).map((p) => p.name) ?? [];
          return (
            <BookRow
              key={b.id}
              b={b}
              pos={bi}
              poolSize={pool.length}
              household={hh}
              households={lib.households}
              familyName={lib.settings.familyName}
              memberLine={members.length ? members.join(', ') : 'No members yet. Add people from Family members.'}
              confirming={confirmId === b.id}
              patch={(p) => patchBook(b.id, p)}
              patchHousehold={(p) => hh && patchHousehold(hh.id, p)}
              onMove={(dir) => run(() => api(`/books/${b.id}/move`, { body: { dir } }))}
              onMatchAll={() =>
                run(
                  () => api<{ previous: unknown }>(`/books/${b.id}/match-size`, { method: 'POST' }),
                  (r) =>
                    toast(`All ${b.kind === 'small' ? 'smaller' : 'main'} books set to ${b.width} × ${b.height}`, 'Undo', () =>
                      void run(() => api('/books/sizes', { method: 'PUT', body: { sizes: r.previous } })),
                    ),
                )
              }
              onPin={(pin) => run(() => api(`/books/${b.id}/pin`, { method: 'PUT', body: { pin } }), () => toast('PIN updated. Anyone editing this book needs the new one.'))}
              onToggleLock={() => {
                patchBook(b.id, { locked: !b.locked });
                if (!b.locked && !b.hasPin) toast('Locked. Set a PIN so family can edit it.');
              }}
              onParent={(v) => {
                patchBook(b.id, { householdId: v });
                toast(`Moved beside ${poss(hhName(v))} book`);
              }}
              onAddChild={() => {
                setDraft(newDraft(b.householdId));
                document.scrollingElement?.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              onOpen={() => nav(`/book/${b.id}`)}
              onEdit={() => nav(`/book/${b.id}?edit=1`)}
              onAskDelete={() => setConfirmId(b.id)}
              onCancelDelete={() => setConfirmId(null)}
              onDelete={() =>
                run(
                  () => api<{ bookIds: string[]; householdId: string | null; memberIds: string[] }>(`/books/${b.id}`, { method: 'DELETE' }),
                  (r) => {
                    setConfirmId(null);
                    const extra = r.bookIds.length - 1;
                    const msg =
                      b.kind === 'small'
                        ? `${b.title} deleted`
                        : `${b.title} deleted${extra > 0 ? ` with its ${extra} smaller book${extra > 1 ? 's' : ''}` : ''}. Its members moved to extended family.`;
                    toast(msg, 'Undo', () => void run(() => api('/books/restore', { body: r })));
                  },
                )
              }
            />
          );
        })}
      </div>
    </>
  );
}

function NewBookForm({ draft, setDraft, lib, onCreate }: { draft: Draft; setDraft: (d: Draft | null) => void; lib: Library; onCreate: () => void }) {
  const set = (p: Partial<Draft>) => setDraft({ ...draft, ...p });
  const parentName = lib.households.find((h) => h.id === draft.parent)?.name ?? '';
  const ownerName = draft.parent ? draft.owner.trim() || 'New book' : draft.name.trim() || 'New household';
  return (
    <div className={s.newForm}>
      <div className={s.newSpine} style={{ background: spineBg(draft) }} />
      <div className={s.newBody}>
        <div className={s.title}>New book</div>
        <div className={s.cols}>
          <div className={s.col}>
            <div className={s.colHead}>Household</div>
            <select className={s.input} value={draft.parent} onChange={(e) => set({ parent: e.target.value })} aria-label="Household" style={{ cursor: 'pointer' }}>
              <option value="">None · create a new household</option>
              {lib.households.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
            {draft.parent ? (
              <>
                <input className={s.input} value={draft.owner} onChange={(e) => set({ owner: e.target.value })} placeholder="Whose book? e.g. Luca" aria-label="Whose book" />
                <div className={s.hint}>A smaller book that sits right beside {poss(parentName)} book.</div>
              </>
            ) : (
              <>
                <div className={s.hint}>Creates a new household with this as its main book. Add people afterwards from Family members.</div>
                <input className={s.input} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Household name, e.g. Tasha & Mike" aria-label="Household name" />
                <input className={s.input} value={draft.surname} onChange={(e) => set({ surname: e.target.value })} placeholder={`Surname · defaults to ${lib.settings.familyName}`} aria-label="Surname" />
              </>
            )}
            <input className={s.input} value={draft.spineText} onChange={(e) => set({ spineText: e.target.value })} placeholder={`Spine text · ${ownerName}`} aria-label="Spine text" title="Spine text" />
          </div>
          <div className={s.col}>
            <div className={s.colHead}>Cover</div>
            <TexturePicker texture={draft.texture} color={draft.color} onChange={(p) => set(p as Partial<Draft>)} custom size={24} />
          </div>
          <div className={s.col}>
            <div className={s.colHead}>Lock</div>
            <div className={s.lockRow}>
              <Toggle on={draft.locked} onClick={() => set({ locked: !draft.locked })}>
                {draft.locked ? 'PIN needed to edit' : 'Anyone can edit'}
              </Toggle>
              {draft.locked && <input className={s.pinNew} value={draft.pin} onChange={(e) => set({ pin: onlyDigits(e.target.value) })} inputMode="numeric" maxLength={4} placeholder="PIN" aria-label="PIN" />}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className={d.btnAccent} style={{ padding: '0 20px', color: '#fff' }} onClick={onCreate}>Create book</button>
          <button className={d.btnGhost} style={{ padding: '0 18px' }} onClick={() => setDraft(null)}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

interface RowProps {
  b: LibraryBook;
  pos: number;
  poolSize: number;
  household: Library['households'][number] | undefined;
  households: Library['households'];
  familyName: string;
  memberLine: string;
  confirming: boolean;
  patch: (p: Partial<LibraryBook>) => void;
  patchHousehold: (p: { name?: string; surname?: string }) => void;
  onMove: (dir: -1 | 1) => void;
  onMatchAll: () => void;
  onPin: (pin: string) => void;
  onToggleLock: () => void;
  onParent: (id: string) => void;
  onAddChild: () => void;
  onOpen: () => void;
  onEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}

function BookRow(p: RowProps) {
  const { b } = p;
  const { vw } = useViewport();
  const [pin, setPin] = useState('');
  const child = b.kind === 'small';
  return (
    <div className={s.row} style={{ marginLeft: child ? (vw < 600 ? 16 : 40) : 0 }}>
      <div className={s.order}>
        <button className={s.arrow} aria-label="Move left on shelf" title="Move left on shelf" onClick={() => p.onMove(-1)} style={{ opacity: p.pos === 0 ? 0.3 : 1 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 15l6-6 6 6" /></svg>
        </button>
        <div className={s.preview} style={{ width: child ? 26 : 34, height: child ? 100 : 124, background: spineBg(b) }} />
        <span className={s.posLabel}>{p.pos + 1} of {p.poolSize}</span>
        <button className={s.arrow} aria-label="Move right on shelf" title="Move right on shelf" onClick={() => p.onMove(1)} style={{ opacity: p.pos === p.poolSize - 1 ? 0.3 : 1 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
        </button>
      </div>
      <div className={s.cols} style={{ gap: '18px 28px' }}>
        <div>
          <div className={s.title}>{b.title}</div>
          {child ? (
            <>
              <label className={s.field} style={{ marginTop: 12 }}>
                <span className={s.colHead}>Whose book</span>
                <input className={s.input} defaultValue={b.ownerName ?? ''} onChange={(e) => e.target.value.trim() && p.patch({ ownerName: e.target.value })} />
              </label>
              <label className={s.field} style={{ marginTop: 10 }}>
                <span className={s.colHead}>Household</span>
                <select className={s.input} value={b.householdId} onChange={(e) => p.onParent(e.target.value)} style={{ cursor: 'pointer' }}>
                  {p.households.map((h) => (
                    <option key={h.id} value={h.id}>{h.name}</option>
                  ))}
                </select>
              </label>
              <div className={s.hint} style={{ marginTop: 6, fontSize: 12 }}>Sits beside {poss(p.household?.name ?? '')} book. Arrows reorder it within the household.</div>
            </>
          ) : (
            <>
              <div className={s.hhGrid}>
                <label className={s.field} style={{ minWidth: 0 }}>
                  <span className={s.colHead}>Household</span>
                  <input className={s.input} value={p.household?.name ?? ''} onChange={(e) => p.patchHousehold({ name: e.target.value })} />
                </label>
                <label className={s.field} style={{ minWidth: 0 }}>
                  <span className={s.colHead}>Surname</span>
                  <input className={s.input} value={p.household?.surname ?? ''} onChange={(e) => p.patchHousehold({ surname: e.target.value })} placeholder={p.familyName} />
                </label>
              </div>
              <div className={s.hint} style={{ marginTop: 6, fontSize: 12 }}>{p.memberLine}</div>
              <button className={s.addChild} onClick={p.onAddChild}>+ Add a smaller book to this household</button>
            </>
          )}
          <div className={s.actions}>
            <button className={s.open} onClick={p.onOpen}>Open</button>
            <button className={s.editPages} onClick={p.onEdit}>Edit pages</button>
            {!p.confirming && <button className={s.del} onClick={p.onAskDelete}>Delete</button>}
          </div>
          {p.confirming && (
            <div className={s.confirm}>
              <span style={{ flex: '1 1 140px' }}>Delete this book and all its pages?</span>
              <button className={s.keep} onClick={p.onCancelDelete}>Keep</button>
              <button className={s.confirmDel} onClick={p.onDelete}>Delete book</button>
            </div>
          )}
        </div>
        <div className={s.col}>
          <div className={s.colHead}>Cover</div>
          <input className={s.spineInput} value={b.spineText} placeholder={b.owner} onChange={(e) => p.patch({ spineText: e.target.value })} title="Spine text" aria-label="Spine text" />
          <TexturePicker texture={b.texture} color={b.color} onChange={p.patch} custom size={24} />
          <SizeControls id={b.id} width={b.width} height={b.height} onChange={p.patch} />
          <button className={s.match} onClick={p.onMatchAll}>{child ? 'Use this size for all smaller books' : 'Use this size for all main books'}</button>
        </div>
        <div className={s.col}>
          <div className={s.colHead}>Lock</div>
          <div className={s.lockRow}>
            <Toggle on={b.locked} onClick={p.onToggleLock}>
              {b.locked ? 'PIN needed to edit' : 'Anyone can edit'}
            </Toggle>
            {b.locked && (
              <input
                className={s.pin}
                value={pin}
                onChange={(e) => {
                  const v = onlyDigits(e.target.value);
                  setPin(v);
                  if (v.length === 4) {
                    p.onPin(v);
                    setPin('');
                  }
                }}
                inputMode="numeric"
                maxLength={4}
                placeholder={b.hasPin ? '••••' : 'Set'}
                aria-label={b.hasPin ? 'Change PIN' : 'Set PIN'}
                title={b.hasPin ? 'Type 4 digits to change the PIN' : 'Type 4 digits to set the PIN'}
                style={!b.hasPin ? { borderColor: '#D9A620' } : undefined}
              />
            )}
          </div>
          {b.locked && !b.hasPin && <div className={s.hint} style={{ fontSize: 12, color: '#A07A12' }}>No PIN yet. Only you can edit until you set one.</div>}
        </div>
      </div>
    </div>
  );
}
