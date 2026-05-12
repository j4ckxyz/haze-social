# haze → discord bot webhook guide

this guide shows a clean way to relay new posts from a haze instance into discord using a small bot service.

reference haze instance used in examples: **https://hazeapp.uk**

---

## what you are building

1. haze sends a webhook when a new post is published
2. your small bot endpoint receives it
3. the bot posts a message into a discord channel

---

## prerequisites

- a haze account on `https://hazeapp.uk`
- access to **settings → webhooks** in haze
- a discord server where you can create webhooks
- somewhere to host a tiny node service over **https** (render, railway, fly, etc)

> note: haze webhook urls must be `https://...`

---

## step 1) create a discord incoming webhook

in discord:

1. open **server settings**
2. go to **integrations**
3. click **webhooks**
4. create webhook
5. choose the channel to post into
6. copy the webhook url

it looks like:

```txt
https://discord.com/api/webhooks/123.../abc...
```

save this as `DISCORD_WEBHOOK_URL`.

---

## step 2) create the relay bot service

create a folder and install dependencies:

```bash
mkdir haze-discord-relay
cd haze-discord-relay
npm init -y
npm i express
```

create `server.js`:

```js
import express from "express";

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

if (!DISCORD_WEBHOOK_URL) {
  throw new Error("missing DISCORD_WEBHOOK_URL");
}

app.post("/haze-webhook", async (req, res) => {
  try {
    const event = req.header("x-haze-event");
    const payload = req.body;

    if (event !== "post.created") {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const post = payload?.post;
    if (!post) {
      return res.status(400).json({ ok: false, error: "missing post payload" });
    }

    const title = post.title || "new haze post";
    const author = post.author || "unknown";
    const url = post.url || "https://hazeapp.uk";
    const text = (post.text || "").trim();

    const content = [
      `🫧 **${author}** posted on haze`,
      `**${title}**`,
      text ? `> ${text.slice(0, 300)}` : null,
      url,
    ]
      .filter(Boolean)
      .join("\n");

    const discordRes = await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });

    if (!discordRes.ok) {
      const body = await discordRes.text();
      return res.status(502).json({ ok: false, error: `discord error ${discordRes.status}: ${body}` });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.get("/health", (_req, res) => {
  res.status(200).send("ok");
});

app.listen(PORT, () => {
  console.log(`relay listening on :${PORT}`);
});
```

if your project is not already esm, add this to `package.json`:

```json
{
  "type": "module"
}
```

run locally:

```bash
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..." node server.js
```

---

## step 3) deploy the relay

deploy this service to a host that gives you an https url, for example:

```txt
https://your-relay.example/haze-webhook
```

---

## step 4) add the webhook in haze

on `https://hazeapp.uk`:

1. open **settings**
2. go to **webhooks**
3. add your relay endpoint url (for example `https://your-relay.example/haze-webhook`)
4. save

haze will now send `post.created` events to your relay.

---

## step 5) test end to end

1. publish a new post on haze
2. check relay logs (you should see a 200)
3. check discord channel for the new message

---

## webhook payload shape (from haze)

haze sends json like this:

```json
{
  "event": "post.created",
  "timestamp": 1715532000000,
  "post": {
    "path": "alice/AbCdEf12",
    "url": "https://hazeapp.uk/posts/alice/AbCdEf12",
    "author": "alice",
    "author_path": "alice",
    "title": "hello",
    "text": "hello world",
    "created_at": 1715532000000,
    "replying_to": null
  }
}
```

headers include:

- `x-haze-event` (for example `post.created`)
- `x-haze-signature` (`sha256=...`)

---

## optional hardening

- rate limit your endpoint
- only accept `content-type: application/json`
- verify `x-haze-signature` if you control the haze server and can access webhook secrets
- log failed discord responses for retry

---

## quick troubleshooting

- **haze says webhook invalid**: endpoint must be `https://...`
- **no discord message**: check `DISCORD_WEBHOOK_URL` env var and relay logs
- **discord 400**: content payload too long or malformed
- **discord 401/404**: webhook url is wrong, deleted, or from another channel/server

---

## done

you now have a lightweight discord bot relay powered by haze webhooks from `https://hazeapp.uk`.
