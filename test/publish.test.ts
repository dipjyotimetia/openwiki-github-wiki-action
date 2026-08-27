import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { publishWiki } from "../src/publish.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function wikiRemote(): Promise<{ root: string; remote: string }> {
  const root = await mkdtemp(join(tmpdir(), "openwiki-publish-git-"));
  const remote = join(root, "wiki.git");
  const seed = join(root, "seed");
  await mkdir(seed);
  git(root, "init", "--bare", "--initial-branch=main", remote);
  git(root, "clone", remote, seed);
  git(seed, "config", "user.name", "Fixture");
  git(seed, "config", "user.email", "fixture@example.com");
  await writeFile(join(seed, "Home.md"), "# Bootstrap\n");
  await writeFile(join(seed, "Manual.md"), "# Remove me\n");
  git(seed, "add", ".");
  git(seed, "commit", "-m", "seed wiki");
  git(seed, "push", "origin", "main");
  return { root, remote };
}

describe("publishWiki", () => {
  test("replaces the generated Wiki and becomes a no-op when repeated", async () => {
    const { root, remote } = await wikiRemote();
    const contentDir = join(root, "content");
    await mkdir(contentDir);
    await writeFile(join(contentDir, "Home.md"), "# Generated Home\n");
    await writeFile(join(contentDir, "_Sidebar.md"), "# Pages\n");

    const first = await publishWiki({
      wikiGitUrl: remote,
      contentDir,
      token: "masked-token",
      commitMessage: "docs: sync OpenWiki",
      committerName: "OpenWiki Publisher",
      committerEmail: "publisher@example.com",
      temporaryDirectory: root,
    });
    const second = await publishWiki({
      wikiGitUrl: remote,
      contentDir,
      token: "masked-token",
      commitMessage: "docs: sync OpenWiki",
      committerName: "OpenWiki Publisher",
      committerEmail: "publisher@example.com",
      temporaryDirectory: root,
    });

    const checkout = join(root, "verify");
    git(root, "clone", remote, checkout);
    expect(first.changed).toBe(true);
    expect(first.commitSha).toMatch(/^[0-9a-f]{40}$/u);
    expect(second).toEqual({ changed: false, commitSha: "" });
    expect(await readFile(join(checkout, "Home.md"), "utf8")).toBe(
      "# Generated Home\n",
    );
    await expect(
      readFile(join(checkout, "Manual.md"), "utf8"),
    ).rejects.toThrow();
  });

  test("does not include the token in a failed clone error", async () => {
    const root = await mkdtemp(join(tmpdir(), "openwiki-publish-fail-"));
    const contentDir = join(root, "content");
    await mkdir(contentDir);
    await writeFile(join(contentDir, "Home.md"), "# Home\n");

    await expect(
      publishWiki({
        wikiGitUrl: join(root, "missing.git"),
        contentDir,
        token: "super-secret-token",
        commitMessage: "docs: sync OpenWiki",
        committerName: "OpenWiki Publisher",
        committerEmail: "publisher@example.com",
        temporaryDirectory: root,
      }),
    ).rejects.not.toThrow(/super-secret-token/u);
  });

  test("fails instead of force-pushing over a concurrent Wiki update", async () => {
    const { root, remote } = await wikiRemote();
    const contentDir = join(root, "content");
    await mkdir(contentDir);
    await writeFile(join(contentDir, "Home.md"), "# Generated Home\n");

    await expect(
      publishWiki({
        wikiGitUrl: remote,
        contentDir,
        token: "masked-token",
        commitMessage: "docs: sync OpenWiki",
        committerName: "OpenWiki Publisher",
        committerEmail: "publisher@example.com",
        temporaryDirectory: root,
        beforePush: async () => {
          const rival = join(root, "rival");
          git(root, "clone", remote, rival);
          git(rival, "config", "user.name", "Rival");
          git(rival, "config", "user.email", "rival@example.com");
          await writeFile(join(rival, "Concurrent.md"), "# Concurrent\n");
          git(rival, "add", ".");
          git(rival, "commit", "-m", "concurrent update");
          git(rival, "push", "origin", "main");
        },
      }),
    ).rejects.toThrow(/without rewriting history/u);

    const verify = join(root, "concurrent-verify");
    git(root, "clone", remote, verify);
    expect(await readFile(join(verify, "Concurrent.md"), "utf8")).toBe(
      "# Concurrent\n",
    );
  });
});
