"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { setPasswordAction, type SetPasswordState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? "Saving…" : "Set password and sign in"}
    </Button>
  );
}

export function SetPasswordForm({ token }: { token: string }) {
  const [state, formAction] = useActionState<SetPasswordState, FormData>(
    setPasswordAction,
    {},
  );

  return (
    <Card className="p-6">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="token" value={token} />

        {state.error ? <Alert tone="error">{state.error}</Alert> : null}

        <Field
          label="New password"
          htmlFor="password"
          required
          hint="At least 10 characters, including a letter and a number."
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            autoFocus
            minLength={10}
          />
        </Field>

        <Field label="Confirm password" htmlFor="confirm" required>
          <Input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
          />
        </Field>

        <SubmitButton />
      </form>
    </Card>
  );
}
