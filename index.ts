import * as restify from "restify";
import {
  ActivityHandler,
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication
} from "botbuilder";
import * as dotenv from "dotenv";
import { respond } from "./dialog"; // ✅ intake-only dialog

dotenv.config();

// Bot Framework auth/adapter
const auth = new ConfigurationBotFrameworkAuthentication(process.env as any);
const adapter = new CloudAdapter(auth);

// Bot: delegate all messages to respond()
class VoiceIntakeBot extends ActivityHandler {
  constructor() {
    super();

    this.onMembersAdded(async (ctx, next) => {
      // optional welcome ping; respond() will handle the real greeting on first user turn
      await ctx.sendActivity("Hi! Click Speak and start talking.");
      await next();
    });

    this.onMessage(async (ctx, next) => {
      const sessionId = `${ctx.activity.channelId}:${ctx.activity.conversation?.id || ""}`;
      const userText = ctx.activity.text || "";
      const reply = await respond(sessionId, userText);
      await ctx.sendActivity(reply);
      await next();
    });
  }
}
const bot = new VoiceIntakeBot();

// --- Restify server ---
const server = restify.createServer();
server.use(restify.plugins.bodyParser());

// Health check
server.get("/", (req, res, next) => {
  res.send(200, "✅ Intake-only bot running. Use /voice for the voice UI or /api/messages with the Emulator.");
  return next();
});

// Static voice page
server.get("/voice", (req, res, next) => {
  const fs = require("fs");
  const path = require("path");
  const p = path.join(process.cwd(), "public", "voice.html");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(fs.readFileSync(p));
  return next();
});

// Simple voice API used by voice.html
server.post("/api/voice-chat", async (req, res) => {
  try {
    const { text, sessionId } = req.body || {};
    if (!text) return res.send(400, { error: "Missing 'text' in body" });
    const sid = sessionId || "local-demo";
    const reply = await respond(sid, text);
    res.send(200, { reply });
  } catch (e: any) {
    console.error("voice-chat error:", e);
    res.send(500, { error: e?.message || "error" });
  }
});

// Bot Framework endpoint (for Emulator if you want)
server.post("/api/messages", async (req, res) => {
  await adapter.process(req, res, (context) => bot.run(context));
});

// Start
const port = process.env.PORT || 3978;
server.listen(port, () => {
  console.log(`Bot listening on http://localhost:${port}`);
});
