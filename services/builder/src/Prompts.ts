/**
 * Coding-agent prompts that drive the builder. Stored alongside the
 * worker source so they're version-controlled with the same lifecycle as
 * the rest of the service.
 *
 * Each prompt is a plain string (or function that produces one). The
 * Container shells out to `claude-code` (or any other agent CLI) with the
 * prompt as its task description.
 */

/**
 * Prompt used when a PR review requests changes — instruct the agent to
 * read the review body + inline comments and push a follow-up commit.
 */
export const respondToReview = (input: {
  reviewBody: string | null;
  inlineComments: Array<{
    path: string;
    line: number | null;
    body: string | null;
  }>;
}) => `\
You are reviewing a request-for-changes left on a pull request. Read the
review body and inline comments below, then make the necessary code edits
and commit them with a single message summarizing what changed.

Review body:
${input.reviewBody ?? "(no body)"}

Inline comments:
${input.inlineComments
  .map(
    (c, i) =>
      `[${i + 1}] ${c.path}${c.line ? `:${c.line}` : ""} — ${c.body ?? ""}`,
  )
  .join("\n")}

Constraints:
- Run \`bun tsc -b\` after every edit to make sure the change typechecks.
- Do NOT push a merge commit; rebase any pulled changes.
- If a comment can't be addressed in code, leave it for a follow-up reply.
`;

/**
 * Prompt used when a release tag is pushed — generate a release blog post
 * from the diff and the commit messages between the previous tag and this
 * one.
 */
export const releaseBlog = (input: {
  fromTag: string | null;
  toTag: string;
}) => `\
Write a release blog post for tag ${input.toTag} (previous tag: ${
  input.fromTag ?? "<none>"
}).

Steps:
1. Run \`git log ${input.fromTag ?? "<initial>"}..${input.toTag} --oneline\`
   to get the changelog.
2. For each notable commit, expand it into a one-paragraph entry that
   explains the user-facing change in plain language.
3. Write the post to \`website/src/content/blog/${input.toTag}.md\`.
4. Commit on a new branch \`release-blog/${input.toTag}\` and push it. Open
   a PR titled "Release notes: ${input.toTag}".

Keep the tone matter-of-fact. No marketing copy. Skip dependency bumps and
internal refactors unless they affect the public surface.
`;

/**
 * Prompt used when a PR is opened — review the diff for obvious issues
 * (typos, missing tests, untyped any) and post a single high-signal
 * comment.
 */
export const reviewPullRequest = (input: { prNumber: number }) => `\
Review pull request #${input.prNumber}. Read the diff (\`git diff main\`),
identify the highest-signal issue (or confirm there are none), and respond
with a single, focused comment using the GitHub.IssueComments capability.

Do not nitpick formatting. Skip cosmetic suggestions. If everything looks
good, post a one-line approval-style comment instead.
`;
