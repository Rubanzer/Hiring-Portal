"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Button, Card, CardHeader, Field, Input, Textarea } from "@/components/ui";
import { createAgencyAction, type ActionState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Creating…" : "Create agency"}
    </Button>
  );
}

export function CreateAgencyForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(createAgencyAction, {});

  return (
    <Card className="h-fit">
      <CardHeader
        title="Add an agency"
        description="Creates their portal. Add logins from the agency's page."
      />
      <form action={formAction} className="space-y-4 p-5">
        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        {state.success ? <Alert tone="success">{state.success}</Alert> : null}

        <Field label="Agency name" htmlFor="name" required>
          <Input id="name" name="name" required placeholder="Acme Talent Partners" />
        </Field>

        <Field label="Primary contact email" htmlFor="contactEmail">
          <Input
            id="contactEmail"
            name="contactEmail"
            type="email"
            placeholder="contact@acmetalent.com"
          />
        </Field>

        <Field label="Contact phone" htmlFor="contactPhone">
          <Input id="contactPhone" name="contactPhone" placeholder="+91 98765 43210" />
        </Field>

        <Field
          label="Candidate ownership window (days)"
          htmlFor="ownershipWindowDays"
          hint="How long this agency is credited with a candidate after submitting them. 90 days is the common contract term."
        >
          <Input
            id="ownershipWindowDays"
            name="ownershipWindowDays"
            type="number"
            min={0}
            max={730}
            defaultValue={90}
          />
        </Field>

        <Field
          label="Commission / contract notes"
          htmlFor="commissionNotes"
          hint="Internal only. Never shown to the agency."
        >
          <Textarea
            id="commissionNotes"
            name="commissionNotes"
            rows={3}
            placeholder="8.33% of annual CTC, invoiced on joining, 90-day replacement guarantee."
          />
        </Field>

        <SubmitButton />
      </form>
    </Card>
  );
}
