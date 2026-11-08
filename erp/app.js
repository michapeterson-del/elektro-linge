/* =====================================================================
   Elektro Linge ERP
   Anfragen → Kundenreise → Kunden → Angebote → Rechnungen, Artikel, Lager
   Läuft ohne Installation im Browser (Daten im Browser-Speicher) oder –
   wenn über erp/server.js gestartet – mit zentraler Datenbank und
   automatischem Lead-Eingang (siehe erp/README.md).
   ===================================================================== */
"use strict";

// ---------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => (window.crypto?.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const pad = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => toISO(new Date());
const addDays = (iso, n) => { const d = new Date((iso || todayISO()) + "T12:00:00"); d.setDate(d.getDate() + Number(n || 0)); return toISO(d); };
const fmtDate = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "");
const fmtDateTime = (ts) => new Date(ts).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const EUR = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const eur = (n) => EUR.format(Number(n) || 0);
const num = (n, d = 2) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: d }).format(Number(n) || 0);
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const parseNum = (s) => {
  if (typeof s === "number") return isFinite(s) ? s : 0;
  let t = String(s ?? "").trim().replace(/[\s€%]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(t);
  return isFinite(n) ? n : 0;
};
const inNum = (n, min = 2) => (Number(n) || 0).toLocaleString("de-DE", { minimumFractionDigits: min, maximumFractionDigits: 3, useGrouping: false });
const clean = (s) => String(s ?? "").trim();
const lc = (s) => String(s ?? "").toLowerCase();
const daysBetween = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000);
const relTime = (ts) => {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "gerade eben";
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.round(m / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.round(h / 24);
  if (d === 1) return "gestern";
  if (d < 30) return `vor ${d} Tagen`;
  return fmtDate(toISO(new Date(ts)));
};
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const download = (name, text, type = "text/plain") => {
  const blob = new Blob([text], { type: type + ";charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
};
const toCSV = (rows, cols) => "﻿" + [cols.map((c) => c[0]).join(";"), ...rows.map((r) => cols.map((c) => {
  const v = c[1](r);
  const s = typeof v === "number" ? String(v).replace(".", ",") : String(v ?? "");
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(";"))].join("\r\n");
const parseCSV = (text) => {
  text = text.replace(/^﻿/, "");
  const first = text.split(/\r?\n/)[0] || "";
  const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ";" : ",";
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i++; }
      else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(f); f = ""; if (row.some((x) => x.trim())) rows.push(row); row = [];
    } else f += c;
  }
  row.push(f); if (row.some((x) => x.trim())) rows.push(row);
  return rows;
};
const phoneDigits = (p) => {
  let d = String(p || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = "49" + d.slice(1);
  return d;
};
async function sha256(text) {
  if (window.crypto?.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  let h = 0; for (const c of text) h = (h * 31 + c.charCodeAt(0)) | 0; return "x" + h; // Notlösung ohne HTTPS
}

// ---------------------------------------------------------------------
// Stammdaten der Anwendung
// ---------------------------------------------------------------------
const STAGES = [
  { id: "neu", label: "Neue Anfrage", hint: "Noch nicht bearbeitet" },
  { id: "kontakt", label: "Kontakt aufgenommen", hint: "Angerufen / geschrieben" },
  { id: "termin", label: "Vor-Ort-Termin", hint: "Besichtigung geplant" },
  { id: "angebot", label: "Angebot verschickt", hint: "Wartet auf Antwort" },
  { id: "auftrag", label: "Auftrag erteilt", hint: "Angebot angenommen" },
  { id: "ausfuehrung", label: "In Ausführung", hint: "Arbeiten laufen" },
  { id: "abgeschlossen", label: "Abgeschlossen", hint: "Fertig & bezahlt" },
];
const LOST = { id: "verloren", label: "Verloren", hint: "Kein Auftrag" };
const ALL_STAGES = [...STAGES, LOST];
const stageIdx = (id) => STAGES.findIndex((s) => s.id === id);
const stageLabel = (id) => ALL_STAGES.find((s) => s.id === id)?.label || id;
const ACTIVE_STAGES = ["neu", "kontakt", "termin", "angebot", "auftrag", "ausfuehrung"];

const QUELLEN = ["Website", "Telefon", "WhatsApp", "E-Mail", "Empfehlung", "Google", "Bestandskunde", "Sonstiges"];
const THEMEN = ["Elektroinstallation", "Altbausanierung", "Zählerschrank / Verteilung", "Wallbox / E-Mobilität", "Photovoltaik / Speicher", "Balkonkraftwerk", "Smart Home", "Beleuchtung", "E-Check / Prüfung", "Reparatur / Störung", "Sonstiges"];
const EINHEITEN = ["Stk", "m", "Std", "psch", "m²", "Set", "kg", "km"];
const KATEGORIEN = ["Arbeitszeit", "Installation", "Verteilung & Schutz", "Kabel & Leitungen", "Photovoltaik", "E-Mobilität", "Beleuchtung", "Smart Home", "Prüfung & Service", "Sonstiges"];
const ARTEN = { material: "Material", lohn: "Arbeitszeit / Lohn", leistung: "Leistung / Pauschale" };
const AKT = { notiz: ["✎", "Notiz"], anruf: ["☎", "Anruf"], email: ["✉", "E-Mail"], termin: ["◷", "Termin"], system: ["⚡", "System"] };
const ANG_STATUS = { entwurf: ["Entwurf", ""], versendet: ["Versendet", "blue"], angenommen: ["Angenommen", "green"], abgelehnt: ["Abgelehnt", "red"] };
const RE_STATUS = { entwurf: ["Entwurf", ""], offen: ["Offen", "blue"], bezahlt: ["Bezahlt", "green"], storniert: ["Storniert", "red"] };

function defaultDb() {
  const y = new Date().getFullYear();
  return {
    meta: { schema: 1, createdAt: Date.now(), updatedAt: Date.now(), lastBackup: null },
    settings: {
      firma: {
        name: "Elektro Linge GmbH i.G.",
        zusatz: "Elektrotechnik · Photovoltaik · E-Mobilität",
        inhaber: "Evelyn Foth",
        strasse: "Höher Birken 3",
        plzOrt: "51709 Marienheide-Rodt",
        telefon: "0163 / 634 59 98",
        email: "info@elektro-linge.de",
        web: "elektrolinge.de",
        bank: "", iban: "", bic: "",
        ustId: "", steuernr: "", register: "",
      },
      nummern: {
        angebot: { muster: "AN-{JJJJ}-{NR}", stellen: 4, next: 1, jahr: y },
        rechnung: { muster: "RE-{JJJJ}-{NR}", stellen: 4, next: 1, jahr: y },
        kunde: { muster: "K-{NR}", stellen: 5, next: 10001, jahr: y },
        artikel: { muster: "A-{NR}", stellen: 4, next: 1001, jahr: y },
        lead: { muster: "L-{JJJJ}-{NR}", stellen: 4, next: 1, jahr: y },
      },
      texte: {
        angebotEinleitung: "{ANREDE},\n\nvielen Dank für Ihre Anfrage und das freundliche Gespräch. Gerne unterbreiten wir Ihnen folgendes Angebot:",
        angebotSchluss: "Dieses Angebot ist gültig bis zum {GUELTIG}. Sollten während der Ausführung unvorhersehbare Mehrarbeiten anfallen, sprechen wir diese vorher mit Ihnen ab.\n\nWir würden uns freuen, den Auftrag für Sie ausführen zu dürfen. Für Rückfragen sind wir jederzeit gern für Sie da.\n\nMit freundlichen Grüßen\nIhr Team von Elektro Linge",
        rechnungEinleitung: "{ANREDE},\n\nvielen Dank für Ihren Auftrag. Für die ausgeführten Arbeiten berechnen wir Ihnen:",
        rechnungSchluss: "Bitte überweisen Sie den Rechnungsbetrag bis zum {FAELLIG} ohne Abzug unter Angabe der Rechnungsnummer auf das unten genannte Konto.\n\nVielen Dank für Ihr Vertrauen!\nIhr Team von Elektro Linge",
      },
      gueltigTage: 30,
      zahlungszielTage: 14,
      mwst: 19,
      pinHash: null,
    },
    leads: [],
    kunden: [],
    artikel: [],
    bewegungen: [],
    belege: [],
  };
}

// fehlende Felder (z. B. nach Updates) mit Standardwerten auffüllen
function fillDefaults(target, defaults) {
  for (const [k, v] of Object.entries(defaults)) {
    if (target[k] === undefined) target[k] = structuredClone(v);
    else if (v && typeof v === "object" && !Array.isArray(v) && target[k] && typeof target[k] === "object") fillDefaults(target[k], v);
  }
  return target;
}
function migrate(db) {
  if (!db || typeof db !== "object") return defaultDb();
  return fillDefaults(db, defaultDb());
}

// ---------------------------------------------------------------------
// Datenspeicher: Browser (lokal) oder Server
// ---------------------------------------------------------------------
const Store = {
  KEY: "elektro-linge-erp",
  mode: "local",
  db: null,
  version: 0,
  token: null,
  dirty: false,
  saving: false,
  timer: null,

  async detect() {
    try {
      const r = await fetch("/api/status", { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        if (j && j.erpServer) { this.mode = "server"; return j; }
      }
    } catch { /* kein Server – Browser-Modus */ }
    this.mode = "local";
    return null;
  },

  loadLocal() {
    let raw = null;
    try { raw = localStorage.getItem(this.KEY); } catch { /* gesperrt */ }
    try { this.db = migrate(raw ? JSON.parse(raw) : null); } catch { this.db = defaultDb(); }
    try { navigator.storage?.persist?.(); } catch { /* egal */ }
  },

  save() {
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.mode === "local" ? 250 : 600);
  },

  async flush() {
    clearTimeout(this.timer);
    if (!this.dirty) return true;
    if (this.mode === "local") {
      try {
        this.db.meta.updatedAt = Date.now();
        localStorage.setItem(this.KEY, JSON.stringify(this.db));
        this.dirty = false;
        return true;
      } catch {
        toast("Speichern im Browser fehlgeschlagen (Speicher voll oder gesperrt). Bitte unter Einstellungen eine Datensicherung herunterladen.", "err");
        return false;
      }
    }
    return this.push();
  },

  async api(path, opts = {}) {
    const r = await fetch("/api" + path, {
      ...opts,
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...(this.token ? { Authorization: "Bearer " + this.token } : {}) },
    });
    if (r.status === 401) {
      this.token = null;
      try { localStorage.removeItem(this.KEY + "-token"); } catch { /* egal */ }
      showLogin("Bitte erneut anmelden.");
      throw new Error("auth");
    }
    return r;
  },

  async pull() {
    const r = await this.api("/db");
    if (!r.ok) throw new Error("Laden fehlgeschlagen");
    const j = await r.json();
    this.version = j.version;
    this.db = migrate(j.db);
  },

  async push() {
    if (this.saving) { this.timer = setTimeout(() => this.flush(), 300); return false; }
    this.saving = true;
    this.dirty = false;
    try {
      this.db.meta.updatedAt = Date.now();
      const r = await this.api("/db", { method: "PUT", body: JSON.stringify({ baseVersion: this.version, db: this.db }) });
      if (r.status === 409) {
        toast("Die Daten wurden gerade auf einem anderen Gerät geändert – Ansicht wurde aktualisiert. Bitte letzte Eingabe prüfen.", "err");
        await this.pull();
        render();
        return false;
      }
      if (!r.ok) throw new Error("Serverfehler");
      this.version = (await r.json()).version;
      setSyncState("ok");
      return true;
    } catch (e) {
      if (e.message !== "auth") {
        this.dirty = true;
        setSyncState("err");
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.flush(), 5000);
      }
      return false;
    } finally {
      this.saving = false;
    }
  },

  async poll() {
    if (this.mode !== "server" || !this.token) return;
    try {
      const j = await (await this.api("/version")).json();
      if (j.version !== this.version && !this.dirty && !this.saving && !isEditing()) {
        await this.pull();
        render();
      }
      if (j.eingang > 0) await this.fetchInbox();
    } catch { /* nächster Versuch beim nächsten Intervall */ }
  },

  // Anfragen aus dem Lead-Eingang (Website-Formular) übernehmen
  async fetchInbox() {
    const list = await (await this.api("/eingang")).json();
    if (!Array.isArray(list) || !list.length) return;
    const added = [];
    for (const e of list) {
      if (this.db.leads.some((l) => l.eingangId === e.id)) continue;
      const lead = createLead({ ...e, quelle: e.quelle || "Website" }, { eingangId: e.id, at: e.at });
      added.push(lead);
    }
    if (added.length) {
      this.dirty = true;
      const ok = await this.flush();
      if (!ok) return; // erst bestätigen, wenn sicher gespeichert
    }
    await this.api("/eingang/abholen", { method: "POST", body: JSON.stringify({ ids: list.map((e) => e.id) }) });
    if (added.length) {
      toast(`<b>${added.length} neue Anfrage${added.length > 1 ? "n" : ""}</b> von der Website eingegangen`);
      if (!isEditing()) render(); else updateBadges();
    }
  },
};
const DB = () => Store.db;
const S = () => Store.db.settings;
const isEditing = () => !!document.querySelector(".modal-backdrop") || (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && document.activeElement.closest("#view"));

function setSyncState(state) {
  const el = $("#sync-state");
  if (el) el.textContent = state === "err" ? "Nicht gespeichert – Server nicht erreichbar" : "Alles gespeichert";
}

// ---------------------------------------------------------------------
// Geschäftslogik
// ---------------------------------------------------------------------
function formatNr(c, n, y = new Date().getFullYear()) {
  return c.muster.replace("{JJJJ}", y).replace("{JJ}", String(y).slice(2)).replace("{NR}", String(n).padStart(Number(c.stellen) || 1, "0"));
}
function nrExists(kind, nr) {
  const db = DB();
  if (kind === "angebot" || kind === "rechnung") return db.belege.some((b) => b.nr === nr);
  if (kind === "kunde") return db.kunden.some((k) => k.nr === nr);
  if (kind === "artikel") return db.artikel.some((a) => a.nr === nr);
  if (kind === "lead") return db.leads.some((l) => l.nr === nr);
  return false;
}
function nextNr(kind) {
  const c = S().nummern[kind];
  const y = new Date().getFullYear();
  if (c.muster.includes("{JJ") && c.jahr !== y) { c.jahr = y; c.next = 1; }
  let nr;
  do { nr = formatNr(c, c.next, y); c.next = Number(c.next) + 1; } while (nrExists(kind, nr));
  return nr;
}

// --- Kunden ---
const kundeById = (id) => DB().kunden.find((k) => k.id === id);
const kundeName = (k) => (!k ? "" : clean(k.firma) || clean([k.vorname, k.nachname].filter(Boolean).join(" ")) || "(ohne Namen)");
const kundePerson = (k) => clean([k.anrede && k.anrede !== "Firma" ? k.anrede : "", k.vorname, k.nachname].filter(Boolean).join(" "));
function kundeAdresse(k) {
  if (!k) return [];
  const lines = [];
  if (k.firma) lines.push(k.firma);
  const p = kundePerson(k);
  if (p) lines.push(k.firma ? "z. Hd. " + p : p);
  if (k.strasse) lines.push(k.strasse);
  if (k.plz || k.ort) lines.push(clean(`${k.plz || ""} ${k.ort || ""}`));
  return lines;
}
function anrede(k) {
  if (k?.anrede === "Herr" && k.nachname) return `Sehr geehrter Herr ${k.nachname}`;
  if (k?.anrede === "Frau" && k.nachname) return `Sehr geehrte Frau ${k.nachname}`;
  if (k?.anrede === "Familie" && k.nachname) return `Sehr geehrte Familie ${k.nachname}`;
  return "Sehr geehrte Damen und Herren";
}
function splitName(name) {
  const parts = clean(name).replace(/^(herr|frau|familie)\s+/i, "").split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { vorname: "", nachname: parts[0] || "" };
  return { vorname: parts.slice(0, -1).join(" "), nachname: parts.at(-1) };
}
function guessAnrede(name) {
  const m = clean(name).match(/^(herr|frau|familie)\b/i);
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : "";
}
function findKunde({ email, phone }) {
  const e = lc(clean(email));
  const p = phoneDigits(phone);
  return DB().kunden.find((k) => (e && lc(k.email) === e) || (p && p.length > 6 && [k.telefon, k.mobil].some((x) => x && phoneDigits(x) === p)));
}
function createKunde(data) {
  const k = {
    id: uid(), nr: nextNr("kunde"), createdAt: Date.now(),
    typ: data.typ || (data.firma ? "gewerbe" : "privat"),
    anrede: data.anrede || "", vorname: clean(data.vorname), nachname: clean(data.nachname), firma: clean(data.firma),
    strasse: clean(data.strasse), plz: clean(data.plz), ort: clean(data.ort),
    telefon: clean(data.telefon), mobil: clean(data.mobil), email: clean(data.email),
    quelle: data.quelle || "", notizen: clean(data.notizen),
  };
  DB().kunden.unshift(k);
  return k;
}
function kundeUmsatz(k) {
  return r2(DB().belege.filter((b) => b.kundeId === k.id && b.typ === "rechnung" && (b.status === "bezahlt" || b.status === "offen")).reduce((s, b) => s + belegTotals(b).brutto, 0));
}

// --- Anfragen / Leads ---
const leadById = (id) => DB().leads.find((l) => l.id === id);
function addAkt(lead, typ, text) {
  lead.aktivitaeten = lead.aktivitaeten || [];
  lead.aktivitaeten.unshift({ id: uid(), at: Date.now(), typ, text });
}
function createLead(data, { eingangId = null, at = null } = {}) {
  const quelle = data.quelle || "Website";
  const l = {
    id: uid(), nr: nextNr("lead"), createdAt: at || Date.now(), eingangId,
    quelle,
    name: clean(data.name), email: clean(data.email), phone: clean(data.phone || data.telefon),
    strasse: clean(data.strasse), plzOrt: clean(data.plzOrt || data.ort),
    thema: clean(data.thema || data.topic) || "Sonstiges",
    nachricht: clean(data.nachricht || data.message),
    wert: parseNum(data.wert),
    stage: "neu", wiedervorlage: data.wiedervorlage || "", kundeId: null, verlorenGrund: "",
    aktivitaeten: [],
  };
  addAkt(l, "system", `Anfrage eingegangen über ${quelle}`);
  const k = findKunde(l);
  if (k) { l.kundeId = k.id; addAkt(l, "system", `Bestandskunde erkannt: ${kundeName(k)} (${k.nr})`); }
  DB().leads.unshift(l);
  return l;
}
function setStage(lead, stage, note) {
  if (!lead || lead.stage === stage) return;
  const from = stageLabel(lead.stage);
  lead.stage = stage;
  lead.stageAt = Date.now();
  addAkt(lead, "system", `Kundenreise: ${from} → ${stageLabel(stage)}${note ? ` (${note})` : ""}`);
}
// nur vorwärts bewegen (nie automatisch zurück)
function advance(lead, stage, note) {
  if (!lead) return;
  if (lead.stage === "verloren" || stageIdx(lead.stage) < stageIdx(stage)) setStage(lead, stage, note);
}
function ensureKunde(lead) {
  if (lead.kundeId && kundeById(lead.kundeId)) return kundeById(lead.kundeId);
  let k = findKunde(lead);
  if (!k) {
    const { vorname, nachname } = splitName(lead.name);
    const [plz, ...ortParts] = lead.plzOrt.split(/\s+/);
    const hasPlz = /^\d{5}$/.test(plz || "");
    k = createKunde({
      anrede: guessAnrede(lead.name), vorname, nachname,
      email: lead.email, telefon: lead.phone, strasse: lead.strasse,
      plz: hasPlz ? plz : "", ort: hasPlz ? ortParts.join(" ") : lead.plzOrt,
      quelle: lead.quelle, notizen: "",
    });
    addAkt(lead, "system", `Als Kunde angelegt: ${k.nr}`);
  } else addAkt(lead, "system", `Mit Kunde verknüpft: ${kundeName(k)} (${k.nr})`);
  lead.kundeId = k.id;
  return k;
}
const leadValue = (l) => {
  const bs = DB().belege.filter((b) => b.leadId === l.id && b.typ === "angebot" && b.status !== "abgelehnt");
  return bs.length ? Math.max(...bs.map((b) => belegTotals(b).brutto)) : l.wert || 0;
};
const leadDue = (l) => ACTIVE_STAGES.includes(l.stage) && l.wiedervorlage && l.wiedervorlage <= todayISO();

// --- Belege (Angebote & Rechnungen) ---
const belegById = (id) => DB().belege.find((b) => b.id === id);
const belegLabel = (b) => (b.typ === "angebot" ? "Angebot" : "Rechnung");
const belegNr = (b) => b.nr || "Entwurf";
function posTotal(p) {
  if (p.typ === "titel") return 0;
  return r2(parseNum(p.menge) * parseNum(p.preis) * (1 - parseNum(p.rabatt) / 100));
}
function belegTotals(b) {
  let netto = 0, lohn = 0;
  const base = {};
  for (const p of b.positionen || []) {
    const t = posTotal(p);
    netto += t;
    const satz = Number(p.mwst ?? 19);
    base[satz] = (base[satz] || 0) + t;
    if (p.art === "lohn") lohn += t * (1 + satz / 100);
  }
  const steuern = Object.keys(base).map(Number).sort((a, b) => b - a).map((satz) => ({ satz, basis: r2(base[satz]), betrag: r2(base[satz] * satz / 100) }));
  const steuer = r2(steuern.reduce((s, x) => s + x.betrag, 0));
  netto = r2(netto);
  return { netto, steuern, steuer, brutto: r2(netto + steuer), lohn: r2(lohn) };
}
function angebotStatus(b) {
  if (b.status === "versendet" && b.gueltigBis && b.gueltigBis < todayISO()) return ["Abgelaufen", "orange"];
  return ANG_STATUS[b.status] || [b.status, ""];
}
function rechnungStatus(b) {
  if (b.status === "offen" && b.faelligAm && b.faelligAm < todayISO()) return ["Überfällig", "red"];
  return RE_STATUS[b.status] || [b.status, ""];
}
const statusPill = (b) => { const [l, c] = b.typ === "angebot" ? angebotStatus(b) : rechnungStatus(b); return `<span class="pill ${c}">${esc(l)}</span>`; };
const isLocked = (b) => (b.typ === "rechnung" && b.status !== "entwurf") || (b.typ === "angebot" && b.status === "angenommen");

function createBeleg(typ, { kundeId = null, leadId = null, betreff = "", positionen = [], bezugId = null } = {}) {
  const s = S();
  const d = todayISO();
  const b = {
    id: uid(), typ,
    nr: typ === "angebot" ? nextNr("angebot") : null, // Rechnungsnummer erst beim Festschreiben (lückenlos)
    datum: d, kundeId, leadId, betreff,
    einleitung: typ === "angebot" ? s.texte.angebotEinleitung : s.texte.rechnungEinleitung,
    schluss: typ === "angebot" ? s.texte.angebotSchluss : s.texte.rechnungSchluss,
    positionen,
    status: "entwurf",
    gueltigBis: typ === "angebot" ? addDays(d, s.gueltigTage) : null,
    faelligAm: typ === "rechnung" ? addDays(d, s.zahlungszielTage) : null,
    leistung: "", notiz: "", bezugId, createdAt: Date.now(), materialGebucht: false,
  };
  DB().belege.unshift(b);
  return b;
}
function newPos(data = {}) {
  return {
    id: uid(), typ: data.typ || "pos", artikelId: data.artikelId || null, artNr: data.artNr || "",
    name: data.name || "", beschreibung: data.beschreibung || "",
    menge: data.menge ?? 1, einheit: data.einheit || "Stk", preis: data.preis ?? 0,
    rabatt: data.rabatt ?? 0, mwst: data.mwst ?? S().mwst, art: data.art || "material",
  };
}
const posFromArtikel = (a, menge = 1) => newPos({ artikelId: a.id, artNr: a.nr, name: a.name, beschreibung: a.beschreibung, menge, einheit: a.einheit, preis: a.vk, mwst: a.mwst, art: a.art });
const copyPositions = (list) => list.map((p) => ({ ...structuredClone(p), id: uid() }));
function fillText(text, b) {
  const k = kundeById(b.kundeId);
  return String(text || "")
    .replaceAll("{ANREDE}", anrede(k))
    .replaceAll("{GUELTIG}", fmtDate(b.gueltigBis))
    .replaceAll("{FAELLIG}", fmtDate(b.faelligAm))
    .replaceAll("{NR}", belegNr(b))
    .replaceAll("{KUNDE}", kundeName(k));
}

// --- Artikel & Lager ---
const artikelById = (id) => DB().artikel.find((a) => a.id === id);
function reserviert(artikelId) {
  let r = 0;
  for (const b of DB().belege) {
    if (b.typ !== "angebot" || b.status !== "angenommen" || b.materialGebucht) continue;
    for (const p of b.positionen) if (p.artikelId === artikelId) r += parseNum(p.menge);
  }
  return r2(r);
}
function buchen(artikel, menge, typ, bezug = "", notiz = "") {
  menge = r2(menge);
  if (!menge) return;
  artikel.bestand = r2((Number(artikel.bestand) || 0) + menge);
  DB().bewegungen.unshift({ id: uid(), at: Date.now(), artikelId: artikel.id, artNr: artikel.nr, artName: artikel.name, menge, typ, bezug, notiz, bestandNach: artikel.bestand });
}
const lagerWarnungen = () => DB().artikel.filter((a) => a.lager && a.aktiv !== false && Number(a.mindest) > 0 && Number(a.bestand) <= Number(a.mindest));
function lagerPositionen(b) {
  return b.positionen.filter((p) => p.artikelId && artikelById(p.artikelId)?.lager && parseNum(p.menge) > 0);
}

const BEISPIEL_ARTIKEL = [
  ["Elektroinstallateur (Geselle) – Arbeitsstunde", "", "Arbeitszeit", "lohn", "Std", 0, 68, 19, false],
  ["Elektromeister – Arbeitsstunde", "", "Arbeitszeit", "lohn", "Std", 0, 85, 19, false],
  ["Anfahrtspauschale", "Marienheide und Umgebung", "Arbeitszeit", "leistung", "psch", 0, 35, 19, false],
  ["NYM-J 3×1,5 mm²", "Mantelleitung, verlegt", "Kabel & Leitungen", "material", "m", 0.75, 1.6, 19, true],
  ["NYM-J 5×2,5 mm²", "Mantelleitung, verlegt", "Kabel & Leitungen", "material", "m", 1.9, 3.4, 19, true],
  ["NYM-J 5×10 mm²", "Mantelleitung, verlegt", "Kabel & Leitungen", "material", "m", 6.2, 10.9, 19, true],
  ["Gerätedose UP Ø 68 mm", "", "Installation", "material", "Stk", 0.35, 1.5, 19, true],
  ["Schuko-Steckdose UP inkl. Rahmen", "reinweiß", "Installation", "material", "Stk", 6.5, 14.9, 19, true],
  ["Aus-/Wechselschalter UP inkl. Rahmen", "reinweiß", "Installation", "material", "Stk", 7.2, 15.9, 19, true],
  ["LS-Schalter B16 1-polig", "6 kA", "Verteilung & Schutz", "material", "Stk", 3.2, 8.9, 19, true],
  ["FI-Schutzschalter 40 A / 30 mA, 4-polig, Typ A", "", "Verteilung & Schutz", "material", "Stk", 36, 69, 19, true],
  ["Überspannungsschutz Typ 1+2", "Kombiableiter für den Zählerschrank", "Verteilung & Schutz", "material", "Stk", 160, 289, 19, true],
  ["Zählerschrank nach TAR, 2 Zählerplätze – komplett", "inkl. Montage, Verdrahtung und Anmeldung beim Netzbetreiber", "Verteilung & Schutz", "leistung", "psch", 0, 1890, 19, false],
  ["Wallbox 11 kW inkl. Montage", "inkl. Anmeldung beim Netzbetreiber, ohne Zuleitung", "E-Mobilität", "leistung", "psch", 0, 1290, 19, false],
  ["PV-Modul 430 Wp Full Black", "inkl. Montage", "Photovoltaik", "material", "Stk", 0, 189, 0, false],
  ["Hybrid-Wechselrichter 10 kW", "inkl. Montage und Inbetriebnahme", "Photovoltaik", "material", "Stk", 0, 2190, 0, false],
  ["Batteriespeicher 10 kWh", "inkl. Montage und Inbetriebnahme", "Photovoltaik", "material", "Stk", 0, 4890, 0, false],
  ["Balkonkraftwerk – Prüfung & Einspeisesteckdose", "Wieland-/Schukosteckdose, Leitungsprüfung, Anmeldung", "Photovoltaik", "leistung", "psch", 0, 249, 0, false],
  ["E-Check nach DGUV V3 / VDE 0105", "Prüfung der Anlage inkl. Prüfprotokoll", "Prüfung & Service", "leistung", "psch", 0, 189, 19, false],
];
function createArtikel(d) {
  const a = {
    id: uid(), nr: clean(d.nr) || nextNr("artikel"), name: clean(d.name), beschreibung: clean(d.beschreibung),
    kategorie: d.kategorie || "Sonstiges", art: d.art || "material", einheit: d.einheit || "Stk",
    ek: parseNum(d.ek), vk: parseNum(d.vk), mwst: Number(d.mwst ?? S().mwst),
    lager: !!d.lager, bestand: 0, mindest: parseNum(d.mindest), lagerort: clean(d.lagerort), aktiv: true, createdAt: Date.now(),
  };
  DB().artikel.push(a);
  if (a.lager && parseNum(d.bestand)) buchen(a, parseNum(d.bestand), "eingang", "Anfangsbestand");
  return a;
}

// ---------------------------------------------------------------------
// Anfrage-Text (E-Mail von FormSubmit, WhatsApp …) automatisch erkennen
// ---------------------------------------------------------------------
const PARSE_KEYS = {
  name: ["name", "ihr name", "vor- und nachname", "kunde", "absender"],
  email: ["email", "e-mail", "mail", "e-mail-adresse", "emailadresse"],
  phone: ["phone", "telefon", "tel", "telefonnummer", "handy", "mobil", "rückrufnummer"],
  thema: ["topic", "thema", "leistung", "anliegen", "betreff", "worum geht es"],
  nachricht: ["message", "nachricht", "ihre nachricht", "anfrage", "beschreibung", "text"],
  plzOrt: ["ort", "plz", "plz / ort", "wohnort"],
  strasse: ["straße", "strasse", "adresse", "anschrift"],
};
const IGNORE_KEYS = ["_honey", "datenschutz", "_subject", "_captcha", "_template", "submitted", "gesendet"];
function parseLeadText(text) {
  const out = {};
  const lookup = new Map();
  for (const [k, list] of Object.entries(PARSE_KEYS)) list.forEach((w) => lookup.set(w, k));
  let current = null;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/ /g, " ").trim();
    if (!line) { if (current === "nachricht" && out.nachricht) out.nachricht += "\n"; continue; }
    const m = line.match(/^([A-Za-zÄÖÜäöüß_\-\/ ]{2,24}?)\s*(?::|\t|\s\|\s|\|)\s*(.*)$/);
    const keyOnly = lc(line.replace(/:$/, ""));
    if (m && (lookup.has(lc(m[1].trim())) || IGNORE_KEYS.some((i) => lc(m[1]).startsWith(i)))) {
      const key = lookup.get(lc(m[1].trim())) || null;
      current = key;
      if (key && m[2]) out[key] = (out[key] ? out[key] + "\n" : "") + m[2].trim();
      continue;
    }
    if (lookup.has(keyOnly)) { current = lookup.get(keyOnly); continue; }
    if (IGNORE_KEYS.some((i) => keyOnly.startsWith(i))) { current = null; continue; }
    if (current) out[current] = (out[current] ? out[current] + (current === "nachricht" ? "\n" : " ") : "") + line;
  }
  for (const k of Object.keys(out)) out[k] = out[k].trim();
  if (!out.email) out.email = (text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [""])[0];
  if (!out.phone) out.phone = ((text.match(/(?:\+|0)[\d][\d\s/()\-]{6,}\d/) || [""])[0]).trim();
  if (!out.nachricht && !Object.keys(out).some((k) => ["name", "thema"].includes(k) && out[k])) out.nachricht = clean(text);
  if (out.thema) {
    const hit = THEMEN.find((t) => lc(t) === lc(out.thema)) || THEMEN.find((t) => lc(out.thema).includes(lc(t.split(" ")[0])));
    if (hit) out.thema = hit;
  }
  return out;
}

// ---------------------------------------------------------------------
// Oberfläche: Toasts, Dialoge
// ---------------------------------------------------------------------
function toast(html, type = "") {
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.innerHTML = html;
  $("#toasts").append(t);
  while ($("#toasts").children.length > 3) $("#toasts").firstElementChild.remove();
  setTimeout(() => t.remove(), type === "err" ? 7000 : 3200);
}

function modal({ title, body, foot, size = "", submitLabel = "Speichern", onSubmit, onOpen }) {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  const footHtml = foot === false ? "" : `<div class="modal-foot">${foot ?? `<button type="button" class="btn" data-close>Abbrechen</button><button class="btn btn-black" type="submit">${esc(submitLabel)}</button>`}</div>`;
  wrap.innerHTML = `<form class="modal ${size}" novalidate autocomplete="off">
      <div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="modal-close" data-close aria-label="Schließen">×</button></div>
      <div class="modal-body">${body}</div>${footHtml}</form>`;
  $("#modal-root").append(wrap);
  const form = wrap.firstElementChild;
  const onKey = (e) => { if (e.key === "Escape" && wrap === $("#modal-root").lastElementChild) close(); };
  const close = () => { wrap.remove(); document.removeEventListener("keydown", onKey); };
  document.addEventListener("keydown", onKey);
  wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) close(); });
  form.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) close(); });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form));
    $$("input[type=checkbox][name]", form).forEach((c) => { data[c.name] = c.checked; });
    if (onSubmit?.(data, form, close) !== false) close();
  });
  onOpen?.(form, close);
  setTimeout(() => (form.querySelector("[autofocus]") || form.querySelector(".modal-body input:not([type=hidden]):not([readonly]), .modal-body select, .modal-body textarea"))?.focus(), 40);
  return { form, close };
}

function ask(text, { ok = "OK", danger = false, title = "Bitte bestätigen" } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title,
      body: `<p style="margin:0;white-space:pre-wrap">${esc(text)}</p>`,
      foot: `<button type="button" class="btn" data-close>Abbrechen</button><button class="btn ${danger ? "btn-danger" : "btn-black"}" type="submit" autofocus>${esc(ok)}</button>`,
      onSubmit: () => { done = true; resolve(true); },
    });
    const obs = new MutationObserver(() => { if (!m.form.isConnected) { obs.disconnect(); if (!done) resolve(false); } });
    obs.observe($("#modal-root"), { childList: true });
  });
}

const opt = (list, sel) => list.map((o) => {
  const [v, l] = Array.isArray(o) ? o : [o, o];
  return `<option value="${esc(v)}"${String(v) === String(sel ?? "") ? " selected" : ""}>${esc(l)}</option>`;
}).join("");
const field = (label, input, cls = "", hint = "") => `<label class="field ${cls}"><span>${esc(label)}</span>${input}${hint ? `<small>${hint}</small>` : ""}</label>`;
const inp = (name, val = "", attrs = "") => `<input name="${name}" value="${esc(val)}" ${attrs}>`;

// ---------------------------------------------------------------------
// Router & Rendering
// ---------------------------------------------------------------------
const ui = { leadsView: "board", leadsQ: "", leadsQuelle: "", kundenQ: "", angTab: "alle", angQ: "", reTab: "alle", reQ: "", artQ: "", artKat: "", lagerQ: "" };
const VIEWS = {};
let afterRender = [];
const after = (fn) => afterRender.push(fn);

function parseHash() {
  const [, page = "dashboard", id = ""] = (location.hash || "#/dashboard").split("/");
  return { page, id: decodeURIComponent(id) };
}
function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function render() {
  if (!Store.db) return;
  const { page, id } = parseHash();
  const view = $("#view");
  // Fokus/Cursor merken (für Suchfelder, die neu gerendert werden)
  const ae = document.activeElement;
  const focusKey = ae && view.contains(ae) ? ae.dataset.keep : null;
  const caret = focusKey && ae.selectionStart != null ? ae.selectionStart : null;
  afterRender = [];
  const fn = VIEWS[page] || VIEWS.dashboard;
  let html;
  try { html = fn(id); } catch (e) { console.error(e); html = `<div class="card card-pad notice red">Fehler beim Anzeigen: ${esc(e.message)}</div>`; }
  view.innerHTML = html;
  $$("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.nav === (page === "lead" ? "leads" : page === "kunde" ? "kunden" : page === "beleg" ? (belegById(id)?.typ === "rechnung" ? "rechnungen" : "angebote") : page)));
  afterRender.forEach((f) => f());
  if (focusKey) {
    const el = view.querySelector(`[data-keep="${focusKey}"]`);
    if (el) { el.focus(); if (caret != null) try { el.setSelectionRange(caret, caret); } catch { /* egal */ } }
  }
  updateBadges();
  $("#sidebar").classList.remove("open");
}

function updateBadges() {
  const n = DB().leads.filter((l) => l.stage === "neu").length;
  const b = $("#nav-leads");
  b.hidden = !n; b.textContent = n;
  const w = lagerWarnungen().length;
  const lb = $("#nav-lager");
  lb.hidden = !w; lb.textContent = w;
  document.title = (n ? `(${n}) ` : "") + "Elektro Linge ERP";
}

function pageHead(title, sub = "", actions = "", crumb = "") {
  return `<div class="page-head"><div>${crumb ? `<div class="crumb">${crumb}</div>` : ""}<h1>${title}</h1>${sub ? `<p>${sub}</p>` : ""}</div>${actions ? `<div class="actions">${actions}</div>` : ""}</div>`;
}
const emptyState = (title, text, btn = "") => `<div class="empty"><h3>${esc(title)}</h3><p>${text}</p>${btn}</div>`;

// ---------------------------------------------------------------------
// Übersicht
// ---------------------------------------------------------------------
VIEWS.dashboard = () => {
  const db = DB();
  const t = todayISO();
  const year = String(new Date().getFullYear());
  const neu = db.leads.filter((l) => l.stage === "neu");
  const aktiv = db.leads.filter((l) => ACTIVE_STAGES.includes(l.stage));
  const angOffen = db.belege.filter((b) => b.typ === "angebot" && b.status === "versendet");
  const angenommen = db.belege.filter((b) => b.typ === "angebot" && b.status === "angenommen" && String(b.angenommenAm || b.datum).startsWith(year));
  const abgelehnt = db.belege.filter((b) => b.typ === "angebot" && b.status === "abgelehnt" && String(b.datum).startsWith(year));
  const reOffen = db.belege.filter((b) => b.typ === "rechnung" && b.status === "offen");
  const reUeber = reOffen.filter((b) => b.faelligAm < t);
  const bezahlt = db.belege.filter((b) => b.typ === "rechnung" && b.status === "bezahlt" && String(b.bezahltAm || b.datum).startsWith(year));
  const sum = (list, k = "brutto") => list.reduce((s, b) => s + belegTotals(b)[k], 0);
  const quote = angenommen.length + abgelehnt.length ? Math.round((angenommen.length / (angenommen.length + abgelehnt.length)) * 100) : null;
  const warn = lagerWarnungen();

  // Aufgaben
  const todos = [];
  neu.forEach((l) => todos.push({ ic: "⚡", c: "yellow", sort: 0, html: `<a href="#/lead/${l.id}">${esc(l.name || "Neue Anfrage")}</a> – ${esc(l.thema)}`, d: `Neue Anfrage ${relTime(l.createdAt)} · Bitte melden` }));
  db.leads.filter(leadDue).filter((l) => l.stage !== "neu").forEach((l) => todos.push({ ic: "◷", c: l.wiedervorlage < t ? "red" : "blue", sort: 1, html: `<a href="#/lead/${l.id}">${esc(l.name)}</a> – Wiedervorlage`, d: `${stageLabel(l.stage)} · fällig ${l.wiedervorlage === t ? "heute" : "seit " + fmtDate(l.wiedervorlage)}` }));
  angOffen.forEach((b) => {
    const d = b.gueltigBis ? daysBetween(t, b.gueltigBis) : 99;
    const sent = b.gesendetAm ? daysBetween(toISO(new Date(b.gesendetAm)), t) : 0;
    if (d <= 5 || sent >= 7) todos.push({ ic: "✎", c: d < 0 ? "red" : "blue", sort: 2, html: `<a href="#/beleg/${b.id}">Angebot ${esc(b.nr)}</a> nachfassen – ${esc(kundeName(kundeById(b.kundeId)))}`, d: d < 0 ? `abgelaufen seit ${fmtDate(b.gueltigBis)}` : `gültig bis ${fmtDate(b.gueltigBis)} · ${eur(belegTotals(b).brutto)}` });
  });
  db.belege.filter((b) => b.typ === "angebot" && b.status === "angenommen" && !b.materialGebucht && lagerPositionen(b).length).forEach((b) => todos.push({ ic: "▦", c: "blue", sort: 3, html: `<a href="#/beleg/${b.id}">Material für ${esc(b.nr)}</a> aus dem Lager ausbuchen`, d: kundeName(kundeById(b.kundeId)) }));
  db.belege.filter((b) => b.typ === "angebot" && b.status === "angenommen" && !db.belege.some((r) => r.typ === "rechnung" && r.bezugId === b.id)).forEach((b) => todos.push({ ic: "€", c: "", sort: 4, html: `<a href="#/beleg/${b.id}">Auftrag ${esc(b.nr)}</a> – Rechnung noch nicht erstellt`, d: `${kundeName(kundeById(b.kundeId))} · ${eur(belegTotals(b).brutto)}` }));
  reUeber.forEach((b) => todos.push({ ic: "€", c: "red", sort: 1, html: `<a href="#/beleg/${b.id}">Rechnung ${esc(b.nr)}</a> überfällig`, d: `${kundeName(kundeById(b.kundeId))} · ${eur(belegTotals(b).brutto)} · fällig ${fmtDate(b.faelligAm)}` }));
  warn.forEach((a) => todos.push({ ic: "▦", c: "red", sort: 5, html: `<a href="#/lager">${esc(a.name)}</a> nachbestellen`, d: `Bestand ${num(a.bestand)} ${esc(a.einheit)} · Mindestbestand ${num(a.mindest)}` }));
  if (Store.mode === "local" && (db.leads.length || db.belege.length)) {
    const last = db.meta.lastBackup;
    if (!last || Date.now() - last > 7 * 86400000) todos.push({ ic: "⇩", c: "yellow", sort: 6, html: `<button class="link" data-act="backup">Datensicherung herunterladen</button>`, d: last ? `Letzte Sicherung ${relTime(last)}` : "Noch keine Sicherung erstellt – Daten liegen nur in diesem Browser" });
  }
  todos.sort((a, b) => a.sort - b.sort);

  // Kundenreise-Trichter
  const maxStage = Math.max(1, ...ALL_STAGES.map((s) => db.leads.filter((l) => l.stage === s.id).length));
  const funnel = ALL_STAGES.map((s) => {
    const n = db.leads.filter((l) => l.stage === s.id).length;
    return `<a href="#/leads"><span>${esc(s.label)}</span><span class="bar"><span style="width:${(n / maxStage) * 100}%"></span></span><span class="n">${n}</span></a>`;
  }).join("");

  // Letzte Aktivitäten
  const acts = db.leads.flatMap((l) => (l.aktivitaeten || []).map((a) => ({ ...a, lead: l }))).sort((a, b) => b.at - a.at).slice(0, 8);

  const hour = new Date().getHours();
  const hello = hour < 11 ? "Guten Morgen" : hour < 18 ? "Guten Tag" : "Guten Abend";

  return `
    ${pageHead(hello, new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" }), `<button class="btn" data-act="lead-new">+ Anfrage</button><button class="btn btn-black" data-act="angebot-new">+ Angebot</button>`)}
    <div class="kpis">
      <a class="card kpi accent" href="#/leads"><div class="label">Neue Anfragen</div><div class="value">${neu.length}</div><div class="sub">${aktiv.length} ${aktiv.length === 1 ? "Anfrage" : "Anfragen"} aktiv in der Kundenreise</div></a>
      <a class="card kpi" href="#/angebote"><div class="label">Offene Angebote</div><div class="value">${eur(sum(angOffen))}</div><div class="sub">${angOffen.length} Angebot${angOffen.length === 1 ? "" : "e"} beim Kunden</div></a>
      <a class="card kpi" href="#/angebote"><div class="label">Aufträge ${year}</div><div class="value">${eur(sum(angenommen, "netto"))}</div><div class="sub">netto · ${angenommen.length} angenommen${quote != null ? ` · Quote ${quote} %` : ""}</div></a>
      <a class="card kpi" href="#/rechnungen"><div class="label">Offene Rechnungen</div><div class="value">${eur(sum(reOffen))}</div><div class="sub">${reUeber.length ? `<b style="color:var(--red)">${reUeber.length} überfällig</b>` : `${reOffen.length} offen`} · bezahlt ${year}: ${eur(sum(bezahlt))}</div></a>
      <a class="card kpi" href="#/lager"><div class="label">Lager</div><div class="value">${warn.length}</div><div class="sub">${warn.length ? "Artikel unter Mindestbestand" : "Alle Bestände in Ordnung"}</div></a>
    </div>
    <div class="grid grid-side">
      <div class="card">
        <div class="card-head"><h2>Zu erledigen</h2><span class="pill ${todos.length ? "yellow" : "green"}">${todos.length || "Alles erledigt"}</span></div>
        <div class="card-body">${todos.length ? `<ul class="todo">${todos.slice(0, 25).map((x) => `<li><span class="ic ${x.c}">${x.ic}</span><div>${x.html}<div class="d">${esc(x.d)}</div></div></li>`).join("")}</ul>` : emptyState("Nichts zu tun", "Keine offenen Aufgaben. Neue Anfragen erscheinen hier automatisch.")}</div>
      </div>
      <div class="stack">
        <div class="card"><div class="card-head"><h3>Kundenreise</h3><a class="btn btn-small" href="#/leads">Öffnen</a></div><div class="card-body"><div class="funnel">${funnel}</div></div></div>
        <div class="card"><div class="card-head"><h3>Letzte Aktivitäten</h3></div><div class="card-body">${acts.length ? `<ul class="timeline">${acts.map((a) => `<li><span class="dot ${a.typ === "system" ? "sys" : ""}">${AKT[a.typ]?.[0] || "•"}</span><div class="when">${relTime(a.at)} · <a href="#/lead/${a.lead.id}">${esc(a.lead.name || a.lead.nr)}</a></div><div class="txt">${esc(a.text)}</div></li>`).join("")}</ul>` : `<p class="muted small">Noch keine Aktivitäten.</p>`}</div></div>
      </div>
    </div>`;
};

// ---------------------------------------------------------------------
// Anfragen & Kundenreise
// ---------------------------------------------------------------------
function leadMatches(l) {
  const q = lc(ui.leadsQ);
  if (ui.leadsQuelle && l.quelle !== ui.leadsQuelle) return false;
  if (!q) return true;
  return [l.name, l.email, l.phone, l.thema, l.nachricht, l.nr, l.plzOrt].some((x) => lc(x).includes(q));
}
function leadCard(l) {
  const v = leadValue(l);
  return `<a class="lead-card ${leadDue(l) ? "due" : ""}" href="#/lead/${l.id}" draggable="true" data-lead="${l.id}">
    <div class="t">${esc(l.name || "(ohne Namen)")}</div>
    <div class="s">${esc(l.thema)}${l.plzOrt ? " · " + esc(l.plzOrt) : ""}</div>
    <div class="meta"><span class="pill">${esc(l.quelle)}</span><span class="small muted">${relTime(l.createdAt)}</span>${v ? `<span class="val">${eur(v)}</span>` : ""}</div>
  </a>`;
}

VIEWS.leads = () => {
  const leads = DB().leads.filter(leadMatches);
  const toolbar = `<div class="toolbar">
      <div class="tabs"><button data-act="ui" data-k="leadsView" data-v="board" class="${ui.leadsView === "board" ? "active" : ""}">Kundenreise (Board)</button><button data-act="ui" data-k="leadsView" data-v="liste" class="${ui.leadsView === "liste" ? "active" : ""}">Liste</button></div>
      <input type="search" placeholder="Name, Thema, Telefon …" value="${esc(ui.leadsQ)}" data-ui="leadsQ" data-keep="leadsQ">
      <select data-ui="leadsQuelle"><option value="">Alle Quellen</option>${opt(QUELLEN, ui.leadsQuelle)}</select>
    </div>`;
  const head = pageHead("Anfragen &amp; Kundenreise", "Jede Anfrage durchläuft die Kundenreise – von der ersten Nachricht bis zum abgeschlossenen Auftrag. Karten per Drag &amp; Drop verschieben.",
    `<button class="btn" data-act="lead-paste">E-Mail / Nachricht einfügen</button><button class="btn btn-yellow" data-act="lead-new">+ Neue Anfrage</button>`);

  if (!DB().leads.length) {
    return head + `<div class="card">${emptyState("Noch keine Anfragen", "Legen Sie Anfragen per Telefon oder WhatsApp an oder fügen Sie eine Anfrage-E-Mail von der Website ein – das ERP erkennt Name, Telefon, E-Mail und Thema automatisch.", `<button class="btn btn-yellow" data-act="lead-paste">Anfrage-E-Mail einfügen</button> <button class="btn" data-act="lead-new">Anfrage anlegen</button>`)}</div>`;
  }

  if (ui.leadsView === "liste") {
    const rows = [...leads].sort((a, b) => b.createdAt - a.createdAt).map((l) => `<tr class="click" data-href="#/lead/${l.id}">
      <td class="nowrap muted small">${esc(l.nr)}</td><td class="nowrap">${fmtDate(toISO(new Date(l.createdAt)))}</td>
      <td class="strong">${esc(l.name)}</td><td>${esc(l.thema)}</td><td><span class="pill">${esc(l.quelle)}</span></td>
      <td><span class="pill ${l.stage === "neu" ? "yellow" : l.stage === "verloren" ? "red" : l.stage === "abgeschlossen" ? "green" : "blue"}">${esc(stageLabel(l.stage))}</span></td>
      <td class="nowrap ${leadDue(l) ? "strong" : ""}" style="${leadDue(l) ? "color:var(--red)" : ""}">${fmtDate(l.wiedervorlage)}</td>
      <td class="num">${leadValue(l) ? eur(leadValue(l)) : ""}</td></tr>`).join("");
    return head + toolbar + `<div class="card table-wrap"><table class="table"><thead><tr><th>Nr.</th><th>Eingang</th><th>Name</th><th>Thema</th><th>Quelle</th><th>Phase</th><th>Wiedervorlage</th><th class="num">Wert</th></tr></thead><tbody>${rows || `<tr><td colspan="8" class="muted">Keine Treffer.</td></tr>`}</tbody></table></div>`;
  }

  const cols = ALL_STAGES.map((s) => {
    let list = leads.filter((l) => l.stage === s.id).sort((a, b) => (leadDue(b) - leadDue(a)) || b.createdAt - a.createdAt);
    const total = list.length;
    const sumV = list.reduce((x, l) => x + leadValue(l), 0);
    const limited = ["abgeschlossen", "verloren"].includes(s.id) && total > 8;
    if (limited) list = list.slice(0, 8);
    return `<div class="col" data-stage="${s.id}">
      <div class="col-head"><div>${esc(s.label)}<small>${sumV ? eur(sumV) : esc(s.hint)}</small></div><span class="count">${total}</span></div>
      ${list.map(leadCard).join("")}
      ${limited ? `<div class="more">+ ${total - 8} weitere – siehe Liste</div>` : ""}
    </div>`;
  }).join("");
  after(bindKanban);
  return head + toolbar + `<div class="kanban">${cols}</div>`;
};

function bindKanban() {
  let dragId = null;
  $$(".lead-card[draggable]").forEach((c) => {
    c.addEventListener("dragstart", (e) => { dragId = c.dataset.lead; c.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragId); });
    c.addEventListener("dragend", () => c.classList.remove("dragging"));
  });
  $$(".col[data-stage]").forEach((col) => {
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("drop"); });
    col.addEventListener("dragleave", () => col.classList.remove("drop"));
    col.addEventListener("drop", (e) => {
      e.preventDefault();
      col.classList.remove("drop");
      const l = leadById(dragId || e.dataTransfer.getData("text/plain"));
      if (!l || l.stage === col.dataset.stage) return;
      changeStage(l, col.dataset.stage);
    });
  });
}

async function changeStage(l, stage) {
  if (stage === "verloren") { lostDialog(l); return; }
  setStage(l, stage);
  if (stage !== "verloren") l.verlorenGrund = "";
  if (["auftrag", "ausfuehrung", "abgeschlossen"].includes(stage)) ensureKunde(l);
  Store.save();
  render();
  toast(`${esc(l.name)}: <b>${esc(stageLabel(stage))}</b>`);
}

function lostDialog(l) {
  modal({
    title: "Anfrage als verloren markieren",
    body: `<div class="form-grid">${field("Grund", `<select name="grund">${opt(["Zu teuer", "Kein Bedarf mehr", "Anderer Anbieter", "Keine Rückmeldung", "Nicht unser Leistungsbereich", "Kapazität fehlt", "Sonstiges"])}</select>`, "full")}${field("Notiz", `<textarea name="notiz" rows="3"></textarea>`, "full")}</div>`,
    submitLabel: "Als verloren markieren",
    onSubmit: (d) => {
      l.verlorenGrund = d.grund;
      setStage(l, "verloren", d.grund);
      if (clean(d.notiz)) addAkt(l, "notiz", d.notiz);
      Store.save(); render();
    },
  });
}

function leadForm(l = {}, withPaste = false) {
  return `${withPaste ? `<label class="field" style="margin-bottom:16px"><span>Anfrage einfügen (E-Mail vom Website-Formular, WhatsApp, SMS …)</span><textarea name="_paste" rows="5" placeholder="Hier den kompletten Text der Anfrage-E-Mail einfügen – Name, E-Mail, Telefon, Thema und Nachricht werden automatisch erkannt."></textarea><small id="paste-info"></small></label>` : ""}
    <div class="form-grid">
      ${field("Name *", inp("name", l.name, "required"))}
      ${field("Quelle", `<select name="quelle">${opt(QUELLEN, l.quelle || (withPaste ? "Website" : "Telefon"))}</select>`)}
      ${field("Telefon", inp("phone", l.phone, 'type="tel"'))}
      ${field("E-Mail", inp("email", l.email, 'type="email"'))}
      ${field("Straße", inp("strasse", l.strasse))}
      ${field("PLZ / Ort", inp("plzOrt", l.plzOrt))}
      ${field("Thema", `<select name="thema">${opt(THEMEN, l.thema || "Elektroinstallation")}</select>`)}
      ${field("Geschätzter Auftragswert (€)", inp("wert", l.wert ? inNum(l.wert) : "", 'inputmode="decimal" placeholder="optional"'))}
      ${field("Nachricht / Anliegen", `<textarea name="nachricht" rows="5">${esc(l.nachricht)}</textarea>`, "full")}
    </div>`;
}

function leadNewDialog(withPaste = false) {
  modal({
    title: withPaste ? "Anfrage aus E-Mail / Nachricht übernehmen" : "Neue Anfrage",
    size: "wide",
    body: leadForm({}, withPaste),
    submitLabel: "Anfrage anlegen",
    onOpen: (form) => {
      const ta = form.elements._paste;
      if (!ta) return;
      ta.addEventListener("input", () => {
        const p = parseLeadText(ta.value);
        const found = [];
        for (const [k, v] of Object.entries(p)) {
          const el = form.elements[k];
          if (!el || !v) continue;
          if (el.tagName === "SELECT" && ![...el.options].some((o) => o.value === v)) continue;
          el.value = v;
          found.push({ name: "Name", email: "E-Mail", phone: "Telefon", thema: "Thema", nachricht: "Nachricht", plzOrt: "Ort", strasse: "Straße" }[k]);
        }
        $("#paste-info", form).textContent = found.length ? "Erkannt: " + found.join(", ") + " – bitte kurz prüfen." : "";
      });
    },
    onSubmit: (d) => {
      const l = createLead(d);
      Store.save();
      toast(`Anfrage <b>${esc(l.nr)}</b> angelegt`);
      go("#/lead/" + l.id);
    },
  });
}

VIEWS.lead = (id) => {
  const l = leadById(id);
  if (!l) return `<div class="card">${emptyState("Anfrage nicht gefunden", "Vielleicht wurde sie gelöscht.", `<a class="btn" href="#/leads">Zur Übersicht</a>`)}</div>`;
  const k = kundeById(l.kundeId);
  const belege = DB().belege.filter((b) => b.leadId === l.id);
  const cur = stageIdx(l.stage);
  const journey = `<div class="journey ${l.stage === "verloren" ? "lost" : ""}">${STAGES.map((s, i) => `<button class="step ${s.id === l.stage ? "current" : cur > i ? "done" : ""}" data-act="lead-stage" data-id="${l.id}" data-stage="${s.id}">${i + 1}. ${esc(s.label)}<small>${esc(s.hint)}</small></button>`).join("")}
      <button class="step ${l.stage === "verloren" ? "current" : ""}" data-act="lead-stage" data-id="${l.id}" data-stage="verloren">✕ Verloren<small>${esc(l.verlorenGrund || "Kein Auftrag")}</small></button></div>`;

  const wa = l.phone ? `https://wa.me/${phoneDigits(l.phone)}?text=${encodeURIComponent(`Hallo ${l.name}, hier ist Elektro Linge. Vielen Dank für Ihre Anfrage (${l.thema}). `)}` : "";
  const nextStep = {
    neu: `<button class="btn btn-yellow" data-act="lead-stage" data-id="${l.id}" data-stage="kontakt">✓ Kontakt aufgenommen</button>`,
    kontakt: `<button class="btn btn-yellow" data-act="lead-termin" data-id="${l.id}">Vor-Ort-Termin eintragen</button>`,
    termin: `<button class="btn btn-yellow" data-act="lead-angebot" data-id="${l.id}">Angebot erstellen</button>`,
    angebot: belege.find((b) => b.typ === "angebot" && b.status === "versendet") ? `<a class="btn btn-yellow" href="#/beleg/${belege.find((b) => b.typ === "angebot" && b.status === "versendet").id}">Angebot öffnen &amp; Antwort eintragen</a>` : `<button class="btn btn-yellow" data-act="lead-angebot" data-id="${l.id}">Angebot erstellen</button>`,
    auftrag: `<button class="btn btn-yellow" data-act="lead-stage" data-id="${l.id}" data-stage="ausfuehrung">Arbeiten gestartet</button>`,
    ausfuehrung: belege.find((b) => b.typ === "angebot" && b.status === "angenommen") ? `<button class="btn btn-yellow" data-act="beleg-to-rechnung" data-id="${belege.find((b) => b.typ === "angebot" && b.status === "angenommen").id}">Rechnung erstellen</button>` : `<button class="btn btn-yellow" data-act="rechnung-new" data-kunde="${k?.id || ""}" data-lead="${l.id}">Rechnung erstellen</button>`,
  }[l.stage] || "";

  return `
    ${pageHead(esc(l.name || "(ohne Namen)"), `${esc(l.nr)} · eingegangen ${fmtDateTime(l.createdAt)} über <b>${esc(l.quelle)}</b>`,
      `${nextStep}<button class="btn" data-act="lead-edit" data-id="${l.id}">Bearbeiten</button><button class="btn btn-danger" data-act="lead-delete" data-id="${l.id}">Löschen</button>`,
      `<a href="#/leads">Anfragen &amp; Kundenreise</a> / ${esc(l.nr)}`)}
    <div class="card card-pad" style="margin-bottom:18px">${journey}</div>
    <div class="grid grid-side">
      <div class="stack">
        <div class="card"><div class="card-head"><h3>Anfrage</h3><span class="pill yellow">${esc(l.thema)}</span></div>
          <div class="card-body">${l.nachricht ? `<div class="message-box">${esc(l.nachricht)}</div>` : `<p class="muted">Keine Nachricht hinterlegt.</p>`}</div></div>
        <div class="card"><div class="card-head"><h3>Kundenreise &amp; Notizen</h3></div>
          <div class="card-body">
            <form class="akt-form" data-lead="${l.id}" style="display:grid;gap:8px;margin-bottom:18px">
              <div style="display:flex;gap:8px;flex-wrap:wrap"><select name="typ" class="input" style="width:auto">${opt(Object.entries(AKT).filter(([k]) => k !== "system").map(([k, v]) => [k, v[0] + " " + v[1]]))}</select>
              <input class="input" name="wv" type="date" title="Wiedervorlage (optional)" style="width:auto"><span class="small muted" style="align-self:center">Wiedervorlage optional</span></div>
              <textarea class="input" name="text" rows="2" placeholder="z. B. Kunde angerufen, Termin am Dienstag 10 Uhr vereinbart …" required></textarea>
              <div><button class="btn btn-black btn-small" type="submit">Eintrag speichern</button></div>
            </form>
            <ul class="timeline">${(l.aktivitaeten || []).map((a) => `<li><span class="dot ${a.typ === "system" ? "sys" : ""}">${AKT[a.typ]?.[0] || "•"}</span><div class="when">${fmtDateTime(a.at)} · ${esc(AKT[a.typ]?.[1] || a.typ)}${a.typ !== "system" ? ` · <button class="link small" data-act="akt-del" data-id="${l.id}" data-akt="${a.id}">entfernen</button>` : ""}</div><div class="txt">${esc(a.text)}</div></li>`).join("")}</ul>
          </div></div>
      </div>
      <div class="stack">
        <div class="card"><div class="card-head"><h3>Kontakt</h3></div><div class="card-body">
          <dl class="kv">
            <dt>Telefon</dt><dd>${l.phone ? `<a href="tel:${esc(l.phone.replace(/[^\d+]/g, ""))}">${esc(l.phone)}</a>` : "—"}</dd>
            <dt>E-Mail</dt><dd>${l.email ? `<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>` : "—"}</dd>
            <dt>Adresse</dt><dd>${esc([l.strasse, l.plzOrt].filter(Boolean).join(", ")) || "—"}</dd>
            <dt>Wert</dt><dd>${leadValue(l) ? eur(leadValue(l)) : "—"}</dd>
          </dl>
          <div class="quick" style="margin-top:14px">
            ${l.phone ? `<a class="btn btn-small" href="tel:${esc(l.phone.replace(/[^\d+]/g, ""))}" data-act="log-call" data-id="${l.id}">☎ Anrufen</a>` : ""}
            ${wa ? `<a class="btn btn-small" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
            ${l.email ? `<a class="btn btn-small" href="mailto:${esc(l.email)}?subject=${encodeURIComponent("Ihre Anfrage bei Elektro Linge – " + l.thema)}&body=${encodeURIComponent(`Guten Tag ${l.name},\n\nvielen Dank für Ihre Anfrage.\n\n`)}">✉ E-Mail</a>` : ""}
            ${l.strasse || l.plzOrt ? `<a class="btn btn-small" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([l.strasse, l.plzOrt].join(" "))}" target="_blank" rel="noopener">Karte</a>` : ""}
          </div></div></div>
        <div class="card"><div class="card-head"><h3>Wiedervorlage</h3>${leadDue(l) ? `<span class="pill red">fällig</span>` : ""}</div><div class="card-body">
          <input type="date" class="input" value="${esc(l.wiedervorlage)}" data-act-change="lead-wv" data-id="${l.id}">
          <div class="quick" style="margin-top:10px">${[[1, "Morgen"], [3, "+3 Tage"], [7, "+1 Woche"], [14, "+2 Wochen"]].map(([d, t]) => `<button class="btn btn-small" data-act="lead-wv-set" data-id="${l.id}" data-days="${d}">${t}</button>`).join("")}${l.wiedervorlage ? `<button class="btn btn-small" data-act="lead-wv-set" data-id="${l.id}" data-days="">✕</button>` : ""}</div>
        </div></div>
        <div class="card"><div class="card-head"><h3>Kunde</h3></div><div class="card-body">
          ${k ? `<p><a href="#/kunde/${k.id}" class="strong">${esc(kundeName(k))}</a><br><span class="muted small">${esc(k.nr)} · ${esc(kundeAdresse(k).slice(-2).join(", "))}</span></p>` : `<p class="muted small">Noch nicht in der Kundendatenbank.</p><button class="btn btn-small" data-act="lead-kunde" data-id="${l.id}">In Kundendatenbank übernehmen</button>`}
        </div></div>
        <div class="card"><div class="card-head"><h3>Angebote &amp; Rechnungen</h3><button class="btn btn-small" data-act="lead-angebot" data-id="${l.id}">+ Angebot</button></div><div class="card-body">
          ${belege.length ? `<ul class="todo">${belege.map((b) => `<li><span class="ic">${b.typ === "angebot" ? "✎" : "€"}</span><div><a href="#/beleg/${b.id}">${belegLabel(b)} ${esc(belegNr(b))}</a> ${statusPill(b)}<div class="d">${fmtDate(b.datum)} · ${eur(belegTotals(b).brutto)}</div></div></li>`).join("")}</ul>` : `<p class="muted small">Noch kein Angebot erstellt.</p>`}
        </div></div>
      </div>
    </div>`;
};

function leadTerminDialog(l) {
  modal({
    title: "Vor-Ort-Termin eintragen",
    body: `<div class="form-grid">${field("Datum", `<input type="date" name="datum" value="${addDays(todayISO(), 1)}" required>`)}${field("Uhrzeit", `<input type="time" name="zeit" value="10:00">`)}${field("Adresse", inp("ort", [l.strasse, l.plzOrt].filter(Boolean).join(", ")), "full")}${field("Notiz", `<textarea name="notiz" rows="2"></textarea>`, "full")}</div>
      <p class="small muted" style="margin:12px 0 0">Der Termin wird in der Kundenreise vermerkt und als Wiedervorlage gesetzt.</p>`,
    submitLabel: "Termin speichern",
    onSubmit: (d) => {
      addAkt(l, "termin", `Vor-Ort-Termin am ${fmtDate(d.datum)}${d.zeit ? " um " + d.zeit + " Uhr" : ""}${d.ort ? " – " + d.ort : ""}${clean(d.notiz) ? "\n" + d.notiz : ""}`);
      l.wiedervorlage = d.datum;
      advance(l, "termin");
      Store.save(); render();
      const start = d.datum.replace(/-/g, "") + "T" + (d.zeit || "10:00").replace(":", "") + "00";
      const endH = String(Math.min(23, Number((d.zeit || "10:00").slice(0, 2)) + 1)).padStart(2, "0");
      const end = d.datum.replace(/-/g, "") + "T" + endH + (d.zeit || "10:00").slice(3) + "00";
      const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Elektro Linge//ERP//DE", "BEGIN:VEVENT", `UID:${uid()}@elektrolinge.de`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`, `DTSTART:${start}`, `DTEND:${end}`, `SUMMARY:Vor-Ort-Termin ${l.name} (${l.thema})`, `LOCATION:${(d.ort || "").replace(/[,;]/g, "\\$&")}`, `DESCRIPTION:${[l.phone, l.email, d.notiz].filter(Boolean).join(" · ").replace(/[,;]/g, "\\$&").replace(/\n/g, "\\n")}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
      toast(`Termin gespeichert · <button class="link" style="color:var(--yellow)" id="ics-dl">In Kalender übernehmen</button>`);
      setTimeout(() => $("#ics-dl")?.addEventListener("click", () => download(`Termin-${l.name.replace(/\W+/g, "-")}.ics`, ics, "text/calendar")), 0);
    },
  });
}

// ---------------------------------------------------------------------
// Kunden
// ---------------------------------------------------------------------
function kundeForm(k = {}) {
  return `<div class="form-grid">
    ${field("Kundenart", `<select name="typ">${opt([["privat", "Privatkunde"], ["gewerbe", "Gewerbekunde"]], k.typ || "privat")}</select>`)}
    ${field("Anrede", `<select name="anrede">${opt([["", "—"], "Herr", "Frau", "Familie", "Firma"], k.anrede)}</select>`)}
    ${field("Vorname", inp("vorname", k.vorname))}
    ${field("Nachname", inp("nachname", k.nachname))}
    ${field("Firma", inp("firma", k.firma, 'placeholder="nur bei Gewerbekunden"'), "full")}
    ${field("Straße und Hausnummer", inp("strasse", k.strasse), "full")}
    ${field("PLZ", inp("plz", k.plz, 'inputmode="numeric"'))}
    ${field("Ort", inp("ort", k.ort))}
    ${field("Telefon", inp("telefon", k.telefon, 'type="tel"'))}
    ${field("Mobil", inp("mobil", k.mobil, 'type="tel"'))}
    ${field("E-Mail", inp("email", k.email, 'type="email"'))}
    ${field("Quelle", `<select name="quelle">${opt(["", ...QUELLEN], k.quelle)}</select>`)}
    ${field("Notizen", `<textarea name="notizen" rows="3">${esc(k.notizen)}</textarea>`, "full")}
  </div>`;
}
function kundeDialog(k, onDone) {
  modal({
    title: k ? `Kunde bearbeiten · ${k.nr}` : "Neuer Kunde",
    size: "wide",
    body: kundeForm(k || {}),
    onSubmit: (d) => {
      if (!clean(d.nachname) && !clean(d.firma) && !clean(d.vorname)) { toast("Bitte Name oder Firma eingeben.", "err"); return false; }
      if (k) Object.assign(k, Object.fromEntries(Object.entries(d).map(([a, b]) => [a, clean(b)])));
      const kk = k || createKunde(d);
      Store.save();
      toast(k ? "Kunde gespeichert" : `Kunde <b>${esc(kk.nr)}</b> angelegt`);
      if (onDone) onDone(kk); else render();
    },
  });
}

VIEWS.kunden = () => {
  const q = lc(ui.kundenQ);
  const list = DB().kunden.filter((k) => !q || [kundeName(k), k.nr, k.ort, k.plz, k.email, k.telefon, k.mobil, k.strasse].some((x) => lc(x).includes(q)));
  const rows = list.map((k) => {
    const bel = DB().belege.filter((b) => b.kundeId === k.id);
    return `<tr class="click" data-href="#/kunde/${k.id}"><td class="muted small nowrap">${esc(k.nr)}</td><td class="strong">${esc(kundeName(k))}${k.firma && k.nachname ? `<div class="small muted">${esc(kundePerson(k))}</div>` : ""}</td>
      <td>${esc([k.plz, k.ort].filter(Boolean).join(" "))}</td><td class="nowrap">${esc(k.telefon || k.mobil)}</td><td>${esc(k.email)}</td>
      <td><span class="pill">${k.typ === "gewerbe" ? "Gewerbe" : "Privat"}</span></td><td class="num">${bel.length}</td><td class="num">${eur(kundeUmsatz(k))}</td></tr>`;
  }).join("");
  return `${pageHead("Kunden", `${DB().kunden.length} Kunden in der Datenbank · Kundennummern werden fortlaufend vergeben`, `<button class="btn" data-act="kunden-csv">CSV-Export</button><button class="btn btn-yellow" data-act="kunde-new">+ Neuer Kunde</button>`)}
    <div class="toolbar"><input type="search" placeholder="Name, Ort, Telefon, Kundennummer …" value="${esc(ui.kundenQ)}" data-ui="kundenQ" data-keep="kundenQ"></div>
    <div class="card table-wrap">${DB().kunden.length ? `<table class="table"><thead><tr><th>Nr.</th><th>Name</th><th>Ort</th><th>Telefon</th><th>E-Mail</th><th>Art</th><th class="num">Belege</th><th class="num">Umsatz</th></tr></thead><tbody>${rows || `<tr><td colspan="8" class="muted">Keine Treffer.</td></tr>`}</tbody></table>`
      : emptyState("Noch keine Kunden", "Kunden entstehen automatisch, sobald aus einer Anfrage ein Angebot wird – oder legen Sie sie hier direkt an.", `<button class="btn btn-yellow" data-act="kunde-new">+ Neuer Kunde</button>`)}</div>`;
};

VIEWS.kunde = (id) => {
  const k = kundeById(id);
  if (!k) return `<div class="card">${emptyState("Kunde nicht gefunden", "", `<a class="btn" href="#/kunden">Zur Kundenliste</a>`)}</div>`;
  const belege = DB().belege.filter((b) => b.kundeId === k.id);
  const leads = DB().leads.filter((l) => l.kundeId === k.id);
  const tel = k.telefon || k.mobil;
  return `${pageHead(esc(kundeName(k)), `${esc(k.nr)} · ${k.typ === "gewerbe" ? "Gewerbekunde" : "Privatkunde"} · seit ${fmtDate(toISO(new Date(k.createdAt)))}`,
      `<button class="btn btn-yellow" data-act="angebot-new" data-kunde="${k.id}">+ Angebot</button><button class="btn" data-act="rechnung-new" data-kunde="${k.id}">+ Rechnung</button><button class="btn" data-act="kunde-edit" data-id="${k.id}">Bearbeiten</button><button class="btn btn-danger" data-act="kunde-delete" data-id="${k.id}">Löschen</button>`,
      `<a href="#/kunden">Kunden</a> / ${esc(k.nr)}`)}
    <div class="kpis">
      <div class="card kpi"><div class="label">Umsatz (Rechnungen)</div><div class="value">${eur(kundeUmsatz(k))}</div></div>
      <div class="card kpi"><div class="label">Angebote</div><div class="value">${belege.filter((b) => b.typ === "angebot").length}</div><div class="sub">${belege.filter((b) => b.typ === "angebot" && b.status === "angenommen").length} angenommen</div></div>
      <div class="card kpi"><div class="label">Offen</div><div class="value">${eur(belege.filter((b) => b.typ === "rechnung" && b.status === "offen").reduce((s, b) => s + belegTotals(b).brutto, 0))}</div><div class="sub">unbezahlte Rechnungen</div></div>
    </div>
    <div class="grid grid-side">
      <div class="stack">
        <div class="card"><div class="card-head"><h3>Angebote &amp; Rechnungen</h3></div>
          ${belege.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Beleg</th><th>Datum</th><th>Betreff</th><th>Status</th><th class="num">Brutto</th></tr></thead><tbody>${belege.map((b) => `<tr class="click" data-href="#/beleg/${b.id}"><td class="nowrap strong">${belegLabel(b)} ${esc(belegNr(b))}</td><td>${fmtDate(b.datum)}</td><td>${esc(b.betreff)}</td><td>${statusPill(b)}</td><td class="num">${eur(belegTotals(b).brutto)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="card-body muted small">Noch keine Belege.</div>`}
        </div>
        <div class="card"><div class="card-head"><h3>Kundenreise</h3></div><div class="card-body">
          ${leads.length ? `<ul class="todo">${leads.map((l) => `<li><span class="ic yellow">⚡</span><div><a href="#/lead/${l.id}">${esc(l.thema)}</a> <span class="pill">${esc(stageLabel(l.stage))}</span><div class="d">${esc(l.nr)} · ${fmtDate(toISO(new Date(l.createdAt)))} · ${esc(l.quelle)}</div></div></li>`).join("")}</ul>` : `<p class="muted small">Keine verknüpften Anfragen.</p>`}
          <button class="btn btn-small" data-act="kunde-lead" data-id="${k.id}" style="margin-top:8px">+ Neue Anfrage für diesen Kunden</button>
        </div></div>
      </div>
      <div class="stack">
        <div class="card"><div class="card-head"><h3>Stammdaten</h3></div><div class="card-body">
          <p>${kundeAdresse(k).map(esc).join("<br>") || "<span class='muted'>Keine Adresse</span>"}</p>
          <dl class="kv"><dt>Telefon</dt><dd>${k.telefon ? `<a href="tel:${esc(k.telefon.replace(/[^\d+]/g, ""))}">${esc(k.telefon)}</a>` : "—"}</dd>
          <dt>Mobil</dt><dd>${k.mobil ? `<a href="tel:${esc(k.mobil.replace(/[^\d+]/g, ""))}">${esc(k.mobil)}</a>` : "—"}</dd>
          <dt>E-Mail</dt><dd>${k.email ? `<a href="mailto:${esc(k.email)}">${esc(k.email)}</a>` : "—"}</dd>
          <dt>Quelle</dt><dd>${esc(k.quelle) || "—"}</dd></dl>
          <div class="quick" style="margin-top:14px">${tel ? `<a class="btn btn-small" href="https://wa.me/${phoneDigits(k.mobil || k.telefon)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}${k.strasse ? `<a class="btn btn-small" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(kundeAdresse(k).slice(-2).join(" "))}" target="_blank" rel="noopener">Karte</a>` : ""}</div>
        </div></div>
        <div class="card"><div class="card-head"><h3>Notizen</h3></div><div class="card-body"><textarea class="input" rows="6" data-act-change="kunde-notiz" data-id="${k.id}" placeholder="z. B. Zählerschrank im Keller, Hund im Garten, Schlüssel beim Nachbarn …">${esc(k.notizen)}</textarea></div></div>
      </div>
    </div>`;
};

// ---------------------------------------------------------------------
// Angebote & Rechnungen (Listen)
// ---------------------------------------------------------------------
function belegList(typ) {
  const isA = typ === "angebot";
  const tabKey = isA ? "angTab" : "reTab";
  const qKey = isA ? "angQ" : "reQ";
  const all = DB().belege.filter((b) => b.typ === typ);
  const t = todayISO();
  const tabs = isA
    ? [["alle", "Alle", () => true], ["entwurf", "Entwürfe", (b) => b.status === "entwurf"], ["versendet", "Beim Kunden", (b) => b.status === "versendet"], ["angenommen", "Angenommen", (b) => b.status === "angenommen"], ["abgelehnt", "Abgelehnt", (b) => b.status === "abgelehnt"]]
    : [["alle", "Alle", () => true], ["entwurf", "Entwürfe", (b) => b.status === "entwurf"], ["offen", "Offen", (b) => b.status === "offen"], ["ueberfaellig", "Überfällig", (b) => b.status === "offen" && b.faelligAm < t], ["bezahlt", "Bezahlt", (b) => b.status === "bezahlt"], ["storniert", "Storniert", (b) => b.status === "storniert"]];
  const filter = tabs.find((x) => x[0] === ui[tabKey])?.[2] || (() => true);
  const q = lc(ui[qKey]);
  const list = all.filter(filter).filter((b) => !q || [b.nr, b.betreff, kundeName(kundeById(b.kundeId))].some((x) => lc(x).includes(q)));
  const sumB = list.reduce((s, b) => s + belegTotals(b).brutto, 0);
  const rows = list.map((b) => {
    const tt = belegTotals(b);
    return `<tr class="click" data-href="#/beleg/${b.id}"><td class="strong nowrap">${esc(belegNr(b))}</td><td class="nowrap">${fmtDate(b.datum)}</td><td>${esc(kundeName(kundeById(b.kundeId)) || "—")}</td><td>${esc(b.betreff)}</td>
      <td class="nowrap">${fmtDate(isA ? b.gueltigBis : b.faelligAm)}</td><td>${statusPill(b)}</td><td class="num">${eur(tt.netto)}</td><td class="num strong">${eur(tt.brutto)}</td></tr>`;
  }).join("");
  const title = isA ? "Angebote" : "Rechnungen";
  const sub = isA ? `Angebotsnummern fortlaufend (${esc(formatNr(S().nummern.angebot, S().nummern.angebot.next))} ist die nächste)` : `Rechnungsnummern werden beim Festschreiben lückenlos vergeben (nächste: ${esc(formatNr(S().nummern.rechnung, S().nummern.rechnung.next))})`;
  return `${pageHead(title, sub, `<button class="btn" data-act="belege-csv" data-typ="${typ}">CSV-Export</button><button class="btn btn-yellow" data-act="${typ}-new">+ ${isA ? "Neues Angebot" : "Neue Rechnung"}</button>`)}
    <div class="toolbar"><div class="tabs">${tabs.map(([k, l, f]) => `<button data-act="ui" data-k="${tabKey}" data-v="${k}" class="${ui[tabKey] === k ? "active" : ""}">${l}<span>${all.filter(f).length}</span></button>`).join("")}</div>
      <input type="search" placeholder="Nummer, Kunde, Betreff …" value="${esc(ui[qKey])}" data-ui="${qKey}" data-keep="${qKey}"></div>
    <div class="card table-wrap">${all.length ? `<table class="table"><thead><tr><th>Nr.</th><th>Datum</th><th>Kunde</th><th>Betreff</th><th>${isA ? "Gültig bis" : "Fällig"}</th><th>Status</th><th class="num">Netto</th><th class="num">Brutto</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="8" class="muted">Keine Einträge.</td></tr>`}</tbody>${list.length ? `<tfoot><tr><td colspan="7" class="right muted">Summe (${list.length})</td><td class="num strong">${eur(sumB)}</td></tr></tfoot>` : ""}</table>`
      : emptyState(isA ? "Noch keine Angebote" : "Noch keine Rechnungen", isA ? "Erstellen Sie ein Angebot direkt aus einer Anfrage – Kunde und Thema werden automatisch übernommen." : "Rechnungen entstehen am einfachsten aus einem angenommenen Angebot.", `<button class="btn btn-yellow" data-act="${typ}-new">+ ${isA ? "Neues Angebot" : "Neue Rechnung"}</button>`)}</div>`;
}
VIEWS.angebote = () => belegList("angebot");
VIEWS.rechnungen = () => belegList("rechnung");

// ---------------------------------------------------------------------
// Beleg-Editor
// ---------------------------------------------------------------------
function posRow(p, i, locked) {
  const dis = locked ? "disabled" : "";
  if (p.typ === "titel") {
    return `<tr class="titel" data-pid="${p.id}"><td class="c-pos"></td><td class="c-name" colspan="7"><input value="${esc(p.name)}" data-pi="${i}" data-pf="name" placeholder="Zwischenüberschrift, z. B. Küche" ${dis}></td>
      <td class="c-act">${locked ? "" : posButtons(i)}</td></tr>`;
  }
  return `<tr data-pid="${p.id}">
    <td class="c-pos">${posNumber(i)}</td>
    <td class="c-name"><input class="name" value="${esc(p.name)}" data-pi="${i}" data-pf="name" placeholder="Bezeichnung" ${dis}>
      <textarea rows="1" data-pi="${i}" data-pf="beschreibung" placeholder="Beschreibung (optional)" ${dis}>${esc(p.beschreibung)}</textarea>${p.artNr ? `<div class="art-nr">${esc(p.artNr)}${p.art === "lohn" ? " · Lohn" : ""}</div>` : ""}</td>
    <td class="c-menge" data-label="Menge"><input class="n" value="${inNum(p.menge, 0)}" data-pi="${i}" data-pf="menge" inputmode="decimal" ${dis}></td>
    <td class="c-einheit" data-label="Einheit"><input value="${esc(p.einheit)}" data-pi="${i}" data-pf="einheit" list="einheiten" ${dis}></td>
    <td class="c-preis" data-label="Einzelpreis €"><input class="n" value="${inNum(p.preis)}" data-pi="${i}" data-pf="preis" inputmode="decimal" ${dis}></td>
    <td class="c-rabatt" data-label="Rabatt %"><input class="n" value="${p.rabatt ? inNum(p.rabatt, 0) : ""}" placeholder="0" data-pi="${i}" data-pf="rabatt" inputmode="decimal" ${dis}></td>
    <td class="c-mwst" data-label="MwSt"><select data-pi="${i}" data-pf="mwst" ${dis}>${opt([[19, "19 %"], [7, "7 %"], [0, "0 %"]], p.mwst)}</select></td>
    <td class="c-sum" data-label="Gesamt netto" id="ps-${p.id}">${eur(posTotal(p))}</td>
    <td class="c-act">${locked ? "" : posButtons(i)}</td></tr>`;
}
let currentBeleg = null;
function posNumber(i) {
  const list = currentBeleg?.positionen || [];
  let n = 0;
  for (let j = 0; j <= i; j++) if (list[j]?.typ !== "titel") n++;
  return n;
}
const posButtons = (i) => `<button class="btn btn-icon" type="button" data-act="pos-up" data-i="${i}" title="Nach oben">↑</button><button class="btn btn-icon" type="button" data-act="pos-down" data-i="${i}" title="Nach unten">↓</button><button class="btn btn-icon btn-danger" type="button" data-act="pos-del" data-i="${i}" title="Entfernen">✕</button>`;

function totalsHtml(b) {
  const t = belegTotals(b);
  const k = kundeById(b.kundeId);
  return `<div><span>Summe netto</span><span>${eur(t.netto)}</span></div>
    ${t.steuern.map((s) => `<div><span>zzgl. ${s.satz} % MwSt.${t.steuern.length > 1 ? ` auf ${eur(s.basis)}` : ""}</span><span>${eur(s.betrag)}</span></div>`).join("")}
    <div class="grand"><span>Gesamt brutto</span><span>${eur(t.brutto)}</span></div>
    ${t.lohn && k?.typ !== "gewerbe" ? `<div class="small muted"><span>davon Arbeitskosten (§ 35a EStG)</span><span>${eur(t.lohn)}</span></div>` : ""}`;
}

VIEWS.beleg = (id) => {
  const b = belegById(id);
  currentBeleg = b;
  if (!b) return `<div class="card">${emptyState("Beleg nicht gefunden", "", `<a class="btn" href="#/angebote">Zu den Angeboten</a>`)}</div>`;
  const isA = b.typ === "angebot";
  const locked = isLocked(b);
  const k = kundeById(b.kundeId);
  const lead = leadById(b.leadId);
  const bezug = belegById(b.bezugId);
  const rechnungen = isA ? DB().belege.filter((r) => r.typ === "rechnung" && r.bezugId === b.id) : [];
  const lagerPos = isA ? lagerPositionen(b) : [];

  const A = (act, label, cls = "") => `<button class="btn ${cls}" data-act="${act}" data-id="${b.id}">${label}</button>`;
  let actions = A("beleg-preview", "Vorschau &amp; PDF", "btn-black");
  if (isA) {
    if (b.status === "entwurf") actions += A("beleg-send", "Als versendet markieren", "btn-yellow") + A("beleg-mail", "Per E-Mail senden");
    if (b.status === "versendet") actions += A("beleg-accept", "✓ Angenommen", "btn-green") + A("beleg-reject", "✕ Abgelehnt", "btn-danger") + A("beleg-mail", "Erneut senden");
    if (b.status === "angenommen") {
      actions += A("beleg-to-rechnung", rechnungen.length ? "Weitere Rechnung" : "Rechnung erstellen", "btn-yellow");
      if (lagerPos.length && !b.materialGebucht) actions += A("beleg-material", "Material ausbuchen");
      actions += A("beleg-reopen", "Wieder öffnen");
    }
    if (b.status === "abgelehnt") actions += A("beleg-reopen", "Wieder öffnen");
    actions += A("beleg-copy", "Duplizieren");
    if (b.status === "entwurf") actions += A("beleg-delete", "Löschen", "btn-danger");
  } else {
    if (b.status === "entwurf") actions += A("beleg-finalize", "Rechnung festschreiben", "btn-yellow") + A("beleg-delete", "Löschen", "btn-danger");
    if (b.status === "offen") actions += A("beleg-paid", "✓ Bezahlt", "btn-green") + A("beleg-mail", "Per E-Mail senden") + A("beleg-storno", "Stornieren", "btn-danger");
    if (b.status === "bezahlt") actions += A("beleg-unpaid", "Zahlung zurücksetzen");
    actions += A("beleg-copy", "Duplizieren");
  }

  const links = [
    lead ? `Anfrage: <a href="#/lead/${lead.id}">${esc(lead.name)} (${esc(stageLabel(lead.stage))})</a>` : "",
    k ? `Kunde: <a href="#/kunde/${k.id}">${esc(kundeName(k))}</a>` : "",
    bezug ? `Aus Angebot: <a href="#/beleg/${bezug.id}">${esc(bezug.nr)}</a>` : "",
    rechnungen.length ? `Rechnung${rechnungen.length > 1 ? "en" : ""}: ${rechnungen.map((r) => `<a href="#/beleg/${r.id}">${esc(belegNr(r))}</a>`).join(", ")}` : "",
    b.gesendetAm ? `versendet ${fmtDate(toISO(new Date(b.gesendetAm)))}` : "",
    b.angenommenAm ? `angenommen ${fmtDate(b.angenommenAm)}` : "",
    b.bezahltAm ? `bezahlt ${fmtDate(b.bezahltAm)}` : "",
    b.materialGebucht ? `Material ausgebucht` : "",
  ].filter(Boolean);

  const kundenOpts = [["", "– Kunde wählen –"], ...DB().kunden.map((x) => [x.id, `${kundeName(x)} (${x.nr})${x.ort ? " · " + x.ort : ""}`])];
  const dis = locked ? "disabled" : "";

  after(bindBelegEditor);

  return `${pageHead(`${belegLabel(b)} ${esc(belegNr(b))} ${statusPill(b)}`, "", actions, `<a href="#/${isA ? "angebote" : "rechnungen"}">${isA ? "Angebote" : "Rechnungen"}</a> / ${esc(belegNr(b))}`)}
    ${links.length ? `<div class="status-bar">${links.join(" <span class='muted'>·</span> ")}</div>` : ""}
    ${locked ? `<div class="notice blue">${isA ? "Dieses Angebot ist angenommen und daher gesperrt. Zum Ändern „Wieder öffnen“ wählen." : "Diese Rechnung ist festgeschrieben und kann nicht mehr geändert werden (GoBD). Für Korrekturen bitte stornieren und neu erstellen."}</div>` : ""}
    ${!isA && b.status === "entwurf" ? `<div class="notice">Entwurf – die Rechnungsnummer wird beim Festschreiben fortlaufend vergeben.</div>` : ""}
    <div class="card card-pad" style="margin-bottom:18px">
      <div class="doc-head">
        <label class="field wide"><span>Kunde</span><div style="display:flex;gap:6px"><select data-bf="kundeId" class="input" ${dis}>${opt(kundenOpts, b.kundeId)}</select>${locked ? "" : `<button class="btn" type="button" data-act="beleg-kunde-new" data-id="${b.id}" title="Neuen Kunden anlegen">+</button>`}</div></label>
        ${field(isA ? "Angebotsdatum" : "Rechnungsdatum", `<input type="date" data-bf="datum" value="${esc(b.datum)}" ${dis}>`)}
        ${isA ? field("Gültig bis", `<input type="date" data-bf="gueltigBis" value="${esc(b.gueltigBis)}" ${dis}>`) : field("Zahlbar bis", `<input type="date" data-bf="faelligAm" value="${esc(b.faelligAm)}" ${dis}>`)}
        ${field("Betreff / Bauvorhaben", `<input data-bf="betreff" value="${esc(b.betreff)}" placeholder="z. B. Wallbox-Installation Garage" ${dis}>`, "wide")}
        ${!isA ? field("Leistungszeitraum", `<input data-bf="leistung" value="${esc(b.leistung)}" placeholder="z. B. 03.11.–05.11.${new Date().getFullYear()}" ${dis}>`, "wide") : ""}
        ${field("Einleitungstext", `<textarea data-bf="einleitung" rows="3" ${dis}>${esc(b.einleitung)}</textarea>`, "wide", "Platzhalter: {ANREDE}, {GUELTIG}, {FAELLIG}")}
        ${field("Schlusstext", `<textarea data-bf="schluss" rows="3" ${dis}>${esc(b.schluss)}</textarea>`, "wide")}
      </div>
    </div>
    <div class="card card-pad" style="margin-bottom:18px">
      <h2 style="margin-bottom:10px">Positionen</h2>
      <datalist id="einheiten">${EINHEITEN.map((e) => `<option value="${e}">`).join("")}</datalist>
      <div class="table-wrap"><table class="pos-table ${locked ? "locked" : ""}"><thead><tr><th>Pos.</th><th>Bezeichnung</th><th class="n">Menge</th><th>Einheit</th><th class="n">Einzelpreis €</th><th class="n">Rabatt %</th><th>MwSt</th><th class="n" style="text-align:right">Gesamt</th><th></th></tr></thead>
      <tbody id="pos-body">${b.positionen.map((p, i) => posRow(p, i, locked)).join("") || `<tr><td colspan="9" class="muted" style="padding:20px 6px">Noch keine Positionen – Artikel aus dem Stamm hinzufügen oder freie Position anlegen.</td></tr>`}</tbody></table></div>
      ${locked ? "" : `<div class="pos-add"><button class="btn btn-yellow" data-act="pos-artikel" data-id="${b.id}">+ Artikel / Leistung</button><button class="btn" data-act="pos-frei" data-id="${b.id}">+ Freie Position</button><button class="btn" data-act="pos-titel" data-id="${b.id}">+ Zwischenüberschrift</button></div>`}
      <div class="totals" id="totals">${totalsHtml(b)}</div>
    </div>
    <div class="card card-pad">${field("Interne Notiz (erscheint nicht auf dem Beleg)", `<textarea data-bf="notiz" rows="2">${esc(b.notiz)}</textarea>`)}</div>`;
};

function bindBelegEditor() {
  const view = $("#view");
  // Textfelder automatisch in der Höhe anpassen
  $$(".pos-table textarea", view).forEach((t) => { const fit = () => { t.style.height = "auto"; t.style.height = Math.max(34, t.scrollHeight + 2) + "px"; }; fit(); t.addEventListener("input", fit); });
}

function artikelPicker(b) {
  const items = DB().artikel.filter((a) => a.aktiv !== false);
  const listHtml = (q) => {
    const ql = lc(q);
    const hits = items.filter((a) => !ql || [a.name, a.nr, a.kategorie, a.beschreibung].some((x) => lc(x).includes(ql))).slice(0, 60);
    return hits.map((a, i) => `<button type="button" class="${i === 0 ? "focus" : ""}" data-pick="${a.id}"><span class="strong">${esc(a.name)}</span><span class="p">${eur(a.vk)} / ${esc(a.einheit)}</span><small>${esc(a.nr)} · ${esc(a.kategorie)}${a.lager ? ` · Lager: ${num(a.bestand)} ${esc(a.einheit)}` : ""}</small></button>`).join("")
      || `<div class="empty small">Kein Artikel gefunden. ${items.length ? "" : "Legen Sie unter „Artikel &amp; Leistungen“ Ihren Artikelstamm an oder laden Sie die Beispielartikel."}</div>`;
  };
  modal({
    title: "Artikel / Leistung hinzufügen",
    size: "wide",
    body: `<div style="display:flex;gap:10px"><input class="input" type="search" name="q" placeholder="Suchen: Steckdose, Wallbox, Arbeitsstunde …" autofocus><input class="input" name="menge" value="1" inputmode="decimal" style="width:90px" title="Menge"></div><div class="picker-list" id="picker">${listHtml("")}</div><p class="small muted" style="margin:10px 0 0">Tipp: Enter übernimmt den ersten Treffer. Das Fenster bleibt offen, damit Sie mehrere Artikel nacheinander hinzufügen können.</p>`,
    foot: `<button type="button" class="btn" data-act="artikel-new-from-picker">+ Neuer Artikel</button><button type="button" class="btn btn-black" data-close>Fertig</button>`,
    onSubmit: (d, form) => { const first = $("[data-pick]", form); if (first) first.click(); return false; },
    onOpen: (form) => {
      const q = form.elements.q;
      q.addEventListener("input", () => { $("#picker", form).innerHTML = listHtml(q.value); });
      [q, form.elements.menge].forEach((el) => el.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        $("[data-pick]", form)?.click();
      }));
      form.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-pick]");
        if (!btn) return;
        const a = artikelById(btn.dataset.pick);
        b.positionen.push(posFromArtikel(a, parseNum(form.elements.menge.value) || 1));
        Store.save();
        render();
        toast(`<b>${esc(a.name)}</b> hinzugefügt`);
        q.value = ""; form.elements.menge.value = "1";
        $("#picker", form).innerHTML = listHtml("");
        q.focus();
      });
    },
  });
}

// ---------------------------------------------------------------------
// Beleg als Papier (Vorschau, Druck & PDF)
// ---------------------------------------------------------------------
function paperHtml(b) {
  const f = S().firma;
  const k = kundeById(b.kundeId);
  const t = belegTotals(b);
  const isA = b.typ === "angebot";
  const hasRabatt = b.positionen.some((p) => p.typ !== "titel" && parseNum(p.rabatt));
  const multiTax = new Set(b.positionen.filter((p) => p.typ !== "titel").map((p) => Number(p.mwst))).size > 1;
  let n = 0;
  const rows = b.positionen.map((p) => {
    if (p.typ === "titel") return `<tr class="titel"><td colspan="${hasRabatt ? 7 : 6}">${esc(p.name)}</td></tr>`;
    n++;
    return `<tr><td>${n}</td><td><div>${esc(p.name)}</div>${p.beschreibung ? `<div class="desc">${esc(p.beschreibung)}</div>` : ""}</td>
      <td class="r">${num(p.menge, 3)}</td><td>${esc(p.einheit)}</td><td class="r">${eur(p.preis)}</td>${hasRabatt ? `<td class="r">${parseNum(p.rabatt) ? num(p.rabatt) + " %" : ""}</td>` : ""}<td class="r">${eur(posTotal(p))}${multiTax ? `<div class="desc">${p.mwst} %</div>` : ""}</td></tr>`;
  }).join("");
  const title = isA ? "Angebot" : b.status === "storniert" ? "Rechnung – STORNIERT" : "Rechnung";
  const meta = [
    [isA ? "Angebots-Nr." : "Rechnungs-Nr.", belegNr(b)],
    ["Datum", fmtDate(b.datum)],
    k ? ["Kunden-Nr.", k.nr] : null,
    isA ? ["Gültig bis", fmtDate(b.gueltigBis)] : ["Zahlbar bis", fmtDate(b.faelligAm)],
    !isA && b.leistung ? ["Leistungszeitraum", b.leistung] : null,
    !isA && b.bezugId && belegById(b.bezugId) ? ["Zu Angebot", belegById(b.bezugId).nr] : null,
    f.inhaber ? ["Ansprechpartner", f.inhaber] : null,
    f.telefon ? ["Telefon", f.telefon] : null,
  ].filter(Boolean);
  const notes = [];
  if (b.positionen.some((p) => p.typ !== "titel" && Number(p.mwst) === 0)) notes.push("Positionen mit 0 % USt.: Lieferung und Installation einer Photovoltaikanlage gemäß § 12 Abs. 3 UStG (Nullsteuersatz).");
  if (t.lohn && k?.typ !== "gewerbe") notes.push(`Im Gesamtbetrag enthaltene Arbeits- und Fahrtkosten (inkl. MwSt.): ${eur(t.lohn)} – steuerlich absetzbar nach § 35a EStG.`);
  if (!isA && k?.typ !== "gewerbe" && b.status !== "storniert") notes.push("Hinweis gemäß § 14 Abs. 4 Nr. 9 UStG: Bitte bewahren Sie diese Rechnung zwei Jahre auf.");
  const bankLine = [f.bank, f.iban && "IBAN " + f.iban, f.bic && "BIC " + f.bic].filter(Boolean);
  const taxLine = [f.ustId && "USt-IdNr. " + f.ustId, f.steuernr && "St.-Nr. " + f.steuernr, f.register].filter(Boolean);
  const logo = new URL("../assets/logo-mark-navy.png", location.href).href;

  return `<div class="paper">
    <div class="p-head"><div class="p-brand"><img src="${logo}" alt=""><div><strong>${esc(f.name.replace(/\s*GmbH.*$/, "") || f.name)}</strong><span>${esc(f.zusatz)}</span></div></div>
      <div class="p-contact">${esc(f.name)}<br>${esc(f.strasse)} · ${esc(f.plzOrt)}<br>${esc(f.telefon)}<br>${esc(f.email)} · ${esc(f.web)}</div></div>
    <div class="p-addr-row"><div><div class="p-sender">${esc(f.name)} · ${esc(f.strasse)} · ${esc(f.plzOrt)}</div><div class="p-addr">${kundeAdresse(k).map(esc).join("<br>") || "<span style='color:#c00'>Kein Kunde gewählt</span>"}</div></div>
      <table class="p-meta">${meta.map(([a, v]) => `<tr><td>${esc(a)}</td><td>${esc(v)}</td></tr>`).join("")}</table></div>
    <h1 class="p-title">${esc(title)} ${esc(belegNr(b))}</h1>
    ${b.betreff ? `<div class="p-betreff">${esc(b.betreff)}</div>` : ""}
    ${b.einleitung ? `<div class="p-text">${esc(fillText(b.einleitung, b))}</div>` : ""}
    <table class="p-pos"><thead><tr><th style="width:7mm">Pos.</th><th>Bezeichnung</th><th class="r">Menge</th><th>Einh.</th><th class="r">Einzelpreis</th>${hasRabatt ? `<th class="r">Rabatt</th>` : ""}<th class="r">Gesamt</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="p-totals"><div><span>Summe netto</span><span>${eur(t.netto)}</span></div>${t.steuern.map((s) => `<div><span>zzgl. ${s.satz} % USt.${t.steuern.length > 1 ? ` auf ${eur(s.basis)}` : ""}</span><span>${eur(s.betrag)}</span></div>`).join("")}<div class="g"><span>${isA ? "Angebotssumme" : "Rechnungsbetrag"}</span><span>${eur(t.brutto)}</span></div></div>
    ${notes.map((x) => `<div class="p-note">${esc(x)}</div>`).join("")}
    ${b.schluss ? `<div class="p-text" style="margin-top:6mm">${esc(fillText(b.schluss, b))}</div>` : ""}
    ${isA ? `<div class="p-sign"><div>Ort, Datum</div><div>Auftrag erteilt – Unterschrift Auftraggeber</div></div>` : ""}
    <div style="height:24mm"></div>
    <div class="p-foot"><div>${esc(f.name)}<br>${esc(f.strasse)}<br>${esc(f.plzOrt)}${f.inhaber ? `<br>Geschäftsführung: ${esc(f.inhaber)}` : ""}</div>
      <div>Tel. ${esc(f.telefon)}<br>${esc(f.email)}<br>${esc(f.web)}</div>
      <div>${bankLine.map(esc).join("<br>") || "Bankverbindung: in den Einstellungen hinterlegen"}${taxLine.length ? "<br>" + taxLine.map(esc).join("<br>") : ""}</div></div>
  </div>`;
}

function previewDialog(b) {
  modal({
    title: `${belegLabel(b)} ${belegNr(b)} – Vorschau`,
    size: "xwide",
    body: `<div class="doc-preview">${paperHtml(b)}</div>`,
    foot: `<span class="small muted left">Zum Speichern als PDF im Druckdialog „Als PDF sichern“ wählen.</span><button type="button" class="btn" data-close>Schließen</button>${b.status !== "entwurf" || b.typ === "angebot" ? `<button type="button" class="btn" data-act="beleg-mail" data-id="${b.id}">Per E-Mail</button>` : ""}<button type="button" class="btn btn-black" data-act="beleg-print" data-id="${b.id}">Drucken / PDF</button>`,
  });
}
function printBeleg(b) {
  $("#print-area").innerHTML = paperHtml(b);
  const old = document.title;
  const k = kundeById(b.kundeId);
  document.title = `${belegLabel(b)} ${belegNr(b)}${k ? " " + kundeName(k) : ""}`.replace(/[\\/:*?"<>|]/g, "-");
  const imgs = $$("#print-area img");
  Promise.all(imgs.map((i) => (i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r; })))).then(() => {
    window.print();
    setTimeout(() => { document.title = old; }, 500);
  });
}

function mailBeleg(b) {
  const k = kundeById(b.kundeId);
  if (!k) { toast("Bitte zuerst einen Kunden wählen.", "err"); return; }
  const t = belegTotals(b);
  const isA = b.typ === "angebot";
  const subject = `${belegLabel(b)} ${belegNr(b)}${b.betreff ? " – " + b.betreff : ""} | Elektro Linge`;
  const body = `${anrede(k)},\n\n${isA ? `vielen Dank für Ihre Anfrage. Anbei erhalten Sie unser Angebot ${belegNr(b)} über ${eur(t.brutto)} (brutto).\nDas Angebot ist gültig bis zum ${fmtDate(b.gueltigBis)}.\n\nBei Fragen melden Sie sich gern – wir freuen uns auf Ihren Auftrag!` : `anbei erhalten Sie unsere Rechnung ${belegNr(b)} über ${eur(t.brutto)}.\nBitte überweisen Sie den Betrag bis zum ${fmtDate(b.faelligAm)}.\n\nVielen Dank für Ihren Auftrag!`}\n\nMit freundlichen Grüßen\n${S().firma.inhaber ? S().firma.inhaber + "\n" : ""}${S().firma.name}\n${S().firma.telefon}\n${S().firma.web}`;
  printBeleg(b);
  setTimeout(() => {
    location.href = `mailto:${encodeURIComponent(k.email || "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    toast("Bitte die gerade gespeicherte PDF an die E-Mail anhängen.");
    if (isA && b.status === "entwurf") markSent(b, false);
  }, 400);
}

function validateBeleg(b) {
  if (!b.kundeId || !kundeById(b.kundeId)) { toast("Bitte zuerst einen Kunden wählen.", "err"); return false; }
  if (!b.positionen.some((p) => p.typ !== "titel")) { toast("Bitte mindestens eine Position hinzufügen.", "err"); return false; }
  return true;
}
function markSent(b, rerender = true) {
  if (!validateBeleg(b)) return;
  b.status = "versendet";
  b.gesendetAm = Date.now();
  const l = leadById(b.leadId);
  if (l) {
    advance(l, "angebot", `Angebot ${b.nr}`);
    addAkt(l, "email", `Angebot ${b.nr} über ${eur(belegTotals(b).brutto)} versendet`);
    if (!l.wiedervorlage || l.wiedervorlage < addDays(todayISO(), 1)) l.wiedervorlage = addDays(todayISO(), 7);
  }
  Store.save();
  if (rerender) render();
  toast(`Angebot <b>${esc(b.nr)}</b> als versendet markiert${l ? " · Wiedervorlage in 7 Tagen" : ""}`);
}

// ---------------------------------------------------------------------
// Artikel & Leistungen
// ---------------------------------------------------------------------
function artikelForm(a = {}) {
  const isNew = !a.id;
  return `<div class="form-grid">
    ${field("Artikelnummer", inp("nr", a.nr || "", `placeholder="automatisch: ${esc(formatNr(S().nummern.artikel, S().nummern.artikel.next))}"`))}
    ${field("Kategorie", `<select name="kategorie">${opt(KATEGORIEN, a.kategorie || "Installation")}</select>`)}
    ${field("Bezeichnung *", inp("name", a.name, "required"), "full")}
    ${field("Beschreibung (erscheint im Angebot)", `<textarea name="beschreibung" rows="2">${esc(a.beschreibung)}</textarea>`, "full")}
    ${field("Art", `<select name="art">${opt(Object.entries(ARTEN), a.art || "material")}</select>`, "", "„Arbeitszeit / Lohn“ wird für § 35a EStG ausgewiesen")}
    ${field("Einheit", `<input name="einheit" value="${esc(a.einheit || "Stk")}" list="einheiten-m">`)}
    ${field("Einkaufspreis netto €", inp("ek", a.ek ? inNum(a.ek) : "", 'inputmode="decimal" placeholder="0,00"'))}
    ${field("Verkaufspreis netto € *", inp("vk", a.vk != null ? inNum(a.vk) : "", 'inputmode="decimal" required placeholder="0,00"'), "", `<span id="marge"></span> <button type="button" class="link" id="calc-vk">VK aus EK + Aufschlag berechnen</button>`)}
    ${field("MwSt", `<select name="mwst">${opt([[19, "19 %"], [7, "7 %"], [0, "0 % (PV-Anlagen § 12 Abs. 3 UStG)"]], a.mwst ?? S().mwst)}</select>`)}
    ${field("Status", `<select name="aktiv">${opt([["1", "Aktiv"], ["0", "Inaktiv (nicht mehr auswählbar)"]], a.aktiv === false ? "0" : "1")}</select>`)}
    <div class="form-section">Lager</div>
    <label class="check full"><input type="checkbox" name="lager" ${a.lager ? "checked" : ""}> Lagerartikel – Bestand führen</label>
    ${isNew ? field("Anfangsbestand", inp("bestand", "", 'inputmode="decimal" placeholder="0"')) : field("Aktueller Bestand", `<input value="${num(a.bestand)} ${esc(a.einheit)}" readonly>`, "", "Bestand über Lager → Eingang/Entnahme/Inventur ändern")}
    ${field("Mindestbestand", inp("mindest", a.mindest ? inNum(a.mindest, 0) : "", 'inputmode="decimal" placeholder="0"'))}
    ${field("Lagerort", inp("lagerort", a.lagerort, 'placeholder="z. B. Regal 2 / Fahrzeug"'), "full")}
    <datalist id="einheiten-m">${EINHEITEN.map((e) => `<option value="${e}">`).join("")}</datalist>
  </div>`;
}
function artikelDialog(a, onCreated) {
  modal({
    title: a ? `Artikel bearbeiten · ${a.nr}` : "Neuer Artikel / Leistung",
    size: "wide",
    body: artikelForm(a || {}),
    foot: `${a ? `<button type="button" class="btn btn-danger left" data-act="artikel-delete" data-id="${a.id}">Löschen</button>` : ""}<button type="button" class="btn" data-close>Abbrechen</button><button class="btn btn-black" type="submit">Speichern</button>`,
    onOpen: (form) => {
      const upd = () => {
        const ek = parseNum(form.elements.ek.value), vk = parseNum(form.elements.vk.value);
        $("#marge", form).textContent = ek && vk ? `Aufschlag ${num(((vk - ek) / ek) * 100, 0)} % · Marge ${eur(vk - ek)} ·` : "";
      };
      form.elements.ek.addEventListener("input", upd);
      form.elements.vk.addEventListener("input", upd);
      upd();
      $("#calc-vk", form).addEventListener("click", () => {
        const ek = parseNum(form.elements.ek.value);
        if (!ek) { toast("Bitte zuerst den Einkaufspreis eintragen.", "err"); return; }
        const p = prompt("Aufschlag in %", "60");
        if (p == null) return;
        form.elements.vk.value = inNum(r2(ek * (1 + parseNum(p) / 100)));
        upd();
      });
    },
    onSubmit: (d) => {
      const nr = clean(d.nr);
      if (nr && DB().artikel.some((x) => x.nr === nr && x !== a)) { toast("Diese Artikelnummer ist bereits vergeben.", "err"); return false; }
      if (a) {
        Object.assign(a, {
          nr: nr || a.nr, name: clean(d.name), beschreibung: clean(d.beschreibung), kategorie: d.kategorie, art: d.art,
          einheit: clean(d.einheit) || "Stk", ek: parseNum(d.ek), vk: parseNum(d.vk), mwst: Number(d.mwst),
          lager: d.lager, mindest: parseNum(d.mindest), lagerort: clean(d.lagerort), aktiv: d.aktiv !== "0",
        });
        toast("Artikel gespeichert");
      } else {
        const na = createArtikel(d);
        na.aktiv = d.aktiv !== "0";
        toast(`Artikel <b>${esc(na.nr)}</b> angelegt`);
        onCreated?.(na);
      }
      Store.save();
      render();
    },
  });
}

VIEWS.artikel = () => {
  const q = lc(ui.artQ);
  const all = DB().artikel;
  const list = all.filter((a) => (!ui.artKat || a.kategorie === ui.artKat) && (!q || [a.name, a.nr, a.beschreibung, a.kategorie, a.lagerort].some((x) => lc(x).includes(q))))
    .sort((a, b) => a.kategorie.localeCompare(b.kategorie) || a.name.localeCompare(b.name));
  const rows = list.map((a) => `<tr class="click ${a.aktiv === false ? "muted" : ""}" data-act="artikel-edit" data-id="${a.id}">
    <td class="nowrap muted small">${esc(a.nr)}</td><td><span class="strong">${esc(a.name)}</span>${a.beschreibung ? `<div class="small muted">${esc(a.beschreibung)}</div>` : ""}</td>
    <td><span class="pill">${esc(a.kategorie)}</span>${a.art === "lohn" ? ` <span class="pill yellow">Lohn</span>` : ""}${a.aktiv === false ? ` <span class="pill red">inaktiv</span>` : ""}</td><td>${esc(a.einheit)}</td>
    <td class="num">${a.ek ? eur(a.ek) : "—"}</td><td class="num strong">${eur(a.vk)}</td><td class="num">${a.ek && a.vk ? num(((a.vk - a.ek) / a.ek) * 100, 0) + " %" : "—"}</td>
    <td class="num">${a.mwst} %</td><td class="num">${a.lager ? `${num(a.bestand)}${Number(a.mindest) > 0 && Number(a.bestand) <= Number(a.mindest) ? ` <span class="pill red">!</span>` : ""}` : "—"}</td></tr>`).join("");
  return `${pageHead("Artikel &amp; Leistungen", `${all.length} Artikel im Stamm · Preise netto`, `<label class="btn">CSV-Import<input type="file" accept=".csv,text/csv" data-act-change="artikel-import" hidden></label><button class="btn" data-act="artikel-csv">CSV-Export</button><button class="btn btn-yellow" data-act="artikel-new">+ Neuer Artikel</button>`)}
    <div class="toolbar"><input type="search" placeholder="Bezeichnung, Nummer …" value="${esc(ui.artQ)}" data-ui="artQ" data-keep="artQ"><select data-ui="artKat"><option value="">Alle Kategorien</option>${opt(KATEGORIEN, ui.artKat)}</select></div>
    <div class="card table-wrap">${all.length ? `<table class="table"><thead><tr><th>Nr.</th><th>Bezeichnung</th><th>Kategorie</th><th>Einheit</th><th class="num">EK</th><th class="num">VK</th><th class="num">Aufschlag</th><th class="num">MwSt</th><th class="num">Bestand</th></tr></thead><tbody>${rows || `<tr><td colspan="9" class="muted">Keine Treffer.</td></tr>`}</tbody></table>`
      : emptyState("Noch keine Artikel", "Legen Sie Material, Arbeitsstunden und Pauschalen an – sie stehen dann mit einem Klick in jedem Angebot zur Verfügung. Oder starten Sie mit typischen Elektro-Artikeln (Preise sind Beispielwerte und müssen angepasst werden).", `<button class="btn btn-yellow" data-act="artikel-new">+ Neuer Artikel</button> <button class="btn" data-act="artikel-beispiele">Beispielartikel laden</button>`)}</div>
    ${all.length ? `<p class="small muted" style="margin-top:12px">CSV-Import: Spalten mit Überschriften wie <code>Artikelnummer; Bezeichnung; Beschreibung; Kategorie; Einheit; EK; VK; MwSt; Bestand; Mindestbestand; Lagerort</code> – vorhandene Artikelnummern werden aktualisiert.</p>` : ""}`;
};

function importArtikelCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) { toast("Die Datei enthält keine Daten.", "err"); return; }
  const head = rows[0].map((h) => lc(h).replace(/[^a-zäöüß]/g, ""));
  const col = (...names) => head.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
  const c = {
    nr: col("artikelnummer", "artnr", "nr", "nummer"), name: col("bezeichnung", "name", "artikel"), beschreibung: col("beschreibung", "text"),
    kategorie: col("kategorie", "gruppe"), einheit: col("einheit", "me"), ek: col("ek", "einkauf"), vk: col("vk", "verkauf", "preis"),
    mwst: col("mwst", "ust", "steuer"), bestand: col("bestand", "menge"), mindest: col("mindest", "min"), lagerort: col("lagerort", "ort"),
  };
  if (c.name < 0) { toast("Spalte „Bezeichnung“ nicht gefunden.", "err"); return; }
  let neu = 0, upd = 0;
  for (const r of rows.slice(1)) {
    const g = (k) => (c[k] >= 0 ? clean(r[c[k]]) : "");
    if (!g("name")) continue;
    const ex = g("nr") && DB().artikel.find((a) => a.nr === g("nr"));
    const kat = KATEGORIEN.find((k) => lc(k) === lc(g("kategorie"))) || (g("kategorie") ? "Sonstiges" : null);
    const data = { nr: g("nr"), name: g("name"), beschreibung: g("beschreibung"), kategorie: kat || "Sonstiges", einheit: g("einheit") || "Stk", ek: g("ek"), vk: g("vk"), mwst: g("mwst") ? parseNum(g("mwst")) : S().mwst, mindest: g("mindest"), lagerort: g("lagerort"), lager: c.bestand >= 0 && g("bestand") !== "", bestand: g("bestand") };
    if (ex) {
      Object.assign(ex, { name: data.name, beschreibung: data.beschreibung || ex.beschreibung, einheit: data.einheit, ek: parseNum(data.ek) || ex.ek, vk: parseNum(data.vk) || ex.vk, mwst: Number(data.mwst), lagerort: data.lagerort || ex.lagerort });
      if (kat) ex.kategorie = kat;
      if (data.mindest) ex.mindest = parseNum(data.mindest);
      if (data.lager) { ex.lager = true; const diff = parseNum(data.bestand) - (Number(ex.bestand) || 0); if (diff) buchen(ex, diff, "inventur", "CSV-Import"); }
      upd++;
    } else { createArtikel(data); neu++; }
  }
  Store.save(); render();
  toast(`Import fertig: <b>${neu}</b> neu, <b>${upd}</b> aktualisiert`);
}

// ---------------------------------------------------------------------
// Lager
// ---------------------------------------------------------------------
VIEWS.lager = () => {
  const items = DB().artikel.filter((a) => a.lager);
  const q = lc(ui.lagerQ);
  const list = items.filter((a) => !q || [a.name, a.nr, a.lagerort].some((x) => lc(x).includes(q))).sort((a, b) => a.name.localeCompare(b.name));
  const wert = items.reduce((s, a) => s + (Number(a.bestand) || 0) * (Number(a.ek) || 0), 0);
  const warn = lagerWarnungen();
  const resAll = items.filter((a) => reserviert(a.id) > 0);
  const rows = list.map((a) => {
    const res = reserviert(a.id);
    const verf = r2(a.bestand - res);
    const low = Number(a.mindest) > 0 && Number(a.bestand) <= Number(a.mindest);
    return `<tr class="${low || verf < 0 ? "warn" : ""}"><td class="muted small nowrap">${esc(a.nr)}</td><td class="strong">${esc(a.name)}</td><td>${esc(a.lagerort) || "—"}</td>
      <td class="num strong">${num(a.bestand)} ${esc(a.einheit)}</td><td class="num">${res ? num(res) : "—"}</td><td class="num ${verf < 0 ? "strong" : ""}" style="${verf < 0 ? "color:var(--red)" : ""}">${num(verf)}</td>
      <td class="num">${a.mindest ? num(a.mindest) : "—"}</td><td>${low ? `<span class="pill red">nachbestellen</span>` : `<span class="pill green">ok</span>`}</td>
      <td class="nowrap right"><button class="btn btn-small" data-act="lager-buch" data-typ="eingang" data-id="${a.id}">+ Eingang</button> <button class="btn btn-small" data-act="lager-buch" data-typ="ausgang" data-id="${a.id}">− Entnahme</button> <button class="btn btn-small" data-act="lager-buch" data-typ="inventur" data-id="${a.id}">Inventur</button></td></tr>`;
  }).join("");
  const mov = DB().bewegungen.slice(0, 60).map((m) => `<tr><td class="nowrap small">${fmtDateTime(m.at)}</td><td><span class="pill ${m.typ === "eingang" ? "green" : m.typ === "ausgang" ? "orange" : "blue"}">${{ eingang: "Eingang", ausgang: "Entnahme", inventur: "Inventur" }[m.typ] || m.typ}</span></td>
    <td>${esc(m.artName)} <span class="muted small">${esc(m.artNr)}</span></td><td class="num strong">${m.menge > 0 ? "+" : ""}${num(m.menge)}</td><td class="num">${num(m.bestandNach)}</td><td>${esc([m.bezug, m.notiz].filter(Boolean).join(" · "))}</td></tr>`).join("");
  const bestell = warn.map((a) => ({ a, menge: Math.max(1, Math.ceil(Number(a.mindest) * 2 - Number(a.bestand))) }));

  return `${pageHead("Lager", "Bestände, Reservierungen für angenommene Aufträge und alle Lagerbewegungen", `<button class="btn" data-act="lager-csv">Bestandsliste (CSV)</button><button class="btn btn-yellow" data-act="artikel-new" data-lager="1">+ Lagerartikel</button>`)}
    <div class="kpis">
      <div class="card kpi"><div class="label">Lagerartikel</div><div class="value">${items.length}</div></div>
      <div class="card kpi"><div class="label">Lagerwert (EK)</div><div class="value">${eur(wert)}</div></div>
      <div class="card kpi ${warn.length ? "accent" : ""}"><div class="label">Unter Mindestbestand</div><div class="value">${warn.length}</div></div>
      <div class="card kpi"><div class="label">Für Aufträge reserviert</div><div class="value">${resAll.length}</div><div class="sub">Artikel aus angenommenen Angeboten</div></div>
    </div>
    ${bestell.length ? `<div class="card" style="margin-bottom:18px"><div class="card-head"><h3>Bestellvorschlag</h3><button class="btn btn-small" data-act="bestell-copy">Als Text kopieren</button></div><div class="card-body"><ul class="todo">${bestell.map(({ a, menge }) => `<li><span class="ic red">▦</span><div><span class="strong">${num(menge)} ${esc(a.einheit)} ${esc(a.name)}</span><div class="d">${esc(a.nr)} · Bestand ${num(a.bestand)} · Mindestbestand ${num(a.mindest)}${a.ek ? ` · ca. ${eur(menge * a.ek)}` : ""}</div></div></li>`).join("")}</ul></div></div>` : ""}
    <div class="toolbar"><input type="search" placeholder="Artikel oder Lagerort suchen …" value="${esc(ui.lagerQ)}" data-ui="lagerQ" data-keep="lagerQ"></div>
    <div class="card table-wrap" style="margin-bottom:18px">${items.length ? `<table class="table"><thead><tr><th>Nr.</th><th>Artikel</th><th>Lagerort</th><th class="num">Bestand</th><th class="num">Reserviert</th><th class="num">Verfügbar</th><th class="num">Mindest</th><th>Status</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="9" class="muted">Keine Treffer.</td></tr>`}</tbody></table>`
      : emptyState("Noch keine Lagerartikel", "Markieren Sie Artikel als „Lagerartikel“, um Bestände zu führen. Bei angenommenen Angeboten wird das Material reserviert und kann mit einem Klick ausgebucht werden.", `<button class="btn btn-yellow" data-act="artikel-new" data-lager="1">+ Lagerartikel</button>`)}</div>
    <div class="card"><div class="card-head"><h3>Lagerbewegungen</h3><span class="small muted">letzte 60</span></div>${mov ? `<div class="table-wrap"><table class="table"><thead><tr><th>Zeit</th><th>Art</th><th>Artikel</th><th class="num">Menge</th><th class="num">Bestand danach</th><th>Bezug / Notiz</th></tr></thead><tbody>${mov}</tbody></table></div>` : `<div class="card-body muted small">Noch keine Bewegungen.</div>`}</div>`;
};

function lagerDialog(a, typ) {
  const titles = { eingang: "Wareneingang", ausgang: "Entnahme (z. B. für Baustelle)", inventur: "Inventur – Bestand korrigieren" };
  modal({
    title: `${titles[typ]} · ${a.name}`,
    body: `<p class="muted small">Aktueller Bestand: <b>${num(a.bestand)} ${esc(a.einheit)}</b>${a.lagerort ? " · " + esc(a.lagerort) : ""}</p>
      <div class="form-grid">${field(typ === "inventur" ? "Gezählter Bestand" : "Menge", inp("menge", typ === "inventur" ? inNum(a.bestand, 0) : "", 'inputmode="decimal" required autofocus'))}
      ${field(typ === "eingang" ? "Lieferant / Lieferschein" : typ === "ausgang" ? "Baustelle / Kunde" : "Grund", inp("bezug", ""))}
      ${typ === "eingang" ? field("Neuer EK-Preis netto (optional)", inp("ek", "", `inputmode="decimal" placeholder="${a.ek ? inNum(a.ek) : ""}"`)) : ""}
      ${field("Notiz", inp("notiz", ""), typ === "eingang" ? "" : "full")}</div>`,
    submitLabel: "Buchen",
    onSubmit: (d) => {
      const m = parseNum(d.menge);
      if (typ === "inventur") buchen(a, m - (Number(a.bestand) || 0), "inventur", d.bezug || "Inventur", d.notiz);
      else {
        if (m <= 0) { toast("Bitte eine Menge größer 0 eingeben.", "err"); return false; }
        buchen(a, typ === "eingang" ? m : -m, typ, d.bezug, d.notiz);
        if (typ === "eingang" && parseNum(d.ek)) a.ek = parseNum(d.ek);
      }
      Store.save(); render();
      toast(`Gebucht · neuer Bestand <b>${num(a.bestand)} ${esc(a.einheit)}</b>`);
    },
  });
}

// ---------------------------------------------------------------------
// Einstellungen
// ---------------------------------------------------------------------
VIEWS.einstellungen = () => {
  const s = S();
  const f = s.firma;
  const nr = (key, label) => {
    const c = s.nummern[key];
    return `<tr><td class="strong">${label}</td><td><input class="input" name="nummern.${key}.muster" value="${esc(c.muster)}"></td><td><input class="input" name="nummern.${key}.stellen" value="${esc(c.stellen)}" inputmode="numeric" style="width:70px"></td><td><input class="input" name="nummern.${key}.next" value="${esc(c.next)}" inputmode="numeric" style="width:100px"></td><td class="mono">${esc(formatNr(c, c.next))}</td></tr>`;
  };
  const ff = (k, l, cls = "", attrs = "") => field(l, `<input name="firma.${k}" value="${esc(f[k])}" ${attrs}>`, cls);
  const serverUrl = location.origin + "/api/leads";
  return `${pageHead("Einstellungen", "Firmendaten, Nummernkreise, Texte und Datensicherung")}
    <form id="settings-form" class="stack">
      <div class="card card-pad"><div class="form-grid">
        <div class="form-section">Firma (erscheint auf Angeboten &amp; Rechnungen)</div>
        ${ff("name", "Firmenname", "full")}${ff("zusatz", "Zusatz / Slogan", "full")}
        ${ff("inhaber", "Geschäftsführung / Ansprechpartner")}${ff("telefon", "Telefon")}
        ${ff("strasse", "Straße")}${ff("plzOrt", "PLZ / Ort")}
        ${ff("email", "E-Mail")}${ff("web", "Website")}
        <div class="form-section">Bank &amp; Steuer</div>
        ${ff("bank", "Bank")}${ff("iban", "IBAN")}${ff("bic", "BIC")}${ff("ustId", "USt-IdNr.")}${ff("steuernr", "Steuernummer")}${ff("register", "Handelsregister", "", 'placeholder="z. B. Amtsgericht Köln HRB …"')}
        <div class="form-section">Fristen &amp; Steuer</div>
        ${field("Angebote gültig (Tage)", `<input name="gueltigTage" value="${esc(s.gueltigTage)}" inputmode="numeric">`)}
        ${field("Zahlungsziel Rechnungen (Tage)", `<input name="zahlungszielTage" value="${esc(s.zahlungszielTage)}" inputmode="numeric">`)}
        ${field("Standard-MwSt für neue Positionen", `<select name="mwst">${opt([[19, "19 %"], [7, "7 %"], [0, "0 %"]], s.mwst)}</select>`)}
      </div></div>

      <div class="card"><div class="card-head"><h3>Nummernkreise (fortlaufend)</h3></div><div class="card-body">
        <p class="small muted">Platzhalter: <code>{JJJJ}</code> = Jahr (Zähler beginnt jedes Jahr neu bei 1), <code>{JJ}</code> = Jahr zweistellig, <code>{NR}</code> = laufende Nummer. Bereits vergebene Nummern werden automatisch übersprungen.</p>
        <div class="table-wrap"><table class="table"><thead><tr><th>Bereich</th><th>Muster</th><th>Stellen</th><th>Nächste Nr.</th><th>Vorschau</th></tr></thead><tbody>
          ${nr("angebot", "Angebote")}${nr("rechnung", "Rechnungen")}${nr("kunde", "Kunden")}${nr("artikel", "Artikel")}${nr("lead", "Anfragen")}
        </tbody></table></div></div></div>

      <div class="card card-pad"><div class="form-grid">
        <div class="form-section">Standardtexte</div>
        <p class="small muted full" style="margin:0">Platzhalter: <code>{ANREDE}</code> (z. B. „Sehr geehrter Herr Müller“), <code>{GUELTIG}</code>, <code>{FAELLIG}</code>, <code>{NR}</code>, <code>{KUNDE}</code></p>
        ${field("Angebot – Einleitung", `<textarea name="texte.angebotEinleitung" rows="4">${esc(s.texte.angebotEinleitung)}</textarea>`)}
        ${field("Angebot – Schluss", `<textarea name="texte.angebotSchluss" rows="4">${esc(s.texte.angebotSchluss)}</textarea>`)}
        ${field("Rechnung – Einleitung", `<textarea name="texte.rechnungEinleitung" rows="4">${esc(s.texte.rechnungEinleitung)}</textarea>`)}
        ${field("Rechnung – Schluss", `<textarea name="texte.rechnungSchluss" rows="4">${esc(s.texte.rechnungSchluss)}</textarea>`)}
      </div></div>
      <div><button class="btn btn-black" type="submit">Einstellungen speichern</button></div>
    </form>

    <div class="grid grid-2" style="margin-top:18px">
      <div class="card"><div class="card-head"><h3>Website-Anfragen automatisch empfangen</h3><span class="pill ${Store.mode === "server" ? "green" : "yellow"}">${Store.mode === "server" ? "Server aktiv" : "Browser-Modus"}</span></div><div class="card-body small">
        ${Store.mode === "server"
          ? `<p>Der Lead-Eingang ist aktiv. Anfragen, die an <code>${esc(serverUrl)}</code> gesendet werden, erscheinen automatisch unter „Anfragen“ (Prüfung alle 30 Sekunden).</p><p class="muted">Damit das Kontaktformular der Website zusätzlich hierher sendet, ist eine kleine Ergänzung in <code>js/main.js</code> nötig – Anleitung in <code>erp/README.md</code>.</p>`
          : `<p>Im Browser-Modus übernehmen Sie Website-Anfragen per <b>„E-Mail / Nachricht einfügen“</b>: Text der FormSubmit-Mail kopieren, einfügen – Name, Telefon, E-Mail, Thema und Nachricht werden automatisch erkannt.</p><p class="muted">Für vollautomatischen Eingang und Zugriff von mehreren Geräten das ERP mit <code>node erp/server.js</code> auf einem Server starten (siehe <code>erp/README.md</code>).</p>`}
        <button class="btn btn-small" data-act="lead-paste">Anfrage-E-Mail einfügen</button>
      </div></div>

      <div class="card"><div class="card-head"><h3>Datensicherung</h3></div><div class="card-body small">
        <p>${Store.mode === "local" ? "Alle Daten liegen <b>nur in diesem Browser auf diesem Gerät</b>. Laden Sie regelmäßig eine Sicherung herunter (z. B. wöchentlich) und bewahren Sie sie sicher auf." : "Die Daten liegen zentral auf dem Server (mit täglicher Sicherungskopie). Zusätzlich können Sie hier jederzeit eine Sicherung herunterladen."}</p>
        <p class="muted">Letzte Sicherung: ${DB().meta.lastBackup ? fmtDateTime(DB().meta.lastBackup) : "noch nie"}</p>
        <div class="quick"><button class="btn btn-yellow btn-small" data-act="backup">Sicherung herunterladen</button>
        <label class="btn btn-small">Sicherung einspielen<input type="file" accept=".json,application/json" data-act-change="restore" hidden></label>
        <button class="btn btn-small btn-danger" data-act="reset">Alle Daten löschen</button></div>
      </div></div>

      ${Store.mode === "local" ? `<div class="card"><div class="card-head"><h3>Zugangsschutz (PIN)</h3><span class="pill ${s.pinHash ? "green" : ""}">${s.pinHash ? "aktiv" : "aus"}</span></div><div class="card-body small">
        <p>Beim Öffnen des ERP wird eine PIN abgefragt – sinnvoll auf gemeinsam genutzten Geräten.</p>
        <div class="quick"><button class="btn btn-small" data-act="pin-set">${s.pinHash ? "PIN ändern" : "PIN festlegen"}</button>${s.pinHash ? `<button class="btn btn-small" data-act="pin-off">PIN entfernen</button><button class="btn btn-small" data-act="lock-now">Jetzt sperren</button>` : ""}</div>
      </div></div>` : `<div class="card"><div class="card-head"><h3>Anmeldung</h3></div><div class="card-body small"><p>Das Passwort wird auf dem Server über die Umgebungsvariable <code>ERP_PASSWORT</code> festgelegt.</p><button class="btn btn-small" data-act="logout">Abmelden</button></div></div>`}

      <div class="card"><div class="card-head"><h3>Über</h3></div><div class="card-body small">
        <p>Elektro Linge ERP · ${DB().leads.length} Anfragen · ${DB().kunden.length} Kunden · ${DB().belege.length} Belege · ${DB().artikel.length} Artikel</p>
        <p class="muted">Speicher: ${Store.mode === "server" ? "Server (zentral)" : "Browser (lokal)"} · angelegt ${fmtDate(toISO(new Date(DB().meta.createdAt)))}</p>
      </div></div>
    </div>`;
};

function saveSettings(form) {
  const s = S();
  for (const el of form.elements) {
    if (!el.name) continue;
    const path = el.name.split(".");
    let o = s;
    for (const p of path.slice(0, -1)) o = o[p];
    const key = path.at(-1);
    let v = el.value;
    if (["stellen", "next", "gueltigTage", "zahlungszielTage", "mwst"].includes(key)) v = Math.max(0, Math.round(parseNum(v)));
    o[key] = v;
  }
  for (const c of Object.values(s.nummern)) {
    if (!c.muster.includes("{NR}")) c.muster += "{NR}";
    c.stellen = Math.min(10, Math.max(1, c.stellen));
    c.next = Math.max(1, c.next);
  }
  Store.save();
  render();
  toast("Einstellungen gespeichert");
}

function backup() {
  DB().meta.lastBackup = Date.now();
  Store.save();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
  download(`elektro-linge-erp-sicherung-${stamp}.json`, JSON.stringify({ app: "elektro-linge-erp", exportedAt: new Date().toISOString(), db: DB() }, null, 1), "application/json");
  toast("Sicherung heruntergeladen");
  if (parseHash().page === "dashboard" || parseHash().page === "einstellungen") render();
}

// ---------------------------------------------------------------------
// Globale Suche
// ---------------------------------------------------------------------
function searchAll(q) {
  q = lc(clean(q));
  if (q.length < 2) return [];
  const res = [];
  for (const l of DB().leads) if ([l.name, l.email, l.phone, l.nr, l.thema, l.plzOrt].some((x) => lc(x).includes(q))) res.push([`#/lead/${l.id}`, l.name || l.nr, `Anfrage · ${stageLabel(l.stage)}`]);
  for (const k of DB().kunden) if ([kundeName(k), k.nr, k.email, k.telefon, k.mobil, k.ort, k.strasse].some((x) => lc(x).includes(q))) res.push([`#/kunde/${k.id}`, kundeName(k), `Kunde ${k.nr} · ${k.ort || ""}`]);
  for (const b of DB().belege) if ([b.nr, b.betreff, kundeName(kundeById(b.kundeId))].some((x) => lc(x).includes(q))) res.push([`#/beleg/${b.id}`, `${belegLabel(b)} ${belegNr(b)}`, `${kundeName(kundeById(b.kundeId))} · ${eur(belegTotals(b).brutto)}`]);
  for (const a of DB().artikel) if ([a.name, a.nr].some((x) => lc(x).includes(q))) res.push([`#/artikel`, a.name, `Artikel ${a.nr} · ${eur(a.vk)}`]);
  return res.slice(0, 14);
}
function bindSearch() {
  const input = $("#global-search");
  const box = $("#search-results");
  const show = () => {
    const r = searchAll(input.value);
    box.hidden = !input.value.trim();
    box.innerHTML = r.length ? r.map(([h, t, s], i) => `<a href="${h}" class="${i === 0 ? "focus" : ""}"><span class="strong">${esc(t)}</span><small>${esc(s)}</small></a>`).join("") : `<div class="small muted" style="padding:8px 10px">Keine Treffer</div>`;
  };
  input.addEventListener("input", show);
  input.addEventListener("focus", () => input.value && show());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { const a = $("a", box); if (a) { location.hash = a.getAttribute("href"); input.value = ""; box.hidden = true; input.blur(); } }
    if (e.key === "Escape") { box.hidden = true; input.blur(); }
  });
  box.addEventListener("click", () => { input.value = ""; box.hidden = true; });
  document.addEventListener("click", (e) => { if (!e.target.closest(".search")) box.hidden = true; });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !$(".modal-backdrop")) { e.preventDefault(); input.focus(); }
  });
}

// ---------------------------------------------------------------------
// Aktionen (Klicks auf data-act)
// ---------------------------------------------------------------------
async function newAngebotFlow({ kundeId = null, leadId = null } = {}) {
  const l = leadById(leadId);
  if (l) kundeId = ensureKunde(l).id;
  const b = createBeleg("angebot", { kundeId, leadId, betreff: l ? l.thema : "" });
  if (l) addAkt(l, "system", `Angebot ${b.nr} angelegt`);
  Store.save();
  toast(`Angebot <b>${esc(b.nr)}</b> angelegt`);
  go("#/beleg/" + b.id);
}

const ACTIONS = {
  ui: (d) => { ui[d.k] = d.v; render(); },
  backup,

  // Anfragen
  "lead-new": () => leadNewDialog(false),
  "lead-paste": () => leadNewDialog(true),
  "lead-edit": (d) => {
    const l = leadById(d.id);
    modal({
      title: `Anfrage bearbeiten · ${l.nr}`, size: "wide", body: leadForm(l),
      onSubmit: (x) => { Object.assign(l, { name: clean(x.name), quelle: x.quelle, phone: clean(x.phone), email: clean(x.email), strasse: clean(x.strasse), plzOrt: clean(x.plzOrt), thema: x.thema, wert: parseNum(x.wert), nachricht: clean(x.nachricht) }); Store.save(); render(); toast("Gespeichert"); },
    });
  },
  "lead-delete": async (d) => {
    const l = leadById(d.id);
    if (!(await ask(`Anfrage „${l.name}“ (${l.nr}) wirklich löschen? Kunde und Belege bleiben erhalten.`, { ok: "Löschen", danger: true }))) return;
    DB().leads = DB().leads.filter((x) => x !== l);
    Store.save(); go("#/leads"); toast("Anfrage gelöscht");
  },
  "lead-stage": (d) => { const l = leadById(d.id); if (l.stage !== d.stage) changeStage(l, d.stage); },
  "lead-termin": (d) => leadTerminDialog(leadById(d.id)),
  "lead-angebot": (d) => newAngebotFlow({ leadId: d.id }),
  "lead-kunde": (d) => { const l = leadById(d.id); const k = ensureKunde(l); Store.save(); render(); toast(`Kunde <b>${esc(k.nr)}</b> verknüpft`); },
  "lead-wv-set": (d) => { const l = leadById(d.id); l.wiedervorlage = d.days ? addDays(todayISO(), Number(d.days)) : ""; Store.save(); render(); },
  "log-call": (d) => { const l = leadById(d.id); addAkt(l, "anruf", "Kunde angerufen"); advance(l, "kontakt"); Store.save(); setTimeout(render, 300); },
  "akt-del": (d) => { const l = leadById(d.id); l.aktivitaeten = l.aktivitaeten.filter((a) => a.id !== d.akt); Store.save(); render(); },

  // Kunden
  "kunde-new": () => kundeDialog(null, (k) => go("#/kunde/" + k.id)),
  "kunde-edit": (d) => kundeDialog(kundeById(d.id)),
  "kunde-delete": async (d) => {
    const k = kundeById(d.id);
    if (DB().belege.some((b) => b.kundeId === k.id)) { toast("Kunde hat Angebote oder Rechnungen und kann nicht gelöscht werden.", "err"); return; }
    if (!(await ask(`Kunde „${kundeName(k)}“ wirklich löschen?`, { ok: "Löschen", danger: true }))) return;
    DB().kunden = DB().kunden.filter((x) => x !== k);
    DB().leads.forEach((l) => { if (l.kundeId === k.id) l.kundeId = null; });
    Store.save(); go("#/kunden"); toast("Kunde gelöscht");
  },
  "kunde-lead": (d) => {
    const k = kundeById(d.id);
    const l = createLead({ name: kundeName(k), email: k.email, phone: k.telefon || k.mobil, strasse: k.strasse, plzOrt: [k.plz, k.ort].filter(Boolean).join(" "), quelle: "Bestandskunde" });
    l.kundeId = k.id;
    Store.save(); go("#/lead/" + l.id);
  },
  "kunden-csv": () => download(`kunden-${todayISO()}.csv`, toCSV(DB().kunden, [["Kundennummer", (k) => k.nr], ["Art", (k) => k.typ], ["Anrede", (k) => k.anrede], ["Vorname", (k) => k.vorname], ["Nachname", (k) => k.nachname], ["Firma", (k) => k.firma], ["Straße", (k) => k.strasse], ["PLZ", (k) => k.plz], ["Ort", (k) => k.ort], ["Telefon", (k) => k.telefon], ["Mobil", (k) => k.mobil], ["E-Mail", (k) => k.email], ["Quelle", (k) => k.quelle], ["Umsatz", (k) => kundeUmsatz(k)], ["Notizen", (k) => k.notizen]]), "text/csv"),

  // Belege
  "angebot-new": (d) => newAngebotFlow({ kundeId: d.kunde || null }),
  "rechnung-new": (d) => {
    const b = createBeleg("rechnung", { kundeId: d.kunde || null, leadId: d.lead || null });
    Store.save(); go("#/beleg/" + b.id);
  },
  "beleg-kunde-new": (d) => kundeDialog(null, (k) => { const b = belegById(d.id); b.kundeId = k.id; Store.save(); render(); }),
  "beleg-preview": (d) => previewDialog(belegById(d.id)),
  "beleg-print": (d) => printBeleg(belegById(d.id)),
  "beleg-mail": (d) => mailBeleg(belegById(d.id)),
  "beleg-send": (d) => markSent(belegById(d.id)),
  "beleg-accept": (d) => {
    const b = belegById(d.id);
    modal({
      title: `Angebot ${b.nr} angenommen`,
      body: `<div class="form-grid">${field("Angenommen am", `<input type="date" name="datum" value="${todayISO()}" required>`)}${lagerPositionen(b).length ? `<label class="check full"><input type="checkbox" name="material" checked> Material jetzt aus dem Lager ausbuchen (${lagerPositionen(b).length} Lagerartikel)</label>` : ""}</div>
        <p class="small muted" style="margin:12px 0 0">Die Anfrage wechselt in der Kundenreise auf „Auftrag erteilt“.</p>`,
      submitLabel: "Auftrag bestätigen",
      onSubmit: (x) => {
        b.status = "angenommen";
        b.angenommenAm = x.datum;
        const l = leadById(b.leadId);
        if (l) { advance(l, "auftrag", `Angebot ${b.nr} angenommen`); addAkt(l, "system", `Auftrag über ${eur(belegTotals(b).brutto)} erteilt`); l.wiedervorlage = ""; }
        if (x.material) bookMaterial(b);
        Store.save(); render();
        toast(`<b>Auftrag erteilt!</b> ${esc(b.nr)} · ${eur(belegTotals(b).brutto)}`);
      },
    });
  },
  "beleg-reject": (d) => {
    const b = belegById(d.id);
    modal({
      title: `Angebot ${b.nr} abgelehnt`,
      body: `<div class="form-grid">${field("Grund", `<select name="grund">${opt(["Zu teuer", "Anderer Anbieter", "Projekt verschoben", "Kein Bedarf mehr", "Keine Rückmeldung", "Sonstiges"])}</select>`, "full")}<label class="check full"><input type="checkbox" name="lost" checked> Anfrage in der Kundenreise als „Verloren“ markieren</label></div>`,
      submitLabel: "Als abgelehnt markieren",
      onSubmit: (x) => {
        b.status = "abgelehnt";
        b.ablehnGrund = x.grund;
        const l = leadById(b.leadId);
        if (l) { addAkt(l, "system", `Angebot ${b.nr} abgelehnt: ${x.grund}`); if (x.lost) { l.verlorenGrund = x.grund; setStage(l, "verloren", x.grund); } }
        Store.save(); render();
      },
    });
  },
  "beleg-reopen": (d) => { const b = belegById(d.id); b.status = b.gesendetAm ? "versendet" : "entwurf"; Store.save(); render(); },
  "beleg-copy": (d) => {
    const src = belegById(d.id);
    const b = createBeleg(src.typ, { kundeId: src.kundeId, leadId: src.leadId, betreff: src.betreff, positionen: copyPositions(src.positionen) });
    b.einleitung = src.einleitung; b.schluss = src.schluss;
    Store.save(); toast(`Kopie <b>${esc(belegNr(b))}</b> angelegt`); go("#/beleg/" + b.id);
  },
  "beleg-delete": async (d) => {
    const b = belegById(d.id);
    if (!(await ask(`${belegLabel(b)} ${belegNr(b)} wirklich löschen?${b.typ === "angebot" ? "\nDie Angebotsnummer wird nicht erneut vergeben." : ""}`, { ok: "Löschen", danger: true }))) return;
    DB().belege = DB().belege.filter((x) => x !== b);
    Store.save(); go(b.typ === "angebot" ? "#/angebote" : "#/rechnungen"); toast("Gelöscht");
  },
  "beleg-to-rechnung": (d) => {
    const a = belegById(d.id);
    const r = createBeleg("rechnung", { kundeId: a.kundeId, leadId: a.leadId, betreff: a.betreff, positionen: copyPositions(a.positionen), bezugId: a.id });
    const l = leadById(a.leadId);
    if (l) { advance(l, "ausfuehrung"); addAkt(l, "system", `Rechnungsentwurf aus Angebot ${a.nr} erstellt`); }
    Store.save(); toast("Rechnungsentwurf erstellt – bitte prüfen und festschreiben"); go("#/beleg/" + r.id);
  },
  "beleg-material": (d) => { const b = belegById(d.id); bookMaterial(b); Store.save(); render(); },
  "beleg-finalize": async (d) => {
    const b = belegById(d.id);
    if (!validateBeleg(b)) return;
    if (!(await ask(`Rechnung jetzt festschreiben?\n\nSie erhält die nächste fortlaufende Rechnungsnummer (${formatNr(S().nummern.rechnung, S().nummern.rechnung.next)}) und kann danach nicht mehr geändert werden.`, { ok: "Festschreiben" }))) return;
    b.nr = nextNr("rechnung");
    b.status = "offen";
    b.festgeschriebenAm = Date.now();
    const l = leadById(b.leadId);
    if (l) { advance(l, "ausfuehrung"); addAkt(l, "system", `Rechnung ${b.nr} über ${eur(belegTotals(b).brutto)} gestellt`); }
    Store.save(); render(); toast(`Rechnung <b>${esc(b.nr)}</b> festgeschrieben`);
  },
  "beleg-paid": (d) => {
    const b = belegById(d.id);
    modal({
      title: `Zahlungseingang ${b.nr}`,
      body: `${field("Bezahlt am", `<input type="date" name="datum" value="${todayISO()}" required>`)}<p class="small muted" style="margin:12px 0 0">Betrag: <b>${eur(belegTotals(b).brutto)}</b>. Ist das die letzte offene Rechnung zur Anfrage, wird die Kundenreise abgeschlossen.</p>`,
      submitLabel: "Als bezahlt markieren",
      onSubmit: (x) => {
        b.status = "bezahlt"; b.bezahltAm = x.datum;
        const l = leadById(b.leadId);
        if (l) {
          addAkt(l, "system", `Zahlung für ${b.nr} eingegangen (${eur(belegTotals(b).brutto)})`);
          if (!DB().belege.some((r) => r.leadId === l.id && r.typ === "rechnung" && ["offen", "entwurf"].includes(r.status))) advance(l, "abgeschlossen");
        }
        Store.save(); render(); toast("Zahlung verbucht");
      },
    });
  },
  "beleg-unpaid": (d) => { const b = belegById(d.id); b.status = "offen"; b.bezahltAm = null; Store.save(); render(); },
  "beleg-storno": async (d) => {
    const b = belegById(d.id);
    if (!(await ask(`Rechnung ${b.nr} stornieren? Die Nummer bleibt belegt, der Betrag zählt nicht mehr als offen.`, { ok: "Stornieren", danger: true }))) return;
    b.status = "storniert"; b.storniertAm = Date.now();
    const l = leadById(b.leadId);
    if (l) addAkt(l, "system", `Rechnung ${b.nr} storniert`);
    Store.save(); render();
  },
  "belege-csv": (d) => {
    const list = DB().belege.filter((b) => b.typ === d.typ);
    download(`${d.typ === "angebot" ? "angebote" : "rechnungen"}-${todayISO()}.csv`, toCSV(list, [["Nummer", belegNr], ["Datum", (b) => fmtDate(b.datum)], ["Kundennummer", (b) => kundeById(b.kundeId)?.nr || ""], ["Kunde", (b) => kundeName(kundeById(b.kundeId))], ["Betreff", (b) => b.betreff], ["Status", (b) => (b.typ === "angebot" ? angebotStatus(b) : rechnungStatus(b))[0]], ["Netto", (b) => belegTotals(b).netto], ["MwSt", (b) => belegTotals(b).steuer], ["Brutto", (b) => belegTotals(b).brutto], [d.typ === "angebot" ? "Gültig bis" : "Fällig", (b) => fmtDate(b.gueltigBis || b.faelligAm)], ["Bezahlt am", (b) => fmtDate(b.bezahltAm)]]), "text/csv");
  },

  // Positionen
  "pos-artikel": (d) => artikelPicker(belegById(d.id)),
  "pos-frei": (d) => { belegById(d.id).positionen.push(newPos()); Store.save(); render(); const ins = $$("#pos-body input.name"); ins.at(-1)?.focus(); },
  "pos-titel": (d) => { belegById(d.id).positionen.push(newPos({ typ: "titel" })); Store.save(); render(); $$("#pos-body tr.titel input").at(-1)?.focus(); },
  "pos-up": (d) => movePos(Number(d.i), -1),
  "pos-down": (d) => movePos(Number(d.i), 1),
  "pos-del": (d) => { currentBeleg.positionen.splice(Number(d.i), 1); Store.save(); render(); },

  // Artikel
  "artikel-new": (d) => {
    artikelDialog(null);
    if (d.lager) { const c = $("#modal-root > :last-child input[name=lager]"); if (c) c.checked = true; }
  },
  "artikel-edit": (d) => artikelDialog(artikelById(d.id)),
  "artikel-new-from-picker": () => artikelDialog(null, (a) => { if (currentBeleg) { currentBeleg.positionen.push(posFromArtikel(a)); Store.save(); render(); } }),
  "artikel-delete": async (d, el) => {
    const a = artikelById(d.id);
    if (!(await ask(`Artikel „${a.name}“ löschen? Bestehende Angebote behalten ihre Positionen.`, { ok: "Löschen", danger: true }))) return;
    DB().artikel = DB().artikel.filter((x) => x !== a);
    el.closest(".modal-backdrop")?.remove();
    Store.save(); render(); toast("Artikel gelöscht");
  },
  "artikel-beispiele": () => {
    BEISPIEL_ARTIKEL.forEach(([name, beschreibung, kategorie, art, einheit, ek, vk, mwst, lager]) => createArtikel({ name, beschreibung, kategorie, art, einheit, ek, vk, mwst, lager, mindest: 0 }));
    Store.save(); render(); toast(`${BEISPIEL_ARTIKEL.length} Beispielartikel geladen – <b>Preise bitte anpassen</b>`);
  },
  "artikel-csv": () => download(`artikel-${todayISO()}.csv`, toCSV(DB().artikel, [["Artikelnummer", (a) => a.nr], ["Bezeichnung", (a) => a.name], ["Beschreibung", (a) => a.beschreibung], ["Kategorie", (a) => a.kategorie], ["Art", (a) => a.art], ["Einheit", (a) => a.einheit], ["EK", (a) => a.ek], ["VK", (a) => a.vk], ["MwSt", (a) => a.mwst], ["Bestand", (a) => (a.lager ? a.bestand : "")], ["Mindestbestand", (a) => (a.lager ? a.mindest : "")], ["Lagerort", (a) => a.lagerort]]), "text/csv"),

  // Lager
  "lager-buch": (d) => lagerDialog(artikelById(d.id), d.typ),
  "lager-csv": () => download(`lagerbestand-${todayISO()}.csv`, toCSV(DB().artikel.filter((a) => a.lager), [["Artikelnummer", (a) => a.nr], ["Bezeichnung", (a) => a.name], ["Lagerort", (a) => a.lagerort], ["Bestand", (a) => a.bestand], ["Einheit", (a) => a.einheit], ["Reserviert", (a) => reserviert(a.id)], ["Mindestbestand", (a) => a.mindest], ["EK", (a) => a.ek], ["Lagerwert", (a) => r2(a.bestand * a.ek)]]), "text/csv"),
  "bestell-copy": async () => {
    const text = "Bestellung Elektro Linge – " + fmtDate(todayISO()) + "\n\n" + lagerWarnungen().map((a) => `${Math.max(1, Math.ceil(a.mindest * 2 - a.bestand))} ${a.einheit}  ${a.name} (${a.nr})`).join("\n");
    try { await navigator.clipboard.writeText(text); toast("Bestellliste kopiert"); } catch { prompt("Bestellliste:", text); }
  },

  // Einstellungen
  reset: async () => {
    if (!(await ask("Wirklich ALLE Daten (Anfragen, Kunden, Angebote, Rechnungen, Artikel, Lager) unwiderruflich löschen?\n\nTipp: Vorher eine Sicherung herunterladen.", { ok: "Alles löschen", danger: true }))) return;
    if (!(await ask("Letzte Rückfrage: Alle Daten jetzt löschen?", { ok: "Ja, endgültig löschen", danger: true }))) return;
    const keep = S();
    Store.db = defaultDb();
    Store.db.settings.firma = keep.firma;
    Store.db.settings.texte = keep.texte;
    Store.save(); go("#/dashboard"); toast("Alle Daten gelöscht");
  },
  "pin-set": () => modal({
    title: "PIN festlegen",
    body: `<div class="form-grid">${field("Neue PIN (mind. 4 Zeichen)", `<input name="pin" type="password" inputmode="numeric" required minlength="4" autocomplete="new-password">`)}${field("PIN wiederholen", `<input name="pin2" type="password" inputmode="numeric" required autocomplete="new-password">`)}</div>`,
    onSubmit: (d, form, close) => {
      if (d.pin !== d.pin2) { toast("Die PINs stimmen nicht überein.", "err"); return false; }
      sha256("elektro-linge:" + d.pin).then((h) => { S().pinHash = h; Store.save(); render(); toast("PIN gespeichert"); close(); });
      return false;
    },
  }),
  "pin-off": async () => { if (await ask("PIN-Schutz entfernen?", { ok: "Entfernen" })) { S().pinHash = null; Store.save(); render(); } },
  "lock-now": () => { try { sessionStorage.removeItem(Store.KEY + "-unlocked"); } catch { /* egal */ } location.reload(); },
  logout: () => { try { localStorage.removeItem(Store.KEY + "-token"); } catch { /* egal */ } location.reload(); },
};

function movePos(i, dir) {
  const list = currentBeleg.positionen;
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  Store.save(); render();
}
function bookMaterial(b) {
  const pos = lagerPositionen(b);
  if (!pos.length || b.materialGebucht) return;
  for (const p of pos) buchen(artikelById(p.artikelId), -parseNum(p.menge), "ausgang", `${b.nr} · ${kundeName(kundeById(b.kundeId))}`);
  b.materialGebucht = true;
  const l = leadById(b.leadId);
  if (l) addAkt(l, "system", `Material für ${b.nr} aus dem Lager ausgebucht (${pos.length} Positionen)`);
  toast(`Material ausgebucht (${pos.length} Positionen)`);
}

const CHANGE_ACTIONS = {
  "lead-wv": (el) => { const l = leadById(el.dataset.id); l.wiedervorlage = el.value; Store.save(); render(); },
  "kunde-notiz": (el) => { const k = kundeById(el.dataset.id); k.notizen = el.value; Store.save(); toast("Notiz gespeichert"); },
  "artikel-import": (el) => { const f = el.files[0]; if (!f) return; f.text().then((t) => { importArtikelCSV(t); el.value = ""; }); },
  restore: async (el) => {
    const f = el.files[0];
    el.value = "";
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const db = j.db || j;
      if (!db.settings || !Array.isArray(db.kunden)) throw new Error("Keine gültige Sicherung");
      if (!(await ask(`Sicherung vom ${j.exportedAt ? fmtDateTime(j.exportedAt) : "?"} einspielen?\n\n${db.leads?.length || 0} Anfragen · ${db.kunden.length} Kunden · ${db.belege?.length || 0} Belege · ${db.artikel?.length || 0} Artikel\n\nDie aktuellen Daten werden dabei ersetzt.`, { ok: "Einspielen", danger: true }))) return;
      Store.db = migrate(db);
      Store.save(); go("#/dashboard"); toast("Sicherung eingespielt");
    } catch (e) { toast("Datei konnte nicht gelesen werden: " + esc(e.message), "err"); }
  },
};

// Eingaben im Beleg-Editor (einmalig gebunden, arbeitet auf currentBeleg)
function onBelegInput(e) {
  const b = currentBeleg;
  const el = e.target;
  if (!b || parseHash().page !== "beleg" || el.dataset.pi == null) return false;
  const p = b.positionen[Number(el.dataset.pi)];
  if (!p || isLocked(b)) return true;
  const f = el.dataset.pf;
  p[f] = ["menge", "preis", "rabatt", "mwst"].includes(f) ? parseNum(el.value) : el.value;
  const cell = $("#ps-" + p.id);
  if (cell) cell.textContent = eur(posTotal(p));
  $("#totals").innerHTML = totalsHtml(b);
  Store.save();
  return true;
}
function onBelegChange(e) {
  const b = currentBeleg;
  const el = e.target;
  if (!b || parseHash().page !== "beleg") return;
  if (onBelegInput(e)) {
    const p = b.positionen[Number(el.dataset.pi)];
    if (p && ["menge", "preis", "rabatt"].includes(el.dataset.pf)) {
      el.value = el.dataset.pf === "preis" ? inNum(p.preis) : p[el.dataset.pf] ? inNum(p[el.dataset.pf], 0) : el.dataset.pf === "rabatt" ? "" : "0";
    }
    return;
  }
  const bf = el.dataset.bf;
  if (!bf) return;
  if (bf !== "notiz" && isLocked(b)) return;
  if (bf === "kundeId") {
    b.kundeId = el.value || null;
    const l = leadById(b.leadId);
    if (l && b.kundeId && !l.kundeId) l.kundeId = b.kundeId;
    Store.save();
    render();
    return;
  }
  b[bf] = el.value;
  if (bf === "datum" && b.typ === "rechnung" && b.status === "entwurf") b.faelligAm = addDays(b.datum, S().zahlungszielTage);
  Store.save();
  if (bf === "datum") render();
}

function bindGlobal() {
  $("#view").addEventListener("input", onBelegInput);
  $("#view").addEventListener("change", onBelegChange);
  document.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    if (act && ACTIONS[act.dataset.act] && !(act.tagName === "INPUT")) {
      if (act.tagName !== "A" || act.dataset.act !== "log-call") e.preventDefault();
      ACTIONS[act.dataset.act]({ ...act.dataset }, act, e);
      return;
    }
    const row = e.target.closest("tr[data-href]");
    if (row && !e.target.closest("a,button,input,select,textarea")) go(row.dataset.href);
  });
  document.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset.actChange && CHANGE_ACTIONS[el.dataset.actChange]) CHANGE_ACTIONS[el.dataset.actChange](el);
    if (el.dataset.ui && el.tagName === "SELECT") { ui[el.dataset.ui] = el.value; render(); }
  });
  document.addEventListener("input", debounce((e) => {
    const el = e.target;
    if (el.dataset.ui && el.tagName === "INPUT") { ui[el.dataset.ui] = el.value; render(); }
  }, 120));
  document.addEventListener("submit", (e) => {
    if (e.target.id === "settings-form") { e.preventDefault(); saveSettings(e.target); }
    if (e.target.classList.contains("akt-form")) {
      e.preventDefault();
      const f = e.target;
      const l = leadById(f.dataset.lead);
      const text = clean(f.elements.text.value);
      if (!text) return;
      addAkt(l, f.elements.typ.value, text);
      if (f.elements.wv.value) l.wiedervorlage = f.elements.wv.value;
      if (l.stage === "neu" && ["anruf", "email", "termin"].includes(f.elements.typ.value)) advance(l, "kontakt");
      Store.save(); render(); toast("Eintrag gespeichert");
    }
  });
  $("#menu-btn").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  $("#sidebar").addEventListener("click", (e) => { if (e.target === $("#sidebar")) $("#sidebar").classList.remove("open"); });
  window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
  window.addEventListener("beforeunload", (e) => {
    if (Store.mode === "local") Store.flush();
    else if (Store.dirty || Store.saving) { Store.flush(); e.preventDefault(); e.returnValue = ""; }
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) Store.flush(); else Store.poll(); });
  bindSearch();
}

// ---------------------------------------------------------------------
// Start, Sperrbildschirm & Anmeldung
// ---------------------------------------------------------------------
function lockBox(inner) {
  const lock = $("#lock");
  $("#app").hidden = true;
  lock.hidden = false;
  lock.innerHTML = `<form class="lock-box" autocomplete="off"><img src="../assets/logo-mark-navy.png" alt="" width="70"><h1>Elektro Linge ERP</h1>${inner}</form>`;
  const form = $("form", lock);
  setTimeout(() => $("input", form)?.focus(), 30);
  return form;
}

function showLogin(msg = "") {
  const form = lockBox(`<p>Bitte mit dem ERP-Passwort anmelden.</p><input type="password" name="pw" placeholder="Passwort" required autocomplete="current-password"><p class="err">${esc(msg)}</p><button class="btn btn-black">Anmelden</button>`);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passwort: form.elements.pw.value }) });
    if (!r.ok) { $(".err", form).textContent = r.status === 429 ? "Zu viele Versuche – bitte später erneut." : "Passwort falsch."; form.elements.pw.select(); return; }
    Store.token = (await r.json()).token;
    try { localStorage.setItem(Store.KEY + "-token", Store.token); } catch { /* egal */ }
    await startServer();
  });
}

function showPin() {
  const form = lockBox(`<p>Bitte PIN eingeben.</p><input type="password" name="pin" inputmode="numeric" placeholder="••••" required><p class="err"></p><button class="btn btn-black">Entsperren</button>
    <p class="small muted" style="margin-top:14px">PIN vergessen? Ohne PIN kommt niemand an die Daten in diesem Browser. Eine Sicherungsdatei kann aber jederzeit in einem neuen Browser eingespielt werden.</p>`);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const h = await sha256("elektro-linge:" + form.elements.pin.value);
    if (h !== S().pinHash) { $(".err", form).textContent = "PIN falsch."; form.elements.pin.select(); return; }
    try { sessionStorage.setItem(Store.KEY + "-unlocked", "1"); } catch { /* egal */ }
    openApp();
  });
}

function openApp() {
  $("#lock").hidden = true;
  $("#app").hidden = false;
  $("#mode-info").innerHTML = Store.mode === "server"
    ? `<span class="dot"></span><b>Server-Modus</b><br><span id="sync-state">Alles gespeichert</span><br>Website-Anfragen kommen automatisch an`
    : `<span class="dot local"></span><b>Browser-Modus</b><br>Daten liegen auf diesem Gerät<br><button class="link" style="color:var(--yellow)" data-act="backup">Sicherung herunterladen</button>`;
  render();
}

async function startServer() {
  try {
    await Store.pull();
  } catch (e) {
    if (e.message !== "auth") lockBox(`<p class="err">Server nicht erreichbar. Bitte Seite neu laden.</p>`);
    return;
  }
  openApp();
  await Store.fetchInbox().catch(() => {});
  setInterval(() => Store.poll(), 30000);
}

async function init() {
  bindGlobal();
  const status = await Store.detect();
  if (status) {
    try { Store.token = localStorage.getItem(Store.KEY + "-token"); } catch { /* egal */ }
    if (!Store.token) { showLogin(); return; }
    await startServer();
    return;
  }
  Store.loadLocal();
  let unlocked = false;
  try { unlocked = sessionStorage.getItem(Store.KEY + "-unlocked") === "1"; } catch { /* egal */ }
  if (S().pinHash && !unlocked) showPin();
  else openApp();
}

init();
