-- Resumes move to Google Drive as the sole backend.
--
-- `storageKey` held an S3 object key; it now holds a Drive file id, so the column is renamed
-- to say so. This is written as DROP + ADD rather than RENAME because the type and semantics
-- both change and the table is empty — resume storage was never configured, so no rows exist.
-- On a database that DID hold rows this would need a rename plus a backfill instead.


-- CreateEnum
CREATE TYPE "PreviewStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'READY', 'FAILED');

-- DropIndex
DROP INDEX "files_storageKey_key";

-- AlterTable
ALTER TABLE "files" DROP COLUMN "storageKey",
ADD COLUMN     "driveFileId" TEXT NOT NULL,
ADD COLUMN     "previewError" TEXT,
ADD COLUMN     "previewFileId" TEXT,
ADD COLUMN     "previewStatus" "PreviewStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "uploadedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "files_driveFileId_key" ON "files"("driveFileId");

