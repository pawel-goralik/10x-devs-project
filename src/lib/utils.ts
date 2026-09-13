import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** For values interpolated into an email's HTML (heading/body), not for Tailwind classes. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/**
 * Guards every read site of a `next` redirect param (request-link.ts, callback.ts,
 * middleware's own read of it is a write, not a read) against an open-redirect via a
 * maliciously crafted value — only a single-leading-slash, same-origin relative path is
 * allowed.
 */
export function sanitizeNextPath(value: string | null): string | null {
  if (!value) {
    return null;
  }
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("://") || value.includes("\\")) {
    return null;
  }
  return value;
}
