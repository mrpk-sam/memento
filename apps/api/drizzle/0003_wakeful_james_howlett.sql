ALTER TABLE "inbox_items" ADD COLUMN "video_key" text;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "video_key" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "duration_ms" integer;