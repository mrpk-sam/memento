import { z } from 'zod';

export const Access = z.enum(['admin', 'household_admin', 'member']);
export type Access = z.infer<typeof Access>;

export const Texture = z.enum(['leather', 'linen', 'matte']);
export type Texture = z.infer<typeof Texture>;

export const BookKind = z.enum(['main', 'small']);
export type BookKind = z.infer<typeof BookKind>;

export const PageType = z.enum(['endpaper', 'title', 'index', 'chapters', 'summary', 'month', 'closing', 'backpaper']);
export type PageType = z.infer<typeof PageType>;

export const Layout = z.enum(['summaryL', 'summaryR', 'monthL', 'monthR']);
export type Layout = z.infer<typeof Layout>;

export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const Email = z.string().trim().toLowerCase().email();
export const Pin = z.string().regex(/^\d{4}$/, 'PIN must be 4 digits');
export const Month = z.number().int().min(0).max(11);

export const PageHeader = z.object({
  kicker: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  note: z.string().optional(),
});
export type PageHeader = z.infer<typeof PageHeader>;

/** Free text on the title page (script line, title, etc.). */
export const TitleText = z.record(z.string(), z.string());

export const Photo = z.object({
  id: z.string(),
  pageId: z.string().nullable(),
  position: z.number().int(),
  subject: z.string(),
  caption: z.string(),
  month: Month.nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  thumbUrl: z.string().nullable(),
  displayUrl: z.string().nullable(),
  /** Set when the item is a video. The thumb and display images are its poster frame. */
  videoUrl: z.string().nullable(),
  durationMs: z.number().int().nullable(),
});
export type Photo = z.infer<typeof Photo>;

export const Page = z.object({
  id: z.string(),
  position: z.number().int(),
  type: PageType,
  layout: Layout.nullable(),
  themeId: z.string(),
  stickerPack: z.string(),
  label: z.string().nullable(),
  year: z.number().int().nullable(),
  header: PageHeader.nullable(),
  journal: z.string().nullable(),
  text: TitleText.nullable(),
  heroPhotoId: z.string().nullable(),
  photos: z.array(Photo),
});
export type Page = z.infer<typeof Page>;

export const Book = z.object({
  id: z.string(),
  householdId: z.string(),
  kind: BookKind,
  ownerName: z.string().nullable(),
  spineText: z.string(),
  texture: Texture,
  color: HexColor,
  width: z.number().int(),
  height: z.number().int(),
  locked: z.boolean(),
  hasPin: z.boolean(),
  sortOrder: z.number().int(),
  updatedAt: z.string(),
});
export type Book = z.infer<typeof Book>;

export const Household = z.object({
  id: z.string(),
  name: z.string(),
  surname: z.string(),
  sortOrder: z.number().int(),
});
export type Household = z.infer<typeof Household>;

export const User = z.object({
  id: z.string(),
  name: z.string(),
  roleLabel: z.string(),
  email: z.string().nullable(),
  access: Access,
  householdId: z.string().nullable(),
});
export type User = z.infer<typeof User>;
