require("dotenv").config();

const express = require("express");
const path = require("path");
const compression = require("compression");
const cookieParser = require("cookie-parser");

const marked = require("marked");
const sqlite = require("./js/sqlite.js");
const push = require("./js/push.js");
const auth = require("./js/auth.js");
const webhooks = require("./js/webhooks.js");
const fs = require("fs");
const upload = require("./js/upload.js");

const port = process.env.PORT || 8080;
const app = express();

const sanitize = require("sanitize-html");

// settings

const POSTS_PER_PAGE = 10;
const MAX_TITLE_LENGTH = 40;

//

app.use(compression());
app.use("/", express.static(path.join(__dirname, "public")));
// use form data
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
// ejs
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "public/views"));

// auth middleware — runs on every request, populates req.user if logged in
app.use(auth.authMiddleware);

// make user available to all templates
app.use((req, res, next) => {
  res.locals.user = req.user || null;
  next();
});

function requireContentAuth(req, res, next) {
  if (!req.user) {
    if (req.path.startsWith("/api/")) {
      return res.status(401).send({ message: "authentication required" });
    }

    if (req.accepts("html")) {
      return res.redirect("/landing");
    }

    return res.status(401).send({ message: "authentication required" });
  }

  next();
}

function requireApiAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).send({ message: "authentication required" });
  }

  next();
}

// routing

app.get("/landing", (req, res) => {
  if (req.user) {
    return res.redirect("/");
  }

  res.render("landing");
});

app.get("/", requireContentAuth, (req, res) => {
  res.render("home", { feed: get_feed(0), page: 1, max_page: get_max_page() });
});

app.get("/how-to-install", (req, res) => {
  res.render("how-to-install");
});

app.get("/posts", requireContentAuth, (req, res) => {
  var feed = [];
  for (let post of get_live_posts()) {
    feed.push(parse_post_minimal(post));
  }

  res.render("index", { title: "all posts", posts: feed });
});

app.get("/posts/:author", requireContentAuth, (req, res) => {
  return render_author_profile(req, res, "all");
});

app.get("/posts/:author/posts", requireContentAuth, (req, res) => {
  return render_author_profile(req, res, "posts");
});

app.get("/posts/:author/replies", requireContentAuth, (req, res) => {
  return render_author_profile(req, res, "replies");
});

app.get("/posts/:author/media", requireContentAuth, (req, res) => {
  return render_author_profile(req, res, "media");
});

app.get("/posts/:author/:id", (req, res) => {
  const path = req.params.author + "/" + req.params.id;
  const post = sqlite.query("posts", { path: path });

  if (!post || (post.live !== 1 && (!req.user || req.user.username !== post.author))) {
    return res.status(404).render("post", {
      title: "?",
      timestamp: -1,
      author: req.params.author,
      author_path: req.params.author,
      preview_body: "this post does not exist!",
      body: "this post does not exist!",
      path: path,
      replies: [],
      reply_count: 0,
      replying_to: null,
    });
  }

  const parsed = parse_post_with_replies(post);
  const absoluteUrl = get_absolute_request_url(req, `/posts/${path}`);
  const excerpt = get_post_embed_text(post.body);

  res.render("post", {
    ...parsed,
    meta: {
      title: `${parsed.author} · ${parsed.title || "post"} · haze`,
      description: excerpt,
      url: absoluteUrl,
      type: "article",
    },
  });
});

app.get("/new", auth.requireAuth, (req, res) => {
  res.render("new");
});

app.get("/reply/:author/:id", auth.requireAuth, (req, res) => {
  const path = req.params.author + "/" + req.params.id;
  const post = sqlite.query("posts", { path: path });

  if (post) {
    res.render("new", {
      replying_to: parse_post(post),
    });
  } else {
    res.redirect("/new");
  }
});

app.get("/edit/:author/:id", auth.requireAuth, (req, res) => {
  const path = req.params.author + "/" + req.params.id;
  const post = sqlite.query("posts", { path: path });

  if (post && post.author === req.user.username) {
    res.render("edit", { edit_post: parse_post(post) });
  } else {
    res.redirect("/posts/" + path);
  }
});

app.post(
  "/edit/:author/:id",
  auth.requireAuth,
  upload.uploadMulter,
  async (req, res) => {
    const path = req.params.author + "/" + req.params.id;
    const existingPost = sqlite.query("posts", { path: path });

    if (!existingPost || existingPost.author !== req.user.username) {
      res.send({ message: "error" });
      return;
    }

    var post = {
      body: req.body.post.trim(),
      path: path,
    };

    try {
      // Save current history before modifying
      sqlite.insert("post_history", {
        path: path,
        body: existingPost.body,
        timestamp: existingPost.timestamp,
      });

      res.send({
        message: "post edited!",
        path: "posts/" + path,
      });
    } catch {
      console.error("error editing post.");
      for (let file of req.files) {
        fs.unlink(file.path, () => {});
      }
      res.send({ message: "error" });
      return;
    }

    try {
      for (let i = 0; i < req.files.length; i++) {
        req.files[i].temp_path = "media/" + i;
      }

      var files_not_uploaded = [...req.files];

      var promises = [];
      for (let file of files_not_uploaded) {
        promises.push(upload.storeMedia(file));
      }

      var urls = await Promise.allSettled(promises);
      for (let i = files_not_uploaded.length - 1; i >= 0; i--) {
        if (urls[i].status == "fulfilled") {
          post.body = post.body.replaceAll(
            `](${files_not_uploaded[i].temp_path})`,
            `](${urls[i].value})`,
          );
          files_not_uploaded.splice(i, 1);
        }
      }

      for (let file of req.files) {
        if (!file.stored) fs.unlink(file.path, () => {});
      }

      if (files_not_uploaded.length > 0) {
        throw new Error("files not fully uploaded.");
      }

      sqlite.update(
        "posts",
        { path: path },
        {
          body: post.body,
          edited: 1,
        },
      );
    } catch (e) {
      console.log(e);
      sqlite.delete("post_history", { path: path, body: existingPost.body });
    }
  },
);

app.post("/delete/:author/:id", auth.requireAuth, (req, res) => {
  const path = req.params.author + "/" + req.params.id;
  const post = sqlite.query("posts", { path: path });

  if (post && post.author === req.user.username) {
    sqlite.delete("posts", { path: path });
    sqlite.delete("post_history", { path: path });
  }

  res.redirect("/");
});

app.get("/history/:author/:id", (req, res) => {
  const path = req.params.author + "/" + req.params.id;
  const post = sqlite.query("posts", { path: path });

  if (!post || (post.live !== 1 && (!req.user || req.user.username !== post.author))) {
    return res.redirect("/posts/" + path);
  }

  const historyRows = sqlite.queryall(
    "post_history",
    { path: path },
    "ORDER BY history_id DESC",
  );
  const history = historyRows.map((row) => {
    let h = { ...post, body: row.body, timestamp: row.timestamp };
    return parse_post(h);
  });

  res.render("history", { post: parse_post(post), history });
});

app.get("/page/:pagenumber", requireContentAuth, (req, res) => {
  const page = Number(req.params.pagenumber) || 0;
  const feed = get_feed(page - 1);
  res.render("home", { feed: feed, page: page, max_page: get_max_page() });
});

app.get("/posts/:author/:id/is-live", requireContentAuth, (req, res) => {
  const path = req.params.author + "/" + req.params.id;
  const post = sqlite.query("posts", { path: path });
  if (post) {
    res.send({ live: post.live == 1 });
  } else {
    res.send({ live: null, post_not_found: true });
  }
});

// auth routes

app.get("/signup", (req, res) => {
  if (req.user) return res.redirect("/");
  res.render("signup");
});

app.post("/signup", (req, res) => {
  if (req.user) return res.redirect("/");

  const { username, password, confirm, invite_code } = req.body;

  // validation
  if (!username || !password || !confirm || !invite_code) {
    return res.render("signup", {
      error: "all fields are required",
      username,
      invite_code,
    });
  }

  if (username.length < 1 || username.length > 30) {
    return res.render("signup", {
      error: "username must be 1-30 characters",
      username,
      invite_code,
    });
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return res.render("signup", {
      error:
        "username can only contain letters, numbers, dashes, and underscores",
      username,
      invite_code,
    });
  }

  if (password.length < 4) {
    return res.render("signup", {
      error: "password must be at least 4 characters",
      username,
      invite_code,
    });
  }

  if (password !== confirm) {
    return res.render("signup", {
      error: "passwords do not match",
      username,
      invite_code,
    });
  }

  const result = auth.createUser(username, password, invite_code);

  if (result.error) {
    return res.render("signup", { error: result.error, username, invite_code });
  }

  // auto-login after signup
  const token = auth.createSession(result.userId);
  res.cookie("session", token, {
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    sameSite: "lax",
  });

  res.redirect("/");
});

app.get("/login", (req, res) => {
  if (req.user) return res.redirect("/");
  res.render("login");
});

app.post("/login", (req, res) => {
  if (req.user) return res.redirect("/");

  const { username, password } = req.body;

  if (!username || !password) {
    return res.render("login", {
      error: "username and password are required",
      username,
    });
  }

  const result = auth.loginUser(username, password);

  if (result.error) {
    return res.render("login", { error: result.error, username });
  }

  const token = auth.createSession(result.userId);
  res.cookie("session", token, {
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    sameSite: "lax",
  });

  res.redirect("/");
});

app.post("/logout", (req, res) => {
  auth.destroySession(req.cookies && req.cookies.session);
  res.clearCookie("session");
  res.redirect("/");
});

// admin routes

app.get("/admin", auth.requireAuth, auth.requireAdmin, (req, res) => {
  const invites = auth.getAllInviteCodes();
  res.render("admin", { invites });
});

app.post(
  "/api/admin/generate-invite",
  auth.requireAuth,
  auth.requireAdmin,
  (req, res) => {
    try {
      const code = auth.createInviteCode(req.user.user_id);
      res.json({ code });
    } catch (err) {
      res.json({ error: "failed to generate invite code" });
    }
  },
);

app.get("/settings", auth.requireAuth, (req, res) => {
  const apiKeys = auth.listApiKeys(req.user.user_id);
  const hooks = webhooks.listWebhooks(req.user.user_id);
  const userRow = sqlite.query("users", { user_id: req.user.user_id });

  res.render("settings", {
    apiKeys,
    hooks,
    accountCreatedAt: userRow ? userRow.created_at : null,
    profileBgColor: normalize_hex_color(userRow && userRow.profile_bg_color) || "#ffffff",
    newApiKey: req.query.new_api_key || null,
    created: req.query.created || null,
    error: req.query.error || null,
  });
});

app.post("/settings/profile", auth.requireAuth, upload.none, (req, res) => {
  const color = normalize_hex_color(req.body.profile_bg_color);
  if (!color) {
    return res.redirect(`/settings?error=${encodeURIComponent("profile color must be a full hex value like #80a2ff")}`);
  }

  sqlite.update("users", { user_id: req.user.user_id }, { profile_bg_color: color });
  return res.redirect("/settings?created=profile_updated");
});

app.post("/settings/api-keys/create", auth.requireAuth, upload.none, (req, res) => {
  try {
    const label = String(req.body.label || "default").trim() || "default";
    const key = auth.createApiKey(req.user.user_id, label);
    return res.redirect(`/settings?created=api_key&new_api_key=${encodeURIComponent(key)}`);
  } catch (err) {
    return res.redirect(`/settings?error=${encodeURIComponent("failed to create API key")}`);
  }
});

app.post("/settings/api-keys/:keyId/revoke", auth.requireAuth, (req, res) => {
  auth.revokeApiKey(req.user.user_id, req.params.keyId);
  return res.redirect("/settings?created=revoked");
});

app.post("/settings/webhooks/create", auth.requireAuth, upload.none, (req, res) => {
  const result = webhooks.createWebhook(req.user.user_id, req.body.url);
  if (result.error) {
    return res.redirect(`/settings?error=${encodeURIComponent(result.error)}`);
  }

  return res.redirect("/settings?created=webhook");
});

app.post("/settings/webhooks/:webhookId/delete", auth.requireAuth, (req, res) => {
  webhooks.deleteWebhook(req.user.user_id, req.params.webhookId);
  return res.redirect("/settings?created=webhook_removed");
});

app.post("/settings/password", auth.requireAuth, upload.none, (req, res) => {
  const currentPassword = String(req.body.current_password || "");
  const newPassword = String(req.body.new_password || "");
  const confirmPassword = String(req.body.confirm_password || "");

  if (newPassword !== confirmPassword) {
    return res.redirect(`/settings?error=${encodeURIComponent("new passwords do not match")}`);
  }

  const result = auth.changePassword(req.user.user_id, currentPassword, newPassword);
  if (result.error) {
    return res.redirect(`/settings?error=${encodeURIComponent(result.error)}`);
  }

  return res.redirect("/settings?created=password_updated");
});

app.post("/settings/sessions/revoke-others", auth.requireAuth, (req, res) => {
  const keepToken = req.cookies && req.cookies.session;
  auth.destroyOtherSessions(req.user.user_id, keepToken);
  return res.redirect("/settings?created=sessions_revoked");
});

app.get("/settings/export/posts.json", auth.requireAuth, (req, res) => {
  const posts = sqlite.db
    .prepare("SELECT * FROM posts WHERE author = ? ORDER BY timestamp DESC")
    .all(req.user.username);

  const postPaths = posts.map((p) => p.path);
  const history =
    postPaths.length > 0
      ? sqlite.db
          .prepare(
            `SELECT * FROM post_history WHERE path IN (${postPaths
              .map(() => "?")
              .join(",")}) ORDER BY history_id DESC`,
          )
          .all(...postPaths)
      : [];

  const payload = {
    exported_at: Date.now(),
    user: {
      user_id: req.user.user_id,
      username: req.user.username,
    },
    posts,
    post_history: history,
  };

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="haze-${req.user.username}-posts-export.json"`,
  );
  res.send(JSON.stringify(payload, null, 2));
});

app.get("/api/me", requireApiAuth, (req, res) => {
  res.send({
    user: {
      user_id: req.user.user_id,
      username: req.user.username,
      is_admin: req.user.is_admin,
      auth_type: req.user.auth_type,
    },
  });
});

app.get("/api/feed", requireApiAuth, (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  res.send({
    page,
    max_page: get_max_page(),
    posts: get_feed(page - 1),
  });
});

app.get("/api/posts", requireApiAuth, (req, res) => {
  const author = String(req.query.author || "").trim().toLowerCase();
  const posts = get_live_posts()
    .filter((post) => !author || post.author === author || post.author_path === author)
    .map((post) => parse_post(post));

  res.send({ posts });
});

app.get("/api/posts/:author/:id", requireApiAuth, (req, res) => {
  const path = req.params.author + "/" + req.params.id;
  const post = sqlite.query("posts", { path });
  if (!post || post.live !== 1) {
    return res.status(404).send({ message: "post not found" });
  }

  return res.send({ post: parse_post_with_replies(post) });
});

app.post("/api/posts", requireApiAuth, upload.none, (req, res) => {
  const body = String(req.body.body || "").trim();
  const replying_to = String(req.body.replying_to || "").trim() || null;

  if (!body) {
    return res.status(400).send({ message: "body is required" });
  }

  let path = get_author_path(req.user.username) + "/" + nanoid(8);
  let i = 0;
  while (sqlite.query("posts", { path })) {
    path = get_author_path(req.user.username) + "/" + nanoid(8);
    i++;
    if (i > 1000) {
      return res.status(429).send({ message: "post limit reached" });
    }
  }

  const post = {
    author: req.user.username,
    author_path: get_author_path(req.user.username),
    body,
    path,
    replying_to,
    live: 1,
    timestamp: create_timestamp(),
  };

  sqlite.insert("posts", post);
  sqlite.update("posts", { path: post.path }, { live: 1, timestamp: post.timestamp });

  webhooks.broadcastPostCreated(
    {
      path: post.path,
      author: post.author,
      author_path: post.author_path,
      title: get_post_title(post),
      text: get_post_embed_text(post.body),
      timestamp: post.timestamp,
      replying_to: post.replying_to,
    },
    get_base_url(req),
  );

  res.status(201).send({
    message: "post created",
    path: post.path,
    post: parse_post(post),
  });
});

app.put("/api/posts/:author/:id", requireApiAuth, upload.none, (req, res) => {
  const path = req.params.author + "/" + req.params.id;
  const existingPost = sqlite.query("posts", { path });
  if (!existingPost || existingPost.author !== req.user.username) {
    return res.status(403).send({ message: "forbidden" });
  }

  const body = String(req.body.body || "").trim();
  if (!body) return res.status(400).send({ message: "body is required" });

  sqlite.insert("post_history", {
    path,
    body: existingPost.body,
    timestamp: existingPost.timestamp,
  });

  sqlite.update("posts", { path }, { body, edited: 1 });
  return res.send({ message: "post edited", post: parse_post(sqlite.query("posts", { path })) });
});

app.delete("/api/posts/:author/:id", requireApiAuth, (req, res) => {
  const path = req.params.author + "/" + req.params.id;
  const post = sqlite.query("posts", { path });

  if (!post || post.author !== req.user.username) {
    return res.status(403).send({ message: "forbidden" });
  }

  sqlite.delete("posts", { path });
  sqlite.delete("post_history", { path });

  return res.send({ message: "post deleted" });
});

function render_author_profile(req, res, mode) {
  const authorPath = req.params.author;
  const postsByAuthor = get_live_posts().filter((post) => post.author_path === authorPath);

  if (postsByAuthor.length === 0) {
    return res.status(404).render("index", {
      title: `posts by <em>${authorPath}</em>`,
      posts: [],
    });
  }

  const profileUser = get_user_by_author_path(authorPath) || { username: postsByAuthor[0].author, created_at: null, profile_bg_color: null };
  const profileColor = normalize_hex_color(profileUser.profile_bg_color);

  const stats = {
    total: postsByAuthor.length,
    posts: postsByAuthor.filter((post) => !post.replying_to).length,
    replies: postsByAuthor.filter((post) => !!post.replying_to).length,
    media: postsByAuthor.filter((post) => has_media_markdown(post.body)).length,
  };

  let filtered = postsByAuthor;
  if (mode === "posts") {
    filtered = postsByAuthor.filter((post) => !post.replying_to);
  } else if (mode === "replies") {
    filtered = postsByAuthor.filter((post) => !!post.replying_to);
  } else if (mode === "media") {
    filtered = postsByAuthor.filter((post) => has_media_markdown(post.body));
  }

  res.render("profile", {
    profile: {
      username: profileUser.username,
      author_path: authorPath,
      created_at: profileUser.created_at,
      bg_color: profileColor,
      stats,
      mode,
    },
    posts: filtered.map((post) => parse_post_minimal(post)),
  });
}

function get_max_page() {
  let stmt = sqlite.db.prepare(
    "SELECT COUNT(*) AS count FROM posts WHERE live = 1",
  );
  return Math.ceil(stmt.get().count / POSTS_PER_PAGE);
}

function get_feed(page) {
  const posts = get_live_posts().slice(
    page * POSTS_PER_PAGE,
    page * POSTS_PER_PAGE + POSTS_PER_PAGE,
  );
  var feed = [];
  for (let post of posts) {
    feed.push(parse_post(post));
  }
  return feed;
}

// post

app.get("/api/users/search", requireContentAuth, (req, res) => {
  const q = String(req.query.q || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 30);

  if (!q) {
    return res.send({ users: [] });
  }

  const users = sqlite.db
    .prepare(
      "SELECT username FROM users WHERE username LIKE ? ORDER BY username ASC LIMIT 8",
    )
    .all(q + "%")
    .map((user) => ({
      username: user.username,
      path: get_author_path(user.username),
    }));

  res.send({ users });
});

app.post("/api/preview", requireContentAuth, upload.none, async (req, res) => {
  res.send({
    post: parse_markdown(req.body.post),
  });
});

app.post(
  "/publish",
  auth.requireAuth,
  upload.uploadMulter,
  async (req, res) => {
    var post;

    try {
      var replying_to = req.body.replying_to.trim();
      if (replying_to == "") {
        replying_to = null;
      }

      // use the logged-in user's username
      var name = req.user.username;

      const body = req.body.post.trim();
      var path = get_author_path(name) + "/" + nanoid(8);

      var i = 0;
      while (sqlite.query("posts", { path: path })) {
        path = get_author_path(name) + "/" + nanoid(8);
        i++;
        if (i > 1000) {
          throw new Error(`reached post limit for ${get_author_path(name)}`);
        }
      }

      post = {
        author: name,
        author_path: get_author_path(name),
        body,
        path,
        replying_to,
        live: 0,
      };

      sqlite.insert("posts", post);

      res.send({
        message: "post added!",
        path: "posts/" + path,
      });
    } catch {
      console.error("error creating post.");
      if (post) sqlite.delete("posts", { path: post.path });
      for (let file of req.files) {
        fs.unlink(file.path, () => {});
      }
      res.send({ message: "error" });
      return;
    }

    try {
      for (let i = 0; i < req.files.length; i++) {
        req.files[i].temp_path = "media/" + i;
      }

      var files_not_uploaded = [...req.files];

      var promises = [];
      for (let file of files_not_uploaded) {
        promises.push(upload.storeMedia(file));
      }

      var urls = await Promise.allSettled(promises);
      for (let i = files_not_uploaded.length - 1; i >= 0; i--) {
        if (urls[i].status == "fulfilled") {
          post.body = post.body.replaceAll(
            `](${files_not_uploaded[i].temp_path})`,
            `](${urls[i].value})`,
          );
          files_not_uploaded.splice(i, 1);
        }
      }

      for (let file of req.files) {
        if (!file.stored) fs.unlink(file.path, () => {});
      }

      if (files_not_uploaded.length > 0) {
        throw new Error("files not fully uploaded.");
      }

      sqlite.update(
        "posts",
        { path: post.path },
        {
          body: post.body,
          live: 1,
          timestamp: create_timestamp(),
        },
      );

      if (post.replying_to) {
        const reply_author = sqlite.query("posts", {
          path: post.replying_to,
        }).author;
        push.broadcast(
          `${post.author} replied to ${reply_author}'s post`,
          "/posts/" + post.path,
          req.body.endpoint,
        );
      } else {
        push.broadcast(
          `${post.author} wrote a new post`,
          "/posts/" + post.path,
          req.body.endpoint,
        );
      }

      await webhooks.broadcastPostCreated(
        {
          path: post.path,
          author: post.author,
          author_path: post.author_path,
          title: get_post_title(post),
          text: get_post_embed_text(post.body),
          timestamp: create_timestamp(),
          replying_to: post.replying_to,
        },
        get_base_url(req),
      );
    } catch {
      console.error("error uploading files.");
      sqlite.update("posts", { path: post.path }, { live: 0 });
      for (let file of req.files) {
        fs.unlink(file.path, () => {});
      }
    }
  },
);

app.post("/subscribe", upload.none, (req, res) => {
  try {
    var sub = JSON.parse(req.body.data);
    var sub_exists = sqlite.query("subscriptions", { endpoint: sub.endpoint });

    if (sub_exists) {
      push.send(
        sub,
        "notifications already enabled",
        "to turn them off, consult your site or app settings.",
      );
    } else {
      sqlite.insert("subscriptions", {
        timestamp: create_timestamp(),
        json: req.body.data,
        endpoint: sub.endpoint,
      });

      push.send(
        sub,
        "notifications enabled!",
        "to turn them off, consult your site or app settings.",
      );
    }

    res.send({
      message: "subscription successful",
    });
  } catch (error) {
    console.error("subscribe error " + error.statusCode);
    res.send({ message: "error" });
  }
});

function get_live_posts() {
  return sqlite.queryall(
    "posts",
    {
      live: 1,
    },
    "ORDER BY timestamp DESC",
  );
}

function get_author_path(name) {
  return name.replace(/[^a-z0-9]/gi, "-").toLowerCase();
}

function parse_post(post) {
  var reply_count = 0;
  for (let reply of get_live_posts()) {
    if (reply.replying_to && reply.replying_to == post.path) reply_count++;
  }

  return {
    title: get_post_title(post),
    timestamp: post.timestamp,
    author: post.author,
    author_path: post.author_path,
    preview_body: get_body_preview(post.body),
    body: parse_markdown(post.body),
    path: post.path,
    reply_count: reply_count,
    replying_to: post.replying_to
      ? parse_post_minimal(sqlite.query("posts", { path: post.replying_to }))
      : null,
    live: post.live == 1 ? true : false,
    raw_body: post.body,
    edited: post.edited === 1,
  };
}

function parse_post_with_replies(post) {
  var parsed = parse_post(post);

  parsed.replies = [];
  for (let reply of get_live_posts()) {
    if (reply.replying_to && reply.replying_to == post.path) {
      parsed.replies.push(parse_post(reply));
    }
  }

  return parsed;
}

function parse_post_minimal(post) {
  return {
    title: get_post_title(post),
    timestamp: post.timestamp,
    author: post.author,
    author_path: post.author_path,
    path: post.path,
    edited: post.edited === 1,
  };
}

function parse_markdown(markdown) {
  markdown = markdown.replaceAll("> ", "&gt; ");
  markdown = link_mentions(markdown);

  // search for albums
  let search = "![album]";
  let index = markdown.indexOf(search);
  while (index != -1) {
    let split = markdown.split(search);
    let split2 = split[1].split(")\r\n)");
    let in_between = split2[0].split(")\r\n)")[0].slice(3);
    let before = split[0];
    let after =
      (split2.length > 1 ? split2.slice(1).join(")\n)") : "") +
      (split.length > 2 ? search + split.slice(2).join(search) : "");

    in_between = in_between.trim().split(",").join("") + ")";

    markdown = `${before}<div class='album block' data-type='album'>`;
    markdown += `<div class='slides-wrapper'><div class='slides'>\r\n    ${in_between}\r\n</div></div>`;
    markdown += `</div>${after}`;

    index = markdown.indexOf(search);
  }

  const media_tags = ["image", "audio", "video"];

  for (let tag of media_tags) {
    let search = "![" + tag + "]";
    let index = markdown.indexOf(search);
    while (index != -1) {
      let split = markdown.split(search);
      let split2 = split[1].split(/[()]/g);
      let src = split2[1];
      let before = split[0];
      let after =
        (split2.length > 2 ? split[1].replace("(" + src + ")", "") : "") +
        (split.length > 2 ? search + split.slice(2).join(search) : "");

      let element = `<div class='${tag} block' data-type='${tag}'>`;

      switch (tag) {
        case "image":
          element += `<img src='${src}'>`;
          break;
        case "audio":
          let type = "";
          let s = src.split(".");
          if (s.length > 0) {
            type = s[s.length - 1];
          }
          if (type === "m4a") {
            element += `<audio controls preload="metadata">
                            <source src='${src}' type='audio/x-m4a'>
                        </audio>`;
          } else if (type === "mp3") {
            element += `<audio controls preload="metadata">
                            <source src='${src}' type='audio/mpeg'>
                        </audio>`;
          } else {
            element += `<audio controls preload="metadata">
                            <source src='${src}' type='audio/${type}'>
                        </audio>`;
          }
          break;
        case "video":
          element += `<video controls><source src='${src}'></video>`;
          break;
      }

      element += `</div>`;

      markdown = before + element + after;

      index = markdown.indexOf(search);
    }
  }

  markdown = markdown.replace(/(.)\\r\\n(?!\\r\\n)/g, "$1  \\r\\n");

  markdown = sanitize(markdown, {
    allowedTags: sanitize.defaults.allowedTags.concat([
      "img",
      "audio",
      "video",
      "embed",
      "source",
    ]),
    allowedAttributes: false,
    nonBooleanAttributes: [],
    parser: {
      lowerCaseTags: false,
      lowerCaseAttributeNames: false,
    },
  });

  return enhance_links(marked.parse(markdown));
}

function link_mentions(markdown) {
  return markdown.replace(
    /(^|[^\w/])@([a-zA-Z0-9_-]{1,30})\b/g,
    (match, before, username) => {
      const user = sqlite.query("users", { username: username.toLowerCase() });
      if (!user) return match;

      return `${before}[@${user.username}](/posts/${get_author_path(user.username)})`;
    },
  );
}

function enhance_links(html) {
  return html.replace(
    /<a href="(https?:\/\/[^"\s]+)"/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer"',
  );
}

function get_post_title(post) {
  var title = post.body.split("\n")[0];
  if (title != "") {
    title = title.substring(0, MAX_TITLE_LENGTH);
  }

  if (title.includes("![album](")) title = "[album]";
  else if (title.includes("![image]")) title = "[image]";
  else if (title.includes("![audio]")) title = "[audio]";

  return title.trim();
}

function get_body_preview(body) {
  return parse_markdown(body.split("\r\n---\r\n")[0]);
}

function get_post_embed_text(body) {
  const collapsed = String(body || "")
    .replace(/!\[(album|image|audio|video)\]\([^)]*\)/gi, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/[\*_`>#~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return collapsed.length > 220
    ? collapsed.slice(0, 217).trim() + "..."
    : collapsed || "private post on haze";
}

function has_media_markdown(body) {
  return /!\[(album|image|audio|video)\]\(/i.test(String(body || ""));
}

function normalize_hex_color(value) {
  const str = String(value || "").trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(str)) return null;
  return str.toLowerCase();
}

function get_user_by_author_path(authorPath) {
  const users = sqlite.db.prepare("SELECT username, created_at, profile_bg_color FROM users ORDER BY user_id ASC").all();
  for (let user of users) {
    if (get_author_path(user.username) === authorPath) return user;
  }
  return null;
}

function get_base_url(req) {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  }

  const host = req.get("host");
  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
  return `${protocol}://${host}`;
}

function get_absolute_request_url(req, pathname) {
  return `${get_base_url(req)}${pathname}`;
}

function create_timestamp() {
  return new Date().getTime();
}

// https://www.npmjs.com/package/nanoid
function nanoid(e = 21) {
  let a = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
  let t = "",
    r = crypto.getRandomValues(new Uint8Array(e));
  for (let n = 0; n < e; n++) t += a[63 & r[n]];
  return t;
}

app.listen(port, () => {
  console.log(`server listening on port ${port}.`);
});
