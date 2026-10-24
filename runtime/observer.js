// Injected into every sprout by the greenhouse. Watches how the tool is used
// and sends batches to the greenhouse frame. Never records what people type,
// only which field they used.
(function () {
  if (window.parent === window) return;

  var parent = window.parent;
  var queue = [];
  var lastClick = { key: '', times: [] };
  var lastActivity = 0;

  function post(msg) {
    msg.source = 'sprout-observer';
    parent.postMessage(msg, '*');
  }

  function now() { return Date.now(); }

  function describe(el) {
    if (!el || el.nodeType !== 1) return null;
    var tagged = el.closest('[data-sprout-id]');
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node !== document.body && parts.length < 5) {
      var part = node.tagName.toLowerCase();
      if (node.getAttribute('data-sprout-id')) part += '[' + node.getAttribute('data-sprout-id') + ']';
      parts.unshift(part);
      node = node.parentElement;
    }
    var text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ');
    return {
      sproutId: tagged ? tagged.getAttribute('data-sprout-id') : null,
      path: parts.join(' > '),
      tag: el.tagName.toLowerCase(),
      text: text.slice(0, 80),
    };
  }

  function record(kind, target, detail) {
    queue.push({ kind: kind, ts: now(), target: target || null, detail: detail || null });
    if (queue.length > 50) flush();
  }

  function flush() {
    if (!queue.length) return;
    post({ type: 'events', events: queue.splice(0) });
  }
  setInterval(flush, 2000);
  window.addEventListener('pagehide', flush);

  function activity() {
    var t = now();
    if (t - lastActivity < 3000) return;
    lastActivity = t;
    post({ type: 'activity', ts: t });
  }
  ['pointerdown', 'keydown', 'wheel'].forEach(function (name) {
    window.addEventListener(name, activity, { passive: true, capture: true });
  });

  // ---- usage ----
  document.addEventListener('click', function (e) {
    if (pointing) return;
    var target = describe(e.target);
    record('click', target);
    var key = target ? (target.sproutId || target.path) : '';
    var t = now();
    if (key === lastClick.key) {
      lastClick.times = lastClick.times.filter(function (x) { return t - x < 800; });
      lastClick.times.push(t);
      if (lastClick.times.length === 3) record('rage', target);
    } else {
      lastClick = { key: key, times: [t] };
    }
  }, true);

  document.addEventListener('change', function (e) {
    record('input', describe(e.target));
  }, true);

  document.addEventListener('submit', function (e) {
    record('submit', describe(e.target));
  }, true);

  function nav() { record('nav', null, { path: location.pathname + location.hash }); }
  var push = history.pushState;
  history.pushState = function () { push.apply(this, arguments); nav(); };
  window.addEventListener('popstate', nav);
  window.addEventListener('hashchange', nav);
  nav();

  // ---- problems ----
  window.addEventListener('error', function (e) {
    record('error', null, { message: String(e.message || 'error').slice(0, 500), file: e.filename, line: e.lineno });
    flush();
  });
  window.addEventListener('unhandledrejection', function (e) {
    var reason = e.reason && (e.reason.message || String(e.reason));
    record('error', null, { message: String(reason || 'unhandled rejection').slice(0, 500) });
    flush();
  });
  var origError = console.error;
  console.error = function () {
    try {
      var text = Array.prototype.map.call(arguments, function (a) { return a && a.message ? a.message : String(a); }).join(' ');
      record('console_error', null, { message: text.slice(0, 500) });
    } catch (_) {}
    return origError.apply(console, arguments);
  };
  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var isApi = url.indexOf('/api') === 0 || url.indexOf(location.origin + '/api') === 0;
    var p = origFetch.apply(this, arguments);
    if (!isApi) return p;
    var method = (init && init.method) || 'GET';
    return p.then(function (res) {
      if (!res.ok) record('api_error', null, { method: method, url: url, status: res.status });
      return res;
    }, function (err) {
      record('api_error', null, { method: method, url: url, message: String(err && err.message) });
      throw err;
    });
  };

  // ---- point mode: the user picks something to talk about ----
  var pointing = false;
  var box = null;
  var hovered = null;

  function pickable(el) {
    if (!el || el.nodeType !== 1) return null;
    return el.closest('[data-sprout-id]') || el;
  }

  function startPoint() {
    if (pointing) return;
    pointing = true;
    box = document.createElement('div');
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px dashed #2F6B45;background:rgba(47,107,69,.08);border-radius:8px;transition:all .08s;display:none';
    document.body.appendChild(box);
    document.documentElement.style.cursor = 'crosshair';
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onPick, true);
    document.addEventListener('keydown', onKey, true);
  }

  function stopPoint() {
    if (!pointing) return;
    pointing = false;
    if (box) box.remove();
    box = null;
    hovered = null;
    document.documentElement.style.cursor = '';
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onPick, true);
    document.removeEventListener('keydown', onKey, true);
  }

  function onMove(e) {
    var el = pickable(e.target);
    if (!el || el === hovered) return;
    hovered = el;
    var r = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = (r.left - 4) + 'px';
    box.style.top = (r.top - 4) + 'px';
    box.style.width = (r.width + 8) + 'px';
    box.style.height = (r.height + 8) + 'px';
  }

  function onPick(e) {
    e.preventDefault();
    e.stopPropagation();
    var el = pickable(e.target);
    var info = describe(el);
    var r = el.getBoundingClientRect();
    info.rect = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    stopPoint();
    post({ type: 'point:result', target: info });
  }

  function onKey(e) {
    if (e.key === 'Escape') { stopPoint(); post({ type: 'point:cancel' }); }
  }

  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (!msg || msg.source !== 'greenhouse') return;
    if (msg.type === 'point:start') startPoint();
    if (msg.type === 'point:stop') stopPoint();
  });

  post({ type: 'hello' });
})();
