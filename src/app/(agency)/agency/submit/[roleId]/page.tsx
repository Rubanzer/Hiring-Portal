import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAgencyUser } from "@/lib/auth";
import { checkSubmissionAllowance, getAgencyRole } from "@/lib/tenancy";
import { isStorageConfigured } from "@/lib/env";
import {
  SubmitCandidatesForm,
  type PublicQuestion,
} from "@/components/submit-candidates-form";
import { Alert, Card, PageHeader } from "@/components/ui";
import type { QuestionType } from "@/components/question-builder";

export default async function SubmitToRolePage({
  params,
}: {
  params: Promise<{ roleId: string }>;
}) {
  const { roleId } = await params;
  const user = await requireAgencyUser();

  // 404 rather than 403 when the role isn't assigned to this agency, so a guessed id
  // reveals nothing about what other roles exist.
  const assignment = await getAgencyRole(user.agencyId, roleId);
  if (!assignment) notFound();

  const allowance = await checkSubmissionAllowance(user.agencyId, roleId);
  const role = assignment.jobRole;

  const questions: PublicQuestion[] = role.questions.map((q) => ({
    id: q.id,
    label: q.label,
    helpText: q.helpText,
    type: q.type as QuestionType,
    options: Array.isArray(q.options) ? (q.options as string[]) : null,
    isRequired: q.isRequired,
    // isKnockout is deliberately not sent: an agency that knows the screening thresholds can
    // coach candidates through them, which defeats the point of asking.
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={role.title}
        description={
          [role.department, role.location, role.employmentType].filter(Boolean).join(" · ") ||
          undefined
        }
      />

      <Link href="/agency/submit" className="inline-block text-sm text-ink-500 underline">
        ← All roles
      </Link>

      {role.description ? (
        <Card className="p-5">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-700">
            {role.description}
          </p>
        </Card>
      ) : null}

      {!allowance.allowed ? (
        <Alert tone="warning" title="Submissions are closed for this role">
          {allowance.reason}
        </Alert>
      ) : (
        <SubmitCandidatesForm
          jobRoleId={role.id}
          roleTitle={role.title}
          questions={questions}
          remaining={allowance.remaining}
          storageConfigured={isStorageConfigured()}
        />
      )}
    </div>
  );
}
