import { memo, type CSSProperties, type MouseEvent } from 'react';
import { hash, rng } from '@memento/shared';
import { duration } from '../../lib/text';
import type { RPage } from './resolve';
import s from './ScrapbookPage.module.css';

export interface Rect { x: number; y: number; w: number; h: number }

interface Props {
  page: RPage | null;
  scale: number;
  editMode?: boolean;
  selectedId?: string | null;
  onPhoto?: (id: string) => void;
  onJump?: (idx: number) => void;
  onOpen?: ((id: string, rect: Rect) => void) | null;
  onHero?: () => void;
  /** Clicking an empty photo area: pick photos (edit mode) or start editing (read mode). */
  onEmpty?: () => void;
  /** Edit mode: pressing on a photo may start a drag to rearrange it. */
  onPhotoPointerDown?: (e: React.PointerEvent<HTMLDivElement>, photoId: string) => void;
  /** The photo being dragged, shown faded. */
  dragId?: string | null;
  /** Where a dragged photo would land: before/after a photo, or at the end of a page. */
  dropHint?: { pid?: string; after?: boolean; pageIdx?: number } | null;
}

const phBg = (hue: number | undefined, src?: string | null) =>
  src ? `url(${src})` : `repeating-linear-gradient(135deg, rgba(255,255,255,.22) 0 7px, transparent 7px 14px), oklch(0.84 0.055 ${hue ?? 60})`;

const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

/** One 600×750 scrapbook page, scaled. Ported from ScrapbookPage.dc.html. */
export const ScrapbookPage = memo(function ScrapbookPage({ page, scale, editMode, selectedId, onPhoto, onJump, onOpen, onHero, onEmpty, onPhotoPointerDown, dragId, dropHint }: Props) {
  const p = page ?? { id: 'blank', type: 'blank', layout: null, side: 'right' as const, num: null, theme: undefined, owner: undefined, stickers: [], header: null, journal: null, text: {} };
  const th = { paper: '#FBF7EF', ink: '#3A3026', accent: '#A8643F', accent2: '#6E7F5E', motif: 'none', flags: [] as string[], ...(p.theme ?? {}) };
  const edit = !!editMode;
  const motifs = String(th.motif || 'none').split('+');
  const has = (m: string) => motifs.includes(m);
  const owner = p.owner ?? { name: '', poss: '', color: '#8C6A4A', family: '' };
  const layout = p.layout ?? '';
  const photoCount = (('photos' in p && p.photos) || []).length;
  // The first month page keeps the prototype's two big columns up to 4 photos,
  // then switches to three columns (like a year page) to fit up to 6.
  const roomyMonth = layout === 'monthL' && photoCount <= 4;
  const cols = roomyMonth ? 2 : 3;
  // The page is drawn at 600×750 and scaled down. On a phone (scale ~0.6) a 16.5px caption ends
  // up near 10px, so small text grows as the page shrinks, aiming for ~12px on screen. The cap
  // keeps captions within their photo cards.
  const textBoost = Math.min(1.35, Math.max(1, 12 / (16.5 * scale)));
  const tagBoost = Math.min(1.6, Math.max(1, 8 / (9 * scale)));
  const muted = `color-mix(in srgb, ${th.ink} 62%, ${th.paper})`;
  const isEnd = p.type === 'endpaper' || p.type === 'backpaper';

  const photos = (('photos' in p && p.photos) || []).map((ph, i) => {
    const r = rng(hash(ph.id));
    let span = 1;
    let h = 104;
    if (roomyMonth) h = 124;
    if (layout === 'monthR') {
      if (i === 0) {
        span = 2;
        h = 176;
      } else if (i === 1) h = 176;
      else h = 116;
    }
    const washi = i % 3 === 1;
    const selected = edit && selectedId === ph.id;
    return {
      ...ph,
      subjectShown: ph.monthTag ? ph.subject.replace(/^[A-Z][a-z]+ · /, '') : ph.subject,
      span,
      h,
      rot: (r() * 5 - 2.5).toFixed(2),
      tapeRot: (r() * 12 - 6).toFixed(1),
      tapeLeft: Math.round(30 + r() * 40),
      tape: washi
        ? `repeating-linear-gradient(45deg, color-mix(in srgb, ${th.accent} 55%, transparent) 0 5px, color-mix(in srgb, ${th.accent} 28%, transparent) 5px 10px)`
        : 'rgba(240,230,205,.8)',
      capText: ph.caption || (edit ? 'add a caption…' : ''),
      capColor: ph.caption ? '#3A3026' : 'rgba(58,48,38,.4)',
      outline: selected ? `2.5px solid ${th.accent}` : edit ? '1.5px dashed rgba(60,40,20,.35)' : '0px solid transparent',
      cursor: edit ? 'pointer' : onOpen ? 'zoom-in' : 'default',
    };
  });

  const onPhotoClick = (id: string) => (e: MouseEvent<HTMLDivElement>) => {
    if (edit) {
      e.stopPropagation();
      onPhoto?.(id);
      return;
    }
    if (!onOpen) return;
    e.stopPropagation();
    onOpen(id, rectOf(e.currentTarget));
  };

  // Decoration, seeded per page so it never jumps between renders.
  const R = rng(hash(p.id + 'deco'));
  const edgePt = () => {
    const side = Math.floor(R() * 4);
    if (side === 0) return { x: 6 + R() * 26, y: 60 + R() * 640 };
    if (side === 1) return { x: 566 + R() * 24, y: 60 + R() * 640 };
    if (side === 2) return { x: 20 + R() * 560, y: 40 + R() * 18 };
    return { x: 20 + R() * 560, y: 716 + R() * 22 };
  };
  const flagColors = th.flags?.length ? th.flags : [th.accent, '#F3ECE2', th.accent2];
  const flags = has('bunting')
    ? Array.from({ length: 14 }, (_, i) => {
        const t = i / 13;
        return { left: 6 + i * 42, top: Math.round(5 + 4 * 17.5 * t * (1 - t)), c: flagColors[i % flagColors.length]!, rot: ((0.5 - t) * -16).toFixed(1) };
      })
    : [];
  let glyphs: { left: number; top: number; t: string; size: number; c: string; rot: number; op: number }[] = [];
  if (has('stars'))
    glyphs = Array.from({ length: 16 }, (_, i) => {
      const pt = edgePt();
      return { left: Math.round(pt.x), top: Math.round(pt.y), t: ['✦', '★', '✧'][i % 3]!, size: Math.round(10 + R() * 12), c: i % 2 ? th.accent : th.accent2, rot: Math.round(R() * 40 - 20), op: 0.7 };
    });
  if (has('snow'))
    glyphs = Array.from({ length: 18 }, (_, i) => {
      const pt = edgePt();
      return { left: Math.round(pt.x), top: Math.round(Math.min(pt.y, 690)), t: ['❅', '❆', '✻'][i % 3]!, size: Math.round(11 + R() * 13), c: 'rgba(96,140,176,.6)', rot: Math.round(R() * 60), op: 0.85 };
    });
  const confetti = has('confetti')
    ? Array.from({ length: 30 }, (_, i) => {
        const pt = edgePt();
        const round = R() > 0.5;
        return { left: Math.round(pt.x), top: Math.round(pt.y), w: round ? 7 : Math.round(4 + R() * 5), h: round ? 7 : Math.round(8 + R() * 6), r: round ? '50%' : '1px', c: [th.accent, th.accent2, '#F2C14E'][i % 3]!, rot: Math.round(R() * 180) };
      })
    : [];
  const trees = has('snow') ? [{ left: 18, w: 34, h: 50 }, { left: 44, w: 26, h: 38 }, { left: 530, w: 36, h: 54 }, { left: 508, w: 22, h: 32 }] : [];
  const washi = has('washi')
    ? [
        { left: -26, top: 22, rot: -38, bg: `repeating-linear-gradient(90deg, color-mix(in srgb, ${th.accent} 50%, transparent) 0 8px, color-mix(in srgb, ${th.accent} 25%, transparent) 8px 16px)` },
        { left: 506, top: 704, rot: -38, bg: `repeating-linear-gradient(90deg, color-mix(in srgb, ${th.accent2} 50%, transparent) 0 8px, color-mix(in srgb, ${th.accent2} 25%, transparent) 8px 16px)` },
      ]
    : [];
  const padTop = has('bunting') ? 74 : has('snow') ? 58 : 48;
  const side = p.side ?? 'right';
  const gutter =
    p.type === 'blank'
      ? 'linear-gradient(90deg, rgba(60,40,20,.08), transparent 20%)'
      : side === 'left'
        ? 'linear-gradient(to left, rgba(60,40,20,.24), rgba(60,40,20,.06) 5%, rgba(60,40,20,0) 11%)'
        : 'linear-gradient(to right, rgba(60,40,20,.24), rgba(60,40,20,.06) 5%, rgba(60,40,20,0) 11%)';
  const c = owner.color || '#8C6A4A';
  const endBg = `radial-gradient(circle at 50% 50%, color-mix(in srgb, ${c} 45%, transparent) 0 2.5px, transparent 3px) 0 0/30px 30px, radial-gradient(circle at 50% 50%, color-mix(in srgb, ${c} 25%, transparent) 0 1.6px, transparent 2px) 15px 15px/30px 30px, repeating-linear-gradient(45deg, color-mix(in srgb, ${c} 10%, transparent) 0 1px, transparent 1px 21px), repeating-linear-gradient(-45deg, color-mix(in srgb, ${c} 10%, transparent) 0 1px, transparent 1px 21px), color-mix(in srgb, ${c} 12%, #F4ECDD)`;

  const h = p.header ?? {};
  const tx: Record<string, string> = p.text ?? {};
  const famLine = `The ${owner.family} family`;
  const hero = 'hero' in p ? p.hero : null;
  const hSize = layout === 'summaryL' ? 92 : 74;
  const hasPhotoSlots = 'photos' in p && Array.isArray(p.photos);
  const isEmpty = hasPhotoSlots && photos.length === 0;
  const entries = ('entries' in p && p.entries) || [];
  const jump = (target: number) => (e: MouseEvent) => {
    e.stopPropagation();
    onJump?.(target);
  };

  return (
    <div className={s.frame} data-page-idx={'idx' in p ? p.idx : undefined} style={{ background: isEnd ? '#F4ECDD' : th.paper }}>
      <div className={s.sheet} style={{ transform: `scale(${scale})`, color: th.ink }}>
        <div className={s.sheen} />

        {isEnd && (
          <>
            <div className={s.fill} style={{ background: endBg }} />
            {p.type === 'endpaper' && (
              <div className={s.plate} style={{ border: `1px solid ${c}`, outline: `1px solid ${c}` }}>
                <div className={s.plateKicker} style={{ color: c }}>{tx.plateKicker || 'Ex Libris'}</div>
                <div className={s.plateLine}>{tx.plateLine || 'This book belongs to'}</div>
                <div className={s.plateName}>{tx.plateName || owner.name}</div>
                <div className={s.plateRule} style={{ background: c }} />
                <div className={s.plateFamily}>{tx.plateFamily || famLine}</div>
              </div>
            )}
          </>
        )}

        {washi.map((w, i) => (
          <div key={i} className={s.washi} style={{ left: w.left, top: w.top, background: w.bg, transform: `rotate(${w.rot}deg)` }} />
        ))}
        {has('snow') && (
          <>
            <div className={s.snowTop} />
            <div className={s.snowBottom} />
            {trees.map((t, i) => (
              <div key={i} className={s.tree} style={{ left: t.left, width: t.w, height: t.h, background: th.accent }} />
            ))}
          </>
        )}
        {glyphs.map((g, i) => (
          <div key={i} className={s.glyph} style={{ left: g.left, top: g.top, fontSize: g.size, color: g.c, transform: `rotate(${g.rot}deg)`, opacity: g.op }}>
            {g.t}
          </div>
        ))}
        {confetti.map((cf, i) => (
          <div key={i} className={s.confetti} style={{ left: cf.left, top: cf.top, width: cf.w, height: cf.h, borderRadius: cf.r, background: cf.c, transform: `rotate(${cf.rot}deg)` }} />
        ))}
        {has('bunting') && (
          <>
            <svg width="600" height="44" viewBox="0 0 600 44" className={s.string}>
              <path d="M-4 5 Q300 40 604 5" stroke="#8C7A66" strokeWidth="1.4" fill="none" />
            </svg>
            {flags.map((f, i) => (
              <div key={i} className={s.flag} style={{ left: f.left, top: f.top, background: f.c, transform: `rotate(${f.rot}deg)` }} />
            ))}
          </>
        )}

        <div className={s.body} style={{ padding: `${padTop}px 44px 40px` }}>
          {p.type === 'title' && (
            <div className={s.title}>
              <div className={s.titleFamily} style={{ color: th.accent }}>{tx.family || famLine}</div>
              <div className={s.titleRule} style={{ color: th.accent }}>
                <span />
                <span style={{ fontSize: 13, width: 'auto', height: 'auto', background: 'none' }}>✦</span>
                <span />
              </div>
              <div className={s.titleScript} style={{ color: th.accent }}>{tx.script || owner.poss}</div>
              <div className={s.titleMain}>{tx.title || 'Year in Review'}</div>
              <div className={s.titleSub} style={{ color: muted }}>{tx.sub || ('yearsLabel' in p ? p.yearsLabel : '')}</div>
              <div
                className={s.hero}
                title={edit ? 'Click or drop a photo to replace' : ''}
                style={{ cursor: edit ? 'pointer' : onOpen && hero ? 'zoom-in' : 'default', outline: edit ? `2px dashed color-mix(in srgb, ${th.accent} 55%, transparent)` : 'none' }}
                data-pid={hero?.id}
                onClick={(e) => {
                  if (edit) {
                    e.stopPropagation();
                    onHero?.();
                    return;
                  }
                  if (!onOpen || !hero) return;
                  e.stopPropagation();
                  onOpen(hero.id, rectOf(e.currentTarget));
                }}
              >
                <div className={s.heroTape} />
                <div className={s.heroImg} style={{ background: phBg(hero?.hue ?? 40) }}>
                  {hero?.src && <img src={hero.full ?? hero.src} alt="" className={s.cover} />}
                  {!hero?.src && <span className={s.subject} style={{ fontSize: 10, padding: 7 }}>{hero?.subject ?? ''}</span>}
                  {edit && (
                    <div className={s.replace} style={{ color: th.accent }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
                      Replace photo
                    </div>
                  )}
                </div>
                <div className={s.heroCap} style={{ color: hero?.caption ? '#3A3026' : 'rgba(58,48,38,.4)' }}>{hero?.caption || (edit ? 'add a caption…' : '')}</div>
              </div>
            </div>
          )}

          {p.type === 'index' && (
            <>
              <div className={s.kicker} style={{ color: th.accent, letterSpacing: '.32em', paddingTop: 20 }}>Contents</div>
              <div className={s.bigTitle}>The years</div>
              <div className={s.tapHint} style={{ color: muted }}>Tap a year to jump right in.</div>
              <div className={s.indexList}>
                {entries.map((e) => (
                  <div key={e.target} className={s.indexEntry} onClick={jump(e.target)}>
                    <div className={s.thumbs}>
                      {(e.thumbs ?? []).map((t, i) => (
                        <div key={i} className={s.thumb} style={{ left: i * 30, top: [14, 0, 18][i % 3], transform: `rotate(${[-7, 3, 9][i % 3]}deg)` }}>
                          <div style={{ height: 64, background: phBg(t.hue, t.src), backgroundSize: 'cover', backgroundPosition: 'center' }} />
                        </div>
                      ))}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className={s.entryYear}>{e.kicker}</div>
                      <div className={s.entryTitle} style={{ color: th.accent }}>{e.title}</div>
                      <div className={s.entryMeta} style={{ color: muted }}>
                        <span>{e.sub}</span>
                        <span className={s.dots} />
                        <span>{e.pageLabel}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {p.type === 'chapters' && (
            <>
              <div className={s.kicker} style={{ color: th.accent, letterSpacing: '.32em', paddingTop: 20 }}>Chapters</div>
              <div className={s.bigTitle}>{'chaptersTitle' in p ? p.chaptersTitle : ''}</div>
              <div className={s.chList}>
                {entries.map((e) => (
                  <div key={e.target} className={s.chRow} onClick={jump(e.target)}>
                    {e.flagImgs?.length ? (
                      <div style={{ position: 'relative', height: 40 }}>
                        {e.flagImgs.map((f, i) => (
                          <img key={i} src={f.src} alt={f.alt} className={s.flagImg} style={{ left: f.left, top: f.top, width: f.w, transform: `rotate(${f.rot}deg)` }} />
                        ))}
                      </div>
                    ) : (
                      <div title={e.iconLabel} className={s.chIcon} style={{ background: e.tileBg, color: e.iconColor }}>
                        <i className={e.iconClass} />
                      </div>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div className={s.chTitle}>{e.title}</div>
                      <div className={s.chSub} style={{ color: muted }}>{e.sub}</div>
                    </div>
                    <div className={s.chPage} style={{ color: muted }}>{e.pageLabel}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {p.header && (
            <div style={{ marginBottom: 20 }}>
              <div className={s.kicker} style={{ color: th.accent }}>{h.kicker}</div>
              <div className={s.hTitle} style={{ fontSize: hSize }}>{h.title}</div>
              <div className={s.hSub} style={{ color: muted }}>{h.subtitle}</div>
              {h.note && <div className={s.hNote} style={{ color: th.accent }}>{h.note}</div>}
            </div>
          )}

          {isEmpty && (
            <div
              className={onEmpty ? `${s.empty} ${s.emptyClickable}` : s.empty}
              role={onEmpty ? 'button' : undefined}
              tabIndex={onEmpty ? 0 : undefined}
              aria-label={onEmpty ? (edit ? 'Add photos to this page' : 'Edit this book to add photos') : undefined}
              onClick={(e) => {
                if (!onEmpty) return;
                e.stopPropagation();
                onEmpty();
              }}
              onKeyDown={(e) => onEmpty && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onEmpty())}
              style={{ height: p.header ? 400 : 620, border: `2px dashed ${th.accent}`, '--accent': th.accent } as CSSProperties}
            >
              {onEmpty && edit && (
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={th.accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
              )}
              <div className={s.emptyTitle} style={{ color: th.accent }}>Room for memories</div>
              <div className={s.emptyHint} style={{ color: th.ink }}>
                {edit
                  ? onEmpty
                    ? 'Click to add photos, or drop them onto this spread.'
                    : 'Drop photos onto this spread, or use Upload in the editor.'
                  : onEmpty
                    ? 'Click to start adding photos to this page.'
                    : 'Switch to Edit to add photos to this year.'}
              </div>
            </div>
          )}

          {photos.length > 0 && (
            <div
              className={s.grid}
              style={{
                gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`,
                outline: dropHint && !dropHint.pid && 'idx' in p && dropHint.pageIdx === p.idx ? `2px dashed ${th.accent}` : undefined,
                outlineOffset: 8,
              }}
            >
              {photos.map((ph, pos) => {
                const hint = dropHint?.pid === ph.id ? (dropHint.after ? 1 : -1) : 0;
                return (
                <div
                  key={ph.id}
                  data-pid={ph.id}
                  data-pos={pos}
                  data-page-idx={'idx' in p ? p.idx : undefined}
                  className={s.photo}
                  onClick={onPhotoClick(ph.id)}
                  onPointerDown={edit && onPhotoPointerDown ? (e) => onPhotoPointerDown(e, ph.id) : undefined}
                  onDragStart={edit && onPhotoPointerDown ? (e) => e.preventDefault() : undefined}
                  style={
                    {
                      gridColumn: `span ${ph.span}`,
                      '--rot': `${ph.rot}deg`,
                      outline: ph.outline,
                      cursor: edit && onPhotoPointerDown ? 'grab' : ph.cursor,
                      touchAction: edit && onPhotoPointerDown ? 'none' : undefined,
                      opacity: dragId === ph.id ? 0.35 : 1,
                      boxShadow: hint ? `${hint * 9}px 0 0 -3px ${th.accent}, 0 1px 2px rgba(60,40,20,.16), 0 8px 16px -8px rgba(60,40,20,.38)` : undefined,
                    } as CSSProperties
                  }
                >
                  <div className={s.tape} style={{ left: `${ph.tapeLeft}%`, background: ph.tape, transform: `rotate(${ph.tapeRot}deg)` }} />
                  <div className={s.photoImg} style={{ height: ph.h, background: phBg(ph.hue) }}>
                    {ph.src && <img src={ph.src} alt="" loading="lazy" className={s.cover} draggable={false} />}
                    {!ph.src && <span className={s.subject}>{ph.subjectShown}</span>}
                    {ph.monthTag && <span className={s.monthTag} style={{ color: th.accent, fontSize: 9 * tagBoost }}>{ph.monthTag}</span>}
                    {ph.video && <PlayTag durationMs={ph.durationMs} color={th.accent} size={9 * tagBoost} />}
                  </div>
                  {ph.loading ? (
                    <div className={s.capLoading}>
                      <div style={{ width: '90%', background: `color-mix(in srgb, ${th.accent} 35%, #eee)` }} />
                      <div style={{ width: '60%', background: `color-mix(in srgb, ${th.accent} 35%, #eee)` }} />
                    </div>
                  ) : (
                    <div className={s.caption} style={{ fontSize: (layout === 'monthR' || roomyMonth ? 18 : 16.5) * textBoost, color: ph.capColor }}>{ph.capText}</div>
                  )}
                </div>
                );
              })}
            </div>
          )}

          {!!p.journal && photos.length <= 5 && (
            <div className={s.journal}>
              <div className={s.margin} />
              <div className={s.journalTape} style={{ background: `color-mix(in srgb, ${th.accent} 45%, transparent)` }} />
              {p.journal}
            </div>
          )}

          {p.type === 'closing' && (
            <div className={s.closing}>
              <div style={{ fontSize: 14, color: th.accent }}>✦ ✦ ✦</div>
              <div className={s.closingTitle}>To be continued</div>
              <div className={s.closingNote} style={{ color: th.accent }}>
                Leave room for {'nextYear' in p ? p.nextYear : ''}. There's always more to keep.
              </div>
              <div className={s.closingSig} style={{ color: muted }}>With love, {owner.name}</div>
            </div>
          )}
        </div>

        {p.stickers.map((st, i) => (
          <div
            key={i}
            className={s.sticker}
            style={{ left: st.left, top: st.top, width: st.w, height: st.h, transform: `rotate(${st.rot}deg)`, fontFamily: st.font, fontSize: st.size, fontWeight: st.weight, letterSpacing: st.ls, color: st.color, border: st.border, borderRadius: st.radius, background: st.bg }}
          >
            {st.text}
          </div>
        ))}

        {p.num != null && (
          <div className={s.num} style={{ textAlign: side === 'left' ? 'left' : 'right', color: muted }}>{p.num}</div>
        )}
        <div className={s.fill} style={{ pointerEvents: 'none', background: gutter }} />
        <div className={s.dim} />
      </div>
    </div>
  );
});

/** Marks a video on its page tile: a play triangle and the running time. */
function PlayTag({ durationMs, color, size }: { durationMs?: number | null; color: string; size: number }) {
  return (
    <span className={s.playTag} style={{ color, fontSize: size }} aria-label="Video">
      <svg width={size * 0.9} height={size} viewBox="0 0 8 9" fill="currentColor" aria-hidden="true"><path d="M0 0l8 4.5L0 9z" /></svg>
      {durationMs ? duration(durationMs) : null}
    </span>
  );
}
