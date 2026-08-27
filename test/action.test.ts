import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { parseActionConfig } from "../src/config.js";

describe("public action contract", () => {
  test("declares the stable Node 24 inputs and outputs", async () => {
    const metadata = await readFile(join(process.cwd(), "action.yml"), "utf8");
    for (const input of [
      "token",
      "source",
      "repository",
      "source-ref",
      "home-page",
      "commit-message",
      "committer-name",
      "committer-email",
    ]) {
      expect(metadata).toContain(`  ${input}:`);
    }
    for (const output of ["changed", "commit-sha", "wiki-url"]) {
      expect(metadata).toContain(`  ${output}:`);
    }
    expect(metadata).toContain("using: node24");
    expect(metadata).toContain("main: dist/index.js");
  });

  test("pins third-party actions in CI", async () => {
    const workflow = await readFile(
      join(process.cwd(), ".github/workflows/ci.yml"),
      "utf8",
    );
    expect(workflow).not.toMatch(/uses: [^\s]+@v\d/u);
  });

  test("applies conservative defaults from the GitHub runtime", () => {
    expect(
      parseActionConfig(
        { token: "secret-token" },
        {
          GITHUB_WORKSPACE: "/workspace",
          GITHUB_REPOSITORY: "owner/project",
          GITHUB_SHA: "0123456789abcdef",
          GITHUB_SERVER_URL: "https://github.example",
          RUNNER_TEMP: "/runner-temp",
        },
      ),
    ).toEqual({
      token: "secret-token",
      source: "openwiki",
      workspace: "/workspace",
      repository: "owner/project",
      sourceRef: "0123456789abcdef",
      serverUrl: "https://github.example",
      temporaryDirectory: "/runner-temp",
      homePage: "quickstart.md",
      commitMessage: "docs: sync OpenWiki from 0123456",
      committerName: "github-actions[bot]",
      committerEmail: "41898282+github-actions[bot]@users.noreply.github.com",
    });
  });

  test("rejects missing credentials and unsafe source paths", () => {
    const env = {
      GITHUB_WORKSPACE: "/workspace",
      GITHUB_REPOSITORY: "owner/project",
      GITHUB_SHA: "0123456789abcdef",
      GITHUB_SERVER_URL: "https://github.com",
      RUNNER_TEMP: "/runner-temp",
    };
    expect(() => parseActionConfig({}, env)).toThrow(/token is required/u);
    expect(() =>
      parseActionConfig({ token: "secret", source: "../outside" }, env),
    ).toThrow(/source must be a repository-relative path/u);
  });
});
