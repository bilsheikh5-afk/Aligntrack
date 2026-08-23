const bcrypt = require("bcryptjs");
const { pool } = require("./db");

async function register(req, res) {
  const { email, password, name, inviteCode } = req.body;
  if (!email || !password || !inviteCode) {
    return res.status(400).json({ error: "email, password, and inviteCode are required" });
  }

  const { rows: codes } = await pool.query(
    "SELECT * FROM invite_codes WHERE code = $1 AND used_by IS NULL",
    [inviteCode]
  );
  if (codes.length === 0) {
    return res.status(400).json({ error: "Invalid or already-used invite code" });
  }

  const { rows: existing } = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.length > 0) {
    return res.status(400).json({ error: "An account with that email already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const { rows: inserted } = await pool.query(
    "INSERT INTO users (email, password_hash, role, name) VALUES ($1,$2,$3,$4) RETURNING id, email, role, name",
    [email, passwordHash, codes[0].role, name || null]
  );
  const user = inserted[0];

  await pool.query("UPDATE invite_codes SET used_by = $1 WHERE code = $2", [user.id, inviteCode]);

  req.session.userId = user.id;
  res.json({ user });
}

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }
  const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
  if (rows.length === 0) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const user = rows[0];
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  req.session.userId = user.id;
  res.json({ user: { id: user.id, email: user.email, role: user.role, name: user.name } });
}

function logout(req, res) {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
}

async function me(req, res) {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
  const { rows } = await pool.query(
    "SELECT id, email, role, name FROM users WHERE id = $1",
    [req.session.userId]
  );
  if (rows.length === 0) return res.status(401).json({ error: "Not logged in" });
  res.json({ user: rows[0] });
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Login required" });
  }
  next();
}

module.exports = { register, login, logout, me, requireAuth };
