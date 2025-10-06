"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.respond = respond;
// src/dialog.ts
const intake_1 = require("./intake");
const sessions = new Map();
function ensure(sessionId) {
    const s = sessions.get(sessionId) ?? { greeted: false, inIntake: false };
    sessions.set(sessionId, s);
    return s;
}
/**
 * Voice-first receptionist dialog (intake only).
 * - First user turn: loads intake form, greets, asks first question.
 * - 'cancel' / 'restart': resets and restarts the form.
 * - 'operator' / 'human': stub handoff message (logs to console).
 * - Otherwise: processes answer -> next prompt or closing from intake.json.
 */
async function respond(sessionId, rawInput) {
    const raw = (rawInput ?? "").trim();
    const text = raw.toLowerCase();
    const s = ensure(sessionId);
    // First turn: load & start intake
    if (!s.greeted) {
        (0, intake_1.loadIntake)(); // safe to call repeatedly; hot-reloads intake.json
        s.greeted = true;
        s.inIntake = true;
        sessions.set(sessionId, s);
        return (0, intake_1.beginIntake)(sessionId); // greeting + first question
    }
    // Global controls
    if (text === "cancel" || text === "restart") {
        (0, intake_1.resetIntake)(sessionId);
        s.inIntake = true;
        sessions.set(sessionId, s);
        return (0, intake_1.beginIntake)(sessionId);
    }
    if (text.includes("operator") || text.includes("human")) {
        console.log("🚨 Handoff requested:", { sessionId, lastUserText: raw });
        return "I’m notifying a team member now. Please hold…";
    }
    // Allow explicit “start intake” phrases anytime
    if (/(take a message|leave a message|message|contact form|intake)/i.test(raw)) {
        (0, intake_1.resetIntake)(sessionId);
        s.inIntake = true;
        sessions.set(sessionId, s);
        return (0, intake_1.beginIntake)(sessionId);
    }
    // Intake flow (single path)
    const { reply } = (0, intake_1.handleIntake)(sessionId, raw);
    return reply;
}
