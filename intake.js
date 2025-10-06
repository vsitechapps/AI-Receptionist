"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadIntake = loadIntake;
exports.resetIntake = resetIntake;
exports.beginIntake = beginIntake;
exports.handleIntake = handleIntake;
// src/intake.ts
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const FORM_PATH = path.join(process.cwd(), "data", "forms", "intake.json");
const LEADS_PATH = path.join(process.cwd(), "data", "leads.json");
let FORM = { id: "default", greeting: "Welcome! How can I help you today?", fields: [], closing: "Thank you!" };
function loadIntake() {
    try {
        const raw = fs.readFileSync(FORM_PATH, "utf8");
        FORM = JSON.parse(raw);
        console.log(`✅ Intake form loaded: ${FORM.id} (${FORM.fields.length} fields)`);
    }
    catch (e) {
        console.error("⚠️ Failed to load intake form:", e);
    }
    if (fs.existsSync(FORM_PATH)) {
        fs.watchFile(FORM_PATH, { interval: 1000 }, () => {
            try {
                const raw = fs.readFileSync(FORM_PATH, "utf8");
                FORM = JSON.parse(raw);
                console.log("♻️  Intake form reloaded.");
            }
            catch (err) {
                console.error("Intake reload failed:", err);
            }
        });
    }
}
const sessions = new Map();
function resetIntake(sessionId) {
    sessions.delete(sessionId);
}
function beginIntake(sessionId) {
    sessions.set(sessionId, { index: 0, answers: {} });
    const first = FORM.fields[0];
    const firstPrompt = first ? first.prompt : "";
    return [FORM.greeting, firstPrompt].filter(Boolean).join(" ");
}
function normalizeEmail(text) {
    const spoken = text.replace(/\bat\b/gi, "@").replace(/\bdot\b/gi, ".").replace(/\s+/g, "").replace(/underscore/gi, "_").replace(/dash/gi, "-");
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
    return re.test(spoken) ? spoken : null;
}
function normalizeName(text) {
    const t = text.trim().replace(/\s+/g, " ");
    if (t.split(" ").length >= 2 && /^[a-zA-Z' -]{2,}$/.test(t))
        return t;
    return null;
}
function normalizePhone(text) {
    const digits = (text.match(/\d/g) || []).join("");
    if (digits.length >= 10)
        return digits;
    return null;
}
function validate(field, raw) {
    const t = raw.trim();
    switch (field.type) {
        case "name": return normalizeName(t);
        case "email": return normalizeEmail(t);
        case "phone": return normalizePhone(t);
        case "text":
        default:
            if (field.optional && t.length === 0)
                return "";
            if (field.minLength && t.length < field.minLength)
                return null;
            return t;
    }
}
function saveLead(payload) {
    try {
        const arr = fs.existsSync(LEADS_PATH) ? JSON.parse(fs.readFileSync(LEADS_PATH, "utf8")) : [];
        arr.push({ ...payload, createdAt: new Date().toISOString() });
        fs.writeFileSync(LEADS_PATH, JSON.stringify(arr, null, 2), "utf8");
    }
    catch (e) {
        console.error("Failed to save lead:", e);
    }
}
function handleIntake(sessionId, userText) {
    const state = sessions.get(sessionId);
    if (!state)
        return { reply: beginIntake(sessionId), done: false };
    if (!FORM.fields.length) {
        sessions.delete(sessionId);
        return { reply: FORM.closing, done: true };
    }
    const field = FORM.fields[state.index];
    if (field) {
        const value = validate(field, userText);
        if (value === null)
            return { reply: field.error || field.prompt, done: false };
        state.answers[field.id] = value;
        state.index += 1;
        sessions.set(sessionId, state);
    }
    const nextField = FORM.fields[state.index];
    if (nextField)
        return { reply: nextField.prompt, done: false };
    saveLead(state.answers);
    sessions.delete(sessionId);
    return { reply: FORM.closing, done: true };
}
