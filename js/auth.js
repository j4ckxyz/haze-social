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

// middleware

function authMiddleware(req, res, next) {
    const token = req.cookies && req.cookies.session;
    const session = getSession(token);

    if (session) {
        const user = sqlite.query('users', { user_id: session.user_id });
        if (user) {
            req.user = {
                user_id: user.user_id,
                username: user.username,
                is_admin: user.is_admin === 1
            };
        }
    }

    next();
}

function requireAuth(req, res, next) {
    if (!req.user) {
        return res.redirect('/login');
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.user || !req.user.is_admin) {
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
        return { error: 'username already taken' };
    }

    if (!validateInviteCode(inviteCode)) {
        return { error: 'invalid or already used invite code' };
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
    if (!user) return { error: 'invalid username or password' };
    if (!verifyPassword(password, user.password_hash)) return { error: 'invalid username or password' };
    return { userId: user.user_id, username: user.username, isAdmin: user.is_admin === 1 };
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
    createInviteCode,
    generateInviteCode,
    getAllInviteCodes
};
