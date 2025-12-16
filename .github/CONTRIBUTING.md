# Contributing to Diffs

Looking to contribute to Diffs? **Here's how you can help.**

Please take a moment to review this document in order to make the contribution
process easy and effective for everyone involved.

## AI assistance

> [!IMPORTANT]
>
> Pierre allows AI-**assisted** _code contributions_, which must be properly
> disclosed in the pull request.

If you are using any kind of AI assistance while contributing to Pierre,
**this must be disclosed in the pull request**, along with the extent to
which AI assistance was used (e.g. docs only vs. code generation).

The submitter must have also tested the pull request on all impacted
platforms, and it's **highly discouraged** to code for an unfamiliar platform
with AI assistance alone.

> [!WARNING]
> **Note that AI _assistance_ does not equal AI _generation_**. We require
> a significant amount of human accountability, involvement, and interaction
> even within AI-assisted contributions. Contributors are required to be able
> to understand the AI-assisted output, reason with it, and answer critical
> questions about it. Should a PR see no visible human accountability and
> involvement, or it is so broken that it requires significant rework to be
> acceptable, **we reserve the right to close it without hesitation**.

**In addition, we currently restrict AI assistance to code changes only.**
No AI-generated media, e.g. artwork, icons, videos and other assets is
allowed. Likewise, all community interactions, including comments on issues and
discussions and all PR titles and descriptions **must be composed by a human**.
Community moderators and maintainers reserve the right to mark AI-generated
responses as spam or disruptive content, and ban users who have been repeatedly
caught relying entirely on LLMs during interactions.

_Credit to Ghostty for the original draft of this section._

## Using the issue tracker

The [issue tracker](https://github.com/pierreco/diffs/issues) is the preferred
channel for [bug reports](#bug-reports), [feature requests](#feature-requests),
and [submitting pull requests](#pull-requests), but please respect the
following restrictions:

- Please **do not** use the issue tracker for personal support requests.
- Please **do not** derail or troll issues. Keep the discussion on topic and
  respect the opinions of others.

## Bug reports

A bug is a _demonstrable problem_ that is caused by the code in the repository.
Good bug reports are extremely helpful, so thanks!

Guidelines for bug reports:

1. **Use the GitHub issue search** — check if the issue has already been
   reported.

2. **Check if the issue has been fixed** — try to reproduce it using the latest
   `main` branch in the repository.

3. **Isolate the problem** — ideally create a reduced test case and a live
   example.

A good bug report shouldn't leave others needing to chase you up for more
information. Please try to be as detailed as possible in your report.

## Feature requests

Feature requests are welcome. But take a moment to find out whether your idea
fits with the scope and aims of the project. It's up to _you_ to make a strong
case to convince the project's developers of the merits of this feature. Please
provide as much detail and context as possible.

## Pull requests

Good pull requests—patches, improvements, new features—are a fantastic help.
They should remain focused in scope and avoid containing unrelated commits.

**Please ask first** before embarking on any **significant** pull request (e.g.
implementing features, refactoring code), otherwise you risk spending a lot of
time working on something that the project's developers might not want to merge
into the project.

Adhering to the following process is the best way to get your work included in
the project:

1. [Fork](https://help.github.com/articles/fork-a-repo/) the project and clone
   your fork:

   ```bash
   git clone https://github.com/<your-username>/diffs.git
   cd diffs
   git remote add upstream https://github.com/pierreco.git
   ```

2. If you cloned a while ago, get the latest changes from upstream:

   ```bash
   git checkout main
   git pull upstream main
   ```

3. Install dependencies using [Bun](https://bun.sh/):

   ```bash
   bun install
   ```

4. Create a new topic branch to contain your feature, change, or fix:

   ```bash
   git checkout -b <topic-branch-name>
   ```

5. Make your changes, following the [code guidelines](#code-guidelines).

6. Commit your changes in logical, reviewable chunks whenever possible.

7. Run linting and tests to ensure everything passes:

   ```bash
   bun run lint
   bun run diffs:test
   ```

8. Push your topic branch up to your fork:

   ```bash
   git push origin <topic-branch-name>
   ```

9. [Open a pull request](https://help.github.com/articles/about-pull-requests/)
   with a clear title and description against the `main` branch.

**IMPORTANT**: By submitting a patch, you agree to allow the project owners to
license your work under the terms of the [Apache License 2.0](LICENSE).

## Code guidelines

### General

- We use [Bun](https://bun.sh/) for package management and running scripts
- We use TypeScript throughout the project
- Run `bun run lint` to check code style
- Run `bun run format` to auto-format code

## License

By contributing your code, you agree to license your contribution under the
[Apache License 2.0](LICENSE).
