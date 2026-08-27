import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { buildWiki } from "../src/transform.js";

async function fixture(): Promise<{
  root: string;
  source: string;
  output: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "openwiki-publisher-"));
  const source = join(root, "openwiki");
  const output = join(root, "published");
  await mkdir(join(source, "architecture"), { recursive: true });
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, "docs", "security.md"), "# Security\n");
  return { root, source, output };
}

describe("buildWiki", () => {
  test("publishes a flattened, linked GitHub Wiki with Home and sidebar pages", async () => {
    const { root, source, output } = await fixture();
    await writeFile(
      join(source, "quickstart.md"),
      [
        "---",
        "type: Reference",
        "title: Quickstart",
        "---",
        "",
        "# Project Quickstart",
        "",
        "See [architecture](architecture/), [overview][overview], and [security](../docs/security.md).",
        "",
        "[overview]: architecture/overview.md",
      ].join("\n"),
    );
    await writeFile(
      join(source, "architecture", "index.md"),
      "# Architecture\n\n- [Overview](overview.md)\n",
    );
    await writeFile(
      join(source, "architecture", "overview.md"),
      "# Runtime Overview\n\nBack to [Home](../quickstart.md#project-quickstart).\n",
    );
    await writeFile(
      join(source, "INSTRUCTIONS.md"),
      "private generation brief\n",
    );

    const result = await buildWiki({
      sourceDir: source,
      outputDir: output,
      workspaceDir: root,
      repository: "owner/project",
      sourceRef: "abc123",
      serverUrl: "https://github.com",
      homePage: "quickstart.md",
    });

    expect(result.pages.map((page) => page.targetFile)).toEqual([
      "Architecture-Overview.md",
      "Architecture.md",
      "Home.md",
    ]);
    expect(await readFile(join(output, "Home.md"), "utf8")).toBe(
      [
        "# Project Quickstart",
        "",
        "See [architecture](https://github.com/owner/project/wiki/Architecture), [overview][overview], and [security](https://github.com/owner/project/blob/abc123/docs/security.md).",
        "",
        "[overview]: https://github.com/owner/project/wiki/Architecture-Overview",
        "",
      ].join("\n"),
    );
    expect(
      await readFile(join(output, "Architecture-Overview.md"), "utf8"),
    ).toContain(
      "https://github.com/owner/project/wiki/Home#project-quickstart",
    );
    expect(await readFile(join(output, "_Sidebar.md"), "utf8")).toContain(
      "[Project Quickstart](https://github.com/owner/project/wiki/Home)",
    );
  });

  test("rejects case-insensitive target filename collisions", async () => {
    const { root, source, output } = await fixture();
    await writeFile(join(source, "quickstart.md"), "# Home\n");
    await writeFile(join(source, "Foo.md"), "# Upper\n");
    await mkdir(join(source, "foo"));
    await writeFile(join(source, "foo", "index.md"), "# Lower\n");

    await expect(
      buildWiki({
        sourceDir: source,
        outputDir: output,
        workspaceDir: root,
        repository: "owner/project",
        sourceRef: "abc123",
        serverUrl: "https://github.com",
        homePage: "quickstart.md",
      }),
    ).rejects.toThrow(/collision/i);
  });

  test("rejects an output directory that is the source directory", async () => {
    const { root, source } = await fixture();
    await writeFile(join(source, "quickstart.md"), "# Home\n");

    await expect(
      buildWiki({
        sourceDir: source,
        outputDir: source,
        workspaceDir: root,
        repository: "owner/project",
        sourceRef: "abc123",
        serverUrl: "https://github.com",
        homePage: "quickstart.md",
      }),
    ).rejects.toThrow(/output directory must not be inside/u);
  });
});
