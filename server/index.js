require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { pool, initSchema } = require("./db");
const authRoutes = require("./auth");

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "10mb" }));

app.use(
  session({
    store: new pgSession({ pool, tableName: "session", createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || "change-this-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    },
  })
);

app.use(express.static(path.join(__dirname, "..", "public")));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

// ---------- Health ----------
app.get("/api/health", (req, res) => {
  res.json({ ok: true, geminiConfigured: !!GEMINI_API_KEY });
});

// ---------- TEMPORARY DEBUG ROUTE - remove after troubleshooting ----------
app.get("/api/debug-status", async (req, res) => {
  if (req.query.key !== "debug123") return res.status(403).json({ error: "wrong key" });
  const codes = await pool.query("SELECT code, role, used_by, created_at FROM invite_codes");
  const users = await pool.query("SELECT id, email, role, created_at FROM users");
  res.json({ invite_codes: codes.rows, users: users.rows });
});

// ---------- Auth ----------
app.post("/api/auth/register", authRoutes.register);
app.post("/api/auth/login", authRoutes.login);
app.post("/api/auth/logout", authRoutes.logout);
app.get("/api/auth/me", authRoutes.me);

// ---------- Everything below requires login ----------
app.use("/api/cases", authRoutes.requireAuth);

app.get("/api/cases", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM cases ORDER BY updated_at DESC");
  const withDetails = await Promise.all(
    rows.map(async (c) => {
      const notes = await pool.query(
        "SELECT text, source, created_at FROM notes WHERE case_id = $1 ORDER BY created_at ASC",
        [c.id]
      );
      const photos = await pool.query(
        "SELECT analysis, created_at FROM photo_analyses WHERE case_id = $1 ORDER BY created_at ASC",
        [c.id]
      );
      return { ...toClientCase(c), notes: notes.rows, photos: photos.rows };
    })
  );
  res.json(withDetails);
});

app.get("/api/cases/:id", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM cases WHERE id = $1", [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: "Case not found" });
  res.json(toClientCase(rows[0]));
});

app.patch("/api/cases/:id", async (req, res) => {
  const { status, stage, flagged, wearHoursAvg } = req.body;
  const { rows } = await pool.query(
    `UPDATE cases SET
       status = COALESCE($1, status),
       stage = COALESCE($2, stage),
       flagged = COALESCE($3, flagged),
       wear_hours_avg = COALESCE($4, wear_hours_avg),
       updated_at = now()
     WHERE id = $5 RETURNING *`,
    [status, stage, flagged, wearHoursAvg, req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: "Case not found" });
  res.json(toClientCase(rows[0]));
});

// ---------- Gemini: coaching note ----------
app.post("/api/cases/:id/ai-coaching-note", async (req, res) => {
  if (!genAI) return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });

  const { rows } = await pool.query("SELECT * FROM cases WHERE id = $1", [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: "Case not found" });
  const c = rows[0];

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const prompt = `You are a clear-aligner compliance coach writing a short note for a dentist about their patient.
Patient: ${c.patient}
Case type: ${c.type}
Current stage: ${c.stage}
Average daily wear: ${c.wear_hours_avg ? c.wear_hours_avg + "h (target 22h)" : "not yet tracked"}
Flagged for attention: ${c.flagged}

Write a 2-3 sentence clinical note for the dentist: state the compliance risk level plainly, and suggest one concrete next action. Plain text, no markdown, no preamble.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    await pool.query(
      "INSERT INTO notes (case_id, text, source) VALUES ($1, $2, 'gemini')",
      [c.id, text]
    );

    res.json({ note: text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gemini request failed", detail: err.message });
  }
});

// ---------- Gemini: photo analysis ----------
app.post("/api/cases/:id/ai-photo-analysis", upload.single("photo"), async (req, res) => {
  if (!genAI) return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
  if (!req.file) return res.status(400).json({ error: "No photo uploaded" });

  const { rows } = await pool.query("SELECT * FROM cases WHERE id = $1", [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: "Case not found" });
  const c = rows[0];

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const imagePart = {
      inlineData: { data: req.file.buffer.toString("base64"), mimeType: req.file.mimetype },
    };
    const prompt = `You are assisting a dental technologist reviewing a clear aligner fit-check photo for patient ${c.patient} (case ${c.id}, stage ${c.stage}).
Look at the photo and describe: 1) whether the aligner appears fully seated, 2) any visible gaps, cracking, or debris, 3) one recommended action.
Keep it to 3 short sentences, plain text, no markdown. If the image is unclear or not a dental photo, say so plainly instead of guessing.`;

    const result = await model.generateContent([prompt, imagePart]);
    const text = result.response.text().trim();

    await pool.query(
      "INSERT INTO photo_analyses (case_id, analysis) VALUES ($1, $2)",
      [c.id, text]
    );

    res.json({ analysis: text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gemini vision request failed", detail: err.message });
  }
});

function toClientCase(row) {
  return {
    id: row.id,
    patient: row.patient,
    type: row.type,
    status: row.status,
    stage: row.stage,
    lab: row.lab,
    wearHoursAvg: row.wear_hours_avg,
    flagged: row.flagged,
    updated: row.updated_at,
  };
}

// SPA fallback
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`AlignTrack AI running on port ${PORT}`);
      console.log(`Gemini configured: ${!!GEMINI_API_KEY}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database schema:", err);
    process.exit(1);
  });
