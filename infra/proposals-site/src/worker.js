// Serves the Syros Cats questions page and saves its answers. Everything else
// on this site is static and comes straight from public/.
//
// The page lives at /catspotters/questions/<QUESTIONS_TOKEN>. The token is a
// Worker secret, not in this repo, because the repo is public: it's the only
// thing that keeps the answers private.
import page from "./questions.html";
import questionIds from "./questionIds.json";

const PREFIX = "/catspotters/questions/";
const IDS = new Set(questionIds);
const MAX_NOTE = 4000;
const MAX_CHOICE = 80;
const MAX_BODY = 8192;

const PRIVATE_HEADERS = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
  "x-content-type-options": "nosniff",
};

const reply = (body, status, type) =>
  new Response(body, { status, headers: { ...PRIVATE_HEADERS, "content-type": type } });
const json = (value, status = 200) =>
  reply(JSON.stringify(value), status, "application/json; charset=utf-8");
const notFound = () => reply("Not found", 404, "text/plain; charset=utf-8");

function sameToken(a, b) {
  if (typeof b !== "string" || b.length < 32 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readAll(env) {
  const out = {};
  const stored = await env.ANSWERS.get([...IDS].slice(0, 100), "json");
  for (const [id, value] of stored) if (value) out[id] = value;
  return out;
}

async function save(request, env, id, url) {
  if (!IDS.has(id)) return notFound();
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return json({ error: "forbidden" }, 403);
  if (!(request.headers.get("content-type") || "").startsWith("application/json")) {
    return json({ error: "bad request" }, 400);
  }
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: "too long" }, 413);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "bad request" }, 400);
  }
  const choice = typeof body?.choice === "string" ? body.choice : "";
  const note = typeof body?.note === "string" ? body.note : "";
  if (choice.length > MAX_CHOICE || note.length > MAX_NOTE) return json({ error: "too long" }, 413);
  if (!choice && !note.trim()) await env.ANSWERS.delete(id);
  else await env.ANSWERS.put(id, JSON.stringify({ choice, note, at: new Date().toISOString() }));
  return json({ ok: true });
}

async function questions(request, env, url) {
  const [token, api, resource, id, ...rest] = url.pathname.slice(PREFIX.length).split("/");
  if (!sameToken(token, env.QUESTIONS_TOKEN)) return notFound();
  if (!api && !resource) {
    return request.method === "GET" ? reply(page, 200, "text/html; charset=utf-8") : notFound();
  }
  if (api !== "api" || resource !== "answers" || rest.length) return notFound();
  if (!id && request.method === "GET") return json(await readAll(env));
  if (id && request.method === "PUT") return save(request, env, id, url);
  return notFound();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith(PREFIX)) return questions(request, env, url);
    return env.ASSETS.fetch(request);
  },
};
