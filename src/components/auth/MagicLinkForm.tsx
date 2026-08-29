import React, { useState } from "react";
import { Mail, Send } from "lucide-react";
import { FormField } from "@/components/shared/FormField";
import { SubmitButton } from "@/components/shared/SubmitButton";
import { ServerError } from "@/components/shared/ServerError";

interface Props {
  serverError?: string | null;
}

export default function MagicLinkForm({ serverError }: Props) {
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<{ email?: string }>({});

  function validate() {
    const next: typeof errors = {};
    if (!email.trim()) {
      next.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      next.email = "Enter a valid email address";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function clearError(field: keyof typeof errors) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  return (
    <form method="POST" action="/api/auth/request-link" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <FormField
        id="email"
        type="email"
        label="Email"
        value={email}
        onChange={(v) => {
          setEmail(v);
          clearError("email");
        }}
        placeholder="you@example.com"
        error={errors.email}
        icon={<Mail className="size-4" />}
      />

      <ServerError message={serverError} />

      <SubmitButton pendingText="Sending link..." icon={<Send className="size-4" />}>
        Continue with email
      </SubmitButton>
    </form>
  );
}
