# Handoff: Memento, a family scrapbook library (PWA)

## Overview
Memento is a private, multi-household family scrapbook. Each **household** has one **main book** and can add optional **smaller books**, such as a child's own scrapbook. All books sit together on a wooden **shelf**. Opening a book plays a cover-open animation, and the pages turn in 3D. Photos are arranged into year and month chapters, and each one gets a short AI-written caption that looks handwritten.

- **Viewing:** any signed-in member can read every book. That includes extended family and friends who don't belong to a household.
- **Editing a book:** requires that book's 4-digit **PIN**. The prototype has no per-editor role restrictions, and that stays true in v1: anyone who knows the PIN can edit.
- **Editor's Desk:** the admin console. Only the super-admin (Marco) can manage everything there. **Household admins** can add and manage members of their own household, and nothing else.

## About the design files
The files in `design/` are **design references built in HTML**. They're working prototypes that show the intended look and behaviour, not production code. `Memento.dc.html` is a single-file component: the markup is the template and `class Component extends DCLogic` is the logic. `ScrapbookPage.dc.html` renders a single 600×750 scrapbook page and is embedded by the main file. `support.js` is the tiny runtime that lets these files open directly in a browser.

The job is to **recreate these designs in a real React + TypeScript app** backed by Postgres and MinIO. All state in the prototype lives in memory. Every item under "Data model" below needs to persist.

## Fidelity
**High-fidelity.** Colours, typography, spacing, radii, shadows, motion and copy are final. Match them exactly. The logic class is the source of truth for behaviour, edge cases, toasts, and undo.

---

## Screens

### 1. Header (global)
- Sticky bar, height 68px, horizontal padding 36px (16px below 760px wide).
- Left side: the Memento wordmark and the family name.
- Nav pills: **Library**, **Editor's Desk**. The active pill has a `surface2` background and `ink` text. The nav is hidden below 600px.
- Right side: a dark-mode toggle (a knob that moves 28px).

### 2. Library / Shelf (`screen: 'shelf'`)
- A wall (`--wall`) with wooden shelves (`wood1`, `wood2`, `wood-top`).
- Book **spines** stand upright. Each spine has width `w` (default 80, range roughly 60–110) and height `h` (default 400, range roughly 340–460), a texture (`leather` | `linen` | `matte`), a colour, and vertical spine text.
  - Spine font size depends on text length: >16 chars → 16px, >10 → 19px, otherwise 22px.
  - Text colour is `#2B2621` on light spines and `#FFF6EA` on dark ones.
- **Ordering:** each household's main book comes first, immediately followed by its smaller books. Books can be reordered within their pool (main books among main books, smaller books within their household).
- **Rows wrap:** a row holds at most `(vw<600 ? 720 : 900) − 168` px of books. Each book takes `w + 5` px. Row min-height is the tallest book + 40. The last row ends with a dashed **"+ New book"** slot 76px wide.
- The whole shelf scales by `min(1, (vw−32)/(vw<600?720:900))`.
- Hovering a spine lifts it. A nameplate below the shelf shows the book title and `Texture · years · N pages · updated X`. When nothing is hovered, the nameplate reads "Tap a spine to open it" and "N books on the shelf".
- Clicking a spine lifts it by −48px, then opens the book. A lock badge shows on locked books.
- The landing copy above the shelf is editable in Settings. A blank field falls back to its default.

### 3. Book reader (`screen: 'book'`)
- **Spread vs single page:** two-page spread when viewport ≥ 820px, single page below.
- Pages are authored at 600×750 and scaled to fit.
- **Open animation:** the cover sits closed. After 420ms it rotates to −180° over about 1200ms, then the cover layer is removed.
- **Page flip:** a 3D rotateY flip lasting 950ms. The hinge is the spine side, `preserve-3d` is on, and both faces use `backface-visibility: hidden`. Shading gradients are overlaid on both faces during the turn.
- **Navigation:** arrow keys, on-screen arrows, index and chapter links. Going back from the first spread closes the cover; going forward from the closed state reopens it.
- **Page types**, in order: `endpaper`, `title` (hero polaroid + family, script and title text), `index` ("Contents / The years"), `chapters` (month list), then repeating year blocks, then `closing` and `backpaper`.
  - **Summary pages:** `summary` + `summaryL` holds 6 photos with a header; `summary` + `summaryR` holds 9.
  - **Month chapters:** `month` + `monthL` holds 4 photos and a header note; `month` + `monthR` holds 8 photos and a journal paragraph.
- **Photo placement:** photos have an optional `month`. When a month is set, the photo moves into the matching month chapter. Year summary spreads are re-sorted by month (the prototype's `reflow`, `insertPhotos` and `setMonth` show how).
- **Add year:** inserts a new year block before `closing`.
- **Lightbox:** clicking a photo zooms it from its on-page rect into a centred card. Card width is `min(vw − (vw<600?32:150), 760, (vh−190)/0.9)` and the image height is 0.68 of that width. Left and right arrows step through the photos on the current spread. Closing animates the card back over 460ms.
- **Edit mode** (entered after the PIN is accepted):
  - A side panel shows the page theme, sticker pack, header and journal text, the selected photo's caption with an **AI regenerate** button, and a month select.
  - Photos can be dropped onto either page, with a dashed accent drop zone at `inset: 10px`.
  - The cover hero photo can be replaced.
  - A "Saving… / Saved just now" indicator shows while edits persist.
  - **Preview** hides the editing chrome.

### 4. PIN modal
- Opens when a user clicks Edit on a locked book, or clicks a locked spine and chooses Edit.
- A book-cover swatch (the spine gradient) sits beside four PIN boxes.
- Box borders: the active box uses accent, the others use line colour, errors use `#C0443A`, and success uses `#5E8B5A`.
- A wrong PIN plays a shake animation (`kshake`, 0.42s). The correct PIN rotates the lock shackle 28°, shows "Unlocked. Editing on.", and fades the modal out over 0.5s.
- In production, verify the PIN on the server. Rate-limit attempts to 5 per 10 minutes per book per user. A successful unlock grants an edit session for that book lasting 12h.

### 5. Editor's Desk (`screen: 'desk'`)
- Access requires the Admin or Household-admin role. The prototype's password gate ("memento") becomes a role check.
- **Layout:** a 264px sidebar plus the content area. Below 900px the sidebar becomes a horizontal tab row.
- Content padding is `40px 48px 80px` (`24px 16px 80px` on narrow screens).
- Tab headings use Lora 400 at 36px.

Tabs:

- **Family members.** Members are grouped by household. Each group header shows the household name, its book, and its household admins. There's a final group called **"Extended family & friends"** for members with no household.
  - **Row columns:** avatar (tinted with the household's book colour, 45% opacity while an invite is pending), name and role, email (validated inline, with a red border when invalid), access select, household select, and actions (edit, delete with inline confirm).
  - **Access levels:** `Admin` | `Household admin` | `Member`. Household admin requires the member to be in a household.
  - **Invite form:** name, email, access, household, and a "Send invite email" toggle. With the toggle on, the button reads **Send invite**. With it off, it reads **Add member** and adds the person directly with no email.
  - **Pending invites** show "Invited today · expires in N days". Invites expire after 7 days. Pending invites can be resent, cancelled, or marked accepted.
  - Each group has a **"+" quick-add** button that opens an inline name field.
  - **Household admins** can see this tab, but they can only add, edit or remove people in their own household.
- **Books.**
  - Lists households, each with its main book and any smaller books.
  - **Per-book editor:** owner name, surname, spine text, texture (three textures with ten swatches each, see tokens), colour, and lock toggle with PIN.
  - **Size controls:** height and thickness, each with a slider **and** a number box. Labels: Short <372, Tall >424, otherwise Standard; Slim <74, Thick >92, otherwise Regular.
  - **Match all:** copies this book's size to every book of the same kind (all main books, or all smaller books). The action can be undone.
  - **New book:** choose a parent household (required for smaller books; empty creates a new household plus its main book), owner, name, spine text, texture, colour, and lock + PIN. The lock defaults to the "Lock new books" setting.
  - **Delete book:** deletes the book and its smaller books, moves its members to extended family, and offers Undo.
  - Books can be reordered with up and down controls.
- **Theme library.** A grid of 216×270 live page previews at scale 0.36, one per theme. A **theme builder** (name, paper, accent, accent2, motif, sticker pack) shows a 330×412 live preview at scale 0.55 and saves custom themes.
- **Photo inbox.**
  - A drop zone (dashed, radius 20px, 44px padding) accepts drag-drop or a file picker for JPG, PNG and HEIC.
  - Each photo becomes a card: a 170px image, an auto-caption with a "Writing a caption…" shimmer while it generates, a destination **book** select, a destination **chapter** select, **Add to book**, **Regenerate**, and **Discard**.
  - The PWA share target drops photos straight into this inbox.
- **AI captions.**
  - **Connection:** endpoint URL, API key (masked as first 8 characters + `••••••••` + last 4, with an Edit/Hide toggle), model name, and a **Test connection** button with states Not tested, Testing…, Connected (`#3E8E5E`), and Couldn't connect (`#C0443A`).
  - **Base prompt** textarea.
  - **Caption styles:** the four built-ins plus custom styles, each with an editable prompt. Built-ins can be edited but not deleted, and custom styles can be added, renamed and deleted.
  - Controls: active voice, max length (default 60), an emoji toggle, and an auto-caption-on-upload toggle.
  - An **assembled-prompt preview** and a **test box** (subject in, caption out, typed out 2 characters every 24ms).
- **Settings.** Family name (shown on covers, title pages and the shelf), appearance (Light/Dark segmented control), and the "Lock new books" toggle. A **Landing page** copy editor with Reset and View shelf buttons.

### 6. Toasts
A bottom toast shows a message and an optional action (usually **Undo**). It auto-dismisses after 3.6s. Every destructive action offers Undo, which the server can support with soft delete or a restore endpoint.

---

## AI captions (server)
Prompts live in the **database** and are edited in the GUI. Never hard-code them.

```
system = fill(base_prompt) + "\n\n" + fill(style.prompt)
user   = "Photo: {subject}\nContext: {page label + chapter subtitle || 'the {family} family scrapbook'}"
fill() replaces {family} → settings.family_name, {maxLen} → ai.max_len, {emojiRule} → "One fitting emoji is fine." | "No emoji."
```

- **Endpoint:** POST `{endpoint}/chat/completions` with `{ model, messages:[{role:'system',content:system},{role:'user',content:user}] }`.
- **Vision:** if the model supports it, also send the 400px thumbnail as an `image_url` part. The prototype only had a text subject.
- **Post-processing:** keep the first line, strip surrounding quotes, and hard-truncate at `maxLen+12` on a word boundary with `…`.
- **Subject:** use the filename with the extension removed and `-`/`_` replaced by spaces. Let the user edit it.
- **Fallback:** if the call fails, return an error. The prototype's canned captions are demo-only.

Default base prompt and styles are in the prototype as `Component.DEFAULT_BASE` and `Component.DEFAULT_STYLES`. Seed them verbatim.

## Data model (suggested, Postgres)
- `households(id, name, surname, sort_order)`
- `users(id, name, role_label, email unique, access enum[admin,household_admin,member], household_id null, avatar_color null, created_at)`
- `invites(id, user_id, token_hash, sent_at, resent_count, expires_at, accepted_at)`
- `sessions(id, user_id, expires_at)` and `book_unlocks(user_id, book_id, expires_at)`
- `books(id, household_id, kind enum[main,small], owner_name, spine_text, texture, color, width, height, locked, pin_hash, sort_order, updated_at)`, with one `main` book per household.
- `themes(id, name, paper, ink, accent, accent2, motif, flags jsonb, builtin)`
- `pages(id, book_id, position, type, layout, theme_id, sticker_pack, label, year, header jsonb, journal text, hero_photo_id)`
- `photos(id, page_id, position, object_key, thumb_key, display_key, width, height, subject, caption, month null, taken_at, uploaded_by)`
- `inbox_items(id, uploaded_by, object_key, subject, caption, dest_book_id, dest_page_id, created_at)`
- `caption_styles(id, name, prompt, builtin, sort_order)`
- `settings` (single row): family_name, landing jsonb, lock_new_books, ai_endpoint, ai_key_encrypted, ai_model, ai_voice_style_id, ai_base_prompt, ai_max_len, ai_emoji, ai_auto.

Object keys use `books/{bookId}/{photoId}/{orig|1600|400}.jpg`. Keep the bucket private and serve images through short-lived presigned GET URLs or an API proxy that sets cache headers.

## Permissions
| Action | Who |
|---|---|
| View any book | Any signed-in user |
| Edit a book's pages and photos | Anyone with a valid unlock for that book (PIN) |
| Editor's Desk: all tabs | Admin |
| Family tab: own household only | Household admin |
| Change PINs, delete books, AI and settings | Admin |

## PWA
- **Manifest:** `name: Memento`, `display: standalone`, `background_color: #FAFAF8`, `theme_color: #2B2621`. Provide maskable 192 and 512 icons and include iOS `apple-touch-icon` and meta tags.
- **Caching:** cache the app shell. Use stale-while-revalidate for book JSON and the last three opened books' thumbnails. Show an offline banner and make edits read-only while offline.
- **Share target:** declare `share_target` (POST, multipart, `image/*`) that routes photos into the Photo inbox.
- Show an install prompt on the shelf after a user's second visit.

## Design tokens
**Fonts** (Google Fonts): **Lora** (400, 500, 600, plus italic) for headings and page titles; **Outfit** (300–700) for UI; **Caveat** (400–700) for captions and handwritten script. Monospace is `ui-monospace, Menlo` for photo subject labels. Page icons use Phosphor Icons duotone.

**App colours (light / dark)**
| token | light | dark |
|---|---|---|
| bg | #FAFAF8 | #171411 |
| surface | #FFFFFF | #221E1A |
| surface2 | #F3EEE6 | #2B2621 |
| ink | #2B2621 | #EFE8DD |
| ink2 | #6B6157 | #B2A695 |
| line | #E6DDD0 | #3A332B |
| tan | #D4C5B0 | #6B5D4B |
| accent | #B0592F | #E48B5F |
| accent-ink | #FFFFFF | #1A1410 |
| wall | #F4EEE4 | #1C1814 |
| wood1 / wood2 / wood-top | #C49A6C / #9A6E47 / #D8B38A | #6A4A30 / #46301F / #80603F |
| field | #FFFFFF | #1B1815 |
| stage | #EFE8DD | #12100E |
| shadow | rgba(70,45,20,.22) | rgba(0,0,0,.55) |
| page-dim | 0 | .12 (dark mode dims the room, not the pages) |

Status colours: error `#C0443A`, success `#5E8B5A` / `#3E8E5E`, warning `#D9A620`.

**Spine palettes**
- Leather: #6B3F25 #3E2A20 #7A2E2A #2F3B2E #1F2A44 #4A2C4F #8A5A2B #2A2A2A #5A1F2E #1E4040
- Linen: #5E6B55 #3F5873 #8A5A6A #B89F7A #9C4A3A #2E5E5A #6B5B8A #C9A64A #8C8C84 #3A3F4A
- Modern matte: #C8765A #E0B04A #2F4858 #8FA89A #D98BA0 #6A8CC4 #9C6BC4 #4F9A6B #E07A3F #2B2621

**Page themes** (seed data; the `motif` value picks the page decoration):
cream (#FBF7EF/#3A3026/#A8643F/#6E7F5E, none) · kraft (#F5EDDF, washi) · dual "Canada Day & the Fourth" (#FBF6EF, #B8323A/#27406B, bunting+stars) · jamaica "Jamaica gold" (#FAF4E2, #1F7A4A/#D9A620, bunting+confetti) · winter (#F4F7F4, #2F5D50/#B23A3A, snow) · festive (#FBF3EA, #A8302F/#2E6A4B, stars) · summer (#FFF7EA, #E07A3F/#3E9BB0, confetti) · birthday (#FDF3F2, #D2557A/#E9A93A, bunting+confetti). The exact values are in `Component.THEMES`.

**Sticker packs:** none, hearts (♥ ✿ ★), stamps (HOME YAY! LOVE JOY), doodles ("best day!", "← us!", "♡ ♡ ♡", "lol"). Anchor positions are in `Component.SPOTS`.

**Radii:** pills 999px, cards 16–18px, inputs 8–10px, drop zones 20px, pages 6px.
**Motion:**
- Spring easing: `cubic-bezier(.3,1.4,.5,1)`.
- `kpop` entrance: 0.3–0.35s.
- `kfade`: 0.25s.
- Book hop stagger: 70ms per book, 380ms total.
- Cover open: 420ms delay, then 1200ms.
- Page flip: 950ms.
- Lightbox close: 460ms.
- Toast: 3.6s.

## Seed data
- **Households:** Marco & Elena Rivera · Daniel & Priya · Nadia & Omar Brooks · Sofia · Mom & Dad.
- **Members:** the 11 people in `initState()`, with emails as placeholders. Marco is the Admin.
- **Books:** one main book per household, with the colour, texture and size values from `initState()`. Books start locked, and each PIN must be set on first run rather than seeding `1234`.
- **Page structure:** each book starts with endpaper, title, index, chapters, one empty year block for the current year, closing, and backpaper.
- **Also seed:** themes, sticker packs, the default base prompt, and the four caption styles.

## Build plan
1. **Foundation:** repo, monorepo, env, Drizzle schema and migrations, seed, MinIO client and bucket check, Docker.
2. **Auth and people:** magic link, invites (email or direct add), sessions, roles, the Family members tab.
3. **Shelf and books:** shelf rendering, ordering, the Books tab (sizes, match all, create and delete, PIN set and verify).
4. **Reader:** page renderer (port `ScrapbookPage.dc.html`), spread and single layouts, cover and flip animations, lightbox, index and chapter navigation.
5. **Editing and photos:** PIN unlock, edit panel, drag-drop upload, presigned PUT, sharp variants, month placement and reflow, hero replace, autosave, undo.
6. **Inbox and AI:** Photo inbox, caption endpoint, styles CRUD, prompt preview, test connection.
7. **Themes and settings:** theme library and builder, settings, landing copy, dark mode.
8. **PWA:** manifest, icons, service worker caching, offline mode, share target, install prompt.
9. **Hardening:** rate limits, authorization tests, image size limits (25MB), EXIF stripping (orientation is preserved), backups note in README.

## Files
- `design/Memento.dc.html`: the whole app prototype (shelf, reader, PIN modal, Editor's Desk, lightbox, toasts).
- `design/ScrapbookPage.dc.html`: the single-page renderer for every page type, theme motif and sticker.
- `design/support.js`: the runtime that opens the prototypes in a browser. It's for reference only and doesn't ship.
