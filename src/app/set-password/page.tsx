import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/auth";
import { Alert, Card, LinkButton } from "@/components/ui";
import { SetPasswordForm } from "./set-password-form";

export const metadata = { title: "Set your password — Hiring Portal" };

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  // Look the token up before rendering the form, so an expired link says so immediately
  // instead of after someone has typed a password twice.
  const invitation = token
    ? await prisma.invitation.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { user: { select: { name: true, email: true } } },
      })
    : null;

  const valid =
    invitation && !invitation.usedAt && invitation.expiresAt > new Date() ? invitation : null;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-center text-2xl font-semibold tracking-tight text-ink-900">
          Hiring Portal
        </h1>

        {!valid ? (
          <Card className="p-6">
            <Alert tone="error" title="This link isn't usable">
              It may have expired, already been used, or been mistyped. Ask your contact to
              send a fresh invite.
            </Alert>
            <div className="mt-4">
              <LinkButton href="/login" variant="secondary" className="w-full">
                Back to sign in
              </LinkButton>
            </div>
          </Card>
        ) : (
          <>
            <p className="mb-4 text-center text-sm text-ink-500">
              {valid.type === "INVITE" ? "Welcome" : "Reset your password"},{" "}
              <span className="font-medium text-ink-700">{valid.user.name}</span>
            </p>
            <SetPasswordForm token={token!} />
          </>
        )}
      </div>
    </main>
  );
}
