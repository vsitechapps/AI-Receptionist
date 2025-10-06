// server.js
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const { twiml: TwiML } = require("twilio");
const fs = require("fs").promises;

/* ---------------- Config: voice & language ---------------- */
const VOICE = process.env.TWILIO_VOICE || "Polly.Joanna-Neural"; // Neural sounds more natural
const LANG = "en-US";

/* ---------------- Shared greeting & prompts ---------------- */
const GREETING = "Hi there, I’m Eva with V S I Technologies. I’ll help you get an appointment set up.";
// Steps:
// 0 first/full name, 0.5 last name (if needed)
// 1 email, 2 services, 3 preferred day, 4 date(s), 5 time window,
// 6 timezone, 7 contact preference, 8 phone, 9 notes -> save & summary
const PROMPTS = [
  "Alright — what’s your first and last name?",
  "Thanks. What’s the best email to reach you?",
  "Got it. Which services are you looking for?",
  "Do you have a day of the week that works best?",
  "And what date or dates would you prefer?",
  "What hours are usually good for you on those days?",
  "What timezone are you in? For example, Eastern, Pacific, or G M T plus one.",
  "How do you prefer we contact you — email, phone, or text?",
  "What phone number should we use? You can say ‘skip’ to leave it blank.",
  "Any notes you’d like us to keep in mind? You can say ‘no’ to skip."
];

// Speech hints for Twilio <Gather> to improve spelling accuracy
const GATHER_HINTS = [
  "alpha,bravo,charlie,delta,echo,foxtrot,golf,hotel,india,juliett,kilo,lima,mike,november,oscar,papa,quebec,romeo,sierra,tango,uniform,victor,whiskey,xray,yankee,zulu",
  "at,dot,underscore,dash,hyphen,plus,period,point,at sign,at symbol",
  "zero,one,two,three,four,five,six,seven,eight,nine",
  "a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,w,x,y,z",
  // common email providers & TLDs (helps ASR)
  "gmail,outlook,hotmail,yahoo,icloud,protonmail,aol,live,msn",
  "com,org,net,io,co,ai,app,dev,edu,gov,us,uk,ca,co.uk"
].join(",");

/* ---------------- In-memory sessions ---------------- */
const sessions = new Map(); // id -> { step, values }
function ensureSession(id) {
  if (!sessions.has(id)) sessions.set(id, { step: 0, values: {} });
  return sessions.get(id);
}

/* ---------------- Local JSON storage ---------------- */
const DATA_DIR = path.join(__dirname, "data");
const LEADS_PATH = path.join(DATA_DIR, "leads.json");

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true }).catch(() => {});
  try { await fs.access(LEADS_PATH); }
  catch { await fs.writeFile(LEADS_PATH, "[]", "utf-8"); }
}

async function saveLead(lead) {
  await ensureDataFile();
  let raw = "[]";
  try { raw = await fs.readFile(LEADS_PATH, "utf-8"); } catch {}
  let arr = [];
  try { arr = JSON.parse(raw || "[]"); } catch { arr = []; }
  arr.push({ ...lead, createdAt: new Date().toISOString() });
  await fs.writeFile(LEADS_PATH, JSON.stringify(arr, null, 2), "utf-8");
}

/* ---------------- Helpers: SSML & spelling-aware parsing ---------------- */
function ssml(text) {
  const safe = String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const sentences = safe
    .trim()
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);

  const jitter = (min, max) => Math.random() * (max - min) + min;
  const toPct = (n) => `${Math.round(n)}%`;

  const parts = sentences.map((s) => {
    const rate = 94 + jitter(-2, 2);   // 92%–96%
    const pitch = 2 + jitter(-1, 3);   // +1%–+5%
    const pause = 240 + Math.floor(jitter(0, 220)); // 240–460ms
    return `<prosody rate="${toPct(rate)}" pitch="+${toPct(pitch)}">${s}</prosody><break time="${pause}ms"/>`;
  });

  // tiny pause at the end before Gather starts listening
  parts.push('<break time="220ms"/>');

  // Use Polly's conversational domain and auto-breaths when available
  return `<speak><amazon:domain name="conversational"><amazon:auto-breaths>${parts.join('')}</amazon:auto-breaths></amazon:domain></speak>`;
}

// NATO & spoken-letter maps
const NATO = {
  alpha:'a', bravo:'b', charlie:'c', delta:'d', echo:'e', foxtrot:'f',
  golf:'g', hotel:'h', india:'i', juliett:'j', kilo:'k', lima:'l', mike:'m',
  november:'n', oscar:'o', papa:'p', quebec:'q', romeo:'r', sierra:'s',
  tango:'t', uniform:'u', victor:'v', whiskey:'w', xray:'x', yankee:'y', zulu:'z'
};
const LETTER_WORDS = {
  aye:'a', a:'a', bee:'b', b:'b', cee:'c', c:'c', dee:'d', d:'d',
  ee:'e', e:'e', eff:'f', f:'f', gee:'g', g:'g', aitch:'h', haitch:'h', h:'h',
  eye:'i', i:'i', jay:'j', j:'j', kay:'k', k:'k', ell:'l', el:'l', l:'l',
  em:'m', m:'m', en:'n', n:'n', oh:'o', o:'o', pee:'p', p:'p',
  cue:'q', q:'q', are:'r', ar:'r', r:'r', ess:'s', s:'s',
  tee:'t', t:'t', you:'u', u:'u', vee:'v', v:'v', double:'', doubleu:'w', w:'w',
  ex:'x', x:'x', why:'y', y:'y', zed:'z', zee:'z', z:'z'
};
const DIGITS = { zero:'0', one:'1', two:'2', three:'3', four:'4', five:'5', six:'6', seven:'7', eight:'8', nine:'9' };
const GLUE = { dot:'.', period:'.', point:'.', at:'@', underscore:'_', dash:'-', hyphen:'-', plus:'+' };

// Turn “j a n e dot d o e at example dot com” -> "jane.doe@example.com"
// For names, we title-case afterward.
function parseSpelled(input) {
  const raw = (input || '').toLowerCase().replace(/[^a-z0-9 @._+\-]/g, ' ').trim();
  const words = raw.split(/\s+/);
  let out = '';
  for (let i = 0; i < words.length; i++) {
    const w = words[i];

    // handle "double u" / "double o" => 'w' / 'oo'
    if (w === 'double' && i + 1 < words.length) {
      const next = words[i + 1];
      const mapped = (LETTER_WORDS[next] || NATO[next] || next);
      if (mapped && mapped.length === 1) { out += mapped + mapped; i++; continue; }
    }

    if (GLUE[w]) { out += GLUE[w]; continue; }
    if (DIGITS[w]) { out += DIGITS[w]; continue; }
    if (NATO[w]) { out += NATO[w]; continue; }
    if (LETTER_WORDS[w]) { out += LETTER_WORDS[w]; continue; }

    // single allowed char
    if (/^[a-z0-9@._+\-]$/.test(w)) { out += w; continue; }

    // normal word (helps with spoken first/last names)
    if (/^[a-z]+$/.test(w)) { out += (out && !out.endsWith(' ') ? ' ' : '') + w; continue; }
  }
  return out.replace(/\s+/g, ' ').trim();
}
function titleCaseName(s='') {
  return s.split(/\s+/).map(p => p ? p[0].toUpperCase() + p.slice(1) : '').join(' ');
}

/* ---- EMAIL HELPERS (PERMANENT FIX) ---- */
function extractEmailFromSpeech(s="") {
  // 1) Convert NATO/letters/glue to characters
  let parsed = parseSpelled(s);

  // 2) Handle "at sign"/"at symbol" artifacts from ASR
  parsed = parsed
    .replace(/@\s*(sign|symbol)\b/gi, "@")
    .replace(/\bat\s+(sign|symbol)\b/gi, "at");

  // 3) First attempt: match in the spaced text
  let m = parsed.match(/[a-z0-9._+\-]+@[a-z0-9._+\-]+\.[a-z0-9.\-]+/i);
  if (m) return m[0].toLowerCase();

  // 4) Collapse spaces; second attempt
  const collapsed = parsed.replace(/\s+/g, "");
  m = collapsed.match(/[a-z0-9._+\-]+@[a-z0-9._+\-]+\.[a-z0-9.\-]+/i);
  return m ? m[0].toLowerCase() : "";
}
function normalizeEmail(s="") {
  return extractEmailFromSpeech(s);
}
function emailLooksValid(s="") {
  const e = extractEmailFromSpeech(s);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function normalizePhone(s="") {
  if (!s || /^(skip|no)$/i.test(String(s).trim())) return "";
  const digits = (String(s).match(/\d/g) || []).join("");
  if (digits.length < 10 || digits.length > 15) return ""; // treat as skipped if not plausible
  return digits;
}

/* ---------------- Express app ---------------- */
const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public"))); // serve voice.html etc.

app.get("/ping", (_req, res) => res.json({ ok: true }));

/* ---------- Browser demo endpoints ---------- */
app.get("/api/greeting", (_req, res) => {
  res.json({ greeting: GREETING, firstPrompt: PROMPTS[0] });
});

app.get("/api/debug", (req, res) => {
  const sid = req.query.sid || "browser-demo";
  res.json({ sessionId: sid, flow: sessions.get(sid) || null });
});

app.post("/api/voice-chat", async (req, res) => {
  const { text = "", sessionId = "browser-demo" } = req.body || {};
  const user = String(text || "").trim();
  const sess = ensureSession(sessionId);

  console.log(`[voice-chat] sid=${sessionId} step=${sess.step} text="${user}"`);

  switch (sess.step) {
    case 0: { // first or full name
      if (!user || /^(hi|hello|hey)\b/i.test(user)) {
        return res.json({ reply: PROMPTS[0] });
      }
      const parsed = titleCaseName(parseSpelled(user) || user);
      const parts = parsed.split(/\s+/).filter(Boolean);

      if (parts.length >= 2) {
        sess.values.name = parsed;
        sess.step = 1;
        return res.json({ reply: PROMPTS[1] });
      } else {
        sess.values.firstName = parts[0];
        sess.step = 0.5;
        return res.json({ reply: `Thanks, ${parts[0]}. And your last name?` });
      }
    }

    case 0.5: { // last name
      const lastParsed = titleCaseName(parseSpelled(user) || user);
      const last = lastParsed.split(/\s+/)[0] || '';
      if (!last) return res.json({ reply: "Sorry, I didn't catch that last name. Could you repeat just your last name?" });

      const first = sess.values.firstName || '';
      sess.values.name = `${first} ${last}`.trim();
      delete sess.values.firstName;
      sess.step = 1;
      return res.json({ reply: PROMPTS[1] });
    }

    case 1: { // email
      const e = normalizeEmail(user);
      if (!emailLooksValid(user)) {
        return res.json({ reply: 'Please provide a valid email address, e.g., "jane at example dot com".' });
      }
      sess.values.email = e;
      sess.step = 2;
      return res.json({ reply: PROMPTS[2] });
    }
    case 2: { // services
      sess.values.services = user || "unspecified";
      sess.step = 3;
      return res.json({ reply: PROMPTS[3] });
    }
    case 3: { // day
      sess.values.appointmentDay = user || "no preference";
      sess.step = 4;
      return res.json({ reply: PROMPTS[4] });
    }
    case 4: { // date(s)
      sess.values.appointmentDate = user || "unspecified";
      sess.step = 5;
      return res.json({ reply: PROMPTS[5] });
    }
    case 5: { // time window
      sess.values.appointmentTimeWindow = user || "unspecified";
      sess.step = 6;
      return res.json({ reply: PROMPTS[6] });
    }
    case 6: { // timezone
      sess.values.timezone = user || "unspecified";
      sess.step = 7;
      return res.json({ reply: PROMPTS[7] });
    }
    case 7: { // contact preference
      const cp = (user || "unspecified").toLowerCase();
      sess.values.contactPreference = cp;
      sess.step = 8;
      return res.json({ reply: PROMPTS[8] });
    }
    case 8: { // phone
      const phone = normalizePhone(user);
      sess.values.phone = phone; // "" if skipped/invalid
      sess.step = 9;
      return res.json({ reply: PROMPTS[9] });
    }
    case 9: { // notes -> save & summary
      sess.values.notes = /^(no|none|nope)$/i.test(user) ? "" : (user || "");
      const v = sess.values;
      sessions.delete(sessionId);

      await saveLead({ source: "browser", ...v });

      const summary =
        `Thanks! Here's what I captured. ` +
        `Name: ${v.name}. Email: ${v.email}. Services: ${v.services}. ` +
        `Preferred day: ${v.appointmentDay}. Preferred date: ${v.appointmentDate}. ` +
        `Available hours: ${v.appointmentTimeWindow}. Timezone: ${v.timezone}. ` +
        `Contact preference: ${v.contactPreference}. Phone: ${v.phone || "n/a"}. ` +
        `Notes: ${v.notes || "n/a"}. ` +
        `We will follow up to confirm an appointment that fits your availability.`;
      return res.json({ reply: summary });
    }
    default:
      sess.step = 0;
      return res.json({ reply: PROMPTS[0] });
  }
});

/* ---------- Twilio Voice Webhooks ---------- */
app.get("/twilio/voice", (_req, res) => {
  const vr = new TwiML.VoiceResponse();
  vr.say({ voice: VOICE, language: LANG }, "GET hit. Webhook is reachable.");
  res.type("text/xml").send(vr.toString());
});

function gatherWithPrompt(vr, text, useSsml = true) {
  const g = vr.gather({
    input: "speech",
    action: "/twilio/handle",
    method: "POST",
    language: LANG,
    speechTimeout: "auto",
    hints: GATHER_HINTS
  });
  const content = useSsml ? ssml(text) : text;
  g.say({ voice: VOICE, language: LANG }, content);
}

app.post("/twilio/voice", (req, res) => {
  const callSid = String(req.body.CallSid || `call_${Date.now()}`);
  ensureSession(callSid);

  const vr = new TwiML.VoiceResponse();
  vr.say({ voice: VOICE, language: LANG }, ssml(GREETING));
  gatherWithPrompt(vr, PROMPTS[0]);

  res.type("text/xml").send(vr.toString());
});

app.post("/twilio/handle", async (req, res) => {
  const callSid = String(req.body.CallSid || "");
  const speech = String(req.body.SpeechResult || "").trim();
  const sess = ensureSession(callSid);

  let nextReply = "";

  switch (sess.step) {
    case 0: { // first or full name
      const parsed = titleCaseName(parseSpelled(speech) || speech);
      const parts = parsed.split(/\s+/).filter(Boolean);

      if (parts.length >= 2) {
        sess.values.name = parsed;
        sess.step = 1;
        nextReply = PROMPTS[1];
      } else if (parts.length === 1) {
        sess.values.firstName = parts[0];
        sess.step = 0.5;
        nextReply = `Thanks, ${parts[0]}. And your last name?`;
      } else {
        nextReply = PROMPTS[0];
      }
      break;
    }

    case 0.5: { // last name
      const lastParsed = titleCaseName(parseSpelled(speech) || speech);
      const last = lastParsed.split(/\s+/)[0] || '';
      if (!last) {
        nextReply = "Sorry, I didn't catch that last name. Could you repeat just your last name?";
        break;
      }
      const first = sess.values.firstName || '';
      sess.values.name = `${first} ${last}`.trim();
      delete sess.values.firstName;
      sess.step = 1;
      nextReply = PROMPTS[1];
      break;
    }

    case 1: { // email
      const e = normalizeEmail(speech);
      if (!emailLooksValid(speech)) {
        nextReply = 'Please provide a valid email address, for example "jane at example dot com".';
        break;
      }
      sess.values.email = e;
      sess.step = 2;
      nextReply = PROMPTS[2];
      break;
    }
    case 2: { // services
      sess.values.services = speech || "unspecified";
      sess.step = 3;
      nextReply = PROMPTS[3];
      break;
    }
    case 3: { // day
      sess.values.appointmentDay = speech || "no preference";
      sess.step = 4;
      nextReply = PROMPTS[4];
      break;
    }
    case 4: { // date(s)
      sess.values.appointmentDate = speech || "unspecified";
      sess.step = 5;
      nextReply = PROMPTS[5];
      break;
    }
    case 5: { // time window
      sess.values.appointmentTimeWindow = speech || "unspecified";
      sess.step = 6;
      nextReply = PROMPTS[6];
      break;
    }
    case 6: { // timezone
      sess.values.timezone = speech || "unspecified";
      sess.step = 7;
      nextReply = PROMPTS[7];
      break;
    }
    case 7: { // contact preference
      sess.values.contactPreference = (speech || "unspecified").toLowerCase();
      sess.step = 8;
      nextReply = PROMPTS[8];
      break;
    }
    case 8: { // phone
      const phone = normalizePhone(speech);
      sess.values.phone = phone; // "" if skipped/invalid
      sess.step = 9;
      nextReply = PROMPTS[9];
      break;
    }
    case 9: { // notes -> save & summary
      sess.values.notes = /^(no|none|nope)$/i.test(speech) ? "" : (speech || "");
      const v = sess.values;

      await saveLead({ source: "twilio", callSid, ...v });

      sessions.delete(callSid);
      nextReply =
        `Thank you. I captured the following. ` +
        `Name: ${v.name}. Email: ${v.email}. Services: ${v.services}. ` +
        `Preferred day: ${v.appointmentDay}. Preferred date: ${v.appointmentDate}. ` +
        `Available hours: ${v.appointmentTimeWindow}. Timezone: ${v.timezone}. ` +
        `Contact preference: ${v.contactPreference}. Phone: ${v.phone || "n/a"}. ` +
        `Notes: ${v.notes || "n/a"}. ` +
        `We will follow up to confirm an appointment that fits your availability. Goodbye.`;
      break;
    }
    default: {
      sess.step = 0;
      nextReply = PROMPTS[0];
    }
  }

  const vr = new TwiML.VoiceResponse();

  if (!sessions.has(callSid)) {
    vr.say({ voice: VOICE, language: LANG }, ssml(nextReply));
    vr.hangup();
  } else {
    gatherWithPrompt(vr, nextReply, true);
  }

  res.type("text/xml").send(vr.toString());
});

/* ---------- Optional: status webhook ---------- */
app.post("/twilio/status", (req, res) => {
  try { console.log("CALL STATUS:", req.body.CallSid, req.body.CallStatus); } catch {}
  res.sendStatus(200);
});

/* ---------------- Start server ---------------- */
const PORT = process.env.PORT || 3978;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Open browser demo at: http://localhost:${PORT}/voice.html`);
});
