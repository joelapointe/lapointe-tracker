// Étape 16a — DÉMARRER ET TRAVAILLER SANS RÉSEAU (www/js/hors-reseau.js + les lectures + auth.js), testé avec les VRAIS fichiers de l'application
// chargés dans un faux navigateur, un FAUX Supabase qui peut « perdre le signal » (en lançant une erreur, ou en répondant une erreur comme
// le fait supabase-js) et un faux stockage. Ce que ces tests ne peuvent pas vérifier : le vrai IndexedDB d'un téléphone (voir l'essai dans le navigateur).
import vm from 'vm';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
const WWW = fileURLToPath(new URL('../../www/', import.meta.url));

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
const lire = (f) => fs.readFileSync(WWW + f, 'utf8');
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
const heure = (i) => new Date(i).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });

const MEC = 'Déneigement mécanique', CH = 'route-charette';
const LUC = { id: 'u-luc', nom: 'Luc', role: 'employe' }, MARC = { id: 'u-marc', nom: 'Marc', role: 'employe' };
const NOMS = { 'u-luc': 'Luc', 'u-marc': 'Marc', 'u-eric': 'Eric' };
const NOMS_CACHES = ['stops', 'routes', 'tours', 'vehicules', 'problemes', 'employes', 'equipesActives', 'equipagePrecedent'];

// Un monde : faux navigateur + faux serveur (avec ou sans signal) + faux stockage du téléphone
function monde(o = {}) {
  const user = o.utilisateur ?? LUC;
  const els = {};
  const creer = (id) => {
    const classes = new Set();
    const e = { id, children: [], style: {}, textContent: '', _html: '', value: '', disabled: false, className: '', onclick: null, attrs: {},
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
      appendChild(c) { c.parent = this; this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; }, focus() {}, click() {},
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); },
      querySelector(sel) { return this.children.find((c) => '.' + c.className === sel) ?? null; } };
    Object.defineProperty(e, 'innerHTML', { get() { return this._html; }, set(v) { this._html = v; if (v === '') this.children = []; } });
    return e;
  };
  const el = (id) => (els[id] ??= creer(id));
  const etat = { enLigne: o.enLigne ?? true, mode: o.mode ?? 'lance' };   // mode : « lance » (exception) ou « erreur » (réponse d'erreur, comme supabase-js)
  const donnees = {
    stops: STOPS.map((s) => ({ ...s })), routes: [{ id: CH, nom: 'Charette', couleur: '#c8e63c', actif: true }], problemes: o.problemes ?? [{ id: 'pb1', stop_id: 's2', passe_id: null, utilisateur_id: 'u-marc', note: 'barrière fermée', cree_le: iso(5), utilisateurs: { nom: 'Marc' } }],
    positions: [], equipes: [{ id: 'e1', nom: 'Camion 1' }, { id: 'e2', nom: 'Camion 2' }],
    utilisateurs: Object.keys(NOMS).map((id) => ({ id, nom: NOMS[id], actif: true })),
    tours: o.tours ?? [{ route_id: CH, tache: MEC, numero: 1, en_cours: true, total: 2, faits: 1, pourcentage: 50, arrets_faits: ['s1'], faits_il_y_a: { s1: 60 }, mes_passes_annulables: [],
      passes: [{ passe_id: 'p-luc', equipe_id: 'e1', chauffeur_id: 'u-luc', je_suis_chauffeur: true, je_suis_a_bord: true }] }],
    equipage_periodes: [{ passe_id: 'p-luc', role: 'chauffeur', utilisateur_id: 'u-luc', utilisateurs: { nom: 'Luc' } }, { passe_id: 'p-luc', role: 'passager', utilisateur_id: 'u-eric', utilisateurs: { nom: 'Eric' } }],
  };
  const appels = { rpc: [], lectures: [], sondes: [], toasts: [], erreurs: [], confirmations: [] };
  const echoue = (nom) => !etat.enLigne || (o.echoueSeulement ?? []).includes(nom) || (o.echoueSeulement ?? []).includes('*');
  const echec = () => { if (etat.mode === 'lance') throw new Error('Failed to fetch'); return { data: null, error: { message: 'TypeError: Failed to fetch' } }; };
  const fauxDb = {
    rpc: async (nom, args) => {
      appels.rpc.push({ nom, args });
      if (echoue(nom)) return echec();
      if (nom === 'tours_en_cours') return { data: donnees.tours, error: null };
      if (nom === 'equipage_precedent') return { data: { passe_id: 'p-avant', fin: iso(200), membres: [{ utilisateur_id: 'u-eric', nom: 'Eric' }] }, error: null };
      if (o.rpc?.[nom]) return o.rpc[nom](args, donnees);
      return { data: null, error: { message: 'inconnu' } };
    },
    from: (table) => {
      if (appels.lectures.length > 1500) throw new Error('BOUCLE INFINIE détectée (plus de 1500 lectures)');   // disjoncteur : un défaut de boucle fait ÉCHOUER le test au lieu de le bloquer
      const q = { filtres: [] };
      q.select = () => q; q.order = () => q; q.is = () => q; q.limit = () => q; q.maybeSingle = () => q;
      q.eq = (c, v) => { q.filtres.push([c, v]); return q; };
      q.then = (ok_, ko_) => {
        appels.lectures.push(table);
        if (echoue(table)) { let r; try { r = echec(); } catch (e) { return Promise.reject(e).then(ok_, ko_); } return Promise.resolve(r).then(ok_, ko_); }
        if (o.refus?.includes(table)) return Promise.resolve({ data: null, error: { message: 'permission denied for table ' + table, code: '42501' } }).then(ok_, ko_);
        const rows = (donnees[table] ?? []).filter((r) => q.filtres.every(([c, v]) => !(c in r) || r[c] === v));
        return Promise.resolve({ data: rows, error: null }).then(ok_, ko_);
      };
      return q;
    },
    auth: { getSession: async () => ({ data: { session: o.session ?? null }, error: null }), signOut: async () => ({}), onAuthStateChange: () => ({}) },
  };
  // Un vrai « localStorage » (avec length et key), pour la connexion hors réseau
  const stockage = { ...(o.stockage ?? {}) };
  const localStorage = { getItem: (k) => (k in stockage ? stockage[k] : null), setItem: (k, v) => { stockage[k] = String(v); }, removeItem: (k) => { delete stockage[k]; }, key: (i) => Object.keys(stockage)[i] ?? null, get length() { return Object.keys(stockage).length; } };
  const sandbox = {
    document: { getElementById: el, createElement: () => creer(null) },
    localStorage, window: { open() {} }, setTimeout, clearTimeout, setInterval, clearInterval, console, AbortController,
    fetch: async (url, opts) => {
      appels.sondes.push(url);
      if (o.sondeSilencieuse) return new Promise((_, rej) => opts?.signal?.addEventListener('abort', () => rej(new Error('aborted'))));   // ne répond jamais
      if (!etat.enLigne) throw new Error('Failed to fetch');
      return { status: o.statutSonde ?? 200 };
    },
    L: { divIcon: (opt) => opt, marker: (ll, opt) => { const m = { ll, opt, addTo() { return m; }, on() {}, setLatLng() { return m; }, setIcon() { return m; }, bindPopup() { return m; }, setPopupContent() { return m; } }; (opt?.zIndexOffset === 500 ? camions : marqueurs).push(m); return m; }, polygon: () => ({ addTo() { return this; } }) },
    __map: { removeLayer() {}, flyTo() {} }, __fauxDb: fauxDb, setStatus() {}, hideLoading() { appels.chargementFini = true; }, showErr: (m) => appels.erreurs.push(m),
    __toasts: appels.toasts, __confirmations: appels.confirmations,
    crypto: { randomUUID: () => crypto.randomUUID() },
  };
  const marqueurs = [], camions = [];
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/config.js', 'js/utilitaires.js', 'js/hors-reseau.js', 'js/auth.js', 'js/tours.js', 'js/vehicules.js', 'js/equipage.js', 'js/equipage-panneau.js', 'js/passe.js', 'js/resume-passe.js', 'js/arrets.js', 'js/routes.js', 'js/liste-arrets.js', 'js/problemes.js', 'js/photos.js'])
    vm.runInContext(lire(f), ctx, { filename: f });
  vm.runInContext('db = __fauxDb; map = __map;', ctx);
  if (!o.sansUtilisateur) vm.runInContext('currentUser = ' + JSON.stringify(user) + ';', ctx);
  vm.runInContext('toast = (m) => { __toasts.push(m); }; confirmer = async (...a) => { __confirmations.push(a); return true; };', ctx);
  if (o.memoire) vm.runInContext('Object.assign(_memoire, ' + JSON.stringify(o.memoire) + ');', ctx);
  if (o.sondeMs) vm.runInContext(`SONDE_INTERVALLE_MS=${o.sondeMs}; SONDE_DELAI_MS=${o.delaiMs ?? 60};`, ctx);
  const w = {
    ctx, el, donnees, appels, etat, marqueurs, camions, stockage,
    run: (code) => vm.runInContext(code, ctx),
    reseau: (v) => { etat.enLigne = v; },
    memoire: () => JSON.parse(vm.runInContext('JSON.stringify(_memoire)', ctx)),
    couleurs: () => marqueurs.slice(-2).map((mk) => (mk.opt.icon.html.match(/background:(#[0-9a-f]+)/) || [])[1]),   // s1, s2 (dernier dessin)
    bandeauReseau: () => ({ visible: el('bandeau-reseau').classList.contains('show'), texte: el('bandeau-reseau').textContent }),
    charge: async () => { await w.run('loadStops()'); await w.run('attendreEcritures()'); return w; },
    nbSondes: () => w.run('reseau.sonde !== null ? 1 : 0'),
    fin: () => vm.runInContext('clearInterval(_minuterieEnCours);_minuterieEnCours=null;arreterSonde();', ctx),
  };
  tousLesMondes.push(w);
  return w;
}
const tousLesMondes = [];
const STOPS = [
  { id: 's1', adresse: '304 rue de l\'Église', client: 'TEST 1', route_id: CH, service: MEC, lat: 46.44, lon: -72.92, ordre: 0, actif: true },
  { id: 's2', adresse: '220 rue du Moulin', client: 'TEST 3', route_id: CH, service: MEC, lat: 46.443, lon: -72.922, ordre: 1, actif: true },
];

// =====================================================================
log('=== QU\'EST-CE QU\'UNE PANNE DE RÉSEAU (et qu\'est-ce qui n\'en est pas une) ===');
{
  const m = monde();
  const oui = [new Error('Failed to fetch'), new TypeError('NetworkError when attempting to fetch resource.'), { message: 'TypeError: Failed to fetch' }, { message: 'Load failed' }, { name: 'AuthRetryableFetchError', message: 'x' },
    { status: 0, message: 'x' }, { message: 'The request timed out' }, { message: 'AbortError: signal is aborted without reason' }, { message: 'net::ERR_INTERNET_DISCONNECTED' }, 'Failed to fetch'];
  const non = [null, undefined, { message: 'permission denied for table stops', code: '42501' }, { message: 'JWT expired' }, { message: 'duplicate key value violates unique constraint' }, { message: 'delai_depasse' }, { message: 'invalid input syntax for type uuid' }, new Error('Cannot read properties of undefined')];
  m.ctx.__oui = oui; m.ctx.__non = non;
  eq('ces erreurs SONT des pannes de réseau', m.run('__oui.map(estErreurReseau)'), oui.map(() => true));
  eq('ces erreurs n\'en sont PAS (refus du serveur, erreur de programme : jamais prises pour une zone morte)', m.run('__non.map(estErreurReseau)'), non.map(() => false));
}

log('\n=== EN LIGNE : chaque lecture du serveur laisse une copie sur le téléphone (par employé) ===');
{
  let m = await monde().charge();
  m.run('planifierRechargementProblemes'); await m.run('chargerEmployes()'); await m.run('lireEquipagePrecedent()');
  await m.run('attendreEcritures()');
  const mem = m.memoire();
  eq('les copies : arrêts, routes, tours, véhicules et équipages, problèmes, employés, équipage précédent — chacune sous « cache:<employé>:<nom> »', Object.keys(mem).sort(), ['stops', 'routes', 'tours', 'vehicules', 'problemes', 'employes', 'equipagePrecedent'].sort().map((n) => 'cache:u-luc:' + n));
  const t = mem['cache:u-luc:tours'];
  vrai('chaque copie a sa version, son heure et ses données', t.v === 1 && Math.abs(Date.now() - Date.parse(t.le)) < 5000 && Array.isArray(t.data) && t.data[0].numero === 1, JSON.stringify(t).slice(0, 120));
  eq('les copies ne contiennent AUCUN téléphone ni NIP (seulement des noms)', JSON.stringify(mem).match(/telephone|nip|password|jeton/gi), null);
  eq('en ligne : pas de bande « hors réseau »', m.bandeauReseau(), { visible: false, texte: '' });
  eq('en ligne : aucune sonde', m.nbSondes(), 0);
  m = await monde({ sansUtilisateur: true });
  m.run('cacheEcrire("stops", [1])'); await m.run('attendreEcritures()');
  eq('personne de connecté : aucune copie n\'est écrite', Object.keys(m.memoire()), []);
  // La copie des équipes actives (écran « Débuter ») se fait à l'ouverture de l'écran
  m = await monde({ tours: [] }).charge(); m.run('routeActive = ' + JSON.stringify(CH)); await m.run('ouvrirDebut()'); await m.run('attendreEcritures()');
  eq('l\'écran « Débuter » garde aussi la liste des véhicules actifs', m.memoire()['cache:u-luc:equipesActives'].data.map((e) => e.nom), ['Camion 1', 'Camion 2']);
}

log('\n=== DÉMARRER SANS SIGNAL : l\'application s\'ouvre avec ses copies ===');
{
  const enLigne = await monde().charge();
  await enLigne.run('lireEquipagePrecedent()'); await enLigne.run('chargerEmployes()'); await enLigne.run('attendreEcritures()');
  const memoire = enLigne.memoire();
  for (const mode of ['lance', 'erreur']) {
    const m = monde({ enLigne: false, mode, memoire });
    await m.run('loadStops()');
    eq(`[${mode}] pas de signal : l'application S'OUVRE (aucun écran d'erreur), le chargement se termine`, [m.appels.erreurs.length, m.appels.chargementFini], [0, true]);
    eq(`[${mode}] les arrêts et leur état viennent de la copie : s1 (fait) vert, s2 jaune ; la fiche parle du tour`, [m.couleurs()[0] ?? null, m.run('stops.length')], ['#4ade80', 2]);
    eq(`[${mode}] la barre du bas garde l'avancement (1/2, 50 %)`, [m.el('prog-txt').textContent, m.el('prog-pct').textContent], ['1/2', '50%']);
    vrai(`[${mode}] le bandeau de la passe est là (50 %, camion, « Terminer »)`, m.el('passe-bandeau').innerHTML.includes('50 %') && m.el('passe-bandeau').innerHTML.includes('btn-terminer') && m.el('passe-bandeau').innerHTML.includes('Camion 1'), m.el('passe-bandeau').innerHTML.slice(0, 200));
    eq(`[${mode}] l'équipage (2 à bord) et le problème (client orange) viennent de la copie`, [m.el('passe-bandeau').innerHTML.includes('👤 Équipage · 2 à bord'), m.run('problemesNonLus.length'), m.run('aProbleme(stops[1])')], [true, 1, true]);
    const b = m.bandeauReseau();
    eq(`[${mode}] la bande dit « Hors réseau · données de <heure> » (l'heure de la plus VIEILLE copie)`, [b.visible, b.texte.startsWith('📴 Hors réseau · données de '), /\d{1,2}\s?h\s?\d{2}/.test(b.texte)], [true, true, true]);
    eq(`[${mode}] une sonde surveille le retour du signal (une seule)`, m.nbSondes(), 1);
    m.fin();
  }
  // L'heure affichée = la plus vieille copie
  const vieille = JSON.parse(JSON.stringify(memoire)); vieille['cache:u-luc:problemes'].le = iso(90);
  const m2 = monde({ enLigne: false, memoire: vieille }); await m2.run('loadStops()');
  eq('l\'heure affichée est celle de la plus VIEILLE copie (il y a 90 minutes) : jamais plus fraîche qu\'elle n\'est', m2.bandeauReseau().texte, '📴 Hors réseau · données de ' + heure(iso(90)));
  m2.fin();
  // Les positions ne se gardent pas
  eq('aucun camion « en direct » n\'est dessiné (une position de plus de 3 minutes ne veut plus rien dire)', [m2.camions.length, m2.run('positionsVehicules.length')], [0, 0]);
  // Le délai d'annulation d'un arrêt part de l'heure de la COPIE
  const tard = JSON.parse(JSON.stringify(memoire)); tard['cache:u-luc:tours'].le = iso(9);
  const m3 = monde({ enLigne: false, memoire: tard }); await m3.run('loadStops()');
  eq('« Annuler » un arrêt : le délai de 10 minutes compte depuis la lecture (copie de il y a 9 min, arrêt fait il y a 60 s → plus d\'annulation)', m3.run('etatComplete(stops[0]).texte'), '✔ Déjà complété');
  const frais = JSON.parse(JSON.stringify(memoire)); frais['cache:u-luc:tours'].le = iso(1);
  const m4 = monde({ enLigne: false, memoire: frais }); await m4.run('loadStops()');
  eq('… copie de il y a 1 min : « ↩ Annuler (8 min) » encore offert', m4.run('etatComplete(stops[0]).texte'), '↩ Annuler (8 min)');
  m3.fin(); m4.fin();
}

log('\n=== SANS SIGNAL ET SANS COPIE : un message honnête ; UN REFUS DU SERVEUR n\'est pas une zone morte ===');
{
  let m = monde({ enLigne: false });
  await m.run('loadStops()');
  vrai('première ouverture sans signal : « Pas de réseau, et rien n\'est encore gardé sur ce téléphone » + quoi faire', m.appels.erreurs.length === 1 && m.appels.erreurs[0].includes('Pas de réseau') && m.appels.erreurs[0].includes('première fois avec du signal'), JSON.stringify(m.appels.erreurs));
  m.fin();
  const en = await monde().charge();
  m = monde({ refus: ['stops'], memoire: en.memoire() });
  await m.run('loadStops()');
  vrai('le serveur REFUSE (« permission denied ») : c\'est une vraie erreur, affichée telle quelle — on ne montre pas de vieilles copies comme si de rien n\'était', m.appels.erreurs.length === 1 && m.appels.erreurs[0].includes('permission denied') && m.bandeauReseau().visible === false, JSON.stringify(m.appels.erreurs));
  m.fin();
  eq('sans arrêts ni routes en copie : rien à afficher', await monde({ enLigne: false, memoire: { 'cache:u-luc:tours': { v: 1, le: iso(1), data: [] } } }).run('restaurerDepuisCache()'), false);
}

log('\n=== COPIES ILLISIBLES, PÉRIMÉES OU D\'UN AUTRE EMPLOYÉ : ignorées ===');
{
  const en = await monde().charge(); const memoire = en.memoire();
  const abime = (f) => { const c = JSON.parse(JSON.stringify(memoire)); f(c); return c; };
  for (const [nom, fab] of [['version d\'un ancien format', (c) => { c['cache:u-luc:stops'].v = 0; }], ['sans heure', (c) => { delete c['cache:u-luc:stops'].le; }], ['sans données', (c) => { delete c['cache:u-luc:stops'].data; }], ['des arrêts qui ne sont pas une liste', (c) => { c['cache:u-luc:stops'].data = 'oups'; }]]) {
    const m = monde({ enLigne: false, memoire: abime(fab) }); await m.run('loadStops()');
    eq(`copie des arrêts « ${nom} » : ignorée, message honnête, aucun plantage`, [m.appels.erreurs.length, m.run('stops.length')], [1, 0]);
    m.fin();
  }
  let m = monde({ enLigne: false, memoire: abime((c) => { c['cache:u-luc:tours'].data = { pas: 'une liste' }; }) }); await m.run('loadStops()');
  eq('copie des tours illisible : l\'application s\'ouvre quand même (sans passe), les arrêts restent visibles', [m.appels.erreurs.length, m.run('stops.length'), m.run('tours.length')], [0, 2, 0]);
  m.fin();
  m = monde({ enLigne: false, memoire, utilisateur: MARC }); await m.run('loadStops()');
  eq('un AUTRE employé sur le même téléphone (Marc) ne voit PAS les copies de Luc (« je suis chauffeur » est personnel) : message « rien de gardé »', [m.appels.erreurs.length, m.run('tours.length')], [1, 0]);
  m.fin();
}

log('\n=== LE SIGNAL DISPARAÎT PENDANT QU\'ON TRAVAILLE : la bande, une seule sonde, le retour ===');
{
  let m = await monde({ sondeMs: 40 }).charge();
  eq('au départ : en ligne, pas de bande', [m.bandeauReseau().visible, m.nbSondes()], [false, 0]);
  m.reseau(false);
  for (let i = 0; i < 6; i++) await m.run('chargerTours()');
  await m.run('chargerProblemes()'); await m.run('chargerVehiculesEtEquipages()'); await m.run('chargerPositionsVehicules()');
  eq('les lectures échouent : la bande apparaît, ce qu\'on savait reste à l\'écran (rien n\'est effacé)', [m.bandeauReseau().visible, m.run('tours.length'), m.run('stops.length'), m.el('prog-txt').textContent], [true, 1, 2, '1/2']);
  eq('… malgré 9 échecs, UNE seule sonde (pas d\'accumulation)', m.nbSondes(), 1);
  const lecturesAvant = m.appels.rpc.filter((r) => r.nom === 'tours_en_cours').length;
  await attendre(140);
  eq('la sonde interroge le serveur régulièrement tant qu\'il n\'y a pas de signal, sans relire les données', [m.appels.sondes.length >= 2, m.appels.sondes.every((u) => u.endsWith('/auth/v1/health')), m.appels.rpc.filter((r) => r.nom === 'tours_en_cours').length], [true, true, lecturesAvant]);
  vrai('… à UN rythme (toutes les 40 ms ici : au plus 5 sondes en 140 ms) — pas une sonde par échec de lecture', m.appels.sondes.length <= 5, m.appels.sondes.length + ' sondes');
  m.reseau(true);
  await attendre(140);
  eq('le signal revient : la bande disparaît, la sonde s\'arrête', [m.bandeauReseau().visible, m.nbSondes()], [false, 0]);
  vrai('… et tout est RELU depuis le serveur (les tours, les arrêts, les problèmes) : le serveur a le dernier mot', m.appels.rpc.filter((r) => r.nom === 'tours_en_cours').length > lecturesAvant && m.appels.lectures.filter((t) => t === 'stops').length >= 2, JSON.stringify(m.appels.lectures));
  const n = m.appels.sondes.length; await attendre(120);
  eq('plus aucune sonde une fois le signal revenu', m.appels.sondes.length, n);
  m.fin();

  // Une réponse du serveur, même un REFUS, prouve que le signal est là
  m = await monde({ sondeMs: 40, statutSonde: 401 }).charge(); m.reseau(false); await m.run('chargerTours()'); m.reseau(true);
  await attendre(120);
  eq('la sonde reçoit « 401 » : c\'est une réponse, donc le signal est revenu', m.bandeauReseau().visible, false);
  m.fin();
  // Une sonde qui ne répond jamais = pas de signal (elle ne bloque pas les suivantes)
  m = await monde({ sondeMs: 30, delaiMs: 40, sondeSilencieuse: true }).charge(); m.reseau(false); await m.run('chargerTours()');
  await attendre(200);
  eq('une sonde qui ne répond jamais est abandonnée au bout du délai : toujours hors réseau, et les sondes suivantes continuent', [m.bandeauReseau().visible, m.appels.sondes.length >= 2], [true, true]);
  m.fin();
  eq('serveurJoignable() : réponse = vrai, exception = faux', [await monde({ statutSonde: 503 }).run('serveurJoignable()'), await monde({ enLigne: false }).run('serveurJoignable()')], [true, false]);
}

log('\n=== RÉSEAU PARTIEL (une lecture passe, une autre échoue) : jamais de boucle qui martèle le serveur ===');
{
  const m = await monde({ sondeMs: 30, echoueSeulement: [] }).charge();
  m.donnees.tours = m.donnees.tours;   // (les tours et les positions vont répondre différemment)
  m.ctx.__partiel = true;
  // On coupe seulement les tours : les positions et les autres lectures répondent
  m.etat.enLigne = true;
  const mp = monde({ sondeMs: 30, echoueSeulement: ['tours_en_cours'] });
  await mp.run('loadStops()');
  const lectures0 = mp.appels.lectures.filter((t) => t === 'stops').length;
  for (let i = 0; i < 4; i++) { await mp.run('chargerTours()'); await mp.run('chargerPositionsVehicules()'); }
  await attendre(400);
  const stopsLus = mp.appels.lectures.filter((t) => t === 'stops').length;
  vrai('les tours échouent en permanence mais les positions passent : le nombre de rechargements complets reste petit et borné (pas de boucle infinie)', stopsLus - lectures0 <= 12, `${stopsLus - lectures0} rechargements des arrêts`);
  mp.fin(); m.fin();
}

log('\n=== L\'ÉCRAN « DÉBUTER LA PASSE » SANS SIGNAL ===');
{
  const en = await monde({ tours: [] }).charge(); en.run('routeActive = ' + JSON.stringify(CH)); await en.run('ouvrirDebut()'); await en.run('attendreEcritures()');
  const memoire = en.memoire();
  let m = monde({ enLigne: false, memoire, tours: [] });
  await m.run('loadStops()'); m.run('routeActive = ' + JSON.stringify(CH)); await m.run('ouvrirDebut()');
  const ouvert = m.el('debut-overlay').classList.contains('open');
  eq('sans signal, l\'écran s\'OUVRE avec les véhicules et l\'équipage précédent gardés (Camion 1, Camion 2 ; Eric à confirmer)', [ouvert, m.run('_debut.equipes.map(x => x.nom)'), m.run('_debut.equipage.precedent.map(x => x.nom)'), m.run('_debut.equipage.indispo')], [true, ['Camion 1', 'Camion 2'], ['Eric'], false]);
  eq('… et « Démarrer » reste grisé tant qu\'Eric n\'est pas tranché (la règle de Joé tient aussi hors réseau)', m.run('etatDebut().manque.includes("équipage")'), true);
  m.fin();
  const sansCopieVehicules = JSON.parse(JSON.stringify(memoire)); delete sansCopieVehicules['cache:u-luc:equipesActives'];
  m = monde({ enLigne: false, memoire: sansCopieVehicules }); await m.run('loadStops()'); m.run('routeActive = ' + JSON.stringify(CH)); await m.run('ouvrirDebut()');
  eq('sans copie des véhicules : l\'écran ne s\'ouvre pas, message « Pas de réseau »', [m.el('debut-overlay').classList.contains('open'), m.appels.toasts.includes('❌ Pas de réseau. Réessaie.')], [false, true]);
  m.fin();
  const sansPrec = JSON.parse(JSON.stringify(memoire)); delete sansPrec['cache:u-luc:equipagePrecedent'];
  m = monde({ enLigne: false, memoire: sansPrec, tours: [] }); await m.run('loadStops()'); m.run('routeActive = ' + JSON.stringify(CH)); await m.run('ouvrirDebut()');
  eq('sans copie de l\'équipage précédent : « indisponible », le départ n\'est pas bloqué', [m.run('_debut.equipage.indispo'), m.run('etatDebut().manque.includes("équipage")')], [true, false]);
  m.fin();
}

log('\n=== S\'OUVRIR SANS SIGNAL ALORS QUE LA SESSION A EXPIRÉ (le jeton est gardé sur le téléphone) ===');
{
  const en = await monde().charge(); const memoire = en.memoire();
  const jeton = (id) => JSON.stringify({ access_token: 'a', refresh_token: 'r', user: { id } });
  const tel = { lp_profil: JSON.stringify({ id: 'u-luc', nom: 'Luc', role: 'employe' }), 'sb-projet-auth-token': jeton('u-luc') };
  let m = monde({ enLigne: false, sansUtilisateur: true, stockage: tel, memoire });
  await m.run('restaurerSession()');
  eq('plus de session (expirée hors réseau) MAIS le jeton et le profil sont gardés, et le serveur est injoignable : l\'application s\'OUVRE hors réseau', [m.run('currentUser && currentUser.nom'), m.el('login-screen').classList.contains('show'), m.run('stops.length'), m.bandeauReseau().visible], ['Luc', false, 2, true]);
  eq('… aucune requête d\'authentification n\'a été faite au serveur', m.appels.rpc.filter((r) => /auth|login|signIn/i.test(r.nom)).length, 0);
  m.fin();

  m = monde({ enLigne: true, sansUtilisateur: true, stockage: tel, memoire });
  await m.run('restaurerSession()');
  eq('le serveur RÉPOND (donc la session est vraiment finie) : retour à l\'écran de connexion, jamais d\'entrée par la porte de derrière', [m.run('currentUser'), m.el('login-screen').classList.contains('show')], [null, true]);
  m.fin();
  m = monde({ enLigne: false, sansUtilisateur: true, stockage: { lp_profil: tel.lp_profil }, memoire });
  await m.run('restaurerSession()');
  eq('pas de jeton gardé : écran de connexion', [m.run('currentUser'), m.el('login-screen').classList.contains('show')], [null, true]);
  m.fin();
  m = monde({ enLigne: false, sansUtilisateur: true, stockage: { ...tel, 'sb-projet-auth-token': jeton('u-marc') }, memoire });
  await m.run('restaurerSession()');
  eq('le jeton gardé est celui de quelqu\'un d\'AUTRE que le profil gardé : écran de connexion', [m.run('currentUser'), m.el('login-screen').classList.contains('show')], [null, true]);
  m.fin();
  m = monde({ enLigne: false, sansUtilisateur: true, stockage: { ...tel, 'sb-projet-auth-token': '{pas du json' }, memoire });
  await m.run('restaurerSession()');
  eq('jeton illisible : écran de connexion, aucun plantage', m.el('login-screen').classList.contains('show'), true);
  m.fin();
  m = monde({ enLigne: false, sansUtilisateur: true, stockage: {}, memoire });
  await m.run('restaurerSession()');
  eq('téléphone neuf (rien de gardé) : écran de connexion', m.el('login-screen').classList.contains('show'), true);
  m.fin();
  m = monde({ enLigne: false, sansUtilisateur: true, stockage: { ...tel, 'sb-projet-auth-token': JSON.stringify({ currentSession: { refresh_token: 'r', user: { id: 'u-luc' } } }) }, memoire });
  await m.run('restaurerSession()');
  eq('l\'ancien format du jeton (« currentSession ») est reconnu aussi', m.run('currentUser && currentUser.nom'), 'Luc');
  m.fin();
}

log('\n=== DÉCONNEXION : les copies ne restent pas sur le téléphone ===');
{
  const m = await monde().charge();
  m.run('cacheEcrire("autre", 1)'); await m.run('attendreEcritures()');
  m.run('_memoire["file:gestes"] = [1, 2]');   // (l'étape 16b y rangera la file d'attente : elle ne doit jamais être effacée avec les copies)
  const avant = Object.keys(m.memoire()).length;
  await m.run('effacerCache()');
  eq('effacer les copies retire TOUTES les copies (« cache:… ») et rien d\'autre', [avant > 5, Object.keys(m.memoire())], [true, ['file:gestes']]);
  m.fin();
}

log('\n=== RELIRE UNE COPIE EN COURS DE ROUTE ne fait jamais croire que MA passe est terminée ===');
{
  const m = await monde().charge();   // ma passe est en cours
  m.run('_memoire["cache:u-luc:tours"] = { v: 1, le: ' + JSON.stringify(iso(1)) + ', data: [] }');   // la copie des tours ne contient pas ma passe
  m.reseau(false);
  await m.run('restaurerDepuisCache()'); m.run('renderAll()'); await attendre(60);
  eq('les tours viennent d\'une copie qui n\'a pas ma passe : AUCUNE carte « Passe terminée » (on ne sait rien de plus, on n\'invente pas une fin)', m.el('resume-overlay').classList.contains('open'), false);
  m.fin();
}

log('\n=== LE CODE : plus aucune dépendance à Internet au démarrage ===');
{
  const html = lire('index.html'), demarrage = lire('js/demarrage.js'), css = lire('css/style.css');
  const externes = (html.match(/(?:src|href)="https?:\/\/[^"]+"/g) || []).map((x) => x.replace(/^(src|href)="/, '').replace(/"$/, ''));
  eq('la page ne va chercher sur Internet QUE les polices (pas Leaflet, pas supabase-js, pas de script)', externes.map((u) => new URL(u).hostname), ['fonts.googleapis.com']);
  vrai('Leaflet (CSS et JS) et supabase-js sont chargés depuis l\'application (dossier vendor/)', html.includes('href="vendor/leaflet.css"') && /loadScript\('vendor\/leaflet\.js'\)/.test(demarrage) && /loadScript\('vendor\/supabase\.min\.js'\)/.test(demarrage) && !/https?:\/\//.test(demarrage.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/showErr\([^)]*\)/g, '')));
  const fichier = (f) => fs.readFileSync(WWW + 'vendor/' + f);
  const sha = (f) => crypto.createHash('sha256').update(fichier(f)).digest('hex');
  eq('les fichiers copiés sont ceux de la note vendor/VERSIONS.txt (empreintes)', [sha('leaflet.js').slice(0, 16), sha('leaflet.css').slice(0, 16), sha('supabase.min.js').slice(0, 16)], ['5c9aecfc30e45645', 'b570abbda963c60b', 'fbde52aab1700a3b']);
  vrai('… ils ont la bonne taille et la bonne nature (Leaflet 1.9.4, supabase-js)', fichier('leaflet.js').length > 100000 && /version="1\.9\.4"|version:"1\.9\.4"|"1\.9\.4"/.test(fichier('leaflet.js').toString()) && fichier('supabase.min.js').length > 150000 && /supabase/i.test(fichier('supabase.min.js').toString()));
  vrai('les images de Leaflet que son CSS demande sont là', ['layers.png', 'layers-2x.png', 'marker-icon.png'].every((i) => fs.existsSync(WWW + 'vendor/images/' + i)) && /url\(images\/layers\.png\)/.test(lire('vendor/leaflet.css')));
  const notes = lire('vendor/VERSIONS.txt');
  vrai('la note des versions dit ce qui est copié et ce qui reste sur Internet (polices, fond de carte)', /Leaflet 1\.9\.4/.test(notes) && /supabase-js 2\.\d+\.\d+/.test(notes) && /polices/.test(notes) && /fond de carte/.test(notes));
  vrai('la page charge hors-reseau.js avant auth.js, et a la bande « hors réseau »', html.indexOf('js/hors-reseau.js') > 0 && html.indexOf('js/hors-reseau.js') < html.indexOf('js/auth.js') && html.includes('id="bandeau-reseau"'));
  vrai('la bande « hors réseau » ne bloque aucun toucher, et le fond de carte est sombre quand le fond satellite manque', /#bandeau-reseau\{[^}]*pointer-events:none/.test(css) && /#map,\.leaflet-container\{background:#0c1117/.test(css));
  vrai('rien de secret dans les copies ni dans le code hors réseau (aucune clé de service, aucun NIP)', !/service_role|sb_secret|nip|password/i.test(lire('js/hors-reseau.js').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')));
  vrai('le code de la sonde n\'envoie que la clé PUBLIQUE et ne lit rien : c\'est une simple demande d\'état', /\/auth\/v1\/health/.test(lire('js/hors-reseau.js')) && /headers:\{apikey:SUPA_KEY\}/.test(lire('js/hors-reseau.js')));
}

tousLesMondes.forEach((w) => w.fin());
console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
