import { statSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import { toString } from "mdast-util-to-string";
import type { Definition, Heading, Image, Link, Root } from "mdast";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { visit } from "unist-util-visit";

export interface BuildWikiOptions {
  sourceDir: string;
  outputDir: string;
  workspaceDir: string;
  repository: string;
  sourceRef: string;
  serverUrl: string;
  homePage: string;
}

export interface PublishedPage {
  sourcePath: string;
  targetFile: string;
  title: string;
}

export interface BuildWikiResult {
  pages: PublishedPage[];
}

const parser = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkGfm);
const writer = unified()
  .use(remarkStringify, { bullet: "-", fences: true })
  .use(remarkGfm);

export async function buildWiki(
  options: BuildWikiOptions,
): Promise<BuildWikiResult> {
  validateRepository(options.repository);
  const workspaceDir = await realpath(options.workspaceDir);
  const sourceDir = await realpath(options.sourceDir);
  assertInside(workspaceDir, sourceDir, "source");

  const homePage = normalizeRelativePath(options.homePage, "home-page");
  const sourceFiles = await findMarkdownFiles(sourceDir);
  if (!sourceFiles.includes(homePage)) {
    throw new Error(`The configured home page does not exist: ${homePage}`);
  }

  const targetBySource = new Map<string, string>();
  const seenTargets = new Map<string, string>();
  for (const sourcePath of sourceFiles) {
    const targetFile = targetFileFor(sourcePath, homePage);
    const collisionKey = targetFile.toLocaleLowerCase("en-US");
    const existing = seenTargets.get(collisionKey);
    if (existing) {
      throw new Error(
        `Wiki filename collision: ${existing} and ${sourcePath} both map to ${targetFile}`,
      );
    }
    seenTargets.set(collisionKey, sourcePath);
    targetBySource.set(sourcePath, targetFile);
  }

  const requestedOutput = resolve(options.outputDir);
  const outputDir = join(
    await realpath(dirname(requestedOutput)),
    basename(requestedOutput),
  );
  if (isWithin(sourceDir, outputDir)) {
    throw new Error(
      "The output directory must not be inside the OpenWiki source directory",
    );
  }
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const pages: PublishedPage[] = [];
  for (const sourcePath of sourceFiles) {
    const absoluteSource = join(sourceDir, ...sourcePath.split("/"));
    const markdown = await readFile(absoluteSource, "utf8");
    const tree = parser.parse(markdown) as Root;
    tree.children = tree.children.filter((node) => node.type !== "yaml");
    rewriteLinks(tree, absoluteSource, {
      ...options,
      workspaceDir,
      sourceDir,
      targetBySource,
    });

    const targetFile = targetBySource.get(sourcePath);
    if (!targetFile)
      throw new Error(`Missing target mapping for ${sourcePath}`);
    const title = pageTitle(tree, sourcePath);
    const rendered = String(writer.stringify(tree));
    await writeFile(join(outputDir, targetFile), rendered, "utf8");
    pages.push({ sourcePath, targetFile, title });
  }

  pages.sort((left, right) =>
    left.targetFile.localeCompare(right.targetFile, "en-US"),
  );
  await writeFile(
    join(outputDir, "_Sidebar.md"),
    renderSidebar(pages, options),
    "utf8",
  );
  return { pages };
}

interface RewriteContext extends BuildWikiOptions {
  workspaceDir: string;
  sourceDir: string;
  targetBySource: Map<string, string>;
}

function rewriteLinks(
  tree: Root,
  sourceFile: string,
  context: RewriteContext,
): void {
  visit(tree, "link", (node: Link) => {
    node.url = rewriteUrl(node.url, sourceFile, context, false);
  });
  visit(tree, "image", (node: Image) => {
    node.url = rewriteUrl(node.url, sourceFile, context, true);
  });
  visit(tree, "definition", (node: Definition) => {
    node.url = rewriteUrl(node.url, sourceFile, context, false);
  });
}

function rewriteUrl(
  url: string,
  sourceFile: string,
  context: RewriteContext,
  isImage: boolean,
): string {
  if (!url || url.startsWith("#") || url.startsWith("//") || hasScheme(url))
    return url;

  const match = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(url);
  if (!match) return url;
  const pathPart = decodeURIComponent(match[1] ?? "");
  const query = match[2] ?? "";
  const fragment = match[3] ?? "";
  if (!pathPart) return url;

  const absoluteTarget = resolve(dirname(sourceFile), pathPart);
  assertInside(context.workspaceDir, absoluteTarget, `link ${url}`);
  let targetStat;
  try {
    targetStat = statSync(absoluteTarget);
  } catch {
    throw new Error(`Broken local link in ${sourceFile}: ${url}`);
  }

  if (isWithin(context.sourceDir, absoluteTarget)) {
    const resolvedTarget = targetStat.isDirectory()
      ? join(absoluteTarget, "index.md")
      : absoluteTarget;
    const sourcePath = toPosix(relative(context.sourceDir, resolvedTarget));
    const targetFile = context.targetBySource.get(sourcePath);
    if (!targetFile)
      throw new Error(`Broken OpenWiki link in ${sourceFile}: ${url}`);
    return `${wikiPageUrl(context, targetFile)}${query}${fragment}`;
  }

  const repositoryPath = toPosix(
    relative(context.workspaceDir, absoluteTarget),
  );
  const kind = targetStat.isDirectory() ? "tree" : "blob";
  const encodedPath = repositoryPath
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const base = isImage
    ? `${context.serverUrl}/${context.repository}/raw/${encodeURIComponent(context.sourceRef)}/${encodedPath}`
    : `${context.serverUrl}/${context.repository}/${kind}/${encodeURIComponent(context.sourceRef)}/${encodedPath}`;
  return `${base}${query}${fragment}`;
}

async function findMarkdownFiles(sourceDir: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en-US"));
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (
        entry.isFile() &&
        extname(entry.name).toLowerCase() === ".md" &&
        entry.name.toLowerCase() !== "instructions.md"
      ) {
        files.push(toPosix(relative(sourceDir, absolute)));
      }
    }
  }
  await walk(sourceDir);
  return files;
}

function targetFileFor(sourcePath: string, homePage: string): string {
  if (sourcePath === homePage) return "Home.md";
  const withoutExtension = sourcePath.slice(0, -extname(sourcePath).length);
  const segments = withoutExtension.split("/");
  if (segments.at(-1)?.toLowerCase() === "index") {
    segments.pop();
    if (segments.length === 0) return "Contents.md";
  }
  return `${segments.map(humanize).join("-")}.md`;
}

function humanize(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map(
      (part) => `${part.charAt(0).toLocaleUpperCase("en-US")}${part.slice(1)}`,
    )
    .join("-");
}

function pageTitle(tree: Root, sourcePath: string): string {
  const heading = tree.children.find(
    (node): node is Heading => node.type === "heading" && node.depth === 1,
  );
  return heading
    ? toString(heading)
    : humanize(sourcePath.slice(0, -extname(sourcePath).length));
}

function renderSidebar(
  pages: PublishedPage[],
  options: BuildWikiOptions,
): string {
  const home = pages.find((page) => page.targetFile === "Home.md");
  if (!home) throw new Error("The generated Wiki does not contain Home.md");

  const lines = [
    "# Pages",
    "",
    `- [${home.title}](${wikiPageUrl(options, home.targetFile)})`,
  ];
  const groups = new Map<string, PublishedPage[]>();
  for (const page of pages) {
    if (page.targetFile === "Home.md") continue;
    const group = page.sourcePath.includes("/")
      ? humanize(page.sourcePath.split("/")[0] ?? "Other")
      : "Overview";
    const groupPages = groups.get(group) ?? [];
    groupPages.push(page);
    groups.set(group, groupPages);
  }
  for (const group of [...groups.keys()].sort((a, b) =>
    a.localeCompare(b, "en-US"),
  )) {
    lines.push("", `## ${group}`, "");
    for (const page of groups.get(group) ?? []) {
      lines.push(`- [${page.title}](${wikiPageUrl(options, page.targetFile)})`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function wikiPageUrl(
  options: Pick<BuildWikiOptions, "serverUrl" | "repository">,
  targetFile: string,
): string {
  const pageName = targetFile.slice(0, -extname(targetFile).length);
  return `${options.serverUrl.replace(/\/$/u, "")}/${options.repository}/wiki/${encodeURIComponent(pageName)}`;
}

function normalizeRelativePath(value: string, label: string): string {
  const normalized = toPosix(value.trim()).replace(/^\.\//u, "");
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

function validateRepository(repository: string): void {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error("repository must use owner/name format");
  }
}

function hasScheme(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value);
}

function assertInside(parent: string, candidate: string, label: string): void {
  if (!isWithin(parent, candidate)) {
    throw new Error(`${label} resolves outside the repository workspace`);
  }
}

function isWithin(parent: string, candidate: string): boolean {
  return resolve(parent) === resolve(candidate) || isInside(parent, candidate);
}

function isInside(parent: string, candidate: string): boolean {
  const pathFromParent = relative(resolve(parent), resolve(candidate));
  return (
    pathFromParent !== "" &&
    pathFromParent !== ".." &&
    !pathFromParent.startsWith(`..${sep}`)
  );
}

function toPosix(value: string): string {
  return value.split(sep).join("/");
}
