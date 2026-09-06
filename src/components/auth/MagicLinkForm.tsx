import React, { useState } from "react";
import { Mail, Send } from "lucide-react";
import { FormField } from "@/components/shared/FormField";
import { SubmitButton } from "@/components/shared/SubmitButton";
import { ServerError } from "@/components/shared/ServerError";

interface Props {
  serverError?: string | null;
  next?: string | null;
}

export default function MagicLinkForm({ serverError, next }: Props) {
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<{ email?: string }>({});

  function validate() {
    const next: typeof errors = {};
    if (!email.trim()) {
      next.email = "Adres e-mail jest wymagany";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      next.email = "Podaj prawidłowy adres e-mail";
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
      {next && <input type="hidden" name="next" value={next} />}
      <FormField
        id="email"
        type="email"
        label="E-mail"
        value={email}
        onChange={(v) => {
          setEmail(v);
          clearError("email");
        }}
        placeholder="ty@przyklad.pl"
        error={errors.email}
        icon={<Mail className="size-4" />}
      />

      <ServerError message={serverError} />

      <SubmitButton pendingText="Wysyłanie linku..." icon={<Send className="size-4" />}>
        Kontynuuj przez e-mail
      </SubmitButton>
    </form>
  );
}
