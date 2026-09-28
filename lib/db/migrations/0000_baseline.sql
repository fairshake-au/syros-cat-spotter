-- Baseline: the schema as `drizzle-kit push` built it before migrations existed
-- (SYC-64). On a database that already has these tables the runner checks the
-- live schema matches this file and records it as applied without running it.
-- The baseline is never rolled back.
CREATE TYPE "public"."cat_update_type" AS ENUM('sighting', 'desexed', 'adopted', 'general');--> statement-breakpoint
CREATE TABLE "photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"data" text NOT NULL,
	"mime" text DEFAULT 'image/jpeg' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cats" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"primary_photo_id" integer NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"discoverer_device_id" text NOT NULL,
	"owner_device_id" text,
	"owner_name" text,
	"home_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sightings" (
	"id" serial PRIMARY KEY NOT NULL,
	"cat_id" integer,
	"device_id" text NOT NULL,
	"photo_id" integer NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"device_id" text PRIMARY KEY NOT NULL,
	"username" text,
	"nickname" text,
	"points" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cat_subscriptions" (
	"device_id" text NOT NULL,
	"cat_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cat_subscriptions_device_id_cat_id_pk" PRIMARY KEY("device_id","cat_id")
);
--> statement-breakpoint
CREATE TABLE "cat_updates" (
	"id" serial PRIMARY KEY NOT NULL,
	"cat_id" integer NOT NULL,
	"update_type" "cat_update_type" NOT NULL,
	"message" text NOT NULL,
	"trigger_sighting_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"cat_update_id" integer NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_tokens" (
	"device_id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_credentials" (
	"device_id" text PRIMARY KEY NOT NULL,
	"secret_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cats_name_lower_unique" ON "cats" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_username_lower_idx" ON "profiles" USING btree (lower("username"));
