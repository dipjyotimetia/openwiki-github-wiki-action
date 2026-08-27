import * as core from "@actions/core";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

import { parseActionConfig } from "./config.js";
import { publishWiki } from "./publish.js";
import { buildWiki } from "./transform.js";

export async function run(): Promise<void> {
  const token = core.getInput("token");
  if (token) core.setSecret(token);

  const config = parseActionConfig(
    {
      token,
      source: core.getInput("source"),
      repository: core.getInput("repository"),
      sourceRef: core.getInput("source-ref"),
      homePage: core.getInput("home-page"),
      commitMessage: core.getInput("commit-message"),
      committerName: core.getInput("committer-name"),
      committerEmail: core.getInput("committer-email"),
    },
    process.env,
  );

  const stagingRoot = await mkdtemp(
    join(config.temporaryDirectory, "openwiki-content-"),
  );
  const contentDir = join(stagingRoot, "wiki");
  const wikiUrl = `${config.serverUrl}/${config.repository}/wiki`;
  const wikiGitUrl = `${config.serverUrl}/${config.repository}.wiki.git`;

  try {
    const transformed = await buildWiki({
      sourceDir: join(config.workspace, config.source),
      outputDir: contentDir,
      workspaceDir: config.workspace,
      repository: config.repository,
      sourceRef: config.sourceRef,
      serverUrl: config.serverUrl,
      homePage: config.homePage,
    });
    core.info(
      `Prepared ${transformed.pages.length} OpenWiki pages for publication.`,
    );

    const published = await publishWiki({
      wikiGitUrl,
      contentDir,
      token: config.token,
      commitMessage: config.commitMessage,
      committerName: config.committerName,
      committerEmail: config.committerEmail,
      temporaryDirectory: config.temporaryDirectory,
    });
    core.setOutput("changed", published.changed ? "true" : "false");
    core.setOutput("commit-sha", published.commitSha);
    core.setOutput("wiki-url", wikiUrl);
    core.info(
      published.changed
        ? `Published OpenWiki to ${wikiUrl} at ${published.commitSha}.`
        : `GitHub Wiki is already current: ${wikiUrl}`,
    );
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

if (process.env.NODE_ENV !== "test") {
  run().catch((error: unknown) => {
    core.setFailed(error instanceof Error ? error.message : String(error));
  });
}
