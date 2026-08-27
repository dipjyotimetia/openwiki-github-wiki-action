# OpenWiki GitHub Wiki Action

Publish a reviewed [`openwiki/`](https://github.com/langchain-ai/openwiki) directory as a generated GitHub Wiki.

The action transforms OpenWiki's nested Markdown into GitHub Wiki pages, creates `Home.md` and `_Sidebar.md`, rewrites local links, and pushes only when the generated Wiki changed. It does not run a model or generate documentation: keep that work in a separate workflow that opens a review pull request.

## Behavior

- `quickstart.md` becomes `Home.md` by default.
- Nested pages are flattened into stable Wiki filenames.
- OpenWiki YAML front matter and `INSTRUCTIONS.md` are not published.
- Links between OpenWiki pages become Wiki links; links to repository files use the supplied source commit.
- Existing Wiki content is replaced. Treat `openwiki/` on the repository's default branch as the only source of truth.
- Publication uses a normal push. Concurrent Wiki edits fail rather than being force-pushed away.

GitHub requires the first Wiki page to be created in the web UI before its Git repository can be cloned. Create a temporary `Home` page once, then run the workflow.

## Usage with a GitHub App

Create a dedicated GitHub App with **Contents: Read and write**, install it on the selected repository, save its client ID as the repository variable `OPENWIKI_APP_CLIENT_ID`, and save its private key as `OPENWIKI_APP_PRIVATE_KEY`.

```yaml
name: Publish GitHub Wiki

on:
  workflow_dispatch:
  push:
    branches: [main]
    paths:
      - "openwiki/**"
      - ".github/workflows/publish-wiki.yml"

permissions:
  contents: read

concurrency:
  group: publish-github-wiki
  cancel-in-progress: false

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3
        id: app-token
        with:
          client-id: ${{ vars.OPENWIKI_APP_CLIENT_ID }}
          private-key: ${{ secrets.OPENWIKI_APP_PRIVATE_KEY }}
          permission-contents: write

      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          persist-credentials: false

      - uses: dipjyotimetia/openwiki-github-wiki-action@v1
        with:
          token: ${{ steps.app-token.outputs.token }}
          committer-name: ${{ steps.app-token.outputs.app-slug }}[bot]
```

Pin the action to a full commit SHA in repositories with stricter supply-chain requirements.

The caller supplies authentication because secrets from this action's repository are never available to consuming workflows. Installation-token access to `.wiki.git` must be verified for each GitHub environment; this action does not fall back to a personal access token.

## Inputs

| Input             | Required | Default                          | Purpose                                            |
| ----------------- | -------- | -------------------------------- | -------------------------------------------------- |
| `token`           | Yes      | —                                | Token able to push the target Wiki Git repository. |
| `source`          | No       | `openwiki`                       | Repository-relative OpenWiki directory.            |
| `repository`      | No       | Current repository               | Target in `owner/name` form.                       |
| `source-ref`      | No       | Current SHA                      | Immutable source ref used in repository links.     |
| `home-page`       | No       | `quickstart.md`                  | Source page published as `Home.md`.                |
| `commit-message`  | No       | `docs: sync OpenWiki from <sha>` | Wiki commit message.                               |
| `committer-name`  | No       | `github-actions[bot]`            | Wiki commit author name.                           |
| `committer-email` | No       | GitHub Actions bot email         | Wiki commit author email.                          |

## Outputs

| Output       | Meaning                                          |
| ------------ | ------------------------------------------------ |
| `changed`    | `true` when a Wiki commit was created.           |
| `commit-sha` | Published Wiki commit SHA, or empty for a no-op. |
| `wiki-url`   | Browser URL of the target Wiki.                  |

## Development

```sh
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
git diff --exit-code -- dist
```

`dist/` is committed because GitHub executes the packaged action directly.
