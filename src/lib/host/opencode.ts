import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { CHILD_ENV_EXACT, CHILD_ENV_PREFIXES } from "../child-env.js";
import { readConfigFile } from "../config.js";
import { handbookHome } from "../session-state.js";
import type { ClaudeRunner } from "../score.js";

const execFileAsync = promisify(execFile);

/**
 * The OpenCode side of the one model call this product makes. Same contract as
 * `childInvocation` in score.ts: no tools, no MCP servers, no plugins, none of the
 * project's or the user's instructions, an empty working directory, and the prompt on
 * stdin. What differs is how OpenCode is told so, and every switch below was read from the
 * v1.19.4 source rather than measured against a running binary.
 *
 * OpenCode has no `--tools ""`. What removes a tool from the request the model sees is a
 * permission rule `deny` with pattern `*` (permission/index.ts, filtered in
 * session/llm/request.ts); any narrower rule is only checked when the tool is called, which
 * is a prompt, not a block. MCP tools pass through the same filter.
 *
 * OpenCode also has no "ignore my settings" flag, and its config layers deep-merge, so a
 * later layer cannot take back a plugin or an MCP server an earlier one added. The only way
 * to keep the user's global config out is to give the child a different config directory.
 */

/** The parts of the user's global OpenCode config the child cannot reach a model without. */
const CARRIED_CONFIG_KEYS = ["model", "small_model", "provider", "enabled_providers", "disabled_providers"];

/**
 * The deny-everything rule, merged last. `permission` is an object of rules, and a bare
 * string action for `*` is the shape the docs give for "this applies to every tool".
 */
const DENY_ALL_TOOLS = { "*": "deny" };

/**
 * Switches set on every child, each for one thing the child would otherwise load:
 * - PURE: no external plugins. Without it a TeamHandbook plugin installed in the user's
 *   global config fires inside the call it is waiting on.
 * - DISABLE_PROJECT_CONFIG: no project opencode.json, no `.opencode` directories walked up
 *   from the working directory, no project AGENTS.md.
 * - DISABLE_CLAUDE_CODE: no CLAUDE.md and no `.claude/skills`, which OpenCode reads by default.
 * - DISABLE_EXTERNAL_SKILLS: no `.agents/skills`.
 * - AUTOUPDATE and LSP_DOWNLOAD: a scoring call has no business fetching binaries.
 */
const CHILD_SWITCHES: Record<string, string> = {
  OPENCODE_PURE: "1",
  OPENCODE_DISABLE_PROJECT_CONFIG: "1",
  OPENCODE_DISABLE_CLAUDE_CODE: "1",
  OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
  OPENCODE_DISABLE_AUTOUPDATE: "1",
  OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
};

/**
 * Comments and trailing commas out of a JSONC file, leaving strings alone. OpenCode's own
 * config is `opencode.jsonc` as often as `.json`, and a carried model that silently fell
 * back to OpenCode's default because the file had a comment would be a different model
 * than the one the user picked.
 */
export function stripJsonc(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (ch === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      i = close === -1 ? text.length : close + 2;
    } else {
      out += ch;
      i++;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The user's global OpenCode config directory, as OpenCode itself resolves it (xdg-basedir). */
export function opencodeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode");
}

/**
 * The model and provider settings from the user's global config, and nothing else from it.
 * Read in the order OpenCode merges them (config.json, opencode.json, opencode.jsonc), later
 * files winning per key. An unreadable file carries nothing rather than failing the call:
 * OpenCode then falls back to its own default model, which /handbook:doctor names.
 */
export function carriedUserConfig(configDir: string = opencodeConfigDir()): Record<string, unknown> {
  const carried: Record<string, unknown> = {};
  for (const name of ["config.json", "opencode.json", "opencode.jsonc"]) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripJsonc(readFileSync(join(configDir, name), "utf8")));
    } catch {
      continue;
    }
    if (!isPlainObject(parsed)) continue;
    for (const key of CARRIED_CONFIG_KEYS) {
      if (parsed[key] !== undefined) carried[key] = parsed[key];
    }
  }
  return carried;
}

/**
 * The engine names its models the way Claude Code does ("haiku", "sonnet"). OpenCode wants
 * `provider/model`, and which provider is the user's choice, not ours, so the translation is
 * config.json `opencode.models`. A name that already carries a provider passes through. An
 * unmapped alias sends no `-m` at all: the child then answers on the model the user's own
 * config names, which is a better guess than any provider this code could pick.
 */
export function opencodeModel(alias: string, home: string = handbookHome()): string {
  const section = readConfigFile(home).opencode;
  const models = isPlainObject(section) && isPlainObject(section.models) ? section.models : {};
  const mapped = models[alias];
  if (typeof mapped === "string" && mapped.includes("/")) return mapped;
  return alias.includes("/") ? alias : "";
}

/**
 * Provider credentials. OpenCode takes each provider's key from the environment names in its
 * models catalog, which is fetched at run time and not in the source, so the names cannot be
 * listed here one by one. `*_API_KEY` is the convention that catalog follows; the backend
 * families in child-env.ts cover the cloud providers that use more than one variable.
 */
const PROVIDER_KEY = /_API_KEY$/;

/**
 * The real data, cache and state directories pass through: auth.json (the credentials
 * `opencode auth login` stored) lives under data, and the provider SDKs OpenCode installs on
 * first use live under cache, so pointing either at a temp directory either loses the login
 * or reinstalls an SDK on every call. Neither holds code that runs at startup: plugins are
 * off, and tools are loaded from config directories only.
 */
const REAL_DIRS = ["XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"];

/**
 * The child's environment: the shared allowlist, provider keys, and the switches above.
 * Every OPENCODE_* name in the parent is dropped. The parent is usually an OpenCode session,
 * and its server password, client name and config overrides belong to the session whose
 * text is this call's untrusted input.
 */
export function opencodeChildEnv(
  scratch: string,
  config: Record<string, unknown>,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || name.startsWith("OPENCODE_")) continue;
    if (
      CHILD_ENV_EXACT.has(name) ||
      CHILD_ENV_PREFIXES.some((p) => name.startsWith(p)) ||
      PROVIDER_KEY.test(name) ||
      REAL_DIRS.includes(name)
    ) {
      env[name] = value;
    }
  }
  // A config directory of its own, so the global opencode.json, its plugins, its MCP
  // servers, its tools/ and its AGENTS.md are never read.
  env.XDG_CONFIG_HOME = join(scratch, "config");
  // `~/.opencode` is a config directory too (config/paths.ts walks up to Global.Path.home),
  // and so is `~/.claude/CLAUDE.md`. OPENCODE_TEST_HOME moves only OpenCode's idea of home;
  // HOME itself stays real, because ~/.aws and gcloud's credentials are found through it.
  // It is a test hook in OpenCode's source, so a release that drops it reopens this path:
  // /handbook:doctor checks the version it was read from.
  env.OPENCODE_TEST_HOME = join(scratch, "home");
  // The child's session goes to a database that is deleted with it. In the user's own
  // database it would appear in their session list, and a later harvest of OpenCode
  // sessions would read a scoring call as work.
  env.OPENCODE_DB = join(scratch, "child.db");
  Object.assign(env, CHILD_SWITCHES);
  env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ ...config, permission: DENY_ALL_TOOLS });
  return env;
}

export interface OpencodeInvocation {
  args: string[];
  /** the prompt, written to the child's stdin rather than carried in `args` */
  input: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** removes the scratch directory; call it once the process has exited */
  done: () => void;
}

/**
 * Everything about how the OpenCode child is launched, in ONE place, for the reason
 * `childInvocation` gives: the doctor has to certify the call the harvest makes, not one
 * assembled from pieces.
 *
 * The prompt goes to stdin. `opencode run` appends piped stdin to the argv message
 * (cli/cmd/run.ts), and argv is readable with `ps` and wraps any word holding a space in
 * quotes before sending it.
 */
export function opencodeInvocation(input: {
  prompt: string;
  model: string;
  home?: string;
  source?: NodeJS.ProcessEnv;
}): OpencodeInvocation {
  const scratch = mkdtempSync(join(tmpdir(), "teamhandbook-child-"));
  const cwd = join(scratch, "work");
  for (const dir of [cwd, join(scratch, "config"), join(scratch, "home")]) mkdirSync(dir);
  const source = input.source ?? process.env;
  const model = opencodeModel(input.model, input.home);
  // --pure as well as OPENCODE_PURE: the flag is what `opencode --help` documents, the
  // variable is what the loader reads, and either alone is one rename from being ignored.
  const args = ["run", "--pure", "--format", "json", "--dir", cwd];
  if (model) args.push("-m", model);
  return {
    args,
    input: input.prompt,
    env: opencodeChildEnv(scratch, carriedUserConfig(opencodeConfigDir(source)), source),
    cwd,
    done: () => rmSync(scratch, { recursive: true, force: true }),
  };
}

/**
 * The reply, from `--format json`: one event per line, and the model's words are the
 * `text` events. Everything else (step markers, a tool attempt the deny rule refused) is
 * not reply. A run that printed no text is an error, not an empty reply, so a caller that
 * fails closed on an unparseable answer is never handed "" as though the model said it.
 */
export function parseRunOutput(stdout: string): string {
  const texts: string[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isPlainObject(event)) continue;
    if (event.type === "error") {
      throw Object.assign(new Error("opencode reported an error"), { cli: "opencode", stderr: errorText(event) });
    }
    if (event.type !== "text" || !isPlainObject(event.part)) continue;
    if (event.part.synthetic === true) continue;
    if (typeof event.part.text === "string") texts.push(event.part.text);
  }
  const reply = texts.join("\n").trim();
  if (!reply) throw Object.assign(new Error("opencode returned no text"), { cli: "opencode", stderr: "opencode returned no text" });
  return reply;
}

function errorText(event: Record<string, unknown>): string {
  const error = event.error;
  if (typeof error === "string") return error.slice(0, 200);
  if (isPlainObject(error)) {
    const data = isPlainObject(error.data) ? error.data : {};
    const message = typeof data.message === "string" ? data.message : error.name;
    if (typeof message === "string") return message.slice(0, 200);
  }
  return "opencode reported an error";
}

export const runOpencodeCli: ClaudeRunner = async (prompt, model, timeoutMs) => {
  const invocation = opencodeInvocation({ prompt, model });
  const call = execFileAsync("opencode", invocation.args, {
    timeout: timeoutMs,
    // every event line repeats its whole part, so the stream is a few times the reply
    maxBuffer: 4 * 1024 * 1024,
    cwd: invocation.cwd,
    env: invocation.env,
  });
  const stdin = call.child.stdin;
  if (stdin) {
    // same reason as runClaudeCli: a child that never started has a destroyed pipe
    stdin.on("error", () => {});
    stdin.end(invocation.input);
  }
  try {
    const { stdout } = await call;
    return parseRunOutput(stdout);
  } catch (err) {
    // claudeErrorReason names the CLI from this tag, so a missing binary says "opencode"
    if (typeof err === "object" && err !== null) Object.assign(err, { cli: "opencode" });
    throw err;
  } finally {
    invocation.done();
  }
};
