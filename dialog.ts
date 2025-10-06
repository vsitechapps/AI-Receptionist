// src/dialog.ts
import { loadIntake, beginIntake, handleIntake, resetIntake } from "./intake";

type Session = { greeted: boolean; inIntake: boolean };
const sessions = new Map<string, Session>();

function ensure(sessionId: string): Session {
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
export async function respond(sessionId: string, rawInput: string): Promise<string> {
  const raw = (rawInput ?? "").trim();
  const text = raw.toLowerCase();
  const s = ensure(sessionId);

  // First turn: load & start intake
  if (!s.greeted) {
    loadIntake();              // safe to call repeatedly; hot-reloads intake.json
    s.greeted = true;
    s.inIntake = true;
    sessions.set(sessionId, s);
    return beginIntake(sessionId); // greeting + first question
  }

  // Global controls
  if (text === "cancel" || text === "restart") {
    resetIntake(sessionId);
    s.inIntake = true;
    sessions.set(sessionId, s);
    return beginIntake(sessionId);
  }

  if (text.includes("operator") || text.includes("human")) {
    console.log("🚨 Handoff requested:", { sessionId, lastUserText: raw });
    return "I’m notifying a team member now. Please hold…";
  }

  // Allow explicit “start intake” phrases anytime
  if (/(take a message|leave a message|message|contact form|intake)/i.test(raw)) {
    resetIntake(sessionId);
    s.inIntake = true;
    sessions.set(sessionId, s);
    return beginIntake(sessionId);
  }

  // Intake flow (single path)
  const { reply } = handleIntake(sessionId, raw);
  return reply;
}
