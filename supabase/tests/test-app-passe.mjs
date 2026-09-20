// Étape 14a — « Débuter la passe » (www/js/passe.js), testé avec les VRAIS fichiers de l'application chargés dans un faux
// navigateur (faux document, fausse carte Leaflet) et un FAUX Supabase qui imite le serveur (debuter_passe, tours_en_cours).
// Ce que ces tests ne peuvent pas vérifier : le vrai Supabase (fait par reel-etape-14.mjs) et l'affichage réel (essai dans le navigateur).
import vm from 'vm';
import fs from 'fs';
import { fileURLToPath } from 'url';
const WWW = fileURLToPath(new URL('../../www/', import.meta.url));

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
const lire = (f) => fs.readFileSync(WWW + f, 'utf8');

const MEC = 'Déneigement mécanique', SEL = 'Épandage de sel';
const CH = 'route-charette', SE = 'route-saint-etienne', RV = 'route-vide', RA = 'route-ancienne';
const LUC = { id: 'u-luc', nom: 'Luc', role: 'employe' }, MARC = { id: 'u-marc', nom: 'Marc', role: 'employe' }, JOE = { id: 'u-joe', nom: 'Joé', role: 'admin' };

// ---------------------------------------------------------------------
// Un « monde » : faux navigateur + fausse carte + faux serveur, avec les vrais fichiers de l'application dedans
// ---------------------------------------------------------------------
function monde(o = {}) {
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
  const user = o.utilisateur ?? LUC;
  const memo = { ...(o.memo ?? {}) };

  const donnees = {
    stops: o.stops ?? STOPS.map((s) => ({ ...s })),
    routes: o.routes ?? ROUTES.map((r) => ({ ...r })),
    problemes: [],
    tours: o.tours ?? [],
    positions: [],
    equipes: o.equipes ?? EQUIPES.map((e) => ({ ...e })),
    equipage_periodes: o.equipages ?? [],
  };
  const appels = { rpc: [], eq: [], ecritures: [], toasts: [], confirmations: [], lectures: [], selects: [] };
  const vuPar = () => (o.utilisateur ?? LUC);

  // Le serveur imité : ce que voit CETTE personne (« je suis chauffeur », « je suis à bord ») dépend de qui est connecté
  const toursVus = () => donnees.tours.map((t) => ({ ...t, passes: t.passes.map((p) => ({ passe_id: p.passe_id, equipe_id: p.equipe_id, chauffeur_id: p.chauffeur_id,
    je_suis_chauffeur: p.chauffeur_id === vuPar().id, je_suis_a_bord: p.chauffeur_id === vuPar().id || (p.abord ?? []).includes(vuPar().id) })) }));
  const debuterServeur = (args) => {
    donnees.tours.forEach((t) => { t.passes = t.passes.filter((p) => p.chauffeur_id !== vuPar().id && p.equipe_id !== args.p_equipe_id); });   // « débuter » archive la passe du chauffeur et celle du véhicule
    donnees.tours = donnees.tours.filter((t) => t.passes.length);
    let t = donnees.tours.find((x) => x.route_id === args.p_route_id && x.tache === args.p_tache);
    const rejoint = !!t;
    if (!t) {
      const total = donnees.stops.filter((s) => s.route_id === args.p_route_id && s.service === args.p_tache && s.actif).length;
      t = { route_id: args.p_route_id, tache: args.p_tache, numero: Math.max(0, ...donnees.tours.filter((x) => x.route_id === args.p_route_id).map((x) => x.numero)) + 1, total, faits: 0, pourcentage: 0, arrets_faits: [], passes: [] };
      donnees.tours.push(t);
    }
    t.passes.push({ passe_id: args.p_id, equipe_id: args.p_equipe_id, chauffeur_id: vuPar().id, abord: [] });
    donnees.equipage_periodes.push({ passe_id: args.p_id, role: 'chauffeur', utilisateur_id: vuPar().id, utilisateurs: { nom: vuPar().nom } });
    return { data: { statut: 'debutee', passe_id: args.p_id, numero: t.numero, tache: args.p_tache, tour_rejoint: rejoint }, error: null };
  };
  // « Terminer » ne ferme que la passe de CE camion ; le tour continue pour les autres. Une passe qui n'est plus en cours : « deja_terminee ».
  const terminerServeur = (args) => {
    const t = donnees.tours.find((x) => x.passes.some((p) => p.passe_id === args.p_passe_id));
    if (!t) return { data: { statut: 'deja_terminee', fin_type: 'manuelle' }, error: null };
    t.passes = t.passes.filter((p) => p.passe_id !== args.p_passe_id);
    const res = { statut: 'terminee', pourcentage: t.pourcentage, faits: t.faits, total: t.total };
    if (!t.passes.length) donnees.tours = donnees.tours.filter((x) => x !== t);
    return { data: res, error: null };
  };
  let nbDebuter = 0, nbTerminer = 0;
  const fauxDb = {
    rpc: async (nom, args) => {
      appels.rpc.push({ nom, args });
      if (o.toursCoupes && nom === 'tours_en_cours') throw new Error('Failed to fetch');
      if (nom === 'tours_en_cours') return { data: toursVus(), error: null };
      if (nom === 'terminer_passe') {
        nbTerminer++;
        const scenario = o.terminer?.[nbTerminer - 1] ?? o.terminer?.defaut;
        if (scenario === 'reseau') throw new Error('Failed to fetch');
        if (scenario === 'reponse-perdue') { terminerServeur(args); throw new Error('Failed to fetch'); }   // le serveur a terminé la passe, mais la réponse ne revient pas
        if (scenario?.erreur) return { data: null, error: { message: scenario.erreur } };
        return terminerServeur(args);
      }
      if (nom === 'debuter_passe') {
        nbDebuter++;
        const scenario = o.debuter?.[nbDebuter - 1] ?? o.debuter?.defaut;
        if (scenario === 'reseau') throw new Error('Failed to fetch');
        if (scenario === 'reponse-perdue') { debuterServeur(args); throw new Error('Failed to fetch'); }   // le serveur a créé la passe, mais la réponse ne revient pas
        if (scenario?.erreur) return { data: null, error: { message: scenario.erreur } };
        return debuterServeur(args);
      }
      return { data: null, error: { message: 'inconnu' } };
    },
    from: (table) => {
      const q = { op: 'select' };
      q.select = (c) => { appels.selects.push([table, c]); return q; };
      q.eq = (c, v) => { appels.eq.push([table, c, v]); return q; };
      q.order = () => q;
      q.is = () => q;
      q.insert = () => { q.op = 'insert'; return q; };
      q.update = () => { q.op = 'update'; return q; };
      q.delete = () => { q.op = 'delete'; return q; };
      q.then = (ok_, ko_) => {
        if (q.op !== 'select') appels.ecritures.push({ table, op: q.op });
        appels.lectures.push(table);
        if (o.lectureLance?.includes(table)) throw new Error('Failed to fetch');
        return Promise.resolve({ data: donnees[table] ?? [], error: null }).then(ok_, ko_);
      };
      return q;
    },
  };

  const sandbox = {
    document: { getElementById: el, createElement: () => creer(null) },
    localStorage: { getItem: (k) => (k in memo ? memo[k] : null), setItem: (k, v) => { memo[k] = String(v); }, removeItem: (k) => { delete memo[k]; } },
    window: { open() {} },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    L: { divIcon: (opt) => opt, marker: () => { const m = { addTo() { return m; }, on() {}, setLatLng() { return m; }, setIcon() { return m; }, bindPopup() { return m; }, setPopupContent() { return m; } }; return m; }, polygon: () => ({ addTo() { return this; } }) },
    __map: { removeLayer() {}, flyTo() {} },
    __fauxDb: fauxDb,
    setStatus() {}, hideLoading() {}, showErr: (m) => appels.erreurs?.push(m),
    __confirmations: appels.confirmations, __toasts: appels.toasts,
    __reponses: o.confirme ?? [true],
    ...(o.sansCrypto ? {} : { crypto: { randomUUID: (() => { let n = 0; return () => 'uuid-' + (++n); })() } }),
  };
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/config.js', 'js/utilitaires.js', 'js/tours.js', 'js/vehicules.js', 'js/passe.js', 'js/resume-passe.js', 'js/arrets.js', 'js/routes.js', 'js/problemes.js'])
    vm.runInContext(lire(f), ctx, { filename: f });
  vm.runInContext('db = __fauxDb; map = __map; currentUser = ' + JSON.stringify(user) + ';', ctx);
  // Les messages sont notés ; la boîte de confirmation répond selon la liste « confirme » (une réponse par question, la dernière se répète)
  vm.runInContext('toast = (m) => { __toasts.push(m); }; confirmer = async (...a) => { __confirmations.push(a); return __reponses.length > 1 ? __reponses.shift() : __reponses[0]; };', ctx);

  // Tous les boutons de choix de l'écran (dans l'ordre), pour les « toucher »
  const boutons = () => { const r = []; const parcourir = (n) => { for (const c of n.children) { if (String(c.className).startsWith('debut-choix')) r.push(c); parcourir(c); } }; parcourir(el('debut-body')); return r; };
  const texteCorps = () => { const r = []; const parcourir = (n) => { for (const c of n.children) { r.push(c.textContent + c.innerHTML); parcourir(c); } }; parcourir(el('debut-body')); return r.join(' | '); };
  const w = {
    ctx, el, donnees, appels, memo, boutons, texteCorps,
    run: (code) => vm.runInContext(code, ctx),
    routeActive: (id) => vm.runInContext(`routeActive = ${JSON.stringify(id)};`, ctx),
    dernierToast: () => appels.toasts[appels.toasts.length - 1],
    ouvert: () => el('debut-overlay').classList.contains('open'),
    debuts: () => appels.rpc.filter((r) => r.nom === 'debuter_passe'),
    termines: () => appels.rpc.filter((r) => r.nom === 'terminer_passe'),
    // toucher le bouton dont le texte contient « texte »
    toucher: (texte) => { const b = boutons().find((x) => x.innerHTML.includes(texte)); if (!b) throw new Error('bouton introuvable : ' + texte); return b.onclick(); },
    charge: async () => { await w.run('loadStops()'); return w; },
    fin: () => vm.runInContext('clearInterval(_minuterieEnCours);_minuterieEnCours=null;', ctx),
  };
  tousLesMondes.push(w);
  return w;
}
const tousLesMondes = [];

const STOPS = [
  { id: 's1', adresse: '304 rue de l\'Église', client: 'TEST 1', route_id: CH, service: MEC, lat: 46.44, lon: -72.92, ordre: 0, actif: true },
  { id: 's2', adresse: '220 rue du Moulin', client: 'TEST 3', route_id: CH, service: MEC, lat: 46.443, lon: -72.922, ordre: 1, actif: true },
  { id: 's3', adresse: '215 rue Bellerive', client: 'TEST 4', route_id: CH, service: SEL, lat: 46.444, lon: -72.919, ordre: 2, actif: true },
  { id: 's4', adresse: '110 rue des Gouverneurs', client: 'TEST 7', route_id: SE, service: MEC, lat: 46.445, lon: -72.78, ordre: 3, actif: true },
  { id: 's5', adresse: '120 rue Jonette', client: 'TEST 9', route_id: SE, service: MEC, lat: 46.443, lon: -72.76, ordre: 4, actif: true },
];
const ROUTES = [{ id: CH, nom: 'Charette', couleur: '#c8e63c', actif: true }, { id: SE, nom: 'Saint-étienne-des-grès', couleur: '#60a5fa', actif: true },
  { id: RV, nom: 'Route vide', couleur: '#f87171', actif: true }, { id: RA, nom: 'Ancienne route', couleur: '#fb923c', actif: false }];
const EQUIPES = [{ id: 'e10', nom: 'Camion 10' }, { id: 'e2', nom: 'Camion 2' }, { id: 'e1', nom: 'Camion 1' }, { id: 'e3', nom: 'Camion 3' }];
// Marc conduit le Camion 2 sur le tour de déneigement de Charette (n° 1, 1 arrêt sur 2 fait)
const TOUR_MARC = () => ({ route_id: CH, tache: MEC, numero: 1, total: 2, faits: 1, pourcentage: 50, arrets_faits: ['s1'], passes: [{ passe_id: 'p-marc', equipe_id: 'e2', chauffeur_id: 'u-marc', abord: [] }] });
const EQUIPAGE_MARC = () => [{ passe_id: 'p-marc', role: 'chauffeur', utilisateur_id: 'u-marc', utilisateurs: { nom: 'Marc' } }];
const toursDeLuc = () => [{ route_id: CH, tache: MEC, numero: 1, total: 2, faits: 1, pourcentage: 50, arrets_faits: ['s1'], passes: [{ passe_id: 'p-luc', equipe_id: 'e1', chauffeur_id: 'u-luc', abord: [] }] }];

// =====================================================================
log('=== LE BANDEAU DU HAUT : qui voit quoi ===');
{
  let m = await monde().charge();
  const b = () => m.el('passe-bandeau');
  vrai('sans passe en cours : le gros bouton « ▶ Débuter la passe » est là, relié à ouvrirDebut()', b().innerHTML.includes('id="btn-debuter"') && b().innerHTML.includes('onclick="ouvrirDebut()"') && b().innerHTML.includes('▶ Débuter la passe'), b().innerHTML);
  vrai('… le bandeau est visible', b().classList.contains('show'));
  m.run('currentUser = null; majBandeauPasse()');
  eq('personne de connecté : le bandeau est vide et caché', [b().innerHTML, b().classList.contains('show')], ['', false]);

  m = await monde({ utilisateur: JOE }).charge();
  vrai('l\'administrateur (Joé conduit aussi) voit lui aussi « Débuter la passe »', m.el('passe-bandeau').innerHTML.includes('btn-debuter'));

  m = await monde({ tours: toursDeLuc(), equipages: [{ passe_id: 'p-luc', role: 'chauffeur', utilisateur_id: 'u-luc', utilisateurs: { nom: 'Luc' } }] }).charge();
  const h = m.el('passe-bandeau').innerHTML;
  vrai('chauffeur d\'une passe : le résumé de SA passe (50 %, camion, n° de passe, route, tâche, 1/2)', h.includes('50 %') && h.includes('Camion 1') && h.includes('Passe n° 1') && h.includes('Charette') && h.includes(MEC) && h.includes('1/2'), h);
  vrai('… et plus de bouton « Débuter » (une seule passe à la fois)', !h.includes('btn-debuter'), h);

  m = await monde({ tours: [{ ...TOUR_MARC(), passes: [{ passe_id: 'p-marc', equipe_id: 'e2', chauffeur_id: 'u-marc', abord: ['u-luc'] }] }], equipages: EQUIPAGE_MARC() }).charge();
  vrai('un passager (à bord du camion de Marc) voit « Débuter la passe » (le serveur le fait quitter ce camion, après confirmation)', m.el('passe-bandeau').innerHTML.includes('btn-debuter'));

  m = await monde({ tours: [{ ...toursDeLuc()[0], passes: [{ passe_id: 'p-luc', equipe_id: 'e1', chauffeur_id: 'u-luc', abord: [] }] }], equipages: [] }).charge();
  m.run(`nomsVehicules['e1'] = '<img src=x onerror=alert(1)>'; majBandeauPasse()`);
  vrai('un nom de véhicule piégé est affiché comme du TEXTE (aucun code exécuté)', m.el('passe-bandeau').innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;') && !m.el('passe-bandeau').innerHTML.includes('<img'), m.el('passe-bandeau').innerHTML);
}

log('\n=== OUVRIR L\'ÉCRAN : véhicules à jour, route et véhicule proposés ===');
{
  let m = await monde().charge();
  await m.run('ouvrirDebut()');
  vrai('l\'écran s\'ouvre', m.ouvert());
  vrai('seuls les véhicules ACTIFS sont demandés', m.appels.eq.some((e) => e[0] === 'equipes' && e[1] === 'actif' && e[2] === true), JSON.stringify(m.appels.eq));
  eq('les véhicules sont en ordre naturel (Camion 2 avant Camion 10)', m.run('_debut.equipes.map(x => x.nom)'), ['Camion 1', 'Camion 2', 'Camion 3', 'Camion 10']);
  eq('4 gros boutons de véhicule + 3 routes actives (l\'ancienne route inactive n\'est pas offerte)', m.boutons().length, 3 + 4);
  eq('rien n\'est choisi d\'avance quand rien n\'est mémorisé et que plusieurs routes existent', m.run('[_debut.routeId, _debut.tache, _debut.equipeId]'), [null, null, null]);
  eq('« Démarrer » est grisé', m.el('btn-demarrer').disabled, true);
  eq('l\'aide dit ce qui manque', m.texteCorps().includes('Choisis encore : route, véhicule.'), true);
  m.run('fermerDebut()');
  eq('« Annuler » ferme l\'écran et l\'oublie', [m.ouvert(), m.run('_debut')], [false, null]);

  m = await monde().charge(); m.routeActive(CH); await m.run('ouvrirDebut()');
  eq('la route affichée sur la carte est proposée', m.run('_debut.routeId'), CH);
  m = await monde({ memo: { lp_route_debut: SE } }).charge(); await m.run('ouvrirDebut()');
  eq('sinon la dernière route débutée (mémorisée sur le téléphone)', m.run('_debut.routeId'), SE);
  m = await monde({ memo: { lp_route_debut: 'route-disparue' } }).charge(); await m.run('ouvrirDebut()');
  eq('une route mémorisée qui n\'existe plus est ignorée', m.run('_debut.routeId'), null);
  m = await monde({ memo: { lp_route_debut: RA } }).charge(); await m.run('ouvrirDebut()');
  eq('une route mémorisée devenue inactive est ignorée aussi', m.run('_debut.routeId'), null);
  m = await monde({ routes: [ROUTES[0]] }).charge(); await m.run('ouvrirDebut()');
  eq('une seule route existe : elle est choisie d\'office', m.run('_debut.routeId'), CH);

  m = await monde({ memo: { lp_vehicule: 'e2' } }).charge(); await m.run('ouvrirDebut()');
  eq('le dernier véhicule utilisé est présélectionné (mémorisé pour la fois suivante)', [m.run('_debut.equipeId'), m.boutons().filter((b) => b.className.includes('choisi')).map((b) => b.innerHTML)], ['e2', ['Camion 2']]);
  m = await monde({ memo: { lp_vehicule: 'e-supprime' } }).charge(); await m.run('ouvrirDebut()');
  eq('un véhicule mémorisé qui n\'existe plus n\'est pas présélectionné', m.run('_debut.equipeId'), null);

  m = await monde().charge();
  await Promise.all([m.run('ouvrirDebut()'), m.run('ouvrirDebut()'), m.run('ouvrirDebut()')]);
  eq('trois touchers d\'un coup : UNE seule ouverture (les véhicules ne sont lus qu\'une fois)', m.appels.eq.filter((e) => e[0] === 'equipes').length, 1);

  m = await monde({ tours: toursDeLuc() }).charge(); await m.run('ouvrirDebut()');
  eq('quelqu\'un qui a déjà une passe en cours ne peut pas en ouvrir une autre : un message, aucun écran', [m.ouvert(), m.dernierToast()], [false, 'Tu as déjà une passe en cours : termine-la d’abord.']);

  m = await monde({ lectureLance: ['equipes'] }).charge(); m.run('__lance = 1');
  await m.run('ouvrirDebut()');
  eq('pas de réseau à l\'ouverture : un message clair, aucun écran à moitié vide', [m.ouvert(), m.run('_debut'), m.dernierToast()], [false, null, '❌ Pas de réseau. Réessaie.']);
  m.run('currentUser = null');
  await m.run('ouvrirDebut()');
  eq('personne de connecté : rien ne s\'ouvre', m.ouvert(), false);
}

log('\n=== LES CHOIX : route, tâche, véhicule ===');
{
  let m = await monde().charge(); m.routeActive(CH); await m.run('ouvrirDebut()');
  eq('route Charette : deux tâches possibles (déneigement, sel) → la personne choisit, rien d\'office', [m.run('tachesDe(_debut.routeId)'), m.run('_debut.tache')], [[MEC, SEL], null]);
  eq('ce qui manque : tâche et véhicule', m.run('etatDebut().manque'), ['tâche', 'véhicule']);
  m.toucher('Épandage de sel');
  eq('toucher « Épandage de sel » : la tâche est choisie, le bouton est en surbrillance', [m.run('_debut.tache'), m.boutons().filter((b) => b.className.includes('choisi')).map((b) => b.innerHTML.split('<')[0])], [SEL, ['Charette', SEL]]);
  eq('… il ne manque plus que le véhicule ; « Démarrer » reste grisé', [m.run('etatDebut().manque'), m.el('btn-demarrer').disabled], [['véhicule'], true]);
  m.toucher('Camion 3');
  eq('toucher un véhicule : tout est choisi, « Démarrer » devient actif', [m.run('etatDebut().pret'), m.el('btn-demarrer').disabled], [true, false]);
  m.toucher('Saint-étienne');
  eq('changer de route : la tâche est refaite (Saint-étienne n\'a qu\'un service → choisi d\'office)', m.run('[_debut.routeId, _debut.tache]'), [SE, MEC]);
  vrai('… l\'écran le dit (« la seule de cette route ») et ne demande rien', m.texteCorps().includes('la seule de cette route'), m.texteCorps());
  eq('… le véhicule déjà choisi reste choisi', m.run('_debut.equipeId'), 'e3');
  m.toucher('Charette');
  eq('retour sur Charette : deux tâches, il faut de nouveau choisir', m.run('[_debut.tache, etatDebut().pret]'), [null, false]);

  m = await monde().charge(); m.routeActive(RV); await m.run('ouvrirDebut()'); m.toucher('Camion 1');
  eq('une route SANS arrêt actif ne peut pas être débutée (une passe sans arrêt ne se terminerait jamais)', m.run('[etatDebut().pret, etatDebut().sansArret]'), [false, true]);
  vrai('… l\'écran l\'explique', m.texteCorps().includes('aucun arrêt actif'), m.texteCorps());
  m.donnees.stops = STOPS.map((s) => ({ ...s, actif: s.route_id === CH ? false : true })); await m.run('loadStops()'); m.routeActive(CH);
  eq('les arrêts archivés (inactifs) ne comptent pas comme des tâches', m.run('tachesDe(routeActive)'), []);

  m = await monde({ equipes: [] }).charge(); m.routeActive(SE); await m.run('ouvrirDebut()');
  vrai('aucun véhicule actif : l\'écran renvoie à Joé, « Démarrer » reste grisé', m.texteCorps().includes('Aucun véhicule actif. Communique avec Joé.') && m.el('btn-demarrer').disabled, m.texteCorps());
  m = await monde({ routes: [] }).charge(); await m.run('ouvrirDebut()');
  vrai('aucune route active : le dit', m.texteCorps().includes('Aucune route active.'), m.texteCorps());

  // Véhicule déjà pris, tour à rejoindre
  m = await monde({ tours: [TOUR_MARC()], equipages: EQUIPAGE_MARC() }).charge(); m.routeActive(CH); await m.run('ouvrirDebut()');
  const cam2 = m.boutons().find((b) => b.innerHTML.startsWith('Camion 2'));
  vrai('un véhicule déjà en passe est marqué (trait pointillé) et nomme son chauffeur', cam2.className.includes('pris') && cam2.innerHTML.includes('Marc') && cam2.innerHTML.includes('en passe'), cam2.className + cam2.innerHTML);
  vrai('un véhicule libre n\'a aucune marque', !m.boutons().find((b) => b.innerHTML.startsWith('Camion 1')).className.includes('pris'));
  vrai('tant que la tâche n\'est pas choisie, aucun tour n\'est annoncé', !m.texteCorps().includes('Tu la rejoins'));
  m.toucher(MEC);
  vrai('déneigement de Charette : l\'écran annonce AVANT de démarrer qu\'on rejoint la passe n° 1 (1/2, 50 %) du Camion 2 (Marc)', m.texteCorps().includes('Cette passe est déjà commencée : n° 1, 1/2 (50 %) — Camion 2 (Marc).') && m.texteCorps().includes('Tu la rejoins'), m.texteCorps());
  m.toucher(SEL);
  vrai('la tâche « sel » n\'a pas de tour en cours : rien à rejoindre', !m.texteCorps().includes('Tu la rejoins'), m.texteCorps());

  // Textes piégés
  m = await monde({ routes: [{ id: CH, nom: '<img src=x onerror=alert(1)>', actif: true }], stops: STOPS.map((s) => ({ ...s, service: s.service === MEC ? '<b>x</b>' : s.service })), equipes: [{ id: 'e1', nom: '<script>alert(2)</script>' }], tours: [], equipages: [] }).charge();
  await m.run('ouvrirDebut()');
  const tout = m.texteCorps();
  vrai('les noms de route, de tâche et de véhicule venant de la base sont affichés comme du TEXTE', !tout.includes('<img') && !tout.includes('<script>') && !/<b>x<\/b>/.test(tout) && tout.includes('&lt;img src=x onerror=alert(1)&gt;') && tout.includes('&lt;script&gt;'), tout);
}

log('\n=== DÉMARRER (appelle la fonction du serveur) ===');
{
  let m = await monde().charge(); m.routeActive(CH); m.run('lastPos = [46.44, -72.92]');
  await m.run('ouvrirDebut()'); m.toucher(MEC); m.toucher('Camion 1');
  const avant = m.appels.rpc.length;
  await m.run('demarrerPasse()');
  eq('UN seul appel debuter_passe : identifiant, route, véhicule, position du téléphone, tâche — et RIEN d\'autre (l\'équipage viendra à l\'étape 15)', m.debuts().map((r) => r.args), [{ p_id: 'uuid-1', p_route_id: CH, p_equipe_id: 'e1', p_lat: 46.44, p_lon: -72.92, p_tache: MEC }]);
  eq('les tours sont relus ensuite (pour montrer la passe)', m.appels.rpc.slice(avant).filter((r) => r.nom === 'tours_en_cours').length >= 1, true);
  eq('l\'écran se ferme', [m.ouvert(), m.run('_debut')], [false, null]);
  eq('message : « Passe n° 1 débutée »', m.dernierToast(), '▶ Passe n° 1 débutée');
  eq('le dernier véhicule et la dernière route sont mémorisés sur le téléphone', [m.memo.lp_vehicule, m.memo.lp_route_debut], ['e1', CH]);
  eq('la carte montre la route de la passe', [m.run('routeActive'), m.run('zone'), m.memo.lp_zone], [CH, 'Charette', 'Charette']);
  const h = m.el('passe-bandeau').innerHTML;
  vrai('le bandeau devient le résumé de MA passe (plus de bouton « Débuter »)', h.includes('Passe n° 1') && h.includes('Camion 1') && !h.includes('btn-debuter'), h);
  eq('aucune écriture directe dans passes / équipage (tout passe par la fonction du serveur)', m.appels.ecritures, []);

  // Sans position du téléphone
  m = await monde().charge(); m.routeActive(SE);
  await m.run('ouvrirDebut()'); m.toucher('Camion 2');
  await m.run('demarrerPasse()');
  eq('sans position GPS : les coordonnées sont « null » (la passe démarre quand même)', [m.debuts()[0].args.p_lat, m.debuts()[0].args.p_lon, m.debuts()[0].args.p_tache], [null, null, MEC]);

  // Rejoindre un tour
  m = await monde({ tours: [TOUR_MARC()], equipages: EQUIPAGE_MARC() }).charge(); m.routeActive(CH);
  await m.run('ouvrirDebut()'); m.toucher(MEC); m.toucher('Camion 1');
  await m.run('demarrerPasse()');
  eq('le 2e camion rejoint le tour en cours : message adapté, même numéro de passe, deux camions dans le tour', [m.dernierToast(), m.run('tours[0].numero'), m.run('tours[0].passes.length')], ['🤝 Tu as rejoint la passe n° 1', 1, 2]);
  eq('le camion de Marc n\'est pas touché (il reste chauffeur de sa passe)', m.donnees.tours[0].passes.some((p) => p.passe_id === 'p-marc' && p.chauffeur_id === 'u-marc'), true);

  // Pas prêt
  m = await monde().charge();
  await m.run('ouvrirDebut()'); await m.run('demarrerPasse()');
  eq('rien de choisi : aucun appel au serveur, un message qui dit quoi choisir', [m.debuts().length, m.dernierToast()], [0, '⚠ Choisis d’abord : route, véhicule']);
  m.toucher('Charette');
  await m.run('demarrerPasse()');
  eq('route choisie, tâche à choisir : le message le dit', [m.debuts().length, m.dernierToast()], [0, '⚠ Choisis d’abord : tâche, véhicule']);

  // Double toucher
  m = await monde().charge(); m.routeActive(SE);
  await m.run('ouvrirDebut()'); m.toucher('Camion 1');
  await Promise.all([m.run('demarrerPasse()'), m.run('demarrerPasse()'), m.run('demarrerPasse()')]);
  eq('trois touchers sur « Démarrer » : UNE seule passe créée', m.debuts().length, 1);

  // Sans « crypto » (vieux navigateur) : l'identifiant est quand même un vrai UUID
  m = await monde({ sansCrypto: true }).charge(); m.routeActive(SE);
  await m.run('ouvrirDebut()'); m.toucher('Camion 1'); await m.run('demarrerPasse()');
  vrai('l\'identifiant de la passe a la forme d\'un UUID version 4, même sans crypto.randomUUID', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(m.debuts()[0].args.p_id), m.debuts()[0].args.p_id);
}

log('\n=== AVERTISSEMENTS : quand démarrer touche quelqu\'un d\'autre ===');
{
  const pris = (confirme) => monde({ tours: [TOUR_MARC()], equipages: EQUIPAGE_MARC(), confirme });
  let m = await pris([false]).charge(); m.routeActive(SE);
  await m.run('ouvrirDebut()'); m.toucher('Camion 2');
  await m.run('demarrerPasse()');
  eq('véhicule déjà en passe : la boîte NOMME la personne, le véhicule, la route et l\'avancement', m.appels.confirmations, [['Remplacer la passe de Marc ?', '« Camion 2 » est déjà en passe (Charette, 50 %). Si tu continues, cette passe est terminée.', 'Oui, remplacer', 'Annuler']]);
  eq('réponse « Annuler » : rien n\'est envoyé, l\'écran reste ouvert avec les choix, « Démarrer » de nouveau actif', [m.debuts().length, m.ouvert(), m.run('_debut.equipeId'), m.el('btn-demarrer').disabled], [0, true, 'e2', false]);

  m = await pris([true]).charge(); m.routeActive(SE);
  await m.run('ouvrirDebut()'); m.toucher('Camion 2');
  await m.run('demarrerPasse()');
  eq('réponse « Oui, remplacer » : la passe démarre ; celle de Marc est archivée par le serveur', [m.debuts().length, m.donnees.tours.flatMap((t) => t.passes.map((p) => p.chauffeur_id))], [1, ['u-luc']]);

  m = await monde({ tours: [TOUR_MARC()], equipages: [], confirme: [true] }).charge(); m.routeActive(SE);
  await m.run('ouvrirDebut()'); m.toucher('Camion 2'); await m.run('demarrerPasse()');
  eq('chauffeur dont le nom n\'est pas lisible : « l\'autre chauffeur »', m.appels.confirmations[0][0], 'Remplacer la passe de l’autre chauffeur ?');

  m = await monde({ tours: [TOUR_MARC()], equipages: [] }).charge(); m.routeActive(SE);
  await m.run('ouvrirDebut()'); m.toucher('Camion 1'); await m.run('demarrerPasse()');
  eq('véhicule LIBRE : aucune question posée', [m.appels.confirmations.length, m.debuts().length], [0, 1]);

  // Passager d'un autre camion
  const passager = (confirme) => monde({ tours: [{ ...TOUR_MARC(), passes: [{ passe_id: 'p-marc', equipe_id: 'e2', chauffeur_id: 'u-marc', abord: ['u-luc'] }] }], equipages: EQUIPAGE_MARC(), confirme });
  m = await passager([false]).charge(); m.routeActive(SE);
  await m.run('ouvrirDebut()'); m.toucher('Camion 1'); await m.run('demarrerPasse()');
  eq('passager d\'un camion : la boîte dit qu\'il le quittera ; « Annuler » n\'envoie rien', [m.appels.confirmations, m.debuts().length], [[['Quitter « Camion 2 » ?', 'Tu es à bord de ce camion. Si tu débutes ta propre passe, tu le quittes.', 'Oui, débuter', 'Annuler']], 0]);
  m = await passager([true]).charge(); m.routeActive(SE);
  await m.run('ouvrirDebut()'); m.toucher('Camion 1'); await m.run('demarrerPasse()');
  eq('« Oui, débuter » : la passe démarre', m.debuts().length, 1);
  m = await passager([true, true]).charge(); m.routeActive(SE);
  await m.run('ouvrirDebut()'); m.toucher('Camion 2'); await m.run('demarrerPasse()');
  eq('passager qui veut en plus le véhicule d\'un autre : deux questions, dans cet ordre', m.appels.confirmations.map((c) => c[0]), ['Quitter « Camion 2 » ?', 'Remplacer la passe de Marc ?']);

  // Écran fermé pendant la question
  m = await pris([true]).charge(); m.routeActive(SE);
  await m.run('ouvrirDebut()'); m.toucher('Camion 2');
  const p = m.run('demarrerPasse()'); m.run('fermerDebut()'); await p;
  eq('l\'écran est fermé pendant la question : rien n\'est envoyé', m.debuts().length, 0);
}

log('\n=== ERREURS ET RENVOI : jamais deux passes, jamais de code technique à l\'écran ===');
{
  for (const [code, texte] of [['route_inactive', 'Cette route n’est plus active.'], ['equipe_inactive', 'Ce véhicule n’est plus actif.'], ['tache_requise', 'Choisis la tâche de la passe.'],
    ['tache_sans_arret', 'Cette route n’a aucun arrêt pour cette tâche.'], ['passe_deja_en_cours', 'Une passe est déjà commencée avec ce véhicule ou ce chauffeur. Réessaie.'],
    ['non_autorise', 'Cette passe appartient à un autre chauffeur.'], ['n\'importe quoi', 'Pas de réseau ou erreur. Réessaie.']]) {
    const m = await monde({ debuter: { defaut: { erreur: code } } }).charge(); m.routeActive(SE);
    await m.run('ouvrirDebut()'); m.toucher('Camion 1'); await m.run('demarrerPasse()');
    eq(`refus « ${code} » : message en français, l'écran reste ouvert avec les choix, on peut réessayer`, [m.dernierToast(), m.ouvert(), m.run('_debut.equipeId'), m.el('btn-demarrer').disabled, m.run('maPasse()')], ['❌ ' + texte, true, 'e1', false, null]);
  }

  // Réseau coupé : même identifiant au nouvel essai
  let m = await monde({ debuter: { 0: 'reseau' } }).charge(); m.routeActive(SE);
  await m.run('ouvrirDebut()'); m.toucher('Camion 1'); await m.run('demarrerPasse()');
  eq('réseau coupé : un message, l\'écran reste ouvert', [m.dernierToast(), m.ouvert()], ['❌ Pas de réseau ou erreur. Réessaie.', true]);
  await m.run('demarrerPasse()');
  eq('2e essai (réseau revenu) : LE MÊME identifiant (un renvoi ne peut pas créer une 2e passe), et ça marche', [m.debuts().map((r) => r.args.p_id), m.dernierToast()], [['uuid-1', 'uuid-1'], '▶ Passe n° 1 débutée']);
  await m.run('ouvrirDebut()');   // (déjà une passe : refusé)
  m.donnees.tours = []; await m.run('chargerTours()');
  await m.run('ouvrirDebut()'); m.toucher('Camion 1'); await m.run('demarrerPasse()');
  eq('une fois réussi, la passe SUIVANTE a un nouvel identifiant', m.debuts().map((r) => r.args.p_id), ['uuid-1', 'uuid-1', 'uuid-2']);

  // Un autre choix après un échec = une autre passe
  m = await monde({ debuter: { 0: 'reseau' } }).charge(); m.routeActive(SE);
  await m.run('ouvrirDebut()'); m.toucher('Camion 1'); await m.run('demarrerPasse()');
  m.toucher('Camion 3'); await m.run('demarrerPasse()');
  eq('après un échec, un AUTRE véhicule : nouvel identifiant', m.debuts().map((r) => r.args.p_id), ['uuid-1', 'uuid-2']);

  // Réponse perdue : le serveur a créé la passe
  m = await monde({ debuter: { 0: 'reponse-perdue' } }).charge(); m.routeActive(SE);
  await m.run('ouvrirDebut()'); m.toucher('Camion 1'); await m.run('demarrerPasse()');
  eq('la réponse se perd MAIS le serveur avait créé la passe : l\'application la retrouve et réussit (pas de faux échec, pas de 2e passe)', [m.debuts().length, m.dernierToast(), m.ouvert(), m.run('maPasse() !== null')], [1, '▶ Passe n° 1 débutée', false, true]);

  // Erreur de lecture des tours après le démarrage : la passe est quand même démarrée
  m = await monde().charge(); m.routeActive(SE);
  await m.run('ouvrirDebut()'); m.toucher('Camion 1');
  m.run('__lireTours = db.rpc; db = { rpc: async (n, a) => { if (n === "tours_en_cours") throw new Error("Failed to fetch"); return __fauxDb.rpc(n, a); }, from: __fauxDb.from };');
  await m.run('demarrerPasse()');
  eq('le démarrage réussit mais la relecture échoue (zone morte) : pas de plantage, l\'écran est fermé, la mémoire du téléphone est à jour', [m.ouvert(), m.memo.lp_vehicule], [false, 'e1']);
}

log('\n=== TEMPS RÉEL : le bandeau suit les tours ===');
{
  const m = await monde().charge();
  vrai('au début : « Débuter la passe »', m.el('passe-bandeau').innerHTML.includes('btn-debuter'));
  m.donnees.tours = toursDeLuc(); m.donnees.equipage_periodes = [];
  m.run('planifierRechargementTours()');
  await new Promise((r) => setTimeout(r, 450));
  vrai('ma passe démarre sur un autre appareil (même compte) : le bandeau devient le résumé, sans rien toucher', m.el('passe-bandeau').innerHTML.includes('50 %') && !m.el('passe-bandeau').innerHTML.includes('btn-debuter'), m.el('passe-bandeau').innerHTML);
  m.donnees.tours[0].faits = 2; m.donnees.tours[0].pourcentage = 100;
  m.run('planifierRechargementTours()'); await new Promise((r) => setTimeout(r, 450));
  vrai('le pourcentage suit', m.el('passe-bandeau').innerHTML.includes('100 %'), m.el('passe-bandeau').innerHTML);
  m.donnees.tours = []; m.run('planifierRechargementTours()'); await new Promise((r) => setTimeout(r, 450));
  vrai('la passe se ferme (100 %, fermeture automatique…) : « Débuter la passe » revient', m.el('passe-bandeau').innerHTML.includes('btn-debuter'), m.el('passe-bandeau').innerHTML);
}

log('\n=== 14b — LE POURCENTAGE EN GROS ET « TERMINER » ===');
{
  const luc = (o = {}) => monde({ tours: toursDeLuc(), equipages: [{ passe_id: 'p-luc', role: 'chauffeur', utilisateur_id: 'u-luc', utilisateurs: { nom: 'Luc' } }], ...o }).charge();
  const bandeau = (m) => m.el('passe-bandeau').innerHTML;
  const avecMarc = () => { const t = toursDeLuc(); t[0].passes.push({ passe_id: 'p-marc', equipe_id: 'e2', chauffeur_id: 'u-marc', abord: [] }); return t; };

  // — Ce que voit le chauffeur —
  let m = await luc();
  let h = bandeau(m);
  vrai('chauffeur : le pourcentage EN GROS (classe « passe-pct »), la barre à 50 %, le camion, la passe, la route, la tâche et 1/2', h.includes('<div class="passe-pct">50 %</div>') && h.includes('<i style="width:50%">') && h.includes('Camion 1') && h.includes('Passe n° 1 · Charette') && h.includes(MEC) && h.includes('1/2'), h);
  vrai('… et le bouton « ■ Terminer la passe », relié à terminerPasse()', h.includes('id="btn-terminer"') && h.includes('onclick="terminerPasse()"') && h.includes('■ Terminer la passe'), h);
  vrai('… pas de bouton « Débuter » pendant une passe', !h.includes('btn-debuter'), h);
  vrai('le pourcentage est vraiment GROS à l\'écran (60 px)', /\.passe-pct\{[^}]*font-size:60px/.test(lire('css/style.css')));
  m = await luc({ tours: [{ ...toursDeLuc()[0], faits: 0, pourcentage: 0 }] });
  vrai('0 % : « Terminer » existe encore (on peut renoncer à une passe qu\'on n\'a pas commencée)', bandeau(m).includes('0 %') && bandeau(m).includes('btn-terminer'), bandeau(m));
  m = await luc({ tours: [{ ...toursDeLuc()[0], faits: 2, pourcentage: 100 }] });
  vrai('100 % : « Terminer » DISPARAÎT (le serveur ferme la passe tout seul), le 100 % reste affiché', bandeau(m).includes('100 %') && !bandeau(m).includes('btn-terminer'), bandeau(m));
  m = await luc({ tours: [{ ...toursDeLuc()[0], pourcentage: 250 }] });
  vrai('un pourcentage absurde du serveur est ramené à 100 (jamais de barre qui déborde)', bandeau(m).includes('100 %') && bandeau(m).includes('width:100%') && !bandeau(m).includes('250'), bandeau(m));
  m = await luc({ tours: [{ ...toursDeLuc()[0], pourcentage: '<img src=x onerror=alert(1)>' }] });
  vrai('un pourcentage piégé devient 0 (rien n\'est exécuté)', !bandeau(m).includes('<img') && bandeau(m).includes('0 %'), bandeau(m));

  // — Ce que voit un passager —
  m = await monde({ tours: [{ ...TOUR_MARC(), passes: [{ passe_id: 'p-marc', equipe_id: 'e2', chauffeur_id: 'u-marc', abord: ['u-luc'] }] }], equipages: EQUIPAGE_MARC() }).charge();
  h = bandeau(m);
  vrai('passager : la même carte (50 %, « À bord · Camion 2 », passe n° 1) mais SANS bouton « Terminer »', h.includes('<div class="passe-pct">50 %</div>') && h.includes('👤 À bord · Camion 2') && h.includes('Passe n° 1') && !h.includes('btn-terminer'), h);
  vrai('… et un bouton « Débuter ma propre passe » plus discret', h.includes('btn-debuter') && h.includes('secondaire') && h.includes('Débuter ma propre passe'), h);
  m = await monde().charge();
  vrai('ni chauffeur ni passager : seulement « ▶ Débuter la passe », aucune carte', bandeau(m).includes('▶ Débuter la passe') && !bandeau(m).includes('passe-pct') && !bandeau(m).includes('btn-terminer'), bandeau(m));

  // — Terminer : la question —
  m = await luc({ confirme: [false] });
  await m.run('terminerPasse()');
  eq('la boîte de l\'application dit ce qui reste (1 arrêt ne sera pas fait) et propose « Continuer » par défaut', m.appels.confirmations, [['Terminer la passe ?', 'Passe n° 1 : 1/2 (50 %). 1 arrêt ne sera pas fait.', 'Oui, terminer', 'Continuer']]);
  eq('« Continuer » : rien n\'est envoyé, la passe continue, le bouton « Terminer » est de nouveau actif', [m.termines().length, m.run('maPasse() !== null'), bandeau(m).includes('btn-terminer') && !bandeau(m).includes('disabled')], [0, true, true]);
  m = await luc({ tours: [{ ...toursDeLuc()[0], total: 6, faits: 2, pourcentage: 33 }], confirme: [false] });
  await m.run('terminerPasse()');
  eq('plusieurs arrêts restants : « 4 arrêts ne seront pas faits »', m.appels.confirmations[0][1], 'Passe n° 1 : 2/6 (33 %). 4 arrêts ne seront pas faits.');
  m = await luc({ tours: avecMarc(), confirme: [false], equipages: EQUIPAGE_MARC() });
  await m.run('terminerPasse()');
  eq('un autre camion dans le même tour : la boîte dit que le tour continue pour lui', m.appels.confirmations[0][1], 'Passe n° 1 : 1/2 (50 %). 1 arrêt ne sera pas fait. Le tour continue pour Camion 2.');

  // — Terminer : le geste —
  m = await luc({ tours: avecMarc(), confirme: [true], equipages: EQUIPAGE_MARC() });
  m.run('lastPos = [46.44, -72.92]');
  await m.run('terminerPasse()');
  eq('« Oui, terminer » : UN appel terminer_passe avec la passe de SON camion, rien d\'autre', m.termines().map((r) => r.args), [{ p_passe_id: 'p-luc' }]);
  eq('message avec le résultat', m.dernierToast(), '■ Passe n° 1 terminée : 1/2 (50 %)');
  eq('SA passe est terminée : le bandeau redevient « Débuter la passe »', [m.run('maPasse()'), bandeau(m).includes('btn-debuter'), bandeau(m).includes('btn-terminer')], [null, true, false]);
  eq('le tour CONTINUE pour l\'autre camion (la passe de Marc n\'est pas touchée)', m.donnees.tours.map((t) => t.passes.map((p) => p.passe_id)), [['p-marc']]);
  eq('aucune écriture directe dans les tables', m.appels.ecritures, []);
  m = await luc({ confirme: [true] });
  await m.run('terminerPasse()');
  eq('tour sans autre camion : la passe se termine, plus aucun tour en cours', [m.donnees.tours.length, m.run('tours.length')], [0, 0]);

  // — Double toucher —
  m = await luc({ confirme: [true] });
  await Promise.all([m.run('terminerPasse()'), m.run('terminerPasse()'), m.run('terminerPasse()')]);
  eq('trois touchers sur « Terminer » : UNE seule question, UN seul appel', [m.appels.confirmations.length, m.termines().length], [1, 1]);
  m = await luc({ confirme: [true] });
  const enCours = m.run('terminerPasse()');
  vrai('pendant la question, le bouton « Terminer » est grisé', bandeau(m).includes('id="btn-terminer" type="button" class="passe-terminer" onclick="terminerPasse()" disabled'), bandeau(m));
  await enCours;

  // — Cas limites —
  m = await luc({ tours: [{ ...toursDeLuc()[0], faits: 2, pourcentage: 100 }], confirme: [true] });
  await m.run('terminerPasse()');
  eq('déjà à 100 % : aucune question, aucun appel, un message', [m.appels.confirmations.length, m.termines().length, m.dernierToast()], [0, 0, 'Cette passe est complétée à 100 %.']);
  m = await monde().charge();
  await m.run('terminerPasse()');
  eq('aucune passe : un message, aucun appel', [m.termines().length, m.dernierToast()], [0, 'Tu n’as pas de passe en cours.']);
  m = await luc({ confirme: [true] });
  m.donnees.tours = []; await m.run('chargerTours()');
  await m.run('terminerPasse()');
  eq('la passe s\'est fermée entre-temps (autre appareil, fermeture automatique) : « Terminer » n\'a plus rien à faire', [m.appels.confirmations.length, m.dernierToast()], [0, 'Tu n’as pas de passe en cours.']);
  m = await luc({ confirme: [true] });
  m.donnees.tours = [];   // le serveur a déjà fermé la passe (100 % par l'autre camion) mais l'application ne le sait pas encore
  await m.run('terminerPasse()');
  eq('le serveur répond « déjà terminée » : message adapté', m.dernierToast(), 'Cette passe était déjà terminée.');

  // — Erreurs et réseau —
  for (const [code, texte] of [['non_autorise', 'Seul le chauffeur de la passe peut la terminer.'], ['passe_introuvable', 'Cette passe n’existe plus.'], ['n\'importe quoi', 'Pas de réseau ou erreur. Réessaie.']]) {
    const e = await luc({ confirme: [true], terminer: { defaut: { erreur: code } } });
    await e.run('terminerPasse()');
    eq(`refus « ${code} » : message en français, la passe reste en cours, on peut réessayer`, [e.dernierToast(), e.run('maPasse() !== null'), bandeau(e).includes('btn-terminer') && !bandeau(e).includes('disabled')], ['❌ ' + texte, true, true]);
  }
  m = await luc({ confirme: [true], terminer: { 0: 'reseau' } });
  await m.run('terminerPasse()');
  eq('réseau coupé : un message, la passe reste en cours', [m.dernierToast(), m.run('maPasse() !== null')], ['❌ Pas de réseau ou erreur. Réessaie.', true]);
  await m.run('terminerPasse()');
  eq('2e essai (réseau revenu) : ça marche', [m.termines().length, m.dernierToast(), m.run('maPasse()')], [2, '■ Passe n° 1 terminée : 1/2 (50 %)', null]);
  m = await luc({ confirme: [true], terminer: { 0: 'reponse-perdue' } });
  await m.run('terminerPasse()');
  eq('la réponse se perd MAIS le serveur avait terminé la passe : l\'application le voit et réussit (pas de faux échec)', [m.termines().length, m.dernierToast(), m.run('maPasse()')], [1, '■ Passe n° 1 terminée : 1/2 (50 %)', null]);
}

log('\n=== LE CODE : la page, et aucune écriture directe ===');
{
  const html = lire('index.html'), js = lire('js/passe.js'), css = lire('css/style.css');
  const sansCommentaires = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const code = sansCommentaires(js);
  vrai('la page charge passe.js après vehicules.js et avant demarrage.js', html.indexOf('js/vehicules.js') < html.indexOf('js/passe.js') && html.indexOf('js/passe.js') < html.lastIndexOf('js/demarrage.js'));
  vrai('la page a le bandeau et l\'écran (route, tâche, véhicule)', ['id="passe-bandeau"', 'id="debut-overlay"', 'id="debut-body"', 'id="btn-demarrer"', 'onclick="demarrerPasse()"', 'onclick="fermerDebut()"', 'onclick="bgClickDebut(event)"'].every((x) => html.includes(x)));
  vrai('le bouton « Démarrer » est grisé dès le départ dans la page', /id="btn-demarrer"[^>]*disabled/.test(html));
  vrai('passe.js passe la tâche au serveur (p_tache) et utilise la fonction debuter_passe', /rpc\('debuter_passe'/.test(code) && /p_tache:/.test(code));
  vrai('aucune écriture directe dans passes / passe_arrets / equipage (uniquement la fonction du serveur)', !/from\(\s*['"](passes|passe_arrets|equipage_periodes|quarts|positions)['"]\s*\)\s*\.\s*(insert|update|delete|upsert)/.test(code));
  vrai('aucune fenêtre native confirm() (boîte de l\'application)', !/(^|[^\w.])confirm\s*\(/.test(code) && /await confirmer\(/.test(code));
  vrai('tout texte de la base passe par esc() avant innerHTML (les choix, le bandeau)', (code.match(/innerHTML\s*=/g) || []).length >= 4 && !/innerHTML\s*=\s*[^;]*\b(\.nom|\.tache|\.service)\b(?!\s*\))/.test(code.replace(/esc\([^)]*\)/g, '')), 'un innerHTML reçoit un nom sans esc()');
  vrai('les boutons de choix ont une taille de doigt (au moins 64 px de haut) et « Démarrer » 52 px', /\.debut-choix\{[^}]*min-height:64px/.test(css) && /#debut-footer \.lf-btn\{[^}]*min-height:52px/.test(css));
  vrai('le bandeau laisse la place aux boutons de la carte (à droite) et n\'attrape que ses propres touchers', /#passe-bandeau\{[^}]*right:68px[^}]*pointer-events:none/.test(css) && /\.passe-debuter\{[^}]*pointer-events:all/.test(css));
  vrai('le serveur reçoit bien un véhicule ET une route ET la tâche : aucun « fait » ni ancien vocabulaire', !/\.fait\b|\bfait\s*:/.test(code));
}

tousLesMondes.forEach((w) => w.fin());
console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
