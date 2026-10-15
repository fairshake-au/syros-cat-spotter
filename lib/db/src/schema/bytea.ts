import { customType } from "drizzle-orm/pg-core";

/** A Postgres `bytea` column, read and written as a Buffer. Not exported from the schema index. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});
