var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};

// src/lib/fs-atomic.ts
var init_fs_atomic = __esm({
  "src/lib/fs-atomic.ts"() {
    "use strict";
  }
});

// src/lib/session-state.ts
var EDIT_ATTACH_WINDOW_MS, SLEEPER, SESSION_MAX_AGE_MS, SESSION_ORPHAN_MS;
var init_session_state = __esm({
  "src/lib/session-state.ts"() {
    "use strict";
    init_fs_atomic();
    EDIT_ATTACH_WINDOW_MS = 15 * 60 * 1e3;
    SLEEPER = new Int32Array(new SharedArrayBuffer(4));
    SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1e3;
    SESSION_ORPHAN_MS = 3 * 60 * 60 * 1e3;
  }
});

// src/lib/secrets.ts
function isPlaceholderAssignment(match) {
  return PLACEHOLDER_VALUE.test(unquote(match.slice(match.search(/[=:]/) + 1).trim()));
}
function isSubstitute(value) {
  const bare = unquote(value);
  return /^[$<{]/.test(bare) || /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(bare) || isFilePath(bare);
}
function isFilePath(value) {
  if (!/^(?:\.{1,2}\/|~\/|\/)/.test(value)) return false;
  return value.lastIndexOf("/") > 0 || /\.[A-Za-z0-9]{1,8}$/.test(value);
}
function isWordsNotToken(match) {
  return !/[A-Z0-9+/=._~]/.test(match.replace(/^\s*bearer\s+/i, ""));
}
var PLACEHOLDER_VALUE, unquote, lastToken, SECRET_PATTERNS, GLOBAL_TWIN;
var init_secrets = __esm({
  "src/lib/secrets.ts"() {
    "use strict";
    PLACEHOLDER_VALUE = /^(?:[xX]+|changeme[0-9]{0,6}|placeholder[0-9]{0,6}|dummy[a-z-]{0,10}|your[-_][a-z-]{0,16}|example[a-z-]{0,10}|redacted)$/;
    unquote = (value) => value.replace(/^["']|["']$/g, "");
    lastToken = (match) => match.trim().split(/[\s=]+/).pop() ?? "";
    SECRET_PATTERNS = [
      // Covers PEM, armored PGP ("… BLOCK-----") and ssh.com/SSH2 ("---- BEGIN SSH2
      // ENCRYPTED PRIVATE KEY ----": four dashes with spaces).
      // Deliberately NOT the generic /-----BEGIN [A-Z ]+-----/: that swallows
      // -----BEGIN CERTIFICATE-----, which is public and routine in TLS work.
      { name: "private-key", re: /-{4,5}\s?BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?\s?-{4,5}/ },
      // PuTTY .ppk keys are not PEM-armored at all. The header used to be anchored to the start
      // of a line, which excluded the two shapes a session actually shows a key file in: a diff
      // prefixes every line with `+`, and `cat -n` prefixes it with a number and a tab. Dropping
      // the anchor without asking for the rest of the FORMAT made the header's name enough, so
      // prose that merely mentions it became a secret - including two lines of this repository's
      // own source, which cost a session working on TeamHandbook its own signal.
      {
        name: "putty-key",
        re: /PuTTY-User-Key-File-\d+:[ \t]*\S|Private-Lines:[ \t]*\d|Private-MAC:[ \t]*[0-9a-fA-F]{16}/
      },
      { name: "age-key", re: /\bAGE-SECRET-KEY-1[0-9A-Z]{50,}/ },
      // Before `aws-access-key`, which would otherwise claim any line carrying the id and hide
      // that the secret half travelled with it - the credentials CSV the console hands out puts
      // them in adjacent columns and spells the header with spaces, so no keyword sits next to
      // the value. The 40-character run has no shape of its own, so it counts only in the
      // company of an id AND only when it mixes case and digits the way base64 does; a
      // lowercase sha1 in a release log does not.
      {
        name: "aws-secret-near-access-key",
        re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b[\s\S]{0,300}?(?=[A-Za-z0-9+/]{40}(?![A-Za-z0-9+/]))(?=[A-Za-z0-9+/]*[a-z])(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*\d)[A-Za-z0-9+/]{40}/
      },
      { name: "aws-access-key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
      { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
      { name: "github-token", re: /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}\b/ },
      { name: "gitlab-token", re: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
      { name: "gitlab-deploy-token", re: /\bgldt-[A-Za-z0-9_-]{20,}\b/ },
      { name: "gitlab-runner-token", re: /\bglrt-[A-Za-z0-9_-]{20,}\b/ },
      { name: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
      { name: "slack-webhook", re: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]{20,}/ },
      { name: "stripe-key", re: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
      // Before `openai-key`: both open with `sk-`, and whichever runs first is the name the
      // redaction marker carries. Left second, an Anthropic key - the credential a Claude Code
      // plugin is likeliest to meet - reads in the log as an OpenAI key and its own rule never
      // fires, so nobody can tell from the marker whether it is covered at all.
      { name: "anthropic-api-key", re: /\bsk-ant-[a-z0-9]{3,}-[A-Za-z0-9_-]{20,}\b/ },
      // The digit is what separates an issued key from a hyphenated English phrase: every key
      // carries one and "sk-cross-validation-and-scaling" carries none.
      { name: "openai-key", re: /\bsk-(?:proj-)?(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}\b/ },
      { name: "google-api-key", re: /\bAIza[A-Za-z0-9_-]{30,}\b/ },
      { name: "npm-token", re: /\bnpm_[A-Za-z0-9]{30,}\b/ },
      // The body excludes `_`, so `hf_hub_download` - the library's own function name - is three
      // characters long to this rule rather than thirty.
      { name: "huggingface-token", re: /\bhf_[A-Za-z0-9]{30,}\b/ },
      { name: "digitalocean-token", re: /\bdop_v1_[a-f0-9]{60,}\b/ },
      // An issued token is base62 and mixes case with digits; a backup file named after the same
      // prefix is not - unless it is named in camel case with a year in it, which is why the
      // extension has to be excluded as well as the lowercase body. (The corpus carries both
      // filenames; neither is spelled out here, because a prefix followed by a contiguous run is
      // the shape this repository refuses to hold.)
      {
        name: "vault-token",
        re: /\bhvs\.(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{20,}(?!\.[A-Za-z0-9]{1,8})\b/
      },
      { name: "linear-api-key", re: /\blin_api_[A-Za-z0-9]{32,}\b/ },
      // A lookbehind rather than \b: the token's own home is inside a URL path (`/bot<id>:AA…`),
      // where the digits follow a letter and \b never matches between two word characters.
      { name: "telegram-bot-token", re: /(?<!\d)\d{8,10}:AA[A-Za-z0-9_-]{30,}\b/ },
      // Azure AD writes a fixed `8Q~` into a client secret, three characters in and thirty-four
      // from the end; the delimiters keep it from matching inside a longer run.
      {
        name: "azure-client-secret",
        re: /(?:^|[\s'"`>=:(,])[A-Za-z0-9_~.-]{3}8Q~[A-Za-z0-9_~.-]{34}(?:$|[\s'"`<),;])/
      },
      { name: "azure-storage-key", re: /\bAccountKey=[A-Za-z0-9+/]{40,}={0,2}/ },
      { name: "azure-sas-signature", re: /[?&]sig=[A-Za-z0-9%]{20,}/ },
      { name: "bearer-token", re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/i, reject: isWordsNotToken },
      { name: "basic-auth-header", re: /\bAuthorization\s*:\s*Basic\s+[A-Za-z0-9+/]{16,}=*/i },
      { name: "url-credentials", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]{3,}@/i },
      // common credential shapes the generic keyword rule misses
      { name: "db-password-env", re: /(?:\b|_)(?:PGPASSWORD|MYSQL_PWD|DB_PASS(?:WORD)?|POSTGRES_PASSWORD|REDIS_PASSWORD)\s*=\s*\S+/i },
      { name: "inline-basic-auth", re: /\bcurl\b[^\n]*\s-{1,2}(?:u|user)\s+[^\s:]+:[^\s]+/i },
      { name: "mysql-inline-password", re: /\bmysql\b[^\n]*\s-p\S+/i },
      // Fields whose NAME carries the shape. The value inside them is a bare blob nothing else
      // here could tell from a digest; the field is what makes it a credential, so the rule asks
      // for the field and lets the value be shapeless.
      // The host is what separates the file from a sentence. Asking only for the three words in
      // order made "Each machine needs login and password set before the first deploy" a
      // credential, which cost the prompt that carried it, the slice line that quoted it, and
      // the share of any skill whose documentation said it.
      //
      // The dot is a TRADE, not a definition: `machine localhost` and `machine gitlab` are
      // valid `.netrc` entries and this rule does not see them. It buys that miss because the
      // sentence shape is common and its cost is silent - a candidate dropped, a skill refused
      // with "secret" - while a single-label netrc host is a machine-local credential. The
      // corpus carries the missed shape so the trade stays visible rather than forgotten.
      {
        name: "netrc-credential",
        re: /\bmachine\s+\S*\.\S+\s+login\s+\S+\s+password\s+\S+/i,
        reject: (m) => isSubstitute(lastToken(m))
      },
      { name: "docker-auth-field", re: /["']auth["']\s*:\s*["'][A-Za-z0-9+/]{20,}={0,2}["']/ },
      { name: "kubeconfig-key-data", re: /\bclient-key-data:\s*[A-Za-z0-9+/]{40,}={0,2}/ },
      {
        name: "gcp-private-key-field",
        re: /["']private_key["']\s*:\s*["'][^"']{40,}["']/,
        reject: (m) => isSubstitute(m.slice(m.indexOf(":") + 1).trim())
      },
      {
        name: "aws-secret-key",
        re: /\baws[_-]?secret[_-]?access[_-]?key\s*[=:]\s*["']?[A-Za-z0-9+/]{30,}/i
      },
      // A credential handed to a CLI as a flag. `--token-file` and its kind are excluded by the
      // `[= ]`: a flag NAME that continues past the keyword is a different flag.
      {
        name: "cli-credential-flag",
        re: /\s--?(?:auth[_-]?token|api[_-]?key|access[_-]?token|registration[_-]?token|token|password|secret)[= ]\S{16,}/i,
        reject: (m) => isSubstitute(lastToken(m))
      },
      {
        // keyword may be preceded by a word boundary OR an underscore (AWS_SECRET_KEY=...),
        // which \b cannot match between two word chars.
        name: "assigned-secret",
        re: /(?:\b|_)(?:api[_-]?key|secret|token|passw(?:or)?d|access[_-]?key)["']?\s*[=:]\s*["']?[A-Za-z0-9+/_.-]{8,}/i,
        reject: isPlaceholderAssignment
      }
    ];
    GLOBAL_TWIN = new Map(
      SECRET_PATTERNS.filter((p) => p.reject).map((p) => [
        p.name,
        new RegExp(p.re.source, p.re.flags + "g")
      ])
    );
  }
});

// src/lib/config.ts
var init_config = __esm({
  "src/lib/config.ts"() {
    "use strict";
    init_session_state();
  }
});

// src/lib/identity.ts
var HOME_PATH;
var init_identity = __esm({
  "src/lib/identity.ts"() {
    "use strict";
    HOME_PATH = new RegExp(
      "(?:\\/(?:Users|home)\\/|[A-Za-z]:\\\\{1,2}(?:Users|home)\\\\{1,2})([A-Za-z0-9._-]{1,40})",
      "g"
    );
  }
});

// src/lib/prompt-safety.ts
var LINE_TERMINATOR_CLASS, LINE_TERMINATORS, LABEL_BREAKS;
var init_prompt_safety = __esm({
  "src/lib/prompt-safety.ts"() {
    "use strict";
    init_identity();
    LINE_TERMINATOR_CLASS = "\\n\\r\\u000B\\u000C\\u0085\\u2028\\u2029";
    LINE_TERMINATORS = new RegExp(`\\r\\n|[${LINE_TERMINATOR_CLASS}]`);
    LABEL_BREAKS = new RegExp(`[${LINE_TERMINATOR_CLASS}]+`, "g");
  }
});

// src/lib/skill-index.ts
var init_skill_index = __esm({
  "src/lib/skill-index.ts"() {
    "use strict";
    init_session_state();
  }
});

// src/lib/skill-files.ts
var init_skill_files = __esm({
  "src/lib/skill-files.ts"() {
    "use strict";
  }
});

// src/lib/queue.ts
var init_queue = __esm({
  "src/lib/queue.ts"() {
    "use strict";
    init_session_state();
    init_fs_atomic();
    init_skill_index();
    init_secrets();
    init_identity();
    init_skill_files();
  }
});

// src/lib/child-env.ts
var init_child_env = __esm({
  "src/lib/child-env.ts"() {
    "use strict";
  }
});

// src/lib/host/index.ts
var init_host = __esm({
  "src/lib/host/index.ts"() {
    "use strict";
    init_config();
    init_session_state();
  }
});

// src/lib/host/opencode.ts
import { execFile } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
function opencodeConfigDir(env = process.env) {
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode");
}
var execFileAsync;
var init_opencode = __esm({
  "src/lib/host/opencode.ts"() {
    "use strict";
    init_child_env();
    init_config();
    init_session_state();
    execFileAsync = promisify(execFile);
  }
});

// src/lib/score.ts
import { execFile as execFile2 } from "node:child_process";
import { promisify as promisify2 } from "node:util";
var execFileAsync2;
var init_score = __esm({
  "src/lib/score.ts"() {
    "use strict";
    init_session_state();
    init_config();
    init_prompt_safety();
    init_queue();
    init_child_env();
    init_host();
    init_opencode();
    execFileAsync2 = promisify2(execFile2);
  }
});

// src/lib/skill-format.ts
function ci(source) {
  return new RegExp(source, "iu");
}
var WORD_CHAR, SPACE, WB2, XML_RE, TRIGGER_RE, ABBREV_RE, SENTENCE_SPLIT_RE, HEAD_RE, FENCE_RE, NUM_HEAD_RE, NUM_ITEM_RE, LIST_ITEM_RE, TABLE_ROW_RE, TABLE_SEP_RE, VERIFY_HEAD_RE, DELIVERY_HEAD_RE, COMMAND_RE, PITFALL_HEAD_RE, ABS_PATH_RE, EMAIL_RE, PATH_TOKEN_RE, PATH_TOKEN_ALL_RE, HEAD_NUMBER_RE, NOT_VISIBLE_HEAD_RE, OPEN_QUESTION_RE, EXEMPT_EXACT_RE;
var init_skill_format = __esm({
  "src/lib/skill-format.ts"() {
    "use strict";
    WORD_CHAR = "\\p{L}\\p{N}_";
    SPACE = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
    WB2 = `(?:(?<=[${WORD_CHAR}])(?![${WORD_CHAR}])|(?<![${WORD_CHAR}])(?=[${WORD_CHAR}]))`;
    XML_RE = new RegExp(`<[${SPACE}]*/?[${SPACE}]*[A-Za-z][${WORD_CHAR}-]*([${SPACE}][^<>]*)?>`, "u");
    TRIGGER_RE = ci(
      `${WB2}(use when|use whenever|use this when|use for|also when|also use when|should be used when|when the user|triggers?[${SPACE}]*:)`
    );
    ABBREV_RE = new RegExp(`${WB2}(e\\.g|i\\.e|etc|vs|cf)\\.`, "giu");
    SENTENCE_SPLIT_RE = new RegExp(`(?<=[.!?])[${SPACE}]+`, "u");
    HEAD_RE = new RegExp(`^(#{1,6})[${SPACE}]+(.*)$`, "u");
    FENCE_RE = new RegExp(`^[${SPACE}]*(\`\`\`|~~~)`, "u");
    NUM_HEAD_RE = ci(`^[${SPACE}]*(\\p{Nd}+[.)]|step[${SPACE}]+\\p{Nd}+|phase[${SPACE}]+\\p{Nd}+)`);
    NUM_ITEM_RE = new RegExp(`^[${SPACE}]*\\p{Nd}+[.)][${SPACE}]+[^${SPACE}]`, "u");
    LIST_ITEM_RE = new RegExp(`^[${SPACE}]*([-*+]|\\p{Nd}+[.)])[${SPACE}]+[^${SPACE}]`, "u");
    TABLE_ROW_RE = new RegExp(`^[${SPACE}]*\\|.*\\|[${SPACE}]*$`, "u");
    TABLE_SEP_RE = new RegExp(
      `^[${SPACE}]*\\|?[${SPACE}]*:?-{3,}:?[${SPACE}]*(\\|[${SPACE}]*:?-{3,}:?[${SPACE}]*)*\\|?[${SPACE}]*$`,
      "u"
    );
    VERIFY_HEAD_RE = ci(`verif|validat|checklist|${WB2}test`);
    DELIVERY_HEAD_RE = ci(`deliver|hand-?off|${WB2}done${WB2}|finish`);
    COMMAND_RE = ci(
      "```|`[^`\\n]*" + WB2 + "(run|gradlew|npm|npx|pytest|make|git|python3?|node|mvn|go|cargo|bash|\\./)[^`\\n]*`"
    );
    PITFALL_HEAD_RE = ci(
      "pitfall|mistake|gotcha|common (errors|failures|problems)|anti-?pattern|red flags"
    );
    ABS_PATH_RE = new RegExp(`(/(?:Users|home)/[^/${SPACE}]+|[A-Za-z]:\\\\Users\\\\)`, "u");
    EMAIL_RE = new RegExp(`[${WORD_CHAR}.+-]+@[${WORD_CHAR}-]+\\.[A-Za-z]{2,}`, "u");
    PATH_TOKEN_RE = /[^\s`|()]*(?:[/*]|\.[A-Za-z][A-Za-z0-9]{0,9})[^\s`|()]*/;
    PATH_TOKEN_ALL_RE = new RegExp(PATH_TOKEN_RE.source, "g");
    HEAD_NUMBER_RE = new RegExp(`^[${SPACE}]*(?:step[${SPACE}]+|phase[${SPACE}]+)?(\\p{Nd}+)`, "iu");
    NOT_VISIBLE_HEAD_RE = ci("not visible in history|not visible in the history");
    OPEN_QUESTION_RE = ci(
      "\\?|not (recorded|measured|visible|captured|in the evidence|known)|no commit|nothing (in the )?(history|evidence)|does not (say|record|show)|unknown|unclear|is not stated"
    );
    EXEMPT_EXACT_RE = ci(
      "^(file map|files? touched|verification|verify|validation|checklist|tests?|delivery|deliver|hand-?off|finish(ed)?|done|common mistakes|mistakes|pitfalls?|gotchas?|anti-?patterns?|red flags|not visible in( the)? history)$"
    );
  }
});

// src/cli/opencode-install.ts
import { resolve as resolve2 } from "node:path";

// src/lib/status.ts
init_session_state();
import { readFileSync } from "node:fs";
import { basename, dirname, join as join2, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// src/lib/signals.ts
init_session_state();
init_secrets();

// src/lib/counters.ts
init_session_state();
init_fs_atomic();

// src/lib/usage.ts
init_fs_atomic();

// src/lib/distill.ts
init_session_state();
init_config();
init_score();
init_skill_index();
init_prompt_safety();
init_secrets();
function openingsOf(literal) {
  return [...literal].reduceRight((rest, ch) => `(?:${ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${rest})?`, "");
}
var CUT_SCOPE_SENTENCE = new RegExp(
  `\\s*Applies ONLY in the(?: \\S*${openingsOf(" repository - do not use it elsewhere.")})?$`
);

// src/lib/branch.ts
init_identity();
init_secrets();

// src/lib/init.ts
init_session_state();
init_config();
init_fs_atomic();

// src/lib/display-path.ts
import { homedir as homedir2 } from "node:os";
import { sep } from "node:path";
function displayPath(path, userHome = homedir2()) {
  if (typeof path !== "string") return String(path);
  if (!userHome) return path;
  if (path === userHome) return "~";
  if (path.startsWith(userHome + sep)) return `~${path.slice(userHome.length)}`;
  return path;
}

// src/lib/init.ts
init_secrets();
var CONSUMER_NOTICE_HOOKS = JSON.stringify(
  {
    hooks: {
      SessionStart: [
        { hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/notice.mjs"' }] }
      ]
    }
  },
  null,
  2
);

// src/lib/usage.ts
init_queue();
init_session_state();

// src/lib/session-workflow.ts
init_config();
init_identity();
init_secrets();
init_fs_atomic();
init_session_state();

// src/lib/mine.ts
init_secrets();

// src/lib/git-log.ts
var MAX_OUTPUT_BYTES = 1 << 28;
var MAX_BLOB_BYTES = 1 << 20;

// src/lib/usage.ts
init_skill_index();

// src/lib/status.ts
init_queue();

// src/lib/notify.ts
init_fs_atomic();
init_session_state();
init_config();
init_queue();

// src/lib/harvest.ts
init_session_state();
init_config();
init_prompt_safety();
init_secrets();
init_identity();
init_score();

// src/lib/teachings.ts
init_fs_atomic();
init_session_state();

// src/lib/harvest.ts
init_skill_index();
init_queue();

// src/lib/transcript.ts
init_secrets();
init_prompt_safety();
var PER_USER_CAP = 1e3;
var USER_HEAD = 700;
var USER_TAIL = PER_USER_CAP - USER_HEAD;
var ROLE_LABEL = new RegExp(`(^|[${LINE_TERMINATOR_CLASS}])(User|Assistant)(\\s*:)`, "gi");
var WRAPPED_LINE_MIN = 24;
var BLOB_LINE = new RegExp(`^[A-Za-z0-9+/]{${WRAPPED_LINE_MIN},}={0,2}$`);

// src/lib/harvest.ts
init_skill_index();

// src/lib/review-list.ts
init_queue();
init_session_state();

// src/lib/notify.ts
init_skill_index();
var DIGEST_INTERVAL_MS = 7 * 24 * 60 * 60 * 1e3;

// src/lib/status.ts
init_score();

// src/lib/pipeline.ts
init_fs_atomic();
init_session_state();
init_secrets();

// src/lib/gate.ts
init_session_state();
init_secrets();

// src/lib/pipeline.ts
init_score();
init_skill_index();
init_queue();
var STALE_CLAIM_MS = 10 * 60 * 1e3;
var LOG_ROTATE_BYTES = 512 * 1024;
var MARKER_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1e3;

// src/lib/draft.ts
init_identity();
init_prompt_safety();
init_secrets();
var WORD = "\\p{L}\\p{N}_";
var WB = `(?:(?<=[${WORD}])(?![${WORD}])|(?<![${WORD}])(?=[${WORD}]))`;

// src/lib/skill-health.ts
init_queue();
init_session_state();
init_skill_format();
init_skill_index();
var FILLER = new Set(
  "a about after again all also an and any are as at be been before being both but by can could did do does doing done each either for from had has have having how if in into is it its itself just may might more most must no nor not now of off on once one only or other our out over own same should so some such than that the their them then there these they this those through to too under until up upon very was we were what when whenever where whether which while who whom why will with within without would you your yours use used uses using also trigger triggers skill skills request requests asks asked something someone thing things way e g eg etc via new instead like want wants need needs make makes made get gets".split(" ")
);

// src/lib/status.ts
function pluginRoot() {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const up of ["..", "../.."]) {
    try {
      const parsed = JSON.parse(readFileSync(join2(here, up, ".claude-plugin", "plugin.json"), "utf8"));
      if (typeof parsed?.version === "string") return join2(here, up);
    } catch {
    }
  }
  return null;
}

// src/lib/host/opencode-commands.ts
init_opencode();
import { existsSync, mkdirSync, readFileSync as readFileSync2, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join as join3 } from "node:path";
var OPENCODE_COMMANDS = ["mine", "review", "status", "doctor", "demo"];
var GENERATED_MARK = "<!-- generated by TeamHandbook for OpenCode: edits are replaced on reinstall -->";
var OPENCODE_COMMAND_DIR = "handbook";
function toOpencodeCommand(source, pluginRoot2) {
  if (/[`"$\\\n]/.test(pluginRoot2)) {
    throw new Error(`plugin path ${JSON.stringify(pluginRoot2)} holds a character a shell line cannot quote safely`);
  }
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source.replace(/\r\n?/g, "\n"));
  if (!match) throw new Error("command file has no frontmatter");
  const description = /^description:\s*(.*)$/m.exec(match[1])?.[1]?.trim().replaceAll("/handbook:", `/${OPENCODE_COMMAND_DIR}/`);
  if (!description) throw new Error("command file has no description");
  let body = match[2];
  if (body.includes("!`")) throw new Error("command body holds !` which OpenCode would run as a shell command");
  if (/\$\d/.test(body)) throw new Error("command body holds $<digit> which OpenCode would replace with an argument");
  body = body.replaceAll('node "${CLAUDE_PLUGIN_ROOT}/', `TEAMHANDBOOK_HOST=opencode node "${pluginRoot2}/`);
  body = body.replaceAll("${CLAUDE_PLUGIN_ROOT}", pluginRoot2);
  body = body.replaceAll("AskUserQuestion", "`question` tool");
  body = body.replaceAll("/handbook:", `/${OPENCODE_COMMAND_DIR}/`);
  body = body.replaceAll("the user's own `claude` CLI", "the user's own `opencode` CLI");
  return `---
description: ${description}
---
${GENERATED_MARK}
${COMMAND_NAME_NOTE}
${body}`;
}
var COMMAND_NAME_NOTE = `TeamHandbook's output names its commands as /handbook:<name>; in OpenCode the same command is /${OPENCODE_COMMAND_DIR}/<name>, so relay that form.
`;
function opencodeCommandsDir(target = {}) {
  const base = target.project ? join3(target.project, ".opencode") : opencodeConfigDir(target.env);
  return join3(base, "commands", OPENCODE_COMMAND_DIR);
}
function ownedByUs(file) {
  try {
    return readFileSync2(file, "utf8").split("\n").includes(GENERATED_MARK);
  } catch {
    return false;
  }
}
function installOpencodeCommands(pluginRoot2, dir) {
  const converted = OPENCODE_COMMANDS.map((name) => ({
    name,
    text: toOpencodeCommand(readFileSync2(join3(pluginRoot2, "commands", `${name}.md`), "utf8"), pluginRoot2)
  }));
  mkdirSync(dir, { recursive: true });
  const result = { dir, written: [], skipped: [] };
  for (const { name, text } of converted) {
    const file = join3(dir, `${name}.md`);
    if (existsSync(file) && !ownedByUs(file)) {
      result.skipped.push(`${name}.md`);
      continue;
    }
    writeFileSync(file, text);
    result.written.push(`${name}.md`);
  }
  return result;
}
function removeOpencodeCommands(dir) {
  if (!existsSync(dir)) return [];
  const removed = [];
  for (const name of readdirSync(dir)) {
    const file = join3(dir, name);
    if (name.endsWith(".md") && ownedByUs(file)) {
      rmSync(file);
      removed.push(name);
    }
  }
  if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true });
  return removed;
}

// src/cli/opencode-install.ts
var USAGE = "usage: node dist/opencode-install.js [--project <path>] [--remove]";
function main(argv) {
  let project;
  let remove = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--remove") remove = true;
    else if (arg === "--project" && argv[i + 1]) project = resolve2(argv[++i]);
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
      removed.length ? `Removed ${removed.length} TeamHandbook command(s) from ${displayPath(dir)}.` : `No TeamHandbook commands found in ${displayPath(dir)}.`
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
    console.log(
      `
These files carry this machine's path to TeamHandbook: keep ${displayPath(dir)} out of the project's commits.`
    );
  }
  console.log(
    `
The commands call this checkout's dist/, so keep it where it is; rerun this after moving or updating it.
Drafting calls \`opencode run\`: map the models it asks for in ~/.teamhandbook/config.json under
opencode.models (for example {"sonnet": "anthropic/claude-sonnet-5-5"}), or it uses your OpenCode default.
Run /${OPENCODE_COMMAND_DIR}/doctor in OpenCode to check the setup.`
  );
}
main(process.argv.slice(2));
