-- Roles are visible to every agency by default.
--
-- Previously an agency saw a role only if you created an agency_job_assignments row for it,
-- which meant onboarding an agency was N clicks for N roles and a new role had to be handed
-- out one agency at a time. That default is backwards for how this is used: normally you want
-- every partner working every open role, and restricting one is the exception.
--
-- Assignments are not going away. They still carry per-agency submission caps, and they become
-- the allow-list for any role you flag as restricted. Existing roles default to false, so every
-- role opens up to every agency the moment this applies.
-- AlterTable
ALTER TABLE "job_roles" ADD COLUMN     "restrictedToAssignedAgencies" BOOLEAN NOT NULL DEFAULT false;

