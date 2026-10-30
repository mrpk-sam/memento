import { useEffect, useRef, useState } from 'react';
import { MONTHS, MONTH_CAPACITY, STICKER_PACKS, capacity, chapterList, chapterSpan, chapterStart, chapters, hasMonthChapter, nextYear, poss, stepTarget, yearSpread } from '@memento/shared';
import type { BookContent, Theme } from '../../api/types';
import { SizeControls, TexturePicker } from '../../components/CoverControls';
import { MEDIA_ACCEPT } from '../../lib/upload';
import { useBookPatch } from '../../lib/useBookPatch';
import type { BookEditor } from './useBookEditor';
import { hueOf, themeOf } from './resolve';
import s from './EditPanel.module.css';

interface Props {
  content: BookContent;
  themes: Theme[];
  L: number;
  single: boolean;
  goTo: (t: number) => void;
  selPhoto: string | null;
  setSelPhoto: (id: string | null) => void;
  editor: BookEditor;
  onPickHero: () => void;
}

const TYPE_LABEL: Record<string, string> = { endpaper: 'Inside cover', title: 'Title page', index: 'Contents', chapters: 'Contents', closing: 'Closing page', backpaper: 'Back cover' };

const Sparkle = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>
);
const Trash = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
);

/** The Book editor side panel. Ported from valsPanel() and the panel markup. */
export function EditPanel({ content, themes, L, single, goTo, selPhoto, setSelPhoto, editor, onPickHero }: Props) {
  const { book, pages } = content;
  const idxs = single ? [L] : [L, L + 1];
  const pgs = idxs.map((i) => pages[i]).filter((p): p is NonNullable<typeof p> => !!p);
  const main = pgs.find((p) => capacity(p) > 0) ?? pgs[0]!;
  const titleIdx = pages.findIndex((p) => p.type === 'title');
  const panelRef = useRef<HTMLElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const patchBook = useBookPatch();
  const ch = chapters(pages);

  // Clicking a photo on the page scrolls its card into view here. On a phone the panel sits below
  // the book, so the page scrolls too, not just the panel.
  useEffect(() => {
    if (!selPhoto) return;
    const t = setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>(`[data-edit="${selPhoto}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 30);
    return () => clearTimeout(t);
  }, [selPhoto]);

  /** Runs a reorder, then scrolls so the moved photo's card stays under the finger or pointer. */
  const followCard = (id: string, act: () => void) => {
    const card = () => panelRef.current?.querySelector<HTMLElement>(`[data-edit="${id}"]`);
    const before = card()?.getBoundingClientRect().top;
    act();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const after = card()?.getBoundingClientRect().top;
        if (before == null || after == null || Math.abs(after - before) < 1) return;
        const panel = panelRef.current!;
        if (panel.scrollHeight > panel.clientHeight + 1) panel.scrollBy(0, after - before);
        else window.scrollBy(0, after - before);
      }),
    );
  };

  const mainTheme = themeOf(themes, main.themeId);
  const spreadLabel = main.type === 'month' ? `${main.label} · ${mainTheme.name}` : main.label || TYPE_LABEL[main.type] || 'Spread';
  const hasSlots = pgs.some((p) => capacity(p) > 0);
  // A month chapter grows extra pages up to 50 photos, so its count covers the whole month.
  const chStart = chapterStart(pages, L);
  const inMonth = chStart != null && pages[chStart]?.layout === 'monthL';
  const used = inMonth ? chapterSpan(pages, chStart).reduce((a, i) => a + (pages[i]?.photos.length ?? 0), 0) : pgs.reduce((a, p) => a + p.photos.length, 0);
  const cap = inMonth ? MONTH_CAPACITY : pgs.reduce((a, p) => a + capacity(p), 0);
  const packId = (pgs.find((p) => capacity(p) > 0) ?? main).stickerPack || 'none';
  const headerPage = pgs.find((p) => p.header);
  const journalPage = pgs.find((p) => p.layout === 'monthR');
  const showHero = idxs.includes(titleIdx);
  const title = pages[titleIdx];
  const tx = title?.text ?? {};
  const hero = title?.hero ?? null;
  const yearInView = pgs.find((p) => p.year != null)?.year ?? (ch.years.length ? ch.years[ch.years.length - 1]!.year : null);
  const freeMonths = yearInView == null ? [] : MONTHS.map((m, k) => ({ m, k })).filter(({ k }) => !hasMonthChapter(pages, yearInView, k));
  const [newMonth, setNewMonth] = useState<number | ''>('');
  // The action in flight (adding a year or month, moving photos). A second click waits for it,
  // so a double click can't add two years or move the same photos twice.
  const [acting, setActing] = useState<string | null>(null);
  const once = (name: string, fn: () => Promise<unknown>) => {
    if (acting) return;
    setActing(name);
    void fn().finally(() => setActing(null));
  };
  // Every year and month chapter, for each photo's "Chapter" menu and the bulk move.
  const chapterOpts = chapterList(pages);
  // Photos ticked for a bulk move. The selection stays while turning pages, so it can span spreads.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const allIds = new Set(pages.flatMap((pg) => pg.photos.map((p) => p.id)));
  const pickedIds = [...picked].filter((id) => allIds.has(id));
  const spreadIds = idxs.flatMap((i) => (pages[i]?.photos ?? []).map((p) => p.id)).filter((id) => !id.startsWith('tmp-'));
  const allPicked = spreadIds.length > 0 && spreadIds.every((id) => picked.has(id));
  const togglePick = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const field = (key: string, label: string, def: string) => ({ key, label, def, value: tx[key] ?? '' });
  const openGroups = [
    { name: 'Bookplate · left page', fields: [field('plateKicker', 'Heading', 'Ex Libris'), field('plateLine', 'Line', 'This book belongs to'), field('plateName', 'Name', book.owner), field('plateFamily', 'Footer', `The ${book.family} family`)] },
    { name: 'Title page · right page', fields: [field('family', 'Top line', `The ${book.family} family`), field('script', 'Script line', poss(book.owner)), field('title', 'Title', 'Year in Review'), field('sub', 'Subtitle', '')] },
  ];

  return (
    <aside ref={panelRef} className={s.panel}>
      <div>
        <div className={s.headRow}>
          <span className={s.kicker}>Book editor</span>
          <span className={s.saved}>{editor.saved}</span>
        </div>
        <div className={s.spread}>{spreadLabel}</div>
      </div>

      <div className={s.group}>
        <label className={s.label}>Years in this book</label>
        <div className={s.chips}>
          {ch.years.map((y) => {
            const on = idxs.includes(y.idx);
            return (
              <button key={y.year} className={s.chip} onClick={() => goTo(y.idx)} style={{ background: on ? 'var(--ink)' : 'var(--surface)', color: on ? 'var(--bg)' : 'var(--ink)' }}>
                {y.year}
              </button>
            );
          })}
          <button className={s.addChip} disabled={!!acting} onClick={() => once('year', () => editor.addYear())}>+ Add {nextYear(pages)}</button>
        </div>
        {yearInView != null && freeMonths.length > 0 && (
          <div className={s.monthAdd}>
            <select className={s.select} value={newMonth} onChange={(e) => setNewMonth(e.target.value === '' ? '' : +e.target.value)} aria-label="Month chapter to add">
              <option value="">Add a month chapter to {yearInView}…</option>
              {freeMonths.map(({ m, k }) => (
                <option key={k} value={k}>{m}</option>
              ))}
            </select>
            <button
              className={s.addChip}
              disabled={newMonth === '' || !!acting}
              style={{ opacity: newMonth === '' ? 0.5 : 1 }}
              onClick={() => {
                if (newMonth === '') return;
                once('month', () => editor.addMonth(yearInView, newMonth));
                setNewMonth('');
              }}
            >
              Add
            </button>
          </div>
        )}
      </div>

      {headerPage && (
        <div className={s.group}>
          <label className={s.label}>Chapter subtitle</label>
          <input className={s.input} value={headerPage.header?.subtitle ?? ''} onChange={(e) => editor.patchPage(headerPage.id, { header: { subtitle: e.target.value } }, 500)} />
          {headerPage.layout === 'monthL' && (
            <>
              <label className={s.label} style={{ marginTop: 6 }}>Header note</label>
              <textarea className={s.textarea} rows={2} value={headerPage.header?.note ?? ''} placeholder="A handwritten line under the title" onChange={(e) => editor.patchPage(headerPage.id, { header: { note: e.target.value } }, 500)} />
            </>
          )}
        </div>
      )}

      {journalPage && (
        <div className={s.group}>
          <label className={s.label}>Journal</label>
          <textarea className={s.textarea} rows={3} value={journalPage.journal ?? ''} placeholder="A few lines about this month" onChange={(e) => editor.patchPage(journalPage.id, { journal: e.target.value }, 600)} />
          <span className={s.hint}>Shows when the right page has five photos or fewer.</span>
        </div>
      )}

      <div className={s.group}>
        <label className={s.label}>Page theme</label>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div className={s.swatch}>
            {[mainTheme.paper, mainTheme.accent, mainTheme.accent2].map((c, i) => (
              <span key={i} style={{ background: c }} />
            ))}
          </div>
          <select className={s.select} style={{ flex: 1 }} value={main.themeId} onChange={(e) => editor.setSpreadTheme(idxs, e.target.value, themeOf(themes, e.target.value).name)}>
            {themes.map((t) => (
              <option key={t.id} value={t.id}>{t.name + (t.builtin ? '' : ' (custom)')}</option>
            ))}
          </select>
        </div>
      </div>

      <div className={s.group}>
        <label className={s.label}>Sticker pack</label>
        <div className={s.chips}>
          {Object.keys(STICKER_PACKS).map((k) => (
            <button key={k} className={s.pack} onClick={() => editor.setSpreadPack(idxs, k)} style={{ background: k === packId ? 'var(--ink)' : 'var(--surface)', color: k === packId ? 'var(--bg)' : 'var(--ink)' }}>
              {STICKER_PACKS[k]!.name}
            </button>
          ))}
        </div>
      </div>

      {hasSlots && (
        <div className={s.group}>
          <div className={s.slotsHead}>
            <label className={s.label}>Add photos to this spread</label>
            <span className={s.hint}>{used} of {cap} {inMonth ? 'photos in this month' : 'slots used'}</span>
          </div>
          <div
            className={s.drop}
            role="button"
            tabIndex={0}
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              if (!dragOver) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void editor.uploadToSpread(e.dataTransfer.files, L, single);
            }}
            style={{ borderColor: dragOver ? 'var(--accent)' : 'var(--tan)', background: dragOver ? 'color-mix(in srgb, var(--accent) 8%, var(--surface))' : 'var(--surface)', transform: `scale(${dragOver ? 1.02 : 1})` }}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
            <div className={s.dropTitle}>Drop photos or videos here or <span>browse</span></div>
            <div className={s.hint}>Captions are written automatically as they land</div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={MEDIA_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void editor.uploadToSpread(e.target.files, L, single);
              e.target.value = '';
            }}
          />
        </div>
      )}

      <div className={s.group}>
        <label className={s.label}>Book &amp; spine</label>
        <div className={s.card}>
          <div className={s.field}>
            <span className={s.small}>Spine text</span>
            <input className={s.smallInput} value={book.spineText} placeholder={book.owner} onChange={(e) => patchBook(book.id, { spineText: e.target.value })} />
          </div>
          <div className={s.field} style={{ gap: 6 }}>
            <span className={s.small}>Cover type</span>
            <TexturePicker texture={book.texture} color={book.color} onChange={(p) => patchBook(book.id, p)} />
          </div>
          <SizeControls id={book.id} width={book.width} height={book.height} minH={340} onChange={(p) => patchBook(book.id, p)} />
        </div>
        <span className={s.hint}>Shows on the shelf. Leave spine text blank to use the owner's name.</span>
      </div>

      {showHero && (
        <>
          <div className={s.group}>
            <label className={s.label}>Opening pages</label>
            {openGroups.map((g) => (
              <div key={g.name} className={s.card} style={{ gap: 8 }}>
                <span className={s.groupName}>{g.name}</span>
                {g.fields.map((f) => (
                  <div key={f.key} className={s.field}>
                    <span className={s.small}>{f.label}</span>
                    <input className={s.smallInput} value={f.value} placeholder={f.def} onChange={(e) => editor.setTitleText({ [f.key]: e.target.value })} />
                  </div>
                ))}
              </div>
            ))}
            <span className={s.hint}>Leave a field blank to use the default.</span>
          </div>

          <div className={s.group}>
            <label className={s.label}>Cover photo</label>
            <div className={s.heroCard}>
              <div
                className={s.heroThumb}
                onClick={onPickHero}
                title="Replace photo"
                style={{ background: hero?.thumbUrl ? 'var(--surface2)' : `repeating-linear-gradient(135deg, rgba(255,255,255,.25) 0 6px, transparent 6px 12px), oklch(0.84 0.055 ${hero ? hueOf(hero.id) : 40})` }}
              >
                {hero?.thumbUrl && <img src={hero.thumbUrl} alt="" />}
              </div>
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span className={s.mono}>{hero?.subject ?? 'No cover photo yet'}</span>
                <textarea
                  className={s.capInput}
                  rows={2}
                  placeholder="Write a caption…"
                  disabled={!hero}
                  value={hero?.caption ?? ''}
                  onChange={(e) => hero && editor.setCaption(hero.id, e.target.value)}
                />
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className={s.inkBtn} onClick={onPickHero}>Replace</button>
                  {hero && (
                    <button className={s.regen} onClick={() => void editor.regen(hero.id)}>
                      <Sparkle />
                      Caption
                    </button>
                  )}
                  {hero && (
                    <button className={s.trash} title="Remove photo" onClick={() => void editor.removeHero()}>
                      <Trash />
                    </button>
                  )}
                </div>
              </div>
            </div>
            <span className={s.hint}>Tip: drag a photo straight onto the page to replace it.</span>
          </div>
        </>
      )}

      {!hasSlots && !showHero && (
        <div className={s.noSlots}>
          <div>This spread has no photo slots. Jump to a chapter to add photos and captions.</div>
          <div className={s.chips}>
            {chapterList(pages).map((c) => (
              <button key={c.key} className={s.jump} onClick={() => goTo(c.idx)}>{c.name.replace(' in photos', '')}</button>
            ))}
          </div>
        </div>
      )}

      {pgs.some((p) => p.photos.length) && (
        <div className={s.group} style={{ gap: 12 }}>
          <div className={s.slotsHead}>
            <label className={s.label}>Photos &amp; captions</label>
            <button
              className={s.selectAll}
              disabled={!spreadIds.length}
              onClick={() =>
                setPicked((cur) => {
                  const next = new Set(cur);
                  spreadIds.forEach((id) => (allPicked ? next.delete(id) : next.add(id)));
                  return next;
                })
              }
            >
              {allPicked ? 'Unselect these' : 'Select all'}
            </button>
            {(() => {
              const ids = idxs.flatMap((i) => (pages[i]?.photos ?? []).map((p) => p.id)).filter((id) => !id.startsWith('tmp-'));
              const busyNow = ids.some((id) => editor.loading.has(id));
              return (
                <button className={s.regen} disabled={busyNow || !ids.length} title="Write new captions for every photo on this spread" onClick={() => void editor.regenAll(ids)}>
                  <Sparkle />
                  {busyNow ? 'Writing…' : 'Regenerate all'}
                </button>
              );
            })()}
          </div>
          {idxs.flatMap((i) =>
            (pages[i]?.photos ?? []).map((p) => {
              const sel = selPhoto === p.id;
              const yl = yearSpread(pages, i);
              const busy = editor.loading.has(p.id);
              return (
                <div
                  key={p.id}
                  data-edit={p.id}
                  className={s.photoCard}
                  onClick={() => setSelPhoto(p.id)}
                  style={{ borderColor: sel ? 'var(--accent)' : 'var(--line)', boxShadow: sel ? '0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent)' : 'none' }}
                >
                  <div className={s.thumb} style={{ background: p.thumbUrl ? `url(${p.thumbUrl}) center/cover` : `repeating-linear-gradient(135deg, rgba(255,255,255,.25) 0 6px, transparent 6px 12px), oklch(0.84 0.055 ${hueOf(p.id)})` }}>
                    <input
                      type="checkbox"
                      className={s.pick}
                      aria-label={`Select ${p.subject || 'this photo'}`}
                      checked={picked.has(p.id)}
                      disabled={p.id.startsWith('tmp-')}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => togglePick(p.id)}
                    />
                  </div>
                  <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div className={s.photoMeta}>
                      <span>{p.subject}</span>
                      <span>p. {i}</span>
                    </div>
                    {chapterOpts.length > 1 && (
                      <label className={s.monthRow} onClick={(e) => e.stopPropagation()}>
                        Chapter
                        <select
                          aria-label="Chapter for this photo"
                          value={String(chapterStart(pages, i) ?? i)}
                          disabled={p.id.startsWith('tmp-') || !!acting}
                          onChange={(e) => {
                            e.stopPropagation();
                            const to = +e.target.value;
                            once('move', () => editor.moveToChapter([p.id], to));
                          }}
                        >
                          {chapterOpts.map((c) => (
                            <option key={c.key} value={c.idx}>{c.name}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    {yl != null && (
                      <label className={s.monthRow} onClick={(e) => e.stopPropagation()}>
                        Month
                        <select
                          aria-label="Month for this photo"
                          value={p.month == null ? '' : String(p.month)}
                          disabled={p.id.startsWith('tmp-')}
                          onChange={(e) => {
                            e.stopPropagation();
                            void editor.setMonth(p.id, e.target.value === '' ? null : +e.target.value);
                          }}
                        >
                          <option value="">No month</option>
                          {MONTHS.map((n, k) => (
                            <option key={k} value={k}>{n}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    {busy ? (
                      <div className={s.writing}>
                        <Sparkle size={14} />
                        {p.id.startsWith('tmp-') ? 'Uploading…' : 'Writing a caption…'}
                      </div>
                    ) : (
                      <textarea className={s.capInput} rows={2} placeholder="Write a caption…" value={p.caption} onChange={(e) => editor.setCaption(p.id, e.target.value)} />
                    )}
                    <div style={{ display: 'flex', gap: 6 }}>
                      {(() => {
                        const earlier = stepTarget(pages, idxs, p.id, -1);
                        const later = stepTarget(pages, idxs, p.id, 1);
                        const temp = p.id.startsWith('tmp-');
                        return (
                          <>
                            <button className={s.trash} title="Move earlier" aria-label="Move earlier" disabled={!earlier || temp} style={{ opacity: earlier && !temp ? 1 : 0.35 }} onClick={(e) => (e.stopPropagation(), earlier && followCard(p.id, () => void editor.movePhoto(p.id, earlier.toIdx, earlier.position)))}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                            </button>
                            <button className={s.trash} title="Move later" aria-label="Move later" disabled={!later || temp} style={{ opacity: later && !temp ? 1 : 0.35 }} onClick={(e) => (e.stopPropagation(), later && followCard(p.id, () => void editor.movePhoto(p.id, later.toIdx, later.position)))}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                            </button>
                          </>
                        );
                      })()}
                      <button className={s.regen} disabled={busy} onClick={(e) => (e.stopPropagation(), void editor.regen(p.id))}>
                        <Sparkle />
                        Regenerate
                      </button>
                      <button className={s.trash} title="Remove photo" onClick={(e) => (e.stopPropagation(), void editor.removePhoto(p.id))}>
                        <Trash />
                      </button>
                    </div>
                  </div>
                </div>
              );
            }),
          )}
        </div>
      )}

      {pickedIds.length > 0 && (
        <div className={s.bulk} role="region" aria-label="Selected photos">
          <span className={s.bulkCount}>{pickedIds.length} selected</span>
          <select
            aria-label="Move selected photos to"
            value=""
            disabled={!!acting}
            onChange={(e) => {
              const to = +e.target.value;
              once('move', () => editor.moveToChapter(pickedIds, to).then((ok) => ok && setPicked(new Set())));
            }}
          >
            <option value="" disabled>
              Move to…
            </option>
            {chapterOpts.map((c) => (
              <option key={c.key} value={c.idx}>{c.name}</option>
            ))}
          </select>
          <button className={s.bulkClear} onClick={() => setPicked(new Set())}>
            Clear
          </button>
        </div>
      )}
    </aside>
  );
}
