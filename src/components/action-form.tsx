"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Button } from "@/components/ui";

export type FormState = {
  error?: string;
  success?: string;
  /** Set when email delivery isn't available and the admin needs to pass a link on manually. */
  inviteUrl?: string;
};

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  size = "md",
  className,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} className={className} disabled={pending}>
      {pending ? (pendingLabel ?? "Working…") : children}
    </Button>
  );
}

/**
 * Wraps a server action with its own result banner.
 *
 * Every admin screen is "a form that reports what happened", so this keeps the
 * useActionState wiring in one place instead of repeating it a dozen times.
 */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  return (
    <form action={formAction} className={className}>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.success ? (
        <Alert tone="success">
          {state.success}
          {state.inviteUrl ? (
            <p className="mt-2 break-all rounded bg-white/60 px-2 py-1 font-mono text-xs">
              {state.inviteUrl}
            </p>
          ) : null}
        </Alert>
      ) : null}
      {children}
    </form>
  );
}
