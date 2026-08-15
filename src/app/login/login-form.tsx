"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { loginAction, type LoginState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState<LoginState, FormData>(loginAction, {});

  return (
    <Card className="p-6">
      <form action={formAction} className="space-y-4">
        {state.error ? <Alert tone="error">{state.error}</Alert> : null}

        <Field label="Email address" htmlFor="email" required>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            autoFocus
            placeholder="you@company.com"
          />
        </Field>

        <Field label="Password" htmlFor="password" required>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>

        <SubmitButton />
      </form>
    </Card>
  );
}
