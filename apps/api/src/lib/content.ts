import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import * as s from '../db/schema.js';

export const mediaUrl = (key: string | null) => (key ? `/api/media/${key}` : null);

export type PhotoRow = typeof s.photos.$inferSelect;

export function photoDto(p: PhotoRow) {
  return {
    id: p.id,
    pageId: p.pageId,
    position: p.position,
    subject: p.subject,
    caption: p.caption,
    month: p.month,
    width: p.width,
    height: p.height,
    thumbUrl: mediaUrl(p.thumbKey),
    displayUrl: mediaUrl(p.displayKey),
  };
}

/** Pages in order, each with its live photos in position order, plus the title page's hero photo. */
export async function loadPages(db: Db, bookId: string) {
  const pages = await db.select().from(s.pages).where(eq(s.pages.bookId, bookId)).orderBy(asc(s.pages.position));
  const photos = await db
    .select()
    .from(s.photos)
    .where(and(eq(s.photos.bookId, bookId), isNull(s.photos.deletedAt)))
    .orderBy(asc(s.photos.position));
  const heroIds = pages.map((p) => p.heroPhotoId).filter((x): x is string => !!x);
  const heroes = heroIds.length ? await db.select().from(s.photos).where(inArray(s.photos.id, heroIds)) : [];
  return pages.map((pg) => {
    const hero = pg.heroPhotoId ? heroes.find((h) => h.id === pg.heroPhotoId && !h.deletedAt) : undefined;
    return {
      id: pg.id,
      position: pg.position,
      type: pg.type,
      layout: pg.layout,
      themeId: pg.themeId,
      stickerPack: pg.stickerPack,
      label: pg.label,
      year: pg.year,
      header: pg.header,
      journal: pg.journal,
      text: pg.text,
      hero: hero ? photoDto(hero) : null,
      photos: photos.filter((p) => p.pageId === pg.id).map(photoDto),
    };
  });
}

export type PageDto = Awaited<ReturnType<typeof loadPages>>[number];
