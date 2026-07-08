/**
 * generation-view.ts — The generating screen as a three-act performance.
 *
 * Everything shown is real pipeline data, never theatre:
 *   Act 1  per-artwork analysis  — thumbnails light up as Granite Vision
 *          returns style/palette/mood for each work.
 *   Act 2  curation             — thumbnails regroup into the rooms the
 *          curator chose, with tour order and the curator's note.
 *   Act 3  floor plan           — a top-down line drawing of gallery.json:
 *          rooms, doorways, artwork positions, and the tour path.
 *
 * App chrome only — never part of the exported viewer bundle.
 */

import type { UploadedArtwork } from '../ai/provider';
import type { WorkAnalysis, CurationPlan } from '../schema/analysis.schema';
import type { Gallery } from '../schema/gallery.schema';
import { escapeHtml } from './escape-html';

// ---------------------------------------------------------------------------
// Floor plan SVG — pure and unit-testable
// ---------------------------------------------------------------------------

/**
 * Room origins replicate room-builder.ts exactly: rooms sit in a row along
 * +X, all at z = 0. If the builder's layout changes, update this too.
 */
export function computeRoomOrigins(gallery: Gallery): Map<string, { x: number; z: number }> {
  const origins = new Map<string, { x: number; z: number }>();
  let cursorX = 0;
  for (const room of gallery.rooms) {
    origins.set(room.id, { x: cursorX, z: 0 });
    cursorX += room.width;
  }
  return origins;
}

/**
 * Top-down line drawing of the gallery: room outlines with doorway gaps,
 * artwork tick marks on walls, and the tour path as an animated dashed line.
 * Coordinates are metres mapped straight into the viewBox (1 m = 10 units).
 */
export function buildFloorPlanSvg(gallery: Gallery): string {
  const M = 10; // viewBox units per metre
  const PAD = 14;
  const origins = computeRoomOrigins(gallery);

  const totalW = gallery.rooms.reduce((s, r) => s + r.width, 0);
  const maxD = Math.max(...gallery.rooms.map((r) => r.depth));
  const vbW = totalW * M + PAD * 2;
  const vbH = maxD * M + PAD * 2 + 12; // extra row for room captions

  const px = (xMetres: number) => PAD + xMetres * M;
  const pz = (zMetres: number) => PAD + zMetres * M;

  const parts: string[] = [];

  // Room outlines + captions
  gallery.rooms.forEach((room, i) => {
    const o = origins.get(room.id)!;
    parts.push(
      `<rect x="${px(o.x)}" y="${pz(o.z)}" width="${room.width * M}" height="${room.depth * M}" ` +
        `fill="none" stroke="#f0ece6" stroke-width="1.5" class="oh-plan-room"/>`
    );
    parts.push(
      `<text x="${px(o.x) + 5}" y="${pz(o.z + room.depth) + 11}" fill="#888" font-size="8" ` +
        `font-family="-apple-system,'Segoe UI',system-ui,sans-serif">Room ${i + 1}</text>`
    );

    // Doorway gaps: painted over the wall line in background color
    for (const d of room.doorways) {
      const seg = wallSegment(o, room.width, room.depth, d.wall, d.offsetFromCenter, d.width, M, px, pz);
      parts.push(
        `<line x1="${seg.x1}" y1="${seg.y1}" x2="${seg.x2}" y2="${seg.y2}" ` +
          `stroke="#0d0d0d" stroke-width="3"/>`
      );
    }
  });

  // Artwork ticks
  for (const p of gallery.placements) {
    const room = gallery.rooms.find((r) => r.id === p.roomId);
    const o = origins.get(p.roomId);
    if (!room || !o) continue;
    const seg = wallSegment(o, room.width, room.depth, p.wall, p.offsetFromCenter, p.displayWidth, M, px, pz);
    parts.push(
      `<line x1="${seg.x1}" y1="${seg.y1}" x2="${seg.x2}" y2="${seg.y2}" ` +
        `stroke="#6a9a6a" stroke-width="3" stroke-linecap="round" class="oh-plan-art"/>`
    );
  }

  // Tour path (absolute world coordinates, same space as the layout)
  if (gallery.tour.length > 1) {
    const pts = gallery.tour.map((wp) => `${px(wp.position.x)},${pz(wp.position.z)}`).join(' ');
    parts.push(
      `<polyline points="${pts}" fill="none" stroke="#d9a441" stroke-width="1.5" class="oh-plan-tour"/>`
    );
  }
  if (gallery.tour.length > 0) {
    const first = gallery.tour[0];
    parts.push(
      `<circle cx="${px(first.position.x)}" cy="${pz(first.position.z)}" r="3.5" fill="#d9a441"/>`
    );
  }

  return (
    `<svg viewBox="0 0 ${vbW} ${vbH}" role="img" aria-label="Gallery floor plan" ` +
      `style="width:100%;max-width:${Math.min(460, vbW * 1.4)}px;display:block;margin:0 auto;">` +
    parts.join('') +
    `</svg>`
  );
}

/**
 * A segment of given length centred at `offsetFromCenter` along a wall,
 * in viewBox coordinates. Wall convention mirrors room-builder.ts:
 * n → z = origin.z, s → z = origin.z + depth, w → x = origin.x, e → x + width.
 */
function wallSegment(
  o: { x: number; z: number },
  width: number,
  depth: number,
  wall: 'n' | 's' | 'e' | 'w',
  offsetFromCenter: number,
  lengthMetres: number,
  M: number,
  px: (m: number) => number,
  pz: (m: number) => number
): { x1: number; y1: number; x2: number; y2: number } {
  const half = (lengthMetres * M) / 2;
  if (wall === 'n' || wall === 's') {
    const cx = px(o.x + width / 2 + offsetFromCenter);
    const y = wall === 'n' ? pz(o.z) : pz(o.z + depth);
    return { x1: cx - half, y1: y, x2: cx + half, y2: y };
  }
  const cz = pz(o.z + depth / 2 + offsetFromCenter);
  const x = wall === 'w' ? px(o.x) : px(o.x + width);
  return { x1: x, y1: cz - half, x2: x, y2: cz + half };
}

// ---------------------------------------------------------------------------
// View controller
// ---------------------------------------------------------------------------

export interface GenerationView {
  setStatus(text: string, pct: number): void;
  /** Act 1: mark artwork `index` as being analysed. */
  startArtwork(index: number): void;
  /** Act 1: mark it done and surface the returned analysis. */
  finishArtwork(index: number, analysis: WorkAnalysis): void;
  /** Act 2: regroup thumbnails into curated rooms. */
  showCuration(plan: CurationPlan): void;
  /** Act 3: draw the floor plan from the final gallery. */
  showFloorPlan(gallery: Gallery): void;
}

/**
 * Mount the generation stage into the generating screen. `artworks` may be
 * empty (cached regeneration path) — the acts simply never fire then.
 */
export function createGenerationView(
  host: HTMLElement,
  artworks: UploadedArtwork[]
): GenerationView {
  host.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:1.1rem;width:min(560px,92vw);font-family:var(--oh-font);color:var(--oh-ink);">
      <div id="oh-gen-stage" style="width:100%;min-height:96px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.8rem;"></div>
      <p id="oh-progress-msg" style="font-size:1rem;margin:0;color:var(--oh-ink);">Initialising AI…</p>
      <div style="width:280px;height:4px;background:var(--oh-border);border-radius:2px;">
        <div id="oh-progress-bar" style="height:100%;background:#fff;border-radius:2px;width:0%;transition:width 0.4s;"></div>
      </div>
    </div>`;

  const stage = host.querySelector('#oh-gen-stage') as HTMLElement;
  const msg = host.querySelector('#oh-progress-msg') as HTMLElement;
  const bar = host.querySelector('#oh-progress-bar') as HTMLElement;

  const thumbById = new Map<string, string>(
    artworks.map((a) => [a.id, a.displayObjectUrl])
  );

  // --- Act 1 scaffold: thumbnail row + analysis readout ---
  let thumbEls: HTMLElement[] = [];
  let readout: HTMLElement | null = null;

  function ensureAnalysisStage(): void {
    if (thumbEls.length || !artworks.length) return;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;justify-content:center;';
    for (const aw of artworks) {
      const t = document.createElement('div');
      t.className = 'oh-gen-thumb';
      t.innerHTML = `<img src="${escapeHtml(aw.displayObjectUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;">`;
      row.appendChild(t);
      thumbEls.push(t);
    }
    readout = document.createElement('div');
    readout.className = 'oh-gen-readout';
    readout.setAttribute('aria-live', 'polite');
    stage.replaceChildren(row, readout);
  }

  return {
    setStatus(text, pct) {
      msg.textContent = text;
      bar.style.width = `${pct}%`;
    },

    startArtwork(index) {
      ensureAnalysisStage();
      thumbEls[index]?.classList.add('is-analysing');
    },

    finishArtwork(index, analysis) {
      ensureAnalysisStage();
      const t = thumbEls[index];
      if (t) {
        t.classList.remove('is-analysing');
        t.classList.add('is-done');
      }
      if (readout) {
        const dots = analysis.palette
          .slice(0, 4)
          .map((hex) => `<span class="oh-gen-dot" style="background:${escapeHtml(hex)};"></span>`)
          .join('');
        const words = [analysis.style, analysis.subject, analysis.mood]
          .filter(Boolean)
          .map((w) => escapeHtml(w))
          .join(' · ');
        readout.innerHTML = `${dots}<span style="margin-left:6px;">${words}</span>`;
      }
    },

    showCuration(plan) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center;width:100%;';
      const order = new Map(plan.tourOrder.map((id, i) => [id, i + 1]));
      for (const room of plan.rooms) {
        const card = document.createElement('div');
        card.className = 'oh-gen-room';
        const thumbs = room.artworkIds
          .map((id) => {
            const src = thumbById.get(id);
            const badge = order.has(id)
              ? `<span class="oh-gen-order">${order.get(id)}</span>`
              : '';
            return `<span class="oh-gen-mini">${
              src ? `<img src="${escapeHtml(src)}" alt="">` : ''
            }${badge}</span>`;
          })
          .join('');
        card.innerHTML = `
          <p class="oh-gen-room-title">${escapeHtml(room.theme)}</p>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">${thumbs}</div>`;
        wrap.appendChild(card);
      }
      const note = document.createElement('p');
      note.className = 'oh-gen-note';
      note.textContent = `“${plan.curatorNote}”`;
      stage.replaceChildren(wrap, note);
    },

    showFloorPlan(gallery) {
      const plan = document.createElement('div');
      plan.style.cssText = 'width:100%;';
      plan.innerHTML = buildFloorPlanSvg(gallery);
      stage.replaceChildren(plan);
    },
  };
}
