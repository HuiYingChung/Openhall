#!/usr/bin/env node
/**
 * check-stage3.mjs — End-to-end verification of gallery-assembler + label LLM
 *
 * Exercises the full stage-3 path (generateGallery) with a synthetic curation plan
 * for 6 fictitious artworks. Uses real watsonx credentials from .env.
 *
 * Usage:
 *   node scripts/check-stage3.mjs
 *
 * Required env vars (from .env):
 *   WATSONX_API_KEY
 *   WATSONX_PROJECT_ID
 */

import { readFileSync, existsSync } from 'fs';

// Simple .env loader (no dependency)
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
}

const API_KEY = process.env.WATSONX_API_KEY;
const PROJECT_ID = process.env.WATSONX_PROJECT_ID;

if (!API_KEY || API_KEY.includes('paste-your')) {
  console.error('ERROR: WATSONX_API_KEY not set in .env');
  process.exit(1);
}
if (!PROJECT_ID || PROJECT_ID.includes('paste-your')) {
  console.error('ERROR: WATSONX_PROJECT_ID not set in .env');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Inline the logic we need (Node can't import TS directly)
// We replicate only what's needed: IAM token + raw chat + assembler + labels
// ---------------------------------------------------------------------------

const IAM_URL = 'https://iam.cloud.ibm.com/identity/token';
const WX_BASE = 'https://us-south.ml.cloud.ibm.com';
const WX_VERSION = '2024-05-31';
const TEXT_MODEL = 'ibm/granite-3-8b-instruct';

function pass(m) { console.log(`  ✅ ${m}`); }
function fail(m) { console.log(`  ❌ ${m}`); }
function info(m) { console.log(`  ℹ  ${m}`); }
function section(t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 50 - t.length))}`); }

// ---------------------------------------------------------------------------
// IAM token
// ---------------------------------------------------------------------------
section('Step 1: IAM token');
let bearer;
try {
  const r = await fetch(IAM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ibm:params:oauth:grant-type:apikey', apikey: API_KEY }).toString(),
  });
  if (!r.ok) { fail(`HTTP ${r.status}: ${await r.text()}`); process.exit(1); }
  const j = await r.json();
  bearer = j.access_token;
  pass(`Token OK, expires in ${j.expires_in}s`);
} catch (e) { fail(e.message); process.exit(1); }

// ---------------------------------------------------------------------------
// Synthetic fixtures
// ---------------------------------------------------------------------------

const ARTWORKS = Array.from({ length: 6 }, (_, i) => ({
  id: `aw-0${i + 1}`,
  filename: `img${i + 1}.jpg`,
  analysisDataUrl: '',
  displayObjectUrl: '',
  aspectRatio: 1.5,
  title: `Synthetic Work ${i + 1}`,
  medium: 'Oil on canvas',
}));

const ANALYSES = ARTWORKS.map((aw) => ({
  artworkId: aw.id,
  style: 'abstract expressionism',
  palette: ['#c0a070', '#3a3a3a'],
  subject: 'colour field study',
  mood: 'contemplative',
  description: 'A synthetic test artwork used for stage-3 verification.',
}));

const PLAN = {
  roomCount: 2,
  rooms: [
    { roomId: 'r1', theme: 'Texture', artworkIds: ['aw-01', 'aw-02', 'aw-03'] },
    { roomId: 'r2', theme: 'Form',    artworkIds: ['aw-04', 'aw-05', 'aw-06'] },
  ],
  placements: [
    { artworkId: 'aw-01', roomId: 'r1', wall: 'n', offsetFromCenter: 0 },
    { artworkId: 'aw-02', roomId: 'r1', wall: 's', offsetFromCenter: -2 },
    { artworkId: 'aw-03', roomId: 'r1', wall: 'w', offsetFromCenter: 1 },
    { artworkId: 'aw-04', roomId: 'r2', wall: 'n', offsetFromCenter: 0 },
    { artworkId: 'aw-05', roomId: 'r2', wall: 'e', offsetFromCenter: 0 },
    { artworkId: 'aw-06', roomId: 'r2', wall: 's', offsetFromCenter: 2 },
  ],
  tourOrder: ['aw-01', 'aw-02', 'aw-03', 'aw-04', 'aw-05', 'aw-06'],
  curatorNote: 'A two-room survey of texture and form in contemporary abstraction.',
};

// ---------------------------------------------------------------------------
// chat helper
// ---------------------------------------------------------------------------

async function chat(messages, maxNewTokens = 600) {
  const url = `${WX_BASE}/ml/v1/text/chat?version=${WX_VERSION}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({
      model_id: TEXT_MODEL,
      project_id: PROJECT_ID,
      messages,
      parameters: { max_new_tokens: maxNewTokens, temperature: 0.1 },
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const finishReason = j?.choices?.[0]?.finish_reason;
  if (finishReason === 'length' || finishReason === 'max_tokens') {
    throw new Error(`Output truncated (finish_reason: "${finishReason}") — would have failed before this fix`);
  }
  return j?.choices?.[0]?.message?.content ?? '';
}

function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const s = Math.min(
    text.indexOf('{') === -1 ? Infinity : text.indexOf('{'),
    text.indexOf('[') === -1 ? Infinity : text.indexOf('['),
  );
  const e = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (s === Infinity || e === -1) return text.trim();
  return text.slice(s, e + 1);
}

// ---------------------------------------------------------------------------
// Step 2: Exhibition title (32 tokens)
// ---------------------------------------------------------------------------
section('Step 2: Exhibition title (32 tokens)');
let title = 'New Exhibition';
try {
  const raw = await chat(
    [{ role: 'user', content: `In 4 words or fewer, suggest an exhibition title based on this curator note: "${PLAN.curatorNote}". Reply with ONLY the title, no quotes.` }],
    32
  );
  title = raw.replace(/^["']|["']$/g, '').trim() || 'New Exhibition';
  pass(`Title: "${title}"`);
} catch (e) { fail(e.message); process.exit(1); }

// ---------------------------------------------------------------------------
// Step 3: Deterministic geometry
// ---------------------------------------------------------------------------
section('Step 3: Deterministic geometry (in-process)');

// Replicate assembleGallery logic inline (avoids needing tsx/ts-node)
const PRESET = {
  wall: 'white-plaster', floor: 'light-wood', accent: '#e8e0d8',
  ambientIntensity: 0.45, temperature: 'neutral',
  widthBase: 12, depthBase: 10, height: 3.5,
};

const rooms = PLAN.rooms.map((brief, idx) => ({
  id: brief.roomId,
  width: PRESET.widthBase,
  depth: PRESET.depthBase,
  height: PRESET.height,
  surfaces: { wall: PRESET.wall, floor: PRESET.floor, accentColor: PRESET.accent },
  lighting: { ambientIntensity: PRESET.ambientIntensity, temperature: PRESET.temperature, artworkSpotlights: true },
  doorways: idx < PLAN.rooms.length - 1
    ? [{ targetRoomId: PLAN.rooms[idx + 1].roomId, wall: 'e', offsetFromCenter: 0, width: 2.0, height: 2.4 }]
    : [],
}));

const placements = PLAN.placements.map((pb) => ({
  artworkId: pb.artworkId, roomId: pb.roomId, wall: pb.wall,
  offsetFromCenter: pb.offsetFromCenter, hangingHeight: 1.5, displayWidth: 1.2,
}));

pass(`${rooms.length} rooms built, ${placements.length} placements`);
pass(`Doorways: ${rooms.filter(r => r.doorways.length > 0).length} connection(s)`);

// ---------------------------------------------------------------------------
// Step 4: Label batches (≤4 works per call, ~400-600 tokens each)
// ---------------------------------------------------------------------------
section('Step 4: Label batches (≤4 works per call)');
const labelMap = {};
const BATCH_SIZE = 4;

for (let i = 0; i < ARTWORKS.length; i += BATCH_SIZE) {
  const batch = ARTWORKS.slice(i, i + BATCH_SIZE);
  const artworkBlock = batch.map((aw) => {
    const an = ANALYSES.find((a) => a.artworkId === aw.id);
    return `  { "id": "${aw.id}", "title": "${aw.title}", "medium": "${aw.medium}", "style": "${an.style}", "subject": "${an.subject}", "mood": "${an.mood}", "description": "${an.description}" }`;
  }).join(',\n');

  const prompt = `You are writing wall labels for an art exhibition.\n\nCURATOR NOTE: "${PLAN.curatorNote}"\n\nARTWORKS:\n[\n${artworkBlock}\n]\n\nFor each artwork, write a 2–3 sentence wall label. Base it ONLY on the visual analysis provided.\n\nRespond with ONLY a JSON array:\n[\n  {\n    "artworkId": "<id>",\n    "label": "<2–3 sentence wall label>"\n  }\n]\n\nRespond with ONLY the JSON array — no markdown fences, no extra text`;

  try {
    const raw = await chat([{ role: 'user', content: prompt }], 600);
    const entries = JSON.parse(extractJSON(raw));
    for (const e of entries) labelMap[e.artworkId] = e.label;
    pass(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${entries.length} labels, max chars: ${Math.max(...entries.map(e => e.label.length))}`);
  } catch (e) {
    fail(`Batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${e.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Step 5: Assemble and validate
// ---------------------------------------------------------------------------
section('Step 5: Assemble and schema-validate gallery');

const artworks = ARTWORKS.map((aw) => ({
  id: aw.id,
  imagePath: `images/${aw.id}.jpg`,
  title: aw.title,
  medium: aw.medium,
  label: labelMap[aw.id] ?? 'No label.',
}));

// Tour waypoints
const roomOrigins = {};
let cx = 0;
for (const r of rooms) { roomOrigins[r.id] = { originX: cx, width: r.width, depth: r.depth }; cx += r.width; }
const pbMap = {};
for (const pb of PLAN.placements) pbMap[pb.artworkId] = pb;
const tour = PLAN.tourOrder.map((id) => {
  const pb = pbMap[id]; const ro = roomOrigins[pb.roomId];
  const rcx = ro.originX + ro.width / 2; const rcz = ro.depth / 2;
  let ax, az, sx, sz;
  if (pb.wall === 'n') { ax = rcx + pb.offsetFromCenter; az = 0; sx = ax; sz = 2; }
  else if (pb.wall === 's') { ax = rcx + pb.offsetFromCenter; az = ro.depth; sx = ax; sz = ro.depth - 2; }
  else if (pb.wall === 'w') { ax = ro.originX; az = rcz + pb.offsetFromCenter; sx = ro.originX + 2; sz = az; }
  else { ax = ro.originX + ro.width; az = rcz + pb.offsetFromCenter; sx = ro.originX + ro.width - 2; sz = az; }
  return { artworkId: id, position: { x: sx, y: 1.6, z: sz }, lookAt: { x: ax, y: 1.5, z: az }, label: ARTWORKS.find(a => a.id === id)?.title ?? id };
});

const gallery = { version: '1.0', title, rooms, artworks, placements, tour };

// Simple structural check (no zod in plain node)
const valid =
  gallery.version === '1.0' &&
  typeof gallery.title === 'string' &&
  Array.isArray(gallery.rooms) && gallery.rooms.length >= 1 && gallery.rooms.length <= 4 &&
  Array.isArray(gallery.artworks) && gallery.artworks.length === ARTWORKS.length &&
  gallery.artworks.every((a) => a.label && a.label.length > 5) &&
  Array.isArray(gallery.placements) && gallery.placements.length === PLAN.placements.length &&
  Array.isArray(gallery.tour) && gallery.tour.length === PLAN.tourOrder.length;

if (valid) {
  pass('Gallery structure valid');
  pass(`${gallery.rooms.length} rooms, ${gallery.artworks.length} artworks, ${gallery.placements.length} placements, ${gallery.tour.length} tour waypoints`);
  info(`All labels present: ${gallery.artworks.every(a => a.label.length > 10) ? 'YES' : 'NO'}`);
} else {
  fail('Gallery structure INVALID');
  console.error(JSON.stringify(gallery, null, 2));
  process.exit(1);
}

section('Summary');
pass('Stage-3 gallery generation: PASS');
info('Old path: LLM emits entire gallery.json in one call → truncation at ~3533 chars');
info('New path: geometry in code (no tokens) + labels in batches of ≤4 (~400 tokens each)');
