import { isAbsolute } from "node:path";

export interface RawActionInputs {
  token?: string;
  source?: string;
  repository?: string;
  sourceRef?: string;
  homePage?: string;
  commitMessage?: string;
  committerName?: string;
  committerEmail?: string;
}

export interface ActionConfig {
  token: string;
  source: string;
  workspace: string;
  repository: string;
  sourceRef: string;
  serverUrl: string;
  temporaryDirectory: string;
  homePage: string;
  commitMessage: string;
  committerName: string;
  committerEmail: string;
}

export function parseActionConfig(
  inputs: RawActionInputs,
  env: NodeJS.ProcessEnv,
): ActionConfig {
  const token = required(inputs.token, "token");
  const workspace = required(env.GITHUB_WORKSPACE, "GITHUB_WORKSPACE");
  const repository = required(
    inputs.repository || env.GITHUB_REPOSITORY,
    "repository",
  );
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error("repository must use owner/name format");
  }
  const sourceRef = required(inputs.sourceRef || env.GITHUB_SHA, "source-ref");
  const serverUrl = required(
    env.GITHUB_SERVER_URL,
    "GITHUB_SERVER_URL",
  ).replace(/\/$/u, "");
  const temporaryDirectory = required(env.RUNNER_TEMP, "RUNNER_TEMP");
  const source = safeRelativePath(inputs.source || "openwiki", "source");
  const homePage = safeRelativePath(
    inputs.homePage || "quickstart.md",
    "home-page",
  );

  return {
    token,
    source,
    workspace,
    repository,
    sourceRef,
    serverUrl,
    temporaryDirectory,
    homePage,
    commitMessage:
      inputs.commitMessage?.trim() ||
      `docs: sync OpenWiki from ${sourceRef.slice(0, 7)}`,
    committerName: inputs.committerName?.trim() || "github-actions[bot]",
    committerEmail:
      inputs.committerEmail?.trim() ||
      "41898282+github-actions[bot]@users.noreply.github.com",
  };
}

function required(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function safeRelativePath(value: string, label: string): string {
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
  if (
    !normalized ||
    isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error(`${label} must be a repository-relative path`);
  }
  return normalized;
}
