// Shared by every host's model call (score.ts for `claude -p`, host/opencode.ts for
// `opencode run`): the names below are about reaching a model at all, not about which CLI
// does it, and two copies of them is how one host would quietly lose a backend the other kept.
//
// What the child is allowed to inherit, and nothing else. A payload that asks the model to
// list its environment can then only find what is on this list.
//
// The first version of this list was written from memory and was too narrow: it carried
// ANTHROPIC_* but none of the cloud-backend families, so on a machine that authenticates
// through Bedrock the harvest died with "Unable to locate credentials" while
// /handbook:doctor - which was still passing the FULL environment - reported the CLI as
// authenticated. Isolating the call and then certifying it through a different environment
// is worse than not isolating it: the report says the path works when it does not.
//
// Grouped by the reason each name is here, because that reason is the only thing that
// justifies adding the next one.
export const CHILD_ENV_EXACT = new Set([
  // where the CLI, node and its config live
  "PATH", "HOME", "USER", "SHELL", "TMPDIR", "LANG", "TZ",
  // the Windows spelling of the same things
  "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SystemRoot", "SystemDrive", "COMSPEC", "PATHEXT",
  // Windows spells the temp directory with these, not TMPDIR
  "TEMP", "TMP",
  // how it reaches the network at all, on a machine behind a proxy
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
  "http_proxy", "https_proxy", "all_proxy", "no_proxy",
  // how it trusts that network, where TLS is intercepted by a corporate CA
  "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS", "REQUESTS_CA_BUNDLE",
  // which region a Vertex deployment answers on
  "CLOUD_ML_REGION",
  // which handbook home this call belongs to
  "TEAMHANDBOOK_HOME",
]);

// Whole families that exist to carry the credentials and endpoints of ONE auth backend.
// These do hold secrets, deliberately: the child cannot authenticate without them, and it
// has no tool with which to send them anywhere.
// CLOUDSDK_* is here because gcloud's own credential overrides live outside GOOGLE_*:
// measured in the installed binary as CLOUDSDK_AUTH_ACCESS_TOKEN,
// CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE, CLOUDSDK_CORE_CUSTOM_CA_CERTS_FILE and others.
export const CHILD_ENV_PREFIXES = [
  "LC_", "ANTHROPIC_", "AWS_", "GOOGLE_", "GCLOUD_", "CLOUDSDK_", "AZURE_",
];
