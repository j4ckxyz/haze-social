const crypto = require('crypto');
const sqlite = require('./sqlite.js');

// password hashing using scrypt

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return salt + ':' + hash;
}

function verifyPassword(password, stored) {
    const [salt, hash] = stored.split(':');
    const test = crypto.scryptSync(password, salt, 64).toString('hex');
    return hash === test;
}

// session management

function createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;

    sqlite.insert('sessions', {
        token,
        user_id: userId,
        created_at: now,
        expires_at: now + thirtyDays
    });

    return token;
}

function getSession(token) {
    if (!token) return null;
    const session = sqlite.query('sessions', { token });
    if (!session) return null;
    if (Date.now() > session.expires_at) {
        sqlite.delete('sessions', { token });
        return null;
    }
    return session;
}

function destroySession(token) {
    if (!token) return;
    sqlite.delete('sessions', { token });
}

// api key management

function hashApiToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function createApiKey(userId, label = 'default') {
    const raw = `hzs_${crypto.randomBytes(24).toString('hex')}`;
    const now = Date.now();

    sqlite.insert('api_keys', {
        user_id: userId,
        token_hash: hashApiToken(raw),
        key_prefix: raw.slice(0, 14),
        label: String(label || 'default').slice(0, 40),
        created_at: now,
        last_used_at: null,
        revoked_at: null
    });

    return raw;
}

function listApiKeys(userId) {
    return sqlite.db.prepare(`
        SELECT key_id, key_prefix, label, created_at, last_used_at, revoked_at
        FROM api_keys
        WHERE user_id = ?
        ORDER BY created_at DESC
    `).all(userId).map((k) => ({
        key_id: k.key_id,
        key_prefix: k.key_prefix,
        label: k.label,
        created_at: k.created_at,
        last_used_at: k.last_used_at,
        revoked: k.revoked_at !== null
    }));
}

function revokeApiKey(userId, keyId) {
    return sqlite.db.prepare(`
        UPDATE api_keys
        SET revoked_at = ?
        WHERE user_id = ? AND key_id = ? AND revoked_at IS NULL
    `).run(Date.now(), userId, Number(keyId));
}

function authenticateApiKey(rawToken) {
    if (!rawToken) return null;

    const tokenHash = hashApiToken(rawToken.trim());
    const key = sqlite.db.prepare(`
        SELECT * FROM api_keys
        WHERE token_hash = ? AND revoked_at IS NULL
        LIMIT 1
    `).get(tokenHash);

    if (!key) return null;

    sqlite.update('api_keys', { key_id: key.key_id }, { last_used_at: Date.now() });

    const user = sqlite.query('users', { user_id: key.user_id });
    if (!user) return null;

    return {
        user_id: user.user_id,
        username: user.username,
        is_admin: user.is_admin === 1,
        auth_type: 'api_key',
        api_key_id: key.key_id
    };
}

function extractBearerToken(req) {
    const header = req.headers && req.headers.authorization;
    if (header && typeof header === 'string' && header.startsWith('Bearer ')) {
        return header.slice(7).trim();
    }

    const apiKeyHeader = req.headers && req.headers['x-api-key'];
    if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim() !== '') {
        return apiKeyHeader.trim();
    }

    return null;
}

// middleware

function authMiddleware(req, res, next) {
    const sessionToken = req.cookies && req.cookies.session;
    const session = getSession(sessionToken);

    if (session) {
        const user = sqlite.query('users', { user_id: session.user_id });
        if (user) {
            req.user = {
                user_id: user.user_id,
                username: user.username,
                is_admin: user.is_admin === 1,
                auth_type: 'session'
            };
            return next();
        }
    }

    const apiToken = extractBearerToken(req);
    const apiUser = authenticateApiKey(apiToken);
    if (apiUser) {
        req.user = apiUser;
    }

    next();
}

function requireAuth(req, res, next) {
    if (!req.user) {
        if ((req.path && req.path.startsWith('/api/')) || req.accepts('json')) {
            return res.status(401).send({ message: 'authentication required' });
        }
        return res.redirect('/login');
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.user || !req.user.is_admin) {
        if ((req.path && req.path.startsWith('/api/')) || req.accepts('json')) {
            return res.status(403).send({ message: 'admin required' });
        }
        return res.redirect('/');
    }
    next();
}

// invite codes

function generateInviteCode() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let code = '';
    const bytes = crypto.randomBytes(8);
    for (let i = 0; i < 8; i++) {
        code += chars[bytes[i] % chars.length];
    }
    return code;
}

function createInviteCode(createdByUserId) {
    const code = generateInviteCode();
    sqlite.insert('invite_codes', {
        code,
        created_by: createdByUserId,
        used_by: null,
        created_at: Date.now(),
        used_at: null
    });
    return code;
}

function validateInviteCode(code) {
    const invite = sqlite.query('invite_codes', { code });
    if (!invite) return false;
    if (invite.used_by !== null) return false;
    return true;
}

function useInviteCode(code, userId) {
    sqlite.update('invite_codes', { code }, {
        used_by: userId,
        used_at: Date.now()
    });
}

// user creation

function createUser(username, password, inviteCode) {
    const existing = sqlite.query('users', { username: username.toLowerCase() });
    if (existing) {
        return { error: 'that username is already taken' };
    }

    if (!validateInviteCode(inviteCode)) {
        return { error: 'invite code is invalid or already used' };
    }

    // first user becomes admin
    const userCount = sqlite.db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    const isAdmin = userCount === 0 ? 1 : 0;

    const passwordHash = hashPassword(password);

    const result = sqlite.insert('users', {
        username: username.toLowerCase(),
        password_hash: passwordHash,
        is_admin: isAdmin,
        created_at: Date.now()
    });

    const userId = result.lastInsertRowid;
    useInviteCode(inviteCode, userId);

    return { userId, isAdmin };
}

function loginUser(username, password) {
    const user = sqlite.query('users', { username: username.toLowerCase() });
    if (!user) return { error: 'username or password is incorrect' };
    if (!verifyPassword(password, user.password_hash)) return { error: 'username or password is incorrect' };
    return { userId: user.user_id, username: user.username, isAdmin: user.is_admin === 1 };
}

function changePassword(userId, currentPassword, nextPassword) {
    const user = sqlite.query('users', { user_id: userId });
    if (!user) return { error: "couldnt find your account" };
    if (!currentPassword || !nextPassword) return { error: 'enter your current password and a new password' };
    if (!verifyPassword(currentPassword, user.password_hash)) {
        return { error: 'current password is incorrect' };
    }
    if (String(nextPassword).length < 4) {
        return { error: 'new password needs to be at least 4 characters' };
    }

    sqlite.update('users', { user_id: userId }, { password_hash: hashPassword(nextPassword) });
    return { ok: true };
}

function destroyOtherSessions(userId, keepToken) {
    if (!keepToken) {
        return sqlite.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    }

    return sqlite.db
        .prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?')
        .run(userId, keepToken);
}

// get all invite codes (for admin)

function getAllInviteCodes() {
    return sqlite.db.prepare(`
        SELECT 
            ic.*,
            creator.username AS created_by_username,
            consumer.username AS used_by_username
        FROM invite_codes ic
        LEFT JOIN users creator ON ic.created_by = creator.user_id
        LEFT JOIN users consumer ON ic.used_by = consumer.user_id
        ORDER BY ic.created_at DESC
    `).all();
}

module.exports = {
    authMiddleware,
    requireAuth,
    requireAdmin,
    createSession,
    destroySession,
    createUser,
    loginUser,
    changePassword,
    destroyOtherSessions,
    createInviteCode,
    generateInviteCode,
    getAllInviteCodes,
    createApiKey,
    listApiKeys,
    revokeApiKey
};
