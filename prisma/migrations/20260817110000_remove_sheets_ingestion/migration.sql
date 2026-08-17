-- Remove the Google Sheets ingestion tables.
--
-- Website applications now arrive directly from the careers page via /api/public/applications,
-- so the spreadsheet hop is gone: no Apps Script, no cron pull, and no row-hash ledger to keep
-- the two idempotent.
--
-- This is a destructive migration. It drops the import audit trail (which rows were read from
-- which sheet, and what happened to each). The candidates and applications those imports
-- created are untouched — imported_rows referenced them with nullable, ON DELETE SET NULL
-- foreign keys, so nothing cascades outward from these drops. Applications keep source =
-- 'WEBSITE'; that enum value still describes exactly what they are.
-- DropForeignKey
ALTER TABLE "imported_rows" DROP CONSTRAINT "imported_rows_applicationId_fkey";

-- DropForeignKey
ALTER TABLE "imported_rows" DROP CONSTRAINT "imported_rows_candidateId_fkey";

-- DropForeignKey
ALTER TABLE "imported_rows" DROP CONSTRAINT "imported_rows_sheetSourceId_fkey";

-- DropForeignKey
ALTER TABLE "sheet_sources" DROP CONSTRAINT "sheet_sources_defaultJobRoleId_fkey";

-- DropForeignKey
ALTER TABLE "sheet_sync_runs" DROP CONSTRAINT "sheet_sync_runs_sheetSourceId_fkey";

-- DropTable
DROP TABLE "imported_rows";

-- DropTable
DROP TABLE "sheet_sources";

-- DropTable
DROP TABLE "sheet_sync_runs";

-- DropEnum
DROP TYPE "ImportStatus";

-- DropEnum
DROP TYPE "SyncTrigger";

