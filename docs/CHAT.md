# Private chat

Reddix chat is a persistent, one-to-one text inbox. It uses the same admitted X account and verification policy as the rest of the community.

## Requests and conversations

- A verified member can send one introductory message to another active member. It appears in the recipient's **Requests** tab, outside the normal chat inbox.
- Pending requests produce no notification, sound, toast, or global unread badge. Reading a request does not expose a read receipt to its sender.
- Only the recipient can accept or decline a request. Accepting opens the conversation for both people. Neither participant can send follow-up messages while approval is pending.
- Declining closes the conversation and prevents another request between the same accounts. Blocking closes it and also applies the existing member block. Removing a block does not reopen a closed chat.
- Sending requires current blue or business verification. Browse-only members can read their history and manage requests and blocks.
- Accepted incoming messages contribute to the chat unread badge. Read state advances only through a displayed message, so a concurrent new message is not accidentally marked read.

Open chat from the header or navigation, or choose **Message** on another member's profile. Existing conversations are reused. New-chat search uses member names and X handles and excludes blocked and unavailable accounts.

## Persistence and delivery

The domain migration `db/002_chat.sql` adds `chat_conversations` and `chat_messages`. Run `pnpm db:setup` before starting or deploying this version. Production requests check the required schema and never migrate it automatically.

The chat view refreshes automatically while visible. Background tabs pause polling. This implementation uses authenticated HTTP polling rather than a long-lived socket, so it works with the existing Vercel deployment without an additional messaging provider. It does not require another API key.

Messages are plain text with a 4,000-character limit. React renders them as text rather than executable markup. Conversations retain paginated history, with 50 messages per page. Database sequence numbers keep message order stable across polling and pagination. Client-generated message IDs make retries idempotent. Failed sends retain the draft.

Inbox lists are capped at 200 conversations and 200 requests; unread totals include all accepted conversations. Inbox previews contain at most 240 characters. A separate summary endpoint supplies the background unread badge without returning message content.

This first version does not include attachments, group chats, typing indicators, push notifications, or end-to-end encryption. Message content is stored in the application's PostgreSQL database. Production database access, backups, encryption at rest, and retention are operator responsibilities.

## API

Every endpoint requires a signed-in, active, admitted, onboarded member. Every mutation also checks the request origin and a bounded JSON body. Conversation access is restricted to its two participants; knowing an ID grants no access.

| Endpoint                                                  | Behavior                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `GET /api/chat`                                           | Caller-owned conversations, separate incoming requests, accepted-message unread total |
| `GET /api/chat?summary=1`                                 | Accepted-message unread total only                                                    |
| `GET /api/chat/members?q=...`                             | Bounded member search; `id` resolves a profile entry point                            |
| `GET /api/chat/:id?before=...`                            | Participant-only conversation and paginated messages                                  |
| `POST /api/chat`, `action: request`                       | `recipientId`, `body`, `clientId`; creates a single pending request                   |
| `POST /api/chat`, `action: send`                          | `conversationId`, `body`, `clientId`; sends in an accepted conversation               |
| `POST /api/chat`, `action: accept`, `decline`, or `block` | Changes the caller-owned conversation state                                           |
| `POST /api/chat`, `action: read`                          | `conversationId`, `messageId`; advances the caller's read cursor                      |

Requests are limited to five per hour and twenty per day; accepted-conversation sends are limited to sixty per minute per member. Pair-level transaction locks and a unique participant pair prevent concurrent duplicate conversations. Database guards enforce fresh eligibility, participant membership, approval, and blocks when inserting messages.

Account exports include the caller's conversations and message history. Account deletion removes the deleted member's private message bodies and closes their conversations. Other participants retain their own messages.

## Verification

`tests/chat.test.ts` covers service authorization, lifecycle, concurrency, idempotency, read state, rate limits, and privacy. `tests/browser/chat.spec.ts` exercises separate browser sessions through request, approval, reply, decline, block, persistence, and mobile layouts. Chat fixtures use isolated local accounts and never send messages to real users.
