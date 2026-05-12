const crypto = require('crypto');
const sqlite = require('./sqlite.js');

function getEnabledWebhooks() {
    return sqlite.db.prepare(`
        SELECT webhook_id, user_id, url, secret
        FROM webhooks
        WHERE enabled = 1
        ORDER BY webhook_id ASC
    `).all();
}

function sanitizeWebhookUrl(url) {
    const value = String(url || '').trim();
    if (!/^https:\/\//i.test(value)) return null;

    try {
        const u = new URL(value);
        if (u.protocol !== 'https:') return null;
        return u.toString();
    } catch {
        return null;
    }
}

function createWebhook(userId, url) {
    const safeUrl = sanitizeWebhookUrl(url);
    if (!safeUrl) return { error: 'webhook url must start with https:// and be valid' };

    const existing = sqlite.db.prepare(
        'SELECT webhook_id FROM webhooks WHERE user_id = ? AND url = ? AND enabled = 1 LIMIT 1'
    ).get(userId, safeUrl);

    if (existing) return { error: 'that webhook is already added' };

    const secret = crypto.randomBytes(24).toString('hex');
    sqlite.insert('webhooks', {
        user_id: userId,
        url: safeUrl,
        secret,
        enabled: 1,
        created_at: Date.now(),
        last_success_at: null,
        last_error: null
    });

    return { ok: true };
}

function deleteWebhook(userId, webhookId) {
    const row = sqlite.db.prepare('SELECT webhook_id FROM webhooks WHERE webhook_id = ? AND user_id = ?').get(Number(webhookId), userId);
    if (!row) return { error: 'webhook not found' };

    sqlite.update('webhooks', { webhook_id: row.webhook_id }, { enabled: 0 });
    return { ok: true };
}

function listWebhooks(userId) {
    return sqlite.db.prepare(`
        SELECT webhook_id, url, enabled, created_at, last_success_at, last_error
        FROM webhooks
        WHERE user_id = ?
        ORDER BY created_at DESC
    `).all(userId);
}

async function sendWebhook(row, payload) {
    const json = JSON.stringify(payload);
    const signature = crypto
        .createHmac('sha256', row.secret)
        .update(json)
        .digest('hex');

    try {
        const response = await fetch(row.url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-haze-event': payload.event,
                'x-haze-signature': `sha256=${signature}`
            },
            body: json
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        sqlite.update('webhooks', { webhook_id: row.webhook_id }, {
            last_success_at: Date.now(),
            last_error: null
        });
    } catch (err) {
        sqlite.update('webhooks', { webhook_id: row.webhook_id }, {
            last_error: String(err.message || err).slice(0, 200)
        });
    }
}

async function broadcastPostCreated(post, baseUrl) {
    const payload = {
        event: 'post.created',
        timestamp: Date.now(),
        post: {
            path: post.path,
            url: `${baseUrl}/posts/${post.path}`,
            author: post.author,
            author_path: post.author_path,
            title: post.title,
            text: post.text,
            created_at: post.timestamp,
            replying_to: post.replying_to || null
        }
    };

    const hooks = getEnabledWebhooks();
    await Promise.allSettled(hooks.map((row) => sendWebhook(row, payload)));
}

module.exports = {
    createWebhook,
    deleteWebhook,
    listWebhooks,
    broadcastPostCreated
};
