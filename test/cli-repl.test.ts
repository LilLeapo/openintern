import { describe, expect, it } from "vitest";

import { parseCliMode } from "../src/cli/repl.js";

describe("parseCliMode", () => {
  it("defaults to repl when no command is provided", () => {
    expect(parseCliMode([])).toBe("repl");
  });

  it("accepts gateway command", () => {
    expect(parseCliMode(["gateway"])).toBe("gateway");
  });

  it("rejects unknown commands", () => {
    expect(() => parseCliMode(["unknown"])).toThrow("Unknown command");
  });
});
