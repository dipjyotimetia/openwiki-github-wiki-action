import { spawn } from "node:child_process";
import { cp, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { join } from "node:path";

export interface PublishWikiOptions {
  wikiGitUrl: string;
  contentDir: string;
  token: string;
  commitMessage: string;
  committerName: string;
  committerEmail: string;
  temporaryDirectory: string;
  /** Test seam for simulating a concurrent remote update immediately before push. */
  beforePush?: (cloneDirectory: string) => Promise<void>;
}

export interface PublishWikiResult {
  changed: boolean;
  commitSha: string;
}

export async function publishWiki(
  options: PublishWikiOptions,
): Promise<PublishWikiResult> {
  const contentDir = await realpath(options.contentDir);
  const worktree = await mkdtemp(
    join(options.temporaryDirectory, "openwiki-wiki-"),
  );
  const cloneDir = join(worktree, "repository");
  const auth = createGitAuthEnvironment(options.wikiGitUrl, options.token);

  try {
    await runGit(
      ["clone", "--quiet", options.wikiGitUrl, cloneDir],
      worktree,
      auth,
    );
    const branch = await runGit(["branch", "--show-current"], cloneDir, auth);
    if (!branch.stdout) {
      throw new Error(
        "The GitHub Wiki has no default branch. Create its first page in the GitHub UI, then rerun publication.",
      );
    }

    for (const entry of await readdir(cloneDir)) {
      if (entry !== ".git")
        await rm(join(cloneDir, entry), { recursive: true, force: true });
    }
    await cp(contentDir, cloneDir, { recursive: true });

    await runGit(["add", "-A"], cloneDir, auth);
    await options.beforePush?.(cloneDir);
    await assertRemoteUnchanged(cloneDir, branch.stdout, auth);
    const diff = await runGit(
      ["diff", "--cached", "--quiet"],
      cloneDir,
      auth,
      [0, 1],
    );
    if (diff.code === 0) return { changed: false, commitSha: "" };

    await runGit(
      ["config", "user.name", options.committerName],
      cloneDir,
      auth,
    );
    await runGit(
      ["config", "user.email", options.committerEmail],
      cloneDir,
      auth,
    );
    await runGit(
      ["commit", "--quiet", "-m", options.commitMessage],
      cloneDir,
      auth,
    );
    const commit = await runGit(["rev-parse", "HEAD"], cloneDir, auth);
    try {
      await runGit(
        ["push", "--quiet", "origin", `HEAD:${branch.stdout}`],
        cloneDir,
        auth,
      );
    } catch (error) {
      throw new Error(
        `Unable to publish the GitHub Wiki without rewriting history. Rerun after resolving concurrent Wiki changes. ${errorMessage(error)}`,
      );
    }
    return { changed: true, commitSha: commit.stdout };
  } finally {
    await rm(worktree, { recursive: true, force: true });
  }
}

async function assertRemoteUnchanged(
  cloneDir: string,
  branch: string,
  auth: NodeJS.ProcessEnv,
): Promise<void> {
  const local = await runGit(["rev-parse", "HEAD"], cloneDir, auth);
  const remote = await runGit(
    ["ls-remote", "--heads", "origin", `refs/heads/${branch}`],
    cloneDir,
    auth,
  );
  const remoteSha = remote.stdout.split(/\s+/u)[0];
  if (remoteSha !== local.stdout) {
    throw new Error(
      "Unable to publish the GitHub Wiki without rewriting history. The Wiki changed after checkout; rerun publication.",
    );
  }
}

interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runGit(
  args: string[],
  cwd: string,
  auth: NodeJS.ProcessEnv,
  acceptedExitCodes: number[] = [0],
): Promise<GitResult> {
  const result = await new Promise<GitResult>((resolvePromise, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: { ...process.env, ...auth, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) =>
      resolvePromise({
        code: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      }),
    );
  });
  if (!acceptedExitCodes.includes(result.code)) {
    throw new Error(
      `git ${args[0] ?? "command"} failed: ${result.stderr || result.stdout}`,
    );
  }
  return result;
}

export function createGitAuthEnvironment(
  wikiGitUrl: string,
  token: string,
): NodeJS.ProcessEnv {
  if (!wikiGitUrl.startsWith("https://")) return {};
  const credential = Buffer.from(`x-access-token:${token}`, "utf8").toString(
    "base64",
  );
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${credential}`,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
