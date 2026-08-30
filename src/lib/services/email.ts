import { BREVO_API_KEY, BREVO_SENDER_EMAIL } from "astro:env/server";

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";
const SENDER_NAME = "Resolution Circle";

export interface RenderEmailLayoutParams {
  heading: string;
  bodyHtml: string;
}

/** Matches supabase/templates/magic-link.html's branding — heading/bodyHtml replace that template's sign-in button block. */
export function renderEmailLayout({ heading, bodyHtml }: RenderEmailLayoutParams): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${heading}</title>
  </head>
  <body style="margin:0; padding:0; background-color:#0f0a2e; font-family:Helvetica, Arial, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f0a2e; padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:420px; background-color:#1a1440; border-radius:16px; padding:32px;">
            <tr>
              <td align="center" style="padding-bottom:16px;">
                <span style="font-size:24px; font-weight:bold; color:#ffffff;">Resolution Circle</span>
              </td>
            </tr>
            <tr>
              <td style="color:#ffffff; font-size:18px; font-weight:bold; text-align:center; padding-bottom:16px;">
                ${heading}
              </td>
            </tr>
            <tr>
              <td style="color:#c9c3f0; font-size:16px; line-height:24px; text-align:center;">
                ${bodyHtml}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  heading: string;
  bodyHtml: string;
  text: string;
}

export interface SendEmailResult {
  success: boolean;
  error?: string;
}

/** Single-recipient send; a caller sending to a group loops and aggregates results itself. Never throws. */
export async function sendEmail({ to, subject, heading, bodyHtml, text }: SendEmailParams): Promise<SendEmailResult> {
  if (!BREVO_API_KEY || !BREVO_SENDER_EMAIL) {
    console.log(`[email] Skipped send to ${to} ("${subject}") — Brevo is not configured`);
    return { success: false, error: "Brevo is not configured" };
  }

  try {
    const response = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": BREVO_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: { email: BREVO_SENDER_EMAIL, name: SENDER_NAME },
        to: [{ email: to }],
        subject,
        htmlContent: renderEmailLayout({ heading, bodyHtml }),
        textContent: text,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[email] Brevo send to ${to} failed: ${response.status} ${body}`);
      return { success: false, error: `Brevo responded with ${response.status}` };
    }

    return { success: true };
  } catch (error) {
    console.error(`[email] Brevo send to ${to} threw`, error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}
