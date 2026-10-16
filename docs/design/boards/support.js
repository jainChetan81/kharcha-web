// support.js · a small stand-in for the design canvas runtime, written for this handoff.
// It renders one board so it can be opened outside the canvas. Serve the folder over http
// (for example `npx serve docs/design/boards`) and open any `Name.dc.html`; browsers block
// the fetches it needs for <dc-import> when a file is opened straight from disk.
// It covers what these boards use: {{holes}}, <sc-for>, <sc-if>, <dc-import>, DCLogic state and
// boolean props. Do not ship it in the app; port the markup to React instead.
(function () {
  const hide = document.createElement('style');
  hide.textContent = 'x-dc{display:none}';
  (document.head || document.documentElement).appendChild(hide);
  const SRC = {}; // name -> html source
  const parsed = {};
  function parse(name) {
    if (parsed[name]) return parsed[name];
    const doc = new DOMParser().parseFromString(SRC[name], 'text/html');
    const x = doc.querySelector('x-dc');
    const helmet = x.querySelector('helmet');
    let head = '';
    if (helmet) { head = helmet.innerHTML; helmet.remove(); }
    const tpl = document.createElement('template');
    tpl.innerHTML = x.innerHTML;
    const sc = doc.querySelector('script[data-dc-script]');
    let props = {};
    try { const p = JSON.parse(sc.getAttribute('data-props') || '{}'); for (const k in p) if (k[0] !== '$' && p[k] && 'default' in p[k]) props[k] = p[k].default; } catch (e) {}
    const Comp = new Function('DCLogic', sc.textContent + '\n;return Component;')(DCLogic);
    return (parsed[name] = { tpl, head, Comp, props });
  }
  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState(p) { this.state = Object.assign({}, this.state, typeof p === 'function' ? p(this.state) : p); schedule(); }
  }
  window.DCLogic = DCLogic;
  let pending = false;
  function schedule() { if (pending) return; pending = true; Promise.resolve().then(() => { pending = false; draw(); }); }
  function lookup(expr, scope) {
    expr = expr.trim();
    if (expr === 'true') return true; if (expr === 'false') return false; if (expr === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
    if (/^'.*'$/.test(expr)) return expr.slice(1, -1);
    let v = scope; for (const part of expr.split('.')) { if (v == null) return undefined; v = v[part]; }
    return v;
  }
  const HOLE = /\{\{([^}]*)\}\}/g;
  function interp(str, scope) { return str.replace(HOLE, (_, e) => { const v = lookup(e, scope); return v == null ? '' : String(v); }); }
  function single(str) { const m = str.match(/^\s*\{\{([^}]*)\}\}\s*$/); return m ? m[1] : null; }
  const instances = new WeakMap();
  function renderChildren(node, scope, out) { for (const c of node.childNodes) renderNode(c, scope, out); }
  function renderNode(n, scope, out) {
    if (n.nodeType === 3) { out.appendChild(document.createTextNode(interp(n.nodeValue, scope))); return; }
    if (n.nodeType !== 1) return;
    const tag = n.localName;
    if (tag === 'sc-for') {
      const list = lookup(single(n.getAttribute('list')), scope) || [];
      const as = n.getAttribute('as');
      list.forEach((item, i) => { const s = Object.create(scope); s[as] = item; s.$index = i; renderChildren(n, s, out); });
      return;
    }
    if (tag === 'sc-if') { if (lookup(single(n.getAttribute('value')), scope)) renderChildren(n, scope, out); return; }
    if (tag === 'dc-import') {
      const name = n.getAttribute('name');
      const p = {};
      for (const a of n.attributes) { if (a.name === 'name' || a.name.startsWith('hint-')) continue; const h = single(a.value); p[a.name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = h != null ? lookup(h, scope) : a.value; }
      let inst = instances.get(n);
      const b = parse(name);
      if (!inst) { inst = new b.Comp(Object.assign({}, b.props, p)); instances.set(n, inst); } else inst.props = Object.assign({}, b.props, p);
      renderBoard(b, inst, out);
      return;
    }
    const el = document.createElementNS(n.namespaceURI, n.localName);
    for (const a of n.attributes) {
      const h = single(a.value);
      if (/^on[A-Z]/.test(a.name) || /^on[a-z]/.test(a.name) && h) {
        const fn = h != null ? lookup(h, scope) : null;
        if (typeof fn === 'function') {
          let ev = a.name.slice(2).toLowerCase();
          if (ev === 'change' && (n.localName === 'input' || n.localName === 'textarea')) ev = 'input';
          if (ev === 'mouseenter') ev = 'mouseenter';
          el.addEventListener(ev, fn);
        }
        continue;
      }
      if (h != null) {
        const v = lookup(h, scope);
        if (v === false || v == null) { if (a.name === 'checked' || a.name === 'disabled' || a.name === 'hidden' || a.name === 'selected') continue; }
        if (a.name === 'value') { el.value = v == null ? '' : v; }
        el.setAttribute(a.name, v == null ? '' : String(v));
      } else el.setAttribute(a.name, interp(a.value, scope));
    }
    renderChildren(n.content || n, scope, el);
    out.appendChild(el);
  }
  function renderBoard(b, inst, out) {
    const vals = inst.renderVals ? inst.renderVals() : {};
    const scope = Object.assign({}, vals);
    renderChildren(b.tpl.content, scope, out);
  }
  let rootBoard, rootInst, rootEl;
  function draw() {
    const frag = document.createDocumentFragment();
    renderBoard(rootBoard, rootInst, frag);
    rootEl.replaceChildren(frag);
  }
  async function load(name, html) {
    if (SRC[name]) return;
    SRC[name] = html;
    for (const m of html.matchAll(/<dc-import name="([^"]+)"/g)) {
      if (SRC[m[1]]) continue;
      const res = await fetch('./' + m[1] + '.dc.html');
      if (!res.ok) throw new Error('Could not load ' + m[1] + '.dc.html');
      await load(m[1], await res.text());
    }
  }
  async function boot() {
    const self = (location.pathname.split('/').pop() || '').replace(/\.dc\.html$/, '') || 'board';
    const x = document.querySelector('x-dc');
    if (!x) return;
    const html = '<!doctype html>' + document.documentElement.outerHTML;
    x.style.display = 'none';
    try { await load(self, html); } catch (e) {
      x.remove();
      document.body.insertAdjacentHTML('beforeend', '<p style="font: 15px system-ui; padding: 24px">' + e.message + '. Serve this folder over http, for example <code>npx serve</code>.</p>');
      return;
    }
    rootBoard = parse(self);
    const heads = new Set(Object.keys(SRC).map((k) => parse(k).head));
    document.head.insertAdjacentHTML('beforeend', [...heads].join('\n'));
    x.remove();
    rootEl = document.createElement('div');
    document.body.appendChild(rootEl);
    rootInst = new rootBoard.Comp(Object.assign({}, rootBoard.props));
    draw();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
