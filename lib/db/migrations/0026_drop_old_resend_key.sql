-- SYC-44 PR 4.2 (docs/superpowers/plans/syc-44-report-an-issue.md, Slice 4):
-- drop the old resend key (reporter_device, client_ref). PR 4.1 added the
-- same key with the kind in it, and has been published, so no live upsert
-- names the old one any more. Nothing visible. Provisional number:
-- re-generate if another migration lands first.
DROP INDEX "welfare_reports_device_client_ref_key";

-- Roll the app back first, then the database. The old key cannot hold a
-- "Report an issue" row beside a welfare row with the same device and
-- reference, so the rollback has to remove the issue rows.
-- rollback-begin
-- -- DELETES EVERY "REPORT AN ISSUE" ROW FIRST: A CONTENT ROW AND A WELFARE ROW WITH THE SAME DEVICE AND REFERENCE CANNOT BOTH SURVIVE THE OLD KEY.
-- DELETE FROM "welfare_reports" WHERE "kind" = 'content';
-- CREATE UNIQUE INDEX "welfare_reports_device_client_ref_key" ON "welfare_reports" USING btree ("reporter_device","client_ref");
-- rollback-end
