import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
/** Soft delete. Rows with a value here are hidden but can be restored (Undo). */
const deletedAt = () => timestamp('deleted_at', { withTimezone: true });

export const accessEnum = pgEnum('access', ['admin', 'household_admin', 'member']);
export const bookKindEnum = pgEnum('book_kind', ['main', 'small']);
export const textureEnum = pgEnum('texture', ['leather', 'linen', 'matte']);

export const households = pgTable('households', {
  id: id(),
  name: text('name').notNull(),
  surname: text('surname').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
  deletedAt: deletedAt(),
});

export const users = pgTable(
  'users',
  {
    id: id(),
    name: text('name').notNull(),
    roleLabel: text('role_label').notNull().default(''),
    /** Nullable: a member can exist before they have an email (added directly, no invite). */
    email: text('email'),
    access: accessEnum('access').notNull().default('member'),
    householdId: uuid('household_id').references(() => households.id, { onDelete: 'set null' }),
    avatarColor: text('avatar_color'),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [uniqueIndex('users_email_unique').on(sql`lower(${t.email})`).where(sql`${t.email} is not null and ${t.deletedAt} is null`)],
);

export const invites = pgTable('invites', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  resentCount: integer('resent_count').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
});

/** Someone with an unknown email asking to join. The admin approves (sends an invite) or declines. */
export const accessRequests = pgTable(
  'access_requests',
  {
    id: id(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    /** Optional note from the requester, e.g. "Nadia's daughter". */
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** 'approved' or 'declined' once decided. */
    decision: text('decision'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    /** The member created on approval. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [uniqueIndex('access_requests_open_email').on(sql`lower(${t.email})`).where(sql`${t.decidedAt} is null`)],
);

export const magicLinks = pgTable('magic_links', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  /** HMAC of the 6-digit code emailed with the link, for typing into the app instead. */
  codeHash: text('code_hash'),
  /** Wrong code guesses. The code stops working after 5. */
  codeAttempts: integer('code_attempts').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the cookie token. The raw token never touches the DB. */
    id: text('id').primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const books = pgTable(
  'books',
  {
    id: id(),
    householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
    kind: bookKindEnum('kind').notNull(),
    /** Small books only: whose book it is, e.g. a child's name. Main books use the household name. */
    ownerName: text('owner_name'),
    spineText: text('spine_text').notNull().default(''),
    texture: textureEnum('texture').notNull(),
    color: text('color').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    locked: boolean('locked').notNull().default(true),
    /** argon2id hash. Null means the PIN has not been set yet (first run). */
    pinHash: text('pin_hash'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('books_one_main_per_household')
      .on(t.householdId)
      .where(sql`${t.kind} = 'main' and ${t.deletedAt} is null`),
  ],
);

export const bookUnlocks = pgTable(
  'book_unlocks',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    bookId: uuid('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.bookId] })],
);

export const pinAttempts = pgTable(
  'pin_attempts',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    bookId: uuid('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
    ok: boolean('ok').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('pin_attempts_lookup_idx').on(t.userId, t.bookId, t.at)],
);

export const themes = pgTable('themes', {
  /** Slug for built-ins (cream, kraft, ...); uuid text for custom themes. */
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  paper: text('paper').notNull(),
  ink: text('ink').notNull(),
  accent: text('accent').notNull(),
  accent2: text('accent2').notNull(),
  motif: text('motif').notNull().default('none'),
  flags: jsonb('flags').$type<string[]>(),
  /** Default sticker pack suggested by the theme builder. */
  stickerPack: text('sticker_pack').notNull().default('none'),
  builtin: boolean('builtin').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
  deletedAt: deletedAt(),
});

export const pages = pgTable(
  'pages',
  {
    id: id(),
    bookId: uuid('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    type: text('type').notNull(),
    layout: text('layout'),
    themeId: text('theme_id').notNull().references(() => themes.id),
    stickerPack: text('sticker_pack').notNull().default('none'),
    label: text('label'),
    year: integer('year'),
    header: jsonb('header').$type<{ kicker?: string; title?: string; subtitle?: string; note?: string }>(),
    journal: text('journal'),
    /** Title-page free text (script line, title overrides). */
    text: jsonb('text').$type<Record<string, string>>(),
    heroPhotoId: uuid('hero_photo_id'),
  },
  (t) => [index('pages_book_pos_idx').on(t.bookId, t.position)],
);

export const photos = pgTable(
  'photos',
  {
    id: id(),
    bookId: uuid('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
    /** Null for a hero photo that sits on the title page but not in a photo slot. */
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'set null' }),
    position: integer('position').notNull().default(0),
    objectKey: text('object_key').notNull(),
    thumbKey: text('thumb_key'),
    displayKey: text('display_key'),
    width: integer('width'),
    height: integer('height'),
    subject: text('subject').notNull().default(''),
    caption: text('caption').notNull().default(''),
    month: smallint('month'),
    takenAt: timestamp('taken_at', { withTimezone: true }),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('photos_page_idx').on(t.pageId, t.position)],
);

export const inboxItems = pgTable('inbox_items', {
  id: id(),
  uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  objectKey: text('object_key').notNull(),
  thumbKey: text('thumb_key'),
  displayKey: text('display_key'),
  width: integer('width'),
  height: integer('height'),
  subject: text('subject').notNull().default(''),
  caption: text('caption').notNull().default(''),
  destBookId: uuid('dest_book_id').references(() => books.id, { onDelete: 'set null' }),
  destPageId: uuid('dest_page_id').references(() => pages.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  deletedAt: deletedAt(),
});

export const captionStyles = pgTable('caption_styles', {
  id: id(),
  /** Stable key for built-ins (warm, playful, poetic, short). Null for custom styles. */
  key: text('key').unique(),
  name: text('name').notNull(),
  prompt: text('prompt').notNull(),
  builtin: boolean('builtin').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  deletedAt: deletedAt(),
});

export interface LandingCopy {
  kicker?: string;
  title?: string;
  body?: string;
}

/** Single row, id = 1. */
export const settings = pgTable('settings', {
  id: smallint('id').primaryKey().default(1),
  familyName: text('family_name').notNull().default('Rivera'),
  landing: jsonb('landing').$type<LandingCopy>().notNull().default({}),
  lockNewBooks: boolean('lock_new_books').notNull().default(true),
  appearance: text('appearance').notNull().default('light'),
  aiEndpoint: text('ai_endpoint').notNull().default(''),
  /** AES-256-GCM ciphertext (iv:tag:data, base64). Never sent to the client. */
  aiKeyEncrypted: text('ai_key_encrypted'),
  aiModel: text('ai_model').notNull().default(''),
  aiVision: boolean('ai_vision').notNull().default(false),
  aiVoiceStyleId: uuid('ai_voice_style_id').references(() => captionStyles.id, { onDelete: 'set null' }),
  aiBasePrompt: text('ai_base_prompt').notNull().default(''),
  aiMaxLen: integer('ai_max_len').notNull().default(60),
  aiEmoji: boolean('ai_emoji').notNull().default(false),
  aiAuto: boolean('ai_auto').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
