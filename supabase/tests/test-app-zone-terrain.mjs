// Demande 3 de Joé (29 sept. 2026) — DESSINER LA ZONE DU TERRAIN dès la création d'un arrêt, et la corriger ensuite (www/js/zone-terrain.js et ses branchements :
// liste-arrets.js « ＋ Nouveau stop », arrets.js la fiche d'un client, suivi-carte.js, admin-routes.js « Copier », index.html, css/style.css).
// Les VRAIS fichiers de l'application sont chargés dans un faux navigateur avec une fausse carte Leaflet (marqueurs déplaçables : le test « tire » un coin comme le ferait un doigt),
// un FAUX Supabase (qui note chaque écriture) et un faux service d'adresses (Nominatim).
// Décisions de Joé : rectangle de départ de 15 m × 15 m ; la zone est facultative (« Passer (sans zone) ») ; « ✏ Modifier la zone » pour un arrêt existant, réservé à l'administrateur.
// Ce que ce test ne peut PAS vérifier : le glissement d'un vrai doigt et la vraie Leaflet (essayés à part, dans un navigateur, puis sur un téléphone).
// WWW_TEST : un autre dossier « www » (erreurs volontaires : voir erreurs-volontaires.mjs).
import vm from 'vm';
import fs from 'fs';
import { fileURLToPath } from 'url';
const WWW = process.env.WWW_TEST ? process.env.WWW_TEST.split('\\').join('/').replace(/\/?$/, '/') : fileURLToPath(new URL('../../www/', import.meta.url));

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
const lire = (f) => fs.readFileSync(WWW + f, 'utf8');
const presque = (a, b, tol) => Math.abs(a - b) <= tol;

const ADMIN = { id: 'u-joe', nom: 'Joé', role: 'admin' }, LUC = { id: 'u-luc', nom: 'Luc', role: 'employe' };
const ZONE_S2 = [[46.4431, -72.9222], [46.4431, -72.9218], [46.4429, -72.9218], [46.4429, -72.9222]];
const ZONE_S4 = [[46.4441, -72.9192], [46.4441, -72.9188], [46.4439, -72.9188], [46.4439, -72.9192]];
const STOPS = () => [
  { id: 's1', adresse: '304 rue de l\'Église', client: 'TEST 1', route_id: 'r1', service: 'Coupe de gazon', lat: 46.44, lon: -72.92, ordre: 0, actif: true },
  { id: 's2', adresse: '220 rue du Moulin', client: 'TEST 3', route_id: 'r1', service: 'Coupe de gazon', lat: 46.443, lon: -72.922, ordre: 1, actif: true, zone_points: ZONE_S2.map((p) => [...p]) },
  { id: 's3', adresse: '50 rue Notre-Dame', client: null, route_id: 'r1', service: 'Engrais', lat: null, lon: null, ordre: 2, actif: true },
  { id: 's4', adresse: '215 rue Bellerive', client: 'TEST 4', route_id: 'r1', service: 'Coupe de gazon', lat: 46.444, lon: -72.919, ordre: 3, actif: true, zone_points: ZONE_S4.map((p) => [...p]) },
];
const PASSE = (id, equipe, o = {}) => ({ passe_id: id, equipe_id: equipe, chauffeur_id: 'u-x', je_suis_chauffeur: false, je_suis_a_bord: false, ...o });
const CHAUFFEUR = (id = 'p1') => [{ route_id: 'r1', tache: 't1', numero: 1, en_cours: true, total: 4, faits: 1, pourcentage: 25, arrets_faits: [], passes: [PASSE(id, 'e1', { chauffeur_id: 'u-luc', je_suis_chauffeur: true, je_suis_a_bord: true })] }];

const FICHIERS = ['js/config.js', 'js/position.js', 'js/utilitaires.js', 'js/hors-reseau.js', 'js/file-attente.js', 'js/tours.js', 'js/vehicules.js', 'js/suivi-carte.js', 'js/equipage.js', 'js/equipage-panneau.js', 'js/passe.js', 'js/resume-passe.js',
  'js/arrets.js', 'js/routes.js', 'js/problemes.js', 'js/photos.js', 'js/liste-arrets.js', 'js/ordre.js', 'js/placement.js', 'js/zone-terrain.js', 'js/admin-routes.js'];

// ---------------------------------------------------------------------
// Un monde : faux navigateur + fausse carte + faux Supabase + les vrais fichiers
// ---------------------------------------------------------------------
function monde(o = {}) {
  const els = {};
  const creer = (id) => {
    const classes = new Set();
    return { id, children: [], style: {}, textContent: '', innerHTML: '', value: '', disabled: false, className: '', onclick: null, attrs: {}, dataset: {},
      classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)), contains: (c) => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
      appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; }, focus() {}, remove() {}, querySelector() { return null; }, addEventListener() {} };
  };
  const el = (id) => (els[id] ??= creer(id));

  // Un marqueur Leaflet imité : déplaçable (le test le « tire » par glisser) ; getLatLng rend {lat, lng} comme le vrai
  const marqueurs = [], polygones = [];
  const faireMarqueur = (ll, opts) => {
    const ecout = {};
    const m = { ll: [ll[0], ll[1]], opts: opts || {}, retire: false,
      addTo() { return m; }, getLatLng() { return { lat: m.ll[0], lng: m.ll[1] }; },
      setLatLng(p) { m.ll = [p[0], p[1]]; return m; }, setIcon(i) { m.opts = { ...m.opts, icon: i }; return m; }, bindPopup() { return m; }, setPopupContent() { return m; },
      on(t, f) { (ecout[t] ??= []).push(f); return m; }, off(t, f) { ecout[t] = (ecout[t] ?? []).filter((x) => x !== f); return m; },
      tirer(t) { (ecout[t] ?? []).slice().forEach((f) => f({ latlng: m.getLatLng() })); } };
    marqueurs.push(m);
    return m;
  };
  const carte = { zoom: 14, centre: [46.55, -72.75], appels: [], ecout: {},
    on(t, f) { const l = (carte.ecout[t] ??= []); if (!l.includes(f)) l.push(f); return carte; },
    off(t, f) { carte.ecout[t] = (carte.ecout[t] ?? []).filter((x) => x !== f); return carte; },
    getZoom: () => carte.zoom, getCenter: () => carte.centre, getContainer: () => ({ style: {} }),
    setView(ll, z, opt) { carte.appels.push({ f: 'setView', ll: [ll[0], ll[1]], z, o: opt }); carte.centre = [ll[0], ll[1]]; if (z !== undefined) carte.zoom = z; return carte; },
    panTo(ll, opt) { carte.appels.push({ f: 'panTo', ll: [ll[0], ll[1]], o: opt }); carte.centre = [ll[0], ll[1]]; return carte; },
    flyTo(ll, z, opt) { carte.appels.push({ f: 'flyTo', ll: [ll[0], ll[1]], z, o: opt }); carte.centre = [ll[0], ll[1]]; carte.zoom = z; return carte; },
    flyToBounds(pts, opt) { carte.appels.push({ f: 'flyToBounds', pts: pts.map((p) => [p[0], p[1]]), o: opt }); return carte; },
    removeLayer(m) { m.retire = true; }, addLayer() {} };
  const L = { divIcon: (opt) => opt, marker: faireMarqueur,
    polygon: (pts, opts) => { const p = { pts: pts.map((x) => [x[0], x[1]]), opts: opts || {}, retire: false, misesAJour: 0, addTo() { return p; }, setLatLngs(l) { p.pts = l.map((x) => [x[0], x[1]]); p.misesAJour++; return p; } }; polygones.push(p); return p; },
    polyline: () => ({ addTo() { return this; } }), circle: () => ({ addTo() { return this; }, setLatLng() { return this; }, setRadius() { return this; } }), layerGroup: () => ({ addTo() { return this; } }) };

  // Le faux Supabase : note chaque écriture ; les réponses viennent de o.reponses['table.opération'] (une valeur, ou une fonction (valeur, filtres)) et se changent en cours de route
  const reponses = o.reponses ?? {};
  const tables = o.tables ?? {};
  const appels = { ecritures: [], selects: [], fetch: [], toasts: [], confirmations: [] };
  const fauxDb = {
    rpc: async () => ({ data: null, error: null }),
    channel() { const c = { on() { return c; }, subscribe() { return c; } }; return c; },
    from: (table) => {
      const q = { op: 'select', valeur: null, filtres: [], retour: null, unique: false, lecture: null };
      q.select = (c) => { if (q.op === 'select') { q.lecture = c; appels.selects.push([table, c]); } else q.retour = c === undefined ? '*' : c; return q; };
      q.eq = (c, v) => { q.filtres.push([c, v]); return q; };
      q.order = () => q; q.is = () => q; q.not = () => q; q.limit = () => q; q.range = () => q;
      q.insert = (v) => { q.op = 'insert'; q.valeur = v; return q; };
      q.update = (v) => { q.op = 'update'; q.valeur = v; return q; };
      q.delete = () => { q.op = 'delete'; return q; };
      q.single = () => { q.unique = true; return q; };
      q.then = (ok_, ko_) => {
        let res;
        if (q.op === 'select') res = { data: (tables[table] ?? []).map((x) => JSON.parse(JSON.stringify(x))), error: null };
        else {
          appels.ecritures.push({ table, op: q.op, valeur: JSON.parse(JSON.stringify(q.valeur)), filtres: q.filtres, retour: q.retour });
          const rep = reponses[table + '.' + q.op];
          if (rep !== undefined) res = typeof rep === 'function' ? rep(q.valeur, q.filtres) : rep;
          else if (q.op === 'insert') res = q.unique ? { data: { ...q.valeur[0], id: 's-nouveau' }, error: null } : { data: q.valeur.map((v, i) => ({ ...v, id: 'copie-' + i })), error: null };
          else res = { data: q.retour ? [{ id: (q.filtres.find((f) => f[0] === 'id') ?? [])[1] }] : null, error: null };
        }
        if (res && res.lance) return Promise.reject(res.lance).then(ok_, ko_);
        return Promise.resolve(res).then(ok_, ko_);
      };
      return q;
    },
  };

  const minuteries = [];
  const sandbox = {
    document: { getElementById: el, createElement: () => creer(null), body: creer('body'), addEventListener() {}, removeEventListener() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: {}, navigator: { geolocation: { watchPosition: () => 1 } },
    L, supabase: { createClient: () => fauxDb },
    setTimeout: (f, ms) => { minuteries.push({ f, ms }); return minuteries.length; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, console,
    fetch: async (url) => {
      appels.fetch.push(String(url));
      if (o.fetchLance) throw new Error('Failed to fetch');
      return { json: async () => o.geocode ?? [{ lat: '46.55', lon: '-72.75' }] };
    },
    crypto: { randomUUID: () => 'x' }, setStatus() {}, hideLoading() {}, showErr() {},
    __db: fauxDb, __carte: carte, __toasts: appels.toasts, __confirmations: appels.confirmations, __reponse: { oui: true },
  };
  const ctx = vm.createContext(sandbox);
  for (const f of FICHIERS.filter((x) => !(o.sansZone && x === 'js/zone-terrain.js'))) vm.runInContext(lire(f), ctx, { filename: f });
  vm.runInContext(`db = __db; map = __carte; stops = ${JSON.stringify(o.stops ?? STOPS())}; currentUser = ${JSON.stringify(o.utilisateur ?? ADMIN)};
    toast = (m) => { __toasts.push(m); }; confirmer = async (...a) => { __confirmations.push(a); return __reponse.oui; };
    var __suivi = () => (suiviCarte ? { type: suiviCarte.type, auto: suiviCarte.auto, attache: !!suiviCarte.marqueur } : null);`, ctx);

  const w = { ctx, el, carte, marqueurs, polygones, appels, reponses, minuteries, toasts: appels.toasts,
    run: (c) => vm.runInContext(c, ctx),
    repondre: (oui) => { sandbox.__reponse.oui = oui; },
    // ce que l'éditeur dessine : le polygone (options interactive:false) et les 4 poignées (marqueurs déplaçables)
    poignees: () => marqueurs.filter((m) => m.opts.draggable && !m.retire),
    polyEditeur: () => polygones.filter((p) => p.opts.interactive === false && !p.retire).at(-1) ?? null,
    zones: () => polygones.filter((p) => p.opts.interactive !== false && !p.retire),   // les zones des arrêts (renderAll)
    // un doigt tire un coin : « drag » à chaque pas, « dragend » à la fin
    glisser: (i, lat, lon) => { const m = w.poignees()[i]; m.ll = [lat, lon]; m.tirer('drag'); m.tirer('dragend'); },
    pas: (i, lat, lon) => { const m = w.poignees()[i]; m.ll = [lat, lon]; m.tirer('drag'); },       // un pas du glissement (le doigt est encore posé)
    lacher: (i, lat, lon) => { const m = w.poignees()[i]; m.ll = [lat, lon]; m.tirer('dragend'); },   // le doigt se lève
    info: () => el('zone-info').textContent,
    barreOuverte: () => el('zone-barre').classList.contains('active'),
    actif: () => w.run('zoneEditeurActif()'),
    suivi: () => w.run('__suivi()'),
    dernierToast: () => appels.toasts.at(-1),
    ecrituresStops: () => appels.ecritures.filter((e) => e.table === 'stops'),
    vider: () => { const l = minuteries.splice(0); l.forEach((t) => t.f()); },   // les temporisations en attente (setTimeout) se déclenchent
  };
  return w;
}

// Un éditeur ouvert directement (sans passer par un écran) ; les rappels notent ce qu'ils reçoivent
function ouvrirDirect(m, o = {}) {
  const rec = { enregistrer: [], sans: [], annule: 0, reponse: true };
  m.ctx.__cb = {
    enregistrer: o.enregistrer ?? (async (p) => { rec.enregistrer.push(p); return rec.reponse; }),
    sans: async (p) => { rec.sans.push(p); return rec.reponse; },
    annule: () => { rec.annule++; },
  };
  const code = `demarrerEditeurZone({lat:46.55, lon:-72.75, adresse:'245 rue Test', titre:'📍 Titre d\\'essai', libelleSans:'Passer (sans zone)', enregistrer:__cb.enregistrer, ${o.sansBouton ? '' : 'sans:__cb.sans,'} annule:__cb.annule${o.points ? ', points:' + JSON.stringify(o.points) : ''}${o.stopId ? ', stopId:' + JSON.stringify(o.stopId) : ''}})`;
  const r = m.run(code);
  return { rec, r };
}
const MOYENNE = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];

// =====================================================================
log('=== LA GÉOMÉTRIE : LE RECTANGLE DE DÉPART (15 m × 15 m), L\'AIRE, LES CÔTÉS QUI SE CROISENT ===');
{
  const m = monde();
  const dist = (a, b) => m.run(`distanceMetres(${a[0]}, ${a[1]}, ${b[0]}, ${b[1]})`);
  for (const lat of [0, 46.5, 60]) {
    const r = m.run(`zoneRectangleDepart(${lat}, -72.75)`);
    const [nw, ne, se, sw] = r;
    eq(`à ${lat}° : le rectangle a 4 coins`, r.length, 4);
    vrai(`… 15 m de large (pas de degrés : les degrés de longitude rétrécissent vers le nord)`, presque(dist(nw, ne), 15, 0.05) && presque(dist(sw, se), 15, 0.05), `${dist(nw, ne)} / ${dist(sw, se)}`);
    vrai(`… 15 m de haut`, presque(dist(nw, sw), 15, 0.05) && presque(dist(ne, se), 15, 0.05), `${dist(nw, sw)} / ${dist(ne, se)}`);
    const c = MOYENNE(r);
    vrai(`… centré sur l'adresse`, presque(c[0], lat, 1e-9) && presque(c[1], -72.75, 1e-9), JSON.stringify(c));
    vrai(`… coins dans l'ordre nord-ouest, nord-est, sud-est, sud-ouest`, nw[0] > lat && nw[1] < -72.75 && ne[0] > lat && ne[1] > -72.75 && se[0] < lat && se[1] > -72.75 && sw[0] < lat && sw[1] < -72.75);
  }
  const grand = m.run('zoneRectangleDepart(46.5, -72.75, 30)');
  vrai('un autre côté (30 m) se demande en paramètre', presque(dist(grand[0], grand[1]), 30, 0.1) && presque(dist(grand[0], grand[3]), 30, 0.1));
  eq('sans côté donné : la constante de Joé, 15 m', m.run('ZONE_COTE_DEPART_M'), 15);
  eq('le zoom d\'édition maximal : 19 (à 19, 15 m font 73 px : de la place pour les doigts)', m.run('ZONE_ZOOM_MAX'), 19);

  const rect = m.run('zoneRectangleDepart(46.5, -72.75)');
  vrai('l\'aire du rectangle de départ : 225 m² (15 × 15)', presque(m.run(`zoneAireM2(${JSON.stringify(rect)})`), 225, 1));
  eq('l\'aire d\'un triangle rectangle de 30 m sur 20 m : 300 m²', Math.round(m.run(`zoneAireM2([[46.5, -72.75], [46.5, ${-72.75 + 30 / (111320 * Math.cos(46.5 * Math.PI / 180))}], [${46.5 + 20 / 111320}, -72.75]])`)), 300);
  eq('l\'aire ne dépend pas du sens des coins (horaire ou anti-horaire)', m.run(`zoneAireM2(${JSON.stringify(rect)})`), m.run(`zoneAireM2(${JSON.stringify([...rect].reverse())})`));
  eq('quatre coins au même endroit : aire 0', m.run('zoneAireM2([[46.5,-72.75],[46.5,-72.75],[46.5,-72.75],[46.5,-72.75]])'), 0);

  eq('le rectangle ne se croise pas', m.run(`zoneSeCroise(${JSON.stringify(rect)})`), false);
  eq('deux coins échangés (nœud papillon) : les côtés se croisent', m.run(`zoneSeCroise(${JSON.stringify([rect[1], rect[0], rect[2], rect[3]])})`), true);
  eq('… l\'autre échange aussi (coins du bas)', m.run(`zoneSeCroise(${JSON.stringify([rect[0], rect[1], rect[3], rect[2]])})`), true);
  eq('un triangle ne se croise pas', m.run('zoneSeCroise([[46.5,-72.75],[46.5,-72.7],[46.55,-72.72]])'), false);
  eq('une forme en L (6 coins, creuse mais sans croisement) est permise', m.run('zoneSeCroise([[0,0],[0,2],[1,2],[1,1],[2,1],[2,0]])'), false);
  eq('un huit à 6 coins se croise', m.run('zoneSeCroise([[0,0],[2,2],[0,2],[2,0],[3,1],[1,-1]])'), true);
  eq('un quadrilatère quelconque mais simple (trapèze) ne se croise pas', m.run('zoneSeCroise([[46.5,-72.75],[46.5,-72.74],[46.501,-72.7415],[46.501,-72.7485]])'), false);

  for (const [nom, v, attendu] of [
    ['null', 'null', false], ['un texte', '"abc"', false], ['une liste vide', '[]', false], ['deux coins seulement', '[[46,-72],[46.1,-72]]', false],
    ['un coin avec du texte', '[[46,-72],[46.1,"a"],[46,-72.1]]', false], ['des chiffres écrits en texte', '[[46,-72],["46.1","-72"],[46,-72.1]]', false], ['un coin à trois nombres', '[[46,-72,1],[46.1,-72],[46,-72.1]]', false],
    ['un coin non fini', '[[46,-72],[NaN,-72],[46,-72.1]]', false], ['une latitude au-delà de 90', '[[46,-72],[91,-72],[46,-72.1]]', false], ['une longitude au-delà de 180', '[[46,-72],[46,181],[46,-72.1]]', false],
    ['trois coins bons', '[[46,-72],[46.1,-72],[46,-72.1]]', true], ['un objet au lieu d\'une liste', '{"0":[46,-72]}', false],
  ]) eq(`zoneValide : ${nom}`, m.run(`zoneValide(${v})`), attendu);

  eq('zoneErreur : le rectangle de départ est bon', m.run(`zoneErreur(${JSON.stringify(rect)})`), null);
  eq('… deux coins échangés : « Les côtés de la zone se croisent »', m.run(`zoneErreur(${JSON.stringify([rect[1], rect[0], rect[2], rect[3]])})`), 'Les côtés de la zone se croisent : déplace un coin.');
  eq('… coins ramenés ensemble : « La zone est trop petite »', m.run('zoneErreur([[46.5,-72.75],[46.5,-72.75],[46.5,-72.75],[46.5,-72.75]])'), 'La zone est trop petite.');
  eq('… une zone de 4 m² est acceptée (le minimum est de 2 m²)', m.run(`zoneErreur(zoneRectangleDepart(46.5, -72.75, 2))`), null);
  eq('… 1 m × 1 m est trop petit (1 m²)', m.run(`zoneErreur(zoneRectangleDepart(46.5, -72.75, 1))`), 'La zone est trop petite.');
  eq('… une zone illisible : « pas valide »', m.run('zoneErreur([[1,2]])'), 'La zone n’est pas valide.');
  eq('zoneArrondie : 7 décimales (environ 1 cm)', m.run('zoneArrondie([[46.123456789012, -72.987654321098], [1, 2], [3, 4]])'), [[46.1234568, -72.9876543], [1, 2], [3, 4]]);
}

// =====================================================================
log('\n=== L\'ÉDITEUR : 4 COINS QUI SE DÉPLACENT, LE POLYGONE LES SUIT ===');
{
  const m = monde();
  m.run('activeIdx = 1');
  m.el('stop-card').classList.add('open');
  eq('avant : aucun éditeur, la barre est cachée', [m.actif(), m.barreOuverte()], [false, false]);
  const { rec, r } = ouvrirDirect(m);
  eq('demarrerEditeurZone renvoie true', r, true);
  eq('l\'éditeur est ouvert, la barre est là', [m.actif(), m.barreOuverte()], [true, true]);
  const poly = m.polyEditeur();
  const rectangle = m.run('zoneRectangleDepart(46.55, -72.75)');
  eq('le polygone est le rectangle de départ de 15 m × 15 m centré sur l\'adresse', poly.pts, rectangle);
  eq('… dessiné en pointillés vert-jaune, SANS capter les touchers (interactive:false : les coins restent atteignables)', [poly.opts.color, poly.opts.dashArray, poly.opts.interactive], ['#c8e63c', '6', false]);
  const p = m.poignees();
  eq('4 poignées, une par coin', p.map((x) => x.ll), rectangle);
  eq('… déplaçables', p.map((x) => x.opts.draggable), [true, true, true, true]);
  eq('… au-dessus des autres marqueurs (zIndexOffset 2000) et sans clavier', [p[0].opts.zIndexOffset, p[0].opts.keyboard], [2000, false]);
  eq('… une grande zone à toucher : 44 px, ancrée au centre (un doigt, un gant)', [p[0].opts.icon.iconSize, p[0].opts.icon.iconAnchor, p[0].opts.icon.className], [[44, 44], [22, 22], 'zone-poignee']);
  eq('la fiche du client se range (elle ne reste pas sous la barre)', [m.el('stop-card').classList.contains('open'), m.run('activeIdx')], [false, null]);
  eq('le titre, l\'adresse et la surface sont écrits dans la barre', [m.el('zone-titre').textContent, m.el('zone-adresse').textContent, m.info()], ['📍 Titre d\'essai', '245 rue Test', '≈ 225 m²']);
  eq('le bouton « sans zone » est là, avec son libellé', [m.el('zone-sans').style.display, m.el('zone-sans').textContent], ['', 'Passer (sans zone)']);
  eq('« Enregistrer » est actif', m.el('zone-ok').disabled, false);
  const vue = m.carte.appels.filter((a) => a.f === 'flyToBounds');
  eq('la carte se place sur la zone : UN vol vers le rectangle', vue.length, 1);
  eq('… au zoom 19 au plus, avec de la place pour la barre du haut et celle du bas', [vue[0].pts, vue[0].o.maxZoom, vue[0].o.paddingTopLeft, vue[0].o.paddingBottomRight], [rectangle, 19, [40, 80], [40, 170]]);

  // un coin est tiré : le polygone suit, la surface se recalcule
  m.glisser(2, 46.5497, -72.7493);
  eq('un coin tiré : le polygone le suit', m.polyEditeur().pts[2], [46.5497, -72.7493]);
  eq('… les autres coins n\'ont pas bougé', [0, 1, 3].map((i) => m.polyEditeur().pts[i]), [0, 1, 3].map((i) => rectangle[i]));
  vrai('… le polygone a été mis à jour (setLatLngs) à chaque pas', m.polyEditeur().misesAJour >= 2, String(m.polyEditeur().misesAJour));
  eq('… la surface est recalculée', m.info(), '≈ ' + Math.round(m.run('zoneAireM2(zoneEd.points)')) + ' m²');
  vrai('… et elle a changé', m.info() !== '≈ 225 m²', m.info());
  eq('… « Enregistrer » reste actif', m.el('zone-ok').disabled, false);
  m.pas(0, 46.55041, -72.75051);
  eq('un PAS du glissement (le doigt est encore posé) met déjà le polygone à jour', m.polyEditeur().pts[0], [46.55041, -72.75051]);
  m.lacher(0, 46.55042, -72.75052);
  eq('… et le moment où le doigt se lève aussi (le dernier point compte)', m.polyEditeur().pts[0], [46.55042, -72.75052]);
  m.glisser(0, rectangle[0][0], rectangle[0][1]);

  // sans titre ni libellé donnés : ceux de départ
  const q = monde();
  q.run('demarrerEditeurZone({lat:46.55, lon:-72.75, sans: async () => true})');
  eq('sans titre, adresse ni libellé donnés : « Glisse les coins sur le terrain », adresse vide, « Sans zone »', [q.el('zone-titre').textContent, q.el('zone-adresse').textContent, q.el('zone-sans').textContent], ['✏ Glisse les coins sur le terrain', '', 'Sans zone']);
  eq('… sans action « enregistrer » : rien ne plante, « Enregistrer » ne fait rien', await q.run('zoneEnregistrer()').then(() => q.actif()), true);

  // deux coins échangés : nœud papillon
  m.glisser(0, rectangle[1][0], rectangle[1][1]); m.glisser(1, rectangle[0][0], rectangle[0][1]);
  eq('deux coins échangés : la barre le dit, en rouge', [m.info(), m.el('zone-info').className], ['⚠ Les côtés de la zone se croisent : déplace un coin.', 'err']);
  eq('… « Enregistrer » est grisé', m.el('zone-ok').disabled, true);
  await m.run('zoneEnregistrer()');
  eq('… et même forcé, rien n\'est enregistré : un message', [rec.enregistrer.length, m.dernierToast()], [0, '⚠ Les côtés de la zone se croisent : déplace un coin.']);
  m.glisser(0, rectangle[0][0], rectangle[0][1]); m.glisser(1, rectangle[1][0], rectangle[1][1]);
  eq('les coins remis en place : plus d\'erreur, « Enregistrer » revient', [m.el('zone-info').className, m.el('zone-ok').disabled], ['', false]);

  // les 4 coins ramenés ensemble
  for (const i of [0, 1, 2, 3]) m.glisser(i, 46.55, -72.75);
  eq('les 4 coins au même point : « trop petite », « Enregistrer » grisé', [m.info(), m.el('zone-ok').disabled], ['⚠ La zone est trop petite.', true]);
  await m.run('zoneEnregistrer()');
  eq('… rien n\'est enregistré non plus', [rec.enregistrer.length, m.dernierToast()], [0, '⚠ La zone est trop petite.']);
  for (const i of [0, 1, 2, 3]) m.glisser(i, rectangle[i][0], rectangle[i][1]);
  m.glisser(3, 46.5496, -72.75043);

  // Enregistrer : le dessin part, arrondi à 7 décimales
  m.glisser(1, 46.549712345678, -72.749412345678);
  const attendu = m.run('zoneArrondie(zoneEd.points)');
  await m.run('zoneEnregistrer()');
  eq('« Enregistrer » envoie les 4 coins de l\'éditeur, arrondis (une fois)', [rec.enregistrer.length, rec.enregistrer[0]], [1, attendu]);
  eq('… le coin tiré est bien dedans, arrondi à 7 décimales', rec.enregistrer[0][1], [46.5497123, -72.7494123]);
  eq('… fini : l\'éditeur est fermé, la barre cachée', [m.actif(), m.barreOuverte()], [false, false]);
  vrai('… le polygone et les 4 poignées sont retirés de la carte', m.polygones.filter((x) => x.opts.interactive === false).every((x) => x.retire) && m.marqueurs.filter((x) => x.opts.draggable).every((x) => x.retire));
  eq('… le rappel « annule » n\'a pas été appelé', rec.annule, 0);
  await m.run('zoneEnregistrer()');
  eq('un « Enregistrer » sans éditeur ouvert ne fait rien', rec.enregistrer.length, 1);
}

log('\n=== L\'ÉDITEUR : ENREGISTRER PREND DU TEMPS, ÉCHOUE, RÉUSSIT ===');
{
  // pendant l'envoi : rien ne se double, rien ne s'annule
  const m = monde();
  let finir = null; const recu = [];
  ouvrirDirect(m, { enregistrer: (pts) => new Promise((res) => { recu.push(pts); finir = res; }) });
  const attente = m.run('zoneEnregistrer()');
  eq('pendant l\'envoi : les trois boutons sont bloqués', [m.el('zone-ok').disabled, m.el('zone-sans').disabled, m.el('zone-annuler').disabled], [true, true, true]);
  await m.run('zoneEnregistrer()');
  await m.run('zoneSansZone()');
  m.run('zoneAnnuler()');
  eq('… un deuxième toucher n\'envoie rien de plus, « sans zone » et « annuler » sont ignorés : l\'éditeur reste ouvert', [recu.length, m.actif()], [1, true]);
  finir(true); await attente;
  eq('l\'envoi réussit : l\'éditeur se ferme', [m.actif(), m.barreOuverte()], [false, false]);

  // refus : l'éditeur reste, le dessin aussi
  const n = monde();
  const { rec } = ouvrirDirect(n);
  n.glisser(0, 46.5504, -72.7505);
  rec.reponse = false;
  await n.run('zoneEnregistrer()');
  eq('l\'envoi est refusé (false) : l\'éditeur reste ouvert', [n.actif(), n.barreOuverte()], [true, true]);
  eq('… le dessin n\'est pas perdu', n.polyEditeur().pts[0], [46.5504, -72.7505]);
  eq('… les boutons sont libres pour réessayer', [n.el('zone-ok').disabled, n.el('zone-sans').disabled, n.el('zone-annuler').disabled], [false, false, false]);
  rec.reponse = true;
  await n.run('zoneEnregistrer()');
  eq('on réessaie : ça part avec le même dessin, puis l\'éditeur se ferme', [rec.enregistrer.length, rec.enregistrer[1][0], n.actif()], [2, [46.5504, -72.7505], false]);

  // un plantage (réseau) : un message, l'éditeur reste
  const p = monde();
  ouvrirDirect(p, { enregistrer: async () => { throw new Error('Failed to fetch'); } });
  await p.run('zoneEnregistrer()');
  eq('l\'envoi plante : « Erreur réseau », l\'éditeur reste ouvert et libre', [p.dernierToast(), p.actif(), p.el('zone-ok').disabled], ['❌ Erreur réseau', true, false]);

  // « sans zone »
  const s = monde();
  const r2 = ouvrirDirect(s);
  await s.run('zoneSansZone()');
  eq('« Passer (sans zone) » appelle l\'action « sans zone » avec null (aucune zone), pas « enregistrer »', [r2.rec.sans, r2.rec.enregistrer.length], [[null], 0]);
  eq('… puis l\'éditeur se ferme', [s.actif(), s.barreOuverte()], [false, false]);
  const s2 = monde();
  const r3 = ouvrirDirect(s2, { sansBouton: true });
  eq('sans action « sans zone » : le bouton est caché', s2.el('zone-sans').style.display, 'none');
  await s2.run('zoneSansZone()');
  eq('… et le toucher ne fait rien', [r3.rec.sans.length, s2.actif()], [0, true]);

  // annuler
  const a = monde();
  const r4 = ouvrirDirect(a);
  a.glisser(0, 46.5504, -72.7505);
  a.run('zoneAnnuler()');
  eq('« ✕ » : l\'éditeur se ferme, le rappel « annule » est appelé, rien n\'est enregistré', [a.actif(), a.barreOuverte(), r4.rec.annule, r4.rec.enregistrer.length, r4.rec.sans.length], [false, false, 1, 0, 0]);
  a.run('zoneAnnuler()');
  eq('un « ✕ » sans éditeur ouvert ne fait rien (le rappel n\'est pas rappelé)', r4.rec.annule, 1);

  // un deuxième éditeur remplace le premier, sans rien appeler
  const d = monde();
  const r5 = ouvrirDirect(d);
  const premierPoly = d.polyEditeur(), premieresPoignees = d.poignees();
  const r6 = ouvrirDirect(d);
  eq('ouvrir un 2ᵉ éditeur : le premier est retiré de la carte (polygone et poignées)', [premierPoly.retire, premieresPoignees.every((x) => x.retire), d.poignees().length], [true, true, 4]);
  eq('… sans rien enregistrer ni annuler pour le premier', [r5.rec.enregistrer.length, r5.rec.sans.length, r5.rec.annule], [0, 0, 0]);
  await d.run('zoneEnregistrer()');
  eq('… le second reste utilisable', [r6.rec.enregistrer.length, d.actif()], [1, false]);

  // une zone existante : c'est SON dessin qui s'ouvre, en copie
  const e = monde();
  const zone = [[46.55, -72.75], [46.5501, -72.75], [46.5501, -72.7499], [46.55, -72.7499]];
  ouvrirDirect(e, { points: zone });
  eq('avec des coins donnés : ce sont eux qui s\'ouvrent (pas le rectangle de départ)', e.polyEditeur().pts, zone);
  e.glisser(0, 46.5, -72.7);
  eq('… déplacer un coin ne change pas la zone d\'origine (une copie)', zone[0], [46.55, -72.75]);
  const f = monde();
  ouvrirDirect(f, { points: [[46.5, -72.7], [46.6, -72.7]] });
  eq('des coins illisibles (2 seulement) : retour au rectangle de départ', f.polyEditeur().pts, f.run('zoneRectangleDepart(46.55, -72.75)'));
  eq('sans carte : demarrerEditeurZone renvoie false et n\'ouvre rien', (() => { const g = monde(); g.run('map = null'); return [g.run('demarrerEditeurZone({lat:46.5, lon:-72.75})'), g.actif()]; })(), [false, false]);
}

// =====================================================================
log('\n=== « ＋ NOUVEAU STOP » : APRÈS L\'ADRESSE, LA ZONE SE DESSINE (rectangle de départ), PUIS L\'ARRÊT EST ENREGISTRÉ ===');
{
  const remplir = (m, o = {}) => {
    m.run('openModal()');
    m.el('f-addr').value = o.adresse ?? '245 Rue de Laubier, Shawinigan';
    m.el('f-client').value = o.client ?? 'Famille Tremblay';
    m.el('f-svc').value = o.service ?? 'Coupe de gazon';
  };
  const m = monde();
  remplir(m);
  eq('le formulaire est ouvert', m.el('overlay').classList.contains('open'), true);
  await m.run('addStop()');
  const nominatim = m.appels.fetch.filter((u) => u.includes('nominatim'));
  eq('l\'adresse est cherchée (une fois)', nominatim, ['https://nominatim.openstreetmap.org/search?q=245%20Rue%20de%20Laubier%2C%20Shawinigan&format=json&limit=1']);
  eq('l\'arrêt n\'est PAS encore enregistré : la zone se dessine d\'abord', [m.ecrituresStops().length, m.run('stops.length')], [0, 4]);
  eq('l\'éditeur est ouvert, sur un rectangle de 15 m centré sur l\'adresse trouvée', [m.actif(), MOYENNE(m.polyEditeur().pts).map((x) => Math.round(x * 1e6) / 1e6)], [true, [46.55, -72.75]]);
  eq('… avec l\'adresse tapée dans la barre, « Passer (sans zone) » et le titre du nouvel arrêt', [m.el('zone-adresse').textContent, m.el('zone-sans').textContent, m.el('zone-titre').textContent, m.el('zone-sans').style.display], ['245 Rue de Laubier, Shawinigan', 'Passer (sans zone)', '📍 Glisse les 4 coins sur le terrain', '']);
  eq('le formulaire se CACHE (on voit la carte) mais garde ses champs', [m.el('overlay').classList.contains('open'), m.el('f-addr').value, m.el('f-client').value, m.el('f-svc').value], [false, '245 Rue de Laubier, Shawinigan', 'Famille Tremblay', 'Coupe de gazon']);
  eq('« ⏳ Géocodage… » n\'est plus affiché', [m.el('geo-st').textContent, m.el('geo-st').className], ['', '']);

  m.glisser(2, 46.55008, -72.74988);   // un coin tiré vers le terrain réel
  const dessin = m.run('zoneArrondie(zoneEd.points)');
  await m.run('zoneEnregistrer()');
  const ecr = m.ecrituresStops();
  eq('« Enregistrer » : UNE insertion dans stops', [ecr.length, ecr[0].op], [1, 'insert']);
  const ligne = ecr[0].valeur[0];
  eq('… l\'adresse, le client, le service, la position trouvée', [ligne.adresse, ligne.client, ligne.service, ligne.lat, ligne.lon], ['245 Rue de Laubier, Shawinigan', 'Famille Tremblay', 'Coupe de gazon', 46.55, -72.75]);
  eq('… la zone dessinée (4 coins arrondis)', ligne.zone_points, dessin);
  eq('… la route (aucune route choisie), la place dans l\'ordre (à la fin : 4)', [ligne.route_id, ligne.ordre], [null, 4]);
  eq('l\'arrêt est ajouté à la liste avec sa zone', [m.run('stops.length'), m.run('stops[4].zone_points'), m.run('stops[4].id')], [5, dessin, 's-nouveau']);
  eq('la carte s\'y rend (zoom 17), message de réussite', [m.carte.appels.filter((a) => a.f === 'flyTo').at(-1)?.z, m.dernierToast()], [17, '📍 Stop ajouté !']);
  eq('l\'éditeur est fermé', [m.actif(), m.barreOuverte()], [false, false]);
  vrai('la zone du nouvel arrêt est dessinée par renderAll (couleur d\'un arrêt, pas en pointillés)', m.zones().some((z) => JSON.stringify(z.pts) === JSON.stringify(dessin)), JSON.stringify(m.zones().map((z) => z.pts)));
  m.vider();
  eq('le formulaire se referme peu après', m.el('overlay').classList.contains('open'), false);
}
{
  // « Passer (sans zone) » : comme avant
  const m = monde(); m.run('openModal()'); m.el('f-addr').value = '1 rue Test';
  await m.run('addStop()');
  await m.run('zoneSansZone()');
  const ligne = m.ecrituresStops()[0].valeur[0];
  eq('« Passer (sans zone) » : l\'arrêt est enregistré SANS zone (comme avant la demande 3)', [ligne.adresse, ligne.zone_points, ligne.client], ['1 rue Test', null, null]);
  eq('… l\'éditeur est fermé, l\'arrêt est dans la liste', [m.actif(), m.run('stops.length')], [false, 5]);
}
{
  // « ✕ » : retour au formulaire, rien d'enregistré
  const m = monde(); m.run('openModal()'); m.el('f-addr').value = '1 rue Test'; m.el('f-client').value = 'Untel';
  await m.run('addStop()');
  m.run('zoneAnnuler()');
  eq('« ✕ » : le formulaire revient avec ses champs, rien n\'est enregistré, l\'éditeur est fermé', [m.el('overlay').classList.contains('open'), m.el('f-addr').value, m.el('f-client').value, m.ecrituresStops().length, m.actif()], [true, '1 rue Test', 'Untel', 0, false]);
  await m.run('addStop()');
  eq('« Ajouter » de nouveau : la zone se redessine (rectangle neuf)', [m.actif(), m.el('overlay').classList.contains('open')], [true, false]);
}
{
  // un refus de la base : l'éditeur reste, on peut réessayer
  const m = monde({ reponses: { 'stops.insert': { data: null, error: { message: 'refusé' } } } });
  m.run('openModal()'); m.el('f-addr').value = '1 rue Test';
  await m.run('addStop()');
  m.glisser(0, 46.5504, -72.7505);
  await m.run('zoneEnregistrer()');
  eq('la base refuse : le message, l\'éditeur reste ouvert avec le dessin', [m.dernierToast(), m.actif(), m.polyEditeur().pts[0], m.run('stops.length')], ['❌ refusé', true, [46.5504, -72.7505], 4]);
  eq('… l\'état du formulaire dit que rien n\'est enregistré', [m.el('geo-st').className, m.el('geo-st').textContent], ['err', '❌ L’arrêt n’a pas été enregistré']);
  delete m.reponses['stops.insert'];
  await m.run('zoneEnregistrer()');
  eq('on réessaie : ça passe, avec le MÊME dessin', [m.actif(), m.run('stops.length'), m.ecrituresStops().at(-1).valeur[0].zone_points[0]], [false, 5, [46.5504, -72.7505]]);
}
{
  // l'ordre est celui de l'enregistrement, pas celui de l'adresse trouvée ; la route choisie est gardée
  const m = monde(); m.run('openModal()'); m.el('f-addr').value = '1 rue Test'; m.run("routeActive = 'r1'");
  await m.run('addStop()');
  m.run("stops.push({id:'sx', adresse:'x', lat:1, lon:1, ordre:9, actif:true, route_id:'r1'})");
  await m.run('zoneSansZone()');
  const ligne = m.ecrituresStops()[0].valeur[0];
  eq('la route affichée est gardée ; « ordre » compte les arrêts au moment d\'enregistrer (un arrêt est arrivé pendant le dessin : 5)', [ligne.route_id, ligne.ordre], ['r1', 5]);
}
{
  // le mode « Placer sur la carte » (4 touchers) a déjà dessiné la zone : pas d'éditeur
  const m = monde(); m.run('openModal()'); m.el('f-addr').value = '1 rue Test';
  const zone = [[46.51, -72.71], [46.51, -72.7], [46.5, -72.7], [46.5, -72.71]];
  m.run(`window._zonePoints = ${JSON.stringify(zone)}; window._zoneLat = 46.505; window._zoneLon = -72.705;`);
  await m.run('addStop()');
  eq('zone déjà dessinée par « Placer sur la carte » : AUCUN éditeur', [m.actif(), m.barreOuverte()], [false, false]);
  const ligne = m.ecrituresStops()[0].valeur[0];
  eq('… l\'arrêt est enregistré tout de suite, avec cette zone et le centre calculé', [ligne.zone_points, ligne.lat, ligne.lon], [zone, 46.505, -72.705]);
  eq('… les points gardés en mémoire sont effacés', [m.run('window._zonePoints'), m.run('window._zoneLat'), m.run('window._zoneLon')], [null, null, null]);
}
{
  const m = monde({ geocode: [] });
  m.run('openModal()'); m.el('f-addr').value = 'nulle part';
  await m.run('addStop()');
  eq('adresse introuvable : « ❌ Adresse introuvable », ni éditeur ni enregistrement', [m.el('geo-st').textContent, m.el('geo-st').className, m.actif(), m.ecrituresStops().length, m.el('overlay').classList.contains('open')], ['❌ Adresse introuvable', 'err', false, 0, true]);
  const n = monde({ fetchLance: true });
  n.run('openModal()'); n.el('f-addr').value = 'x';
  await n.run('addStop()');
  eq('pas de réseau (le service d\'adresses ne répond pas) : « ❌ Erreur réseau », ni éditeur ni enregistrement', [n.el('geo-st').textContent, n.actif(), n.ecrituresStops().length], ['❌ Erreur réseau', false, 0]);
  const v = monde();
  v.run('openModal()');
  await v.run('addStop()');
  eq('sans adresse : un message, rien d\'autre', [v.dernierToast(), v.appels.fetch.filter((u) => u.includes('nominatim')).length, v.actif()], ['⚠ Entrez une adresse', 0, false]);
}
{
  // le suivi de la carte : « ＋ Nouveau stop » l'arrête (la carte va vers l'adresse)
  const m = monde({ utilisateur: ADMIN });
  m.ctx.window._uMk = m.ctx.L.marker([46.5, -72.7]);
  m.run('lastPos = [46.5, -72.7]');
  m.run('basculerSuiviCarte()');
  eq('(mise en place) ◎ allumé', m.suivi(), { type: 'moi', auto: false, attache: true });
  m.run('openModal()'); m.el('f-addr').value = '1 rue Test';
  await m.run('addStop()');
  eq('l\'éditeur s\'ouvre : le suivi de la carte est ARRÊTÉ (la carte va vers l\'adresse)', [m.suivi(), m.el('btn-suivi').classList.contains('on')], [null, false]);
  m.run('zoneAnnuler()');
  eq('… et ne revient pas tout seul à l\'annulation', m.suivi(), null);
}
{
  // sans le fichier de l'éditeur (ancienne version) : comme avant, l'arrêt est enregistré tout de suite
  const m = monde({ sansZone: true });
  m.run('openModal()'); m.el('f-addr').value = '1 rue Test';
  await m.run('addStop()');
  const ligne = m.ecrituresStops()[0]?.valeur[0];
  eq('sans zone-terrain.js : l\'arrêt est enregistré directement, sans zone', [ligne?.adresse, ligne?.zone_points], ['1 rue Test', null]);
}

// =====================================================================
log('\n=== LA FICHE D\'UN CLIENT : « ✏ MODIFIER LA ZONE » (l\'administrateur seulement) ===');
{
  const e = monde({ utilisateur: LUC });
  e.run('openCard(1)');
  eq('un EMPLOYÉ ne voit pas le bouton', e.el('btn-zone').style.display, 'none');
  e.run('modifierZoneArret()');
  eq('… et même s\'il appelait la fonction, rien ne s\'ouvre', [e.actif(), e.barreOuverte()], [false, false]);

  const m = monde({ utilisateur: ADMIN });
  m.run('openCard(0)');
  eq('l\'administrateur, arrêt SANS zone : « ✏ Dessiner la zone »', [m.el('btn-zone').style.display, m.el('btn-zone').textContent], ['inline-block', '✏ Dessiner la zone']);
  m.run('openCard(1)');
  eq('… arrêt AVEC zone : « ✏ Modifier la zone »', [m.el('btn-zone').style.display, m.el('btn-zone').textContent], ['inline-block', '✏ Modifier la zone']);
  m.run('stops[1].zone_points = [[1,2]]; majCarte()');
  eq('… une zone illisible dans la base compte comme « pas de zone »', m.el('btn-zone').textContent, '✏ Dessiner la zone');
  m.run(`stops[1].zone_points = ${JSON.stringify(ZONE_S2)}; majCarte()`);

  // arrêt avec zone : l'éditeur s'ouvre sur SA zone
  m.run('renderAll()');
  eq('(mise en place) les zones de s2 et de s4 sont dessinées', m.zones().map((z) => z.pts), [ZONE_S2, ZONE_S4]);
  const ancienne = m.zones()[0];
  m.run('openCard(1)');
  eq('(fiche de s2 ouverte)', [m.el('stop-card').classList.contains('open'), m.run('activeIdx')], [true, 1]);
  m.run('modifierZoneArret()');
  eq('« ✏ Modifier la zone » : l\'éditeur s\'ouvre sur la zone EXISTANTE de l\'arrêt', [m.actif(), m.polyEditeur().pts], [true, ZONE_S2]);
  eq('… l\'ancienne zone de s2 disparaît DÈS L\'OUVERTURE (sinon, un coin tiré, l\'ancienne resterait derrière le nouveau dessin) ; celle de s4 reste', [ancienne.retire, m.zones().map((z) => z.pts)], [true, [ZONE_S4]]);
  eq('… la fiche est rangée', [m.el('stop-card').classList.contains('open'), m.run('activeIdx')], [false, null]);
  eq('… titre « Ajuste les coins de la zone », adresse de l\'arrêt, bouton « Retirer la zone »', [m.el('zone-titre').textContent, m.el('zone-adresse').textContent, m.el('zone-sans').textContent, m.el('zone-sans').style.display], ['✏ Ajuste les coins de la zone', '220 rue du Moulin', 'Retirer la zone', '']);
  eq('… le zoom part vers la zone', m.carte.appels.filter((a) => a.f === 'flyToBounds').at(-1).pts, ZONE_S2);
  // l'ancienne zone de cet arrêt n'est plus dessinée pendant l'édition (le polygone de l'éditeur la remplace) ; celle des autres reste
  m.run('renderAll()');
  eq('pendant l\'édition, renderAll ne redessine PAS l\'ancienne zone de cet arrêt (seule celle de s4 reste)', m.zones().map((z) => z.pts), [ZONE_S4]);
  // un toucher sur un marqueur de client ne doit rien ouvrir
  m.run('openCard(0)');
  eq('toucher un client pendant l\'édition : sa fiche NE s\'ouvre PAS', [m.el('stop-card').classList.contains('open'), m.run('activeIdx')], [false, null]);
  // annuler : l'ancienne zone revient
  m.glisser(0, 46.5, -72.9);
  m.run('zoneAnnuler()');
  eq('« ✕ » : l\'ancienne zone revient à l\'écran, telle quelle', m.zones().map((z) => z.pts), [ZONE_S2, ZONE_S4]);
  eq('… rien n\'a été écrit, la zone de l\'arrêt n\'a pas bougé', [m.ecrituresStops().length, m.run('stops[1].zone_points')], [0, ZONE_S2]);
  m.run('openCard(0)');
  eq('… et une fiche peut de nouveau s\'ouvrir', m.run('activeIdx'), 0);
}
{
  // enregistrer la zone corrigée
  const m = monde({ utilisateur: ADMIN });
  m.run('openCard(1)'); m.run('modifierZoneArret()');
  m.glisser(1, 46.44312, -72.92176);
  const dessin = m.run('zoneArrondie(zoneEd.points)');
  await m.run('zoneEnregistrer()');
  const ecr = m.ecrituresStops();
  eq('« Enregistrer » : UNE mise à jour de stops, de CET arrêt, avec la zone (et rien d\'autre)', [ecr.length, ecr[0].op, ecr[0].valeur, ecr[0].filtres], [1, 'update', { zone_points: dessin }, [['id', 's2']]]);
  eq('… la réponse est demandée (select) : un refus muet de la base se verrait', ecr[0].retour, 'id');
  eq('la zone de l\'arrêt est à jour ici aussi, et redessinée (couleur d\'un arrêt)', [m.run('stops[1].zone_points'), m.zones().map((z) => z.pts)], [dessin, [dessin, ZONE_S4]]);
  eq('message de réussite, éditeur fermé', [m.dernierToast(), m.actif(), m.barreOuverte()], ['✔ Zone enregistrée', false, false]);
  eq('le repère du client ne change JAMAIS ici (seule zone_points est écrite)', Object.keys(ecr[0].valeur), ['zone_points']);
}
{
  // un arrêt sans zone : le rectangle de départ autour de son repère
  const m = monde({ utilisateur: ADMIN });
  m.run('openCard(0)'); m.run('modifierZoneArret()');
  eq('arrêt sans zone : le rectangle de 15 m s\'ouvre autour de son repère', [m.actif(), MOYENNE(m.polyEditeur().pts).map((x) => Math.round(x * 1e6) / 1e6)], [true, [46.44, -72.92]]);
  eq('… titre « Glisse les coins sur le terrain », PAS de « Retirer la zone » (il n\'y en a pas)', [m.el('zone-titre').textContent, m.el('zone-sans').style.display], ['✏ Glisse les coins sur le terrain', 'none']);
  await m.run('zoneEnregistrer()');
  eq('enregistrer le rectangle tel quel : la zone est écrite pour s1', [m.ecrituresStops()[0].filtres, m.ecrituresStops()[0].valeur.zone_points.length], [[['id', 's1']], 4]);
}
{
  // retirer la zone
  const m = monde({ utilisateur: ADMIN });
  m.run('openCard(1)'); m.run('modifierZoneArret()');
  m.repondre(false);
  await m.run('zoneSansZone()');
  eq('« Retirer la zone » : une confirmation est demandée (avec l\'adresse) ; « Garder » : rien n\'est écrit et l\'éditeur reste', [m.appels.confirmations.length, m.appels.confirmations[0][0], m.appels.confirmations[0][1].includes('220 rue du Moulin'), m.ecrituresStops().length, m.actif()], [1, 'Retirer la zone ?', true, 0, true]);
  eq('… la boîte propose « Retirer » (oui) puis « Garder » (non), dans cet ordre', [m.appels.confirmations[0][2], m.appels.confirmations[0][3]], ['Retirer', 'Garder']);
  eq('… les boutons sont libres', [m.el('zone-ok').disabled, m.el('zone-annuler').disabled], [false, false]);
  m.repondre(true);
  await m.run('zoneSansZone()');
  const ecr = m.ecrituresStops();
  eq('« Retirer » : la zone devient null pour cet arrêt (l\'arrêt reste)', [ecr.length, ecr[0].op, ecr[0].valeur, ecr[0].filtres], [1, 'update', { zone_points: null }, [['id', 's2']]]);
  eq('… plus de zone ici, l\'arrêt est toujours là, message, éditeur fermé', [m.run('stops[1].zone_points'), m.run('stops.length'), m.dernierToast(), m.actif()], [null, 4, '🗑 Zone retirée', false]);
  eq('… plus de polygone pour s2 (celui de s4 reste)', m.zones().map((z) => z.pts), [ZONE_S4]);
}
{
  // pas de réseau, refus, arrêt disparu, arrêt sans position
  const m = monde({ utilisateur: ADMIN });
  m.run('openCard(1)'); m.run('modifierZoneArret()');
  m.run('reseau.enLigne = false');
  await m.run('zoneEnregistrer()');
  eq('hors réseau : un message, RIEN n\'est écrit, l\'éditeur reste ouvert', [m.dernierToast(), m.ecrituresStops().length, m.actif()], ['📴 Pas de réseau : la zone ne peut pas être enregistrée maintenant.', 0, true]);
  m.run('reseau.enLigne = true');
  m.reponses['stops.update'] = { data: null, error: { message: 'Failed to fetch' } };
  await m.run('zoneEnregistrer()');
  eq('le signal disparaît pendant l\'envoi : « Le signal a disparu », l\'éditeur reste ouvert', [m.dernierToast(), m.actif()], ['📴 Le signal a disparu : la zone n’a pas été enregistrée.', true]);
  eq('… et le téléphone se sait hors réseau ensuite', m.run('reseau.enLigne'), false);
  m.run('reseau.enLigne = true');
  m.reponses['stops.update'] = { data: null, error: { message: 'permission denied' } };
  await m.run('zoneEnregistrer()');
  eq('un refus du serveur : « n\'a pas pu être enregistrée » (ce n\'est PAS une zone morte : le téléphone reste en ligne)', [m.dernierToast(), m.actif(), m.run('reseau.enLigne')], ['❌ La zone n’a pas pu être enregistrée.', true, true]);
  m.reponses['stops.update'] = { data: [], error: null };
  await m.run('zoneEnregistrer()');
  eq('aucune ligne changée (arrêt disparu, ou accès refusé sans erreur) : le dit, l\'éditeur reste', [m.dernierToast(), m.actif(), m.run('stops[1].zone_points')], ['❌ La zone n’a pas été enregistrée (arrêt introuvable ou accès refusé).', true, ZONE_S2]);
  m.reponses['stops.update'] = { data: null, lance: new Error('Failed to fetch') };
  await m.run('zoneEnregistrer()');
  eq('la requête PLANTE (réseau) : « Le signal a disparu », l\'éditeur reste', [m.dernierToast(), m.actif()], ['📴 Le signal a disparu : la zone n’a pas été enregistrée.', true]);
  eq('… et le téléphone se sait hors réseau ensuite', m.run('reseau.enLigne'), false);
  m.run('reseau.enLigne = true');
  delete m.reponses['stops.update'];
  await m.run('zoneEnregistrer()');
  eq('le signal est revenu : on réessaie, ça passe avec le même dessin', [m.ecrituresStops().length, m.actif(), m.dernierToast()], [5, false, '✔ Zone enregistrée']);
  eq('… le « ⟳ Sync… » est éteint à chaque fin', m.el('sync').classList.contains('show'), false);
  // pendant l'écriture : « ⟳ Sync… » est allumé
  const l = monde({ utilisateur: ADMIN });
  l.run('openCard(1)'); l.run('modifierZoneArret()');
  let finirEcriture = null;
  l.reponses['stops.update'] = () => new Promise((res) => { finirEcriture = res; });
  const enCours = l.run('zoneEnregistrer()');
  await Promise.resolve(); await Promise.resolve();
  eq('pendant l\'écriture : « ⟳ Sync… » est allumé et les boutons sont bloqués', [l.el('sync').classList.contains('show'), l.el('zone-ok').disabled], [true, true]);
  finirEcriture({ data: [{ id: 's2' }], error: null });
  await enCours;
  eq('… puis éteint, l\'éditeur fermé', [l.el('sync').classList.contains('show'), l.actif()], [false, false]);

  // un arrêt sans position sur la carte
  const n = monde({ utilisateur: ADMIN });
  n.run('openCard(2)');
  n.run('modifierZoneArret()');
  eq('un arrêt sans position (s3) : « n\'a pas de position sur la carte », rien ne s\'ouvre', [n.dernierToast(), n.actif()], ['⚠ Cet arrêt n’a pas de position sur la carte', false]);
  n.run('activeIdx = null');
  n.run('modifierZoneArret()');
  eq('aucune fiche ouverte : la fonction ne fait rien', n.actif(), false);
}
{
  // les arrêts sont relus pendant l'édition (temps réel) : on retrouve l'arrêt par son identifiant, jamais par sa place
  const m = monde({ utilisateur: ADMIN });
  m.run('openCard(1)'); m.run('modifierZoneArret()');
  m.run(`stops = ${JSON.stringify([...STOPS()].reverse())}`);   // l'ordre a changé : s2 n'est plus en 2ᵉ place
  m.run('renderAll()');
  eq('les arrêts relus dans un autre ordre : l\'ancienne zone de s2 reste cachée (par identifiant)', m.zones().map((z) => z.pts), [ZONE_S4]);
  await m.run('zoneEnregistrer()');
  eq('… et la zone enregistrée va bien à s2 (id), pas à un autre', [m.ecrituresStops()[0].filtres, m.run("stops.find(s=>s.id==='s2').zone_points.length"), m.run("stops.find(s=>s.id==='s4').zone_points")], [[['id', 's2']], 4, ZONE_S4]);
}

// =====================================================================
log('\n=== LA CARTE NE FUIT PAS PENDANT QU\'ON DÉPLACE LES COINS (le suivi de la carte) ===');
{
  const m = monde({ utilisateur: ADMIN });
  m.ctx.window._uMk = m.ctx.L.marker([46.5, -72.7]);
  m.run('lastPos = [46.5, -72.7]');
  m.run('basculerSuiviCarte()');
  eq('(mise en place) le suivi est allumé', m.suivi(), { type: 'moi', auto: false, attache: true });
  m.run('openCard(1)');
  eq('la fiche met le suivi en pause', [m.suivi(), m.run('!!_suiviSuspendu')], [null, true]);
  m.run('modifierZoneArret()');
  eq('l\'éditeur s\'ouvre : le suivi reste en pause (il ne reprend pas sous les doigts)', [m.suivi(), m.run('!!_suiviSuspendu')], [null, true]);
  const nbVues = m.carte.appels.length;
  m.run('basculerSuiviCarte()');
  eq('◎ pendant l\'édition : un message, le suivi ne s\'allume pas', [m.dernierToast(), m.suivi(), m.el('btn-suivi').classList.contains('on')], ['✏ Termine d’abord la zone : Enregistrer ou ✕', null, false]);
  eq('demarrerSuiviCarte est refusé aussi (n\'importe quel chemin : « Suivre ce camion », début de passe…)', [m.run("demarrerSuiviCarte({type:'moi'}, {auto:false})"), m.suivi()], [false, null]);
  eq('… la carte n\'a pas bougé', m.carte.appels.length, nbVues);
  m.run('zoneAnnuler()');
  eq('l\'édition finie : le suivi mis en pause par la fiche REPREND (comme à la fermeture d\'une fiche)', [m.suivi(), m.el('btn-suivi').classList.contains('on')], [{ type: 'moi', auto: false, attache: true }, true]);
}
{
  // un suivi mis en pause par la fiche, puis la zone ENREGISTRÉE : il reprend aussi
  const m = monde({ utilisateur: ADMIN });
  m.ctx.window._uMk = m.ctx.L.marker([46.5, -72.7]);
  m.run('lastPos = [46.5, -72.7]'); m.run('basculerSuiviCarte()');
  m.run('openCard(1)'); m.run('modifierZoneArret()');
  await m.run('zoneEnregistrer()');
  eq('zone enregistrée : le suivi reprend', m.suivi(), { type: 'moi', auto: false, attache: true });
}
{
  // une passe qui commence PENDANT l'édition : son suivi automatique attend la fin de l'édition
  const m = monde({ utilisateur: LUC });
  m.ctx.window._uMk = m.ctx.L.marker([46.5, -72.7]);
  ouvrirDirect(m);
  m.run(`tours = ${JSON.stringify(CHAUFFEUR())}; majBandeauPasse()`);
  eq('ma passe commence pendant l\'édition : le suivi ne démarre pas encore', [m.suivi(), m.run('_passeSuivieAuto')], [null, null]);
  m.run('zoneAnnuler()');
  eq('l\'édition finie : le suivi de ma passe démarre tout seul (une fois par passe, comme prévu)', [m.suivi(), m.run('_passeSuivieAuto')], [{ type: 'moi', auto: true, attache: true }, 'p1']);
  m.run('arreterSuiviCarte()'); m.run('majBandeauPasse()');
  eq('… et éteint à la main, il n\'est pas rallumé', m.suivi(), null);
}

// =====================================================================
log('\n=== « COPIER VERS UNE AUTRE ROUTE » : LA ZONE DESSINÉE SUIT LA COPIE ===');
{
  const stopsSource = [
    { id: 's2', adresse: '220 rue du Moulin', client: 'TEST 3', service: 'Coupe de gazon', lat: 46.443, lon: -72.922, zone_points: ZONE_S2, passe_arrets: [] },
    { id: 's1', adresse: '304 rue de l\'Église', client: 'TEST 1', service: 'Engrais', lat: 46.44, lon: -72.92, passe_arrets: [{ complete_le: '2026-09-01T10:00:00Z' }] },
  ];
  const m = monde({ utilisateur: ADMIN, tables: { stops: stopsSource } });
  m.run("routesAdminSource = 'r1'; renderListeClientsFiltreeAdmin = () => {};");
  await m.run("chargerListeClientsSourceAdmin(document.getElementById('zone-essai'))");
  eq('la liste des clients de la route source demande aussi la zone (zone_points)', m.appels.selects.find((s) => s[0] === 'stops')[1], 'id,adresse,client,service,lat,lon,zone_points,passe_arrets(complete_le)');
  const liste = m.run('routesAdminListeSource');
  eq('… chaque client de la liste porte sa zone (ou null s\'il n\'en a pas)', liste.map((s) => [s.id, s.zone_points]), [['s2', ZONE_S2], ['s1', null]]);
  m.run("routesAdminCoches = new Set(['s2', 's1']); routesAdminDestination = 'r2'; renderRoutesAdmin = () => {};");
  await m.run('copierClientsAdmin()');
  const ecr = m.ecrituresStops();
  eq('copier : UNE insertion de 2 nouveaux arrêts sur la route de destination', [ecr.length, ecr[0].op, ecr[0].valeur.map((c) => c.route_id)], [1, 'insert', ['r2', 'r2']]);
  eq('… la ZONE DESSINÉE est copiée avec le client (null s\'il n\'en avait pas)', ecr[0].valeur.map((c) => [c.adresse, c.zone_points]), [['220 rue du Moulin', ZONE_S2], ['304 rue de l\'Église', null]]);
  eq('… la position et le service sont toujours copiés', ecr[0].valeur.map((c) => [c.lat, c.lon, c.service]), [[46.443, -72.922, 'Coupe de gazon'], [46.44, -72.92, 'Engrais']]);
}

// =====================================================================
log('\n=== LE CÂBLAGE : LA PAGE, LA FEUILLE DE STYLE, LES BRANCHEMENTS ===');
{
  const html = lire('index.html');
  const css = lire('css/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const regles = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((x) => ({ sel: x[1].trim().replace(/\s+/g, ' '), corps: x[2].replace(/\s+/g, '') }));
  const derniere = (sel) => regles.filter((r) => r.sel.split(',').map((s) => s.trim()).includes(sel)).pop();
  const z = (sel) => Number(regles.filter((r) => r.sel.split(',').map((x) => x.trim()).includes(sel)).map((r) => r.corps.match(/z-index:(\d+)/)?.[1]).filter(Boolean).pop());   // (un même élément a parfois plusieurs règles : on prend celle qui pose le z-index)

  const barre = html.match(/<div id="zone-barre"[\s\S]*?<div id="bottombar">/)?.[0] ?? '';
  vrai('la page a la barre de l\'éditeur (titre, adresse, surface, 3 boutons) AVANT la barre du bas', ['zone-titre', 'zone-ligne', 'zone-adresse', 'zone-info', 'zone-ok', 'zone-sans', 'zone-annuler'].every((id) => barre.includes(`id="${id}"`)), barre.slice(0, 200));
  vrai('… l\'adresse et la surface sont sur la MÊME ligne (le message d\'erreur passe dessous)', /<div id="zone-ligne"><div id="zone-adresse"><\/div><div id="zone-info"><\/div><\/div>/.test(barre));
  vrai('… les boutons sont reliés : Enregistrer, Passer (sans zone), ✕', /id="zone-ok"[^>]*onclick="zoneEnregistrer\(\)"/.test(barre) && /id="zone-sans"[^>]*onclick="zoneSansZone\(\)"/.test(barre) && /id="zone-annuler"[^>]*onclick="zoneAnnuler\(\)"/.test(barre));
  vrai('… « ✕ » a un nom pour les lecteurs d\'écran (aria-label)', /id="zone-annuler"[^>]*aria-label="Annuler"/.test(barre));
  vrai('… ce sont de vrais boutons qui n\'envoient pas de formulaire (type="button")', ['zone-ok', 'zone-sans', 'zone-annuler'].every((id) => new RegExp(`<button type="button" id="${id}"`).test(barre)));
  vrai('la fiche du client a son bouton « ✏ Modifier la zone » (caché au départ), relié à modifierZoneArret()', /<button type="button" id="btn-zone" class="sc-zone" onclick="modifierZoneArret\(\)" style="display:none">/.test(html));
  vrai('… DANS la fiche (avant « sc-acts »), pas dans la rangée de boutons', html.indexOf('id="btn-zone"') > html.indexOf('id="stop-card"') && html.indexOf('id="btn-zone"') < html.indexOf('id="sc-acts"'));
  const scripts = [...html.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map((x) => x[1]);
  vrai('la page charge zone-terrain.js, après placement.js et avant demarrage.js', scripts.indexOf('zone-terrain.js') > scripts.indexOf('placement.js') && scripts.indexOf('zone-terrain.js') < scripts.indexOf('demarrage.js') && scripts.filter((s) => s === 'zone-terrain.js').length === 1, scripts.join(' '));

  const b = derniere('#zone-barre')?.corps ?? '';
  vrai('la barre est collée au bas de l\'écran, sur toute la largeur, cachée au départ', /position:fixed/.test(b) && /left:0/.test(b) && /right:0/.test(b) && /bottom:0/.test(b) && /display:none/.test(b), b);
  vrai('… elle laisse la place à la barre d\'accueil d\'un iPhone (zone sûre du bas)', b.includes('var(--sa-bottom)'), b);
  vrai('… visible quand elle est active', /display:block/.test(derniere('#zone-barre.active')?.corps ?? ''));
  vrai('… PAR-DESSUS la barre du bas (900), la fiche (950) et la bannière de placement (1000) : rien d\'autre à toucher pendant le dessin', z('#zone-barre') > z('#stop-card') && z('#zone-barre') > z('#bottombar') && z('#zone-barre') > z('#placement-banner') && z('#zone-barre') > z('#bandeau-reseau'), [z('#zone-barre'), z('#stop-card'), z('#bottombar')].join(' / '));
  vrai('… mais SOUS les fenêtres (liste, admin : 1500), la confirmation (4000) et le message flottant (3000)', z('#zone-barre') < z('#liste-overlay') && z('#zone-barre') < z('#confirm-overlay') && z('#zone-barre') < z('#toast'), [z('#zone-barre'), z('#liste-overlay'), z('#confirm-overlay'), z('#toast')].join(' / '));
  vrai('les boutons font au moins 48 px de haut (un doigt, avec des gants)', Number(derniere('.zb')?.corps.match(/min-height:(\d+)px/)?.[1]) >= 48);
  vrai('… « ✕ » est plus étroit, les deux autres se partagent la largeur', /flex:0052px/.test(derniere('.zb.non')?.corps ?? '') && /flex:2/.test(derniere('.zb')?.corps ?? ''));
  vrai('la poignée : une zone à toucher de 44 px avec un rond visible de 22 px au centre', /width:22px/.test(derniere('.zone-poignee span')?.corps ?? '') && /height:22px/.test(derniere('.zone-poignee span')?.corps ?? '') && /display:flex/.test(derniere('.zone-poignee')?.corps ?? ''));
  vrai('un bouton grisé se voit (opacité réduite)', /opacity:\.4/.test(derniere('.zb:disabled')?.corps ?? ''));
  vrai('la surface en erreur est rouge, sur sa propre ligne sous l\'adresse, et peut passer à la ligne', /color:#ef4444/.test(derniere('#zone-info.err')?.corps ?? '') && /white-space:normal/.test(derniere('#zone-info.err')?.corps ?? '') && /flex:11100%/.test(derniere('#zone-info.err')?.corps ?? ''));
  vrai('une longue adresse est coupée par « … » (elle ne pousse jamais les boutons hors de l\'écran)', /text-overflow:ellipsis/.test(derniere('#zone-adresse')?.corps ?? '') && /white-space:nowrap/.test(derniere('#zone-adresse')?.corps ?? '') && /min-width:0/.test(derniere('#zone-adresse')?.corps ?? ''));
  vrai('la barre est OPAQUE (le grand bouton ＋ STOP de la barre du bas ne transparaît pas derrière)', /background:#111418/.test(b));
  vrai('le bouton de la fiche existe dans la feuille de style', /min-height|padding/.test(derniere('.sc-zone')?.corps ?? ''));

  const src = (f) => lire('js/' + f);
  const arrets = src('arrets.js'), suivi = src('suivi-carte.js'), liste = src('liste-arrets.js'), routesAdmin = src('admin-routes.js'), zone = src('zone-terrain.js');
  vrai('arrets.js : ouvrir une fiche est refusé pendant l\'édition (avant de toucher à quoi que ce soit)', /function openCard\(i\)\{\s*const s=stops\[i\];if\(!s\)return;\s*if\(typeof zoneEditeurActif==='function'&&zoneEditeurActif\(\)\) return;/.test(arrets));
  vrai('arrets.js : renderAll ne dessine pas la zone en cours d\'édition', /if\(typeof zoneArretEnEdition==='function'&&zoneArretEnEdition\(s\)\) return;/.test(arrets));
  vrai('arrets.js : la fiche met à jour le bouton de zone (majBoutonZoneFiche) à chaque remplissage', /majBoutonZoneFiche\(s\)/.test(arrets));
  vrai('suivi-carte.js : demarrerSuiviCarte, ◎ et le suivi automatique de la passe respectent l\'éditeur', (suivi.match(/zoneEditeurActif\(\)/g) || []).length === 3, String((suivi.match(/zoneEditeurActif\(\)/g) || []).length));
  vrai('liste-arrets.js : « ＋ Nouveau stop » ouvre l\'éditeur (demarrerEditeurZone) puis enregistre par enregistrerNouvelArret', /demarrerEditeurZone\(\{/.test(liste) && /enregistrerNouvelArret\(base,pts\)/.test(liste) && /enregistrerNouvelArret\(base,null\)/.test(liste));
  vrai('admin-routes.js : la zone est LUE (select), gardée dans la liste ET copiée avec le client', /select\('id,adresse,client,service,lat,lon,zone_points,passe_arrets\(complete_le\)'\)/.test(routesAdmin) && (routesAdmin.match(/lon:s\.lon,zone_points:s\.zone_points\|\|null,/g) || []).length === 2, String((routesAdmin.match(/lon:s\.lon,zone_points:s\.zone_points\|\|null,/g) || []).length));
  // Essai dans la vraie carte (29 sept.) : les images satellite d'Esri n'existent pas au-delà du zoom 18 à Shawinigan, Grand-Mère et Trois-Rivières (tuile grise « Map data not yet available »)
  const carte = src('carte.js');
  vrai('carte.js : les images satellite s\'arrêtent au zoom 18 (au-delà : agrandies, jamais les tuiles grises « Map data not yet available »)', /World_Imagery\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}',\{maxZoom:20,maxNativeZoom:18\}\)/.test(carte));
  vrai('… la carte routière (OpenStreetMap) s\'arrête au zoom 19 (au zoom 20 elle ne répond plus)', /tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png',\{maxZoom:20,maxNativeZoom:19\}\)/.test(carte));
  vrai('… le zoom maximal de la carte reste 20', (carte.match(/maxZoom:20/g) || []).length === 3);
  vrai('zone-terrain.js n\'écrit dans stops QUE la colonne zone_points (une seule mise à jour, ni insertion ni suppression : jamais lat, lon, actif…)', (zone.match(/\.update\(/g) || []).length === 1 && /\.update\(\{zone_points:pts\}\)/.test(zone) && !/\.insert\(|\.delete\(/.test(zone));
  vrai('… et n\'a besoin d\'aucun SQL : aucune fonction serveur (rpc) ni nouvelle table', !/\.rpc\(|create table|alter table/i.test(zone));
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
