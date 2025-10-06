// src/intake.ts
import * as fs from "fs";
import * as path from "path";

type FieldType = "name" | "email" | "phone" | "text";
type Field = { id: string; label: string; prompt: string; type: FieldType; optional?: boolean; minLength?: number; error?: string; };
type IntakeForm = { id: string; greeting: string; fields: Field[]; closing: string; };
type FormState = { index: number; answers: Record<string, string> };

const FORM_PATH = path.join(process.cwd(), "data", "forms", "intake.json");
const LEADS_PATH = path.join(process.cwd(), "data", "leads.json");

let FORM: IntakeForm = { id: "default", greeting: "Welcome! How can I help you today?", fields: [], closing: "Thank you!" };

export function loadIntake() {
  try {
    const raw = fs.readFileSync(FORM_PATH, "utf8");
    FORM = JSON.parse(raw);
    console.log(`✅ Intake form loaded: ${FORM.id} (${FORM.fields.length} fields)`);
  } catch (e) {
    console.error("⚠️ Failed to load intake form:", e);
  }
  if (fs.existsSync(FORM_PATH)) {
    fs.watchFile(FORM_PATH, { interval: 1000 }, () => {
      try {
        const raw = fs.readFileSync(FORM_PATH, "utf8");
        FORM = JSON.parse(raw);
        console.log("♻️  Intake form reloaded.");
      } catch (err) {
        console.error("Intake reload failed:", err);
      }
    });
  }
}

const sessions = new Map<string, FormState>();

export function resetIntake(sessionId: string) {
  sessions.delete(sessionId);
}

export function beginIntake(sessionId: string): string {
  sessions.set(sessionId, { index: 0, answers: {} });
  const first = FORM.fields[0];
  const firstPrompt = first ? first.prompt : "";
  return [FORM.greeting, firstPrompt].filter(Boolean).join(" ");
}

function normalizeEmail(text: string): string | null {
  const spoken = text.replace(/\bat\b/gi, "@").replace(/\bdot\b/gi, ".").replace(/\s+/g, "").replace(/underscore/gi, "_").replace(/dash/gi, "-");
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
  return re.test(spoken) ? spoken : null;
}
function normalizeName(text: string): string | null {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.split(" ").length >= 2 && /^[a-zA-Z' -]{2,}$/.test(t)) return t;
  return null;
}
function normalizePhone(text: string): string | null {
  const digits = (text.match(/\d/g) || []).join("");
  if (digits.length >= 10) return digits;
  return null;
}
function validate(field: Field, raw: string): string | null {
  const t = raw.trim();
  switch (field.type) {
    case "name":  return normalizeName(t);
    case "email": return normalizeEmail(t);
    case "phone": return normalizePhone(t);
    case "text":
    default:
      if (field.optional && t.length === 0) return "";
      if (field.minLength && t.length < field.minLength) return null;
      return t;
  }
}
function saveLead(payload: Record<string, string>) {
  try {
    const arr = fs.existsSync(LEADS_PATH) ? JSON.parse(fs.readFileSync(LEADS_PATH, "utf8")) : [];
    arr.push({ ...payload, createdAt: new Date().toISOString() });
    fs.writeFileSync(LEADS_PATH, JSON.stringify(arr, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save lead:", e);
  }
}

export function handleIntake(sessionId: string, userText: string): { reply: string; done: boolean } {
  const state = sessions.get(sessionId);
  if (!state) return { reply: beginIntake(sessionId), done: false };

  if (!FORM.fields.length) {
    sessions.delete(sessionId);
    return { reply: FORM.closing, done: true };
  }

  const field = FORM.fields[state.index];
  if (field) {
    const value = validate(field, userText);
    if (value === null) return { reply: field.error || field.prompt, done: false };
    state.answers[field.id] = value;
    state.index += 1;
    sessions.set(sessionId, state);
  }

  const nextField = FORM.fields[state.index];
  if (nextField) return { reply: nextField.prompt, done: false };

  saveLead(state.answers);
  sessions.delete(sessionId);
  return { reply: FORM.closing, done: true };
}
