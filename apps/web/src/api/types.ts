import type { Access } from '@memento/shared';

export interface Me {
  user: { id: string; name: string; roleLabel: string; email: string | null; access: Access; householdId: string | null; surname: string; avatarColor: string; isSuperAdmin: boolean };
  deskTabs: string[];
  unlocks: { bookId: string; expiresAt: string }[];
}

export interface PersonRow {
  id: string;
  name: string;
  roleLabel: string;
  email: string | null;
  access: Access;
  householdId: string | null;
  isSuperAdmin: boolean;
  invite: { sentAt: string; expiresAt: string; resentCount: number } | null;
}

export interface PeopleData {
  households: { id: string; name: string; surname: string; mainBook: { id: string; texture: string; color: string; title: string } | null }[];
  people: PersonRow[];
}

export interface LibraryBook {
  id: string;
  householdId: string;
  kind: 'main' | 'small';
  ownerName: string | null;
  owner: string;
  title: string;
  titleText: Record<string, string>;
  spineText: string;
  texture: 'leather' | 'linen' | 'matte';
  color: string;
  width: number;
  height: number;
  locked: boolean;
  hasPin: boolean;
  canEdit: boolean;
  sortOrder: number;
  updatedAt: string;
  pageCount: number;
  years: number[];
}

export interface Library {
  settings: { familyName: string; landing: Record<string, string>; lockNewBooks: boolean; aiAuto: boolean };
  households: { id: string; name: string; surname: string }[];
  books: LibraryBook[];
}

export interface PhotoDto {
  id: string;
  pageId: string | null;
  position: number;
  subject: string;
  caption: string;
  month: number | null;
  width: number | null;
  height: number | null;
  thumbUrl: string | null;
  displayUrl: string | null;
}

export interface PageDto {
  id: string;
  position: number;
  type: string;
  layout: string | null;
  themeId: string;
  stickerPack: string;
  label: string | null;
  year: number | null;
  header: { kicker?: string; title?: string; subtitle?: string; note?: string } | null;
  journal: string | null;
  text: Record<string, string> | null;
  hero: PhotoDto | null;
  photos: PhotoDto[];
}

export interface BookContent {
  book: {
    id: string;
    householdId: string;
    kind: 'main' | 'small';
    owner: string;
    title: string;
    family: string;
    spineText: string;
    texture: 'leather' | 'linen' | 'matte';
    color: string;
    width: number;
    height: number;
    locked: boolean;
    hasPin: boolean;
    canEdit: boolean;
    updatedAt: string;
  };
  pages: PageDto[];
}

export interface Theme {
  id: string;
  name: string;
  paper: string;
  ink: string;
  accent: string;
  accent2: string;
  motif: string;
  flags: string[];
  stickerPack: string;
  builtin: boolean;
}

export interface CaptionStyle { id: string; key: string | null; name: string; prompt: string; builtin: boolean }

export interface AiSettings {
  endpoint: string;
  keyMasked: string;
  hasKey: boolean;
  model: string;
  vision: boolean;
  voiceStyleId: string | null;
  basePrompt: string;
  maxLen: number;
  emoji: boolean;
  auto: boolean;
  familyName: string;
  styles: CaptionStyle[];
  defaults: { basePrompt: string; styles: Record<string, string> };
}

export interface InboxItem {
  id: string;
  subject: string;
  caption: string;
  thumbUrl: string | null;
  displayUrl: string | null;
  destBookId: string | null;
  destPageId: string | null;
  createdAt: string;
}

export interface InboxData {
  items: InboxItem[];
  books: { id: string; name: string; chapters: { pageId: string; name: string }[] }[];
}

export interface AccessRequest { id: string; email: string; name: string; note: string; createdAt: string }
