import { readConfigFile } from "../config.js";
import { handbookHome } from "../session-state.js";

/**
 * The coding agent TeamHandbook is running under. Everything that differs between them
 * (which CLI answers a model call, how it is isolated, what its commands look like) is
 * decided from this one value, so a second host is a new branch here rather than a
 * condition scattered through the engine.
 */
export type HostName = "claude-code" | "opencode";

export const HOST_NAMES: readonly HostName[] = ["claude-code", "opencode"];

function isHostName(value: unknown): value is HostName {
  return typeof value === "string" && (HOST_NAMES as readonly string[]).includes(value);
}

/**
 * The environment wins over config.json because one machine can run both hosts: the
 * OpenCode command files set TEAMHANDBOOK_HOST on every call they make, while a Claude Code
 * session sets nothing and keeps the default. A single config value would send one of the
 * two to the wrong CLI. config.json `host` is for a machine that only has the other one.
 */
export function activeHost(
  env: NodeJS.ProcessEnv = process.env,
  home: string = handbookHome(),
): HostName {
  if (isHostName(env.TEAMHANDBOOK_HOST)) return env.TEAMHANDBOOK_HOST;
  const configured = readConfigFile(home).host;
  if (isHostName(configured)) return configured;
  return "claude-code";
}

/**
 * A host value that was set and is not one this version knows. activeHost falls back to
 * Claude Code for it, which is a guess; /handbook:doctor says so instead of letting the
 * guess pass silently.
 */
export function unknownHostSetting(
  env: NodeJS.ProcessEnv = process.env,
  home: string = handbookHome(),
): string | null {
  const fromEnv = env.TEAMHANDBOOK_HOST;
  if (fromEnv !== undefined && fromEnv !== "" && !isHostName(fromEnv)) {
    return `TEAMHANDBOOK_HOST=${fromEnv}`;
  }
  const configured = readConfigFile(home).host;
  if (configured !== undefined && !isHostName(configured)) {
    return `config.json host: ${JSON.stringify(configured)}`;
  }
  return null;
}

/** The binary a model call goes to, for messages that name it. */
export function hostCli(host: HostName = activeHost()): string {
  return host === "opencode" ? "opencode" : "claude";
}
