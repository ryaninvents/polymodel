import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatCredentials,
  readCredentialsFile,
  writeCredentialsFile,
} from "./credentialsFile.ts";
import { loadEnv } from "./loadEnv.ts";

function tempConfigHome(): string {
  return mkdtempSync(join(tmpdir(), "polymodel-credentials-"));
}

describe("credentials file", () => {
  it("round-trips values and keeps the file private", () => {
    const path = join(tempConfigHome(), "polymodel", "credentials.env");
    writeCredentialsFile(path, {
      OPENROUTER_API_KEY: "sk-or-1",
      ANTHROPIC_API_KEY: "sk-ant=1#x",
    });

    expect(readCredentialsFile(path)).toEqual({
      ANTHROPIC_API_KEY: "sk-ant=1#x",
      OPENROUTER_API_KEY: "sk-or-1",
    });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8")).toMatch(/^# Written by/);
  });

  it("rejects values that would not round-trip", () => {
    expect(() => formatCredentials({ KEY: 'a"b' })).toThrow(/quotes/);
    expect(() => formatCredentials({ "BAD-NAME": "x" })).toThrow(/name/);
  });

  it("is layered under the process environment", () => {
    const home = tempConfigHome();
    writeCredentialsFile(join(home, "polymodel", "credentials.env"), {
      ANTHROPIC_API_KEY: "from-file",
      OPENAI_API_KEY: "from-file",
    });
    const env = loadEnv({
      XDG_CONFIG_HOME: home,
      OPENAI_API_KEY: "from-shell",
      ANTHROPIC_API_KEY: "",
    });

    expect(env.lookup("ANTHROPIC_API_KEY")).toBe("from-file");
    expect(env.lookup("OPENAI_API_KEY")).toBe("from-shell");
  });
});
