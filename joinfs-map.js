(function () {
  'use strict';

  // -- Leaflet loader � shared promise so CSS+JS are fetched only once -------
  let _leafletPromise = null;
  function loadLeaflet() {
    if (_leafletPromise) return _leafletPromise;
    _leafletPromise = Promise.all([
      import('https://esm.sh/leaflet@1.9.4'),
      fetch('https://esm.sh/leaflet@1.9.4/dist/leaflet.css').then(r => r.text())
    ]).then(([mod, css]) => ({ L: mod.default, css }));
    return _leafletPromise;
  }

  // -- Tile layer URLs -------------------------------------------------------
  const TILES = {
    light: {
      url:         'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom:     19,
    },
    dark: {
      url:         'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors � <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom:     20,
      subdomains:  'abcd',
    },
  };

  // -- CSS injected into shadow root when dark mode is active ----------------
  const DARK_POPUP_CSS = `
    .leaflet-popup-content-wrapper,
    .leaflet-popup-tip {
      background: #1e2433;
      color: #e2e8f0;
      box-shadow: 0 3px 14px rgba(0,0,0,.7);
    }
    .leaflet-popup-close-button { color: #94a3b8 !important; }
    .leaflet-bar a {
      background-color: #1e2433 !important;
      color: #e2e8f0 !important;
      border-color: #374151 !important;
    }
    .leaflet-bar a:hover { background-color: #2d3748 !important; }
    .leaflet-control-attribution {
      background: rgba(30,36,51,.85) !important;
      color: #64748b !important;
    }
    .leaflet-control-attribution a { color: #60a5fa !important; }`;

  // -- Normalise MSFS locPak key ? plain ICAO designator --------------------
  // "ATCCOM.AC_MODEL_B738.0.tts" ? "B738"   (suffixed)
  // "ATCCOM.AC_MODEL_A350"       ? "A350"    (bare)
  // "B738"                       ? "B738"    (already plain)
  function normalizeType(icaoType) {
    if (!icaoType) return '';
    return icaoType
      .replace(/^ATCCOM\.AC_MODEL(_| )(.+?)(?:\.\d+\.(?:tts|text))?$/, '$2')
      .toUpperCase().trim();
  }

  // -- Aircraft type classification from ICAO designator --------------------
  function classifyType(icaoType) {
    if (!icaoType) return 'generic';
    const t = normalizeType(icaoType);

    const heliExact = ['EC35','EC45','EC55','EC65','EC75','EC25','R22','R44','R66',
      'B06','B07','B206','B407','B412','B429','B505','H125','H130','H135','H145',
      'H155','H160','H175','H215','H225','A109','A119','A139','A169','A189',
      'MD902','MD520','LYNX','PUMA','MERLIN','CHUK','GALE','S76','S92',
      'UH60','UH72','AH64','CH47','CH53','MH60','MH47'];
    if (heliExact.includes(t)) return 'helicopter';
    if (/^(EC[0-9]|R[24][0-9]?|H[0-9]|BO[0-9]|BK[0-9]|AS3[0-9]|AS5[0-9]|SA3[0-9]|AW[0-9]|S7[0-9]|S9[0-9]|UH|AH|CH|MH|HH|OH)/.test(t)) return 'helicopter';

    const gliderExact = ['ASK21','ASK13','ASK18','LS4','LS6','LS8','LS10','DG40','DG60','DG80',
      'ASG29','ASH31','ASW28','ASW27','PIK20','K21','K8','K13','G103','SF25',
      'JS1','EB28','SZD50','SZD55','PW5','PW6','LAK17','NIMB'];
    if (gliderExact.includes(t)) return 'sailplane';
    if (/^(ASK|ASW|ASG|ASH|LS[0-9]|DG[0-9]|K-?[0-9]|LAK|PIK|SZD|NIMB|PW[0-9]|JS[0-9])/.test(t)) return 'sailplane';

    const milExact = ['F16','F15','F18','F35','F22','F14','F5','F4','A10','AV8B',
      'B1','B2','B52','EF2000','EUFI','GROB','GRPEN','MIG29','MIG35',
      'SU27','SU30','SU35','SU57','KC135','KC10','KC767','E3','E8','P3','P8',
      'C130','C17','C5','U2','SR71','T38','T45','L39','MB339','M346'];
    if (milExact.includes(t)) return 'military';
    if (/^(F[0-9]{1,2}[A-Z]?$|AV8|B[12][A-Z]?$|EF[0-9]|MIG|SU[0-9]{2}|YAK[0-9]|KC[0-9]|E-?3[A-Z]|T-?[0-9]{2})/.test(t)) return 'military';

    const tpExact = ['ATR42','ATR72','DH8A','DH8B','DH8C','DH8D','Q300','Q400',
      'SF34','SW4','BE1900','BE99','E120','MA60','MA600','IL18','AN24','AN26',
      'DHC6','DHC7','P180','C208','PC12','JS32','JS41','L410','LET4'];
    if (tpExact.includes(t)) return 'turboprop';
    if (/^(ATR|DH8|DHC|SF3|AT[4-7]|AN[0-9]|IL1[0-9]|LET|L41|SW[0-9]|JS[0-9]|C208|PC1[02])/.test(t)) return 'turboprop';

    const rjExact = ['CRJ2','CRJ7','CRJ9','CRJX','E170','E175','E190','E195',
      'ERJ145','ERJ135','ARJ21','MRJ90','MRJ70','BCS1','BCS3','RJ85','RJ1H',
      'B461','B462','B463','DC91','DC92','DC93','F70','F100','BAE146'];
    if (rjExact.includes(t)) return 'regional-jet';
    if (/^(CRJ|ERJ|E17[05]|E19[05]|BCS|ARJ|MRJ|RJ[0-9]|F7[05]|F10[05]|B46[0-9])/.test(t)) return 'regional-jet';

    // Large jets: classic codes + Boeing MAX (B3[789X]M), 787-10 (B7[0-9]X),
    // Airbus NEO/XLR narrow-body (A[12][0-9][NX]), NEO/K wide-body (A3[0-9][NK])
    if (/^(B7[0-9]{2}|B7[0-9]X|B3[789X]M|A[23][0-9]{2}|A[12][0-9][NX]|A3[0-9][NK]|A38[08]|DC1[08]|MD1[01]|MD8[0-9]|MD9[0-9]|L101|IL6[246]|IL7[46]|IL9[06]|TU[0-9]{3}|AN1[24]|AN1[47]|AN2[24]|C5[AB]?)/.test(t)) return 'large-jet';

    return 'ga';
  }

  // -- SVG cache for lazy-loaded aircraft shapes -----------------------------
  const _svgCache   = new Map(); // filename ? svg text
  const _svgLoading = new Map(); // filename ? in-flight Promise (dedup concurrent fetches)

  function requireSvg(filename) {
    if (_svgCache.has(filename))   return Promise.resolve(_svgCache.get(filename));
    if (_svgLoading.has(filename)) return _svgLoading.get(filename);
    const url = `https://cdn.jsdelivr.net/gh/joeherwig/AircraftIconsSVG@main/Shapes%20SVG/${encodeURIComponent(filename)}`;
    const p = fetch(url)
      .then(r => r.ok ? r.text() : null)
      .then(text => { if (text) _svgCache.set(filename, text); _svgLoading.delete(filename); return text; })
      .catch(() => { _svgLoading.delete(filename); return null; });
    _svgLoading.set(filename, p);
    return p;
  }

  // Category fallback filenames � one known SVG per category
  const CATEGORY_SVG = {
    'large-jet':    'A20N.svg',
    'regional-jet': 'CRJ9.svg',
    'turboprop':    'DH8D.svg',
    'ga':           'C172.svg',
    'helicopter':   'EC45.svg',
    'sailplane':    'ASK21.svg',
    'military':     'F16.svg',
    'generic':      'Unidentified.svg',
  };

  function getSvgFilename(icaoType) {
    const t = normalizeType(icaoType);
    return t ? t + '.svg' : null;
  }

  function getCategoryFallback(icaoType) {
    return CATEGORY_SVG[classifyType(icaoType)] || null;
  }

  // -- Altitude-based color (ADSBExchange/tar1090 scheme) -------------------
  function altColor(altFt) {
    if (altFt == null || altFt === '') return 'hsl(0,0%,75%)';
    const ft = Number(altFt);
    if (ft <= 0) return 'hsl(0,0%,45%)';
    let hue;
    if (ft < 2000)        hue = 20;
    else if (ft < 10000)  hue = 20  + (ft - 2000)  / 8000  * 120;
    else if (ft <= 40000) hue = 140 + (ft - 10000) / 30000 * 160;
    else                  hue = 300;
    return `hsl(${Math.round(hue)},88%,44%)`;
  }

  // -- Trail helpers ---------------------------------------------------------

  function headingDiff(a, b) {
    const d = ((b - a) % 360 + 360) % 360;
    return d > 180 ? d - 360 : d;
  }

  // JoinFS reports this fixed position (0�N 90.000323�E) whenever an aircraft's real
  // position isn't known yet � not just before its first real fix, but any time
  // mid-session too. Treat every occurrence as "no data this tick", never real data,
  // or it draws a spurious line across the globe to/from it.
  function isPlaceholderPosition(ac) {
    return ac.latitude === 0 && Math.abs(ac.longitude - 90.000323) < 1e-6;
  }

  const _LS_PREFIX = 'joinfs-trail-';
  // Shared by _scheduleTrailCleanup (in-session) and _sweepOrphanedTrails (page-load).
  const TRAIL_CLEANUP_GRACE_MS = 15 * 60 * 1000;

  function _lsKey(key)  { return _LS_PREFIX + key; }

  function _loadTrailData(key) {
    try {
      const raw = localStorage.getItem(_lsKey(key));
      if (raw) {
        const d = JSON.parse(raw);
        return {
          show: !!d.show, pts: d.pts || [],
          pilotName: d.pilotName || '', registration: d.registration || '',
          startedAt: d.startedAt || null,
        };
      }
    } catch {}
    return { show: false, pts: [], pilotName: '', registration: '', startedAt: null };
  }

  // meta identifies whose trail this is when inspecting localStorage directly �
  // the storage key itself is just an opaque guid/callsign.
  function _saveTrailData(key, show, pts, meta) {
    try {
      localStorage.setItem(_lsKey(key), JSON.stringify({
        show, pts,
        pilotName: meta.pilotName || '', registration: meta.registration || '',
        startedAt: meta.startedAt || null,
        updatedAt: Date.now(),
      }));
    } catch {}
  }

  // Runs once per page load, before any aircraft_update has arrived, so there's no
  // "still live" set to check against � a trail last written more than the grace
  // period ago is orphaned by definition. Catches trails whose owning aircraft
  // vanished while the page was closed, which _scheduleTrailCleanup's in-session
  // timer can never see.
  function _sweepOrphanedTrails() {
    const cutoff = Date.now() - TRAIL_CLEANUP_GRACE_MS;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const lsKey = localStorage.key(i);
      if (!lsKey || !lsKey.startsWith(_LS_PREFIX)) continue;
      try {
        const d = JSON.parse(localStorage.getItem(lsKey));
        if (!d.updatedAt || d.updatedAt < cutoff) localStorage.removeItem(lsKey);
      } catch {
        localStorage.removeItem(lsKey);
      }
    }
  }

  // -- Icon helpers ----------------------------------------------------------

  // Map icon-size attr (1�10) to pixels: 1?92 px, 5?140 px, 10?200 px
  function iconPx(sizeAttr) { return 40 + sizeAttr * 1; }

  // Layers to colorize (by inkscape:label, lowercased)
  const COLORED_LABELS = new Set(['pfade', 'shape', 'outline', 'path', 'accent']);

  const _INKSCAPE_NS = 'http://www.inkscape.org/namespaces/inkscape';

  function colorSvg(svgText, fillColor, strokeColor, strokeWidth) {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    // strip any embedded <title> - the aircraft-shape SVGs carry a static one (e.g.
    // "A320 neo") that the browser shows as a native tooltip on hover, but it can't
    // reflect per-aircraft data. A dynamic Leaflet tooltip is bound on the marker
    // instead (see _tooltipHtml), which would otherwise show alongside/underneath this.
    for (const titleEl of Array.from(doc.getElementsByTagName('title'))) {
      titleEl.remove();
    }
    for (const g of doc.getElementsByTagName('g')) {
      // inkscape:label is a namespace-prefixed XML attribute � CSS attribute
      // selectors can't match it, so read it directly via getAttribute / getAttributeNS
      const label = (g.getAttributeNS(_INKSCAPE_NS, 'label') ||
                     g.getAttribute('inkscape:label') || '').toLowerCase();
      if (!COLORED_LABELS.has(label)) continue;
      for (const el of g.querySelectorAll('path,circle,ellipse,rect,polygon,polyline')) {
        let s = el.getAttribute('style') || '';
        s = s.replace(/\bfill\s*:[^;]+/, `fill:${fillColor}`);
        s = s.replace(/\bstroke\s*:[^;]+/, `stroke:${strokeColor}`);
        if (strokeWidth != null)
          s = s.replace(/\bstroke-width\s*:[^;]+/, `stroke-width:${strokeWidth}`);
        el.setAttribute('style', s);
      }
    }
    return new XMLSerializer().serializeToString(doc);
  }

  function makeIcon(L, heading, svgText, color, sizeAttr, strokeColor, strokeWidth) {
    const px = iconPx(sizeAttr);
    const colored = colorSvg(svgText, color, strokeColor ?? '#000000', strokeWidth ?? null);
    const html = colored
      .replace(/<svg\b([^>]*)>/,
        (_, attrs) => `<svg${attrs
          .replace(/\swidth="[^"]*"/g, '')
          .replace(/\sheight="[^"]*"/g, '')
        } width="${px}" height="${px}"` +
        ` style="transform:rotate(${heading}deg);transform-origin:center;` +
        `filter:drop-shadow(0 1px 3px rgba(0,0,0,.55));display:block">`
      );
    return L.divIcon({
      html, className: '',
      iconSize:    [px, px],
      iconAnchor:  [px / 2, px / 2],
      popupAnchor: [0, -Math.ceil(px / 2) - 2],
    });
  }

  function makeDotIcon(L, color, sizeAttr) {
    const px  = iconPx(sizeAttr);
    const r   = Math.max(4, Math.round(px / 8));
    const cx  = px / 2;
    const html = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}">` +
                 `<circle cx="${cx}" cy="${cx}" r="${r}" fill="${color}" opacity=".75"/></svg>`;
    return L.divIcon({
      html, className: '',
      iconSize:    [px, px],
      iconAnchor:  [cx, cx],
      popupAnchor: [0, -Math.ceil(cx) - 2],
    });
  }

  // -- Shadow DOM template ---------------------------------------------------
  const template = document.createElement('template');
  template.innerHTML = `
    <style>
      :host {
        display: block;
        width: 100%;
        height: 500px;
        position: relative;
        font-family: sans-serif;
      }
      #map { width: 100%; height: 100%; }

      /* -- overlays -- */
      #ws-status, #follow-status {
        position: absolute;
        z-index: 1000;
        padding: 4px 10px;
        border-radius: 4px;
        font-size: 12px;
        color: #fff;
        pointer-events: none;
        transition: background .3s;
      }
      #ws-status {
        top: 8px; right: 8px;
        box-sizing: border-box;
        overflow: hidden;
        white-space: nowrap;
        max-width: 480px;
        transition: background .3s, max-width .3s ease;
      }
      #ws-status.connecting   { background: rgba(150,90,0,.8); }
      #ws-status.connected    { background: rgba(0,110,0,.8); max-width: 46px; }
      #ws-status.disconnected { background: rgba(170,0,0,.8); }

      #follow-status {
        bottom: 28px; left: 8px;
        display: flex;
        align-items: center;
        gap: 6px;
        background: rgba(37,99,235,.85);
        pointer-events: all;
      }
      #follow-status[hidden] { display: none; }
      #follow-label { text-transform: uppercase; }
      #follow-status button {
        background: none;
        border: none;
        color: #fff;
        cursor: pointer;
        font-size: 15px;
        line-height: 1;
        padding: 0 2px;
        opacity: .8;
      }
      #follow-status button:hover { opacity: 1; }
    </style>
    <div id="map"></div>
    <div id="ws-status" class="connecting">connecting�</div>
    <div id="follow-status" hidden>
      <span>?</span>
      <span id="follow-label"></span>
      <button type="button" data-joinfs-unfollow aria-label="Stop following">�</button>
    </div>`;

  // -- Custom element --------------------------------------------------------
  class JoinFsMap extends HTMLElement {
    static get observedAttributes() { return ['uri', 'stale-timeout', 'theme', 'follow', 'icon-size', 'icon-stroke-width']; }

    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.appendChild(template.content.cloneNode(true));
      this._markers        = new Map();
      this._pendingCleanup = new Map(); // key ? timeout id, aircraft removed but grace period not elapsed
      this._L              = null;
      this._map            = null;
      this._tileLayer      = null;
      this._themeStyle     = null;
      this._mq             = null;
      this._mqListener     = null;
      this._isDark         = false;
      this._strokeWidth    = null;
      this._ws             = null;
      this._reconnectTimer = null;
      this._staleTimer     = null;
    }

    connectedCallback() {
      _sweepOrphanedTrails();
      this._initMap().then(() => this._connect());
    }

    disconnectedCallback() {
      this._teardown();
    }

    attributeChangedCallback(name, _old, newVal) {
      if (name === 'uri' && this._ws) { this._teardown(); this._connect(); }
      if (name === 'theme')           { this._applyTheme(); }
      if (name === 'follow')          { this._applyFollow(); }
      if (name === 'icon-size')       { this._refreshAllIcons(); }
      if (name === 'icon-stroke-width') {
        this._strokeWidth = newVal || null;
        this._refreshAllIcons();
      }
    }

    // -- attribute getters -------------------------------------------------

    get _uri() {
      return this.getAttribute('uri') || 'ws://localhost/ws/';
    }

    get _staleMs() {
      const v = parseInt(this.getAttribute('stale-timeout'), 10);
      return (Number.isFinite(v) && v > 0 ? v : 60) * 1000;
    }

    get _follow() {
      return (this.getAttribute('follow') || '').trim().toLowerCase();
    }

    // icon-size: 0-10, default 5
    get _iconSize() {
      const v = parseInt(this.getAttribute('icon-size'), 10);
      return Math.min(10, Math.max(1, Number.isFinite(v) ? v : 5));
    }

    // -- init --------------------------------------------------------------

    async _initMap() {
      const { L, css } = await loadLeaflet();
      this._L = L;

      const leafletStyle = document.createElement('style');
      leafletStyle.textContent = css;
      this.shadowRoot.prepend(leafletStyle);

      this._themeStyle = document.createElement('style');
      this._themeStyle.id = 'joinfs-theme';
      this.shadowRoot.appendChild(this._themeStyle);

      const lat  = parseFloat(this.getAttribute('lat'))    || 51.0;
      const lon  = parseFloat(this.getAttribute('lon'))    || 10.0;
      const zoom = parseInt(this.getAttribute('zoom'), 10) || 6;

      const mapEl = this.shadowRoot.querySelector('#map');
      this._map = L.map(mapEl, { zoomControl: true }).setView([lat, lon], zoom);

      this._applyTheme();

      // Event delegation: Follow / Unfollow buttons inside Leaflet popups
      mapEl.addEventListener('click', e => {
        const followBtn   = e.target.closest('[data-joinfs-follow]');
        const unfollowBtn = e.target.closest('[data-joinfs-unfollow]');

        if (followBtn) {
          e.preventDefault();
          const cs      = followBtn.dataset.joinfsFollow;
          const current = this._follow;
          if (current === cs.toLowerCase()) {
            this.removeAttribute('follow');
            this._dispatch('joinfs-follow', { callsign: null });
          } else {
            this.setAttribute('follow', cs);
            this._dispatch('joinfs-follow', { callsign: cs });
          }
          this._map.closePopup();
        }

        if (unfollowBtn) {
          e.preventDefault();
          this.removeAttribute('follow');
          this._dispatch('joinfs-follow', { callsign: null });
        }

        const trailBtn      = e.target.closest('[data-joinfs-trail]');
        const trailClearBtn = e.target.closest('[data-joinfs-trail-clear]');

        if (trailBtn) {
          e.preventDefault();
          const cs = trailBtn.dataset.joinfsTrail;
          for (const [k, en] of this._markers) {
            if ((en.ac.callsign || '') === cs) {
              en.trailShow ? this._hideTrail(k, en) : this._showTrail(k, en);
              break;
            }
          }
        }

        if (trailClearBtn) {
          e.preventDefault();
          const cs = trailClearBtn.dataset.joinfsTrailClear;
          for (const [k, en] of this._markers) {
            if ((en.ac.callsign || '') === cs) { this._clearTrail(k, en); break; }
          }
        }
      });

      this.shadowRoot.querySelector('#follow-status [data-joinfs-unfollow]')
        .addEventListener('click', e => {
          e.preventDefault();
          this.removeAttribute('follow');
          this._dispatch('joinfs-follow', { callsign: null });
        });

      this._staleTimer = setInterval(() => this._purgeStale(), 15_000);

      if (this._follow) this._applyFollow();
    }

    // -- theme -------------------------------------------------------------

    _applyTheme() {
      const attr = this.getAttribute('theme');
      const isAuto = !attr || attr === 'auto';
      if (isAuto) {
        if (!this._mq) {
          this._mq = window.matchMedia('(prefers-color-scheme: dark)');
          this._mqListener = () => this._applyTheme();
          this._mq.addEventListener('change', this._mqListener);
        }
        this._isDark = this._mq.matches;
      } else {
        if (this._mq) {
          this._mq.removeEventListener('change', this._mqListener);
          this._mq = null; this._mqListener = null;
        }
        this._isDark = attr === 'dark';
      }
      this._swapTileLayer();
      if (this._themeStyle)
        this._themeStyle.textContent = this._isDark ? DARK_POPUP_CSS : '';
      this._refreshAllIcons();
    }

    _swapTileLayer() {
      if (!this._L || !this._map) return;
      const cfg = this._isDark ? TILES.dark : TILES.light;
      if (this._tileLayer) this._map.removeLayer(this._tileLayer);
      this._tileLayer = this._L.tileLayer(cfg.url, {
        attribution: cfg.attribution,
        maxZoom:     cfg.maxZoom,
        ...(cfg.subdomains ? { subdomains: cfg.subdomains } : {}),
      }).addTo(this._map);
    }

    // -- follow ------------------------------------------------------------

    _matchesFollow(ac) {
      const t = this._follow;
      if (!t) return false;
      return (ac.callsign || '').toLowerCase() === t ||
             (ac.nickname || '').toLowerCase() === t;
    }

    _applyFollow() {
      const statusEl = this.shadowRoot.querySelector('#follow-status');
      const labelEl  = this.shadowRoot.querySelector('#follow-label');
      const target   = this._follow;

      if (statusEl) {
        statusEl.hidden = !target;
        if (labelEl) labelEl.textContent = target || '';
      }

      if (!this._map || !target) return;

      for (const [, entry] of this._markers) {
        if (this._matchesFollow(entry.ac)) {
          this._panFollowTarget(entry);
          break;
        }
      }
    }

    // Recenter on a followed aircraft, then re-run the popup's own auto-pan if it's
    // open - panTo puts the marker at the viewport's exact midpoint on every update,
    // which can push an already-open (and possibly tall) popup out of view again.
    // Leaflet only auto-pans for a popup when it first opens, not on later map moves
    // triggered independently of that popup, so it has to be re-triggered explicitly.
    _panFollowTarget(entry) {
      this._map.panTo([entry.ac.latitude, entry.ac.longitude], { animate: true });
      if (entry.marker && entry.marker.isPopupOpen()) {
        entry.marker.openPopup();
      }
    }

    // -- WebSocket ---------------------------------------------------------

    _connect() {
      const uri = this._uri;
      this._setStatus('connecting', uri);
      let ws;
      try { ws = new WebSocket(uri); }
      catch { this._scheduleReconnect(); return; }
      this._ws = ws;
      ws.onopen    = () => this._setStatus('connected', uri.startsWith('wss:') ? 'wss' : 'ws');
      ws.onclose   = () => { this._setStatus('disconnected', uri); this._scheduleReconnect(); };
      ws.onerror   = () => { /* onclose always follows */ };
      ws.onmessage = ({ data }) => { try { this._onMessage(JSON.parse(data)); } catch {} };
    }

    _scheduleReconnect() {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = setTimeout(() => this._connect(), 4000);
    }

    _teardown() {
      clearTimeout(this._reconnectTimer);
      clearInterval(this._staleTimer);
      for (const timer of this._pendingCleanup.values()) clearTimeout(timer);
      this._pendingCleanup.clear();
      if (this._mq && this._mqListener) {
        this._mq.removeEventListener('change', this._mqListener);
        this._mq = null; this._mqListener = null;
      }
      if (this._ws) { this._ws.onclose = null; this._ws.close(); this._ws = null; }
    }

    _setStatus(cls, text) {
      const el = this.shadowRoot.querySelector('#ws-status');
      el.className = cls;
      el.textContent = text;
    }

    _dispatch(name, detail) {
      this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail }));
    }

    // -- aircraft data -----------------------------------------------------

    _onMessage(msg) {
      if (msg.type !== 'aircraft_update') return;
      for (const ac of msg.aircraft) this._updateAircraft(ac);
    }

    _updateAircraft(ac) {
      if (!this._L || !this._map) return;
      const L     = this._L;
      const key   = ac.guid || ac.callsign;

      if (isPlaceholderPosition(ac)) {
        // JoinFS can send this fixed fix mid-session too (e.g. a momentary loss of
        // position), not just before an aircraft's first real fix � ignore it
        // entirely rather than moving the marker or recording a trail point, but
        // keep the aircraft alive so _purgeStale doesn't drop it over one bad tick.
        const existing = this._markers.get(key);
        if (existing) existing.lastSeen = Date.now();
        return;
      }

      const ll    = [ac.latitude, ac.longitude];
      const color = altColor(ac.altitude);
      const size  = this._iconSize;

      if (this._markers.has(key)) {
        const entry    = this._markers.get(key);
        entry.ac       = ac;
        entry.lastSeen = Date.now();
        const icon = entry.svgText
          ? makeIcon(L, ac.heading, entry.svgText, color, size,
                     this._isDark ? '#ffffff' : '#000000', this._strokeWidth)
          : makeDotIcon(L, color, size);
        entry.marker.setLatLng(ll).setIcon(icon);
        if (entry.marker.isPopupOpen())
          entry.marker.getPopup().setContent(this._popupHtml(ac));
        if (entry.marker.isTooltipOpen())
          entry.marker.getTooltip().setContent(this._tooltipHtml(ac));
      } else {
        if (this._pendingCleanup.has(key)) {
          clearTimeout(this._pendingCleanup.get(key));
          this._pendingCleanup.delete(key);
        }
        const stored = _loadTrailData(key);
        const entry = { ac, lastSeen: Date.now(), marker: null, svgText: null,
                        trailShow: stored.show, trail: stored.pts, trailLayer: null, liveLine: null,
                        trailStartedAt: stored.startedAt || null };
        const marker = L.marker(ll, { icon: makeDotIcon(L, color, size) })
          .addTo(this._map)
          .bindPopup(() => this._popupHtml(entry.ac), { maxWidth: 300 })
          .bindTooltip(() => this._tooltipHtml(entry.ac), { direction: 'top', offset: [0, -4] });
        entry.marker = marker;
        this._markers.set(key, entry);
        if (stored.show) this._rebuildTrailLayer(entry);
      }

      if (this._matchesFollow(ac)) {
        this._panFollowTarget(this._markers.get(key));
      }

      this._appendTrailPoint(key, this._markers.get(key), ac);
      this._updateLiveSegment(this._markers.get(key), ac);

      // Async SVG upgrade: try exact ICAO filename, then category fallback
      const filename = getSvgFilename(ac.icaoType);
      if (filename) {
        requireSvg(filename)
          .then(svgText => svgText || requireSvg(getCategoryFallback(ac.icaoType)))
          .then(svgText => {
            if (!svgText) return;
            const entry = this._markers.get(key);
            if (!entry) return;
            entry.svgText = svgText;
            entry.marker.setIcon(
              makeIcon(L, entry.ac.heading, svgText, altColor(entry.ac.altitude), this._iconSize,
                       this._isDark ? '#ffffff' : '#000000', this._strokeWidth)
            );
          });
      }
    }

    _purgeStale() {
      const cutoff = Date.now() - this._staleMs;
      for (const [key, entry] of this._markers) {
        if (entry.lastSeen < cutoff) {
          entry.marker.remove();
          if (entry.trailLayer) { entry.trailLayer.remove(); }
          this._markers.delete(key);
          this._scheduleTrailCleanup(key);
        }
      }
    }

    // Delete a departed aircraft's stored trail after a grace period, unless it
    // reappears (same guid/callsign) before the timer fires � see _updateAircraft.
    _scheduleTrailCleanup(key) {
      if (this._pendingCleanup.has(key)) clearTimeout(this._pendingCleanup.get(key));
      const timer = setTimeout(() => {
        this._pendingCleanup.delete(key);
        if (this._markers.has(key)) return;
        try { localStorage.removeItem(_lsKey(key)); } catch {}
      }, TRAIL_CLEANUP_GRACE_MS);
      this._pendingCleanup.set(key, timer);
    }

    // Rebuild all marker icons when icon-size attribute changes
    _refreshAllIcons() {
      if (!this._L) return;
      for (const [, entry] of this._markers) {
        const color = altColor(entry.ac.altitude);
        const size  = this._iconSize;
        entry.marker.setIcon(
          entry.svgText
            ? makeIcon(this._L, entry.ac.heading, entry.svgText, color, size,
                       this._isDark ? '#ffffff' : '#000000', this._strokeWidth)
            : makeDotIcon(this._L, color, size)
        );
      }
    }

    // -- trails ------------------------------------------------------------

    _shouldSavePoint(trail, ac) {
      if (trail.length === 0) return true;
      const last = trail[trail.length - 1];
      if (Math.abs(headingDiff(last.hdg, ac.heading)) > 5) return true;
      if (altColor(last.alt) !== altColor(ac.altitude)) return true;
      return false;
    }

    // pilotName/registration reflect the current aircraft; startedAt is fixed at
    // the trail's first stored point so it reads as "when this trail began".
    _trailMeta(entry) {
      return {
        pilotName: entry.ac.nickname || '', registration: entry.ac.registration || '',
        startedAt: entry.trailStartedAt || null,
      };
    }

    _appendTrailPoint(key, entry, ac) {
      if (!this._shouldSavePoint(entry.trail, ac)) return;
      if (!entry.trailStartedAt) entry.trailStartedAt = new Date().toISOString();
      const pt = { lat: ac.latitude, lon: ac.longitude, alt: ac.altitude, hdg: ac.heading };
      entry.trail.push(pt);
      if (entry.trail.length > 1000) entry.trail.shift();

      if (entry.trailShow && entry.trail.length >= 2 && entry.trailLayer) {
        const prev = entry.trail[entry.trail.length - 2];
        this._L.polyline(
          [[prev.lat, prev.lon], [pt.lat, pt.lon]],
          { color: altColor(prev.alt), weight: 3, opacity: 0.75, lineJoin: 'round' }
        ).addTo(entry.trailLayer);
      }

      _saveTrailData(key, entry.trailShow, entry.trail, this._trailMeta(entry));
    }

    _updateLiveSegment(entry, ac) {
      if (!entry.trailShow || !entry.trailLayer || entry.trail.length === 0) {
        if (entry.liveLine) { entry.liveLine.remove(); entry.liveLine = null; }
        return;
      }
      const last = entry.trail[entry.trail.length - 1];
      const latlngs = [[last.lat, last.lon], [ac.latitude, ac.longitude]];
      if (entry.liveLine) {
        entry.liveLine.setLatLngs(latlngs).setStyle({ color: altColor(last.alt) });
      } else {
        entry.liveLine = this._L.polyline(latlngs,
          { color: altColor(last.alt), weight: 3, opacity: 0.75, lineJoin: 'round' }
        ).addTo(entry.trailLayer);
      }
    }

    _rebuildTrailLayer(entry) {
      if (entry.trailLayer) { entry.trailLayer.remove(); entry.trailLayer = null; }
      entry.liveLine = null;
      if (!entry.trailShow || !this._L || !this._map) return;
      entry.trailLayer = this._L.layerGroup().addTo(this._map);
      for (let i = 1; i < entry.trail.length; i++) {
        const p0 = entry.trail[i - 1], p1 = entry.trail[i];
        this._L.polyline(
          [[p0.lat, p0.lon], [p1.lat, p1.lon]],
          { color: altColor(p0.alt), weight: 3, opacity: 0.75, lineJoin: 'round' }
        ).addTo(entry.trailLayer);
      }
    }

    _showTrail(key, entry) {
      entry.trailShow = true;
      this._rebuildTrailLayer(entry);
      _saveTrailData(key, true, entry.trail, this._trailMeta(entry));
      if (entry.marker.isPopupOpen()) entry.marker.getPopup().setContent(this._popupHtml(entry.ac));
    }

    _hideTrail(key, entry) {
      entry.trailShow = false;
      if (entry.trailLayer) { entry.trailLayer.remove(); entry.trailLayer = null; }
      entry.liveLine = null;
      _saveTrailData(key, false, entry.trail, this._trailMeta(entry));
      if (entry.marker.isPopupOpen()) entry.marker.getPopup().setContent(this._popupHtml(entry.ac));
    }

    _clearTrail(key, entry) {
      entry.trailShow = false;
      entry.trail     = [];
      entry.trailStartedAt = null;
      if (entry.trailLayer) { entry.trailLayer.remove(); entry.trailLayer = null; }
      try { localStorage.removeItem(_lsKey(key)); } catch {}
      if (entry.marker.isPopupOpen()) entry.marker.getPopup().setContent(this._popupHtml(entry.ac));
    }

    // -- hover tooltip HTML -----------------------------------------------

    _tooltipHtml(ac) {
      if (!ac) return '';
      const typeCode = normalizeType(ac.icaoType);
      return [ac.callsign, ac.nickname, typeCode].filter(Boolean).join(' • ');
    }

    // -- popup HTML --------------------------------------------------------

    _popupHtml(ac) {
      if (!ac) return '';
      const dark    = this._isDark;
      const text    = dark ? '#e2e8f0' : '#1a202c';
      const muted   = dark ? '#94a3b8' : '#6b7280';
      const sub     = dark ? '#64748b' : '#9ca3af';
      const divider = dark ? '#334155' : '#e5e7eb';
      const typeCode   = normalizeType(ac.icaoType);
      const color      = altColor(ac.altitude);
      const followed   = this._matchesFollow(ac);
      const trailKey   = ac.guid || ac.callsign;
      const trailEntry = this._markers.get(trailKey) || null;

      const row = (lbl, val) =>
        (val != null && val !== '' && val !== '0' && val !== 0)
          ? `<tr>
               <td style="color:${muted};padding:1px 10px 1px 0;white-space:nowrap">${lbl}</td>
               <td style="font-weight:600;color:${text}">${val}</td>
             </tr>`
          : '';

      const route   = [ac.from, ac.to].filter(Boolean).join(' ➜ ');
      const lights  = ac.lights  ? Object.entries(ac.lights) .filter(([,v]) => v).map(([k]) => k).join(', ') : '';
      const engines = ac.engines ? Object.entries(ac.engines).filter(([,v]) => v).map(([k]) => k.replace('Running','')).join(', ') : '';

      return `
        <div style="font-family:sans-serif;font-size:13px;min-width:190px;color:${text}">
          <div style="font-size:15px;font-weight:700;margin-bottom:6px;
                      border-bottom:2px solid ${color};padding-bottom:4px">
            <span style="color:${color}">?</span> ${ac.callsign || '—'}
            ${typeCode ? `<span style="font-weight:400;font-size:12px;color:${muted}"> • ${typeCode}</span>` : ''}
          </div>
          <table style="border-collapse:collapse;line-height:1.55">
            ${row('Pilot',    ac.nickname)}
            ${row('Route',    route)}
            ${row('Airline',      ac.icaoAirline)}
            ${row('Flight No.',   ac.flightNumber)}
            ${row('Registration', ac.registration)}
            ${row('Rules',    ac.rules)}
            ${row('Altitude', ac.altitude   ? Number(ac.altitude).toLocaleString() + ' ft' : '')}
            ${row('Speed',    ac.speed      ? Math.round(ac.speed) + ' kts' : '')}
            ${row('Heading',  ac.heading != null ? ac.heading + '°' : '')}
            ${row('Squawk',   ac.squawk)}
            ${row('COM 1',    ac.com1)}
            ${row('COM 2',    ac.com2)}
            ${row('Gear',     ac.gear    ? 'down' : '')}
            ${row('Flaps',    ac.flaps   ? Math.round(ac.flaps * 100) + '%' : '')}
            ${row('Lights',   lights)}
            ${row('Engines',  engines)}
            ${row('Rotor',    ac.rotorRpm > 0 ? Math.round(ac.rotorRpm) + ' rpm' : '')}
          </table>
          ${ac.route   ? `<div style="font-size:11px;color:${sub};margin-top:4px">${ac.route}</div>` : ''}
          ${ac.remarks ? `<div style="font-size:11px;color:${sub}">${ac.remarks}</div>` : ''}
          ${ac.livery  ? `<div style="font-size:11px;color:${sub}">Livery: ${ac.livery}</div>` : ''}
          <div style="margin-top:8px;padding-top:6px;border-top:1px solid ${divider};display:flex;flex-direction:column;gap:5px">
            <a href="#" data-joinfs-follow="${ac.callsign}"
               style="display:inline-flex;align-items:center;gap:5px;
                      color:${followed ? '#ef4444' : color};
                      font-size:12px;font-weight:600;text-decoration:none;">
              ${followed
                ? `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="4" y="4" width="16" height="16" rx="2"/></svg> Stop following`
                : `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5,3 19,12 5,21"/></svg> Follow on map`}
            </a>
            <div style="display:flex;align-items:center;gap:10px">
              <a href="#" data-joinfs-trail="${ac.callsign}"
                 style="display:inline-flex;align-items:center;gap:5px;
                        color:${trailEntry && trailEntry.trailShow ? '#f59e0b' : muted};
                        font-size:12px;font-weight:600;text-decoration:none;">
                ${trailEntry && trailEntry.trailShow
                  ? `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg> Hide trail`
                  : `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> Show trail`}
                ${trailEntry && trailEntry.trail.length > 0
                  ? `<span style="font-weight:400;color:${muted}">(${trailEntry.trail.length} pts)</span>`
                  : ''}
              </a>
              ${trailEntry && trailEntry.trail.length > 0
                ? `<a href="#" data-joinfs-trail-clear="${ac.callsign}"
                      style="display:inline-flex;align-items:center;gap:4px;
                             color:#ef4444;font-size:12px;font-weight:600;text-decoration:none;">
                     <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg> Clear
                   </a>`
                : ''}
            </div>
          </div>
        </div>`;
    }
  }

  customElements.define('joinfs-map', JoinFsMap);
})();
