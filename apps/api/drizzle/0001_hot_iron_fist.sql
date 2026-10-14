ALTER TABLE "magic_links" ADD COLUMN "code_hash" text;--> statement-breakpoint
ALTER TABLE "magic_links" ADD COLUMN "code_attempts" integer DEFAULT 0 NOT NULL;