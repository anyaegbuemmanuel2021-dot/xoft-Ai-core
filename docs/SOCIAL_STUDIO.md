# XOFT Social Studio

Social Studio provides a persistent social content calendar in the XOFT dashboard.

## What it does

- Generate a post draft with XOFT's configured reasoning provider from a brief, goal, tone, and optional call to action.
- Save drafts with target platforms, explicit account-profile targets, and hashtags.
- Pass selected account profiles to the configured publishing adapter so it can route each post to the correct authorized page/profile.
- Schedule approved posts for Facebook, Instagram, LinkedIn, X, TikTok, YouTube, Threads, or another supported target.
- Persist draft/schedule/publish state in SQLite when STORAGE_MODE=sqlite and SQLITE_PATH are configured, or in MEMORY_DATA_DIR/social-calendar.json when using JSON storage.
- Record connector results and activity events; do not infer delivery/read counts from an accepted publish response.

## Publishing connector requirement

XOFT does not directly hold universal credentials for every social network. Configure an explicit connector in XOFT_CONNECTORS_JSON and choose its id and publish tool in Social Studio. Discover the connector's tool names through GET /api/connectors/:id/tools.

The Social Studio includes profile targets for Facebook `Softly Bot`, Instagram `@softly1810`, TikTok `@Softly1810`, and LinkedIn `Emmanuel Iyke`. These are profile labels supplied in the dashboard, not authenticated connections. The configured adapter must map each `targetAccounts[].profileId` to the real account/page identifier it has permission to publish to. Never treat a profile label as proof of login or authorization.

The configured connector must accept this generic HTTP JSON contract:

```json
{
  "action": "call",
  "tool": "publish_post",
  "input": {
    "post": {
      "id": "XOFT post id",
      "title": "Post title",
      "content": "Post copy",
      "platforms": ["linkedin"],
      "targetAccounts": [{"profileId":"linkedin:emmanuel-iyke","platform":"linkedin","name":"Emmanuel Iyke","handle":"Emmanuel Iyke"}],
      "hashtags": ["BusinessGrowth"],
      "mediaUrls": [],
      "scheduledAt": "ISO-8601 timestamp"
    }
  },
  "requestId": "unique-request-id"
}
```

An MCP HTTP connector can expose the equivalent tool. The publishing adapter must validate platform permissions, format media and copy for each platform, and return an unambiguous result. Use a real social publishing provider or a custom adapter; a quick-launch app link is not a publishing integration.

## Schedule and approval behavior

1. XOFT saves new content as a draft; generating content never publishes it.
2. Scheduling requires a future timestamp, a configured connector/tool, an approver name, and an approval note.
3. The background scheduler checks every 15 seconds while the XOFT server is running.
4. Only posts in scheduled state are eligible to publish. Provider exceptions are saved as failed; they are not represented as published.
5. A successful connector response is recorded as provider-confirmed, but users should verify the actual live post in the social platform/provider.

## API

- GET /api/social/summary — counts and enabled connector metadata.
- GET /api/social/posts?status=draft&platform=linkedin — list posts with optional filters.
- POST /api/social/generate-content — generate a draft from {brief, goal, tone, callToAction, platforms}.
- POST /api/social/posts — save a draft using {title, content, platforms, hashtags, mediaUrls}.
- PATCH /api/social/posts/:id — edit a draft or failed post.
- POST /api/social/posts/:id/schedule — schedule with {scheduledAt, connectorId, publishTool, approvedBy, approvalNote, publishInput}.
- POST /api/social/posts/:id/cancel — cancel a draft, scheduled post, or failed post.
- POST /api/social/posts/:id/publish-now — immediately attempt an explicitly approved publish.

All write endpoints require the XOFT admin credential; device-scoped credentials are rejected.

## Operational limits

- The server must remain awake and online at the scheduled time. If a free host sleeps, posts will not publish while it is asleep.
- No provider is preconfigured by this feature. The known profile labels are not connected accounts. Without a real publishing connector authorized for each target profile, XOFT can generate and save drafts but cannot publish externally.
- Platform API permissions, account type, media requirements, rate limits, and scheduling rules are enforced by the connected provider/adapter.
- A provider response alone may not prove a post is visible to the public. Verify the provider's post URL/status when available.
- AI drafts can be wrong. Review business facts, prices, links, claims, copyright, and brand voice before approving.

## Comments and direct messages inbox

Social Studio can import comments and DMs through connector tools and prepare reply drafts. The connected account must grant the provider the relevant read and reply permissions. The core does not bypass social platform access controls.

1. In Social Studio, choose the configured publishing/inbox connector.
2. Use **Discover inbox/reply tools** and verify the returned tool names. Select the actual comment-list, inbox/DM-list, and reply tools; naming suggestions are only hints.
3. Choose a platform and sync comments and/or DMs. The connector read tool must return an array or an object containing one of: `items`, `results`, `comments`, or `messages`. Each record needs an `id` / `commentId` / `messageId` and message text in `message` / `text` / `body` / `content`.
4. Select an item and generate a suggested reply with XOFT, optionally providing verified business context. XOFT treats inbound text as untrusted and should not invent prices, policies, or commitments.
5. Review the exact text, enter the approver and approval note, then confirm the send prompt. Sending is an external action and is never triggered just by syncing or drafting.

### Connector reply contract

The selected reply tool receives `platform`, `channel`, `externalId`, `conversationId`, `postUrl`, `message`, and `replyTo` in its input. The adapter must map these fields to the platform's actual API schema and return explicit acceptance evidence such as `{ "success": true, "messageId": "provider-reply-id" }` or `{ "status": "accepted", "id": "provider-reply-id" }`. Ambiguous connector responses do not mark an item replied. A recorded provider ID is not proof of delivery, visibility, or read receipt.

### Privacy and limits

- Imported message text is persisted in the XOFT data store. Use only accounts you own or are authorized to manage, and keep server storage and credentials private.
- Direct-message access differs by platform, account type, permissions, app review, and provider. A connector may support publishing but not inbox reading or replies.
- This feature does not silently read personal chats; it only imports what a configured connector explicitly returns.
- Auto-replying to inbound messages without review is not enabled. Replies require explicit approval each time.
- XOFT does not send unsolicited bulk DMs or bypass messaging windows, consent, rate limits, or platform policies.
- No live social account was connected or used to verify this feature during implementation.
