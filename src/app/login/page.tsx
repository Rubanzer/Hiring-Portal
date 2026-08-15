import { redirect } from "next/navigation";
import { getSessionUser, landingPathFor } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — Hiring Portal" };

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(landingPathFor(user.role));

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
            Hiring Portal
          </h1>
          <p className="mt-1.5 text-sm text-ink-500">
            Sign in to submit candidates or manage the hiring funnel.
          </p>
        </div>

        <LoginForm />

        <p className="mt-6 text-center text-xs text-ink-500">
          Accounts are created by the hiring team. If you need access, ask your contact for
          an invite.
        </p>
      </div>
    </main>
  );
}
