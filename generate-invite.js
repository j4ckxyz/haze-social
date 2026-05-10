#!/usr/bin/env node

/**
 * Generate an invite code for untitled-social.
 * 
 * Usage:
 *   node generate-invite.js
 *   npm run generate-invite
 */

require('dotenv').config();

const sqlite = require('./js/sqlite.js');
const auth = require('./js/auth.js');

const code = auth.createInviteCode(null);
console.log(`\ninvite code generated: ${code}\n`);

process.exit(0);
