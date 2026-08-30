import { SUPABASE_URL, SUPABASE_KEY, BREVO_API_KEY, BREVO_SENDER_EMAIL } from "astro:env/server";

export interface ConfigStatus {
  name: string;
  configured: boolean;
  message: string;
  docsUrl?: string;
  docsLabel?: string;
}

export const configStatuses: ConfigStatus[] = [
  {
    name: "Supabase",
    configured: Boolean(SUPABASE_URL && SUPABASE_KEY),
    message: "Supabase nie jest skonfigurowany — funkcje uwierzytelniania są wyłączone.",
    docsUrl: "https://github.com/przeprogramowani/10x-astro-starter#supabase-configuration",
    docsLabel: "Zobacz instrukcję konfiguracji",
  },
  {
    name: "Brevo",
    configured: Boolean(BREVO_API_KEY && BREVO_SENDER_EMAIL),
    message: "Brevo nie jest skonfigurowany — wysyłka e-maili jest wyłączona.",
  },
];

export const missingConfigs = configStatuses.filter((s) => !s.configured);
