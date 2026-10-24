CREATE TABLE "cat_unfollows" (
	"device_id" text NOT NULL,
	"cat_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cat_unfollows_device_id_cat_id_pk" PRIMARY KEY("device_id","cat_id")
);


--> statement-breakpoint
-- Rollback drops only cat_unfollows: backfilled cat_subscriptions rows cannot be told apart from real follows.
-- Backfill: everyone who has spotted a cat follows it, and every current owner follows their own cat. cat_unfollows is created
-- empty above, so no unfollow records exist yet and no "not exists" is needed.
insert into cat_subscriptions (device_id, cat_id)
select distinct s.device_id, s.cat_id from sightings s
where s.status = 'resolved' and s.device_id is not null and s.device_id not like 'deleted:%'
  and s.cat_id is not null
on conflict do nothing;
--> statement-breakpoint
insert into cat_subscriptions (device_id, cat_id)
select c.owner_device_id, c.id from cats c
where c.owner_device_id is not null and c.owner_device_id not like 'deleted:%'
on conflict do nothing;
-- rollback-begin
-- DROP TABLE "cat_unfollows";
-- rollback-end
