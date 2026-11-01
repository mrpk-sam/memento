ALTER TABLE "inbox_items" ADD COLUMN "ai_caption" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "ai_caption" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Captions written before this was tracked count as AI-written (auto captions were the norm).
UPDATE "photos" SET "ai_caption" = "caption" WHERE "caption" <> '';--> statement-breakpoint
UPDATE "inbox_items" SET "ai_caption" = "caption" WHERE "caption" <> '';
