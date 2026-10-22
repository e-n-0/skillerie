# Pull Request Review Thread Queries

The bundled `get-pr-comments.sh` script fetches review threads and returns their GraphQL thread IDs
and REST comment IDs. Use those IDs for replies and resolution.

## Resolve a Thread

```bash
gh api graphql -f query='
mutation {
  resolveReviewThread(input: { threadId: "{thread_id}" }) {
    thread { id isResolved }
  }
}'
```

Replace `{thread_id}` with the GraphQL `thread_id` from the fetched thread. Only resolve a thread after
its concern is addressed.

## Reply with GraphQL

```bash
gh api graphql \
  -f query='mutation($thread: ID!, $body: String!) {
    addPullRequestReviewThreadReply(input: {
      pullRequestReviewThreadId: $thread
      body: $body
    }) { comment { id body } }
  }' \
  -F thread="{thread_id}" \
  -F body="{response text}"
```

Passing variables separately handles quotes and newlines safely.

## REST Fallback

```bash
gh api "repos/{owner}/{repo}/pulls/{number}/comments/{comment_id}/replies" \
  -X POST -f body="{response text}"
```

The REST endpoint adds a reply but cannot resolve a thread. If both threaded methods fail, a
top-level PR comment can link to the original review comment:

```bash
gh pr comment {number} --body "Re: [{path}:{line}]({comment_url}) (@{reviewer})

{response text}"
```

## Request Another Review

```bash
gh pr edit {number} --add-reviewer {reviewer}
```

Use this only when the user requests another review or the review workflow calls for it.
