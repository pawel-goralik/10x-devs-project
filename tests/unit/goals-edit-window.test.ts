import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editWindowRemainingMs, isEditable } from "@/lib/services/goals";

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-01-01T00:00:00.000Z");

describe("24h edit window boundary (Risk #2) — isEditable / editWindowRemainingMs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is editable with the full window remaining when created just now", () => {
    const goal = { createdAt: NOW.toISOString() };

    expect(isEditable(goal)).toBe(true);
    expect(editWindowRemainingMs(goal)).toBe(EDIT_WINDOW_MS);
  });

  it("is editable with 1s remaining when created 24h-minus-1s ago", () => {
    const goal = { createdAt: new Date(NOW.getTime() - (EDIT_WINDOW_MS - 1000)).toISOString() };

    expect(isEditable(goal)).toBe(true);
    expect(editWindowRemainingMs(goal)).toBe(1000);
  });

  it("is locked with zero remaining when created exactly 24h ago", () => {
    const goal = { createdAt: new Date(NOW.getTime() - EDIT_WINDOW_MS).toISOString() };

    expect(isEditable(goal)).toBe(false);
    expect(editWindowRemainingMs(goal)).toBe(0);
  });

  it("is locked with zero remaining when created 24h-plus-1s ago", () => {
    const goal = { createdAt: new Date(NOW.getTime() - (EDIT_WINDOW_MS + 1000)).toISOString() };

    expect(isEditable(goal)).toBe(false);
    expect(editWindowRemainingMs(goal)).toBe(0);
  });
});
