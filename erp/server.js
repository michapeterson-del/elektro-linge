#!/usr/bin/env node
/* =====================================================================
   Elektro Linge ERP – Server (optional, ohne Abhängigkeiten)

   Start:  ERP_PASSWORT="geheim" node erp/server.js
   Dann:   http://localhost:8080/erp/

   - speichert alle ERP-Daten zentral in erp/daten/erp-db.json
     (tägliche Sicherungskopie in erp/daten/sicherungen/)
   - nimmt Website-Anfragen unter POST /api/leads entgegen (Lead-Eingang)
   - mehrere Geräte (Büro, Handy, Tablet) arbeiten mit denselben Daten

   Umgebungsvariablen:
     ERP_PASSWORT      Pflicht – Passwort für die Anmeldung
     PORT              Standard 8080
     ERP_DATEN         Ordner für die Daten (Standard: erp/daten)
     ERP_LEAD_ORIGINS  erlaubte Absender-Websites für /api/leads,
                       Standard: https://elektrolinge.de,https://www.elektrolinge.de
   ===================================================================== */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 8080;
const PASSWORT = process.env.ERP_PASSWORT || process.env.ERP_PASSWORD || "";
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.resolve(process.env.ERP_DATEN || path.join(__dirname, "daten"));
const DB_FILE = path.join(DATA_DIR, "erp-db.json");
const INBOX_FILE = path.join(DATA_DIR, "eingang.json");
const SECRET_FILE = path.join(DATA_DIR, ".secret");
const BACKUP_DIR = path.join(DATA_DIR, "sicherungen");
const ORIGINS = (process.env.ERP_LEAD_ORIGINS || "https://elektrolinge.de,https://www.elektrolinge.de").split(",").map((s) => s.trim()).filter(Boolean);

if (PASSWORT.length < 6) {
  console.error("Bitte ein Passwort mit mindestens 6 Zeichen setzen, z. B.:\n  ERP_PASSWORT=\"mein-sicheres-passwort\" node erp/server.js");
  process.exit(1);
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
const SECRET = fs.readFileSync(SECRET_FILE, "utf8").trim();

// ---------- Speicher ----------
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, data) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}
let state = readJson(DB_FILE, { version: 0, db: null });
let inbox = readJson(INBOX_FILE, []);

function backupDaily() {
  if (!state.db) return;
  const f = path.join(BACKUP_DIR, `erp-db-${new Date().toISOString().slice(0, 10)}.json`);
  if (!fs.existsSync(f)) {
    fs.copyFileSync(DB_FILE, f);
    // nur die letzten 60 Tagessicherungen behalten
    const files = fs.readdirSync(BACKUP_DIR).filter((x) => x.startsWith("erp-db-")).sort();
    files.slice(0, Math.max(0, files.length - 60)).forEach((x) => fs.unlinkSync(path.join(BACKUP_DIR, x)));
  }
}

// ---------- Anmeldung (signierte Tokens, überstehen Neustarts) ----------
const sign = (v) => crypto.createHmac("sha256", SECRET + PASSWORT).update(v).digest("base64url");
function makeToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 30 * 86400000, n: crypto.randomBytes(6).toString("hex") })).toString("base64url");
  return payload + "." + sign(payload);
}
function checkToken(req) {
  const t = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const [payload, sig] = t.split(".");
  if (!payload || !sig) return false;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try { return JSON.parse(Buffer.from(payload, "base64url").toString()).exp > Date.now(); } catch { return false; }
}

// ---------- einfache Begrenzung gegen Missbrauch ----------
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  return list.length > max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 3600000)) hits.delete(k); }, 600000).unref();

// ---------- HTTP-Hilfen ----------
const ip = (req) => (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress;
function send(res, status, body, headers = {}) {
  const isObj = typeof body === "object" && !Buffer.isBuffer(body);
  res.writeHead(status, {
    "Content-Type": isObj ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error("zu groß"), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function parseForm(text, type) {
  if ((type || "").includes("application/json")) return JSON.parse(text || "{}");
  return Object.fromEntries(new URLSearchParams(text));
}
const str = (v, max) => String(v ?? "").trim().slice(0, max);

// ---------- statische Dateien ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json" };
const ALLOWED = [/^\/erp\/(index\.html|app\.js|erp\.css)?$/, /^\/assets\/fonts\/[\w.-]+\.woff2$/, /^\/assets\/logo-mark-(navy|white)\.png$/, /^\/css\/fonts\.css$/, /^\/(favicon[\w-]*\.(png|ico)|apple-touch-icon\.png)$/];
function serveStatic(req, res, pathname) {
  if (pathname === "/" || pathname === "/erp") { res.writeHead(302, { Location: "/erp/" }); res.end(); return; }
  if (!ALLOWED.some((r) => r.test(pathname))) { send(res, 404, "Nicht gefunden"); return; }
  const file = path.join(ROOT, pathname.endsWith("/") ? pathname + "index.html" : pathname);
  if (!file.startsWith(ROOT + path.sep)) { send(res, 404, "Nicht gefunden"); return; }
  fs.readFile(file, (err, data) => {
    if (err) { send(res, 404, "Nicht gefunden"); return; }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
      "Cache-Control": /\.(woff2|png|ico)$/.test(file) ? "public, max-age=604800" : "no-cache",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "same-origin",
    });
    res.end(data);
  });
}

// ---------- API ----------
async function api(req, res, pathname) {
  const origin = req.headers.origin || "";

  // Öffentlicher Lead-Eingang (für das Kontaktformular der Website)
  if (pathname === "/api/leads") {
    const cors = ORIGINS.includes(origin) || ORIGINS.includes("*") ? { "Access-Control-Allow-Origin": origin || "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Accept", Vary: "Origin" } : {};
    if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
    if (req.method !== "POST") { send(res, 405, { error: "Nur POST" }, cors); return; }
    if (origin && !cors["Access-Control-Allow-Origin"]) { send(res, 403, { error: "Absender nicht erlaubt" }); return; }
    if (limited("lead:" + ip(req), 10, 3600000)) { send(res, 429, { error: "Zu viele Anfragen" }, cors); return; }
    let d;
    try { d = parseForm(await readBody(req, 20000), req.headers["content-type"]); } catch (e) { send(res, e.status || 400, { error: "Ungültige Daten" }, cors); return; }
    if (d._honey) { send(res, 200, { ok: true }, cors); return; } // Spam-Falle der Website
    const lead = {
      id: crypto.randomUUID(), at: Date.now(),
      name: str(d.name, 120), email: str(d.email, 160), phone: str(d.phone || d.telefon, 60),
      thema: str(d.topic || d.thema, 80), nachricht: str(d.message || d.nachricht, 5000),
      plzOrt: str(d.ort || d.plzOrt, 120), strasse: str(d.strasse, 120), quelle: str(d.quelle, 30) || "Website",
    };
    if (!lead.name || (!lead.email && !lead.phone)) { send(res, 400, { error: "Name und E-Mail oder Telefon erforderlich" }, cors); return; }
    if (inbox.length > 2000) { send(res, 503, { error: "Eingang voll" }, cors); return; }
    inbox.push(lead);
    writeJson(INBOX_FILE, inbox);
    console.log(`[Lead] ${new Date().toLocaleString("de-DE")} – ${lead.name} (${lead.thema || "ohne Thema"})`);
    send(res, 200, { ok: true }, cors);
    return;
  }

  if (pathname === "/api/status") { send(res, 200, { erpServer: true }); return; }

  if (pathname === "/api/login" && req.method === "POST") {
    if (limited("login:" + ip(req), 10, 15 * 60000)) { send(res, 429, { error: "Zu viele Versuche" }); return; }
    let d;
    try { d = JSON.parse(await readBody(req, 2000)); } catch { send(res, 400, { error: "Ungültig" }); return; }
    const a = crypto.createHash("sha256").update(String(d.passwort || "")).digest();
    const b = crypto.createHash("sha256").update(PASSWORT).digest();
    if (!crypto.timingSafeEqual(a, b)) { send(res, 401, { error: "Passwort falsch" }); return; }
    send(res, 200, { token: makeToken() });
    return;
  }

  if (!checkToken(req)) { send(res, 401, { error: "Nicht angemeldet" }); return; }

  if (pathname === "/api/version" && req.method === "GET") { send(res, 200, { version: state.version, eingang: inbox.length }); return; }
  if (pathname === "/api/db" && req.method === "GET") { send(res, 200, state); return; }
  if (pathname === "/api/db" && req.method === "PUT") {
    let d;
    try { d = JSON.parse(await readBody(req, 50 * 1024 * 1024)); } catch (e) { send(res, e.status || 400, { error: "Ungültige Daten" }); return; }
    if (!d.db || typeof d.db !== "object" || !d.db.settings) { send(res, 400, { error: "Ungültige Datenbank" }); return; }
    if (d.baseVersion !== state.version) { send(res, 409, { error: "Konflikt", version: state.version }); return; }
    state = { version: state.version + 1, db: d.db };
    writeJson(DB_FILE, state);
    backupDaily();
    send(res, 200, { version: state.version });
    return;
  }
  if (pathname === "/api/eingang" && req.method === "GET") { send(res, 200, inbox); return; }
  if (pathname === "/api/eingang/abholen" && req.method === "POST") {
    let d;
    try { d = JSON.parse(await readBody(req, 200000)); } catch { send(res, 400, { error: "Ungültig" }); return; }
    const ids = new Set(Array.isArray(d.ids) ? d.ids : []);
    inbox = inbox.filter((l) => !ids.has(l.id));
    writeJson(INBOX_FILE, inbox);
    send(res, 200, { ok: true, rest: inbox.length });
    return;
  }
  send(res, 404, { error: "Unbekannt" });
}

http.createServer(async (req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { send(res, 400, "Ungültige Adresse"); return; }
  try {
    if (pathname.startsWith("/api/")) await api(req, res, pathname);
    else if (req.method === "GET" || req.method === "HEAD") serveStatic(req, res, pathname);
    else send(res, 405, "Nicht erlaubt");
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: "Serverfehler" });
  }
}).listen(PORT, () => {
  console.log(`Elektro Linge ERP läuft: http://localhost:${PORT}/erp/`);
  console.log(`Daten: ${DATA_DIR}`);
  console.log(`Lead-Eingang: POST http://localhost:${PORT}/api/leads (erlaubt von: ${ORIGINS.join(", ")})`);
});
