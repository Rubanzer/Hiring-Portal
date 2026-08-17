"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type FormState } from "@/components/action-form";
import { Button, Field, Input } from "@/components/ui";

/**
 * The two destructive-ish things you can do to a login, both behind a confirmation.
 *
 * They're grouped in one client component because both need to open and close a small inline
 * form, and a table row is the wrong place for two independent bits of state to be managed by
 * the page.
 */

export function SetPasswordButton({
  userId,
  email,
  action,
}: {
  userId: string;
  email: string;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Set password
      </Button>
    );
  }

  return (
    <ActionForm action={action} className="w-full space-y-2 rounded-lg border border-ink-200 p-3">
      <input type="hidden" name="userId" value={userId} />
      <Field label={`New password for ${email}`} htmlFor={`pw-${userId}`}>
        <Input
          id={`pw-${userId}`}
          name="password"
          type="text"
          minLength={12}
          required
          autoComplete="off"
          placeholder="At least 12 characters"
        />
      </Field>
      <p className="text-xs text-ink-500">
        Shown back to you once so you can pass it on. Signs them out of any other device.
      </p>
      <div className="flex gap-2">
        <SubmitButton size="sm" pendingLabel="Setting…">
          Set password
        </SubmitButton>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </ActionForm>
  );
}

export function DeleteUserButton({
  userId,
  name,
  submittedCount,
  action,
}: {
  userId: string;
  name: string;
  submittedCount: number;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-red-600"
        onClick={() => setConfirming(true)}
      >
        Delete
      </Button>
    );
  }

  return (
    <ActionForm action={action} className="w-full space-y-2 rounded-lg border border-red-200 p-3">
      <input type="hidden" name="userId" value={userId} />
      <p className="text-sm text-ink-800">
        Delete <span className="font-medium">{name}</span>?
      </p>
      {/*
        Said explicitly because "delete the person who submitted our candidates" reads like it
        takes the candidates with them. It doesn't — every record that names a user keeps
        existing without one, and ownership was always credited to the agency.
      */}
      <p className="text-xs text-ink-500">
        {submittedCount > 0
          ? `Their ${submittedCount} submission${submittedCount === 1 ? "" : "s"} stay in the funnel, still credited to the agency. Only the login goes.`
          : "Only the login goes. Nothing else is affected."}
      </p>
      <div className="flex gap-2">
        <SubmitButton variant="danger" size="sm" pendingLabel="Deleting…">
          Delete login
        </SubmitButton>
        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </ActionForm>
  );
}
