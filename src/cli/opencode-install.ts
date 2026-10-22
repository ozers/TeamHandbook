import { resolve } from "node:path";
import { pluginRoot } from "../lib/status.js";
import { displayPath } from "../lib/display-path.js";
import {
  OPENCODE_COMMANDS,
  OPENCODE_COMMAND_DIR,
  installOpencodeCommands,
  opencodeCommandsDir,
  removeOpencodeCommands,
} from "../lib/host/opencode-commands.js";

const USAGE = "usage: node dist/opencode-install.js [--project <path>] [--remove]";

function main(argv: string[]): void {
  let project: string | undefined;
  let remove = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--remove") remove = true;
    else if (arg === "--project" && argv[i + 1]) project = resolve(argv[++i]!);
    else {
      console.error(USAGE);
      process.exitCode = 2;
      return;
    }
  }
  const dir = opencodeCommandsDir(project ? { project } : {});
  if (remove) {
    const removed = removeOpencodeCommands(dir);
    console.log(
      removed.length
        ? `Removed ${removed.length} TeamHandbook command(s) from ${displayPath(dir)}.`
        : `No TeamHandbook commands found in ${displayPath(dir)}.`,
    );
    return;
  }
  const root = pluginRoot();
  if (!root) {
    console.error("error: cannot find this TeamHandbook checkout (no .claude-plugin/plugin.json above dist/).");
    process.exitCode = 1;
    return;
  }
  const result = installOpencodeCommands(root, dir);
  console.log(`Installed ${result.written.length} TeamHandbook command(s) for OpenCode in ${displayPath(dir)}:`);
  for (const name of OPENCODE_COMMANDS) {
    if (result.written.includes(`${name}.md`)) console.log(`  /${OPENCODE_COMMAND_DIR}/${name}`);
  }
  for (const name of result.skipped) {
    console.log(`  skipped ${name}: a file of that name is already there and TeamHandbook did not write it`);
  }
  if (project) {
    // the files name this checkout by its absolute path, which means nothing on a teammate's machine
    console.log(
      `\nThese files carry this machine's path to TeamHandbook: keep ${displayPath(dir)} out of the project's commits.`,
    );
  }
  console.log(
    "\nThe commands call this checkout's dist/, so keep it where it is; rerun this after moving or updating it.\n" +
      "Drafting calls `opencode run`: map the models it asks for in ~/.teamhandbook/config.json under\n" +
      'opencode.models (for example {"sonnet": "anthropic/claude-sonnet-5-5"}), or it uses your OpenCode default.\n' +
      `Run /${OPENCODE_COMMAND_DIR}/doctor in OpenCode to check the setup.`,
  );
}

main(process.argv.slice(2));
