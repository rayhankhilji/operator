/**
 * The perception script.
 *
 * This source is evaluated inside the target page on every observation. It is
 * written as a plain string rather than an imported module for one reason:
 * it must be self-contained, since nothing from our bundle exists in the page.
 *
 * It deliberately contains no backticks and no `${`, so it can live inside a
 * template literal without escaping games.
 *
 * What it produces is a `PageMap`: a compact semantic tree of everything a
 * human could see and act on, plus the obstacles that need a human.
 */
export const PERCEPTION_SCRIPT = `
(function () {
  var NS = '__operator__';
  if (!window[NS]) window[NS] = { version: 0, els: [] };
  var OP = window[NS];

  // -- small helpers --------------------------------------------------------

  function clean(s) {
    return (s || '').replace(/\\s+/g, ' ').trim();
  }

  function truncate(s, n) {
    s = clean(s);
    return s.length > n ? s.slice(0, n - 1) + '\\u2026' : s;
  }

  function style(el) {
    try { return window.getComputedStyle(el); } catch (e) { return null; }
  }

  /** Visible means: has area, is not hidden, and is not fully transparent. */
  function isVisible(el, rect) {
    if (!rect) rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    var cs = style(el);
    if (!cs) return false;
    if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
    if (cs.display === 'none') return false;
    if (parseFloat(cs.opacity || '1') < 0.05) return false;
    if (el.hasAttribute && el.hasAttribute('inert')) return false;
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
    return true;
  }

  function inViewport(rect) {
    var vw = window.innerWidth, vh = window.innerHeight;
    return rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw;
  }

  // -- accessible name ------------------------------------------------------

  function labelFor(el) {
    var out = '';
    if (el.id) {
      try {
        var labels = document.querySelectorAll('label[for="' + CSS.escape(el.id) + '"]');
        for (var i = 0; i < labels.length; i++) out += ' ' + labels[i].innerText;
      } catch (e) {}
    }
    var p = el.closest && el.closest('label');
    if (p) out += ' ' + p.innerText;
    return clean(out);
  }

  function refNames(el) {
    var ids = clean(el.getAttribute('aria-labelledby'));
    if (!ids) return '';
    var out = '';
    var parts = ids.split(' ');
    for (var i = 0; i < parts.length; i++) {
      var n = document.getElementById(parts[i]);
      if (n) out += ' ' + n.innerText;
    }
    return clean(out);
  }

  /**
   * A pragmatic subset of the accname algorithm. Full spec compliance is not
   * the goal; matching what a human would call the control is.
   */
  function accessibleName(el) {
    var tag = el.tagName.toLowerCase();
    var candidates = [
      refNames(el),
      clean(el.getAttribute('aria-label')),
      labelFor(el),
      tag === 'input' || tag === 'textarea' ? clean(el.getAttribute('placeholder')) : '',
      tag === 'img' ? clean(el.getAttribute('alt')) : '',
      clean(el.getAttribute('title')),
      tag === 'input' && (el.type === 'submit' || el.type === 'button' || el.type === 'reset')
        ? clean(el.value) : '',
      clean(el.innerText || el.textContent),
      clean(el.getAttribute('name'))
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i]) return truncate(candidates[i], 160);
    }
    return '';
  }

  // -- sensitivity ----------------------------------------------------------

  var SENSITIVE_PATTERNS = [
    ['password',     /pass(word|wd)|passcode/i],
    ['card-number',  /(card|cc)[-_ ]?(number|num|no)\\b|creditcard|cardnumber|pan\\b/i],
    ['card-cvc',     /cvc|cvv|csc|security[-_ ]?code|card[-_ ]?code/i],
    ['card-expiry',  /exp(iry|iration)?[-_ ]?(date|month|year|mm|yy)?\\b/i],
    ['government-id',/ssn|social[-_ ]?security|passport|national[-_ ]?id|tax[-_ ]?id|nino\\b/i],
    ['bank-account', /iban|routing|account[-_ ]?number|sort[-_ ]?code|swift|bic\\b/i],
    ['one-time-code',/\\botp\\b|one[-_ ]?time|verification[-_ ]?code|2fa|auth(entication)?[-_ ]?code/i]
  ];

  var AUTOCOMPLETE_MAP = {
    'cc-number': 'card-number',
    'cc-csc': 'card-cvc',
    'cc-exp': 'card-expiry',
    'cc-exp-month': 'card-expiry',
    'cc-exp-year': 'card-expiry',
    'current-password': 'password',
    'new-password': 'password',
    'one-time-code': 'one-time-code'
  };

  function sensitivityOf(el) {
    var tag = el.tagName.toLowerCase();
    if (tag !== 'input' && tag !== 'textarea' && !el.isContentEditable) return null;
    if (el.type === 'password') return 'password';

    var ac = clean(el.getAttribute('autocomplete')).toLowerCase();
    if (ac) {
      var tokens = ac.split(/\\s+/);
      for (var t = 0; t < tokens.length; t++) {
        if (AUTOCOMPLETE_MAP[tokens[t]]) return AUTOCOMPLETE_MAP[tokens[t]];
      }
    }

    // Anything a human would recognise as a secret by its labelling.
    var haystack = [
      el.getAttribute('name'), el.id, el.getAttribute('placeholder'),
      el.getAttribute('aria-label'), labelFor(el), el.className
    ].join(' ');
    for (var i = 0; i < SENSITIVE_PATTERNS.length; i++) {
      if (SENSITIVE_PATTERNS[i][1].test(haystack)) return SENSITIVE_PATTERNS[i][0];
    }
    return null;
  }

  // -- roles ----------------------------------------------------------------

  var EXPLICIT_ROLES = {
    button: 'button', link: 'link', textbox: 'textbox', searchbox: 'textbox',
    combobox: 'combobox', listbox: 'combobox', checkbox: 'checkbox',
    radio: 'radio', slider: 'slider', tab: 'tab', menuitem: 'menuitem',
    option: 'option', heading: 'heading', img: 'image', dialog: 'dialog',
    alertdialog: 'dialog', table: 'table', grid: 'table', list: 'list',
    form: 'form', region: 'region', search: 'form'
  };

  function roleOf(el) {
    var explicit = clean(el.getAttribute('role')).toLowerCase();
    if (explicit && EXPLICIT_ROLES[explicit]) return EXPLICIT_ROLES[explicit];

    var tag = el.tagName.toLowerCase();
    switch (tag) {
      case 'a': return el.hasAttribute('href') ? 'link' : null;
      case 'button': return 'button';
      case 'select': return 'combobox';
      case 'textarea': return 'textbox';
      case 'img': return clean(el.getAttribute('alt')) ? 'image' : null;
      case 'iframe': return 'iframe';
      case 'dialog': return 'dialog';
      case 'form': return 'form';
      case 'table': return 'table';
      case 'ul': case 'ol': return 'list';
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading';
      case 'summary': return 'button';
      case 'option': return 'option';
      case 'input': {
        var t = (el.type || 'text').toLowerCase();
        if (t === 'hidden') return null;
        if (t === 'checkbox') return 'checkbox';
        if (t === 'radio') return 'radio';
        if (t === 'range') return 'slider';
        if (t === 'submit' || t === 'button' || t === 'reset' || t === 'image') return 'button';
        return 'textbox';
      }
    }

    if (el.isContentEditable) return 'textbox';

    // Undeclared controls: divs and spans wired up with handlers. Very common.
    if (el.hasAttribute('onclick') || el.tabIndex >= 0) {
      var cs = style(el);
      if (cs && cs.cursor === 'pointer') return 'button';
    }
    return null;
  }

  var INTERACTIVE = {
    link: 1, button: 1, textbox: 1, combobox: 1, checkbox: 1,
    radio: 1, slider: 1, tab: 1, menuitem: 1, option: 1
  };

  // -- obstacles ------------------------------------------------------------

  var CAPTCHA_HOSTS = /recaptcha|hcaptcha|turnstile|arkoselabs|funcaptcha|geetest|datadome|perimeterx/i;

  function detectObstacles(nodes) {
    var found = [];
    var seen = {};

    function push(kind, detail, evidence, ref) {
      if (seen[kind]) return;
      seen[kind] = 1;
      found.push({ kind: kind, detail: detail, evidence: evidence, ref: ref });
    }

    // CAPTCHA: third-party challenge frames and their well-known containers.
    var frames = document.querySelectorAll('iframe');
    for (var i = 0; i < frames.length; i++) {
      var src = frames[i].getAttribute('src') || '';
      var titleAttr = frames[i].getAttribute('title') || '';
      if (CAPTCHA_HOSTS.test(src) || /captcha|challenge/i.test(titleAttr)) {
        push('captcha', 'A CAPTCHA challenge is embedded in this page.',
             ['iframe: ' + truncate(src || titleAttr, 120)]);
      }
    }
    var boxes = document.querySelectorAll(
      '.g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey], #captcha, [id*="captcha" i]'
    );
    if (boxes.length) {
      push('captcha', 'A CAPTCHA widget is present on this page.',
           ['selector match: ' + truncate(boxes[0].className || boxes[0].id, 120)]);
    }

    var bodyText = clean(document.body ? document.body.innerText : '').slice(0, 6000);
    if (/i'?m not a robot|verify you are human|are you a robot|security check/i.test(bodyText)) {
      push('captcha', 'The page is asking the visitor to prove they are human.',
           ['page text contains a human-verification prompt']);
    }

    // Credentials, cards, and one-time codes, straight from the field scan.
    for (var n = 0; n < nodes.length; n++) {
      var node = nodes[n];
      if (!node.sensitive) continue;
      if (node.sensitive === 'password') {
        push('login', 'This page has a password field, so it is a sign-in step.',
             ['field: ' + (node.name || 'password input')], node.ref);
      } else if (node.sensitive === 'one-time-code') {
        push('two-factor', 'This page is asking for a one-time verification code.',
             ['field: ' + (node.name || 'code input')], node.ref);
      } else if (node.sensitive === 'card-number' || node.sensitive === 'card-cvc') {
        push('payment', 'This page is asking for payment card details.',
             ['field: ' + (node.name || node.sensitive)], node.ref);
      }
    }

    // Cookie and consent walls, which block interaction until answered.
    var consent = document.querySelector(
      '[id*="cookie" i][class*="banner" i], [class*="cookie-consent" i], [id*="onetrust" i], [class*="cmp-" i][role="dialog"]'
    );
    if (consent && isVisible(consent)) {
      push('consent', 'A cookie or consent banner is covering the page.',
           ['element: ' + truncate(consent.id || consent.className, 120)]);
    }

    return found;
  }

  // -- the walk -------------------------------------------------------------

  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, HEAD: 1, META: 1, LINK: 1, SVG: 1, PATH: 1 };

  function capture(opts) {
    opts = opts || {};
    var maxNodes = opts.maxNodes || 1200;

    OP.version = (OP.version || 0) + 1;
    OP.els = [];

    var nodes = [];
    var roots = [];
    var truncated = false;

    function add(el, role, parentChildren) {
      if (nodes.length >= maxNodes) { truncated = true; return null; }
      var rect = el.getBoundingClientRect();
      var idx = nodes.length;
      var ref = 'e' + idx;
      OP.els[idx] = el;
      try { el.setAttribute('data-op-ref', ref); } catch (e) {}

      var sensitive = sensitivityOf(el);
      var node = {
        ref: ref,
        role: role,
        name: accessibleName(el),
        box: {
          x: Math.round(rect.left), y: Math.round(rect.top),
          w: Math.round(rect.width), h: Math.round(rect.height)
        },
        inViewport: inViewport(rect)
      };

      if (sensitive) {
        node.sensitive = sensitive;
        // The value of a secret field is never read, not even to report length.
      } else if (el.value !== undefined && typeof el.value === 'string') {
        var v = truncate(el.value, 100);
        if (v) node.value = v;
      } else if (el.isContentEditable) {
        var ce = truncate(el.innerText, 100);
        if (ce) node.value = ce;
      }

      var tag = el.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea') node.inputType = (el.type || 'text').toLowerCase();
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') node.disabled = true;
      if (el.required || el.getAttribute('aria-required') === 'true') node.required = true;
      if (role === 'checkbox' || role === 'radio') {
        node.checked = el.checked !== undefined
          ? !!el.checked
          : el.getAttribute('aria-checked') === 'true';
      }
      var exp = el.getAttribute('aria-expanded');
      if (exp === 'true' || exp === 'false') node.expanded = exp === 'true';
      if (role === 'heading') {
        node.level = /^h[1-6]$/.test(tag) ? parseInt(tag.slice(1), 10)
          : parseInt(el.getAttribute('aria-level') || '2', 10);
      }

      nodes.push(node);
      if (parentChildren) parentChildren.push(idx);
      else roots.push(idx);
      return idx;
    }

    function walk(el, parentChildren, depth) {
      if (!el || depth > 60 || nodes.length >= maxNodes) return;
      if (el.nodeType !== 1 || SKIP_TAGS[el.tagName]) return;

      var rect = el.getBoundingClientRect();
      var visible = isVisible(el, rect);

      // An invisible container may still hold visible children (transforms,
      // clipping). Only prune when the element itself is display:none-like.
      var cs = style(el);
      var hardHidden = !cs || cs.display === 'none' || cs.visibility === 'hidden';

      var idx = null;
      if (visible) {
        var role = roleOf(el);

        if (role && INTERACTIVE[role]) {
          idx = add(el, role, parentChildren);
        } else if (role === 'heading') {
          idx = add(el, role, parentChildren);
        } else if (role === 'iframe') {
          idx = add(el, role, parentChildren);
        } else if (role === 'dialog' || role === 'form' || role === 'table') {
          idx = add(el, role, parentChildren);
        } else if (isLeafText(el)) {
          // Text that carries meaning but is not a control.
          var txt = truncate(el.innerText, 200);
          if (txt.length > 1) idx = add(el, 'text', parentChildren);
        }
      }

      if (hardHidden) return;

      var childList = idx !== null ? (nodes[idx].children = nodes[idx].children || []) : parentChildren;
      var kids = el.children;
      for (var i = 0; i < kids.length; i++) walk(kids[i], childList, depth + 1);

      // Shadow DOM: extremely common in modern component libraries, and
      // invisible to a naive querySelectorAll. Operator sees through it.
      if (el.shadowRoot) {
        var sk = el.shadowRoot.children;
        for (var j = 0; j < sk.length; j++) walk(sk[j], childList, depth + 1);
      }
    }

    /** True when the element's text is its own, not merely inherited from kids. */
    function isLeafText(el) {
      if (!el.childNodes || !el.childNodes.length) return false;
      var own = '';
      for (var i = 0; i < el.childNodes.length; i++) {
        var c = el.childNodes[i];
        if (c.nodeType === 3) own += c.nodeValue;
      }
      return clean(own).length > 1;
    }

    if (document.body) walk(document.body, null, 0);

    var obstacles = detectObstacles(nodes);

    var pageText = '';
    try {
      pageText = truncate(document.body ? document.body.innerText : '', 8000);
    } catch (e) {}

    return {
      url: location.href,
      title: document.title || '',
      version: OP.version,
      capturedAt: Date.now(),
      viewport: {
        w: window.innerWidth, h: window.innerHeight,
        scrollX: Math.round(window.scrollX), scrollY: Math.round(window.scrollY),
        scrollH: Math.round(document.documentElement.scrollHeight)
      },
      nodes: nodes,
      roots: roots,
      text: pageText,
      obstacles: obstacles,
      busy: document.readyState !== 'complete',
      truncated: truncated
    };
  }

  // -- the API the driver calls --------------------------------------------

  OP.capture = capture;

  OP.el = function (ref) {
    var i = parseInt(String(ref).replace(/^e/, ''), 10);
    return OP.els[i] || null;
  };

  /** Resolve a ref to a fresh, click-ready point, scrolling it into view. */
  OP.locate = function (ref) {
    var el = OP.el(ref);
    if (!el) return { ok: false, error: 'ref ' + ref + ' is no longer on the page' };
    if (!el.isConnected) return { ok: false, error: 'element ' + ref + ' was removed from the DOM' };

    try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch (e) {
      try { el.scrollIntoView(); } catch (e2) {}
    }

    var rect = el.getBoundingClientRect();
    if (!isVisible(el, rect)) return { ok: false, error: 'element ' + ref + ' is not visible' };

    var x = rect.left + rect.width / 2;
    var y = rect.top + rect.height / 2;

    // Guard against clicking through an overlay: if the topmost element at the
    // centre is unrelated, try a few offsets before giving up.
    var candidates = [[x, y], [rect.left + 4, y], [rect.right - 4, y], [x, rect.top + 4]];
    for (var i = 0; i < candidates.length; i++) {
      var cx = candidates[i][0], cy = candidates[i][1];
      if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) continue;
      var top = document.elementFromPoint(cx, cy);
      if (top && (top === el || el.contains(top) || top.contains(el))) {
        return { ok: true, x: Math.round(cx), y: Math.round(cy),
                 box: { x: rect.left, y: rect.top, w: rect.width, h: rect.height } };
      }
    }
    var blocker = document.elementFromPoint(x, y);
    return {
      ok: false,
      error: 'element ' + ref + ' is covered by ' +
             (blocker ? '<' + blocker.tagName.toLowerCase() +
               (blocker.className && typeof blocker.className === 'string'
                 ? ' class="' + truncate(blocker.className, 40) + '"' : '') + '>'
              : 'another element')
    };
  };

  /** Focus a field and clear it, ready for real key events from the driver. */
  OP.prepareInput = function (ref, clearFirst) {
    var el = OP.el(ref);
    if (!el) return { ok: false, error: 'unknown ref ' + ref };
    try { el.focus(); } catch (e) {}
    if (document.activeElement !== el) {
      return { ok: false, error: 'could not focus ' + ref };
    }
    if (clearFirst) {
      if (el.value !== undefined) {
        var setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value');
        if (setter && setter.set) setter.set.call(el, '');
        else el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (el.isContentEditable) {
        el.textContent = '';
      }
    }
    return { ok: true };
  };

  /** Set a <select> to a value or visible label, firing the events frameworks expect. */
  OP.selectOption = function (ref, wanted) {
    var el = OP.el(ref);
    if (!el || el.tagName.toLowerCase() !== 'select') {
      return { ok: false, error: 'ref ' + ref + ' is not a <select>' };
    }
    var target = String(wanted).toLowerCase();
    for (var i = 0; i < el.options.length; i++) {
      var o = el.options[i];
      if (String(o.value).toLowerCase() === target || clean(o.text).toLowerCase() === target) {
        el.selectedIndex = i;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, chose: clean(o.text) };
      }
    }
    var available = [];
    for (var j = 0; j < Math.min(el.options.length, 25); j++) available.push(clean(el.options[j].text));
    return { ok: false, error: 'no option matched "' + wanted + '"', options: available };
  };

  /** Read the current value of a non-sensitive field, for verification. */
  OP.readValue = function (ref) {
    var el = OP.el(ref);
    if (!el) return { ok: false, error: 'unknown ref ' + ref };
    if (sensitivityOf(el)) return { ok: true, value: null, sensitive: true };
    return { ok: true, value: el.value !== undefined ? el.value : clean(el.innerText) };
  };

  return true;
})();
`;

/**
 * Installs the perception API, then captures. Kept separate so the driver can
 * re-install cheaply after a navigation without paying for a capture.
 */
export const CAPTURE_EXPR = `(function(){ ${PERCEPTION_SCRIPT}; return JSON.stringify(window.__operator__.capture({ maxNodes: MAX_NODES })); })()`;

export function captureExpression(maxNodes = 1200): string {
  return CAPTURE_EXPR.replace('MAX_NODES', String(maxNodes));
}

/** Builds an expression that calls one of the installed helpers. */
export function callExpression(method: string, args: unknown[] = []): string {
  const payload = JSON.stringify(args);
  return `(function(){ ${PERCEPTION_SCRIPT}; return JSON.stringify(window.__operator__[${JSON.stringify(
    method,
  )}].apply(null, ${payload})); })()`;
}
