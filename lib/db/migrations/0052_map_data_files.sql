CREATE TABLE "map_data_files" (
	"version" integer NOT NULL,
	"path" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "map_data_files_version_path_pk" PRIMARY KEY("version","path"),
	CONSTRAINT "map_data_files_version_ck" CHECK ("map_data_files"."version" > 0),
	CONSTRAINT "map_data_files_sha256_ck" CHECK ("map_data_files"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "map_data_files_size_ck" CHECK ("map_data_files"."size" = octet_length("map_data_files"."bytes"))
);

-- rollback-begin
-- -- SYC-705: new table; no app code reads it until a later PR, and that code must be rolled back before this runs.
-- DROP TABLE "map_data_files";
-- rollback-end
