// Demande 6 de Joé — LE CAMION DANS LA ZONE D'UN CLIENT (www/js/presence.js) : la zone bleue, le chronomètre, le « Complété » automatique après N secondes, le temps passé (arrivée, départ).
// Les VRAIS fichiers de l'application (config, position, tours, arrêts, file des gestes, tracking, presence…) sont chargés dans un faux navigateur avec une fausse carte Leaflet et un FAUX Supabase.
// Le GPS est SIMULÉ : chaque lecture passe par noterPosition (l'entrée unique de toutes les lectures) ; l'HORLOGE est virtuelle (Date.now() : rien n'attend pour de vrai).
// Ce que ce test NE peut PAS vérifier : le vrai GPS d'un téléphone et son service d'arrière-plan (essai sur le terrain, dans la cour de Joé, comparé à Geotab) ni le vrai Supabase (SQL 29 : test-presence-temps.mjs).
// WWW_TEST : un autre dossier « www » (erreurs volontaires).
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
const proche = (l, a, b, tol = 0.05) => (Math.abs(a - b) <= tol ? pass(l) : fail(l, `obtenu ${a}, attendu ${b} (± ${tol})`));
const fichiers = new Map();
const lire = (f) => { if (!fichiers.has(f)) fichiers.set(f, fs.readFileSync(WWW + f, 'utf8')); return fichiers.get(f); };
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const MEC = 'Déneigement mécanique', SEL = 'Épandage de sel';
const CH = 'route-charette', SE = 'route-saint-etienne';
const T0 = Date.UTC(2026, 8, 29, 14, 0, 0);   // l'heure virtuelle de départ : 29 sept. 2026, 14 h (UTC)

// ── La géométrie du terrain d'essai : des mètres (est, nord) autour de l'origine ────────────
const LAT0 = 46.44, LON0 = -72.92;
const M_LAT = 6371000 * Math.PI / 180, M_LON = M_LAT * Math.cos(LAT0 * Math.PI / 180);   // (la même projection que l'application)
const pt = (x, y) => [LAT0 + y / M_LAT, LON0 + x / M_LON];
const rect = (cx, cy, c) => [pt(cx - c / 2, cy + c / 2), pt(cx + c / 2, cy + c / 2), pt(cx + c / 2, cy - c / 2), pt(cx - c / 2, cy - c / 2)];
const poly = (xy) => xy.map(([x, y]) => pt(x, y));
const ZA = rect(0, 0, 15), ZB = rect(200, 0, 15), ZC = rect(18, 0, 15), ZI = rect(300, 0, 15);
let ordre = 0;
const S = (id, x, y, o = {}) => ({ id, adresse: id + ' rue Test', client: 'Client ' + id, route_id: CH, service: MEC, lat: pt(x, y)[0], lon: pt(x, y)[1], ordre: ordre++, actif: true, ...o });
const STOPS = () => [
  S('A', 0, 0, { zone_points: ZA }),       // une zone dessinée : 15 m × 15 m
  S('B', 200, 0, { zone_points: ZB }),     // loin de A
  S('C', 18, 0, { zone_points: ZC }),      // le voisin de A : 3 m entre les deux zones
  S('D', 0, 100),                          // SANS zone dessinée : le cercle de 20 m autour de son point
  S('E', 400, 400),                        // (le 5ᵉ arrêt de la route : un seul arrêt complété ne ferme jamais la passe)
  S('X', 0, 0, { route_id: SE }),          // au même endroit que A, mais d'une AUTRE route
  S('Y', 0, 0, { service: SEL }),          // au même endroit que A, mais d'un AUTRE service
  S('I', 300, 0, { zone_points: ZI, actif: false }),   // un arrêt inactif
];
// Luc (u-luc) est le chauffeur de la passe p-luc du tour de déneigement de Charette ; Marc conduit un autre camion du même tour
const TOURS = (o = {}) => {
  const faits = o.faits ?? [];
  return [
    { route_id: CH, tache: MEC, numero: 1, total: 5, faits: faits.length, pourcentage: Math.round(100 * faits.length / 5), arrets_faits: [...faits], faits_il_y_a: Object.fromEntries(faits.map((f) => [f, 30])), mes_passes_annulables: [], en_cours: true,
      passes: [{ passe_id: o.passeId ?? 'p-luc', equipe_id: 'e1', chauffeur_id: 'u-luc', je_suis_chauffeur: o.chauffeur !== false, je_suis_a_bord: true },
               { passe_id: 'p-marc', equipe_id: 'e2', chauffeur_id: 'u-marc', je_suis_chauffeur: false, je_suis_a_bord: false }] },
    { route_id: SE, tache: MEC, numero: 1, total: 1, faits: 0, pourcentage: 0, arrets_faits: [], faits_il_y_a: {}, mes_passes_annulables: [], en_cours: true,
      passes: [{ passe_id: 'p-gaby', equipe_id: 'e3', chauffeur_id: 'u-gaby', je_suis_chauffeur: false, je_suis_a_bord: false }] },
  ];
};
// Luc conduit une passe de la route Saint-Étienne : le même endroit que A, mais de son tour, le client X
const TOURS_SE = () => [
  { route_id: SE, tache: MEC, numero: 1, total: 2, faits: 0, pourcentage: 0, arrets_faits: [], faits_il_y_a: {}, mes_passes_annulables: [], en_cours: true,
    passes: [{ passe_id: 'p-luc-se', equipe_id: 'e1', chauffeur_id: 'u-luc', je_suis_chauffeur: true, je_suis_a_bord: true }] },
];
const TOUR_TERMINE = () => [
  { route_id: CH, tache: MEC, numero: 1, total: 5, faits: 5, pourcentage: 100, arrets_faits: ['A', 'B', 'C', 'D', 'E'], faits_il_y_a: {}, mes_passes_annulables: [], en_cours: false, passes: [] },
];

// ---------------------------------------------------------------------
// Un « monde » : faux navigateur + fausse carte + faux Supabase + horloge virtuelle, avec les vrais fichiers de l'application dedans
// ---------------------------------------------------------------------
const FICHIERS = ['js/config.js', 'js/position.js', 'js/utilitaires.js', 'js/hors-reseau.js', 'js/file-attente.js', 'js/tours.js', 'js/vehicules.js', 'js/equipage.js', 'js/equipage-panneau.js', 'js/passe.js', 'js/resume-passe.js', 'js/arrets.js',
  'js/routes.js', 'js/problemes.js', 'js/photos.js', 'js/admin.js', 'js/admin-reglages.js', 'js/liste-arrets.js', 'js/ordre.js', 'js/parcours.js', 'js/tracking.js', 'js/presence.js'];
async function monde(o = {}) {
  const els = {};
  const creer = (id) => {
    const classes = new Set();
    const e = { id, children: [], style: {}, textContent: '', _html: '', value: '', disabled: false, className: '', onclick: null, attrs: {},
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
      appendChild(c) { c.parent = this; this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; }, focus() {},
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); },
      querySelector(sel) { return this.children.find((c) => '.' + c.className === sel) ?? null; } };
    Object.defineProperty(e, 'innerHTML', { get() { return this._html; }, set(v) { this._html = v; if (v === '') this.children = []; } });
    return e;
  };
  const el = (id) => (els[id] ??= creer(id));
  const donnees = {
    stops: o.stops ?? STOPS().map((s) => ({ ...s })), routes: o.routes ?? [{ id: CH, nom: 'Charette', couleur: '#c8e63c', actif: true }, { id: SE, nom: 'Saint-étienne', couleur: '#60a5fa', actif: true }],
    problemes: [], tours: o.tours ?? TOURS(), positions: [], equipes: [], equipage_periodes: [], parcours_segments: [], reglages: o.reglages ?? [], types_service: [], quarts: [], passes: [], passe_arrets: [],
  };
  const appels = { rpc: [], selects: [], ins: [], ecritures: [], toasts: [], lectures: [], memo: 0, confirmations: [] };
  const serveur = { erreurs: o.erreursRpc ?? {}, pannes: o.pannesRpc ?? [] };   // (modifiables après coup : m.serveur.erreurs.arret_presence = …)
  const fauxDb = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u-luc' } } }, error: null }) },
    rpc: async (nom, args) => {
      appels.rpc.push({ nom, args });
      if (serveur.pannes.includes(nom)) throw new Error('Failed to fetch');
      if (serveur.erreurs[nom]) return { data: null, error: serveur.erreurs[nom] };
      if (nom === 'tours_en_cours') return { data: donnees.tours, error: null };
      if (nom === 'completer_arret') {   // le serveur : l'arrêt est ajouté au tour de la passe
        const t = donnees.tours.find((x) => x.passes.some((p) => p.passe_id === args.p_passe_id));
        if (t && !t.arrets_faits.includes(args.p_stop_id)) { t.arrets_faits.push(args.p_stop_id); t.faits = t.arrets_faits.length; t.pourcentage = Math.round(100 * t.faits / t.total); t.faits_il_y_a = { ...(t.faits_il_y_a ?? {}), [args.p_stop_id]: 0 }; }
        return { data: { statut: 'complete' }, error: null };
      }
      if (nom === 'annuler_arret') return { data: { statut: 'annule' }, error: null };
      if (nom === 'arret_presence') return { data: { statut: 'enregistree', presence_id: 'x' }, error: null };
      if (nom === 'envoyer_position') return { data: { statut: 'ok' }, error: null };
      return { data: null, error: { message: 'inconnu' } };
    },
    from: (table) => {
      const q = { op: 'select', valeur: null, filtres: [] };
      q.select = (c) => { if (q.op === 'select') appels.selects.push([table, c]); return q; };
      q.eq = (c, v) => { q.filtres.push([c, v]); return q; };
      q.in = (c, vs) => { q.dans = [c, vs]; appels.ins.push([table, c, vs]); return q; };
      q.order = () => q; q.is = () => q; q.not = () => q; q.limit = () => q; q.range = () => q;
      q.update = (v) => { q.op = 'update'; q.valeur = v; return q; };
      q.insert = (v) => { q.op = 'insert'; q.valeur = v; return q; };
      q.delete = () => { q.op = 'delete'; return q; };
      q.then = (ok_, ko_) => {
        let res;
        if (q.op === 'select') {
          appels.lectures.push(table);
          if (o.lectureLance?.includes(table)) throw new Error('Failed to fetch');
          let lignes = table === 'stops' ? donnees.stops.map((s) => ({ ...s })) : (donnees[table] ?? []);
          if (q.dans) lignes = lignes.filter((l) => q.dans[1].includes(l[q.dans[0]]));
          res = o.erreurLecture?.includes(table) ? { data: null, error: { message: 'boum' } } : { data: lignes, error: null };
        } else {
          appels.ecritures.push({ table, op: q.op, valeur: q.valeur, filtres: q.filtres });
          res = { data: null, error: null };
        }
        return Promise.resolve(res).then(ok_, ko_);
      };
      return q;
    },
    functions: { invoke: async () => ({ data: { ok: true, calcules: 0, sans_route: 0, echecs: 0, restants: 0, total_troncons: 0, limite_atteinte: false }, error: null }) },
    channel: (nom) => { const ch = { nom, on() { return ch; }, subscribe() { return ch; } }; return ch; },
  };
  const marqueurs = [], polygones = [], retires = [];
  const memoire = new Map(Object.entries(o.memo ?? {}));
  const minuteries = new Map(); let idMinuterie = 0;   // les intervalles sont FAUX : rien ne tourne tout seul, le test décide (m.run('presenceTic()'))
  const sandbox = {
    document: { getElementById: el, createElement: () => creer(null) },
    localStorage: { getItem: (k) => (memoire.has(k) ? memoire.get(k) : null), setItem: (k, v) => { if (k.startsWith('lp_presence:')) appels.memo++; memoire.set(k, String(v)); }, removeItem: (k) => { memoire.delete(k); } },
    window: { open() {} }, setTimeout, clearTimeout, console,
    setInterval: (f, ms) => { const id = ++idMinuterie; minuteries.set(id, { f, ms }); return id; }, clearInterval: (id) => { minuteries.delete(id); },
    L: {
      divIcon: (opt) => opt,
      marker: (ll, opt) => { const m = { ll, opt, addTo() { return m; }, on() {}, setLatLng() { return m; }, setIcon(i) { m.opt = { ...m.opt, icon: i }; return m; }, bindPopup() { return m; }, setPopupContent() { return m; } }; marqueurs.push(m); return m; },
      polygon: (pts, opt) => { const p = { pts, opt, addTo() { return p; } }; polygones.push(p); return p; },
      polyline: (lignes, opt) => { const p = { lignes, opt, addTo() { return p; } }; return p; },
      layerGroup: (couches) => { const g = { couches, addTo() { return g; } }; return g; },
    },
    __map: { removeLayer: (m) => retires.push(m), flyTo() {}, attributionControl: { addAttribution() {}, removeAttribution() {} } },
    __fauxDb: fauxDb, __toasts: appels.toasts, __t: o.t0 ?? T0, __notes: [], __confirmations: appels.confirmations,
    setStatus() {}, hideLoading() {}, showErr() {},
  };
  const ctx = vm.createContext(sandbox);
  for (const f of FICHIERS.filter((x) => !(o.sansPresence && x === 'js/presence.js'))) vm.runInContext(lire(f), ctx, { filename: f });
  vm.runInContext('Date.now = () => __t;', ctx);   // l'horloge virtuelle
  vm.runInContext('db = __fauxDb; map = __map; currentUser = ' + JSON.stringify(o.utilisateur ?? { id: 'u-luc', nom: 'Luc', role: 'employe' }) + ';', ctx);
  vm.runInContext('toast = (m) => { __toasts.push(m); }; confirmer = async (...a) => { __confirmations.push(a); return true; }; informer = async () => {}; planifierRechargementTours = () => {}; FILE_DELAIS_MS = [5, 5, 5, 5, 5];', ctx);
  const w = {
    ctx, el, donnees, appels, marqueurs, polygones, retires, memoire, minuteries, serveur,
    run: (code) => vm.runInContext(code, ctx),
    t: () => sandbox.__t,
    avancer: (ms) => { sandbox.__t += ms; },
    iso: (ms) => new Date(ms).toISOString(),
    hors: () => vm.runInContext('reseau.enLigne = false;', ctx),
    gestes: (type) => JSON.parse(JSON.stringify(vm.runInContext('gestesEnAttente()', ctx))).filter((g) => !type || g.type === type),
    refuses: () => JSON.parse(JSON.stringify(vm.runInContext('gestesNonEnvoyes()', ctx))),
    rpc: (nom) => appels.rpc.filter((r) => r.nom === nom),
    presence: () => JSON.parse(JSON.stringify(vm.runInContext('_presence', ctx))),
    idx: (id) => vm.runInContext(`stops.findIndex((s) => s.id === '${id}')`, ctx),
    couleurZone: (id) => { const z = JSON.stringify(vm.runInContext(`stops.find((s) => s.id === '${id}').zone_points`, ctx)); const p = polygones.filter((x) => JSON.stringify(x.pts) === z); return p.length ? p[p.length - 1].opt.color : null; },
    couleurMarqueur: (id) => { const mk = vm.runInContext(`mkrs[${w.idx(id)}]`, ctx); return mk ? (mk.opt.icon.html.match(/background:(#[0-9a-f]+)/) || [])[1] : null; },
    fiche: () => el('sc-tour').textContent,
    fait: (id) => vm.runInContext(`estFait(stops.find((s) => s.id === '${id}'))`, ctx),
    enCours: (id) => vm.runInContext(`estEnCours(stops.find((s) => s.id === '${id}'))`, ctx),
    fin: () => vm.runInContext('arreterSonde();', ctx),
  };
  if (o.charger !== false) { await w.run('loadStops()'); await attendre(30); }   // (l'application précharge encore en tâche de fond : on la laisse finir avant de couper le réseau)
  if (!o.enLigne) w.hors();   // (par défaut HORS RÉSEAU : les gestes restent dans la file, on les lit ; « enLigne: true » : ils partent tout de suite vers le faux serveur)
  return w;
}
// ── Le GPS simulé ─────────────────────────────────────
// UNE lecture à (x, y) mètres de l'origine, avec cette précision (null : inconnue), à l'heure virtuelle de maintenant
const gps = (m, x, y, prec = 5) => { const [la, lo] = pt(x, y); m.run(`noterPosition(${la}, ${lo}, ${prec === null ? 'null' : prec}, __t)`); };
// N secondes de lectures, une par seconde, au même endroit
const rester = (m, x, y, secondes, prec = 5) => { for (let i = 0; i < secondes; i++) { m.avancer(1000); gps(m, x, y, prec); } };
const pause = () => attendre(25);   // (les gestes de la file s'écrivent en tâche de fond)
// Les visites notées, qu'elles attendent dans la file ou soient déjà parties vers le serveur : [{passe, stop, arrivee, depart}]
const notees = (m) => [...m.gestes('arret_presence').map((g) => ({ passe: g.args.passeId, stop: g.args.stopId, arrivee: g.args.arrivee, depart: g.args.depart })), ...m.rpc('arret_presence').map((x) => ({ passe: x.args.p_passe_id, stop: x.args.p_stop_id, arrivee: x.args.p_arrivee, depart: x.args.p_depart }))];

// =====================================================================
log('=== LA GÉOMÉTRIE : DANS LE POLYGONE, OU À QUELLE DISTANCE DE SON BORD ===');
{
  const m = await monde({ charger: false });
  const dist = (x, y, zone) => m.run(`presenceDistanceZoneM(${pt(x, y)[0]}, ${pt(x, y)[1]}, ${JSON.stringify(zone)})`);
  eq('au centre du terrain : dedans (0)', dist(0, 0, ZA), 0);
  eq('près d\'un coin, encore dedans : 0', [dist(7, 7, ZA), dist(-7, -7, ZA), dist(-7, 7, ZA), dist(7, -7, ZA)], [0, 0, 0, 0]);
  proche('5 m à l\'est du bord (le bord est à 7,5 m du centre) : 5 m', dist(12.5, 0, ZA), 5);
  proche('3 m au sud du bord : 3 m', dist(0, -10.5, ZA), 3);
  proche('en diagonale d\'un coin (3 m à l\'est, 4 m au nord) : 5 m (la distance AU COIN, pas au bord prolongé)', dist(10.5, 11.5, ZA), 5);
  proche('les quatre côtés : à l\'ouest, au nord', [dist(-12.5, 0, ZA), dist(0, 12.5, ZA)].reduce((a, b) => a + b, 0), 10);
  const ZL = poly([[0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]]);   // une forme en « L » (un terrain qui n'est pas un rectangle)
  eq('en L : le bras vertical et le bras horizontal sont dedans', [dist(5, 15, ZL), dist(15, 5, ZL)], [0, 0]);
  proche('en L : dans l\'ANGLE rentrant (dehors), la distance au bord le plus proche : 5 m', dist(15, 15, ZL), 5);
  proche('en L : à 5 m du bout du bras horizontal', dist(25, 5, ZL), 5);
  const tri = poly([[0, 0], [20, 0], [0, 20]]);
  eq('un triangle : dedans', dist(5, 5, tri), 0);
  proche('un triangle : à la distance de l\'hypoténuse (x + y = 20) : 7,07 m', dist(15, 15, tri), 7.071, 0.05);
  proche('le sens des coins (horaire ou anti-horaire) ne change rien', dist(12.5, 0, ZA.slice().reverse()), 5);
  eq('… ni pour « dedans »', dist(0, 0, ZA.slice().reverse()), 0);
  proche('un coin répété deux fois (côté de longueur zéro) ne casse rien', dist(12.5, 0, [ZA[0], ...ZA]), 5);
}
{
  const m = await monde({ charger: false });
  const zone = (z) => m.run(`presenceZoneDe({zone_points: ${z}})`);
  eq('4 coins en nombres : la zone est lue telle quelle', JSON.parse(JSON.stringify(zone(JSON.stringify(ZA)))), ZA);
  eq('… et c\'est une COPIE (l\'arrêt garde ses coins)', m.run(`(() => { const s = {zone_points: ${JSON.stringify(ZA)}}; const z = presenceZoneDe(s); z[0][0] = 99; return s.zone_points[0][0] === ${ZA[0][0]}; })()`), true);
  eq('3 coins : suffisant (un triangle)', zone('[[1,2],[3,4],[5,6]]') !== null, true);
  eq('2 coins : pas une zone', zone('[[1,2],[3,4]]'), null);
  eq('aucune zone : pas une zone', [m.run('presenceZoneDe({})'), m.run('presenceZoneDe(null)'), m.run('presenceZoneDe({zone_points: "abc"})'), m.run('presenceZoneDe({zone_points: {}})')], [null, null, null, null]);
  eq('un coin en texte (« "5" ») : pas une zone (il ne devient jamais un nombre)', zone('[[1,2],[3,4],["5","6"]]'), null);
  eq('un coin « null » : pas une zone (il ne devient jamais 0)', zone('[[1,2],[3,4],[null,null]]'), null);
  eq('un coin « NaN » ou infini : pas une zone', [zone('[[1,2],[3,4],[NaN,6]]'), zone('[[1,2],[3,4],[5,Infinity]]')], [null, null]);
  eq('un coin qui n\'est pas une paire : pas une zone', [zone('[[1,2],[3,4],[5]]'), zone('[[1,2],[3,4],"x"]'), zone('[[1,2],[3,4],null]')], [null, null, null]);
  eq('presenceZoneDessinee dit oui/non', [m.run(`presenceZoneDessinee({zone_points: ${JSON.stringify(ZA)}})`), m.run('presenceZoneDessinee({zone_points: [[1,2]]})'), m.run('presenceZoneDessinee(null)')], [true, false, false]);
}

log('\n=== LA MARGE DU GPS ET LA RÈGLE « DANS LA ZONE » (zone dessinée : son polygone + la marge ; sans zone : le cercle de 20 m, sans marge) ===');
{
  const m = await monde({ charger: false });
  eq('la marge suit la précision, entre 4 et 12 m ; inconnue : 10 m', [0, 3, 4, 8, 12, 25, null, undefined, -1].map((p) => m.run(`presenceMarge(${p})`)), [4, 4, 4, 8, 12, 12, 10, 10, 10]);
  const A = JSON.stringify(STOPS()[0]), D = JSON.stringify(STOPS()[3]);
  const dansA = (x, y, p) => m.run(`presenceDansArret(${A}, ${pt(x, y)[0]}, ${pt(x, y)[1]}, ${p})`);
  eq('zone dessinée : à 6 m du bord, précision 5 (marge 5) : dehors ; précision 8 (marge 8) : dedans', [dansA(13.5, 0, 5), dansA(13.5, 0, 8)], [false, true]);
  eq('… précision 12 : dedans ; précision inconnue (marge 10) : dedans ; précision 3 (marge 4) : dehors', [dansA(13.5, 0, 12), dansA(13.5, 0, null), dansA(13.5, 0, 3)], [true, true, false]);
  eq('… la marge ne dépasse JAMAIS 12 m : à 13 m du bord, même avec un GPS à 30 m : dehors ; à 11,9 m : dedans', [dansA(20.5, 0, 30), dansA(19.4, 0, 30)], [false, true]);
  eq('… dans le polygone : dedans, quelle que soit la précision', [dansA(0, 0, 3), dansA(0, 0, 30)], [true, true]);
  const dansD = (x, y, p) => m.run(`presenceDansArret(${D}, ${pt(x, y)[0]}, ${pt(x, y)[1]}, ${p})`);
  eq('sans zone dessinée : le cercle de 20 m autour du point (à 19,9 m : dedans ; à 20,1 m : dehors)', [dansD(0, 119.9, 5), dansD(0, 120.1, 5)], [true, false]);
  eq('… SANS marge : à 21 m avec un GPS à 12 m : dehors (la règle d\'avant n\'a pas changé)', [dansD(0, 121, 12), dansD(0, 121, null)], [false, false]);
  eq('… et une zone à 2 coins seulement (illisible) : le cercle aussi', m.run(`presenceDansArret({...${D}, zone_points: [[1,2],[3,4]]}, ${pt(0, 121)[0]}, ${pt(0, 121)[1]}, 12)`), false);
  eq('un arrêt sans position (ou pas d\'arrêt) : jamais dedans', [m.run('presenceDansArret({id:"z"}, 46.44, -72.92, 5)'), m.run('presenceDansArret(null, 46.44, -72.92, 5)')], [false, false]);
  proche('la distance pour classer deux zones : polygone = distance au bord ; cercle = distance moins 20 m (0 si dedans)', m.run(`presenceDistanceArret(${A}, ${pt(12.5, 0)[0]}, ${pt(12.5, 0)[1]})`), 5);
  eq('… cercle : à 25 m du point 5 m, à 10 m du point 0', [Math.round(m.run(`presenceDistanceArret(${D}, ${pt(0, 125)[0]}, ${pt(0, 125)[1]})`) * 10) / 10, m.run(`presenceDistanceArret(${D}, ${pt(0, 110)[0]}, ${pt(0, 110)[1]})`)], [5, 0]);
}

log('\n=== LE RÉGLAGE « COMPLÉTÉ AUTOMATIQUE » : 60 SECONDES AU DÉPART, 0 = JAMAIS ===');
{
  const m = await monde({ charger: false });
  eq('au départ : 60 secondes (« après 1 minute », Joé)', m.run('presenceDelaiAutoS'), 60);
  const lu = (v) => m.run(`presenceDelaiDe(${v})`);
  eq('un nombre : gardé (30, 90, 0 = jamais, 30,5)', [lu(30), lu(90), lu(0), lu(30.5)], [30, 90, 0, 30.5]);
  eq('un nombre en texte : lu (« 45 », « 0 »)', [lu('"45"'), lu('"0"')], [45, 0]);
  eq('illisible (vide, texte, négatif, rien, infini) : 60', [lu('""'), lu('"abc"'), lu('-5'), lu('null'), lu('undefined'), lu('Infinity'), lu('NaN'), lu('"  "')], [60, 60, 60, 60, 60, 60, 60, 60]);
  eq('au plus 3600 secondes (une heure)', [lu(3600), lu(5000), lu(99999)], [3600, 3600, 3600]);
  m.run(`installerReglagesPresence([{cle:'presence_complete_auto_s', valeur: 45}, {cle:'autre', valeur: 5}])`);
  eq('installer : la ligne du réglage est cherchée par sa clé', m.run('presenceDelaiAutoS'), 45);
  m.run(`installerReglagesPresence([{cle:'autre', valeur: 5}])`);
  eq('… absente : 60 (la valeur de départ, jamais l\'ancienne)', m.run('presenceDelaiAutoS'), 60);
  m.run(`installerReglagesPresence([{cle:'presence_complete_auto_s', valeur: 0}])`);
  eq('… 0 : jamais', m.run('presenceDelaiAutoS'), 0);
  m.run(`installerReglagesPresence(null)`);
  eq('… pas de lignes du tout : 60', m.run('presenceDelaiAutoS'), 60);
  m.run(`installerReglagesPresence([null, {cle:'presence_complete_auto_s', valeur: 45}])`);
  eq('… une ligne vide dans la liste n’empêche pas de trouver la bonne', m.run('presenceDelaiAutoS'), 45);
}
{
  // Lu depuis la table « reglages » à chaque chargement complet
  const m = await monde({ reglages: [{ cle: 'presence_complete_auto_s', valeur: 45, description: 'x' }, { cle: 'duree_max_quart_heures', valeur: 16, description: 'y' }] });
  eq('loadStops lit le réglage : 45 secondes', m.run('presenceDelaiAutoS'), 45);
  eq('… par une lecture précise de SA ligne seulement (les autres réglages ne sont pas demandés ici)', m.appels.ins.filter((x) => x[0] === 'reglages' && JSON.stringify(x[2]) === '["presence_complete_auto_s"]').length, 1);
  m.donnees.reglages[0].valeur = 20;
  eq('une relecture prend la nouvelle valeur', [await m.run('chargerReglagesPresence()'), m.run('presenceDelaiAutoS')], [true, 20]);
  m.fin();
  const oe = { reglages: [{ cle: 'presence_complete_auto_s', valeur: 45, description: 'x' }], erreurLecture: [], enLigne: true };
  const e = await monde(oe);
  await e.run('attendreEcritures()');
  e.run('presenceDelaiAutoS = 60');
  oe.erreurLecture.push('reglages');
  eq('le serveur REFUSE la lecture (une erreur, pas une panne de réseau) : la dernière valeur connue (45), le téléphone reste en ligne', [await e.run('chargerReglagesPresence()'), e.run('presenceDelaiAutoS'), e.run('reseau.enLigne')], [false, 45, true]);
  oe.erreurLecture.pop(); oe.erreurLecture.push('reglages');
  e.run('presenceDelaiAutoS = 60');
  await e.run('restaurerReglagesPresence()');
  eq('… et la copie du téléphone n’a PAS été écrasée par une liste vide (la valeur est toujours 45)', e.run('presenceDelaiAutoS'), 45);
  e.fin();
  const sans = await monde({});
  eq('aucune ligne dans la base : 60', sans.run('presenceDelaiAutoS'), 60);
  sans.fin();
  const nul = await monde({ charger: false, utilisateur: { id: 'u-luc', nom: 'Luc', role: 'employe' } });
  nul.run('currentUser = null');
  eq('personne n\'est connecté : rien n\'est lu', [await nul.run('chargerReglagesPresence()'), nul.appels.lectures.length], [false, 0]);
  nul.fin();
}
{
  // Sans réseau : la DERNIÈRE valeur connue (copie du téléphone), sinon 60
  const o = { reglages: [{ cle: 'presence_complete_auto_s', valeur: 45, description: 'x' }], lectureLance: [], enLigne: true };
  const m = await monde(o);
  await m.run('attendreEcritures()');
  m.run('presenceDelaiAutoS = 60');   // (l'application a été fermée puis rouverte : la valeur en mémoire est celle de départ)
  o.lectureLance.push('reglages');
  eq('lecture impossible (panne de réseau) : la dernière valeur connue (45) revient de la copie du téléphone', [await m.run('chargerReglagesPresence()'), m.run('presenceDelaiAutoS'), m.run('reseau.enLigne')], [false, 45, false]);
  m.fin();
  const vierge = await monde({ lectureLance: ['reglages'] });
  eq('… sans copie : 60', [vierge.run('presenceDelaiAutoS')], [60]);
  vierge.fin();
  // Un démarrage sans signal (restaurerDepuisCache) reprend aussi la copie du réglage
  const o2 = { reglages: [{ cle: 'presence_complete_auto_s', valeur: 25, description: 'x' }], lectureLance: [] };
  const h = await monde(o2);
  await h.run('attendreEcritures()');
  h.run('presenceDelaiAutoS = 60');
  o2.lectureLance.push('stops');
  await h.run('loadStops()');
  eq('démarrage sans signal : les copies sont reprises, le réglage aussi (25)', [h.run('reseau.enLigne'), h.run('presenceDelaiAutoS')], [false, 25]);
  h.fin();
}

log('\n=== LE CHRONO : « 3 min 12 s » ===');
{
  const m = await monde({ charger: false });
  const f = (ms) => m.run(`presenceFormaterDuree(${ms})`);
  eq('secondes', [f(0), f(1000), f(45000), f(59999)], ['0 s', '1 s', '45 s', '59 s']);
  eq('minutes et secondes (les secondes sur 2 chiffres)', [f(60000), f(65000), f(192000), f(3599000)], ['1 min 00 s', '1 min 05 s', '3 min 12 s', '59 min 59 s']);
  eq('heures et minutes (les minutes sur 2 chiffres, sans arrondi)', [f(3600000), f(3900000), f(5400000), f(7325000)], ['1 h 00 min', '1 h 05 min', '1 h 30 min', '2 h 02 min']);
  eq('négatif : 0 s', f(-5000), '0 s');
}

log('\n=== L\'ENTRÉE DANS LA ZONE : LA ZONE DEVIENT BLEUE, LE CHRONO COMMENCE ===');
{
  const m = await monde();
  eq('avant : aucun client n\'est en cours, la zone de A est jaune, aucune visite', [m.enCours('A'), m.couleurZone('A'), m.couleurMarqueur('A'), m.presence()], [false, '#c8e63c', '#c8e63c', null]);
  m.run(`openCard(${m.idx('A')})`);
  const t0 = m.t();
  gps(m, 0, 0);
  eq('un point dans la zone de A : la visite s\'ouvre (client, passe, arrivée = l\'heure de la lecture, rien de compté encore)', m.presence(), { stopId: 'A', passeId: 'p-luc', arrivee: t0, derniereVue: t0, derniereLecture: t0, dedansMs: 0, autoTente: false });
  eq('la zone de A est BLEUE tout de suite (mon propre camion, sans attendre le serveur) — le marqueur aussi', [m.enCours('A'), m.couleurZone('A'), m.couleurMarqueur('A')], [true, '#60a5fa', '#60a5fa']);
  eq('les autres clients n\'ont pas bougé (B est jaune)', [m.enCours('B'), m.couleurZone('B')], [false, '#c8e63c']);
  vrai('la fiche ouverte sur A dit « camion sur place » et le chrono commence à 0 s', m.fiche().endsWith('🚜 camion sur place · ⏱ 0 s'), m.fiche());
  rester(m, 0, 0, 90);
  vrai('90 secondes plus tard, la fiche montre le chrono qui avance : 1 min 30 s', m.fiche().endsWith('🚜 camion sur place · ⏱ 1 min 30 s'), m.fiche());
  eq('la visite continue : mêmes arrivée et client, dernière lecture à jour, 90 s dedans', [m.presence().arrivee, m.presence().derniereVue, m.presence().dedansMs], [t0, t0 + 90000, 90000]);
  eq('rien n\'est envoyé tant que le camion est là (pas de geste de temps passé)', m.gestes('arret_presence').length, 0);
  eq('la minuterie du chrono tourne (une seule, chaque seconde)', [m.run('_presenceMinuterie !== null'), [...m.minuteries.values()].filter((x) => x.ms === 1000).length], [true, 1]);
  m.fin();
}
{
  // La zone est bleue aussi chez les AUTRES (les positions lues du serveur) ; le chrono n'est que chez le chauffeur
  const m = await monde();
  m.run(`positionsVehicules = [{passe_id:'p-marc', lat:${pt(0, 0)[0]}, lon:${pt(0, 0)[1]}, precision_m:5, maj_le:'${m.iso(m.t())}'}]; renderAll();`);
  eq('le camion de Marc (lu du serveur) est dans la zone de A : A est bleue', [m.enCours('A'), m.couleurZone('A')], [true, '#60a5fa']);
  m.run(`openCard(${m.idx('A')})`);
  eq('… la fiche dit « camion sur place » mais SANS chrono (le chrono est celui de MON camion)', [m.fiche().includes('🚜 camion sur place'), m.fiche().includes('⏱')], [true, false]);
  m.fin();
}

log('\n=== SEULE MA PASSE COMPTE : LA ROUTE, LE SERVICE, LE RÔLE ===');
{
  const passager = await monde({ tours: TOURS({ chauffeur: false }) });
  gps(passager, 0, 0); rester(passager, 0, 0, 90);
  eq('un passager (pas le chauffeur) : aucune visite, aucune zone bleue, aucun geste', [passager.presence(), passager.enCours('A'), passager.gestes().length], [null, false, 0]);
  passager.fin();
  const sans = await monde({ tours: [] });
  rester(sans, 0, 0, 5);
  eq('aucune passe : rien', sans.presence(), null);
  sans.fin();
  const fini = await monde({ tours: TOUR_TERMINE() });
  rester(fini, 0, 0, 5);
  eq('une passe terminée : rien', fini.presence(), null);
  fini.fin();
  const se = await monde({ tours: TOURS_SE() });
  gps(se, 0, 0);
  eq('je conduis la route Saint-Étienne : au même endroit, c\'est le client X (de ma route) qui s\'ouvre, pas A (Charette) ni Y (sel)', se.presence().stopId, 'X');
  se.fin();
  const m = await monde();
  gps(m, 0, 0);
  eq('je conduis Charette (déneigement) : au même endroit que X (autre route) et Y (autre service), c\'est A', m.presence().stopId, 'A');
  m.fin();
  const inactif = await monde();
  gps(inactif, 300, 0);
  eq('un arrêt inactif n\'ouvre jamais de visite', inactif.presence(), null);
  inactif.fin();
  const loin = await monde();
  gps(loin, 100, 0); gps(loin, 0, 60); gps(loin, -50, -50);
  eq('loin de toute zone : rien', loin.presence(), null);
  loin.fin();
}

log('\n=== LA PRÉCISION DU GPS : LA MARGE, ET LES LECTURES TROP IMPRÉCISES ===');
{
  const ouvre = async (x, y, prec, extra = {}) => { const m = await monde(extra); gps(m, x, y, prec); const r = m.presence() !== null; m.fin(); return r; };
  eq('à 6 m du bord de la zone : précision 5 → dehors ; précision 8 → dedans', [await ouvre(0, 13.5, 5), await ouvre(0, 13.5, 8)], [false, true]);
  eq('… précision inconnue (marge 10 m) : dedans', await ouvre(0, 13.5, null), true);
  eq('un GPS à plus de 30 m d\'erreur est IGNORÉ (même au centre de la zone)', [await ouvre(0, 0, 31), await ouvre(0, 0, 60)], [false, false]);
  eq('… à 30 m pile : accepté (la marge est de 12 m au plus)', [await ouvre(0, 0, 30), await ouvre(0, 19.4, 30), await ouvre(0, 20.5, 30)], [true, true, false]);
  eq('le client D, sans zone dessinée : le cercle de 20 m (19 m dedans, 21 m dehors), sans marge', [await ouvre(0, 119, 5), await ouvre(0, 121, 5), await ouvre(0, 121, 12)], [true, false, false]);
  const m = await monde();
  gps(m, 0, 0, 5); rester(m, 0, 0, 10, 45);
  eq('des lectures imprécises PENDANT la visite (45 m) ne la ferment pas et ne comptent pas comme « dedans » (rien n\'est ajouté au temps dedans)', [m.presence() !== null, m.presence().dedansMs, m.presence().derniereVue === m.t() - 10000], [true, 0, true]);
  m.fin();
}

log('\n=== LA SORTIE : APRÈS 45 SECONDES DEHORS, LA VISITE EST FINIE ET NOTÉE (ARRIVÉE + DÉPART) ===');
{
  const m = await monde();
  m.run(`openCard(${m.idx('A')})`);
  const t0 = m.t();
  gps(m, 0, 0); rester(m, 0, 0, 30);   // 30 s dedans
  const depart = m.t();
  rester(m, 0, 45, 44);                // 44 s dehors (à 42,5 m du bord : loin de toute marge)
  eq('44 secondes dehors : la visite continue, la zone est encore bleue, rien n\'est noté', [m.presence() !== null, m.couleurZone('A'), m.gestes('arret_presence').length], [true, '#60a5fa', 0]);
  eq('… le temps dehors ne compte pas dans le temps dedans (30 s)', m.presence().dedansMs, 30000);
  rester(m, 0, 45, 1);
  eq('45 secondes dehors : la visite est finie', m.presence(), null);
  await pause();
  const g = m.gestes('arret_presence');
  eq('un geste « arret_presence » : la passe, le client, l\'arrivée (1ʳᵉ lecture dedans) et le départ (DERNIÈRE lecture dedans)', g.map((x) => [x.args, x.moment, x.libelle]), [[{ passeId: 'p-luc', stopId: 'A', arrivee: m.iso(t0), depart: m.iso(depart) }, m.iso(depart), '⏱ Temps passé : A rue Test']]);
  eq('la zone de A redevient JAUNE (le camion est parti, l\'arrêt n\'est pas fait), le marqueur aussi', [m.enCours('A'), m.couleurZone('A'), m.couleurMarqueur('A')], [false, '#c8e63c', '#c8e63c']);
  eq('la minuterie du chrono est arrêtée', [m.run('_presenceMinuterie'), [...m.minuteries.values()].filter((x) => x.ms === 1000).length], [null, 0]);
  eq('la mémoire du téléphone est vidée (plus de visite en cours)', m.memoire.has('lp_presence:u-luc'), false);
  eq('la fiche n\'a plus de chrono', m.fiche().includes('⏱'), false);
  m.fin();
}
{
  // Une visite trop courte n'est pas notée (un camion qui passe) ; à 20 secondes, elle l'est
  const essai = async (secondes) => { const m = await monde(); gps(m, 0, 0); rester(m, 0, 0, secondes); rester(m, 0, 45, 45); await pause(); const n = m.gestes('arret_presence').length; m.fin(); return n; };
  eq('19 secondes dedans : pas notée ; 20 secondes : notée', [await essai(19), await essai(20)], [0, 1]);
}
{
  // Les sautes du GPS : dedans / dehors à chaque seconde ne coupent pas la visite
  const m = await monde();
  const t0 = m.t();
  gps(m, 0, 0);
  for (let i = 1; i <= 60; i++) { m.avancer(1000); if (i % 2) gps(m, 0, 45); else gps(m, 0, 0); }
  eq('une lecture dedans, une dehors pendant une minute : UNE seule visite, jamais coupée, aucun geste', [m.presence().arrivee, m.gestes('arret_presence').length], [t0, 0]);
  eq('… 30 s « dedans » comptées (une seconde par lecture dedans, pas le temps écoulé)', m.presence().dedansMs, 30000);
  eq('… la dernière lecture dedans est la dernière lecture dedans (60 s après le début)', m.presence().derniereVue, t0 + 60000);
  m.fin();
}
{
  // Sorti puis revenu à moins de 45 secondes : la même visite
  const m = await monde();
  const t0 = m.t();
  gps(m, 0, 0); rester(m, 0, 0, 30); rester(m, 0, 45, 40); rester(m, 0, 0, 5);
  eq('40 secondes dehors puis retour : la MÊME visite (même arrivée), rien noté', [m.presence().arrivee, m.gestes('arret_presence').length], [t0, 0]);
  eq('… le temps dedans ne compte pas les 40 secondes dehors (35 s = 30 avant + 5 après)', m.presence().dedansMs, 35000);
  m.fin();
}
{
  // L'arrivée est la PREMIÈRE lecture dedans, le départ la DERNIÈRE ; une visite plus tard fait une 2ᵉ ligne
  const m = await monde();
  gps(m, 0, 0); rester(m, 0, 0, 25); rester(m, 0, 45, 45);
  await pause();
  const t1 = m.t();
  gps(m, 0, 0); rester(m, 0, 0, 40); rester(m, 0, 45, 45);
  await pause();
  const g = m.gestes('arret_presence');
  eq('sorti puis revenu bien plus tard (après 45 s dehors) : DEUX visites, deux gestes, la 2ᵉ commence à son retour', [g.length, g[1].args.arrivee], [2, m.iso(t1)]);
  m.fin();
}
{
  // Le GPS se tait (tunnel, écran…) : la minuterie ferme la visite après 45 s de silence
  const m = await monde();
  const t0 = m.t();
  gps(m, 0, 0); rester(m, 0, 0, 30);
  const depart = m.t();
  m.avancer(44000); m.run('presenceTic()');
  eq('44 secondes de silence : la visite continue', m.presence() !== null, true);
  m.avancer(1000); m.run('presenceTic()');
  await pause();
  eq('45 secondes de silence : fermée par la minuterie ; le départ est la dernière lecture', [m.presence(), m.gestes('arret_presence').map((g) => [g.args.arrivee, g.args.depart])], [null, [[m.iso(t0), m.iso(depart)]]]);
  m.fin();
}
{
  // Sa passe se termine : la visite est fermée tout de suite (la minuterie, ou la prochaine lecture)
  const m = await monde();
  const t0 = m.t();
  gps(m, 0, 0); rester(m, 0, 0, 30);
  const vue = m.t();
  m.run(`installerTours(${JSON.stringify(TOUR_TERMINE())}, Date.now())`);
  m.run('presenceTic()');
  await pause();
  eq('la passe est terminée : la minuterie ferme la visite et la note', [m.presence(), m.gestes('arret_presence').map((g) => [g.args.arrivee, g.args.depart])], [null, [[m.iso(t0), m.iso(vue)]]]);
  m.fin();
  const n = await monde();
  gps(n, 0, 0); rester(n, 0, 0, 30);
  n.run(`installerTours(${JSON.stringify(TOUR_TERMINE())}, Date.now())`);
  rester(n, 0, 0, 1);
  await pause();
  eq('… ou la lecture suivante du GPS', [n.presence(), n.gestes('arret_presence').length], [null, 1]);
  n.fin();
}
{
  // Une autre passe (une nouvelle passe débutée) : la visite d'avant est finie
  const m = await monde();
  gps(m, 0, 0); rester(m, 0, 0, 30);
  m.run(`installerTours(${JSON.stringify(TOURS({ passeId: 'p-luc-2' }))}, Date.now())`);
  rester(m, 0, 0, 1);
  await pause();
  eq('une nouvelle passe : l\'ancienne visite est notée (avec l\'ancienne passe) et une nouvelle s\'ouvre dans la nouvelle', [m.gestes('arret_presence').map((g) => g.args.passeId), m.presence().passeId, m.presence().stopId], [['p-luc'], 'p-luc-2', 'A']);
  m.fin();
}

log('\n=== LES CAS DIFFICILES : LECTURES EN DÉSORDRE, MINUTERIE SANS LECTURE, DONNÉES INCOHÉRENTES ===');
{
  // L’arrivée est l’heure de la LECTURE du GPS, pas l’heure où l’application la traite
  const h = await monde();
  const [la5, lo5] = pt(0, 0);
  h.run(`noterPosition(${la5}, ${lo5}, 5, __t - 5000)`);
  eq('l’arrivée est l’heure de la lecture du GPS (il y a 5 s), pas celle du traitement', [h.presence().arrivee, h.presence().derniereVue, h.presence().derniereLecture], [T0 - 5000, T0 - 5000, T0 - 5000]);
  h.fin();
}
{
  // Deux sources de GPS (l’avant-plan et le service d’arrière-plan) : une lecture qui arrive en retard ne fait jamais reculer la visite
  const m = await monde();
  const t0 = m.t();
  gps(m, 0, 0); rester(m, 0, 0, 30);
  const [la, lo] = pt(0, 0);
  m.run(`noterPosition(${la}, ${lo}, 5, ${t0 + 10000})`);   // une lecture dedans datée d’il y a 20 secondes, arrivée en retard
  eq('une lecture plus VIEILLE que la dernière vue dans la zone est ignorée (la dernière vue ne recule pas, rien n’est ajouté au temps dedans)', [m.presence().derniereVue, m.presence().dedansMs], [t0 + 30000, 30000]);
  m.fin();
  const n = await monde();
  const u0 = n.t();
  gps(n, 0, 0); rester(n, 0, 0, 3);     // dedans jusqu’à u0 + 3 s (3 s comptées)
  n.avancer(2000); gps(n, 0, 45);        // une lecture dehors à u0 + 5 s
  const [l2, o2] = pt(0, 0);
  n.run(`noterPosition(${l2}, ${o2}, 5, ${u0 + 4000})`);   // une lecture dedans datée u0 + 4 s, arrivée APRÈS celle de u0 + 5 s
  eq('une lecture dedans datée AVANT la dernière lecture (dehors) : le temps dedans ne gagne rien, et ne perd rien (3 s)', n.presence().dedansMs, 3000);
  n.run(`noterPosition(${l2}, ${o2}, 5, ${u0 + 6000})`);
  eq('… la lecture suivante (u0 + 6 s) ne compte que 1 s depuis la dernière lecture connue (celle de u0 + 5 s, pas celle de u0 + 4 s) : 4 s', n.presence().dedansMs, 4000);
  n.fin();
}
{
  // La minuterie : sans lecture du GPS (écran éteint), le chrono de la fiche avance quand même ; une passe remplacée ferme la visite
  const m = await monde();
  m.run(`openCard(${m.idx('A')})`);
  gps(m, 0, 0); rester(m, 0, 0, 25);
  m.avancer(20000); m.run('presenceTic()');   // 20 s sans lecture : le chrono avance quand même
  vrai('sans nouvelle lecture, la minuterie fait avancer le chrono de la fiche (45 s)', m.fiche().endsWith('⏱ 45 s'), m.fiche());
  eq('… et ne ferme pas la visite (20 s de silence, moins que 45 s)', m.presence() !== null, true);
  m.run(`installerTours(${JSON.stringify(TOURS({ passeId: 'p-luc-2' }))}, Date.now())`);
  m.run('presenceTic()');
  await pause();
  eq('la passe de la visite n’est plus la mienne (une autre passe l’a remplacée) : la minuterie ferme la visite et la note avec son ancienne passe', [m.presence(), m.gestes('arret_presence').map((g) => g.args.passeId)], [null, ['p-luc']]);
  m.fin();
  const a = await monde();
  a.run('presenceTic()');
  eq('la minuterie sans visite ne fait rien (et ne plante pas)', a.presence(), null);
  a.fin();
}
{
  // Des données incohérentes : un tour « terminé » qui garde pourtant une passe à mon nom
  const m = await monde({ tours: [{ ...TOURS()[0], en_cours: false }] });
  gps(m, 0, 0);
  eq('un tour marqué « terminé » n’ouvre jamais de visite, même s’il garde une passe à mon nom', m.presence(), null);
  m.fin();
}

log('\n=== DEUX TERRAINS VOISINS : UN SEUL CLIENT À LA FOIS ===');
{
  const m = await monde();
  const t0 = m.t();
  gps(m, 0, 0); rester(m, 0, 0, 30);
  const vueA = m.t();
  m.avancer(1000); gps(m, 11.5, 0);   // dans la zone de C (qui commence à 10,5 m), dans la marge de A (qui finit à 7,5 m + 5 m)
  eq('à cheval sur les deux terrains : on reste chez A tant qu\'on est encore dans sa zone', [m.presence().stopId, m.gestes('arret_presence').length], ['A', 0]);
  m.avancer(1000); gps(m, 18, 0);
  await pause();
  eq('au milieu de C, hors de A : A est fermé (départ = sa dernière lecture dedans), C s\'ouvre', [m.presence().stopId, m.presence().arrivee === m.t(), m.gestes('arret_presence').map((g) => [g.args.stopId, g.args.arrivee, g.args.depart])], ['C', true, [['A', m.iso(t0), m.iso(m.t() - 1000)]]]);
  m.fin();
  const n = await monde();
  gps(n, 11.5, 0, 5);
  eq('en arrivant à cheval sur les deux : le plus à l\'INTÉRIEUR gagne (11,5 m est dans la zone de C, seulement dans la marge de A)', n.presence().stopId, 'C');
  n.fin();
  const p = await monde();
  gps(p, 9, 0, 5);
  eq('… à 9 m : dans A (à 1,5 m du bord, dans la marge), pas dans C (à 1,5 m : dans sa marge aussi) : égalité de distance, le plus proche de SON POINT gagne : A', p.presence().stopId, 'A');
  p.fin();
}
{
  // Passer d’un terrain à l’autre : la visite de C est gardée sur le téléphone tout de suite après celle de A (moins de 10 s d’écart)
  const m = await monde();
  gps(m, 0, 0);
  const avant = m.marqueurs.length;
  m.avancer(1000); gps(m, 18, 0);
  eq('de A à C en une seconde : la mémoire du téléphone garde la visite de C (jamais celle de A, jamais rien)', JSON.parse(m.memoire.get('lp_presence:u-luc')).stopId, 'C');
  eq('… et la carte n’est redessinée qu’UNE fois (8 marqueurs par dessin) : pas une fois pour fermer A puis une fois pour ouvrir C', m.marqueurs.length - avant, 8);
  m.fin();
}
{
  // Deux zones qui se CHEVAUCHENT : le plus à l’intérieur, puis à égalité le plus près de son point
  const chevauche = [S('P1', 0, 0, { zone_points: rect(0, 0, 15) }), S('P2', 10, 0, { zone_points: rect(10, 0, 15) }), S('E', 400, 400), S('F', 500, 500), S('G', 600, 600)];
  const ou = async (x) => { const m = await monde({ stops: chevauche.map((s) => ({ ...s })) }); gps(m, x, 0); const r = m.presence().stopId; m.fin(); return r; };
  eq('dans les deux zones à la fois : à 4 m du point de P1 (6 m de celui de P2) c’est P1, à 6 m de P1 (4 m de P2) c’est P2', [await ou(4), await ou(6)], ['P1', 'P2']);
}
{
  // Un client déjà fait n'ouvre plus de visite ; celle qui est commencée continue
  const m = await monde({ tours: TOURS({ faits: ['A'] }) });
  gps(m, 0, 0); rester(m, 0, 0, 90);
  eq('A est déjà fait : la zone ne s\'ouvre pas, aucun chrono, rien n\'est complété de plus', [m.presence(), m.gestes().length], [null, 0]);
  m.fin();
  const n = await monde();
  gps(n, 0, 0); rester(n, 0, 0, 30);
  n.run(`installerTours(${JSON.stringify(TOURS({ faits: ['A'] }))}, Date.now()); renderAll();`);   // complété à la main (ou par un autre camion) pendant la visite : l'écran se redessine
  rester(n, 0, 0, 30);
  eq('A devient fait PENDANT la visite : elle continue (le temps chez le client compte jusqu\'à la sortie), la zone est verte', [n.presence().stopId, n.presence().dedansMs, n.couleurZone('A')], ['A', 60000, '#4ade80']);
  n.fin();
}

log('\n=== LE « COMPLÉTÉ » AUTOMATIQUE : APRÈS 60 SECONDES DANS LA ZONE ===');
{
  const m = await monde();
  m.hors();   // (les gestes restent dans la file : on les lit)
  gps(m, 0, 0);
  rester(m, 0, 0, 59);
  await pause();
  eq('59 secondes dedans : pas encore', [m.gestes('completer_arret').length, m.fait('A')], [0, false]);
  const [la, lo] = pt(0, 0);
  rester(m, 0, 0, 1);
  await pause();
  const g = m.gestes('completer_arret');
  eq('60 secondes dedans : un geste « completer_arret » en mode AUTO (passe, client, position du camion, heure de la lecture)', g.map((x) => [x.args, x.moment, x.libelle]), [[{ passeId: 'p-luc', stopId: 'A', mode: 'auto', lat: la, lon: lo }, m.iso(m.t()), '✔ Complété automatiquement : A rue Test']]);
  eq('A est FAIT à l\'écran tout de suite : la zone et le marqueur passent au VERT (plus bleus)', [m.fait('A'), m.enCours('A'), m.couleurZone('A'), m.couleurMarqueur('A')], [true, false, '#4ade80', '#4ade80']);
  eq('le chauffeur le sait : « ✔ Complété automatiquement : … » + « envoyé au retour du signal » (pas de réseau)', m.appels.toasts, ['✔ Complété automatiquement : A rue Test · ⏳ envoyé au retour du signal']);
  eq('la visite continue (le camion est encore là) : le chrono avance, « camion sur place » reste', [m.presence().stopId, m.presence().autoTente, m.run('presenceEstIci(stops[' + m.idx('A') + '])')], ['A', true, true]);
  m.run(`openCard(${m.idx('A')})`);
  eq('la fiche : passe 1/5, camion sur place, chrono, « en attente d\'envoi »', /Passe n° \S+ · 1\/5 \(20 %\) · 🚜 camion sur place · ⏱ 1 min 00 s · ⏳ en attente d’envoi$/.test(m.fiche()), true, m.fiche());
  rester(m, 0, 0, 120);
  await pause();
  eq('120 secondes de plus au même endroit : jamais un 2ᵉ « Complété » (un seul geste, un seul message)', [m.gestes('completer_arret').length, m.appels.toasts.length], [1, 1]);
  m.fin();
}
{
  // Le geste part quand il y a du signal : ce que le SERVEUR reçoit
  const m = await monde({ enLigne: true });
  gps(m, 0, 0); rester(m, 0, 0, 60);
  await pause(); await pause();
  const [la, lo] = pt(0, 0);
  const r = m.rpc('completer_arret');
  eq('en ligne : le serveur reçoit completer_arret avec p_mode « auto », l\'heure du geste, la position ; la file est vide', [r.map((x) => x.args), m.gestes().length, m.refuses().length], [[{ p_passe_id: 'p-luc', p_stop_id: 'A', p_moment: m.iso(m.t()), p_mode: 'auto', p_lat: la, p_lon: lo }], 0, 0]);
  eq('… et le message n\'ajoute rien sur l\'attente du signal', m.appels.toasts, ['✔ Complété automatiquement : A rue Test']);
  rester(m, 0, 45, 45);
  await pause(); await pause();
  const p = m.rpc('arret_presence');
  eq('à la sortie : le serveur reçoit arret_presence (passe, client, arrivée, départ) ; la file est vide', [p.map((x) => x.args), m.gestes().length], [[{ p_passe_id: 'p-luc', p_stop_id: 'A', p_arrivee: m.iso(m.t() - 45000 - 60000), p_depart: m.iso(m.t() - 45000) }], 0]);
  m.fin();
}
{
  // Le réglage : 30 secondes, 0 = jamais, illisible = 60
  const essai = async (valeur, secondes) => {
    const m = await monde({ reglages: valeur === undefined ? [] : [{ cle: 'presence_complete_auto_s', valeur, description: 'x' }] });
    m.hors(); gps(m, 0, 0); rester(m, 0, 0, secondes); await pause();
    const n = m.gestes('completer_arret').length; m.fin(); return n;
  };
  eq('réglé à 30 secondes : à 29 s pas encore, à 30 s oui', [await essai(30, 29), await essai(30, 30)], [0, 1]);
  eq('réglé à 90 secondes : à 60 s pas encore, à 90 s oui', [await essai(90, 60), await essai(90, 90)], [0, 1]);
  eq('réglé à 0 (JAMAIS) : même après 10 minutes dans la zone, jamais tout seul', await essai(0, 600), 0);
  eq('réglage illisible (« abc ») : 60 secondes', [await essai('abc', 59), await essai('abc', 60)], [0, 1]);
  eq('aucun réglage dans la base : 60 secondes', [await essai(undefined, 59), await essai(undefined, 60)], [0, 1]);
}
{
  // La précision exigée pour le complété automatique : 20 m ; une lecture précise plus tard le déclenche (jamais « tenté » pour rien)
  const m = await monde();
  m.hors();
  gps(m, 0, 0, 25); rester(m, 0, 0, 100, 25);
  await pause();
  eq('un GPS à 25 m d\'erreur pendant 100 secondes : la zone est bleue et le chrono tourne, mais RIEN n\'est complété tout seul', [m.presence() !== null, m.presence().dedansMs, m.gestes('completer_arret').length, m.presence().autoTente], [true, 100000, 0, false]);
  rester(m, 0, 0, 1, 20);
  await pause();
  eq('la lecture suivante à 20 m (assez précise) le déclenche', [m.gestes('completer_arret').length, m.fait('A')], [1, true]);
  m.fin();
}
{
  // Sans zone dessinée (le cercle de 20 m couvre plusieurs maisons) : jamais tout seul
  const m = await monde();
  m.hors();
  gps(m, 0, 100); rester(m, 0, 100, 300);
  await pause();
  eq('le client D n\'a pas de zone dessinée : la visite s\'ouvre (zone bleue, chrono) mais l\'arrêt n\'est jamais complété tout seul', [m.presence().stopId, m.enCours('D'), m.presence().dedansMs, m.gestes('completer_arret').length], ['D', true, 300000, 0]);
  m.fin();
}
{
  // Des trous entre les lectures : chaque trou compte pour 15 secondes au plus
  const m = await monde();
  m.hors();
  gps(m, 0, 0);
  for (let i = 0; i < 3; i++) { m.avancer(20000); gps(m, 0, 0); }
  await pause();
  eq('une lecture toutes les 20 secondes : chaque trou ne compte que pour 15 s (3 trous : 45 s), pas encore complété', [m.presence().dedansMs, m.gestes('completer_arret').length], [45000, 0]);
  m.avancer(20000); gps(m, 0, 0);
  await pause();
  eq('le 4ᵉ trou : 60 s comptées, complété (alors que 80 s se sont écoulées)', [m.presence().dedansMs, m.gestes('completer_arret').length], [60000, 1]);
  m.fin();
  const n = await monde();
  gps(n, 0, 0);
  n.avancer(300000); gps(n, 0, 0);
  eq('une seule lecture après 5 minutes de silence dans la zone : 15 s comptées seulement (jamais 5 minutes d\'un coup)', n.presence().dedansMs, 15000);
  n.fin();
}
{
  // Ce qui empêche le complété automatique : un client déjà fait, exclu (annulé), pas de passe à moi, un passager
  const dejaFait = await monde({ tours: TOURS({ faits: ['B'] }) });
  dejaFait.hors(); gps(dejaFait, 200, 0); rester(dejaFait, 200, 0, 120); await pause();
  eq('un client déjà fait : jamais de 2ᵉ « Complété »', dejaFait.gestes().length, 0);
  dejaFait.fin();
  const exclu = await monde();
  exclu.hors(); exclu.run(`presenceExclure('A')`); gps(exclu, 0, 0); rester(exclu, 0, 0, 120); await pause();
  eq('un client exclu (annulé à la main dans cette passe) : jamais tout seul, même après 2 minutes', [exclu.presence().dedansMs, exclu.gestes('completer_arret').length], [120000, 0]);
  exclu.fin();
  const autre = await monde();
  autre.hors(); autre.run(`presenceExclure('B'); presenceExclure(null)`); gps(autre, 0, 0); rester(autre, 0, 0, 60); await pause();
  eq('exclure un AUTRE client (ou « rien ») n\'empêche pas celui-ci', autre.gestes('completer_arret').length, 1);
  autre.fin();
}
{
  // Le téléphone n'a pas pu GARDER le geste : jamais « fait » sans trace ; on réessaie à la lecture suivante
  const m = await monde();
  m.hors();
  m.run('__enfilerVrai = enfiler; enfiler = async () => ({ok: false});');
  gps(m, 0, 0); rester(m, 0, 0, 60);
  await pause();
  eq('le stockage refuse le geste : l\'arrêt n\'est PAS fait à l\'écran, aucun message', [m.fait('A'), m.appels.toasts.length, m.presence().autoTente], [false, 0, false]);
  rester(m, 0, 0, 1);
  await pause();
  eq('… la lecture suivante réessaie (toujours refusé : toujours rien)', [m.fait('A'), m.appels.toasts.length], [false, 0]);
  m.run('enfiler = __enfilerVrai;');
  rester(m, 0, 0, 1);
  await pause();
  eq('… le stockage remarche : le geste est gardé, l\'arrêt est fait', [m.gestes('completer_arret').length, m.fait('A'), m.appels.toasts.length], [1, true, 1]);
  m.fin();
}
{
  // Le dernier client de la passe : « Passe terminée : 100 % » et la visite se termine avec elle
  const m = await monde({ tours: TOURS({ faits: ['B', 'C', 'D', 'E'] }) });
  m.hors();
  gps(m, 0, 0); rester(m, 0, 0, 60);
  await pause();
  eq('complété tout seul, c\'était le dernier : « 🎉 Passe terminée : 100 % ! »', m.appels.toasts, ['🎉 Passe terminée : 100 % ! · ⏳ envoyé au retour du signal']);
  rester(m, 0, 0, 1);
  await pause();
  eq('la passe est terminée : la visite est fermée à la lecture suivante et notée (même sous 20 s : le complété automatique compte)', [m.presence(), m.gestes('arret_presence').length], [null, 1]);
  m.fin();
}
{
  // Un « Complété » tout court (< 20 s de visite) noté quand même : le réglage à 5 secondes
  const m = await monde({ reglages: [{ cle: 'presence_complete_auto_s', valeur: 5, description: 'x' }] });
  m.hors();
  gps(m, 0, 0); rester(m, 0, 0, 5); rester(m, 0, 45, 45);
  await pause();
  eq('réglé à 5 s : complété tout seul, la visite de 5 s est notée (elle porte un « Complété »)', [m.gestes('completer_arret').length, m.gestes('arret_presence').length], [1, 1]);
  m.fin();
}

{
  // La fiche ouverte montre tout de suite le résultat ; le camion qui part ne redessine pas la carte pour rien
  const m = await monde();
  m.run(`openCard(${m.idx('A')})`);
  gps(m, 0, 0); rester(m, 0, 0, 60);
  await pause();
  eq('la fiche ouverte sur A montre tout de suite le résultat : le bouton devient « ↩ Annuler (10 min) » et la phrase dit 1/5', [m.el('btn-cmp').textContent, /1\/5 \(20 %\)/.test(m.fiche())], ['↩ Annuler (10 min)', true]);
  eq('… la visite gardée sur le téléphone sait que l’arrêt est complété tout seul', JSON.parse(m.memoire.get('lp_presence:u-luc')).autoTente, true);
  const n0 = m.marqueurs.length;
  rester(m, 0, 45, 45);
  eq('… le camion part : la fiche perd son chrono, mais la carte n’est PAS redessinée pour rien (A est déjà vert : rien ne change de couleur)', [m.fiche().includes('⏱'), m.marqueurs.length === n0], [false, true]);
  m.fin();
}
{
  // Des lectures d’un seul souffle (sans attendre entre elles) : un seul « Complété », jamais un par lecture après le seuil
  const m = await monde();
  gps(m, 0, 0); rester(m, 0, 0, 130);
  await pause();
  eq('130 secondes de lectures d’un seul souffle : UN SEUL « Complété » automatique', [m.gestes('completer_arret').length, m.appels.toasts.length], [1, 1]);
  m.fin();
}
{
  // Le stockage du téléphone plante (une erreur, pas seulement un refus)
  const m = await monde();
  m.run('__enfilerVrai = enfiler; __essais = 0; enfiler = async () => { __essais++; throw new Error("boum"); };');
  gps(m, 0, 0); rester(m, 0, 0, 60);
  await pause();
  rester(m, 0, 0, 1);
  await pause();
  eq('le stockage plante : aucun message, l’arrêt n’est pas fait, la lecture suivante réessaie (2 essais)', [m.fait('A'), m.appels.toasts.length, m.run('__essais')], [false, 0, 2]);
  m.run('enfiler = __enfilerVrai;');
  rester(m, 0, 0, 1);
  await pause();
  eq('… le stockage remarche : complété', [m.fait('A'), m.gestes('completer_arret').length], [true, 1]);
  m.fin();
}
{
  // Quitter la zone ne complète jamais l’arrêt : 100 secondes dedans avec un GPS trop imprécis, puis le départ avec un GPS précis
  const m = await monde();
  gps(m, 0, 0, 25); rester(m, 0, 0, 100, 25);
  rester(m, 0, 45, 45, 5);
  await pause();
  eq('un camion qui QUITTE la zone (visite fermée) ne complète jamais l’arrêt en partant, même avec 100 s dedans et un GPS précis à la sortie', [m.gestes('completer_arret').length, m.fait('A'), m.presence()], [0, false, null]);
  m.fin();
}

log('\n=== ANNULER UN « COMPLÉTÉ » AUTOMATIQUE : JAMAIS REFAIT TOUT SEUL DANS LA MÊME PASSE ===');
{
  const m = await monde();
  m.hors();
  gps(m, 0, 0); rester(m, 0, 0, 60);
  await pause();
  const i = m.idx('A');
  eq('(mise en place) complété tout seul, le bouton devient « Annuler »', m.run(`etatComplete(stops[${i}]).action`), 'annuler');
  m.run(`openCard(${i})`);
  await m.run(`annulerArret(stops[${i}], etatComplete(stops[${i}]))`);
  await pause();
  eq('la personne annule : l\'arrêt redevient à faire (le geste en attente est simplement retiré : rien à envoyer)', [m.fait('A'), m.gestes('completer_arret').length, m.appels.toasts[m.appels.toasts.length - 1]], [false, 0, '↩ Arrêt annulé : rien à envoyer']);
  eq('… le camion est toujours là : la zone est de nouveau BLEUE (client à faire, camion sur place)', [m.enCours('A'), m.couleurZone('A')], [true, '#60a5fa']);
  rester(m, 0, 0, 200);
  await pause();
  eq('… et il n\'est JAMAIS refait tout seul (200 secondes de plus dans la zone : aucun geste)', m.gestes('completer_arret').length, 0);
  rester(m, 0, 45, 45); rester(m, 0, 0, 1); rester(m, 0, 0, 120);
  await pause();
  eq('… même après être sorti et revenu (nouvelle visite, même passe)', [m.presence() !== null, m.gestes('completer_arret').length], [true, 0]);
  m.run(`installerTours(${JSON.stringify(TOURS({ passeId: 'p-luc-2' }))}, Date.now())`);
  rester(m, 0, 0, 61);
  await pause();
  eq('une NOUVELLE passe : les annulations d\'avant ne comptent plus, il se complète de nouveau tout seul', m.gestes('completer_arret').map((g) => g.args.passeId), ['p-luc-2']);
  m.fin();
}
{
  // Complété tout seul, puis annulé AILLEURS (l'administrateur, un autre téléphone) : jamais refait non plus
  const m = await monde({ enLigne: true });
  gps(m, 0, 0); rester(m, 0, 0, 60);
  await pause(); await pause();
  eq('(mise en place) le geste est parti', [m.rpc('completer_arret').length, m.gestes().length], [1, 0]);
  m.run(`installerTours(${JSON.stringify(TOURS())}, Date.now())`);   // le serveur dit : l'arrêt n'est plus fait (annulé ailleurs)
  eq('l\'arrêt est de nouveau à faire', m.fait('A'), false);
  rester(m, 0, 45, 45); rester(m, 0, 0, 1); rester(m, 0, 0, 100);
  await pause();
  eq('le camion revient et reste 100 secondes : jamais refait tout seul', [m.presence() !== null, m.rpc('completer_arret').length, m.gestes('completer_arret').length], [true, 1, 0]);
  m.fin();
}

{
  // Annuler le « Complété » d’une passe TERMINÉE (le dernier client) : elle se rouvre, et l’arrêt ne se refait pas tout seul
  const m = await monde({ tours: TOURS({ faits: ['B', 'C', 'D', 'E'] }) });
  gps(m, 0, 0); rester(m, 0, 0, 60);
  await pause();
  rester(m, 0, 0, 1);   // (la passe est terminée : la visite se ferme à la lecture suivante)
  await pause();
  eq('(mise en place) A était le dernier client : la passe est terminée, la visite est fermée', [m.fait('A'), m.run('maPasse()'), m.presence()], [true, null, null]);
  const i = m.idx('A');
  await m.run(`annulerArret(stops[${i}], etatComplete(stops[${i}]))`);
  await pause();
  eq('la personne annule ce « Complété » (la passe se rouvre) : A est de nouveau à faire, et c’est encore ma passe', [m.fait('A'), m.run('maPasse() !== null')], [false, true]);
  rester(m, 0, 0, 120);
  await pause();
  eq('le camion est toujours là : une nouvelle visite s’ouvre, mais JAMAIS refait tout seul (l’annulation vaut pour la passe annulée, même si elle était terminée à ce moment-là)', [m.presence() !== null, m.gestes('completer_arret').length], [true, 0]);
  m.fin();
}
{
  // « Complété » à la MAIN, puis annulé alors que le camion est encore là : il ne se complète pas tout seul ensuite (l’exclusion vient de l’annulation)
  const m = await monde();
  gps(m, 0, 0); rester(m, 0, 0, 20);
  const i = m.idx('A');
  m.run(`openCard(${i})`);
  await m.run('completeStop()');
  await pause();
  await m.run(`annulerArret(stops[${i}], etatComplete(stops[${i}]))`);
  await pause();
  eq('(mise en place) « Complété » à la main à 20 s, puis annulé : l’arrêt est de nouveau à faire, rien ne reste dans la file, le camion est encore là', [m.fait('A'), m.gestes('completer_arret').length, m.presence().stopId], [false, 0, 'A']);
  rester(m, 0, 0, 200);
  await pause();
  eq('200 secondes de plus dans la zone : jamais complété tout seul (la personne l’a annulé)', m.gestes('completer_arret').length, 0);
  m.fin();
}
{
  // Le dernier client complété à la main, la passe est terminée ; annulé : elle se rouvre, et l’arrêt ne se complète pas tout seul (l’annulation vaut pour la passe annulée)
  const m = await monde({ tours: TOURS({ faits: ['B', 'C', 'D', 'E'] }) });
  gps(m, 0, 0); rester(m, 0, 0, 20);
  const i = m.idx('A');
  m.run(`openCard(${i})`);
  await m.run('completeStop()');
  await pause();
  rester(m, 0, 0, 1);   // (la passe est terminée : la visite se ferme à la lecture suivante)
  await pause();
  eq('(mise en place) « Complété » à la main du dernier client : la passe est terminée, la visite est fermée', [m.fait('A'), m.run('maPasse()'), m.presence()], [true, null, null]);
  await m.run(`annulerArret(stops[${i}], etatComplete(stops[${i}]))`);
  await pause();
  rester(m, 0, 0, 120);
  await pause();
  eq('annulé (la passe se rouvre) : le camion est toujours là, une nouvelle visite s’ouvre, mais l’arrêt n’est JAMAIS complété tout seul', [m.fait('A'), m.presence() !== null, m.gestes('completer_arret').length], [false, true, 0]);
  m.fin();
}
{
  const m = await monde();
  m.run(`presenceExclure('A')`);
  eq('presenceExclure sans passe précisée : celle qui est à moi', m.run('[..._presenceExclus]'), ['p-luc|A']);
  m.run(`presenceExclure('B', 'p-ancienne')`);
  eq('… avec la passe de l’annulation : celle-là', m.run('[..._presenceExclus].sort()'), ['p-ancienne|B', 'p-luc|A']);
  const sans = await monde({ tours: [] });
  sans.run(`presenceExclure('A')`);
  eq('… ni passe précisée ni passe à moi : rien', sans.run('_presenceExclus.size'), 0);
  m.fin(); sans.fin();
}

log('\n=== LE COMPLÉTÉ À LA MAIN PENDANT LA VISITE, ET LA FIN DE LA VISITE ===');
{
  const m = await monde();
  m.hors();
  gps(m, 0, 0); rester(m, 0, 0, 20);
  m.run(`openCard(${m.idx('A')})`);
  await m.run('completeStop()');
  await pause();
  eq('le chauffeur touche « Complété » à la main à 20 s : geste « manuel » (pas « auto »)', m.gestes('completer_arret').map((g) => g.args.mode), ['manuel']);
  rester(m, 0, 0, 100);
  await pause();
  eq('la visite continue après le « Complété » manuel, sans 2ᵉ « Complété » automatique', [m.presence().stopId, m.presence().dedansMs, m.gestes('completer_arret').length], ['A', 120000, 1]);
  m.fin();
}

log('\n=== SANS RÉSEAU ET AU RETOUR DU SIGNAL : LES DEUX GESTES PARTENT DANS L\'ORDRE ===');
{
  const m = await monde();
  m.hors();
  gps(m, 0, 0); rester(m, 0, 0, 60); rester(m, 0, 45, 45);
  await pause();
  eq('hors réseau : le « Complété » automatique PUIS le temps passé attendent dans la file, dans l\'ordre', m.gestes().map((g) => g.type), ['completer_arret', 'arret_presence']);
  eq('… rien n\'est parti', m.appels.rpc.filter((r) => r.nom === 'completer_arret' || r.nom === 'arret_presence').length, 0);
  m.run('reseau.enLigne = true');
  await m.run('rejouerFile()');
  eq('le signal revient : le serveur reçoit d\'abord completer_arret (auto), puis arret_presence ; la file est vide', [m.appels.rpc.filter((r) => r.nom === 'completer_arret' || r.nom === 'arret_presence').map((r) => r.nom + ':' + (r.args.p_mode || '')), m.gestes().length, m.refuses().length], [['completer_arret:auto', 'arret_presence:'], 0, 0]);
  m.fin();
}

log('\n=== LA FILE DES GESTES : « arret_presence » EST UNE MESURE, JAMAIS UN SOUCI POUR LE CHAUFFEUR ===');
{
  const envoyer = async (type, erreurs, args) => {
    const m = await monde({ erreursRpc: erreurs, enLigne: true });
    await m.run(`enfiler('${type}', ${JSON.stringify(args)}, {libelle: 'geste', moment: '${m.iso(m.t())}'})`);
    await attendre(120);
    const r = { appels: m.rpc(type).length, attente: m.gestes().length, refuses: m.refuses().length, toasts: m.appels.toasts.length };
    m.fin();
    return r;
  };
  const presenceArgs = { passeId: 'p-luc', stopId: 'A', arrivee: new Date(T0).toISOString(), depart: new Date(T0 + 60000).toISOString() };
  const completerArgs = { passeId: 'p-luc', stopId: 'A', mode: 'manuel', lat: 46.4, lon: -72.9 };
  eq('un envoi réussi : une fois, la file est vide', await envoyer('arret_presence', {}, presenceArgs), { appels: 1, attente: 0, refuses: 0, toasts: 0 });
  eq('refusé pour de bon par une règle du serveur (« presence_trop_longue ») : abandonné SANS message, SANS « Gestes non envoyés »', await envoyer('arret_presence', { arret_presence: { code: 'P0001', message: 'presence_trop_longue' } }, presenceArgs), { appels: 1, attente: 0, refuses: 0, toasts: 0 });
  eq('la fonction n\'existe pas encore sur le serveur (SQL 29 pas exécuté : erreur 404) : abandonné en silence', await envoyer('arret_presence', { arret_presence: { code: 'PGRST202', status: 404, message: 'Could not find the function public.arret_presence' } }, presenceArgs), { appels: 1, attente: 0, refuses: 0, toasts: 0 });
  eq('CONTRASTE : le même refus pour un « Complété » (completer_arret, « non_autorise ») est, lui, bien MONTRÉ (non envoyé + message)', await envoyer('completer_arret', { completer_arret: { code: 'P0001', message: 'non_autorise' } }, completerArgs), { appels: 1, attente: 0, refuses: 1, toasts: 1 });
  eq('erreur inconnue : 5 essais, puis abandonné SANS bruit (une mesure ne retient pas les autres gestes)', await envoyer('arret_presence', { arret_presence: { message: 'boum' } }, presenceArgs), { appels: 5, attente: 0, refuses: 0, toasts: 0 });
  eq('CONTRASTE : une erreur inconnue sur un « Complété » : 5 essais, puis « non envoyé » avec un message', await envoyer('completer_arret', { completer_arret: { message: 'boum' } }, completerArgs), { appels: 5, attente: 0, refuses: 1, toasts: 1 });
  const m = await monde({ pannesRpc: ['arret_presence'], enLigne: true });
  await m.run(`enfiler('arret_presence', ${JSON.stringify(presenceArgs)}, {libelle: 'geste', moment: '${m.iso(m.t())}'})`);
  await attendre(120);
  eq('une panne de RÉSEAU : le geste ATTEND le retour du signal (jamais abandonné), le téléphone se sait hors réseau', [m.gestes('arret_presence').length, m.refuses().length, m.run('reseau.enLigne')], [1, 0, false]);
  m.fin();
  const n = await monde({ enLigne: true });
  await n.run(`enfiler('arret_presence', {passeId:'p-luc', stopId:'A', arrivee:'${n.iso(T0)}'}, {libelle: 'geste', moment: '${n.iso(T0)}'})`);
  await attendre(60);
  eq('sans départ (une arrivée seule) : p_depart est « null » (le serveur l\'accepte)', n.rpc('arret_presence').map((r) => r.args), [{ p_passe_id: 'p-luc', p_stop_id: 'A', p_arrivee: n.iso(T0), p_depart: null }]);
  n.fin();
}

log('\n=== LA MÉMOIRE DU TÉLÉPHONE : UNE FERMETURE DE L\'APPLICATION NE PERD PAS LA VISITE ===');
{
  const m = await monde();
  const t0 = m.t();
  gps(m, 0, 0);
  const memo = () => JSON.parse(m.memoire.get('lp_presence:u-luc'));
  eq('à l\'ouverture de la visite : elle est écrite sur le téléphone (une clé par employé)', memo(), { stopId: 'A', passeId: 'p-luc', arrivee: t0, derniereVue: t0, derniereLecture: t0, dedansMs: 0, autoTente: false });
  eq('une écriture', m.appels.memo, 1);
  rester(m, 0, 0, 9);
  eq('9 secondes plus tard : pas de nouvelle écriture (au plus une toutes les 10 s)', m.appels.memo, 1);
  rester(m, 0, 0, 1);
  eq('à 10 secondes : elle est mise à jour (dernière lecture, temps dedans)', [m.appels.memo, memo().derniereVue, memo().dedansMs], [2, t0 + 10000, 10000]);
  m.fin();
}
{
  // Rouverture : la visite continue si elle est récente et que c'est toujours ma passe
  const memo = { stopId: 'A', passeId: 'p-luc', arrivee: T0 - 80000, derniereVue: T0 - 10000, derniereLecture: T0 - 10000, dedansMs: 70000, autoTente: false };
  const m = await monde({ memo: { 'lp_presence:u-luc': JSON.stringify(memo) } });
  eq('rouvrir l\'application 10 s après la dernière lecture, même passe : la visite CONTINUE (mêmes arrivée et temps dedans, zone bleue, minuterie)', [m.presence(), m.enCours('A'), m.couleurZone('A'), m.run('_presenceMinuterie !== null')], [memo, true, '#60a5fa', true]);
  eq('… aucun geste (elle n\'est pas finie)', m.gestes().length, 0);
  m.hors(); rester(m, 0, 0, 1);
  await pause();
  eq('… le complété automatique se fait dès la prochaine lecture (le temps dedans d\'avant compte : 70 s)', m.gestes('completer_arret').length, 1);
  m.fin();
  const auto = await monde({ memo: { 'lp_presence:u-luc': JSON.stringify({ ...memo, autoTente: true }) } });
  auto.hors(); rester(auto, 0, 0, 100); await pause();
  eq('une visite déjà complétée tout seul avant la fermeture : jamais refait (même si l’arrêt est à faire dans la copie lue)', auto.gestes('completer_arret').length, 0);
  rester(auto, 0, 45, 45); rester(auto, 0, 0, 1); rester(auto, 0, 0, 130); await pause();
  eq('… même après être sorti puis revenu (une NOUVELLE visite, dans la même passe : l’exclusion a survécu à la fermeture de l’application)', auto.gestes('completer_arret').length, 0);
  auto.fin();
  // « complété tout seul » se souvient : une visite courte qui l’avait fait est notée quand elle se termine
  const courteAuto2 = await monde({ memo: { 'lp_presence:u-luc': JSON.stringify({ stopId: 'A', passeId: 'p-luc', arrivee: T0 - 10000, derniereVue: T0 - 5000, derniereLecture: T0 - 5000, dedansMs: 5000, autoTente: true }) } });
  rester(courteAuto2, 0, 45, 45);
  await pause();
  eq('une visite courte (5 s) reprise après la fermeture de l’application, qui avait déjà complété l’arrêt tout seul : notée quand elle se termine (le complété automatique compte)', [courteAuto2.presence(), notees(courteAuto2).length], [null, 1]);
  courteAuto2.fin();
  const deja = await monde({ memo: { 'lp_presence:u-luc': JSON.stringify(memo) } });
  deja.memoire.set('lp_presence:u-luc', JSON.stringify({ ...memo, stopId: 'B', arrivee: T0 - 50000, derniereVue: T0 - 5000 }));   // (une autre mémoire apparaît alors qu’une visite est déjà là)
  deja.run(`presenceRestaurer()`);
  eq('une visite est déjà en cours : une autre mémoire n’est ni lue ni remplacée (la visite n’est pas remplacée, rien n’est noté)', [deja.presence().stopId, deja.presence().arrivee, deja.memoire.has('lp_presence:u-luc'), deja.gestes().length], ['A', T0 - 80000, true, 0]);
  deja.fin();
  // La limite : à 44 s la visite continue, à 45 s elle est finie
  const base = { stopId: 'A', passeId: 'p-luc', arrivee: T0 - 100000, derniereLecture: T0 - 45000, dedansMs: 55000, autoTente: false };
  const m45 = await monde({ memo: { 'lp_presence:u-luc': JSON.stringify({ ...base, derniereVue: T0 - 45000 }) } });
  await pause();
  eq('rouvrir EXACTEMENT 45 s après la dernière lecture : la visite est finie (notée), pas rouverte', [m45.presence(), notees(m45).length], [null, 1]);
  m45.fin();
  const m44 = await monde({ memo: { 'lp_presence:u-luc': JSON.stringify({ ...base, derniereVue: T0 - 44000 }) } });
  eq('… 44 s : la visite continue', [m44.presence() !== null, notees(m44).length], [true, 0]);
  m44.fin();
}
{
  // Rouverture trop tard (plus de 45 s) : la visite est notée telle qu'on la savait, puis oubliée
  const memo = { stopId: 'A', passeId: 'p-luc', arrivee: T0 - 180000, derniereVue: T0 - 46000, derniereLecture: T0 - 46000, dedansMs: 134000, autoTente: false };
  const m = await monde({ memo: { 'lp_presence:u-luc': JSON.stringify(memo) } });
  await pause();
  eq('rouvrir 46 s après la dernière lecture : PAS de visite en cours ; le temps passé est noté (arrivée, départ = la dernière lecture vue) ; la mémoire est vidée', [m.presence(), notees(m).map((g) => [g.arrivee, g.depart]), m.memoire.has('lp_presence:u-luc')], [null, [[m.iso(T0 - 180000), m.iso(T0 - 46000)]], false]);
  m.fin();
  const court = await monde({ memo: { 'lp_presence:u-luc': JSON.stringify({ ...memo, arrivee: T0 - 60000 }) } });
  await pause();
  eq('une visite de moins de 20 s (arrivée 60 s avant, dernière lecture 46 s avant : 14 s) : oubliée, pas notée', [court.presence(), notees(court).length], [null, 0]);
  court.fin();
  const courtAuto = await monde({ memo: { 'lp_presence:u-luc': JSON.stringify({ ...memo, arrivee: T0 - 60000, autoTente: true }) } });
  await pause();
  eq('… sauf si elle avait complété l\'arrêt tout seul : notée', notees(courtAuto).length, 1);
  courtAuto.fin();
  const autrePasse = await monde({ memo: { 'lp_presence:u-luc': JSON.stringify({ ...memo, derniereVue: T0 - 5000, passeId: 'p-ancienne' }) } });
  await pause();
  eq('la passe d\'avant n\'est plus la mienne (même vue il y a 5 s) : pas de visite, notée avec son ancienne passe', [autrePasse.presence(), notees(autrePasse).map((g) => g.passe)], [null, ['p-ancienne']]);
  autrePasse.fin();
  const fini = await monde({ tours: TOUR_TERMINE(), memo: { 'lp_presence:u-luc': JSON.stringify({ ...memo, derniereVue: T0 - 5000 }) } });
  await pause();
  eq('ma passe est terminée : notée, pas rouverte', [fini.presence(), notees(fini).length], [null, 1]);
  fini.fin();
}
{
  // Les mémoires illisibles ou d'un autre employé
  const illisible = await monde({ memo: { 'lp_presence:u-luc': '{oups' } });
  eq('une mémoire illisible : ignorée et effacée, aucune erreur', [illisible.presence(), notees(illisible).length, illisible.memoire.has('lp_presence:u-luc')], [null, 0, false]);
  illisible.fin();
  const faux = (o) => JSON.stringify({ stopId: 'A', passeId: 'p-luc', arrivee: T0 - 100000, derniereVue: T0 - 5000, derniereLecture: T0 - 5000, dedansMs: 95000, autoTente: false, ...o });
  for (const [nom, o] of [['sans client', { stopId: null }], ['sans passe', { passeId: null }], ['une arrivée illisible', { arrivee: 'hier' }], ['une dernière lecture illisible', { derniereVue: 'x' }], ['une dernière lecture AVANT l\'arrivée', { arrivee: T0 - 10000, derniereVue: T0 - 20000 }]]) {
    const m = await monde({ memo: { 'lp_presence:u-luc': faux(o) } });
    await pause();
    eq('une mémoire incohérente (' + nom + ') : ignorée, rien n\'est noté ni rouvert', [m.presence(), notees(m).length, m.memoire.has('lp_presence:u-luc')], [null, 0, false]);
    m.fin();
  }
  const lectureSeule = await monde({ memo: { 'lp_presence:u-luc': faux({ derniereLecture: undefined, dedansMs: undefined }) } });
  eq('sans « dernière lecture » ni « temps dedans » (mémoire ancienne) : la visite continue avec des valeurs sûres', [lectureSeule.presence().derniereLecture, lectureSeule.presence().dedansMs], [T0 - 5000, 0]);
  lectureSeule.fin();
  const autre = await monde({ memo: { 'lp_presence:u-marc': faux({}) } });
  await pause();
  eq('la mémoire d\'un AUTRE employé (Marc) n\'est ni lue ni effacée', [autre.presence(), notees(autre).length, autre.memoire.has('lp_presence:u-marc')], [null, 0, true]);
  autre.fin();
}
{
  // Le démarrage SANS signal : la visite est aussi reprise
  const o = { lectureLance: [] };
  const m = await monde(o);
  await m.run('attendreEcritures()');
  m.memoire.set('lp_presence:u-luc', JSON.stringify({ stopId: 'A', passeId: 'p-luc', arrivee: T0 - 30000, derniereVue: T0 - 5000, derniereLecture: T0 - 5000, dedansMs: 25000, autoTente: false }));
  o.lectureLance.push('stops');
  await m.run('loadStops()');
  eq('ouvrir l\'application sans signal (copies du téléphone) : la visite en cours est reprise aussi', [m.run('reseau.enLigne'), m.presence() && m.presence().stopId], [false, 'A']);
  m.fin();
}

log('\n=== LA DÉCONNEXION ET LES RÉGLAGES DE FIN : TOUT EST NOTÉ PUIS REMIS À ZÉRO ===');
{
  const m = await monde();
  m.hors();
  const t0 = m.t();
  gps(m, 0, 0); rester(m, 0, 0, 30);
  m.run(`presenceExclure('B')`);
  await m.run('arreterTracking()');
  await pause();
  eq('la déconnexion (arreterTracking) : la visite est notée, la minuterie arrêtée, la mémoire vidée', [m.presence(), m.run('_presenceMinuterie'), m.memoire.has('lp_presence:u-luc'), m.gestes('arret_presence').map((g) => [g.args.arrivee, g.args.depart])], [null, null, false, [[m.iso(t0), m.iso(t0 + 30000)]]]);
  eq('… et les exclusions sont remises à zéro', [m.run('_presenceExclus.size'), m.run('_presencePasseId')], [0, null]);
  m.fin();
}

log('\n=== LE BRANCHEMENT : CHAQUE LECTURE DU GPS PASSE PAR noterPosition ; UNE PANNE ICI NE GÊNE JAMAIS LE GPS ===');
{
  const m = await monde({ charger: false });
  m.run('presenceLecture = (...a) => { __notes.push(a); };');
  const [la, lo] = pt(3, 4);
  m.run(`noterPosition(${la}, ${lo}, 7, __t)`);
  eq('noterPosition transmet la latitude, la longitude, la précision et l\'HEURE de la lecture', m.run('JSON.stringify(__notes)'), JSON.stringify([[la, lo, 7, T0]]));
  m.run(`noterPosition(${la}, ${lo}, null, __t + 1000)`);
  eq('… une précision inconnue : « null »', m.run('__notes[1][2]'), null);
  m.run(`noterPosition('x', ${lo}, 7, __t)`);
  eq('une lecture invalide (pas un nombre) n\'est pas transmise', m.run('__notes.length'), 2);
  m.run(`noterPosition(${la}, ${lo}, -1, __t)`);
  eq('… une précision négative (invalide) : « null » aussi', m.run('__notes[2][2]'), null);
  m.run(`noterPosition(${la}, ${lo}, 5, __t - 5000)`);
  eq('… l’heure d’une lecture vieille de 5 secondes est gardée telle quelle', m.run('__notes[3][3]'), T0 - 5000);
  m.run(`noterPosition(${la}, ${lo}, 5, __t - 3600000)`);
  eq('… l’heure d’une lecture absurde (il y a une heure) est remplacée par maintenant', m.run('__notes[4][3]'), T0);
  m.fin();
}
{
  const m = await monde();
  m.run('maPasse = () => { throw new Error("boum"); };');
  const [la, lo] = pt(0, 0);
  let leve = null;
  try { m.run(`noterPosition(${la}, ${lo}, 5, __t)`); } catch (e) { leve = e.message; }
  eq('une erreur dans le repérage des zones ne remonte JAMAIS au GPS : la position est quand même gardée', [leve, m.run('lastPos[0]') === la], [null, true]);
  m.fin();
  const s = await monde({ sansPresence: true });
  const [la2, lo2] = pt(0, 0);
  let l2 = null;
  try { s.run(`noterPosition(${la2}, ${lo2}, 5, __t)`); s.run('arreterTracking()'); } catch (e) { l2 = e.message; }
  eq('sans presence.js chargé (rien à repérer) : le GPS et la déconnexion marchent comme avant', [l2, s.run('lastPos[0]') === la2], [null, true]);
  s.fin();
}
{
  // Sans presence.js : la zone bleue reste la règle d'avant (le cercle de 20 m autour du point), le chrono n'existe pas
  const m = await monde({ sansPresence: true });
  const maj = m.iso(m.t());
  const pos = (x, y) => m.run(`positionsVehicules = [{passe_id:'p-marc', lat:${pt(x, y)[0]}, lon:${pt(x, y)[1]}, precision_m:5, maj_le:'${maj}'}];`);
  pos(19, 0);
  eq('sans presence.js : un camion à 19 m du point de A est « en cours » (le cercle de 20 m, même si A a une zone)', m.enCours('A'), true);
  pos(21, 0);
  eq('… à 21 m : non', m.enCours('A'), false);
  m.run(`openCard(${m.idx('A')})`);
  eq('… la fiche marche sans le chrono', m.fiche().includes('⏱'), false);
  m.fin();
}

log('\n=== LES CAMIONS DES AUTRES (positions lues du serveur) : LA MÊME RÈGLE DE ZONE ===');
{
  const m = await monde();
  const maj = m.iso(m.t());
  const pos = (id, x, y, prec, quand = maj) => m.run(`positionsVehicules = [{passe_id:'${id}', lat:${pt(x, y)[0]}, lon:${pt(x, y)[1]}, precision_m:${prec}, maj_le:'${quand}'}];`);
  pos('p-marc', 13.5, 0, 8);
  eq('à 6 m du bord de la zone de A avec un GPS à 8 m (marge 8) : A est bleue', m.enCours('A'), true);
  pos('p-marc', 13.5, 0, 3);
  eq('… avec un GPS à 3 m (marge 4) : non', m.enCours('A'), false);
  pos('p-marc', 13.5, 0, null);
  eq('… précision inconnue (marge 10) : oui', m.enCours('A'), true);
  pos('p-marc', 0, 0, 31);
  eq('une position à 31 m d\'erreur ne compte pas (même au centre)', m.enCours('A'), false);
  pos('p-marc', 0, 0, 5, m.iso(m.t() - 4 * 60000));
  eq('une position de plus de 3 minutes ne compte plus', m.enCours('A'), false);
  pos('p-gaby', 0, 0, 5);
  eq('le camion d\'un AUTRE tour (Saint-Étienne) ne rend pas A bleue', m.enCours('A'), false);
  pos('p-marc', 0, 100 + 19, 12);
  eq('le client D (sans zone) : à 19 m du point, bleu ; à 21 m avec un GPS à 12 m, pas bleu (le cercle n\'a pas de marge)', [m.enCours('D'), (pos('p-marc', 0, 121, 12), m.enCours('D'))], [true, false]);
  pos('p-marc', 0, 0, 5);
  eq('un client déjà fait n\'est jamais « en cours »', [m.enCours('A'), (m.run(`installerTours(${JSON.stringify(TOURS({ faits: ['A'] }))}, Date.now())`), m.enCours('A'))], [true, false]);
  m.fin();
}

log('\n=== L\'ÉCRAN DES RÉGLAGES : LE DÉLAI EST EN SECONDES ET PERMET 0 ===');
{
  const REGL = [{ cle: 'duree_max_quart_heures', valeur: 16, description: 'Un quart… heures' }, { cle: 'presence_complete_auto_s', valeur: 60, description: 'Complété automatique… SECONDES' }, { cle: 'rappel_en_service_heures', valeur: 12, description: 'Rappel… heures' }];
  const ouvrir = async (extra = {}) => { const m = await monde({ utilisateur: { id: 'u-joe', nom: 'Joé', role: 'admin' }, reglages: REGL.map((r) => ({ ...r })), ...extra }); await m.run('chargerReglagesAdmin()'); await attendre(20); return m; };
  const ligne = (m, i) => m.el('admin-body').children[i];
  const champ = (l) => l.children[1].children[0], unite = (l) => l.children[1].children[1], bouton = (l) => l.children[1].children[2];
  const m = await ouvrir();
  eq('la durée en heures dit « heures », le délai du complété automatique dit « secondes » (seule une clé qui FINIT par « _s » compte : « rappel_en_service_heures » reste en heures)', [unite(ligne(m, 0)).textContent, unite(ligne(m, 1)).textContent, unite(ligne(m, 2)).textContent], ['heures', 'secondes', 'heures']);
  m.fin();
  const essai = async (i, texte) => {
    const w = await ouvrir();
    champ(ligne(w, i)).value = texte; bouton(ligne(w, i)).onclick(); await attendre(20);
    const r = { toast: w.appels.toasts[w.appels.toasts.length - 1], ecritures: w.appels.ecritures.map((e) => e.valeur) };
    w.fin();
    return r;
  };
  const MSG_S = '⚠ Entre un nombre de secondes valide (0 = jamais, 3600 au plus)', MSG_H = '⚠ Entre un nombre d’heures valide (plus grand que 0)';
  eq('secondes : 0 est permis (« jamais »)', await essai(1, '0'), { toast: '✔ Réglage enregistré', ecritures: [{ valeur: 0 }] });
  eq('secondes : 45 et 3600 sont permis', [await essai(1, '45'), await essai(1, '3600')].map((r) => r.ecritures), [[{ valeur: 45 }], [{ valeur: 3600 }]]);
  eq('secondes : 3601 est refusé avant d\'écrire', await essai(1, '3601'), { toast: MSG_S, ecritures: [] });
  eq('secondes : négatif refusé', await essai(1, '-1'), { toast: MSG_S, ecritures: [] });
  eq('secondes : un champ VIDE n\'est jamais « 0 » (jamais) : refusé', [await essai(1, ''), await essai(1, '   ')], [{ toast: MSG_S, ecritures: [] }, { toast: MSG_S, ecritures: [] }]);
  eq('secondes : du texte refusé', await essai(1, 'abc'), { toast: MSG_S, ecritures: [] });
  eq('heures : 0 reste refusé (la règle d\'avant, son message n\'a pas changé)', await essai(0, '0'), { toast: MSG_H, ecritures: [] });
  eq('heures : « Infinity » refusé (un nombre fini seulement)', await essai(0, 'Infinity'), { toast: MSG_H, ecritures: [] });
  eq('heures : négatif et vide refusés ; 18 permis', [await essai(0, '-2'), await essai(0, ''), (await essai(0, '18')).ecritures], [{ toast: MSG_H, ecritures: [] }, { toast: MSG_H, ecritures: [] }, [{ valeur: 18 }]]);
}

log('\n=== LE CODE : LES BRANCHEMENTS ===');
{
  const page = lire('index.html');
  vrai('la page charge presence.js une seule fois, après tracking.js et avant placement.js', (page.match(/js\/presence\.js/g) || []).length === 1 && page.indexOf('js/tracking.js') < page.indexOf('js/presence.js') && page.indexOf('js/presence.js') < page.indexOf('js/placement.js'));
  vrai('presence.js ne garde AUCUNE trace GPS : aucun appel réseau, aucun stockage de positions (seulement UNE visite : la mémoire « lp_presence: »)', !/db\.(from|rpc)\(/.test(lire('js/presence.js').replace(/db\.from\('reglages'\)/, '')) && !/localStorage\.setItem\([^)]*positions/i.test(lire('js/presence.js')));
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
