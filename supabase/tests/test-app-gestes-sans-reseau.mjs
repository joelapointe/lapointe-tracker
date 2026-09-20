// Étape 16c — LES GESTES SANS RÉSEAU AVEC RÉSULTAT IMMÉDIAT À L'ÉCRAN (tours.js, arrets.js, resume-passe.js, file-attente.js, hors-reseau.js),
// testés avec les VRAIS fichiers de l'application chargés dans un faux navigateur, un FAUX Supabase qui peut couper le signal, refuser ou ne
// jamais répondre, et un faux stockage. Morceau 1 : le noyau (les gestes en attente posés par-dessus la copie du serveur) et les arrêts.
import vm from 'vm';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
// WWW_TEST : un autre dossier « www » (les essais d'erreurs volontaires modifient une COPIE du code, jamais le vrai)
const WWW = process.env.WWW_TEST ? process.env.WWW_TEST.split('\\').join('/').replace(/\/?$/, '/') : fileURLToPath(new URL('../../www/', import.meta.url));

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
const lire = (f) => fs.readFileSync(WWW + f, 'utf8');
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();

const MEC = 'Déneigement mécanique', CH = 'route-charette';
const LUC = { id: 'u-luc', nom: 'Luc', role: 'employe' };
const NOMS = { 'u-luc': 'Luc', 'u-marc': 'Marc', 'u-eric': 'Eric' };
const STOPS = [
  { id: 's1', adresse: '304 rue de l\'Église', client: 'TEST 1', route_id: CH, service: MEC, lat: 46.44, lon: -72.92, ordre: 0, actif: true },
  { id: 's2', adresse: '220 rue du Moulin', client: 'TEST 3', route_id: CH, service: MEC, lat: 46.443, lon: -72.922, ordre: 1, actif: true },
];
// Les réponses habituelles d'un serveur content
const REPONSES = {
  completer_arret: { statut: 'complete' }, annuler_arret: { statut: 'annule' }, terminer_passe: { statut: 'terminee' },
  debuter_passe: { statut: 'debutee', equipage: [] }, equipage_ajouter: { statut: 'ajoute' }, equipage_retirer: { statut: 'retire' },
  probleme_attacher_photo: { statut: 'ok' },
};

// Un monde : faux navigateur + faux serveur (avec ou sans signal) + faux stockage du téléphone
function monde(o = {}) {
  const els = {};
  const creer = (id) => {
    const classes = new Set();
    const e = { id, children: [], style: {}, textContent: '', _html: '', value: '', disabled: false, className: '', onclick: null, attrs: {},
      classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)), contains: (c) => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
      appendChild(c) { c.parent = this; this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; }, focus() {}, click() {},
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); },
      querySelector(sel) { return this.children.find((c) => '.' + c.className === sel) ?? null; } };
    Object.defineProperty(e, 'innerHTML', { get() { return this._html; }, set(v) { this._html = v; if (v === '') this.children = []; } });
    return e;
  };
  const el = (id) => (els[id] ??= creer(id));
  const etat = { enLigne: o.enLigne ?? true, session: o.session ?? { user: { id: 'u-luc' } }, dateMock: null };
  const donnees = {
    stops: STOPS.map((s) => ({ ...s })), routes: [{ id: CH, nom: 'Charette', couleur: '#c8e63c', actif: true }], problemes: [],
    positions: [], equipes: [{ id: 'e1', nom: 'Camion 1' }], utilisateurs: Object.keys(NOMS).map((id) => ({ id, nom: NOMS[id], actif: true })),
    tours: [{ route_id: CH, tache: MEC, numero: 1, en_cours: true, total: 2, faits: 0, pourcentage: 0, arrets_faits: [], faits_il_y_a: {}, mes_passes_annulables: [],
      passes: [{ passe_id: 'p-luc', equipe_id: 'e1', chauffeur_id: 'u-luc', je_suis_chauffeur: true, je_suis_a_bord: true }] }],
    equipage_periodes: [{ passe_id: 'p-luc', role: 'chauffeur', utilisateur_id: 'u-luc', utilisateurs: { nom: 'Luc' } }],
  };
  // appels.envois : chaque appel d'un geste au serveur, dans l'ordre [{nom, args, t}] ; appels.lectures : les lectures (tables)
  const appels = { envois: [], lectures: [], sondes: [], toasts: [], confirmations: [], erreurs: [], evenements: [], uploads: [], reload: 0, signOut: 0, enCours: 0, maxEnCours: 0 };
  const echec = () => { throw new Error('Failed to fetch'); };
  const GESTES = Object.keys(REPONSES);
  const fauxDb = {
    rpc: async (nom, args) => {
      if (nom === 'tours_en_cours') { appels.lectures.push(nom); appels.evenements.push('L:' + nom); if (!etat.enLigne) echec(); return { data: donnees.tours, error: null }; }
      if (nom === 'equipage_precedent') { if (!etat.enLigne) echec(); return { data: null, error: null }; }
      if (!GESTES.includes(nom)) return { data: null, error: { message: 'inconnu' } };
      const n = appels.envois.filter((x) => x.nom === nom).length;
      appels.envois.push({ nom, args, t: Date.now() }); appels.evenements.push('E:' + nom);
      appels.enCours++; appels.maxEnCours = Math.max(appels.maxEnCours, appels.enCours);
      try {
        if (o.delaiEnvoiMs) await attendre(o.delaiEnvoiMs);
        if (o.suspendu) return await new Promise(() => {});   // ne répond jamais (l'application se ferme en plein envoi)
        if (!etat.enLigne) echec();
        if (o.serveur?.[nom]) { const r = await o.serveur[nom](args, n, donnees); if (r !== undefined) return r; }
        return { data: REPONSES[nom], error: null };
      } finally { appels.enCours--; }
    },
    from: (table) => {
      if (appels.lectures.length > 1500) throw new Error('BOUCLE INFINIE détectée (plus de 1500 lectures)');
      const q = { filtres: [] };
      q.select = () => q; q.order = () => q; q.is = () => q; q.limit = () => q; q.maybeSingle = () => q;
      q.eq = (c, v) => { q.filtres.push([c, v]); return q; };
      q.insert = async (rows) => {
        const n = appels.envois.filter((x) => x.nom === 'insert:' + table).length;
        appels.envois.push({ nom: 'insert:' + table, args: rows[0], t: Date.now() });
        if (!etat.enLigne) echec();
        if (o.serveur?.['insert:' + table]) { const r = await o.serveur['insert:' + table](rows[0], n); if (r !== undefined) return r; }
        return { data: null, error: null };
      };
      q.then = (ok_, ko_) => {
        appels.lectures.push(table); appels.evenements.push('L:' + table);
        if (!etat.enLigne) return Promise.reject(new Error('Failed to fetch')).then(ok_, ko_);
        const rows = (donnees[table] ?? []).filter((r) => q.filtres.every(([c, v]) => !(c in r) || r[c] === v));
        return Promise.resolve({ data: rows, error: null }).then(ok_, ko_);
      };
      return q;
    },
    storage: { from: () => ({ upload: async (chemin, blob) => { appels.uploads.push(chemin); if (!etat.enLigne) echec(); if (o.upload) return o.upload(chemin, blob); return { data: {}, error: null }; } }) },
    auth: { getSession: async () => ({ data: { session: etat.session }, error: null }), signOut: async () => { appels.signOut++; return {}; }, onAuthStateChange: () => ({}) },
  };
  const stockage = { ...(o.stockage ?? {}) };
  const localStorage = { getItem: (k) => (k in stockage ? stockage[k] : null), setItem: (k, v) => { stockage[k] = String(v); }, removeItem: (k) => { delete stockage[k]; }, key: (i) => Object.keys(stockage)[i] ?? null, get length() { return Object.keys(stockage).length; } };
  const sandbox = {
    document: { getElementById: el, createElement: () => creer(null), body: creer('body'), addEventListener() {}, removeEventListener() {} },
    localStorage, window: { open() {} }, setTimeout, clearTimeout, setInterval, clearInterval, console, AbortController, Blob,
    location: { reload() { appels.reload++; } },
    fetch: async (url) => { appels.sondes.push(url); if (!etat.enLigne) throw new Error('Failed to fetch'); return { status: 200 }; },
    L: { divIcon: (opt) => opt, marker: (ll, opt) => { const m = { ll, opt, addTo() { return m; }, on() {}, setLatLng() { return m; }, setIcon() { return m; }, bindPopup() { return m; }, setPopupContent() { return m; } }; return m; }, polygon: () => ({ addTo() { return this; } }) },
    __map: { removeLayer() {}, flyTo() {} }, __fauxDb: fauxDb, setStatus() {}, hideLoading() {}, showErr: (m) => appels.erreurs.push(m),
    __toasts: appels.toasts, __confirmations: appels.confirmations,
    crypto: { randomUUID: () => crypto.randomUUID() },
  };
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/config.js', 'js/utilitaires.js', 'js/hors-reseau.js', 'js/file-attente.js', 'js/auth.js', 'js/tours.js', 'js/vehicules.js', 'js/equipage.js', 'js/equipage-panneau.js', 'js/passe.js', 'js/resume-passe.js', 'js/arrets.js', 'js/routes.js', 'js/liste-arrets.js', 'js/problemes.js', 'js/photos.js'])
    vm.runInContext(lire(f), ctx, { filename: f });
  vm.runInContext('db = __fauxDb; map = __map;', ctx);
  vm.runInContext('currentUser = ' + JSON.stringify(o.utilisateur ?? LUC) + ';', ctx);
  vm.runInContext('toast = (m) => { __toasts.push(m); }; confirmer = async (...a) => { __confirmations.push(a); return true; };', ctx);
  // Sans signal au départ : l'application le SAIT déjà (comme après une lecture qui a échoué) ; les tests le rétablissent à la main
  if (!etat.enLigne) vm.runInContext('reseau.enLigne = false; reseau.donneesDe = new Date().toISOString();', ctx);
  if (o.memoire) vm.runInContext('Object.assign(_memoire, ' + JSON.stringify(o.memoire) + ');', ctx);
  vm.runInContext(`SONDE_INTERVALLE_MS=${o.sondeMs ?? 30}; SONDE_DELAI_MS=200; FILE_DELAIS_MS=${JSON.stringify(o.delais ?? [20, 40, 80])}; FILE_DELAI_APPEL_MS=${o.delaiAppelMs ?? 2000};`, ctx);
  const w = {
    ctx, el, donnees, appels, etat, stockage,
    run: (code) => vm.runInContext(code, ctx),
    reseau: (v) => { etat.enLigne = v; },
    memoire: () => JSON.parse(vm.runInContext('JSON.stringify(_memoire)', ctx)),
    cles: (prefixe = 'file:') => Object.keys(w.memoire()).filter((k) => k.startsWith(prefixe)).sort(),
    // enfiler un geste « compléter » banal
    completer: (stopId = 's1', libelle) => w.run(`enfiler('completer_arret',{passeId:'p-luc',stopId:${JSON.stringify(stopId)},mode:'manuel',lat:46.4,lon:-72.9},{libelle:${JSON.stringify(libelle ?? '✔ Complété : ' + stopId)}})`),
    enfiler: (type, args, opt = {}) => { w.ctx.__a = args; w.ctx.__o = opt; return w.run(`enfiler(${JSON.stringify(type)},__a,__o)`); },
    bande: () => ({ visible: el('bandeau-reseau').classList.contains('show'), texte: el('bandeau-reseau').textContent, actif: el('bandeau-reseau').classList.contains('actif') }),
    envoisGestes: () => appels.envois.map((x) => x.nom + (x.args?.p_stop_id ? ':' + x.args.p_stop_id : '')),
    attentes: () => w.run('gestesEnAttente().map(g=>g.libelle)'),
    refus: () => w.run('gestesNonEnvoyes().map(g=>({libelle:g.libelle,raison:g.refus.raison}))'),
    fin: () => vm.runInContext('arreterFile();arreterSonde();', ctx),
  };
  tousLesMondes.push(w);
  return w;
}
const tousLesMondes = [];
const monter = async (m) => { await m.run('initialiserFile()'); return m; };

// ── Outils de ces tests ────────────────────────────────
const idx = (id) => STOPS.findIndex((s) => s.id === id);
const PASSE_LUC = { passe_id: 'p-luc', equipe_id: 'e1', chauffeur_id: 'u-luc', je_suis_chauffeur: true, je_suis_a_bord: true };
const tourInit = (o = {}) => ({ route_id: CH, tache: MEC, numero: 1, en_cours: true, total: 2, faits: 0, pourcentage: 0, arrets_faits: [], faits_il_y_a: {}, mes_passes_annulables: [], passes: [{ ...PASSE_LUC }], ...o });
// Ouvre l'application EN LIGNE (les copies locales s'écrivent), avec la situation donnée du côté du serveur
async function ouvrir(o = {}) {
  const m = monde(o.monde || {});
  if (o.tours) m.donnees.tours = o.tours;
  await m.run('loadStops()');
  await m.run('attendreEcritures()');
  return m;
}
const coupe = (m) => { m.reseau(false); m.run('marquerHorsReseau()'); };   // le signal disparaît ET l'application le constate
const dernier = (m) => m.appels.toasts[m.appels.toasts.length - 1];
const estFait = (m, id) => m.run(`estFait(stops[${idx(id)}])`);
const toucher = async (m, id) => { m.run(`openCard(${idx(id)})`); await m.run('completeStop()'); };
const attendreQue = async (cond, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await cond()) return true; await attendre(15); } return false; };
const nbLecturesTours = (m) => m.appels.lectures.filter((x) => x === 'tours_en_cours').length;
// Un serveur qui applique vraiment un « compléter » (pour voir ce que l'écran devient quand il a le dernier mot)
const appliquerCompleter = (args, n, d) => {
  const t = d.tours[0];
  if (!t.arrets_faits.includes(args.p_stop_id)) { t.arrets_faits.push(args.p_stop_id); t.faits = t.arrets_faits.length; t.pourcentage = Math.round(100 * t.faits / t.total); t.faits_il_y_a[args.p_stop_id] = 1; }
  return { data: { statut: 'complete' }, error: null };
};

log('\n=== HORS RÉSEAU : « COMPLÉTÉ » MONTRE SON RÉSULTAT TOUT DE SUITE ===');
{
  const m = await ouvrir(); coupe(m);
  await toucher(m, 's1');
  eq('l\'arrêt est FAIT à l\'écran, le tour passe à 1/2 (50 %)', [estFait(m, 's1'), m.run('tours[0].faits'), m.run('tours[0].pourcentage')], [true, 1, 50]);
  eq('UN geste gardé : compléter s1, avec MA passe', m.run('gestesEnAttente().map(g=>[g.type,g.args.passeId,g.args.stopId,g.args.mode])'), [['completer_arret', 'p-luc', 's1', 'manuel']]);
  eq('aucun envoi au serveur (hors réseau)', m.appels.envois.length, 0);
  eq('le message dit « complété » ET que l\'envoi attend le signal', dernier(m).startsWith('✔ Stop complété ! · ⏳ envoyé au retour du signal'), true);
  eq('la fiche se ferme (comme en ligne)', m.run('activeIdx'), null);
  m.run(`openCard(${idx('s1')})`);
  eq('la fiche dit « en attente d\'envoi » et le bouton offre « Annuler » (10 min)', [m.el('sc-tour').textContent.includes('⏳ en attente d’envoi'), m.el('btn-cmp').textContent], [true, '↩ Annuler (10 min)']);
  m.run('renderListe()');
  const badges = m.el('liste-body').children.map((c) => c.innerHTML.match(/ci-badge [^>]*>([^<]*)</)?.[1]);
  eq('la liste des arrêts : s1 « ✔ FAIT ⏳ », s2 « À FAIRE » sans ⏳', badges.slice().sort(), ['À FAIRE', '✔ FAIT ⏳']);
  eq('la barre du bas : 1/2 et 50 %', [m.el('prog-txt').textContent, m.el('prog-pct').textContent], ['1/2', '50%']);
  eq('la bande du haut : « Hors réseau · ⏳ 1 geste en attente »', m.bande().texte.includes('⏳ 1 geste en attente'), true);
  // La copie du serveur n'est JAMAIS modifiée (ni en mémoire, ni sur le téléphone) : la superposition travaille sur une copie
  eq('la copie du serveur (en mémoire) est intacte : 0 fait', [m.donnees.tours[0].faits, m.run('_toursServeur[0].faits'), m.run('_toursServeur[0].arrets_faits.length')], [0, 0, 0]);
  await m.run('attendreEcritures()');
  const cle = m.cles('cache:').find((k) => k.endsWith(':tours'));
  eq('la copie gardée sur le téléphone (« cache: ») est intacte : 0 fait', [!!cle, m.memoire()[cle]?.data?.[0]?.faits], [true, 0]);
  m.fin();
}

log('\n=== UNE RELECTURE NE DÉFAIT JAMAIS UN GESTE QUI ATTEND ===');
{
  // Le serveur répond aux lectures (avec une vieille situation : 0 fait) mais met très longtemps à répondre à l'envoi : le geste reste dans la file
  const m = await ouvrir({ monde: { serveur: { completer_arret: () => new Promise(() => {}) } } }); coupe(m); await toucher(m, 's1');
  m.run('arreterSonde()'); m.reseau(true);
  const lu = await m.run('chargerTours()');
  m.run('renderAll();majCarte()');
  eq('relecture RÉUSSIE d’un serveur qui ne sait rien du geste : l’arrêt reste fait, 1/2', [lu, estFait(m, 's1'), m.run('tours[0].faits')], [true, true, 1]);
  await m.run('planifierRechargementTours()'); await attendre(450);   // (le rechargement que déclenche un changement vu sur un autre téléphone)
  eq('même chose après le rechargement automatique des tours (le geste est toujours dans la file)', [estFait(m, 's1'), m.run('tours[0].pourcentage'), m.attentes().length], [true, 50, 1]);
  await m.run('loadStops()');
  eq('même chose après un rechargement complet (loadStops)', [estFait(m, 's1'), m.run('tours[0].faits'), m.attentes().length], [true, 1, 1]);
  m.fin();
}

log('\n=== ON ROUVRE L\'APPLICATION SANS RÉSEAU : LE GESTE EST TOUJOURS À L\'ÉCRAN ===');
{
  const a = await ouvrir(); coupe(a); await toucher(a, 's1'); await a.run('attendreEcritures()');
  const surLeTelephone = a.memoire(); a.fin();
  const b = monde({ enLigne: false, memoire: surLeTelephone });
  await b.run('loadStops()');
  eq('après réouverture hors réseau : l\'arrêt est fait, 1/2, le geste est en attente, aucune erreur', [estFait(b, 's1'), b.run('tours[0].faits'), b.attentes().length, b.appels.erreurs.length], [true, 1, 1, 0]);
  eq('… et la bande le dit', [b.bande().texte.includes('📴 Hors réseau'), b.bande().texte.includes('⏳ 1 geste en attente')], [true, true]);
  eq('… et rien n\'est envoyé sans signal', b.appels.envois.length, 0);
  b.fin();
  // Les copies sont posées AVANT que la file ait été relue par ailleurs : restaurerDepuisCache relit lui-même la file
  const c = monde({ enLigne: false, memoire: surLeTelephone });
  await c.run('restaurerDepuisCache()');
  eq('restaurerDepuisCache seul : le geste gardé est déjà posé sur les tours affichés', [estFait(c, 's1'), c.run('tours[0].faits')], [true, 1]);
  c.fin();
}

log('\n=== 100 % SANS RÉSEAU : LA PASSE SE FERME À L\'ÉCRAN, COMME LE FERAIT LE SERVEUR ===');
{
  const m = await ouvrir({ tours: [tourInit({ faits: 1, pourcentage: 50, arrets_faits: ['s2'], faits_il_y_a: { s2: 30 } })] }); coupe(m);
  eq('avant : ma passe est en cours', m.run('maPasse()!==null'), true);
  await toucher(m, 's1');
  eq('tour terminé : 2/2, 100 %, plus de camion, plus de passe à moi', [m.run('tours[0].en_cours'), m.run('tours[0].faits'), m.run('tours[0].pourcentage'), m.run('tours[0].passes.length'), m.run('maPasse()')], [false, 2, 100, 0, null]);
  eq('le message : « Passe terminée : 100 % ! » + ⏳', dernier(m).startsWith('🎉 Passe terminée : 100 % ! · ⏳ envoyé au retour du signal'), true);
  eq('le résumé de fin de passe s\'ouvre avec les BONS chiffres (2/2, 100 %), sans lire le serveur', [m.el('resume-overlay').classList.contains('open'), m.el('resume-titre').textContent, m.el('resume-pct').textContent, m.el('resume-details').innerHTML.includes('2/2 arrêts')], [true, '🎉 Passe complétée : 100 %', '100 %', true]);
  eq('le bandeau n\'offre plus « Terminer » mais « Débuter »', [m.el('passe-bandeau').innerHTML.includes('btn-terminer'), m.el('passe-bandeau').innerHTML.includes('btn-debuter')], [false, true]);
  m.run(`openCard(${idx('s1')})`);
  eq('« Annuler » reste offert pour ce dernier arrêt (ma passe terminée à 100 %)', [m.run(`etatComplete(stops[${idx('s1')}]).action`), m.run(`etatComplete(stops[${idx('s1')}]).passeId`)], ['annuler', 'p-luc']);
  // Annuler ce dernier arrêt (le « complété » n'est pas encore parti) : la passe est rouverte, RIEN à envoyer
  await m.run('completeStop()');
  eq('annuler : le geste « compléter » est RETIRÉ de la file (rien à envoyer), la passe est rouverte à l\'écran (1/2, 50 %)', [m.attentes().length, m.run('tours[0].en_cours'), m.run('tours[0].faits'), m.run('maPasse()!==null'), estFait(m, 's1')], [0, true, 1, true, false]);
  eq('message clair', dernier(m), '↩ Arrêt annulé : rien à envoyer');
  eq('aucun envoi au serveur, et pas d\'« annuler » gardé', [m.appels.envois.length, m.cles('file:').length], [0, 0]);
  m.fin();
}

log('\n=== ANNULER UN ARRÊT DÉJÀ ENREGISTRÉ SUR LE SERVEUR, SANS RÉSEAU ===');
{
  const m = await ouvrir({ tours: [tourInit({ faits: 1, pourcentage: 50, arrets_faits: ['s1'], faits_il_y_a: { s1: 60 } })] }); coupe(m);
  m.run(`openCard(${idx('s1')})`);
  eq('le bouton offre « Annuler » (9 min : l\'âge vient du serveur, le temps passe sur le téléphone)', m.el('btn-cmp').textContent.startsWith('↩ Annuler ('), true);
  await m.run('completeStop()');
  eq('un geste « annuler » est gardé (MA passe, l\'arrêt), l\'écran montre l\'arrêt à faire, 0/2', [m.run('gestesEnAttente().map(g=>[g.type,g.args.passeId,g.args.stopId])'), estFait(m, 's1'), m.run('tours[0].faits')], [[['annuler_arret', 'p-luc', 's1']], false, 0]);
  eq('message ⏳', dernier(m).startsWith('↩ Arrêt annulé · ⏳ envoyé au retour du signal'), true);
  eq('rien n\'est envoyé sans signal', m.appels.envois.length, 0);
  eq('la copie du serveur est intacte : s1 toujours fait', m.run('_toursServeur[0].arrets_faits'), ['s1']);
  m.fin();
}

log('\n=== UNE PASSE FERMÉE À 100 % PAR LE SERVEUR : « ANNULER » LA ROUVRE À L\'ÉCRAN, SANS RÉSEAU ===');
{
  const fermee = tourInit({ en_cours: false, faits: 2, pourcentage: 100, arrets_faits: ['s1', 's2'], faits_il_y_a: { s1: 300, s2: 60 }, passes: [], mes_passes_annulables: ['p-luc'] });
  const m = await ouvrir({ tours: [fermee] }); coupe(m);
  eq('avant : passe terminée, ni « Terminer » ni passe à moi', [m.run('tours[0].en_cours'), m.run('maPasse()')], [false, null]);
  m.run(`openCard(${idx('s2')})`);
  eq('« Annuler » est offert (l\'âge vient du serveur : 60 s)', m.run(`etatComplete(stops[${idx('s2')}]).action`), 'annuler');
  await m.run('completeStop()');
  eq('un geste « annuler » est gardé pour MA passe', m.run('gestesEnAttente().map(g=>[g.type,g.args.passeId,g.args.stopId])'), [['annuler_arret', 'p-luc', 's2']]);
  eq('la passe est ROUVERTE à l\'écran : en cours, 1/2 (50 %), c\'est de nouveau ma passe, s2 à faire', [m.run('tours[0].en_cours'), m.run('tours[0].faits'), m.run('tours[0].pourcentage'), m.run('maPasse()!==null'), estFait(m, 's2')], [true, 1, 50, true, false]);
  eq('la copie du serveur reste « terminée »', [m.run('_toursServeur[0].en_cours'), m.run('_toursServeur[0].faits')], [false, 2]);
  m.fin();
}

log('\n=== COMPLÉTÉ, ANNULÉ, PUIS COMPLÉTÉ DE NOUVEAU (le premier geste est déjà en plein envoi) ===');
{
  const m = await ouvrir(); coupe(m);
  const r = await m.completer('s1');
  m.run(`_gesteEnEnvoi='${r.id}'`);   // (le premier « complété » est en train de partir : il ne peut plus être retiré)
  m.run(`openCard(${idx('s1')})`);
  await m.run('completeStop()');
  eq('annuler : le « complété » ne se retire pas, un « annuler » est gardé ; l\'arrêt est à faire', [m.run('gestesEnAttente().map(g=>g.type)'), estFait(m, 's1')], [['completer_arret', 'annuler_arret'], false]);
  await toucher(m, 's1');
  eq('re-compléter : un nouveau « complété » est gardé, dans l\'ordre ; l\'arrêt est fait', [m.run('gestesEnAttente().map(g=>g.type)'), estFait(m, 's1'), m.run('tours[0].faits')], [['completer_arret', 'annuler_arret', 'completer_arret'], true, 1]);
  m.run('_gesteEnEnvoi=null');
  m.fin();
}

log('\n=== LE DÉLAI DE 10 MINUTES SE COMPTE DEPUIS L\'HEURE DU GESTE ===');
{
  const m = await ouvrir(); coupe(m);
  await m.enfiler('completer_arret', { passeId: 'p-luc', stopId: 's1', mode: 'manuel' }, { moment: iso(4) });
  eq('fait il y a 4 minutes : « Annuler » offert (≈ 6 min restantes)', m.run(`etatComplete(stops[${idx('s1')}]).texte`), '↩ Annuler (6 min)');
  await m.enfiler('completer_arret', { passeId: 'p-luc', stopId: 's2', mode: 'manuel' }, { moment: iso(11) });
  eq('fait il y a 11 minutes : « Déjà complété », plus d\'annulation possible', [m.run(`etatComplete(stops[${idx('s2')}]).texte`), m.run(`etatComplete(stops[${idx('s2')}]).actif`)], ['✔ Déjà complété', false]);
  m.fin();
}

log('\n=== LA SUPERPOSITION EST RÉPÉTABLE : AUCUN DOUBLE COMPTE ===');
{
  const m = await ouvrir({ tours: [tourInit({ faits: 1, pourcentage: 50, arrets_faits: ['s1'], faits_il_y_a: { s1: 200 } })] }); coupe(m);
  await m.completer('s1'); await m.completer('s1');   // le serveur a déjà s1 (réponse perdue) et le geste est même gardé deux fois
  eq('s1 déjà fait sur le serveur + 2 gestes « compléter s1 » : toujours 1/2 (50 %), pas 3', [m.run('tours[0].faits'), m.run('tours[0].pourcentage'), m.run('tours[0].arrets_faits')], [1, 50, ['s1']]);
  eq('l\'âge de l\'arrêt reste celui du SERVEUR (200 s), pas celui du geste', m.run('tours[0].faits_il_y_a.s1'), 200);
  m.fin();
}

log('\n=== UN SEUL GESTE MÊME SI ON TOUCHE DEUX FOIS ===');
{
  const m = await ouvrir(); coupe(m);
  m.run(`openCard(${idx('s1')})`);
  await m.run('Promise.all([completeStop(),completeStop()])');
  eq('deux touchers presque en même temps : UN geste gardé, l\'arrêt fait (et pas une boîte « Annuler »)', [m.attentes().length, estFait(m, 's1'), m.appels.confirmations.length], [1, true, 0]);
  m.fin();
}

log('\n=== SI LE TÉLÉPHONE N\'A PAS PU GARDER LE GESTE, L\'ÉCRAN NE DIT JAMAIS « FAIT » ===');
{
  const m = await ouvrir(); coupe(m);
  m.run('magasinEcrire=async()=>false');
  await toucher(m, 's1');
  eq('rien n\'est gardé : l\'arrêt n\'est PAS fait, message d\'erreur, la fiche reste ouverte', [estFait(m, 's1'), m.attentes().length, dernier(m), m.run('activeIdx')], [false, 0, '❌ Le téléphone n’a pas pu garder ce geste. Réessaie.', idx('s1')]);
  m.fin();
  // Pas de vrai stockage (mémoire vive seulement) : le geste est gardé, mais l'employé est prévenu
  const n = await ouvrir(); coupe(n);
  await toucher(n, 's1');
  eq('mémoire vive seulement : « garde l\'application ouverte »', dernier(n).endsWith(' · garde l’application ouverte'), true);
  n.fin();
  const d = await ouvrir(); coupe(d); d.run('magasinDurable=async()=>true');
  await toucher(d, 's1');
  eq('vrai stockage : pas d\'avertissement de ce genre', dernier(d).includes('garde l’application ouverte'), false);
  d.fin();
}

log('\n=== UN GESTE FAIT EN LIGNE DONT LA RÉPONSE SE PERD PASSE PAR LA FILE (mêmes identifiants : aucun doublon) ===');
{
  let casse = true;
  const m = await ouvrir({ monde: { serveur: { completer_arret: (args, n, d) => { if (casse) throw new Error('Failed to fetch'); return appliquerCompleter(args, n, d); } } } });
  await toucher(m, 's1');
  eq('en ligne, mais la demande échoue par le réseau : le geste est GARDÉ, l\'écran montre le résultat, l\'application se sait hors réseau', [m.attentes().length, estFait(m, 's1'), m.run('reseau.enLigne')], [1, true, false]);
  eq('message ⏳ (jamais « ❌ Pas de réseau ou erreur »)', dernier(m).startsWith('✔ Stop complété ! · ⏳'), true);
  const premier = m.appels.envois[0].args;
  const lecturesAvant = nbLecturesTours(m);
  casse = false; m.reseau(true);   // le signal revient : la sonde le voit, la file repart
  vrai('le geste part, et la file se vide', await attendreQue(() => m.attentes().length === 0 && m.run('reseau.enLigne')), JSON.stringify(m.appels.envois.map((x) => x.nom)));
  await attendreQue(() => nbLecturesTours(m) > lecturesAvant);
  const second = m.appels.envois[1]?.args;
  eq('le geste rejoué porte les MÊMES identifiants (passe + arrêt) que la première demande : aucun doublon possible', [second?.p_passe_id, second?.p_stop_id], [premier.p_passe_id, premier.p_stop_id]);
  vrai('… et il porte l\'heure du geste (p_moment)', typeof second?.p_moment === 'string');
  m.run(`openCard(${idx('s1')})`);
  eq('le serveur a le dernier mot : l\'arrêt est fait, plus de ⏳, plus de geste en attente', [estFait(m, 's1'), m.attentes().length, m.el('sc-tour').textContent.includes('⏳'), m.bande().visible], [true, 0, false, false]);
  m.fin();
}
{
  const m = await ouvrir({ monde: { serveur: { completer_arret: () => new Promise(() => {}) } } });   // le serveur ne répond JAMAIS
  m.run('FILE_DELAI_DIRECT_MS=60');
  const t0 = Date.now();
  await toucher(m, 's1');
  vrai('une demande qui ne répond pas est abandonnée après le délai (60 ms ici, 10 s en vrai) : le geste passe à la file', Date.now() - t0 < 1500 && m.attentes().length === 1 && estFait(m, 's1'), `${Date.now() - t0} ms, ${m.attentes().length} geste(s)`);
  m.fin();
}

log('\n=== UN REFUS AU RETOUR DU SIGNAL : LE SERVEUR A LE DERNIER MOT, RIEN N\'EST PERDU EN SILENCE ===');
{
  const m = await ouvrir({ monde: { serveur: { completer_arret: () => ({ data: null, error: { code: 'P0001', message: 'passe_terminee' } }) } } }); coupe(m);
  await toucher(m, 's1');
  eq('hors réseau : l\'arrêt paraît fait', estFait(m, 's1'), true);
  const lecturesAvant = nbLecturesTours(m);
  m.reseau(true);
  vrai('au retour du signal : le geste est refusé et noté dans « non envoyés »', await attendreQue(() => m.refus().length === 1 && m.attentes().length === 0));
  await attendreQue(() => nbLecturesTours(m) > lecturesAvant);
  eq('l\'écran revient à la vérité du serveur : arrêt à faire, 0/2', [estFait(m, 's1'), m.run('tours[0].faits')], [false, 0]);
  eq('la raison est écrite en français', m.refus()[0].raison, 'La passe était déjà terminée.');
  m.fin();
}

log('\n=== AU RETOUR DU SIGNAL, LE SERVEUR A LE DERNIER MOT (cas normal) ===');
{
  const m = await ouvrir({ monde: { serveur: { completer_arret: appliquerCompleter } } }); coupe(m);
  await toucher(m, 's1');
  const lecturesAvant = nbLecturesTours(m);
  m.reseau(true);
  vrai('le geste part', await attendreQue(() => m.attentes().length === 0));
  await attendreQue(() => nbLecturesTours(m) > lecturesAvant);
  m.run(`openCard(${idx('s1')})`);
  eq('un seul envoi ; l\'écran (relu du serveur) : s1 fait, 1/2, aucun ⏳', [m.appels.envois.filter((x) => x.nom === 'completer_arret').length, estFait(m, 's1'), m.run('tours[0].faits'), m.el('sc-tour').textContent.includes('⏳')], [1, true, 1, false]);
  m.fin();
}

log('\n=== UN GESTE EN PLEIN ENVOI NE SE RETIRE PAS ===');
{
  const m = await ouvrir(); coupe(m);
  const r = await m.completer('s1');
  m.run(`_gesteEnEnvoi='${r.id}'`);
  eq('en plein envoi : retirerGesteSiPasParti refuse, le geste reste', [await m.run(`retirerGesteSiPasParti('${r.id}')`), m.attentes().length], [false, 1]);
  m.run('_gesteEnEnvoi=null');
  eq('pas encore parti : il est retiré (la file et l\'écran suivent)', [await m.run(`retirerGesteSiPasParti('${r.id}')`), m.attentes().length, estFait(m, 's1')], [true, 0, false]);
  eq('un identifiant inconnu : rien ne se passe', await m.run('retirerGesteSiPasParti("n-existe-pas")'), false);
  m.fin();
}

log('\n=== LE CODE : UN SEUL ENDROIT POSE LES TOURS ===');
{
  const fichiers = fs.readdirSync(WWW + 'js').filter((f) => f.endsWith('.js'));
  const poses = [];
  for (const f of fichiers) lire('js/' + f).split('\n').forEach((l) => { if (/^\s*(let\s+)?tours\s*=[^=]/.test(l) && !/^\s*\/\//.test(l)) poses.push(f); });
  eq('« tours = … » n\'apparaît qu\'à la déclaration et dans poserTours (jamais une lecture qui contourne la superposition)', poses, ['tours.js', 'tours.js']);
  const arrets = lire('js/arrets.js');
  vrai('completeStop et annulerArret n\'appellent le serveur qu\'avec un délai (avecDelai) et passent par la file en cas de panne', /avecDelai\(db\.rpc\('completer_arret'/.test(arrets) && /avecDelai\(db\.rpc\('annuler_arret'/.test(arrets) && arrets.includes('completerSansReseau') && arrets.includes('annulerSansReseau'));
}

tousLesMondes.forEach((w) => w.fin());
console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
