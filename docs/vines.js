// Ivy that grows in from the sides of the page as you scroll: above each section,
// a vine comes in from one side and hangs across, floating a little faster than
// the page. It's laid out like ivy: drapes that sag between high points, a second
// strand twining round the first, side shoots angled forward that branch again,
// and leaves on stalks clustered at their tips. It matures further down the page:
// simple leaves give way to ivy and small blooms open in the last third.
// Everything is drawn once, behind the content; scrolling only reveals what's
// already there, and scrolling back up takes it away again.
// With reduced motion it's shown fully grown and nothing floats.

(() => {
  const NS = 'http://www.w3.org/2000/svg';
  // Drawing happens in `svg` (kept off screen); the finished shapes move into their layers.
  const svg = document.createElementNS(NS, 'svg');
  svg.classList.add('vines', 'drawing');
  svg.setAttribute('aria-hidden', 'true');
  document.body.prepend(svg);
  const holder = document.createElement('div');
  holder.className = 'vines-front';
  holder.setAttribute('aria-hidden', 'true');
  document.body.prepend(holder);
  let sprigs = [];                  // the vines, one per section: { g, top, tall, el }
  const FLOAT = 1.08;               // their speed, as a share of the page's
  // Where the browser can, CSS floats them, in step with scrolling; elsewhere, grow() does.
  const timeline = window.CSS?.supports?.('animation-timeline: view()');

  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let parts = [];           // what scrolling reveals: { el, kind, at, at2?, len? }
  let built = '';           // the layout the drawing was made for

  // A small seeded random, so the vine is the same on every visit.
  function random(seed) {
    return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  }

  const el = (name, attrs) => {
    const n = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const f = n => n.toFixed(1);

  // Catmull-Rom through points, as cubic Béziers.
  function smooth(points) {
    let d = `M${f(points[0].x)},${f(points[0].y)}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] ?? points[i], p1 = points[i], p2 = points[i + 1], p3 = points[i + 2] ?? p2;
      d += ` C${f(p1.x + (p2.x - p0.x) / 6)},${f(p1.y + (p2.y - p0.y) / 6)} ${f(p2.x - (p3.x - p1.x) / 6)},${f(p2.y - (p3.y - p1.y) / 6)} ${f(p2.x)},${f(p2.y)}`;
    }
    return d;
  }

  // Leaves sit on a short stalk: its foot at (0,0), the leaf's tip at (0,-1).
  // Near the top of the page they're the logo's own leaf; further down they turn to ivy.
  const LEAF = 'M0,0 L0,-0.25 C-0.32,-0.47 -0.32,-0.81 0,-1 C0.32,-0.81 0.32,-0.47 0,-0.25 Z';
  const IVY = 'M0,0 L0,-0.24 Q-0.24,-0.12 -0.44,-0.22 Q-0.38,-0.34 -0.27,-0.42 Q-0.52,-0.45 -0.58,-0.63 '
    + 'Q-0.36,-0.63 -0.17,-0.69 Q-0.12,-0.87 0,-1 Q0.12,-0.87 0.17,-0.69 Q0.36,-0.63 0.58,-0.63 '
    + 'Q0.52,-0.45 0.27,-0.42 Q0.38,-0.34 0.44,-0.22 Q0.24,-0.12 0,-0.24 Z';

  /**
   * A track is a list of points { x, y, at, d }: where the vine runs, the scroll
   * position (the "head") at which it gets there, and how mature it is (0..1).
   * stem() draws it in short pieces, so it can thicken and taper.
   */
  function stem(g, track, width) {
    for (let i = 0; i < track.length - 1; i += 4) {
      const piece = track.slice(Math.max(0, i - 1), i + 6);
      const mid = track[Math.min(track.length - 1, i + 2)];
      const path = el('path', { d: smooth(piece), class: 'vine-stem', 'stroke-width': width(mid, i / (track.length - 1)).toFixed(2) });
      g.append(path);
      parts.push({ el: path, kind: 'stem', at: track[i].at, at2: piece.at(-1).at });
    }
  }

  // Which way a track is heading at point i.
  const headingAt = (track, i) => {
    const a = track[Math.max(0, i - 1)], b = track[Math.min(track.length - 1, i + 1)];
    return Math.atan2(b.y - a.y, b.x - a.x);
  };

  // Gives raw points their scroll timing and maturity, by distance along them.
  function timed(pts, at0, atLen, d0, fade = 0.3) {
    let total = 0;
    const dist = pts.map((p, i) => total += i ? Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0);
    return pts.map((p, i) => ({ x: p.x, y: p.y, at: at0 + atLen * dist[i] / (total || 1), d: d0 * (1 - fade * dist[i] / (total || 1)) }));
  }

  function build() {
    // Measure the page's own content, not the document: vines near the bottom can
    // hang past the end of it, and measuring them would make every rebuild taller.
    const height = Math.ceil(document.body.getBoundingClientRect().height), width = document.documentElement.clientWidth;
    const margin = Math.max(10, document.querySelector('.wrap').getBoundingClientRect().left);
    const key = `${width}x${height}x${innerHeight}`;
    if (key === built) return;
    built = key;
    parts = [];
    sprigs = [];
    svg.replaceChildren();
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    // Everything scales with the margin: full size from about 110px, and no
    // smaller than 60% on phones, where the vines still hang in the gaps between sections.
    const k = Math.max(0.6, Math.min(1, margin / 110));
    let g = el('g', {});
    svg.append(g);
    const rnd = random(7);
    const deg = r => r * 180 / Math.PI;
    const ivy = d => Math.max(0, Math.min(1, (d - 0.12) / 0.38));
    let flowering = null;           // for a vine in flower, how likely a bloom is, at most how many, and how far apart: { along, tip, left, gap }

    function leaf(x, y, angle, size, at, d) {
      const kind = rnd() < ivy(d) ? IVY : LEAF;
      const scale = kind === IVY ? size * 0.9 : size;
      const spot = el('g', { transform: `translate(${f(x)} ${f(y)}) rotate(${deg(angle) + 90 | 0}) scale(${f(scale)})` });
      // The outline is drawn at 1.2px when fully grown. (Not with non-scaling-stroke:
      // as a leaf folds away to nothing, that divides by its size and stalls Chrome.)
      const node = el('path', { d: kind, class: `vine-leaf${rnd() < 0.5 ? ' late' : ''}`, style: `stroke-width:${(1.2 / scale).toFixed(3)}` });
      spot.append(node);
      g.append(spot);
      parts.push({ el: node, kind: 'leaf', at });
    }

    // A small tendril: out from the tip, then a spiral that tightens as it curls.
    function tendril(x, y, heading, side, at, d) {
      const r = (4 + 7 * d) * k, turns = 1.3 + rnd() * 0.8;
      const normal = heading + side * Math.PI / 2;
      const ux = Math.cos(heading), uy = Math.sin(heading), nx = Math.cos(normal), ny = Math.sin(normal);
      const coil = [];
      for (let s = 0; s <= 24; s++) {
        const t = s / 24, reach = Math.min(1, t * 3), wind = Math.min(1, t * 4);
        const ang = t * turns * Math.PI * 2, rad = r * (1 - 0.82 * t) * wind;
        const along = r * 1.4 * reach + Math.sin(ang) * rad;
        const out = r * 0.8 * reach + (1 - Math.cos(ang)) * rad;
        coil.push({ x: x + ux * along + nx * out, y: y + uy * along + ny * out });
      }
      const path = el('path', { class: 'vine-tendril', d: smooth(coil) });
      g.append(path);
      parts.push({ el: path, kind: 'tendril', at });
    }

    function bloom(x, y, at, d) {
      const spot = el('g', { transform: `translate(${f(x)} ${f(y)})` });
      const flower = el('g', { class: 'vine-bloom' });
      const r = (3 + 3 * d) * k;
      for (let p = 0; p < 5; p++) {
        const ang = (p / 5) * Math.PI * 2;
        flower.append(el('circle', { cx: f(Math.cos(ang) * r), cy: f(Math.sin(ang) * r), r: f(r * 0.72) }));
      }
      flower.append(el('circle', { class: 'heart', cx: 0, cy: 0, r: f(r * 0.55) }));
      spot.append(flower);
      g.append(spot);
      parts.push({ el: flower, kind: 'bloom', at });
    }

    // Leaves along a track, alternating sides and leaning forward, smaller toward
    // the end; with `tip`, the end gets a small cluster like an ivy shoot's.
    const leafSize = d => (15 + 18 * d + rnd() * 6) * k;
    // Whether a bloom here would be far enough from the vine's others.
    function apart(p) {
      if (!flowering.gap) return true;
      if (flowering.spots.some(q => Math.hypot(q.x - p.x, q.y - p.y) < flowering.gap)) return false;
      flowering.spots.push(p);
      return true;
    }
    function foliage(track, { spacing, scale = 1, first = 20, tip = false }) {
      let walked = 0, next = first, side = rnd() < 0.5 ? -1 : 1, total = 0;
      for (let i = 1; i < track.length; i++) total += Math.hypot(track[i].x - track[i - 1].x, track[i].y - track[i - 1].y);
      for (let i = 1; i < track.length; i++) {
        const a = track[i - 1], b = track[i];
        const seg = Math.hypot(b.x - a.x, b.y - a.y);
        while (walked + seg >= next && next < total - (tip ? 14 : 0)) {
          const t = (next - walked) / seg, along = next / total;
          const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, d = a.d + (b.d - a.d) * t;
          const heading = Math.atan2(b.y - a.y, b.x - a.x);
          leaf(x, y, heading + side * (0.8 + rnd() * 0.45), leafSize(d) * scale * (1 - 0.35 * along), a.at + (b.at - a.at) * t, d);
          if (flowering && rnd() < flowering.along && flowering.left-- > 0) {
            // A flower just off the stem, on the side away from the leaf.
            const off = (6 + rnd() * 6) * k, normal = heading - side * Math.PI / 2;
            bloom(x + Math.cos(normal) * off, y + Math.sin(normal) * off, a.at + (b.at - a.at) * t + 20, Math.max(d, 0.7));
          }
          side = -side;
          next += spacing(d) * (0.75 + rnd() * 0.5);
        }
        walked += seg;
      }
      if (!tip) return;
      const end = track.at(-1), heading = headingAt(track, track.length - 1), size = leafSize(end.d) * scale * 0.85;
      leaf(end.x, end.y, heading, size, end.at, end.d);
      leaf(end.x, end.y, heading - 0.85 - rnd() * 0.3, size * 0.8, end.at + 6, end.d);
      if (rnd() < 0.6) leaf(end.x, end.y, heading + 0.85 + rnd() * 0.3, size * 0.7, end.at + 12, end.d);
      if (end.d > 0.3 && rnd() < 0.15 + 0.3 * end.d) tendril(end.x, end.y, heading + side * 0.6, side, end.at + 10, end.d);
      if (flowering ? rnd() < flowering.tip && apart(end) && flowering.left-- > 0 : end.d > 0.55 && rnd() < 0.35 * end.d) bloom(end.x, end.y, end.at + 20, Math.max(end.d, flowering ? 0.7 : 0));
    }

    // A shoot: from (x, y) heading `heading`, easing toward `aim`, kept in `box`.
    function walk(x, y, heading, len, aim, box, wander = 0.02) {
      const pts = [{ x, y }], step = 8;
      let drift = rnd() * 6;
      const edge = Math.min(30, (box.bottom - box.top) * 0.25), edgeX = Math.min(24, (box.right - box.left) * 0.25);
      for (let walked = 0; walked < len; walked += step) {
        heading += (aim - heading) * 0.06 + Math.sin(drift += 0.3) * wander;
        // Steer away from the box's edges before reaching them, and never cross them.
        const dx = Math.cos(heading), dy = Math.sin(heading);
        if (y < box.top + edge && dy < 0) heading += 0.2 * Math.sign(dx || 1);
        if (y > box.bottom - edge && dy > 0) heading -= 0.2 * Math.sign(dx || 1);
        if (x < box.left + edgeX && dx < 0) heading -= 0.2 * Math.sign(dy || 1);
        if (x > box.right - edgeX && dx > 0) heading += 0.2 * Math.sign(dy || 1);
        x = Math.max(box.left, Math.min(box.right, x + Math.cos(heading) * step));
        y = Math.max(box.top, Math.min(box.bottom, y + Math.sin(heading) * step));
        pts.push({ x, y });
      }
      return pts;
    }

    /**
     * Side shoots off a track, alternating sides and angled forward, curving back
     * toward the way their parent grows: an ivy's habit. Deeper shoots branch again.
     */
    function shoots(track, { box, spacing, len, width, levels, pace }) {
      let total = 0;
      const dist = track.map((p, i) => total += i ? Math.hypot(p.x - track[i - 1].x, p.y - track[i - 1].y) : 0);
      let side = rnd() < 0.5 ? -1 : 1;
      for (let s = total * (0.15 + rnd() * 0.1); s < total * 0.88; s += spacing(track[0].d) * (0.75 + rnd() * 0.5)) {
        const i = dist.findIndex(v => v >= s), p = track[i];
        const h = headingAt(track, i);
        const length = len(p.d) * (1 - 0.35 * s / total) * (0.7 + rnd() * 0.6);
        const raw = walk(p.x, p.y, h + side * (0.5 + rnd() * 0.35), length, h + side * 0.12, box);
        side = -side;
        if (raw.length < 4) continue;
        const shoot = timed(raw, p.at + 8, length * pace, p.d * 0.92);
        const base = width(p) * 0.55;
        stem(g, shoot, (q, t) => Math.max(0.6 * k, base * (1 - 0.65 * t)));
        foliage(shoot, { spacing: d => 58 - 18 * d, scale: 0.85, first: 16, tip: true });
        if (levels(p) > 1 && length > 55) {
          shoots(shoot, { box, spacing: () => length * 0.45, len: () => length * 0.42, width: () => base, levels: () => 1, pace });
        }
      }
    }

    // A second strand twining around a track, now one side of it, now the other,
    // emerging from it and merging back.
    function twine(track, { amp, period, from, to, phase = rnd() * 6 }) {
      let walked = 0;
      const out = [];
      track.forEach((p, i) => {
        if (i) walked += Math.hypot(p.x - track[i - 1].x, p.y - track[i - 1].y);
        const u = i / (track.length - 1);
        if (u < from || u > to) return;
        const env = Math.sin(Math.PI * (u - from) / (to - from)) ** 0.6;
        const off = amp(p) * env * Math.sin(walked / period * Math.PI * 2 + phase), n = headingAt(track, i) + Math.PI / 2;
        out.push({ x: p.x + Math.cos(n) * off, y: p.y + Math.sin(n) * off, at: p.at, d: p.d });
      });
      return out;
    }

    // A vine for each section, in the free space above its heading. Each comes in
    // from one side of the page, alternating, and hangs across it like a liana: one
    // or two sagging drapes, a second strand twining round it, a free end that
    // lifts and droops into a curl of leaves, and ivy shoots along the way. Each
    // is its own small drawing that floats a little ahead of the page as it
    // scrolls (FLOAT), so its room is trimmed by how far it can drift, and it
    // stays clear of the text above and below. The vines over the last three
    // sections come into flower: a bloom or two, then a few, then a few more.
    const top = 110, span = height - 150;
    const depth = y => Math.max(0, Math.min(1, (y - top) / span));
    const thickness = p => (1.2 + 3.2 * p.d ** 1.2) * k;
    const strandWidth = share => p => Math.max(0.7 * k, thickness(p) * share);
    const sections = [...document.querySelectorAll('main > section')].slice(1);
    let fromLeft = true;
    sections.forEach((section, index) => {
      // The free space: from the end of the previous section's content to this section's first text.
      const pageTop = node => node.getBoundingClientRect().top + scrollY;
      const pageBottom = node => node.getBoundingClientRect().bottom + scrollY;
      const firstText = section.querySelector('.wrap > *');
      const prev = section.previousElementSibling?.querySelector('.wrap');
      const lastPrev = prev ? [...prev.querySelectorAll('*')].reduce((m, n) => Math.max(m, pageBottom(n)), 0) : pageTop(section) - 60;
      const free = { top: lastPrev + 18 * k + 10, bottom: pageTop(firstText) - 16 * k - 8 };
      // Half the float on phones, where the gaps between sections are smaller.
      const float = still.matches ? 0 : (FLOAT - 1) * innerHeight / 2 * (width < 700 ? 0.5 : 1);
      const room = { top: free.top + float, bottom: free.bottom - float };
      const tall = room.bottom - room.top;
      flowering = [null, { along: 0, tip: 0.2, left: 2, gap: 200, spots: [] }, { along: 0, tip: 0.3, left: 5 }, { along: 0.08, tip: 0.45, left: 12 }][Math.max(0, index - sections.length + 4)];
      if (tall < 40) return;                                      // no room: no vine here
      const dir = fromLeft ? 1 : -1;
      fromLeft = !fromLeft;
      g = el('g', {});
      svg.append(g);
      const root = { x: dir > 0 ? -12 : width + 12, y: room.top + tall * (0.15 + rnd() * 0.25) };
      const d0 = depth(root.y);
      const reach = innerHeight * 0.55;                           // scrolling this far draws the whole vine
      const length = (width - margin * 0.4) * (width < 700 ? 0.7 + rnd() * 0.25 : 0.5 + rnd() * 0.3);   // most of the way across a phone

      // The drapes: sag between anchor points near the top of the room.
      const drapes = length > 560 ? 2 : 1;
      const anchors = [root];
      for (let j = 1; j <= drapes; j++) {
        anchors.push({ x: root.x + dir * length * (j / drapes) * (j < drapes ? 0.9 + rnd() * 0.2 : 1), y: room.top + tall * (0.08 + rnd() * 0.22) });
      }
      const pts = [];
      for (let j = 0; j < drapes; j++) {
        const a = anchors[j], b = anchors[j + 1];
        const sag = Math.min(tall * 0.62, 30 + Math.abs(b.x - a.x) * 0.12) * (0.75 + rnd() * 0.25), lean = 0.12 * (rnd() - 0.5);
        const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 9);
        for (let s = j ? 1 : 0; s <= n; s++) {
          const u = s / n, hang = Math.sin(Math.PI * u) ** 1.6 * (1 + lean * Math.sin(Math.PI * 2 * u));
          pts.push({ x: a.x + (b.x - a.x) * u, y: Math.min(room.bottom, a.y + (b.y - a.y) * u + sag * hang) });
        }
      }
      // The free end: lifts a little, then droops, ending in a curl of leaves.
      const end = pts.at(-1);
      let into = Math.atan2(end.y - pts.at(-3).y, end.x - pts.at(-3).x);
      if (dir < 0 && into < 0) into += Math.PI * 2;               // keep left-going headings near π
      const box = { left: 0, right: width, top: room.top, bottom: room.bottom };
      const droop = dir > 0 ? 0.35 : Math.PI - 0.35;
      pts.push(...walk(end.x, end.y, into - dir * 0.2, (60 + 60 * rnd()) * Math.max(0.5, k), droop, box, 0.03).slice(1));
      const vine = timed(pts, room.top - 10, reach, d0, 0.4);

      stem(g, vine, (p, t) => Math.max(0.8 * k, thickness(p) * 0.9 * (1 - 0.65 * t)));
      stem(g, twine(vine, { amp: p => (2.5 + 5 * p.d) * k, period: 150, from: 0.02, to: 0.8 }), strandWidth(0.42));
      foliage(vine, { spacing: d => 100 - 40 * d, first: 50, tip: true });
      shoots(vine, {
        box, spacing: d => 150 - 60 * d, len: d => (50 + 70 * d) * Math.max(0.5, k),
        width: p => thickness(p) * 0.8, levels: p => p.d > 0.35 ? 2 : 1, pace: reach / length * 1.4,
      });
      // Leaves and curls reach a little past the room.
      const pad = 70;
      sprigs.push({ g, float, top: room.top - float - pad, tall: tall + 2 * (float + pad) });
    });

    for (const p of parts) {
      if (p.kind === 'stem' || p.kind === 'tendril') {
        p.len = p.el.getTotalLength();
        p.el.style.strokeDasharray = `${p.len} ${p.len}`;
      }
    }

    // Each vine gets its own small SVG, which CSS floats as it crosses the screen.
    holder.replaceChildren();
    holder.style.height = `${height}px`;
    for (const sprig of sprigs) {
      const el = document.createElementNS(NS, 'svg');
      el.classList.add('vines');
      el.style.top = `${sprig.top}px`;
      el.setAttribute('width', width);
      el.setAttribute('height', sprig.tall);
      el.setAttribute('viewBox', `0 ${sprig.top} ${width} ${sprig.tall}`);
      el.style.setProperty('--float', `${sprig.float}px`);
      el.append(...sprig.g.children);
      holder.append(el);
      sprig.el = el;
    }
    svg.replaceChildren();
    svg.setAttribute('height', 0);
    grow(true);
  }

  // How far the vine has grown. Nothing until you scroll; then it quickly catches
  // up to just ahead of the bottom of the screen, and draws back as you scroll up.
  // Each leaf grows in or out with a CSS transition, and hundreds starting at once
  // (a fast scroll, a jump to a link) stall Chrome for seconds, so when a lot
  // changes at once it snaps into place instead.
  let snapping = 0;
  function grow(force) {
    const head = still.matches ? Infinity
      : scrollY <= 0 ? 0
      : scrollY + Math.min(innerHeight * 0.92, 40 + scrollY * 1.6);
    if (!timeline && !still.matches) {
      // Each vine floats from below its place to above it as it crosses the screen.
      for (const { el, float, top, tall } of sprigs) {
        const through = Math.max(0, Math.min(1, (scrollY + innerHeight - top) / (innerHeight + tall)));
        el.style.transform = `translateY(${float * (1 - 2 * through)}px)`;
      }
    }
    const changed = [];
    for (const p of parts) {
      if (p.kind === 'stem' || p.kind === 'tendril') {
        const t = p.kind === 'tendril' ? (head > p.at ? 1 : 0) : Math.max(0, Math.min(1, (head - p.at) / Math.max(1, p.at2 - p.at)));
        const offset = p.len * (1 - t);
        if (force || p.offset !== offset) changed.push(() => { p.el.style.strokeDashoffset = offset; p.offset = offset; });
      } else {
        const on = head > p.at;
        if (force || p.on !== on) changed.push(() => { p.el.classList.toggle('on', on); p.on = on; });
      }
    }
    if (changed.length > 40) {
      holder.classList.add('snap');
      clearTimeout(snapping);
      snapping = setTimeout(() => holder.classList.remove('snap'), 100);
    }
    for (const change of changed) change();
  }

  let ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; grow(); });
  }, { passive: true });
  let resize;
  const rebuild = () => { clearTimeout(resize); resize = setTimeout(build, 150); };
  addEventListener('resize', rebuild);
  new ResizeObserver(rebuild).observe(document.body);
  still.addEventListener?.('change', () => { built = ''; build(); });
  if (document.readyState === 'complete') build(); else addEventListener('load', build);
})();
