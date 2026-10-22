import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMMAND_NAME_NOTE,
  GENERATED_MARK,
  OPENCODE_COMMANDS,
  installOpencodeCommands,
  opencodeCommandsDir,
  removeOpencodeCommands,
  toOpencodeCommand,
} from "./opencode-commands.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ROOT = "/opt/teamhandbook";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "handbook-oc-commands-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("a Claude Code command turned into an OpenCode one", () => {
  for (const name of OPENCODE_COMMANDS) {
    it(`given commands/${name}.md, when converted, then nothing in it still names Claude Code's machinery`, () => {
      const converted = toOpencodeCommand(readFileSync(join(repoRoot, "commands", `${name}.md`), "utf8"), ROOT);
      // the one line that names the Claude Code form on purpose, to translate it
      expect(converted).toContain(COMMAND_NAME_NOTE);
      const out = converted.replace(COMMAND_NAME_NOTE, "");
      expect(out).not.toContain("${CLAUDE_PLUGIN_ROOT}");
      expect(out).not.toContain("AskUserQuestion");
      expect(out).not.toContain("/handbook:");
      expect(out).not.toContain("!`");
      expect(out).not.toMatch(/\$\d/);
      // every CLI call says which host it runs under
      const calls = out.match(/node "\/opt\/teamhandbook\/dist\//g) ?? [];
      const tagged = out.match(/TEAMHANDBOOK_HOST=opencode node "\/opt\/teamhandbook\/dist\//g) ?? [];
      expect(calls.length).toBeGreaterThan(0);
      expect(tagged.length).toBe(calls.length);
      const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(out)![1]!;
      expect(frontmatter.split("\n")).toHaveLength(1);
      expect(frontmatter).toMatch(/^description: \S/);
      expect(out.split("\n")).toContain(GENERATED_MARK);
    });
  }

  it("given a body that would run a shell command or take a positional argument, when converted, then it is refused", () => {
    expect(() => toOpencodeCommand("---\ndescription: d\n---\nrun !`ls`\n", ROOT)).toThrow(/shell/);
    expect(() => toOpencodeCommand("---\ndescription: d\n---\nawk '{print $1}'\n", ROOT)).toThrow(/argument/);
  });

  it("given a plugin path a shell line cannot quote, when converted, then it is refused", () => {
    expect(() => toOpencodeCommand("---\ndescription: d\n---\nbody\n", '/tmp/a"b')).toThrow(/quote/);
    expect(() => toOpencodeCommand("---\ndescription: d\n---\nbody\n", "/tmp/$x")).toThrow(/quote/);
  });
});

describe("installing the OpenCode commands", () => {
  it("given a project, when the target is resolved, then it is the project's .opencode/commands/handbook", () => {
    expect(opencodeCommandsDir({ project: "/p" })).toBe(join("/p", ".opencode", "commands", "handbook"));
    expect(opencodeCommandsDir({ env: { XDG_CONFIG_HOME: "/cfg" } })).toBe(join("/cfg", "opencode", "commands", "handbook"));
  });

  it("given a file the user wrote, when installing and removing, then it is never touched", () => {
    const target = join(dir, "handbook");
    mkdirSync(target);
    writeFileSync(join(target, "mine.md"), "my own mine command\n");
    writeFileSync(join(target, "notes.md"), "mine too\n");
    const result = installOpencodeCommands(repoRoot, target);
    expect(result.skipped).toEqual(["mine.md"]);
    expect(result.written).toHaveLength(OPENCODE_COMMANDS.length - 1);
    expect(readFileSync(join(target, "mine.md"), "utf8")).toBe("my own mine command\n");
    expect(removeOpencodeCommands(target)).toHaveLength(OPENCODE_COMMANDS.length - 1);
    expect(readFileSync(join(target, "notes.md"), "utf8")).toBe("mine too\n");
  });

  it("given a previous install, when installing again and then removing, then its own files are replaced and the empty directory goes", () => {
    const target = join(dir, "handbook");
    installOpencodeCommands(repoRoot, target);
    writeFileSync(join(target, "status.md"), `${GENERATED_MARK}\nstale\n`);
    expect(installOpencodeCommands(repoRoot, target).written).toContain("status.md");
    expect(readFileSync(join(target, "status.md"), "utf8")).not.toContain("stale");
    removeOpencodeCommands(target);
    expect(existsSync(target)).toBe(false);
  });
});
