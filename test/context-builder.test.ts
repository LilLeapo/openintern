import { describe, expect, it } from "vitest";

import { formatDateTimeForTimeZone } from "../src/agent/context/context-builder.js";

describe("ContextBuilder time formatting", () => {
  it("formats local wall time for the configured timezone instead of UTC", () => {
    const date = new Date("2026-03-10T06:51:00.000Z");

    expect(formatDateTimeForTimeZone(date, "Asia/Shanghai")).toBe("2026-03-10 14:51");
    expect(formatDateTimeForTimeZone(date, "UTC")).toBe("2026-03-10 06:51");
  });
});
