import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  carriedUserConfig,
  opencodeChildEnv,
  opencodeInvocation,
  opencodeModel,
  parseRunOutput,
  runOpencodeCli,
  stripJsonc,
} from "./opencode.js";
import { activeHost, unknownHostSetting } from "./index.js";
import { claudeErrorReason, runModelCli } from "../score.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "handbook-host-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("which host is active", () => {
  it("given nothing set, when asked, then it is Claude Code", () => {
    expect(activeHost({}, home)).toBe("claude-code");
  });

  it("given config.json says opencode but the environment says claude-code, when asked, then the environment wins", () => {
    writeFileSync(join(home, "config.json"), JSON.stringify({ host: "opencode" }));
    expect(activeHost({}, home)).toBe("opencode");
    expect(activeHost({ TEAMHANDBOOK_HOST: "claude-code" }, home)).toBe("claude-code");
  });

  it("given a host name this version does not know, when asked, then it falls back and the setting is reported", () => {
    expect(activeHost({ TEAMHANDBOOK_HOST: "cursor" }, home)).toBe("claude-code");
    expect(unknownHostSetting({ TEAMHANDBOOK_HOST: "cursor" }, home)).toBe("TEAMHANDBOOK_HOST=cursor");
    expect(unknownHostSetting({}, home)).toBeNull();
  });
});

describe("the user's OpenCode config", () => {
  it("given JSONC with comments and trailing commas, when stripped, then it parses and strings keep their slashes", () => {
    const text = '{\n  // the model\n  "model": "anthropic/claude", /* inline */\n  "url": "http://x//y",\n}\n';
    expect(JSON.parse(stripJsonc(text))).toEqual({ model: "anthropic/claude", url: "http://x//y" });
  });

  it("given a global config, when carried, then only the model and provider keys come through, later files winning", () => {
    const dir = join(home, "opencode");
    mkdirSync(dir);
    writeFileSync(join(dir, "config.json"), JSON.stringify({ model: "a/old", plugin: ["evil"] }));
    writeFileSync(
      join(dir, "opencode.jsonc"),
      '{ "model": "a/new", "provider": { "a": {} }, "mcp": { "x": {} }, "instructions": ["x.md"] }',
    );
    expect(carriedUserConfig(dir)).toEqual({ model: "a/new", provider: { a: {} } });
  });

  it("given an unparseable file, when carried, then it contributes nothing rather than failing", () => {
    const dir = join(home, "opencode");
    mkdirSync(dir);
    writeFileSync(join(dir, "opencode.json"), "{ not json");
    expect(carriedUserConfig(dir)).toEqual({});
  });
});

describe("the OpenCode model name", () => {
  it("given an alias mapped in config.json, when resolved, then the mapping is used", () => {
    writeFileSync(join(home, "config.json"), JSON.stringify({ opencode: { models: { sonnet: "anthropic/claude-sonnet-5-5" } } }));
    expect(opencodeModel("sonnet", home)).toBe("anthropic/claude-sonnet-5-5");
  });

  it("given an unmapped alias, when resolved, then no model is passed; a provider/model name passes through", () => {
    expect(opencodeModel("haiku", home)).toBe("");
    expect(opencodeModel("openai/gpt-5", home)).toBe("openai/gpt-5");
  });
});

describe("the OpenCode child's environment", () => {
  it("given a parent OpenCode session, when the child env is built, then its handles are dropped and the isolation switches are set", () => {
    const env = opencodeChildEnv("/scratch", { model: "a/b" }, {
      PATH: "/bin",
      HOME: "/home/someone",
      OPENAI_API_KEY: "k",
      XDG_DATA_HOME: "/data",
      OPENCODE_SERVER_PASSWORD: "p",
      OPENCODE_CONFIG_CONTENT: '{"plugin":["x"]}',
      CLAUDE_CODE_SESSION_ID: "s",
      GITHUB_TOKEN: "t",
      NODE_OPTIONS: "--require x",
    });
    expect(env.PATH).toBe("/bin");
    expect(env.HOME).toBe("/home/someone");
    expect(env.OPENAI_API_KEY).toBe("k");
    expect(env.XDG_DATA_HOME).toBe("/data");
    expect(env.OPENCODE_SERVER_PASSWORD).toBeUndefined();
    expect(env.CLAUDE_CODE_SESSION_ID).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.OPENCODE_PURE).toBe("1");
    expect(env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("1");
    expect(env.OPENCODE_DISABLE_CLAUDE_CODE).toBe("1");
    expect(env.XDG_CONFIG_HOME).toBe(join("/scratch", "config"));
    expect(env.OPENCODE_TEST_HOME).toBe(join("/scratch", "home"));
    expect(env.OPENCODE_DB).toBe(join("/scratch", "child.db"));
    expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT!)).toEqual({ model: "a/b", permission: { "*": "deny" } });
  });

  it("given a carried config that sets its own permission, when merged, then the deny rule still wins", () => {
    const env = opencodeChildEnv("/scratch", { permission: { bash: "allow" } }, {});
    expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT!).permission).toEqual({ "*": "deny" });
  });
});

describe("the OpenCode invocation", () => {
  it("given a prompt, when the invocation is built, then the prompt is stdin only and the run is pure, JSON and in an empty directory", () => {
    const invocation = opencodeInvocation({ prompt: "secret prompt text", model: "haiku", home, source: {} });
    try {
      expect(invocation.args.join(" ")).not.toContain("secret");
      expect(invocation.input).toBe("secret prompt text");
      expect(invocation.args.slice(0, 4)).toEqual(["run", "--pure", "--format", "json"]);
      expect(invocation.args).toContain(invocation.cwd);
      expect(invocation.args).not.toContain("-m");
      expect(readdirSync(invocation.cwd)).toEqual([]);
    } finally {
      invocation.done();
    }
    expect(existsSync(invocation.cwd)).toBe(false);
  });
});

describe("the OpenCode reply", () => {
  const line = (event: unknown): string => JSON.stringify(event);

  it("given text events among others, when parsed, then only the model's text is the reply", () => {
    const stdout = [
      line({ type: "step_start", part: {} }),
      line({ type: "text", part: { text: "first" } }),
      line({ type: "text", part: { text: "injected", synthetic: true } }),
      line({ type: "tool_use", part: { tool: "bash" } }),
      "not json",
      line({ type: "text", part: { text: "second" } }),
    ].join("\n");
    expect(parseRunOutput(stdout)).toBe("first\nsecond");
  });

  it("given no text, when parsed, then it throws rather than returning an empty reply", () => {
    expect(() => parseRunOutput(line({ type: "step_finish", part: {} }))).toThrow();
  });

  it("given an error event, when parsed, then the failure carries the error's message", () => {
    let caught: unknown;
    try {
      parseRunOutput(line({ type: "error", error: { name: "ProviderAuthError", data: { message: "no key" } } }));
    } catch (err) {
      caught = err;
    }
    expect(claudeErrorReason(caught)).toBe("no key");
  });
});

describe("the OpenCode runner", () => {
  let bin: string;
  let out: string;
  let originalPath: string | undefined;
  let originalHost: string | undefined;

  beforeEach(() => {
    bin = mkdtempSync(join(tmpdir(), "handbook-bin-"));
    out = mkdtempSync(join(tmpdir(), "handbook-out-"));
    originalPath = process.env.PATH;
    originalHost = process.env.TEAMHANDBOOK_HOST;
    process.env.PATH = `${bin}:${process.env.PATH ?? ""}`;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    if (originalHost === undefined) delete process.env.TEAMHANDBOOK_HOST;
    else process.env.TEAMHANDBOOK_HOST = originalHost;
    rmSync(bin, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });

  /** A stand-in `opencode` that records what it was handed. The real binary is never called. */
  function recordingOpencode(): void {
    writeFileSync(
      join(bin, "opencode"),
      [
        "#!/bin/sh",
        `printf '%s\\n' "$@" > ${JSON.stringify(join(out, "args"))}`,
        `pwd > ${JSON.stringify(join(out, "cwd"))}`,
        `env > ${JSON.stringify(join(out, "env"))}`,
        `cat > ${JSON.stringify(join(out, "stdin"))}`,
        `printf '%s\\n' '{"type":"text","part":{"text":"the reply"}}'`,
      ].join("\n"),
      { mode: 0o755 },
    );
  }

  it("given the host is opencode, when the engine's model call runs, then it reaches opencode with the prompt on stdin", async () => {
    recordingOpencode();
    process.env.TEAMHANDBOOK_HOST = "opencode";
    await expect(runModelCli("the prompt", "haiku", 10_000)).resolves.toBe("the reply");
    expect(readFileSync(join(out, "stdin"), "utf8")).toBe("the prompt");
    expect(readFileSync(join(out, "args"), "utf8")).toContain("--pure");
    const env = readFileSync(join(out, "env"), "utf8");
    expect(env).toContain("OPENCODE_PURE=1");
    expect(env).not.toContain("TEAMHANDBOOK_HOST=");
    expect(readFileSync(join(out, "cwd"), "utf8").trim()).toContain("teamhandbook-child-");
  });

  it("given no opencode on PATH, when the runner calls it, then the reason names opencode", async () => {
    process.env.PATH = bin;
    let caught: unknown;
    try {
      await runOpencodeCli("p", "haiku", 10_000);
    } catch (err) {
      caught = err;
    }
    expect(claudeErrorReason(caught)).toContain("opencode CLI not found");
  });
});
