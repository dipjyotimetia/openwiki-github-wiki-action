# Security

Report vulnerabilities privately through GitHub Security Advisories for this repository.

The action treats the selected `openwiki/` tree as untrusted input. It reads regular Markdown files only, ignores symlinks, rejects paths outside `GITHUB_WORKSPACE`, masks the supplied token, and never places credentials in a Git remote URL. It replaces the target Wiki through a normal non-force push and fails on concurrent updates.

Callers remain responsible for creating a narrowly scoped token and reviewing generated documentation before publishing it. Do not run the publisher with write credentials on untrusted pull-request code.
