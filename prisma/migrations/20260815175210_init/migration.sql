-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'RECRUITER', 'AGENCY_OWNER', 'AGENCY_RECRUITER');

-- CreateEnum
CREATE TYPE "AgencyStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "InvitationType" AS ENUM ('INVITE', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "JobRoleStatus" AS ENUM ('DRAFT', 'OPEN', 'PAUSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('TEXT', 'LONG_TEXT', 'NUMBER', 'CURRENCY', 'BOOLEAN', 'SINGLE_SELECT', 'MULTI_SELECT', 'DATE');

-- CreateEnum
CREATE TYPE "ApplicationSource" AS ENUM ('AGENCY', 'WEBSITE', 'DIRECT', 'REFERRAL');

-- CreateEnum
CREATE TYPE "StageKind" AS ENUM ('ACTIVE', 'WON', 'LOST', 'HOLD');

-- CreateEnum
CREATE TYPE "InterviewRound" AS ENUM ('TELE', 'R1', 'R2', 'R3');

-- CreateEnum
CREATE TYPE "InterviewMode" AS ENUM ('PHONE', 'VIDEO', 'ONSITE');

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'NO_SHOW', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InterviewOutcome" AS ENUM ('PASS', 'FAIL', 'HOLD');

-- CreateEnum
CREATE TYPE "NoteVisibility" AS ENUM ('INTERNAL', 'SHARED_WITH_AGENCY');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('IMPORTED', 'DUPLICATE', 'ERROR', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "SyncTrigger" AS ENUM ('WEBHOOK', 'CRON', 'MANUAL');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "agencies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "status" "AgencyStatus" NOT NULL DEFAULT 'ACTIVE',
    "ownershipWindowDays" INTEGER NOT NULL DEFAULT 90,
    "commissionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "role" "UserRole" NOT NULL,
    "agencyId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "type" "InvitationType" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_roles" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "department" TEXT,
    "location" TEXT,
    "employmentType" TEXT,
    "description" TEXT,
    "openings" INTEGER NOT NULL DEFAULT 1,
    "minExperienceMonths" INTEGER,
    "maxBudgetCtc" INTEGER,
    "status" "JobRoleStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_job_assignments" (
    "id" UUID NOT NULL,
    "agencyId" UUID NOT NULL,
    "jobRoleId" UUID NOT NULL,
    "submissionLimit" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "assignedByUserId" UUID,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agency_job_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screening_questions" (
    "id" UUID NOT NULL,
    "jobRoleId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "helpText" TEXT,
    "type" "QuestionType" NOT NULL,
    "options" JSONB,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isKnockout" BOOLEAN NOT NULL DEFAULT false,
    "knockoutRule" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "screening_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidates" (
    "id" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phoneE164" TEXT,
    "currentCompany" TEXT,
    "currentTitle" TEXT,
    "totalExperienceMonths" INTEGER,
    "currentLocation" TEXT,
    "linkedinUrl" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "jobRoleId" UUID NOT NULL,
    "source" "ApplicationSource" NOT NULL,
    "agencyId" UUID,
    "submittedByUserId" UUID,
    "currentStageId" UUID NOT NULL,
    "stageEnteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resumeFileId" UUID,
    "agencyNotes" TEXT,
    "currentCtc" INTEGER,
    "expectedCtc" INTEGER,
    "noticePeriodDays" INTEGER,
    "knockoutFlags" JSONB,
    "ownerUserId" UUID,
    "ownershipExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_answers" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "valueText" TEXT,
    "valueNumber" INTEGER,
    "valueBool" BOOLEAN,
    "valueDate" TIMESTAMP(3),
    "valueJson" JSONB,

    CONSTRAINT "application_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duplicate_submissions" (
    "id" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "jobRoleId" UUID NOT NULL,
    "attemptedByAgencyId" UUID,
    "attemptedByUserId" UUID,
    "existingApplicationId" UUID,
    "existingAgencyId" UUID,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolution" TEXT,

    CONSTRAINT "duplicate_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stages" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "kind" "StageKind" NOT NULL DEFAULT 'ACTIVE',
    "visibleToAgency" BOOLEAN NOT NULL DEFAULT true,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stage_transitions" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "fromStageId" UUID,
    "toStageId" UUID NOT NULL,
    "changedByUserId" UUID,
    "reasonCode" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stage_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interviews" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "round" "InterviewRound" NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 45,
    "mode" "InterviewMode" NOT NULL DEFAULT 'VIDEO',
    "locationOrLink" TEXT,
    "interviewerNames" TEXT[],
    "status" "InterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
    "outcome" "InterviewOutcome",
    "rating" INTEGER,
    "feedback" TEXT,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "authorUserId" UUID,
    "body" TEXT NOT NULL,
    "visibility" "NoteVisibility" NOT NULL DEFAULT 'INTERNAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_log" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "action" TEXT NOT NULL,
    "meta" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedByUserId" UUID,
    "checksumSha256" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sheet_sources" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL DEFAULT 'Sheet1',
    "headerRow" INTEGER NOT NULL DEFAULT 1,
    "columnMapping" JSONB NOT NULL,
    "defaultJobRoleId" UUID,
    "roleColumn" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastRowCursor" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sheet_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imported_rows" (
    "id" UUID NOT NULL,
    "sheetSourceId" UUID NOT NULL,
    "rowHash" TEXT NOT NULL,
    "sheetRowNumber" INTEGER,
    "raw" JSONB NOT NULL,
    "candidateId" UUID,
    "applicationId" UUID,
    "status" "ImportStatus" NOT NULL,
    "error" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imported_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sheet_sync_runs" (
    "id" UUID NOT NULL,
    "sheetSourceId" UUID NOT NULL,
    "trigger" "SyncTrigger" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "rowsRead" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,

    CONSTRAINT "sheet_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_log" (
    "id" UUID NOT NULL,
    "toEmail" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "payload" JSONB,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "providerMessageId" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agencies_slug_key" ON "agencies"("slug");

-- CreateIndex
CREATE INDEX "agencies_status_idx" ON "agencies"("status");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_agencyId_idx" ON "users"("agencyId");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_tokenHash_key" ON "invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "invitations_userId_idx" ON "invitations"("userId");

-- CreateIndex
CREATE INDEX "job_roles_status_idx" ON "job_roles"("status");

-- CreateIndex
CREATE INDEX "agency_job_assignments_jobRoleId_idx" ON "agency_job_assignments"("jobRoleId");

-- CreateIndex
CREATE UNIQUE INDEX "agency_job_assignments_agencyId_jobRoleId_key" ON "agency_job_assignments"("agencyId", "jobRoleId");

-- CreateIndex
CREATE INDEX "screening_questions_jobRoleId_sortOrder_idx" ON "screening_questions"("jobRoleId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "candidates_email_key" ON "candidates"("email");

-- CreateIndex
CREATE UNIQUE INDEX "candidates_phoneE164_key" ON "candidates"("phoneE164");

-- CreateIndex
CREATE INDEX "candidates_fullName_idx" ON "candidates"("fullName");

-- CreateIndex
CREATE INDEX "applications_jobRoleId_currentStageId_idx" ON "applications"("jobRoleId", "currentStageId");

-- CreateIndex
CREATE INDEX "applications_agencyId_createdAt_idx" ON "applications"("agencyId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "applications_currentStageId_stageEnteredAt_idx" ON "applications"("currentStageId", "stageEnteredAt");

-- CreateIndex
CREATE INDEX "applications_source_idx" ON "applications"("source");

-- CreateIndex
CREATE UNIQUE INDEX "applications_candidateId_jobRoleId_key" ON "applications"("candidateId", "jobRoleId");

-- CreateIndex
CREATE INDEX "application_answers_questionId_valueNumber_idx" ON "application_answers"("questionId", "valueNumber");

-- CreateIndex
CREATE UNIQUE INDEX "application_answers_applicationId_questionId_key" ON "application_answers"("applicationId", "questionId");

-- CreateIndex
CREATE INDEX "duplicate_submissions_attemptedByAgencyId_attemptedAt_idx" ON "duplicate_submissions"("attemptedByAgencyId", "attemptedAt" DESC);

-- CreateIndex
CREATE INDEX "duplicate_submissions_candidateId_idx" ON "duplicate_submissions"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "stages_slug_key" ON "stages"("slug");

-- CreateIndex
CREATE INDEX "stages_sortOrder_idx" ON "stages"("sortOrder");

-- CreateIndex
CREATE INDEX "stage_transitions_applicationId_createdAt_idx" ON "stage_transitions"("applicationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "interviews_applicationId_idx" ON "interviews"("applicationId");

-- CreateIndex
CREATE INDEX "interviews_scheduledAt_idx" ON "interviews"("scheduledAt");

-- CreateIndex
CREATE INDEX "notes_applicationId_createdAt_idx" ON "notes"("applicationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "activity_log_entityType_entityId_idx" ON "activity_log"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "activity_log_createdAt_idx" ON "activity_log"("createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "files_storageKey_key" ON "files"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "sheet_sources_spreadsheetId_sheetName_key" ON "sheet_sources"("spreadsheetId", "sheetName");

-- CreateIndex
CREATE UNIQUE INDEX "imported_rows_rowHash_key" ON "imported_rows"("rowHash");

-- CreateIndex
CREATE INDEX "imported_rows_sheetSourceId_importedAt_idx" ON "imported_rows"("sheetSourceId", "importedAt" DESC);

-- CreateIndex
CREATE INDEX "imported_rows_status_idx" ON "imported_rows"("status");

-- CreateIndex
CREATE INDEX "sheet_sync_runs_sheetSourceId_startedAt_idx" ON "sheet_sync_runs"("sheetSourceId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "email_log_toEmail_createdAt_idx" ON "email_log"("toEmail", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_roles" ADD CONSTRAINT "job_roles_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_job_assignments" ADD CONSTRAINT "agency_job_assignments_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_job_assignments" ADD CONSTRAINT "agency_job_assignments_jobRoleId_fkey" FOREIGN KEY ("jobRoleId") REFERENCES "job_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_job_assignments" ADD CONSTRAINT "agency_job_assignments_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_questions" ADD CONSTRAINT "screening_questions_jobRoleId_fkey" FOREIGN KEY ("jobRoleId") REFERENCES "job_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_jobRoleId_fkey" FOREIGN KEY ("jobRoleId") REFERENCES "job_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_currentStageId_fkey" FOREIGN KEY ("currentStageId") REFERENCES "stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_resumeFileId_fkey" FOREIGN KEY ("resumeFileId") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_answers" ADD CONSTRAINT "application_answers_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_answers" ADD CONSTRAINT "application_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "screening_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_submissions" ADD CONSTRAINT "duplicate_submissions_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_submissions" ADD CONSTRAINT "duplicate_submissions_jobRoleId_fkey" FOREIGN KEY ("jobRoleId") REFERENCES "job_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_submissions" ADD CONSTRAINT "duplicate_submissions_attemptedByAgencyId_fkey" FOREIGN KEY ("attemptedByAgencyId") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_submissions" ADD CONSTRAINT "duplicate_submissions_existingAgencyId_fkey" FOREIGN KEY ("existingAgencyId") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_submissions" ADD CONSTRAINT "duplicate_submissions_attemptedByUserId_fkey" FOREIGN KEY ("attemptedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_submissions" ADD CONSTRAINT "duplicate_submissions_existingApplicationId_fkey" FOREIGN KEY ("existingApplicationId") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_transitions" ADD CONSTRAINT "stage_transitions_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_transitions" ADD CONSTRAINT "stage_transitions_fromStageId_fkey" FOREIGN KEY ("fromStageId") REFERENCES "stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_transitions" ADD CONSTRAINT "stage_transitions_toStageId_fkey" FOREIGN KEY ("toStageId") REFERENCES "stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_transitions" ADD CONSTRAINT "stage_transitions_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet_sources" ADD CONSTRAINT "sheet_sources_defaultJobRoleId_fkey" FOREIGN KEY ("defaultJobRoleId") REFERENCES "job_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imported_rows" ADD CONSTRAINT "imported_rows_sheetSourceId_fkey" FOREIGN KEY ("sheetSourceId") REFERENCES "sheet_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imported_rows" ADD CONSTRAINT "imported_rows_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imported_rows" ADD CONSTRAINT "imported_rows_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet_sync_runs" ADD CONSTRAINT "sheet_sync_runs_sheetSourceId_fkey" FOREIGN KEY ("sheetSourceId") REFERENCES "sheet_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
