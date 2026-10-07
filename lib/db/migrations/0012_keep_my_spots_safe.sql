CREATE TABLE "email_consent_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer,
	"device_id" text,
	"address_hmac" text,
	"purpose" text NOT NULL,
	"event" text NOT NULL,
	"surface" text,
	"wording_version" text,
	"language" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"redacted_at" timestamp with time zone,
	"redaction_reason" text,
	CONSTRAINT "email_consent_events_purpose_ck" CHECK ("email_consent_events"."purpose" in ('keep_safe', 'report', 'news')),
	CONSTRAINT "email_consent_events_event_ck" CHECK ("email_consent_events"."event" in ('consented', 'verify_sent', 'verified', 'withdrawn', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "email_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"address" text,
	"address_hmac" text NOT NULL,
	"address_mask" text NOT NULL,
	"device_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "email_contacts_purpose_ck" CHECK ("email_contacts"."purpose" in ('keep_safe', 'report', 'news')),
	CONSTRAINT "email_contacts_status_ck" CHECK ("email_contacts"."status" in ('pending', 'confirmed')),
	CONSTRAINT "email_contacts_keep_safe_no_address_ck" CHECK ("email_contacts"."purpose" <> 'keep_safe' or "email_contacts"."address" is null),
	CONSTRAINT "email_contacts_keep_safe_device_ck" CHECK ("email_contacts"."purpose" <> 'keep_safe' or "email_contacts"."device_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"id" serial PRIMARY KEY NOT NULL,
	"address_hmac" text NOT NULL,
	"reason" text NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_suppressions_reason_ck" CHECK ("email_suppressions"."reason" in ('forget', 'bounce', 'complaint', 'verify_cap', 'unsubscribe')),
	CONSTRAINT "email_suppressions_scope_ck" CHECK ("email_suppressions"."scope" in ('keep_safe', 'report', 'news', 'all'))
);
--> statement-breakpoint
CREATE TABLE "mail_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"address_hmac" text NOT NULL,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_requests_kind_ck" CHECK ("mail_requests"."kind" in ('add', 'restore'))
);
--> statement-breakpoint
CREATE TABLE "mail_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"contact_id" integer,
	"address_hmac" text NOT NULL,
	"device_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"restored_device_id" text,
	"replaced_secret_hash" text,
	"attempt_ip_hash" text,
	CONSTRAINT "mail_tokens_purpose_ck" CHECK ("mail_tokens"."purpose" in ('verify', 'forget', 'restore'))
);
--> statement-breakpoint
ALTER TABLE "mail_tokens" ADD CONSTRAINT "mail_tokens_contact_id_email_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."email_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_consent_events_device_idx" ON "email_consent_events" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "email_consent_events_hmac_idx" ON "email_consent_events" USING btree ("address_hmac","purpose","event");--> statement-breakpoint
CREATE UNIQUE INDEX "email_contacts_keep_safe_device_unique" ON "email_contacts" USING btree ("device_id") WHERE "email_contacts"."purpose" = 'keep_safe';--> statement-breakpoint
CREATE INDEX "email_contacts_hmac_idx" ON "email_contacts" USING btree ("address_hmac");--> statement-breakpoint
CREATE UNIQUE INDEX "email_suppressions_unique" ON "email_suppressions" USING btree ("address_hmac","scope","reason");--> statement-breakpoint
CREATE INDEX "mail_requests_address_idx" ON "mail_requests" USING btree ("kind","address_hmac","created_at");--> statement-breakpoint
CREATE INDEX "mail_requests_ip_idx" ON "mail_requests" USING btree ("kind","ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "mail_requests_created_idx" ON "mail_requests" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX "mail_tokens_hmac_idx" ON "mail_tokens" USING btree ("address_hmac","purpose","expires_at");--> statement-breakpoint
CREATE INDEX "mail_tokens_replaced_idx" ON "mail_tokens" USING btree ("replaced_secret_hash") WHERE "mail_tokens"."replaced_secret_hash" is not null;--> statement-breakpoint
ALTER TABLE "welfare_reports" ADD CONSTRAINT "welfare_reports_reporter_contact_id_email_contacts_id_fk" FOREIGN KEY ("reporter_contact_id") REFERENCES "public"."email_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- email-capture.md §5.6: consent events are append-only. Withdrawal is a new
-- event, never an edit. The one permitted update is redaction: it stamps the
-- row and clears who it was about (contact_id, device_id), and may clear the
-- address fingerprint too. Every other column stays exactly as it was.
CREATE FUNCTION "email_consent_events_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  exempt text[] := ARRAY['redacted_at', 'redaction_reason', 'contact_id', 'device_id', 'address_hmac'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.redacted_at IS NOT NULL OR NEW.redaction_reason IS NOT NULL THEN
      RAISE EXCEPTION 'email_consent_events: a new row cannot arrive already redacted';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'email_consent_events are append-only: delete is not allowed (id %)', OLD.id;
  END IF;
  IF (to_jsonb(NEW) - exempt)::text = (to_jsonb(OLD) - exempt)::text
     AND NEW.contact_id IS NULL
     AND NEW.device_id IS NULL
     AND (NEW.address_hmac IS NULL OR NEW.address_hmac = OLD.address_hmac)
     AND (
       (OLD.redacted_at IS NULL
         AND NEW.redacted_at IS NOT NULL
         AND coalesce(NEW.redaction_reason, '') <> '')
       OR (OLD.redacted_at IS NOT NULL
         AND NEW.redacted_at = OLD.redacted_at
         AND NEW.redaction_reason IS NOT DISTINCT FROM OLD.redaction_reason)
     )
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'email_consent_events are append-only: the only permitted update is redaction (id %)', OLD.id;
END
$$;--> statement-breakpoint
CREATE TRIGGER "email_consent_events_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "email_consent_events"
  FOR EACH ROW EXECUTE FUNCTION "email_consent_events_append_only"();--> statement-breakpoint
CREATE TRIGGER "email_consent_events_no_truncate" BEFORE TRUNCATE ON "email_consent_events"
  FOR EACH STATEMENT EXECUTE FUNCTION "append_only_no_truncate"();
-- SYC-3: additive only. Rolling back LOSES every "keep my spots safe" opt-in
-- and every consent record: spotters would have to add their address again,
-- and anyone mid-restore loses their link. Roll the app back first (an older
-- build never reads these tables), then this.
-- rollback-begin
-- ALTER TABLE "welfare_reports" DROP CONSTRAINT "welfare_reports_reporter_contact_id_email_contacts_id_fk";
-- DROP TRIGGER "email_consent_events_no_truncate" ON "email_consent_events";
-- DROP TRIGGER "email_consent_events_append_only" ON "email_consent_events";
-- DROP FUNCTION "email_consent_events_append_only"();
-- DROP TABLE "mail_tokens";
-- DROP TABLE "mail_requests";
-- DROP TABLE "email_suppressions";
-- DROP TABLE "email_contacts";
-- DROP TABLE "email_consent_events";
-- rollback-end
