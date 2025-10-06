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
const restify = __importStar(require("restify"));
const botbuilder_1 = require("botbuilder");
const dotenv = __importStar(require("dotenv"));
const dialog_1 = require("./dialog"); // ✅ intake-only dialog
dotenv.config();
// Bot Framework auth/adapter
const auth = new botbuilder_1.ConfigurationBotFrameworkAuthentication(process.env);
const adapter = new botbuilder_1.CloudAdapter(auth);
// Bot: delegate all messages to respond()
class VoiceIntakeBot extends botbuilder_1.ActivityHandler {
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
            const reply = await (0, dialog_1.respond)(sessionId, userText);
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
        if (!text)
            return res.send(400, { error: "Missing 'text' in body" });
        const sid = sessionId || "local-demo";
        const reply = await (0, dialog_1.respond)(sid, text);
        res.send(200, { reply });
    }
    catch (e) {
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
