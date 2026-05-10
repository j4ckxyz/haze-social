const Database = require('better-sqlite3');
const fs = require('fs');
var db;

// settings

const RESET_DB = false;
const BACKUP_DB = true;
const CLEANUP_DEAD_POSTS = true;

//

if (!fs.existsSync('db'))
    fs.mkdirSync('db');
if (fs.existsSync('db/db.db')) {
    if (BACKUP_DB) {
        db = new Database('db/db.db');
        const date = new Date().toLocaleDateString().replaceAll('/','-');
        
        db.backup(`db/backup-${date}.db`)
        .then(() => {
            console.log(`backup complete! ${fs.readdirSync("db").length - 3} total backups stored.`);
        })
        .catch((err) => {
            console.log('backup failed:', err);
        });
    }
    if (RESET_DB) {
        fs.unlinkSync('db/db.db');
        fs.unlinkSync('db/db.db-shm');
        fs.unlinkSync('db/db.db-wal');
    }
    db = new Database('db/db.db');
} else {
    db = new Database('db/db.db');
    db.exec(`
        CREATE TABLE "posts" (
            "post_id"	INTEGER,
            "timestamp"	TEXT,
            "author"	TEXT,
            "body"	TEXT,
            "author_path"	TEXT,
            "path"	TEXT,
            "replying_to" TEXT,
            "live"	INTEGER,
            "edited" INTEGER DEFAULT 0,
            PRIMARY KEY("post_id")
        );
        CREATE TABLE "post_history" (
            "history_id" INTEGER,
            "path" TEXT,
            "body" TEXT,
            "timestamp" TEXT,
            PRIMARY KEY("history_id")
        );
        CREATE TABLE "subscriptions" (
            "subscription_id"	INTEGER,
            "timestamp"	TEXT,
            "json"	TEXT,
            "endpoint"	TEXT,
            PRIMARY KEY("subscription_id")
        );
        CREATE TABLE "users" (
            "user_id"	INTEGER,
            "username"	TEXT UNIQUE,
            "password_hash"	TEXT,
            "is_admin"	INTEGER DEFAULT 0,
            "created_at"	INTEGER,
            PRIMARY KEY("user_id")
        );
        CREATE TABLE "invite_codes" (
            "code_id"	INTEGER,
            "code"	TEXT UNIQUE,
            "created_by"	INTEGER,
            "used_by"	INTEGER,
            "created_at"	INTEGER,
            "used_at"	INTEGER,
            PRIMARY KEY("code_id")
        );
        CREATE TABLE "sessions" (
            "session_id"	INTEGER,
            "token"	TEXT UNIQUE,
            "user_id"	INTEGER,
            "created_at"	INTEGER,
            "expires_at"	INTEGER,
            PRIMARY KEY("session_id")
        );
    `);
}

// migrate existing databases — add tables if they don't exist
function tableExists(name) {
    return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

if (!tableExists('users')) {
    db.exec(`
        CREATE TABLE "users" (
            "user_id"	INTEGER,
            "username"	TEXT UNIQUE,
            "password_hash"	TEXT,
            "is_admin"	INTEGER DEFAULT 0,
            "created_at"	INTEGER,
            PRIMARY KEY("user_id")
        );
    `);
}
if (!tableExists('invite_codes')) {
    db.exec(`
        CREATE TABLE "invite_codes" (
            "code_id"	INTEGER,
            "code"	TEXT UNIQUE,
            "created_by"	INTEGER,
            "used_by"	INTEGER,
            "created_at"	INTEGER,
            "used_at"	INTEGER,
            PRIMARY KEY("code_id")
        );
    `);
}

// Check if posts table has edited column (migration)
try {
    const tableInfo = db.pragma("table_info(posts)");
    const hasEdited = tableInfo.some(column => column.name === 'edited');
    if (!hasEdited) {
        db.exec(`ALTER TABLE "posts" ADD COLUMN "edited" INTEGER DEFAULT 0;`);
    }
} catch (e) {
    console.error("Migration error adding edited column:", e);
}

if (!tableExists('post_history')) {
    db.exec(`
        CREATE TABLE "post_history" (
            "history_id" INTEGER,
            "path" TEXT,
            "body" TEXT,
            "timestamp" TEXT,
            PRIMARY KEY("history_id")
        );
    `);
}
if (!tableExists('sessions')) {
    db.exec(`
        CREATE TABLE "sessions" (
            "session_id"	INTEGER,
            "token"	TEXT UNIQUE,
            "user_id"	INTEGER,
            "created_at"	INTEGER,
            "expires_at"	INTEGER,
            PRIMARY KEY("session_id")
        );
    `);
}

db.pragma('journal_mode = WAL');

exports.db = db;

exports.insert = (table, obj) => {
    var keynames = "";
    var keys = "";
    for (let key in obj) {
        keynames += key + ",";
        keys += "@" + key + ",";
    }
    keynames = keynames.slice(0, -1);
    keys = keys.slice(0, -1);

    const stmt = db.prepare("INSERT INTO " + table + "(" + keynames + ") VALUES (" + keys + ")");
    return stmt.run(obj);
}

exports.delete = (table, obj) => {
    var conditions = "";
    for (let key in obj) {
        conditions += "WHERE " + key + "=@" + key + " AND ";
    }
    conditions = conditions.slice(0, -5);

    const stmt = db.prepare("DELETE FROM " + table + " " + conditions);
    return stmt.run(obj);
}

exports.update = (table, where, set) => {
    var obj = {};

    var where_conditions = "";
    for (let key in where) {
        obj["where_"+key] = where[key];
        where_conditions += key + "=@where_" + key + " AND ";
    }
    where_conditions = where_conditions.slice(0, -5);

    var set_conditions = "";
    for (let key in set) {
        obj["set_"+key] = set[key];
        set_conditions += key + "=@set_" + key + ", ";
    }
    set_conditions = set_conditions.slice(0, -2);

    const stmt = db.prepare("UPDATE " + table + " SET " + set_conditions + " WHERE " + where_conditions);
    return stmt.run(obj);
}

exports.query = (table, obj) => {
    var conditions = "";
    for (let key in obj) {
        conditions += "WHERE " + key + "=@" + key + " AND ";
    }
    conditions = conditions.slice(0, -5);

    const stmt = db.prepare("SELECT * FROM " + table + " " + conditions);
    return stmt.get(obj);
}

exports.queryall = (table, obj, additional) => {
    var conditions = "";
    for (let key in obj) {
        conditions += "WHERE " + key + "=@" + key + " AND ";
    }
    conditions = conditions.slice(0, -5);

    if (additional) conditions += " " + additional;

    const stmt = db.prepare("SELECT * FROM " + table + " " + conditions);

    return stmt.all(obj);
}

//

if (CLEANUP_DEAD_POSTS) {
    exports.delete("posts", { live: 0 });
}