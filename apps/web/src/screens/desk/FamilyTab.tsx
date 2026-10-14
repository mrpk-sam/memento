import { useState, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ACCESS_LABELS, canManagePerson, spineBg, type Access } from '@memento/shared';
import { api, errorMessage } from '../../api/client';
import { qk, useAccessRequests, useMe, usePeople } from '../../api/hooks';
import type { AccessRequest, PeopleData, PersonRow } from '../../api/types';
import { Toggle } from '../../components/controls';
import { inviteStatus, isEmail } from '../../lib/text';
import { useToast } from '../../lib/toast';
import { useViewport } from '../../lib/useViewport';
import d from './Desk.module.css';
import s from './FamilyTab.module.css';

type Household = PeopleData['households'][number];
interface InviteDraft { name: string; email: string; access: Access; household: string; send: boolean }
interface QuickDraft { group: string | null; name: string; role: string; email: string; invite: boolean }

const ACCESS_OPTS: Access[] = ['member', 'household_admin', 'admin'];

const PlusIcon = ({ size = 15, w = 2 }: { size?: number; w?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
);
const XIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
);
const GroupIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7" /><path d="M18 14a6 6 0 0 1 3.5 6" /></svg>
);

export function FamilyTab() {
  const { vw } = useViewport();
  const me = useMe().data!;
  const { data } = usePeople();
  const qc = useQueryClient();
  const toast = useToast();
  const [invite, setInvite] = useState<InviteDraft | null>(null);
  const [quick, setQuick] = useState<QuickDraft | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  if (!data) return null;
  const actor = me.user;
  const isAdmin = actor.access === 'admin';
  const hhName = (id: string | null) => data.households.find((h) => h.id === id)?.name;
  const refresh = () => qc.invalidateQueries({ queryKey: qk.people });

  /** Runs a request, refreshes the list, and turns failures into a toast. */
  async function run(fn: () => Promise<unknown>, ok?: () => void) {
    try {
      await fn();
      await refresh();
      ok?.();
    } catch (e) {
      toast(errorMessage(e));
      await refresh();
    }
  }

  async function addPerson(v: { name: string; role?: string; email: string; access: Access; household: string | null; send: boolean }) {
    const em = v.email.trim();
    if (!v.name.trim()) return toast('Add a name first');
    if (v.send && !isEmail(em)) return toast('Add an email so the invite has somewhere to go');
    if (!v.send && em && !isEmail(em)) return toast('That email looks incomplete');
    await run(
      () => api('/people', { body: { name: v.name.trim(), roleLabel: v.role?.trim() || undefined, email: em, access: v.access, householdId: v.household || null, sendInvite: v.send } }),
      () => {
        setInvite(null);
        setQuick(null);
        const where = v.household ? hhName(v.household) : 'extended family & friends';
        toast(v.send ? `Invite sent to ${em}. They can read every book.` : `${v.name.trim()} added to ${where}`);
      },
    );
  }

  const patch = (id: string, body: Partial<PersonRow>) => api(`/people/${id}`, { method: 'PATCH', body });
  const restore = (id: string) => run(() => api(`/people/${id}/restore`, { method: 'POST' }));

  const compact = (vw < 900 ? vw : vw - 264) < 820;
  const grid = compact
    ? { gridTemplateColumns: '40px minmax(0,1fr) auto', gridTemplateAreas: '"av nm act" ". em em" ". ac bk"', gap: '8px 12px', padding: '14px 14px' }
    : { gridTemplateColumns: '44px minmax(140px,1.4fr) minmax(140px,1.2fr) 120px 110px 96px', gridTemplateAreas: '"av nm em ac bk act"', gap: '16px', padding: '14px 20px' };

  const canAddTo = (group: string | null) => isAdmin || (actor.access === 'household_admin' && group !== null && group === actor.householdId);
  const hhOpts = isAdmin ? data.households : data.households.filter((h) => h.id === actor.householdId);
  const accessOpts = isAdmin ? ACCESS_OPTS : ACCESS_OPTS.filter((a) => a !== 'admin');

  const groups: { id: string | null; name: string; sub: string; hh?: Household }[] = [
    ...data.households.map((h) => {
      const admins = data.people.filter((p) => p.householdId === h.id && p.access === 'household_admin').map((p) => p.name);
      return { id: h.id, name: h.name, hh: h, sub: (h.mainBook?.title ?? '') + (admins.length ? ` · Household admin: ${admins.join(', ')}` : '') };
    }),
    { id: null, name: 'Extended family & friends', sub: 'Can read every book. Can edit one only with its PIN.' },
  ];

  return (
    <>
      <div className={d.headRow}>
        <div>
          <h2 className={d.h2}>Family members</h2>
          <p className={d.lead}>
            Everyone here can read every household's book. Editing a book needs its PIN. Admins manage everything; household admins can add and manage people in their own household.
          </p>
        </div>
        {!invite && (
          <button
            className={d.btnInk}
            onClick={() => {
              setQuick(null);
              setInvite({ name: '', email: '', access: 'member', household: isAdmin ? '' : (actor.householdId ?? ''), send: true });
            }}
          >
            <PlusIcon />
            Add or invite
          </button>
        )}
      </div>

      {invite && (
        <div className={s.invite}>
          <label className={d.label}>
            Name
            <input className={d.field} value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} placeholder="Cousin Ines" autoFocus />
          </label>
          <label className={d.label}>
            Email
            <input className={d.field} value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} placeholder="name@email.com" type="email" />
          </label>
          <label className={d.label}>
            Access
            <select className={d.select} value={invite.access} onChange={(e) => setInvite({ ...invite, access: e.target.value as Access })}>
              {accessOpts.map((a) => (
                <option key={a} value={a}>{ACCESS_LABELS[a]}</option>
              ))}
            </select>
          </label>
          <label className={d.label}>
            Household
            <select className={d.select} value={invite.household} onChange={(e) => setInvite({ ...invite, household: e.target.value })}>
              {isAdmin && <option value="">Extended family &amp; friends</option>}
              {hhOpts.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
          </label>
          <Toggle on={invite.send} onClick={() => setInvite({ ...invite, send: !invite.send })}>
            Send an invite email
          </Toggle>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={d.btnAccent}
              style={{ flex: 1 }}
              onClick={() => {
                if (invite.access === 'household_admin' && !invite.household) return toast('Move them into a household first');
                void addPerson({ ...invite, household: invite.household || null });
              }}
            >
              {invite.send ? 'Send invite' : 'Add member'}
            </button>
            <button className={d.btnGhost} onClick={() => setInvite(null)}>Cancel</button>
          </div>
        </div>
      )}

      <Requests
        households={isAdmin ? data.households : data.households.filter((h) => h.id === actor.householdId)}
        isAdmin={isAdmin}
        accessOpts={accessOpts}
        onDone={refresh}
        toast={toast}
      />

      <div className={s.groups}>
        {groups.map((g) => {
          const rows = data.people.filter((p) => (p.householdId ?? null) === g.id);
          const quickOn = !!quick && (quick.group ?? null) === g.id;
          const submitQuick = () => quick && addPerson({ name: quick.name, role: quick.role, email: quick.email, access: 'member', household: quick.group, send: quick.invite });
          const onQuickKey = (e: KeyboardEvent) => {
            if (e.key === 'Enter') void submitQuick();
            if (e.key === 'Escape') setQuick(null);
          };
          return (
            <div key={g.id ?? 'guests'} className={s.group}>
              <div className={s.groupHead}>
                {g.hh ? (
                  <div className={s.groupSpine} style={{ background: g.hh.mainBook ? spineBg(g.hh.mainBook) : '#8C7A66' }} />
                ) : (
                  <div className={s.groupGuest}><GroupIcon /></div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className={s.groupName}>{g.name}</div>
                  <div className={s.groupSub}>{g.sub}</div>
                </div>
                <span className={s.groupCount}>{rows.length + (rows.length === 1 ? ' person' : ' people')}</span>
                {canAddTo(g.id) && (
                  <button
                    className={s.quickBtn}
                    aria-label="Add a person to this group"
                    title="Add a person"
                    onClick={() => {
                      setInvite(null);
                      setQuick(quickOn ? null : { group: g.id, name: '', role: '', email: '', invite: false });
                    }}
                  >
                    <PlusIcon size={14} w={2.2} />
                  </button>
                )}
              </div>

              {quickOn && quick && (
                <div className={s.quick}>
                  <input className={s.qInput} value={quick.name} onChange={(e) => setQuick({ ...quick, name: e.target.value })} onKeyDown={onQuickKey} placeholder="Name" aria-label="Name" autoFocus />
                  <input className={s.qInput} value={quick.role} onChange={(e) => setQuick({ ...quick, role: e.target.value })} onKeyDown={onQuickKey} placeholder="Role, e.g. Son · 6" aria-label="Role" />
                  <input className={s.qInput} value={quick.email} onChange={(e) => setQuick({ ...quick, email: e.target.value })} onKeyDown={onQuickKey} placeholder="Email (optional)" aria-label="Email" type="email" />
                  <Toggle on={quick.invite} onClick={() => setQuick({ ...quick, invite: !quick.invite })}>
                    Send invite
                  </Toggle>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className={s.qAdd} onClick={() => void submitQuick()}>{quick.invite ? 'Send invite' : 'Add'}</button>
                    <button className={s.qCancel} aria-label="Cancel" onClick={() => setQuick(null)}><XIcon /></button>
                  </div>
                </div>
              )}

              {!rows.length && !quickOn && (
                <div className={s.empty}>
                  {g.id === null ? "No one yet. Invite aunts, cousins and friends. They'll be able to read every book." : 'No one in this household yet. Tap + to add someone.'}
                </div>
              )}

              {rows.map((m) => (
                <MemberRow
                  key={`${m.id}:${m.name}:${m.roleLabel}:${m.email ?? ""}`}
                  m={m}
                  grid={grid}
                  color={g.hh?.mainBook?.color ?? '#8C7A66'}
                  canManage={canManagePerson(actor, m) && !(m.isSuperAdmin && !actor.isSuperAdmin)}
                  isSelf={m.id === actor.id}
                  editing={editId === m.id}
                  confirming={confirmId === m.id}
                  households={data.households}
                  hhOpts={isAdmin ? data.households : data.households.filter((h) => h.id === actor.householdId)}
                  accessOpts={accessOpts}
                  isAdmin={isAdmin}
                  onEdit={() => {
                    setEditId(editId === m.id ? null : m.id);
                    setConfirmId(null);
                  }}
                  onAskDelete={() => {
                    setConfirmId(m.id);
                    setEditId(null);
                  }}
                  onCancelDelete={() => setConfirmId(null)}
                  onDelete={() =>
                    run(
                      () => api(`/people/${m.id}`, { method: 'DELETE' }),
                      () => {
                        setConfirmId(null);
                        toast(`${m.name} removed`, 'Undo', () => void restore(m.id));
                      },
                    )
                  }
                  onPatch={(body, okMsg) => run(() => patch(m.id, body), okMsg ? () => toast(okMsg) : undefined)}
                  onResend={() => run(() => api(`/people/${m.id}/invite`, { method: 'POST' }), () => toast(`New invite link sent to ${m.email}`))}
                  onCancelInvite={() =>
                    run(
                      () => api(`/people/${m.id}/invite/cancel`, { method: 'POST' }),
                      () => toast(`Invite to ${m.name} cancelled. The link no longer works.`, 'Undo', () => void restore(m.id)),
                    )
                  }
                  onAccept={() => run(() => api(`/people/${m.id}/invite/accept`, { method: 'POST' }), () => toast(`${m.name} joined the library`))}
                  toast={toast}
                  hhName={hhName}
                />
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

interface RowProps {
  m: PersonRow;
  grid: React.CSSProperties;
  color: string;
  canManage: boolean;
  isSelf: boolean;
  editing: boolean;
  confirming: boolean;
  households: Household[];
  hhOpts: Household[];
  accessOpts: Access[];
  isAdmin: boolean;
  onEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
  onPatch: (body: Partial<PersonRow>, okMsg?: string) => Promise<void>;
  onResend: () => void;
  onCancelInvite: () => void;
  onAccept: () => void;
  toast: ReturnType<typeof useToast>;
  hhName: (id: string | null) => string | undefined;
}

function MemberRow(p: RowProps) {
  const { m } = p;
  const [name, setName] = useState(m.name);
  const [role, setRole] = useState(m.roleLabel);
  const [email, setEmail] = useState(m.email ?? '');
  const [emailWas, setEmailWas] = useState('');
  const pending = m.invite ? inviteStatus(m.invite.sentAt, m.invite.expiresAt) : null;
  const initial = m.name.replace('Grandma ', '').replace('Auntie ', '')[0];
  const ro = !p.canManage;

  const saveNames = () => {
    const body: Partial<PersonRow> = {};
    if (name.trim() && name.trim() !== m.name) body.name = name.trim();
    if (role.trim() !== m.roleLabel) body.roleLabel = role.trim();
    if (Object.keys(body).length) void p.onPatch(body);
  };

  return (
    <div className={s.row} style={p.grid}>
      <div className={s.avatar} style={{ opacity: m.invite ? 0.45 : 1, background: p.color }}>{initial}</div>

      {!p.editing ? (
        <div style={{ gridArea: 'nm', minWidth: 0 }}>
          <div className={s.name}>{m.name}</div>
          <div className={s.role}>{m.roleLabel}</div>
          {pending && (
            <div className={s.pendingRow}>
              <span
                className={s.pendingChip}
                style={{
                  background: pending.expired ? '#F8E4E1' : 'color-mix(in srgb, var(--accent) 12%, var(--surface))',
                  color: pending.expired ? '#A2362D' : 'var(--accent)',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>
                {pending.label}
              </span>
              {!ro && (
                <div style={{ display: 'flex', gap: 2 }}>
                  <button className={s.linkBtn} onClick={p.onResend}>Resend</button>
                  <button className={`${s.linkBtn} ${s.linkDanger}`} onClick={p.onCancelInvite}>Cancel invite</button>
                  <button className={s.dashedBtn} title="Use this if they joined another way" onClick={p.onAccept}>Mark accepted</button>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div style={{ gridArea: 'nm', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <input className={s.editName} value={name} onChange={(e) => setName(e.target.value)} onBlur={saveNames} autoFocus aria-label="Name" />
          <input className={s.editRole} value={role} onChange={(e) => setRole(e.target.value)} onBlur={saveNames} aria-label="Role" />
        </div>
      )}

      <input
        type="email"
        className={s.email}
        value={email}
        readOnly={ro || (m.isSuperAdmin && !p.isAdmin)}
        disabled={m.isSuperAdmin}
        placeholder="Add email"
        aria-label={`Email for ${m.name}`}
        title={m.isSuperAdmin ? 'Set by ADMIN_EMAIL on the server' : 'Click to edit'}
        style={{ borderColor: email && !isEmail(email) ? '#C0443A' : 'transparent' }}
        onChange={(e) => setEmail(e.target.value.trim())}
        onFocus={(e) => setEmailWas(e.target.value.trim())}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && e.currentTarget.blur()}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v === emailWas) return;
          if (v && !isEmail(v)) return p.toast('That email looks incomplete');
          void p.onPatch({ email: v }, v ? `${m.name}'s email updated` : undefined);
        }}
      />

      <select
        className={s.rowSelect}
        style={{ gridArea: 'ac' }}
        value={m.access}
        disabled={ro || m.isSuperAdmin}
        aria-label="Access"
        onChange={(e) => {
          const v = e.target.value as Access;
          if (v === 'household_admin' && !m.householdId) return p.toast('Move them into a household first');
          const msg = v === 'admin' ? `${m.name} can now manage everything` : v === 'household_admin' ? `${m.name} can now add and manage people in ${p.hhName(m.householdId)}` : `${m.name} is now a member`;
          void p.onPatch({ access: v }, msg);
        }}
      >
        {(p.accessOpts.includes(m.access) ? p.accessOpts : ACCESS_OPTS).map((a) => (
          <option key={a} value={a}>{ACCESS_LABELS[a]}</option>
        ))}
      </select>

      <select
        className={s.rowSelect}
        style={{ gridArea: 'bk', width: '100%' }}
        value={m.householdId ?? ''}
        disabled={ro}
        aria-label="Household"
        onChange={(e) => {
          const v = e.target.value || null;
          void p.onPatch({ householdId: v }, v ? `${m.name} moved to ${p.hhName(v)}` : `${m.name} moved to extended family & friends`);
        }}
      >
        {(p.isAdmin || m.householdId === null) && <option value="">Extended family</option>}
        {(ro ? p.households : p.hhOpts).map((h) => (
          <option key={h.id} value={h.id}>{h.name}</option>
        ))}
      </select>

      {!p.confirming ? (
        <div className={s.actions}>
          {!ro && (
            <>
              <button className={d.iconBtn} title="Edit" onClick={p.onEdit}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
              </button>
              {!p.isSelf && !m.isSuperAdmin && (
                <button className={`${d.iconBtn} ${d.iconBtnDanger}`} title="Delete" onClick={p.onAskDelete}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <div className={s.actions} style={{ animation: 'kpop .25s ease both' }}>
          <button className={s.confirmDel} title="Remove this person?" onClick={p.onDelete}>Delete</button>
          <button className={s.confirmX} onClick={p.onCancelDelete} aria-label="Keep"><XIcon /></button>
        </div>
      )}
    </div>
  );
}

/** "Asking to join": people who requested access from the sign-in page. */
function Requests({
  households,
  isAdmin,
  accessOpts,
  onDone,
  toast,
}: {
  households: Household[];
  isAdmin: boolean;
  accessOpts: Access[];
  onDone: () => Promise<unknown>;
  toast: ReturnType<typeof useToast>;
}) {
  const { data } = useAccessRequests();
  const qc = useQueryClient();
  const [choice, setChoice] = useState<Record<string, { household: string; access: Access }>>({});
  const requests = data?.requests ?? [];
  if (!requests.length) return null;
  const reload = () => Promise.all([qc.invalidateQueries({ queryKey: qk.requests }), onDone()]);
  const pick = (r: AccessRequest) => choice[r.id] ?? { household: isAdmin ? '' : (households[0]?.id ?? ''), access: 'member' as Access };
  const ago = (iso: string) => {
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
  };

  return (
    <div className={s.group} style={{ marginTop: 24, borderColor: 'color-mix(in srgb, var(--accent) 45%, var(--line))' }}>
      <div className={s.groupHead} style={{ background: 'color-mix(in srgb, var(--accent) 8%, var(--surface2))' }}>
        <div className={s.groupGuest} style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className={s.groupName}>Asking to join</div>
          <div className={s.groupSub}>Approve to add them and send an invite. Declining sends nothing.</div>
        </div>
        <span className={s.groupCount}>{requests.length + (requests.length === 1 ? ' request' : ' requests')}</span>
      </div>
      {requests.map((r) => {
        const c = pick(r);
        const set = (p: Partial<typeof c>) => setChoice((all) => ({ ...all, [r.id]: { ...c, ...p } }));
        return (
          <div key={r.id} className={s.request}>
            <div className={s.avatar} style={{ background: 'var(--tan)', gridArea: 'auto' }}>{r.name[0]}</div>
            <div style={{ minWidth: 0 }}>
              <div className={s.name}>{r.name}</div>
              <div className={s.role}>{r.email} · {ago(r.createdAt)}</div>
              {r.note && <div className={s.requestNote}>“{r.note}”</div>}
            </div>
            <select className={s.rowSelect} value={c.household} aria-label="Household" onChange={(e) => set({ household: e.target.value })}>
              {isAdmin && <option value="">Extended family</option>}
              {households.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
            <select className={s.rowSelect} value={c.access} aria-label="Access" onChange={(e) => set({ access: e.target.value as Access })}>
              {accessOpts.map((a) => (
                <option key={a} value={a}>{ACCESS_LABELS[a]}</option>
              ))}
            </select>
            <div className={s.requestActions}>
              <button
                className={s.approve}
                onClick={async () => {
                  if (c.access === 'household_admin' && !c.household) return toast('Move them into a household first');
                  try {
                    await api(`/access-requests/${r.id}/approve`, { body: { householdId: c.household || null, access: c.access } });
                    await reload();
                    toast(`${r.name} approved. An invite is on its way to ${r.email}.`);
                  } catch (e) {
                    toast(errorMessage(e));
                    await reload();
                  }
                }}
              >
                Approve
              </button>
              <button
                className={s.decline}
                onClick={async () => {
                  try {
                    await api(`/access-requests/${r.id}/decline`, { method: 'POST' });
                    await reload();
                    toast(`Declined ${r.name}'s request`, 'Undo', async () => {
                      await api(`/access-requests/${r.id}/reopen`, { method: 'POST' });
                      await reload();
                    });
                  } catch (e) {
                    toast(errorMessage(e));
                  }
                }}
              >
                Decline
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
