import { useEffect, useRef, useState } from "react";
import { MONTHS, chapterList, chapterStart, yearSpread } from "@memento/shared";
import type { BookContent, PhotoDto } from "../../api/types";
import { useViewport } from "../../lib/useViewport";
import type { BookEditor, ReviewSlot } from "./useBookEditor";
import { hueOf } from "./resolve";
import s from "./UploadReview.module.css";

interface Props {
  content: BookContent;
  editor: BookEditor;
}

const Sparkle = ({ size = 12 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinejoin="round"
  >
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
  </svg>
);
const Trash = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M19 6l-1 14H6L5 6" />
  </svg>
);

/**
 * Opens as soon as photos are added to a spread, so each one gets its caption, month and chapter
 * while it's fresh in mind. Every change saves at once, the same way as in the edit panel, so
 * closing the sheet never loses anything and the panel can change it all later.
 */
export function UploadReview({ content, editor }: Props) {
  const review = editor.review!;
  const { pages } = content;
  const { vw } = useViewport();
  const narrow = vw < 640;
  const cardRef = useRef<HTMLDivElement>(null);
  const [acting, setActing] = useState(false);
  const once = (fn: () => Promise<unknown>) => {
    if (acting) return;
    setActing(true);
    void fn().finally(() => setActing(false));
  };

  useEffect(() => cardRef.current?.focus(), []);

  // Where each photo is now. A photo that's gone (removed) drops out of the sheet.
  const where = new Map<string, { p: PhotoDto; idx: number }>();
  pages.forEach((pg, idx) =>
    pg.photos.forEach((p) => where.set(p.id, { p, idx })),
  );
  const slots = review.slots.filter(
    (x) => x.status !== "ready" || (x.id && where.has(x.id)),
  );
  const ready = slots.filter((x) => x.status === "ready").map((x) => x.id!);
  const onYear = ready.filter(
    (id) => yearSpread(pages, where.get(id)!.idx) != null,
  );
  const uploading = slots.filter((x) => x.status === "uploading").length;
  const total = review.slots.length;
  const chapterOpts = chapterList(pages);
  const writing = ready.some((id) => editor.loading.has(id));
  const noun =
    total === 1
      ? slots[0] && isVideoSlot(slots[0], where)
        ? "video"
        : "photo"
      : "photos";

  return (
    <div
      className={s.back}
      onClick={() => editor.closeReview()}
      // Keys stay in the sheet, so arrows don't turn the pages behind it.
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") editor.closeReview();
      }}
      style={{ padding: narrow ? 0 : 24 }}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        className={s.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-title"
        onClick={(e) => e.stopPropagation()}
        style={
          narrow
            ? {
                maxWidth: "none",
                height: "100%",
                maxHeight: "none",
                borderRadius: 0,
              }
            : undefined
        }
      >
        <header className={s.head}>
          <div className={s.headRow}>
            <span className={s.kicker}>
              {uploading
                ? `Adding ${total - uploading} of ${total}…`
                : "Just added"}
            </span>
            <span className={s.saved}>{editor.saved}</span>
            <button
              className={s.close}
              aria-label="Close"
              onClick={() => editor.closeReview()}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <h2 id="review-title" className={s.title}>
            Tell the story of{" "}
            {total === 1 ? `this ${noun}` : `these ${total} ${noun}`}
          </h2>
          <p className={s.sub}>
            Add captions and pick months now. Everything saves as you go, and
            you can change it later in the editor.
          </p>

          {ready.length > 1 && (
            <div className={s.all}>
              <span className={s.allLabel}>All {ready.length} photos</span>
              {onYear.length > 0 && (
                <label className={s.field}>
                  <span>Month</span>
                  <select
                    className={s.allSelect}
                    aria-label="Month for all photos"
                    value=""
                    disabled={acting}
                    onChange={(e) => {
                      const m =
                        e.target.value === "none" ? null : +e.target.value;
                      once(() => editor.setMonths(onYear, m));
                    }}
                  >
                    <option value="" disabled>
                      Select month…
                    </option>
                    {MONTHS.map((n, k) => (
                      <option key={k} value={k}>
                        {n}
                      </option>
                    ))}
                    <option value="none">No month</option>
                  </select>
                </label>
              )}
              {chapterOpts.length > 1 && (
                <label className={s.field}>
                  <span>Chapter</span>
                  <select
                    className={s.allSelect}
                    aria-label="Chapter for all photos"
                    value=""
                    disabled={acting}
                    onChange={(e) => {
                      const to = +e.target.value;
                      once(() => editor.moveToChapter(ready, to));
                    }}
                  >
                    <option value="" disabled>
                      Select chapter…
                    </option>
                    {chapterOpts.map((c) => (
                      <option key={c.key} value={c.idx}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                className={s.ai}
                disabled={writing}
                onClick={() => void editor.regenAll(ready)}
              >
                <Sparkle />
                {writing ? "Writing…" : "Write all captions"}
              </button>
            </div>
          )}
        </header>

        <div className={s.list}>
          {slots.map((slot, i) => {
            const at = slot.id ? where.get(slot.id) : undefined;
            const p = at?.p;
            const busy = !!p && editor.loading.has(p.id);
            const thumb = p?.thumbUrl ?? slot.preview;
            const isYear = at != null && yearSpread(pages, at.idx) != null;
            return (
              <div
                key={slot.key}
                className={s.item}
                style={{
                  animationDelay: `${Math.min(i, 8) * 40}ms`,
                  gridTemplateColumns: narrow
                    ? "84px minmax(0,1fr)"
                    : "132px minmax(0,1fr)",
                }}
              >
                <div
                  className={s.thumb}
                  style={{
                    background: thumb
                      ? `url(${thumb}) center/cover`
                      : `repeating-linear-gradient(135deg, rgba(255,255,255,.25) 0 6px, transparent 6px 12px), oklch(0.84 0.055 ${hueOf(slot.key)})`,
                    opacity: slot.status === "failed" ? 0.45 : 1,
                  }}
                >
                  {slot.status === "uploading" && (
                    <span className={s.shimmer} />
                  )}
                  {p?.durationMs != null && (
                    <span className={s.badge}>{fmtDuration(p.durationMs)}</span>
                  )}
                </div>

                {slot.status === "failed" ? (
                  <div className={s.fields}>
                    <div className={s.name}>{slot.name}</div>
                    <div className={s.error}>{slot.error}</div>
                  </div>
                ) : (
                  <div className={s.fields}>
                    <div className={s.row}>
                      <input
                        className={s.subject}
                        value={p?.subject ?? ""}
                        placeholder={
                          p
                            ? "What's in it? e.g. Grandma's birthday cake"
                            : slot.name
                        }
                        aria-label="What's in the photo"
                        maxLength={200}
                        title="What's in the photo. AI captions are written from this."
                        disabled={!p}
                        onChange={(e) =>
                          p && editor.setSubject(p.id, e.target.value)
                        }
                      />
                      {p && (
                        <button
                          className={s.trash}
                          title="Remove photo"
                          aria-label="Remove photo"
                          onClick={() => void editor.removePhoto(p.id)}
                        >
                          <Trash />
                        </button>
                      )}
                    </div>

                    {!p ? (
                      <div className={s.writing}>Uploading…</div>
                    ) : busy ? (
                      <div className={s.writing}>
                        <Sparkle size={14} />
                        Writing a caption…
                      </div>
                    ) : (
                      <textarea
                        className={s.caption}
                        rows={2}
                        maxLength={300}
                        placeholder="Write a caption…"
                        value={p.caption}
                        aria-label="Caption"
                        onChange={(e) =>
                          editor.setCaption(p.id, e.target.value)
                        }
                      />
                    )}

                    <div className={s.row} style={{ flexWrap: "wrap" }}>
                      <button
                        className={s.ai}
                        disabled={!p || busy}
                        onClick={() => p && void editor.regen(p.id)}
                      >
                        <Sparkle />
                        {p?.caption ? "Rewrite with AI" : "Write with AI"}
                      </button>
                    </div>

                    <div
                      className={s.row}
                      style={{ flexWrap: "wrap", alignItems: "flex-end" }}
                    >
                      {p && at && isYear && (
                        <label className={s.field}>
                          <span>Month</span>
                          <select
                            className={s.select}
                            aria-label="Month for this photo"
                            value={p.month == null ? "" : String(p.month)}
                            onChange={(e) =>
                              void editor.setMonth(
                                p.id,
                                e.target.value === "" ? null : +e.target.value,
                              )
                            }
                            style={{
                              borderColor:
                                p.month == null ? "var(--accent)" : undefined,
                            }}
                          >
                            <option value="">Select month…</option>
                            {MONTHS.map((n, k) => (
                              <option key={k} value={k}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      {p && at && chapterOpts.length > 1 && (
                        <label className={s.field}>
                          <span>Chapter</span>
                          <select
                            className={s.select}
                            aria-label="Chapter for this photo"
                            value={String(
                              chapterStart(pages, at.idx) ?? at.idx,
                            )}
                            disabled={acting}
                            onChange={(e) => {
                              const to = +e.target.value;
                              once(() => editor.moveToChapter([p.id], to));
                            }}
                          >
                            {chapterOpts.map((c) => (
                              <option key={c.key} value={c.idx}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {!slots.length && <p className={s.sub}>Nothing left here.</p>}
        </div>

        <footer className={s.foot}>
          <span className={s.hint}>
            {uploading
              ? "You can start while the rest upload."
              : "Change any of this later in the book editor."}
          </span>
          <button className={s.done} onClick={() => editor.closeReview()}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

function isVideoSlot(slot: ReviewSlot, where: Map<string, { p: PhotoDto }>) {
  return slot.id
    ? where.get(slot.id)?.p.durationMs != null
    : /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i.test(slot.name);
}

function fmtDuration(ms: number) {
  const t = Math.round(ms / 1000);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}
