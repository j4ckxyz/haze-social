# Haze API Documentation

This file documents every current `/api/*` endpoint in Haze, with auth rules, request/response shapes, and copy-paste examples.

---

## Base URL

Use your instance URL:

```bash
BASE_URL="https://your-haze.example"
```

For local development:

```bash
BASE_URL="http://localhost:8080"
```

---

## Authentication

Most API routes require authentication.

You can authenticate in two ways:

1. **Session cookie** (browser login)
2. **API key** (recommended for scripts/bots)

API key header options:

```http
Authorization: Bearer hzs_xxx...
```

or

```http
X-API-Key: hzs_xxx...
```

Get/create API keys from **Settings → Developer settings**.

---

## Common response patterns

- `401` → `{ "message": "authentication required" }`
- `403` → `{ "message": "forbidden" }` (or admin required)
- `404` → `{ "message": "post not found" }`
- Validation errors return `400` with a message.

---

## Endpoints

## 1) Get current authenticated user

**GET** `/api/me`

Returns account info for the current authenticated identity.

### Example

```bash
curl -s "$BASE_URL/api/me" \
  -H "Authorization: Bearer $API_KEY"
```

### Example response

```json
{
  "user": {
    "user_id": 1,
    "username": "alice",
    "is_admin": false,
    "auth_type": "api_key"
  }
}
```

---

## 2) Get feed (paginated)

**GET** `/api/feed?page=1`

Returns feed posts for a page plus max page count.

- `page` is optional (default `1`)

### Example

```bash
curl -s "$BASE_URL/api/feed?page=1" \
  -H "Authorization: Bearer $API_KEY"
```

### Example response (trimmed)

```json
{
  "page": 1,
  "max_page": 4,
  "posts": [
    {
      "title": "hello",
      "timestamp": 1715532000000,
      "author": "alice",
      "author_path": "alice",
      "preview_body": "<p>hello</p>",
      "body": "<p>hello</p>",
      "path": "alice/AbCdEf12",
      "reply_count": 0,
      "replying_to": null,
      "live": true,
      "raw_body": "hello",
      "edited": false
    }
  ]
}
```

---

## 3) List live posts

**GET** `/api/posts`

Optional filter:
- `author=<username-or-author_path>`

### Examples

```bash
curl -s "$BASE_URL/api/posts" \
  -H "Authorization: Bearer $API_KEY"
```

```bash
curl -s "$BASE_URL/api/posts?author=alice" \
  -H "Authorization: Bearer $API_KEY"
```

Returns:

```json
{ "posts": [ /* parsed post objects */ ] }
```

---

## 4) Get one post with replies

**GET** `/api/posts/:author/:id`

Returns one live post and its replies.

### Example

```bash
curl -s "$BASE_URL/api/posts/alice/AbCdEf12" \
  -H "Authorization: Bearer $API_KEY"
```

### 404 case

```json
{ "message": "post not found" }
```

---

## 5) Create post

**POST** `/api/posts`

### Body fields

- `body` (required, string)
- `replying_to` (optional, string path like `alice/AbCdEf12`)

Works with JSON body.

### Example (new post)

```bash
curl -s -X POST "$BASE_URL/api/posts" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"body":"hello from API"}'
```

### Example (reply)

```bash
curl -s -X POST "$BASE_URL/api/posts" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"body":"agree", "replying_to":"alice/AbCdEf12"}'
```

### Success response

```json
{
  "message": "post created",
  "path": "alice/XyZ123ab",
  "post": { /* parsed post */ }
}
```

### Errors

- `400` if `body` is missing/empty
- `429` if unique path generation fails repeatedly

---

## 6) Edit your post

**PUT** `/api/posts/:author/:id`

You can only edit your own post.

### Body fields

- `body` (required, string)

### Example

```bash
curl -s -X PUT "$BASE_URL/api/posts/alice/AbCdEf12" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"body":"updated text"}'
```

### Responses

- Success: `{ "message": "post edited", "post": { ... } }`
- `403` if not owner
- `400` if body is empty

---

## 7) Delete your post

**DELETE** `/api/posts/:author/:id`

You can only delete your own post.

### Example

```bash
curl -s -X DELETE "$BASE_URL/api/posts/alice/AbCdEf12" \
  -H "Authorization: Bearer $API_KEY"
```

### Responses

- Success: `{ "message": "post deleted" }`
- `403` if not owner or post missing/unauthorized for deletion

---

## 8) Search users (mention autocomplete helper)

**GET** `/api/users/search?q=<prefix>`

Returns up to 8 users matching the sanitized prefix.

### Example

```bash
curl -s "$BASE_URL/api/users/search?q=al" \
  -H "Authorization: Bearer $API_KEY"
```

### Example response

```json
{
  "users": [
    { "username": "alice", "path": "alice" },
    { "username": "alvin", "path": "alvin" }
  ]
}
```

If `q` is empty, response is:

```json
{ "users": [] }
```

---

## 9) Markdown preview renderer

**POST** `/api/preview`

Renders markdown-like Haze post text to HTML (sanitized/parsing rules as used by app UI).

### Body fields

- `post` (string)

### Example (JSON)

```bash
curl -s -X POST "$BASE_URL/api/preview" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"post":"hello **world**"}'
```

### Example response

```json
{
  "post": "<p>hello <strong>world</strong></p>\n"
}
```

---

## 10) Admin: generate invite code

**POST** `/api/admin/generate-invite`

Requires authenticated **admin** user.

### Example

```bash
curl -s -X POST "$BASE_URL/api/admin/generate-invite" \
  -H "Authorization: Bearer $API_KEY"
```

### Responses

Success:

```json
{ "code": "k9m2q4rt" }
```

Failure:

```json
{ "error": "failed to generate invite code" }
```

Non-admin:

```json
{ "message": "admin required" }
```

---

## Quick script snippets

### Minimal shell setup

```bash
BASE_URL="http://localhost:8080"
API_KEY="hzs_your_key_here"
AUTH_HEADER="Authorization: Bearer $API_KEY"
```

### Who am I?

```bash
curl -s "$BASE_URL/api/me" -H "$AUTH_HEADER" | jq
```

### Create + read post

```bash
NEW_PATH=$(curl -s -X POST "$BASE_URL/api/posts" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"body":"hello from script"}' | jq -r '.path')

curl -s "$BASE_URL/api/posts/$NEW_PATH" -H "$AUTH_HEADER" | jq
```

---

## Notes

- API returns parsed HTML fields (`body`, `preview_body`) for UI parity.
- Webhook management is currently done through Settings UI routes (not `/api/*` routes yet).
- For bot integrations, pair API key usage with a webhook endpoint configured in Settings.
