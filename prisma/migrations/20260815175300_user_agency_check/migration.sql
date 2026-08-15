-- An agency user must belong to an agency; an internal user must not belong to one.
-- Enforced in the database so no code path (import script, console, future service) can
-- create a user whose role and tenancy disagree.
ALTER TABLE "users"
  ADD CONSTRAINT "users_agency_role_consistency"
  CHECK (
    (role IN ('AGENCY_OWNER', 'AGENCY_RECRUITER') AND "agencyId" IS NOT NULL)
    OR
    (role IN ('ADMIN', 'RECRUITER') AND "agencyId" IS NULL)
  );

-- An application sourced from an agency must name that agency, and a non-agency
-- application must not claim one.
ALTER TABLE "applications"
  ADD CONSTRAINT "applications_agency_source_consistency"
  CHECK (
    (source = 'AGENCY' AND "agencyId" IS NOT NULL)
    OR
    (source <> 'AGENCY' AND "agencyId" IS NULL)
  );

-- Exactly one stage may be the default landing stage for new applications.
CREATE UNIQUE INDEX "stages_single_default" ON "stages" ("isDefault") WHERE "isDefault" = true;
