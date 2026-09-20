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
  if (o.equipes) m.donnees.equipes = o.equipes;
  if (o.equipages) m.donnees.equipage_periodes = o.equipages.map((x) => ({ ...x }));   // (une copie : le faux serveur en modifie le contenu, les autres scénarios ne doivent pas le voir)
  await m.run('loadStops()');
  await attendre(80);   // la copie anticipée de l'écran « Débuter » (arrière-plan, passe.js) doit être finie : sinon sa lecture réussie remettrait l'application « en ligne » APRÈS que le test a coupé le signal
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
  await m.enfiler('completer_arret', { passeId: 'p-luc', stopId: 's1', mode: 'manuel' }, { moment: iso(4.5) });   // (4 min 30 s : évite de tomber pile sur une minute ronde, où l'arrondi peut basculer)
  eq('fait il y a 4 min 30 s : « Annuler » offert (≈ 6 min restantes)', m.run(`etatComplete(stops[${idx('s1')}]).texte`), '↩ Annuler (6 min)');
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

// ══════════════════════════════════════════════════════════════════════
// MORCEAU 2 : DÉBUTER ET TERMINER LA PASSE (avec l'équipage au départ)
// ══════════════════════════════════════════════════════════════════════
const E1E2 = [{ id: 'e1', nom: 'Camion 1' }, { id: 'e2', nom: 'Camion 2' }];
const PASSE_MARC = { passe_id: 'p-marc', equipe_id: 'e2', chauffeur_id: 'u-marc', je_suis_chauffeur: false, je_suis_a_bord: false };
const PASSE_ERIC = { passe_id: 'p-eric', equipe_id: 'e2', chauffeur_id: 'u-eric', je_suis_chauffeur: false, je_suis_a_bord: false };
// Sur l'écran « Débuter » (ouvert avec les copies gardées) : le véhicule 1, et éventuellement d'autres personnes à bord, puis « Démarrer »
const debuterHors = async (m, extras = []) => {
  await m.run('ouvrirDebut()');
  m.run("choisirVehiculeDebut('e1')");
  if (extras.length) m.run('_debut.equipage.extras=' + JSON.stringify(extras));
  await m.run('demarrerPasse()');
};
const passeLocale = (m) => m.run('gestesEnAttente().filter(g=>g.type==="debuter_passe").pop().args.passeId');
const ecranDebutOuvert = (m) => m.el('debut-overlay').classList.contains('open');

log('\n=== DÉBUTER LA PASSE SANS RÉSEAU : LA PASSE EST EN COURS TOUT DE SUITE ===');
{
  const m = await ouvrir({ tours: [], equipes: E1E2 }); coupe(m);
  await debuterHors(m);
  const passeId = passeLocale(m);
  eq('UN geste gardé : débuter, avec la route, la tâche, le véhicule (et l\'identifiant de passe fabriqué par le téléphone)', m.run('gestesEnAttente().map(g=>[g.type,g.args.routeId,g.args.tache,g.args.equipeId,typeof g.args.passeId])'), [['debuter_passe', CH, MEC, 'e1', 'string']]);
  eq('aucun envoi au serveur (hors réseau)', m.appels.envois.length, 0);
  eq('l\'écran de départ se ferme ; la passe est EN COURS à moi ; la carte montre la route de la passe', [ecranDebutOuvert(m), m.run('maPasse()!==null'), m.run('routeActive')], [false, true, CH]);
  eq('un nouveau tour, remis à zéro : total 2 (les arrêts actifs de la route et de la tâche), 0 fait, numéro 1 « à confirmer »', [m.run('tours.length'), m.run('tours[0].total'), m.run('tours[0].faits'), m.run('tours[0].numero'), m.run('tours[0].numero_a_confirmer'), m.run('tours[0].passes[0].passe_id') === passeId], [1, 2, 0, 1, true, true]);
  const b = m.el('passe-bandeau').innerHTML;
  eq('le bandeau : « Passe n° 1 (à confirmer) », 0 %, le bouton « Terminer », plus « Débuter »', [b.includes('Passe n° 1 (à confirmer)'), b.includes('0 %'), b.includes('btn-terminer'), b.includes('btn-debuter')], [true, true, true, false]);
  eq('le message : passe débutée + ⏳', m.appels.toasts.some((t) => t.startsWith('▶ Passe n° 1 (à confirmer) débutée · ⏳ envoyé au retour du signal')), true);
  eq('l\'équipage à bord : moi, chauffeur', m.run('equipages[maPasse().passe.passe_id].map(x=>[x.nom,x.role])'), [['Luc', 'chauffeur']]);
  eq('la mémoire du téléphone garde le véhicule et la route (pour la fois suivante)', [m.run('lireMemo(CLE_VEHICULE)'), m.run('lireMemo(CLE_ROUTE_DEBUT)')], ['e1', CH]);
  eq('la copie du serveur est intacte : aucun tour, aucun équipage de cette passe', [m.run('_toursServeur.length'), m.run(`_equipagesServeur['${passeId}']===undefined`)], [0, true]);
  eq('la bande : « ⏳ 1 geste en attente »', m.bande().texte.includes('⏳ 1 geste en attente'), true);
  // Et on peut travailler sur cette passe tout de suite : compléter un arrêt (la passe locale est BIEN celle du geste)
  await toucher(m, 's1');
  eq('compléter un arrêt de cette passe : 1/2 ; les gestes sont gardés dans l\'ordre (débuter, puis compléter avec la MÊME passe)', [m.run('tours[0].faits'), m.run('gestesEnAttente().map(g=>g.type)'), m.run('gestesEnAttente()[1].args.passeId') === passeId], [1, ['debuter_passe', 'completer_arret'], true]);
  m.fin();
}

log('\n=== ON REJOINT LE TOUR D\'UN AUTRE CAMION (les arrêts déjà faits restent faits) ===');
{
  const tourMarc = tourInit({ numero: 4, faits: 1, pourcentage: 50, arrets_faits: ['s1'], faits_il_y_a: { s1: 100 }, passes: [{ ...PASSE_MARC }] });
  const m = await ouvrir({ tours: [tourMarc], equipes: E1E2, equipages: [{ passe_id: 'p-marc', role: 'chauffeur', utilisateur_id: 'u-marc', utilisateurs: { nom: 'Marc' } }] }); coupe(m);
  await debuterHors(m);
  eq('le tour de Marc est rejoint : 2 camions, numéro 4 (le vrai : pas « à confirmer »), s1 toujours fait (1/2)', [m.run('tours.length'), m.run('tours[0].passes.length'), m.run('tours[0].numero'), m.run('tours[0].numero_a_confirmer'), m.run('tours[0].faits'), estFait(m, 's1')], [1, 2, 4, undefined, 1, true]);
  eq('le message : « rejoint la passe n° 4 » + ⏳', m.appels.toasts.some((t) => t.startsWith('🤝 Tu as rejoint la passe n° 4 · ⏳ envoyé au retour du signal')), true);
  eq('le camion de Marc garde son équipage ; le mien est à moi', [m.run("equipages['p-marc'].map(x=>x.nom)"), m.run('equipages[maPasse().passe.passe_id].map(x=>x.nom)')], [['Marc'], ['Luc']]);
  m.fin();
}

log('\n=== UN TOUR TERMINÉ NE SE REJOINT PAS : DÉBUTER OUVRE UN NOUVEAU TOUR, REMIS À ZÉRO ===');
{
  const termine = tourInit({ numero: 3, en_cours: false, faits: 2, pourcentage: 100, arrets_faits: ['s1', 's2'], faits_il_y_a: { s1: 5000, s2: 4000 }, passes: [] });
  const m = await ouvrir({ tours: [termine], equipes: E1E2 }); coupe(m);
  await debuterHors(m);
  eq('un seul tour pour cette route et cette tâche : le nouveau, numéro 4 « à confirmer », 0/2, en cours', [m.run('tours.length'), m.run('tours[0].numero'), m.run('tours[0].numero_a_confirmer'), m.run('tours[0].faits'), m.run('tours[0].en_cours'), estFait(m, 's1')], [1, 4, true, 0, true, false]);
  eq('la copie du serveur garde le tour terminé (3, 2/2)', [m.run('_toursServeur[0].numero'), m.run('_toursServeur[0].faits')], [3, 2]);
  m.fin();
}

log('\n=== LE VÉHICULE ÉTAIT À UN AUTRE : SA PASSE EST TERMINÉE (le serveur fait pareil), ET IL Y A UNE QUESTION AVANT ===');
{
  const tourMarc = tourInit({ numero: 2, faits: 1, pourcentage: 50, arrets_faits: ['s1'], faits_il_y_a: { s1: 100 }, passes: [{ ...PASSE_MARC, equipe_id: 'e1' }] });
  const m = await ouvrir({ tours: [tourMarc], equipes: E1E2, equipages: [{ passe_id: 'p-marc', role: 'chauffeur', utilisateur_id: 'u-marc', utilisateurs: { nom: 'Marc' } }] }); coupe(m);
  await debuterHors(m);
  eq('la question « Remplacer la passe de Marc ? » est posée (avec la copie du téléphone)', m.appels.confirmations.map((c) => c[0]), ['Remplacer la passe de Marc ?']);
  eq('la passe de Marc n\'est plus en cours à l\'écran ; un nouveau tour (numéro 3 à confirmer) est le mien', [m.run("tours.some(t=>t.passes.some(p=>p.passe_id==='p-marc'))"), m.run('tours.length'), m.run('tours[0].numero'), m.run('tours[0].numero_a_confirmer'), m.run('maPasse()!==null')], [false, 1, 3, true, true]);
  eq('l\'équipage de la passe remplacée n\'est plus affiché', m.run("equipages['p-marc']===undefined"), true);
  m.fin();
}

log('\n=== L\'ÉQUIPAGE AU DÉPART : GARDÉ AVEC LE DÉPART, « FORCER » (décision A), TRANSFÉRÉ SI À BORD AILLEURS ===');
{
  const tourEric = tourInit({ numero: 2, passes: [{ ...PASSE_ERIC }] });
  const m = await ouvrir({ tours: [tourEric], equipes: E1E2, equipages: [
    { passe_id: 'p-eric', role: 'chauffeur', utilisateur_id: 'u-eric', utilisateurs: { nom: 'Eric' } }, { passe_id: 'p-eric', role: 'passager', utilisateur_id: 'u-marc', utilisateurs: { nom: 'Marc' } }] }); coupe(m);
  await debuterHors(m, [{ utilisateur_id: 'u-marc', nom: 'Marc', cle: 'cle-marc', forcer: false }]);
  eq('le geste gardé contient l\'équipier avec sa clé, son nom et « forcer » (même si l\'écran ne l\'avait pas demandé : un conflit s\'applique tout seul)', m.run('gestesEnAttente()[0].args.equipage'), [{ utilisateur_id: 'u-marc', cle_client: 'cle-marc', forcer: true, nom: 'Marc' }]);
  eq('à l\'écran : Marc est à bord de MON camion (Luc chauffeur d\'abord), et il a QUITTÉ le camion d\'Eric', [m.run('equipages[maPasse().passe.passe_id].map(x=>[x.nom,x.role])'), m.run("equipages['p-eric'].map(x=>x.nom)")], [[['Luc', 'chauffeur'], ['Marc', 'passager']], ['Eric']]);
  eq('le message compte l\'équipier : « 1 à bord » + ⏳', m.appels.toasts.some((t) => t.startsWith('🤝 Tu as rejoint la passe n° 2 · 1 à bord · ⏳')), true);
  eq('la copie du serveur est intacte : Marc est toujours dans le camion d\'Eric', m.run("_equipagesServeur['p-eric'].map(x=>x.nom)"), ['Eric', 'Marc']);
  m.fin();
}

log('\n=== TERMINER LA PASSE SANS RÉSEAU : ELLE SE FERME TOUT DE SUITE À L\'ÉCRAN ===');
{
  const m = await ouvrir(); coupe(m);
  await m.run('terminerPasse()');
  eq('UN geste gardé : terminer MA passe', m.run('gestesEnAttente().map(g=>[g.type,g.args.passeId])'), [['terminer_passe', 'p-luc']]);
  eq('la passe n\'est plus à moi ; le tour reste affiché, TERMINÉ (0/2), sans camion', [m.run('maPasse()'), m.run('tours[0].en_cours'), m.run('tours[0].passes.length'), m.run('tours[0].faits')], [null, false, 0, 0]);
  eq('l\'équipage de cette passe n\'est plus à bord ; la copie du serveur, elle, le garde', [m.run("equipages['p-luc']===undefined"), m.run("_equipagesServeur['p-luc'].length")], [true, 1]);
  const b = m.el('passe-bandeau').innerHTML;
  eq('le bandeau offre « Débuter » et plus « Terminer »', [b.includes('btn-debuter'), b.includes('btn-terminer')], [true, false]);
  eq('le message + ⏳ ; PAS de résumé de fin de passe (je l\'ai terminée moi-même)', [m.appels.toasts.some((t) => t.startsWith('■ Passe n° 1 terminée : 0/2 (0 %) · ⏳ envoyé au retour du signal')), m.el('resume-overlay').classList.contains('open')], [true, false]);
  eq('aucun envoi sans signal ; la bande le dit', [m.appels.envois.length, m.bande().texte.includes('⏳ 1 geste en attente')], [0, true]);
  await m.run('terminerPasse()');
  eq('un 2e toucher ne garde rien de plus (plus de passe)', [m.attentes().length, m.appels.toasts[m.appels.toasts.length - 1]], [1, 'Tu n’as pas de passe en cours.']);
  eq('la copie du serveur est intacte : ma passe y est encore', [m.run('_toursServeur[0].en_cours'), m.run('_toursServeur[0].passes.length')], [true, 1]);
  m.fin();
}
{
  // Un autre camion fait le même tour : terminer ne ferme QUE mon camion
  const tourDeux = tourInit({ passes: [{ ...PASSE_LUC }, { ...PASSE_MARC }] });
  const m = await ouvrir({ tours: [tourDeux], equipes: E1E2 }); coupe(m);
  await m.run('terminerPasse()');
  eq('le tour continue pour Camion 2 (la question le disait) : en cours, une seule passe, celle de Marc', [m.appels.confirmations[0][1].includes('Le tour continue pour Camion 2'), m.run('tours[0].en_cours'), m.run('tours[0].passes.map(p=>p.passe_id)'), m.run('maPasse()')], [true, true, ['p-marc'], null]);
  m.fin();
}

log('\n=== DÉBUTER PUIS TERMINER, TOUT SANS RÉSEAU : LES DEUX GESTES SONT GARDÉS, DANS L\'ORDRE ===');
{
  const m = await ouvrir({ tours: [], equipes: E1E2 }); coupe(m);
  await debuterHors(m, [{ utilisateur_id: 'u-marc', nom: 'Marc', cle: 'cle-marc', forcer: false }]);
  const passeId = passeLocale(m);
  await m.run('terminerPasse()');
  eq('deux gestes dans l\'ordre, sur la MÊME passe', [m.run('gestesEnAttente().map(g=>g.type)'), m.run('gestesEnAttente()[1].args.passeId') === passeId], [['debuter_passe', 'terminer_passe'], true]);
  eq('à l\'écran : plus de passe à moi, le tour est terminé, personne à bord de cette passe', [m.run('maPasse()'), m.run('tours[0].en_cours'), m.run(`equipages['${passeId}']===undefined`)], [null, false, true]);
  m.fin();
}

log('\n=== UN DÉPART FAIT EN LIGNE DONT LA RÉPONSE SE PERD PASSE PAR LA FILE, PUIS LE SERVEUR A LE DERNIER MOT ===');
{
  let casse = true;
  const serveur = { debuter_passe: (args, n, d) => {
    if (casse) throw new Error('Failed to fetch');
    if (!d.tours.some((t) => t.passes.some((p) => p.passe_id === args.p_id))) d.tours = [tourInit({ numero: 7, passes: [{ ...PASSE_LUC, passe_id: args.p_id }] })];
    return { data: { statut: 'debutee', numero: 7, equipage: [] }, error: null };
  } };
  const m = await ouvrir({ tours: [], equipes: E1E2, monde: { serveur } });
  await debuterHors(m);
  const passeId = passeLocale(m);
  eq('la demande échoue par le réseau : le départ est GARDÉ, la passe est en cours à l\'écran (numéro à confirmer), l\'application se sait hors réseau', [m.attentes().length, m.run('maPasse()!==null'), m.run('tours[0].numero_a_confirmer'), m.run('reseau.enLigne')], [1, true, true, false]);
  const premier = m.appels.envois[0].args;
  const lecturesAvant = nbLecturesTours(m);
  casse = false; m.reseau(true);
  vrai('au retour du signal : le départ part et la file se vide', await attendreQue(() => m.attentes().length === 0 && m.run('reseau.enLigne')));
  await attendreQue(() => nbLecturesTours(m) > lecturesAvant);
  const second = m.appels.envois[1]?.args;
  eq('le départ rejoué porte le MÊME identifiant de passe, la même route, le même véhicule (le serveur ne crée jamais 2 passes)', [second?.p_id, second?.p_route_id, second?.p_equipe_id, premier.p_id], [passeId, CH, 'e1', passeId]);
  vrai('… et l\'heure du départ (p_moment)', typeof second?.p_moment === 'string');
  eq('le serveur a le dernier mot : le VRAI numéro (7), plus « à confirmer », ma passe est encore en cours', [m.run('tours[0].numero'), m.run('tours[0].numero_a_confirmer'), m.run('maPasse()!==null'), m.el('passe-bandeau').innerHTML.includes('Passe n° 7')], [7, undefined, true, true]);
  m.fin();
}

log('\n=== UN « TERMINER » FAIT EN LIGNE DONT LA RÉPONSE SE PERD PASSE PAR LA FILE (même passe, aucun doublon) ===');
{
  let casse = true;
  const serveur = { terminer_passe: (args, n, d) => {
    if (casse) throw new Error('Failed to fetch');
    d.tours[0].passes = []; d.tours[0].en_cours = false;
    return { data: { statut: 'terminee', faits: 0, total: 2, pourcentage: 0 }, error: null };
  } };
  const m = await ouvrir({ monde: { serveur } });
  await m.run('terminerPasse()');
  eq('la demande échoue par le réseau : le geste est GARDÉ, la passe est terminée à l\'écran, l\'application se sait hors réseau', [m.attentes().length, m.run('maPasse()'), m.run('reseau.enLigne')], [1, null, false]);
  eq('message ⏳ (jamais « ❌ Pas de réseau ou erreur »)', m.appels.toasts[m.appels.toasts.length - 1].startsWith('■ Passe n° 1 terminée : 0/2 (0 %) · ⏳'), true);
  const premier = m.appels.envois[0].args;
  const lecturesAvant = nbLecturesTours(m);
  casse = false; m.reseau(true);
  vrai('au retour du signal : le geste part et la file se vide', await attendreQue(() => m.attentes().length === 0 && m.run('reseau.enLigne')));
  await attendreQue(() => nbLecturesTours(m) > lecturesAvant);
  const second = m.appels.envois[1]?.args;
  eq('le geste rejoué porte la MÊME passe et l\'heure de la fin (p_moment)', [second?.p_passe_id, premier.p_passe_id, typeof second?.p_moment], ['p-luc', 'p-luc', 'string']);
  eq('le serveur a le dernier mot : plus de passe à moi, le tour est terminé, plus de ⏳', [m.run('maPasse()'), m.run('tours[0].en_cours'), m.bande().visible], [null, false, false]);
  m.fin();
}

log('\n=== SI LE SERVEUR REFUSE LE DÉPART AU RETOUR DU SIGNAL : NOTÉ, ET L\'ÉCRAN REVIENT À LA VÉRITÉ ===');
{
  const m = await ouvrir({ tours: [], equipes: E1E2, monde: { serveur: { debuter_passe: () => ({ data: null, error: { code: 'P0001', message: 'route_inactive' } }) } } }); coupe(m);
  await debuterHors(m);
  eq('hors réseau : la passe paraît en cours', m.run('maPasse()!==null'), true);
  const lecturesAvant = nbLecturesTours(m);
  m.reseau(true);
  vrai('le départ est refusé et noté dans « non envoyés »', await attendreQue(() => m.refus().length === 1 && m.attentes().length === 0));
  await attendreQue(() => nbLecturesTours(m) > lecturesAvant);
  eq('la raison est écrite en français ; l\'écran n\'a plus de passe (le serveur n\'en a pas)', [m.refus()[0].raison, m.run('maPasse()'), m.run('tours.length')], ['Cette route n’est plus active.', null, 0]);
  m.fin();
}

log('\n=== SI LE TÉLÉPHONE NE PEUT RIEN GARDER, LE DÉPART N\'EST PAS « DÉBUTÉ » ET L\'ÉCRAN RESTE OUVERT ===');
{
  const m = await ouvrir({ tours: [], equipes: E1E2 }); coupe(m);
  m.run('magasinEcrire=async()=>false');
  await debuterHors(m);
  eq('rien n\'est gardé : pas de passe, message d\'erreur, l\'écran de départ reste ouvert et « Démarrer » redevient utilisable', [m.run('maPasse()'), m.attentes().length, m.appels.toasts[m.appels.toasts.length - 1], ecranDebutOuvert(m), m.el('btn-demarrer').disabled], [null, 0, '❌ Le téléphone n’a pas pu garder ce geste. Réessaie.', true, false]);
  m.fin();
  const m2 = await ouvrir({ tours: [], equipes: E1E2 }); coupe(m2);
  await m2.run('terminerPasse()');   // (aucune passe : rien à terminer)
  m2.fin();
  const m3 = await ouvrir(); coupe(m3);
  m3.run('magasinEcrire=async()=>false');
  await m3.run('terminerPasse()');
  eq('terminer sans pouvoir garder le geste : la passe reste EN COURS à l\'écran (jamais « terminée »), le bouton redevient utilisable', [m3.run('maPasse()!==null'), m3.appels.toasts[m3.appels.toasts.length - 1], m3.el('passe-bandeau').innerHTML.includes('btn-terminer') && !m3.el('passe-bandeau').innerHTML.includes('disabled')], [true, '❌ Le téléphone n’a pas pu garder ce geste. Réessaie.', true]);
  m3.fin();
}

log('\n=== DOUBLE TOUCHER : UN SEUL DÉPART, UNE SEULE FIN ===');
{
  const m = await ouvrir({ tours: [], equipes: E1E2 }); coupe(m);
  await m.run('ouvrirDebut()'); m.run("choisirVehiculeDebut('e1')");
  await m.run('Promise.all([demarrerPasse(),demarrerPasse()])');
  eq('deux touchers sur « Démarrer » : UN seul geste', m.run('gestesEnAttente().filter(g=>g.type==="debuter_passe").length'), 1);
  await m.run('Promise.all([terminerPasse(),terminerPasse()])');
  eq('deux touchers sur « Terminer » : UN seul geste', m.run('gestesEnAttente().filter(g=>g.type==="terminer_passe").length'), 1);
  m.fin();
}

log('\n=== LES SUPERPOSITIONS SONT RÉPÉTABLES POUR LA PASSE AUSSI (le serveur a déjà le geste : aucun doublon) ===');
{
  const dejaLa = tourInit({ numero: 5, passes: [{ ...PASSE_LUC, passe_id: 'p-deja' }] });
  const m = await ouvrir({ tours: [dejaLa], equipes: E1E2 }); coupe(m);
  await m.enfiler('debuter_passe', { passeId: 'p-deja', routeId: CH, equipeId: 'e1', tache: MEC, equipage: [] });
  await m.enfiler('debuter_passe', { passeId: 'p-deja', routeId: CH, equipeId: 'e1', tache: MEC, equipage: [] });
  eq('le serveur a déjà cette passe (et le geste est même gardé 2 fois) : UN tour, UNE passe, le numéro du serveur (5)', [m.run('tours.length'), m.run('tours[0].passes.length'), m.run('tours[0].numero'), m.run('tours[0].numero_a_confirmer')], [1, 1, 5, undefined]);
  await m.enfiler('terminer_passe', { passeId: 'p-inconnue' });
  eq('terminer une passe qui n\'est plus en cours : rien ne change à l\'écran', [m.run('tours.length'), m.run('tours[0].passes.length')], [1, 1]);
  m.fin();
}

log('\n=== DE QUOI DÉBUTER SANS RÉSEAU EST GARDÉ DÈS LE CHARGEMENT (sans ouvrir l\'écran « Débuter »), UNE FOIS PAR 10 MINUTES ===');
{
  const m = await ouvrir({ equipes: E1E2 });
  const cles = m.cles('cache:').map((k) => k.split(':').pop());
  eq('après le chargement en ligne : véhicules actifs, employés et équipage précédent sont gardés', ['equipesActives', 'employes', 'equipagePrecedent'].map((n) => cles.includes(n)), [true, true, true]);
  eq('les véhicules actifs gardés sont les bons', m.memoire()['cache:u-luc:equipesActives'].data.map((e) => e.nom), ['Camion 1', 'Camion 2']);
  const lectures = () => m.appels.lectures.filter((t) => t === 'equipes').length;
  const avant = lectures();
  await m.run('loadStops()'); await attendre(80);
  const apres1 = lectures();
  eq('un 2e chargement dans les 10 minutes ne relit pas la copie anticipée (une seule lecture des véhicules en plus : celle du chargement lui-même)', apres1 - avant, 1);
  m.run('_prechargeLe = Date.now() - 11 * 60000');
  await m.run('loadStops()'); await attendre(80);
  eq('après 10 minutes : elle est relue', lectures() - apres1, 2);
  m.run('_prechargePour = "u-quelquun-d-autre"; _prechargeLe = Date.now()');
  const apres2 = lectures();
  await m.run('loadStops()'); await attendre(80);
  eq('un AUTRE employé sur le même téléphone : relue tout de suite (ses propres copies)', lectures() - apres2, 2);
  coupe(m);
  m.run('_prechargeLe = 0');
  const hors = lectures();
  await m.run('prechargerPourDebuter()');
  eq('sans signal : aucune tentative', lectures() - hors, 0);
  m.fin();
  const seul = await ouvrir({ tours: [], equipes: E1E2 }); coupe(seul);
  await seul.run('ouvrirDebut()');
  eq('l\'écran « Débuter » s\'ouvre sans réseau avec ces copies, alors qu\'il n\'a JAMAIS été ouvert en ligne', [ecranDebutOuvert(seul), seul.run('_debut.equipes.map(e=>e.nom)')], [true, ['Camion 1', 'Camion 2']]);
  seul.fin();
}

// ══════════════════════════════════════════════════════════════════════
// MORCEAU 3 : L'ÉQUIPAGE PENDANT LA PASSE (ajouter / retirer quelqu'un)
// ══════════════════════════════════════════════════════════════════════
// Deux camions : le mien (Luc, p-luc) et celui d'Eric (p-eric, avec Marc à bord)
const EQ_DEUX_CAMIONS = [
  { passe_id: 'p-luc', role: 'chauffeur', utilisateur_id: 'u-luc', utilisateurs: { nom: 'Luc' } },
  { passe_id: 'p-eric', role: 'chauffeur', utilisateur_id: 'u-eric', utilisateurs: { nom: 'Eric' } },
  { passe_id: 'p-eric', role: 'passager', utilisateur_id: 'u-marc', utilisateurs: { nom: 'Marc' } }];
const EQ_AVEC_NINA = [...EQ_DEUX_CAMIONS, { passe_id: 'p-luc', role: 'passager', utilisateur_id: 'u-nina', utilisateurs: { nom: 'Nina' } }];
const toursDeux = () => [tourInit({ passes: [{ ...PASSE_LUC }, { ...PASSE_ERIC }] })];
const nomsA = (m, passe) => m.run(`(equipages['${passe}']||[]).map(x=>x.nom)`);
const ajouterEq = (m, id, nom) => m.run(`ajouterPersonneAuVehicule('p-luc',{utilisateur_id:'${id}',nom:'${nom}'})`);
const retirerEq = (m, id) => m.run(`retirerDuVehicule('${id}')`);
const panneau = (m) => m.el('equipage-body').children.map((c) => c.children[0].textContent);
const ouvrirDeux = async (o = {}) => { const m = await ouvrir({ tours: toursDeux(), equipes: E1E2, equipages: o.equipages ?? EQ_DEUX_CAMIONS, monde: o.monde }); return m; };

log('\n=== AJOUTER QUELQU\'UN SANS RÉSEAU : IL EST À BORD TOUT DE SUITE (transfert si à bord ailleurs) ===');
{
  const m = await ouvrirDeux(); coupe(m);
  await m.run('ouvrirEquipage()');
  await ajouterEq(m, 'u-marc', 'Marc');
  eq('la question nomme la personne (la copie du téléphone sait où est Marc)', m.appels.confirmations.map((c) => c[0]), ['Faire monter Marc ?']);
  eq('UN geste gardé : ajouter Marc à MA passe, avec une clé, son nom', m.run('gestesEnAttente().map(g=>[g.type,g.args.passeId,g.args.userId,g.args.nom,typeof g.args.cle])'), [['equipage_ajouter', 'p-luc', 'u-marc', 'Marc', 'string']]);
  eq('à l\'écran : Marc est à bord de MON camion et a QUITTÉ celui d\'Eric', [nomsA(m, 'p-luc'), nomsA(m, 'p-eric')], [['Luc', 'Marc'], ['Eric']]);
  eq('le panneau (ouvert) le montre, et le bandeau dit « 2 à bord »', [panneau(m), m.el('passe-bandeau').innerHTML.includes('👤 Équipage · 2 à bord')], [['Luc (toi)', 'Marc'], true]);
  eq('le message dit d\'où il vient + ⏳', dernier(m).startsWith('👤 Marc transféré depuis Camion 2 · ⏳ envoyé au retour du signal'), true);
  eq('la copie du serveur est intacte (Marc est toujours dans le camion d\'Eric) ; rien n\'est envoyé', [m.run("_equipagesServeur['p-eric'].map(x=>x.nom)"), m.appels.envois.length], [['Eric', 'Marc'], 0]);
  eq('la bande : « ⏳ 1 geste en attente »', m.bande().texte.includes('⏳ 1 geste en attente'), true);
  m.fin();
}
{
  const m = await ouvrirDeux(); coupe(m);
  await ajouterEq(m, 'u-nina', 'Nina');
  eq('quelqu\'un de libre : aucune question, à bord tout de suite, message ⏳', [m.appels.confirmations.length, nomsA(m, 'p-luc'), dernier(m).startsWith('👤 Nina est à bord · ⏳ envoyé au retour du signal')], [0, ['Luc', 'Nina'], true]);
  m.fin();
}
{
  const m = await ouvrirDeux(); coupe(m);
  await ajouterEq(m, 'u-eric', 'Eric');
  eq('Eric CONDUIT un autre camion : message clair, rien n\'est gardé, rien ne change (personne n\'est forcé)', [dernier(m), m.attentes().length, nomsA(m, 'p-luc'), m.appels.confirmations.length], ['⚠ Eric conduit déjà « Camion 2 »', 0, ['Luc'], 0]);
  m.fin();
}
{
  const m = await ouvrirDeux(); coupe(m);
  m.run('confirmer = async (...a) => { __confirmations.push(a); return false; }');
  await ajouterEq(m, 'u-marc', 'Marc');
  eq('« Non » à la question : rien n\'est gardé, Marc reste dans le camion d\'Eric', [m.attentes().length, nomsA(m, 'p-luc'), nomsA(m, 'p-eric'), m.appels.toasts.length], [0, ['Luc'], ['Eric', 'Marc'], 0]);
  m.fin();
}

log('\n=== RETIRER QUELQU\'UN SANS RÉSEAU : IL DESCEND TOUT DE SUITE ===');
{
  const m = await ouvrirDeux({ equipages: EQ_AVEC_NINA }); coupe(m);
  await m.run('ouvrirEquipage()');
  eq('avant : Nina est à bord de mon camion', panneau(m), ['Luc (toi)', 'Nina']);
  await retirerEq(m, 'u-nina');
  eq('la question nomme la personne et le camion', m.appels.confirmations.map((c) => [c[0], c[1]]), [['Retirer Nina ?', 'Nina descend de « Camion 1 » maintenant.']]);
  eq('UN geste gardé : retirer Nina de MA passe, avec une clé', m.run('gestesEnAttente().map(g=>[g.type,g.args.passeId,g.args.userId,g.args.nom,typeof g.args.cle])'), [['equipage_retirer', 'p-luc', 'u-nina', 'Nina', 'string']]);
  eq('Nina n\'est plus à bord à l\'écran ; le panneau et le bandeau suivent (« 1 à bord »)', [nomsA(m, 'p-luc'), panneau(m), m.el('passe-bandeau').innerHTML.includes('👤 Équipage · 1 à bord')], [['Luc'], ['Luc (toi)'], true]);
  eq('message ⏳', dernier(m).startsWith('👤 Nina est descendu · ⏳ envoyé au retour du signal'), true);
  eq('la copie du serveur est intacte (Nina y est encore) ; rien n\'est envoyé', [m.run("_equipagesServeur['p-luc'].map(x=>x.nom)"), m.appels.envois.length], [['Luc', 'Nina'], 0]);
  m.fin();
}

log('\n=== RETIRER QUELQU\'UN AJOUTÉ SANS RÉSEAU ET PAS ENCORE PARTI : L\'AJOUT EST RETIRÉ DE LA FILE ===');
{
  const m = await ouvrirDeux(); coupe(m);
  await ajouterEq(m, 'u-nina', 'Nina');
  await retirerEq(m, 'u-nina');
  eq('ajouter puis retirer : plus rien dans la file, rien à envoyer, Nina n\'est plus à bord', [m.attentes().length, m.cles('file:').length, nomsA(m, 'p-luc'), dernier(m)], [0, 0, ['Luc'], '↩ Ajout de Nina annulé : rien à envoyer']);
  m.fin();
}
{
  const m = await ouvrirDeux(); coupe(m);
  await ajouterEq(m, 'u-marc', 'Marc');
  await retirerEq(m, 'u-marc');
  eq('un TRANSFERT annulé : Marc est de nouveau dans le camion d\'Eric (comme le ferait le serveur), plus rien dans la file', [m.attentes().length, nomsA(m, 'p-luc'), nomsA(m, 'p-eric')], [0, ['Luc'], ['Eric', 'Marc']]);
  m.fin();
}
{
  const m = await ouvrirDeux(); coupe(m);
  const r = await m.enfiler('equipage_ajouter', { cle: 'c-nina', passeId: 'p-luc', userId: 'u-nina', nom: 'Nina' });
  m.run(`_gesteEnEnvoi='${r.id}'`);   // (l'ajout est en train de partir : il ne peut plus être retiré)
  await retirerEq(m, 'u-nina');
  eq('l\'ajout est en plein envoi : un « retirer » est gardé à la suite (dans l\'ordre) ; Nina n\'est plus à bord à l\'écran', [m.run('gestesEnAttente().map(g=>g.type)'), nomsA(m, 'p-luc')], [['equipage_ajouter', 'equipage_retirer'], ['Luc']]);
  m.run('_gesteEnEnvoi=null');
  m.fin();
}
{
  // Une personne choisie au départ (départ gardé, pas encore parti) puis retirée : le retrait est gardé APRÈS le départ
  const m = await ouvrir({ tours: [], equipes: E1E2 }); coupe(m);
  await debuterHors(m, [{ utilisateur_id: 'u-marc', nom: 'Marc', cle: 'cle-marc', forcer: false }]);
  const passeId = passeLocale(m);
  await retirerEq(m, 'u-marc');
  eq('Marc était au départ : le retrait est gardé après le départ ; à l\'écran il est descendu', [m.run('gestesEnAttente().map(g=>g.type)'), m.run('gestesEnAttente()[1].args.passeId') === passeId, nomsA(m, passeId)], [['debuter_passe', 'equipage_retirer'], true, ['Luc']]);
  m.fin();
}

log('\n=== UN AJOUT OU UN RETRAIT FAIT EN LIGNE DONT LA RÉPONSE SE PERD PASSE PAR LA FILE (même clé : aucun doublon) ===');
{
  let casse = true;
  const serveur = { equipage_ajouter: (args, n, d) => {
    if (casse) throw new Error('Failed to fetch');
    if (!d.equipage_periodes.some((p) => p.passe_id === args.p_passe_id && p.utilisateur_id === args.p_utilisateur_id)) d.equipage_periodes.push({ passe_id: args.p_passe_id, role: 'passager', utilisateur_id: args.p_utilisateur_id, utilisateurs: { nom: 'Nina' } });
    return { data: { statut: 'ajoute' }, error: null };
  } };
  const m = await ouvrirDeux({ monde: { serveur } });
  await ajouterEq(m, 'u-nina', 'Nina');
  eq('la demande échoue par le réseau : le geste est GARDÉ, Nina est à bord à l\'écran, l\'application se sait hors réseau', [m.attentes().length, nomsA(m, 'p-luc'), m.run('reseau.enLigne')], [1, ['Luc', 'Nina'], false]);
  eq('message ⏳ (jamais « ❌ Pas de réseau ou erreur »)', dernier(m).startsWith('👤 Nina est à bord · ⏳'), true);
  const premiere = m.appels.envois[0].args;
  casse = false; m.reseau(true);
  vrai('au retour du signal : le geste part et la file se vide', await attendreQue(() => m.attentes().length === 0 && m.run('reseau.enLigne')));
  await attendreQue(() => m.appels.lectures.filter((x) => x === 'equipage_periodes').length >= 3);
  const seconde = m.appels.envois[1]?.args;
  eq('le geste rejoué porte la MÊME clé, la même passe et la même personne que la première demande', [seconde?.p_cle_client, seconde?.p_passe_id, seconde?.p_utilisateur_id], [premiere.p_cle_client, 'p-luc', 'u-nina']);
  eq('… avec « forcer » (décision A) et l\'heure du geste (p_moment)', [seconde?.p_forcer, typeof seconde?.p_moment], [true, 'string']);
  eq('le serveur a le dernier mot : Nina est à bord (une seule fois), plus de ⏳', [nomsA(m, 'p-luc'), m.bande().visible], [['Luc', 'Nina'], false]);
  m.fin();
}
{
  let casse = true;
  const serveur = { equipage_retirer: (args, n, d) => {
    if (casse) throw new Error('Failed to fetch');
    d.equipage_periodes = d.equipage_periodes.filter((p) => !(p.passe_id === args.p_passe_id && p.utilisateur_id === args.p_utilisateur_id));
    return { data: { statut: 'retire' }, error: null };
  } };
  const m = await ouvrirDeux({ equipages: EQ_AVEC_NINA, monde: { serveur } });
  await retirerEq(m, 'u-nina');
  eq('la demande échoue par le réseau : le geste est GARDÉ, Nina est descendue à l\'écran', [m.attentes().length, nomsA(m, 'p-luc'), m.run('reseau.enLigne'), dernier(m).startsWith('👤 Nina est descendu · ⏳')], [1, ['Luc'], false, true]);
  const premiere = m.appels.envois[0].args;
  casse = false; m.reseau(true);
  vrai('au retour du signal : le geste part et la file se vide', await attendreQue(() => m.attentes().length === 0 && m.run('reseau.enLigne')));
  await attendreQue(() => m.appels.lectures.filter((x) => x === 'equipage_periodes').length >= 3);
  eq('le geste rejoué porte la MÊME clé ; le serveur a le dernier mot : Nina n\'est plus à bord', [m.appels.envois[1]?.args.p_cle_client, premiere.p_cle_client, nomsA(m, 'p-luc')], [premiere.p_cle_client, premiere.p_cle_client, ['Luc']]);
  m.fin();
}
{
  const m = await ouvrirDeux({ monde: { serveur: { equipage_ajouter: () => new Promise(() => {}) } } });   // le serveur ne répond JAMAIS
  m.run('FILE_DELAI_DIRECT_MS=60');
  const t0 = Date.now();
  await ajouterEq(m, 'u-nina', 'Nina');
  vrai('une demande qui ne répond pas est abandonnée après le délai : le geste passe à la file', Date.now() - t0 < 1500 && m.attentes().length === 1 && nomsA(m, 'p-luc').includes('Nina'), `${Date.now() - t0} ms`);
  m.fin();
}
{
  const m = await ouvrirDeux({ equipages: EQ_AVEC_NINA, monde: { serveur: { equipage_retirer: () => new Promise(() => {}) } } });   // le serveur ne répond JAMAIS
  m.run('FILE_DELAI_DIRECT_MS=60');
  const t0 = Date.now();
  await retirerEq(m, 'u-nina');
  vrai('un « retirer » qui ne répond pas est abandonné après le délai : le geste passe à la file, Nina est descendue à l\'écran', Date.now() - t0 < 1500 && m.attentes().length === 1 && !nomsA(m, 'p-luc').includes('Nina'), `${Date.now() - t0} ms`);
  m.fin();
}

log('\n=== LE SERVEUR AVERTIT, ON RÉPOND « OUI », PUIS LE RÉSEAU TOMBE : LA QUESTION N\'EST PAS REPOSÉE ===');
{
  const serveur = { equipage_ajouter: (args, n) => {
    if (n === 0) return { data: { statut: 'avertissement', avertissements: [{ type: 'conflit_vehicule', vehicule: 'Camion 2' }] }, error: null };
    throw new Error('Failed to fetch');
  } };
  const m = await ouvrirDeux({ monde: { serveur } });
  await ajouterEq(m, 'u-marc', 'Marc');
  eq('UNE seule question (celle du serveur, qui nomme le véhicule) ; le 2e essai (avec « forcer ») échoue par le réseau', [m.appels.confirmations.length, m.appels.confirmations[0][1].includes('« Camion 2 »'), m.appels.envois.map((x) => x.args.p_forcer)], [1, true, [false, true]]);
  eq('le geste est gardé avec la même clé que les deux demandes, Marc est à bord à l\'écran, message ⏳', [m.attentes().length, m.run('gestesEnAttente()[0].args.cle') === m.appels.envois[0].args.p_cle_client, nomsA(m, 'p-luc'), dernier(m).startsWith('👤 Marc transféré depuis Camion 2 · ⏳')], [1, true, ['Luc', 'Marc'], true]);
  m.fin();
}

log('\n=== SI LE SERVEUR REFUSE L\'AJOUT AU RETOUR DU SIGNAL : NOTÉ, ET L\'ÉCRAN REVIENT À LA VÉRITÉ ===');
{
  const m = await ouvrirDeux({ monde: { serveur: { equipage_ajouter: () => ({ data: { statut: 'refuse', raison: 'chauffeur_ailleurs', vehicule: 'Camion 2' }, error: null }) } } }); coupe(m);
  await ajouterEq(m, 'u-marc', 'Marc');
  eq('hors réseau : Marc paraît à bord de mon camion', nomsA(m, 'p-luc'), ['Luc', 'Marc']);
  m.reseau(true);
  vrai('l\'ajout est refusé et noté dans « non envoyés », avec la raison', await attendreQue(() => m.refus().length === 1 && m.attentes().length === 0));
  eq('la raison nomme la personne et le véhicule', m.refus()[0].raison, 'Marc conduit déjà « Camion 2 ».');
  await attendreQue(() => m.appels.lectures.filter((x) => x === 'equipage_periodes').length >= 3);
  eq('l\'écran revient à la vérité du serveur : Marc est toujours dans le camion d\'Eric', [nomsA(m, 'p-luc'), nomsA(m, 'p-eric')], [['Luc'], ['Eric', 'Marc']]);
  m.fin();
}

log('\n=== SI LE TÉLÉPHONE NE PEUT RIEN GARDER, PERSONNE NE MONTE NI NE DESCEND À L\'ÉCRAN ===');
{
  const m = await ouvrirDeux(); coupe(m);
  m.run('magasinEcrire=async()=>false');
  await ajouterEq(m, 'u-nina', 'Nina');
  eq('ajouter sans pouvoir garder : Nina n\'est PAS à bord, message d\'erreur', [nomsA(m, 'p-luc'), m.attentes().length, dernier(m)], [['Luc'], 0, '❌ Le téléphone n’a pas pu garder ce geste. Réessaie.']);
  m.fin();
  const n = await ouvrirDeux({ equipages: EQ_AVEC_NINA }); coupe(n);
  n.run('magasinEcrire=async()=>false');
  await retirerEq(n, 'u-nina');
  eq('retirer sans pouvoir garder : Nina est TOUJOURS à bord, message d\'erreur', [nomsA(n, 'p-luc'), n.attentes().length, dernier(n)], [['Luc', 'Nina'], 0, '❌ Le téléphone n’a pas pu garder ce geste. Réessaie.']);
  n.fin();
}

log('\n=== DOUBLE TOUCHER, ET SUPERPOSITION RÉPÉTABLE POUR L\'ÉQUIPAGE ===');
{
  const m = await ouvrirDeux(); coupe(m);
  await Promise.all([ajouterEq(m, 'u-nina', 'Nina'), ajouterEq(m, 'u-nina', 'Nina')]);
  eq('deux touchers presque en même temps : UN seul geste', m.run('gestesEnAttente().filter(g=>g.type==="equipage_ajouter").length'), 1);
  m.fin();
  const n = await ouvrirDeux({ equipages: EQ_AVEC_NINA }); coupe(n);
  await n.enfiler('equipage_ajouter', { cle: 'c1', passeId: 'p-luc', userId: 'u-nina', nom: 'Nina' });
  await n.enfiler('equipage_ajouter', { cle: 'c2', passeId: 'p-luc', userId: 'u-nina', nom: 'Nina' });
  eq('le serveur a déjà Nina à bord (réponse perdue) et le geste est même gardé deux fois : Nina n\'est qu\'UNE fois à bord', nomsA(n, 'p-luc'), ['Luc', 'Nina']);
  await n.enfiler('equipage_ajouter', { cle: 'c3', passeId: 'p-inconnue', userId: 'u-marc', nom: 'Marc' });
  eq('ajouter à une passe qui n\'est plus en cours : rien ne change à l\'écran', [nomsA(n, 'p-eric'), n.run("equipages['p-inconnue']===undefined")], [['Eric', 'Marc'], true]);
  await n.enfiler('equipage_retirer', { cle: 'c4', passeId: 'p-luc', userId: 'u-luc', nom: 'Luc' });
  eq('retirer le CHAUFFEUR : rien ne change (le serveur le refuse aussi)', nomsA(n, 'p-luc'), ['Luc', 'Nina']);
  n.fin();
}

// ══════════════════════════════════════════════════════════════════════
// MORCEAU 4 : LES PROBLÈMES ET LA PHOTO
// ══════════════════════════════════════════════════════════════════════
const PB = '11111111-1111-4111-8111-111111111111';
const probleme = (o = {}) => ({ id: PB, stop_id: 's1', passe_id: 'p-luc', utilisateur_id: 'u-luc', note: 'Vieux problème', cree_le: iso(30), photo_chemin: null, utilisateurs: { nom: 'Luc' }, lu: false, ...o });
// Un serveur qui enregistre vraiment les problèmes et relie les photos ; « idempotent » : un problème déjà là répond « doublon de clé » (23505)
const serveurProblemes = (getMonde) => ({
  'insert:problemes': (row) => {
    const m = getMonde();
    if (m.donnees.problemes.some((p) => p.id === row.id)) return { data: null, error: { code: '23505', message: 'duplicate key value' } };
    m.donnees.problemes.push({ ...row, utilisateur_id: 'u-luc', cree_le: new Date().toISOString(), photo_chemin: null, utilisateurs: { nom: 'Luc' }, lu: false });
  },
  probleme_attacher_photo: (args, n, d) => { const p = d.problemes.find((x) => x.id === args.p_probleme_id); if (p) p.photo_chemin = 'u-luc/' + args.p_probleme_id + '.jpg'; return { data: { statut: 'ok' }, error: null }; },
});
const ouvrirBoite = (m, note = 'Entrée bloquée', avecPhoto = false) => {
  m.run(`openCard(${idx('s1')})`); m.run('openProbleme()'); m.el('prob-note').value = note;
  if (avecPhoto) { m.ctx.__b = new Blob(['photo-du-test']); m.run("_photoChoisie={blob:__b,url:'blob:choisie'}"); }
};
const fiche = (m) => { m.run(`openCard(${idx('s1')})`); return m.el('sc-prob').innerHTML; };
const boiteOuverte = (m) => m.el('prob-overlay').classList.contains('open');
// Des liens locaux « blob: » pour les miniatures (le faux navigateur n'a pas URL.createObjectURL)
const avecMiniatures = (m) => m.run('var __n=0, __revoques=[]; URL={createObjectURL:()=>"blob:local-"+(++__n),revokeObjectURL:(u)=>__revoques.push(u)}');

log('\n=== SIGNALER UN PROBLÈME SANS RÉSEAU : IL EST À L\'ÉCRAN TOUT DE SUITE ===');
{
  const m = await ouvrir(); coupe(m);
  ouvrirBoite(m);
  const id = m.run('_idProbleme');
  await m.run('envoyerProbleme()');
  eq('UN geste gardé : le problème, avec SON numéro, l\'arrêt, MA passe et la note', m.run('gestesEnAttente().map(g=>[g.type,g.args.id,g.args.stopId,g.args.passeId,g.args.note])'), [['probleme', id, 's1', 'p-luc', 'Entrée bloquée']]);
  eq('aucun envoi au serveur ; la boîte et la fiche se ferment', [m.appels.envois.length, boiteOuverte(m), m.run('activeIdx')], [0, false, null]);
  eq('le message dit « signalé » ET que l\'envoi attend le signal', dernier(m), '⚠ Problème signalé ! · ⏳ envoyé au retour du signal · garde l’application ouverte');
  eq('l\'arrêt est orange (problème) ; le problème est à moi, marqué « en attente », avec l\'heure du geste', [m.run(`aProbleme(stops[${idx('s1')}])`), m.run('problemesNonLus.map(p=>[p.id,p.utilisateur_id,p.note,p.enAttente,p.photo_chemin])'), Math.abs(Date.now() - Date.parse(m.run('problemesNonLus[0].cree_le'))) < 5000], [true, [[id, 'u-luc', 'Entrée bloquée', true, null]], true]);
  const h = fiche(m);
  eq('la fiche : la note, « ⏳ pas encore envoyé », et le bouton « Ajouter une photo » (pour ma photo après coup)', [h.includes('Entrée bloquée'), h.includes('⏳ pas encore envoyé'), h.includes('ajouterPhotoApres')], [true, true, true]);
  eq('la copie du serveur est intacte (aucun problème), en mémoire ET sur le téléphone', [m.run('_problemesServeur.length'), m.memoire()[m.cles('cache:').find((k) => k.endsWith(':problemes'))]?.data?.length], [0, 0]);
  eq('la bande : « ⏳ 1 geste en attente »', m.bande().texte.includes('⏳ 1 geste en attente'), true);
  m.fin();
}

log('\n=== AVEC UNE PHOTO : DEUX GESTES DANS L\'ORDRE (le problème, puis la photo), MINIATURE LOCALE ===');
{
  const m = await ouvrir(); coupe(m); avecMiniatures(m);
  ouvrirBoite(m, 'Barrière brisée', true);
  const id = m.run('_idProbleme');
  await m.run('envoyerProbleme()');
  eq('deux gestes : le problème PUIS sa photo (même numéro)', m.run('gestesEnAttente().map(g=>[g.type,g.args.id||g.args.problemeId])'), [['probleme', id], ['probleme_photo', id]]);
  eq('la photo est dans le geste (un vrai fichier), pas seulement son nom', [m.run('gestesEnAttente()[1].photo!==null'), m.run('gestesEnAttente()[1].photo.size')], [true, 'photo-du-test'.length]);
  eq('message « avec photo » + ⏳ ; la photo choisie est oubliée ; boîte fermée', [dernier(m).startsWith('⚠ Problème signalé ! (avec photo) · ⏳ envoyé au retour du signal'), m.run('_photoChoisie'), boiteOuverte(m)], [true, null, false]);
  const h = fiche(m);
  eq('la fiche montre la MINIATURE locale et « 📷 ⏳ photo envoyée au retour du signal », plus de bouton « Ajouter »', [h.includes('src="blob:local-1"'), h.includes('📷 ⏳ photo envoyée au retour du signal'), h.includes('ajouterPhotoApres')], [true, true, false]);
  eq('la copie du serveur est intacte', m.run('_problemesServeur.length'), 0);
  m.fin();
}

log('\n=== AU RETOUR DU SIGNAL : LE PROBLÈME PART (une seule fois), PUIS LA PHOTO ; LE SERVEUR A LE DERNIER MOT ===');
{
  let m;
  m = await ouvrir({ monde: { serveur: serveurProblemes(() => m) } }); coupe(m); avecMiniatures(m);
  ouvrirBoite(m, 'Barrière brisée', true);
  const id = m.run('_idProbleme');
  await m.run('envoyerProbleme()');
  const lecturesAvant = m.appels.lectures.filter((x) => x === 'problemes').length;
  m.reseau(true);
  vrai('le problème part, puis la photo, et la file se vide', await attendreQue(() => m.attentes().length === 0 && m.run('reseau.enLigne')));
  await attendreQue(() => m.appels.lectures.filter((x) => x === 'problemes').length > lecturesAvant);
  eq('l\'ordre des envois : le problème, PUIS la photo (fichier), PUIS la liaison', [m.appels.envois.map((x) => x.nom), m.appels.uploads], [['insert:problemes', 'probleme_attacher_photo'], ['u-luc/' + id + '.jpg']]);
  eq('le problème est envoyé avec son numéro, l\'arrêt, la passe et la note — rien d\'autre', m.appels.envois[0].args, { id, stop_id: 's1', passe_id: 'p-luc', note: 'Barrière brisée' });
  eq('le serveur a le dernier mot : UN problème, avec sa photo, plus « en attente », plus de ⏳', [m.donnees.problemes.length, m.run('problemesNonLus.map(p=>[p.id,p.enAttente,p.photoEnAttente,p.photo_chemin])'), m.bande().visible], [1, [[id, undefined, undefined, 'u-luc/' + id + '.jpg']], false]);
  eq('la miniature locale du geste est libérée une fois la photo partie (et celle de la boîte, à sa fermeture)', [m.run('__revoques.includes("blob:local-1")'), m.run('__revoques.includes("blob:choisie")')], [true, true]);
  m.fin();
}

log('\n=== UN PROBLÈME FAIT EN LIGNE DONT LA RÉPONSE SE PERD PASSE PAR LA FILE (même numéro : jamais deux problèmes) ===');
{
  let m, casse = true;
  const base = serveurProblemes(() => m);
  const serveur = { ...base, 'insert:problemes': (row) => { const r = base['insert:problemes'](row); if (casse) throw new Error('Failed to fetch'); return r; } };   // le serveur ENREGISTRE, mais la réponse ne revient pas
  m = await ouvrir({ monde: { serveur } });
  ouvrirBoite(m, 'Trou dans la chaussée', true);
  const id = m.run('_idProbleme');
  await m.run('envoyerProbleme()');
  eq('la demande échoue par le réseau : le problème ET sa photo sont GARDÉS, l\'application se sait hors réseau, la boîte se ferme', [m.run('gestesEnAttente().map(g=>[g.type,g.args.id||g.args.problemeId])'), m.run('reseau.enLigne'), boiteOuverte(m)], [[['probleme', id], ['probleme_photo', id]], false, false]);
  eq('aucun envoi de photo tant que le texte n\'est pas confirmé ; message ⏳', [m.appels.uploads.length, dernier(m).startsWith('⚠ Problème signalé ! (avec photo) · ⏳')], [0, true]);
  const premier = m.appels.envois[0].args;
  casse = false; m.reseau(true);
  vrai('au retour du signal : la file se vide', await attendreQue(() => m.attentes().length === 0 && m.run('reseau.enLigne')));
  eq('le renvoi porte le MÊME numéro ; le serveur répond « doublon de clé » (déjà là) : ce n\'est pas un échec, la photo part quand même', [m.appels.envois[1].args.id, premier.id, m.refus().length, m.appels.uploads], [id, id, 0, ['u-luc/' + id + '.jpg']]);
  eq('UN SEUL problème sur le serveur', m.donnees.problemes.length, 1);
  m.fin();
}
{
  let m;
  const serveur = serveurProblemes(() => m);
  m = await ouvrir({ monde: { serveur, upload: () => { throw new Error('Failed to fetch'); } } });
  ouvrirBoite(m, 'Trou dans la chaussée', true);
  const id = m.run('_idProbleme');
  await m.run('envoyerProbleme()');
  eq('le texte est parti, mais la photo échoue par le RÉSEAU : le problème est signalé, la photo est GARDÉE (⏳)', [m.donnees.problemes.length, m.run('gestesEnAttente().map(g=>[g.type,g.args.problemeId])'), dernier(m).startsWith('⚠ Problème signalé ! · 📷 photo · ⏳ envoyé au retour du signal')], [1, [['probleme_photo', id]], true]);
  eq('la fiche : le problème (serveur) avec « photo en attente », pas de « pas encore envoyé »', [fiche(m).includes('📷 ⏳ photo envoyée au retour du signal'), fiche(m).includes('⏳ pas encore envoyé')], [true, false]);
  await m.run('attendreEcritures()');
  const copie = m.memoire()[m.cles('cache:').find((k) => k.endsWith(':problemes'))]?.data ?? [];
  eq('la copie gardée sur le téléphone ne contient JAMAIS le résultat superposé (ni « en attente », ni miniature)', [copie.length, copie.some((p) => p.photoEnAttente || p.enAttente || p._photoUrl)], [1, false]);
  m.fin();
}

log('\n=== UN REFUS AU RETOUR DU SIGNAL : NOTÉ, ET L\'ÉCRAN REVIENT À LA VÉRITÉ ===');
{
  const serveur = { 'insert:problemes': () => ({ data: null, error: { code: '23503', message: 'violates foreign key constraint' } }), probleme_attacher_photo: () => ({ data: null, error: { message: 'probleme_introuvable' } }) };
  const m = await ouvrir({ monde: { serveur } }); coupe(m);
  ouvrirBoite(m, 'Barrière brisée', true);
  await m.run('envoyerProbleme()');
  eq('hors réseau : l\'arrêt paraît orange', m.run(`aProbleme(stops[${idx('s1')}])`), true);
  const lecturesAvant = m.appels.lectures.filter((x) => x === 'problemes').length;
  m.reseau(true);
  vrai('le problème ET sa photo sont refusés, notés dans « non envoyés »', await attendreQue(() => m.refus().length === 2 && m.attentes().length === 0));
  await attendreQue(() => m.appels.lectures.filter((x) => x === 'problemes').length > lecturesAvant);
  eq('les raisons sont écrites en français (la photo dit que le problème n\'avait pas été enregistré)', m.refus().map((r) => r.raison.startsWith('Refusé par le serveur') || r.raison), [true, 'Le problème n’avait pas été enregistré : la photo n’a pas pu y être reliée.']);
  eq('l\'écran revient à la vérité du serveur : plus de problème, arrêt plus orange', [m.run('problemesNonLus.length'), m.run(`aProbleme(stops[${idx('s1')}])`)], [0, false]);
  m.fin();
}

log('\n=== AJOUTER UNE PHOTO APRÈS COUP, SANS RÉSEAU ===');
{
  let m;
  m = await ouvrir({ monde: { serveur: serveurProblemes(() => m) } });
  m.donnees.problemes = [probleme()];
  await m.run('loadStops()'); await attendre(80); coupe(m); avecMiniatures(m);
  m.run('reduirePhoto=async(f)=>f');   // (la réduction de la photo est testée ailleurs)
  eq('avant : mon problème (sans photo) offre « Ajouter une photo »', fiche(m).includes('ajouterPhotoApres'), true);
  m.run(`ajouterPhotoApres('${PB}')`);
  m.ctx.__b = new Blob(['ma-photo']); m.ctx.__in = { files: [m.ctx.__b], value: '' };
  await m.run('photoApresChoisie(__in)');
  eq('UN geste gardé : la photo de CE problème, avec le fichier', [m.run('gestesEnAttente().map(g=>[g.type,g.args.problemeId])'), m.run('gestesEnAttente()[0].photo.size')], [[['probleme_photo', PB]], 'ma-photo'.length]);
  eq('message ⏳ ; la fiche montre la miniature locale « en attente » et plus le bouton « Ajouter »', [dernier(m).startsWith('📷 Photo gardée · ⏳ envoyé au retour du signal'), fiche(m).includes('src="blob:local-1"'), fiche(m).includes('📷 ⏳ photo envoyée au retour du signal'), fiche(m).includes('ajouterPhotoApres')], [true, true, true, false]);
  eq('aucun envoi sans signal', [m.appels.envois.length, m.appels.uploads.length], [0, 0]);
  m.reseau(true);
  vrai('au retour du signal : la photo part (bon chemin), est reliée, la file se vide', await attendreQue(() => m.attentes().length === 0 && m.appels.uploads.length === 1));
  eq('… au chemin « numéro-employé/numéro-problème.jpg », puis la liaison', [m.appels.uploads, m.appels.envois.map((x) => x.nom)], [['u-luc/' + PB + '.jpg'], ['probleme_attacher_photo']]);
  m.fin();
}
{
  // En ligne, mais la photo n'a pas de réseau : gardée aussi
  const m = await ouvrir({ monde: { upload: () => { throw new Error('Failed to fetch'); } } });
  m.donnees.problemes = [probleme()];
  await m.run('loadStops()'); await attendre(80);
  m.run('reduirePhoto=async(f)=>f');
  m.run(`ajouterPhotoApres('${PB}')`);
  m.ctx.__b = new Blob(['ma-photo']); m.ctx.__in = { files: [m.ctx.__b], value: '' };
  await m.run('photoApresChoisie(__in)');
  eq('en ligne, l\'envoi de la photo échoue par le réseau : la photo est GARDÉE (⏳), pas d\'erreur', [m.run('gestesEnAttente().map(g=>g.type)'), dernier(m).startsWith('📷 Photo gardée · ⏳')], [['probleme_photo'], true]);
  m.fin();
}

{
  // La photo après coup, sans pouvoir la garder : jamais « photo gardée », le bouton « Ajouter » reste pour réessayer
  const m = await ouvrir();
  m.donnees.problemes = [probleme()];
  await m.run('loadStops()'); await attendre(80); coupe(m);
  m.run('reduirePhoto=async(f)=>f; magasinEcrire=async()=>false');
  m.run(`ajouterPhotoApres('${PB}')`);
  m.ctx.__b = new Blob(['ma-photo']); m.ctx.__in = { files: [m.ctx.__b], value: '' };
  await m.run('photoApresChoisie(__in)');
  eq('rien n\'est gardé : message d\'erreur, aucun geste, la fiche offre toujours « Ajouter une photo »', [dernier(m), m.attentes().length, fiche(m).includes('ajouterPhotoApres')], ['❌ Le téléphone n’a pas pu garder ce geste. Réessaie.', 0, true]);
  m.fin();
}

log('\n=== SI LE TÉLÉPHONE NE PEUT RIEN GARDER, LE PROBLÈME N\'EST PAS « SIGNALÉ » ET RIEN N\'EST PERDU DANS LA BOÎTE ===');
{
  const m = await ouvrir(); coupe(m);
  m.run('magasinEcrire=async()=>false');
  ouvrirBoite(m, 'Entrée bloquée', true);
  await m.run('envoyerProbleme()');
  eq('rien n\'est gardé : message d\'erreur, la boîte reste ouverte avec la note ET la photo, l\'arrêt n\'est pas orange', [dernier(m), boiteOuverte(m), m.el('prob-note').value, m.run('_photoChoisie!==null'), m.run(`aProbleme(stops[${idx('s1')}])`)], ['❌ Le téléphone n’a pas pu garder ce geste. Réessaie.', true, 'Entrée bloquée', true, false]);
  m.fin();
  // Le problème est gardé, mais pas la photo
  const n = await ouvrir(); coupe(n);
  n.run('__ecrire=magasinEcrire; var __k=0; magasinEcrire=async(cle,v)=>(String(cle).startsWith("file:")&&++__k>1)?false:__ecrire(cle,v)');
  ouvrirBoite(n, 'Entrée bloquée', true);
  await n.run('envoyerProbleme()');
  eq('le problème est gardé mais pas la photo : le message le dit, le problème est bien à l\'écran', [dernier(n).startsWith('⚠ Problème signalé ! · 📷 photo non gardée : ajoute-la après · ⏳'), n.run('gestesEnAttente().map(g=>g.type)'), boiteOuverte(n)], [true, ['probleme'], false]);
  n.fin();
}

log('\n=== DOUBLE TOUCHER, ET SUPERPOSITION RÉPÉTABLE POUR LES PROBLÈMES ===');
{
  const m = await ouvrir(); coupe(m);
  ouvrirBoite(m);
  await Promise.all([m.run('envoyerProbleme()'), m.run('envoyerProbleme()'), m.run('envoyerProbleme()')]);
  eq('trois touchers sur « Envoyer » : UN seul problème gardé', m.run('gestesEnAttente().filter(g=>g.type==="probleme").length'), 1);
  m.fin();
  const n = await ouvrir(); coupe(n);
  n.donnees.problemes = [];
  await n.enfiler('probleme', { id: PB, stopId: 's1', passeId: 'p-luc', note: 'A' });
  await n.enfiler('probleme', { id: PB, stopId: 's1', passeId: 'p-luc', note: 'A' });
  eq('le même problème gardé deux fois : UNE seule ligne à l\'écran', n.run('problemesNonLus.length'), 1);
  n.fin();
  const o = await ouvrir({ monde: {} });
  o.donnees.problemes = [probleme({ note: 'Déjà là' })];
  await o.run('loadStops()'); await attendre(80); coupe(o);
  await o.enfiler('probleme', { id: PB, stopId: 's1', passeId: 'p-luc', note: 'Déjà là' });
  eq('le serveur a déjà ce problème (réponse perdue) et le geste attend : UNE seule ligne, celle du serveur (pas « en attente »)', [o.run('problemesNonLus.length'), o.run('problemesNonLus[0].enAttente')], [1, undefined]);
  await o.enfiler('probleme_photo', { problemeId: 'inconnu' });
  eq('une photo pour un problème qu\'on ne connaît pas : rien ne change à l\'écran', o.run('problemesNonLus.filter(p=>p.photoEnAttente).length'), 0);
  o.fin();
  const p = await ouvrir();
  p.donnees.problemes = [probleme({ photo_chemin: 'u-luc/' + PB + '.jpg' })];
  await p.run('loadStops()'); await attendre(80); coupe(p);
  await p.enfiler('probleme_photo', { problemeId: PB });
  eq('le problème a déjà sa photo (sur le serveur) : elle n\'est pas marquée « en attente »', p.run('problemesNonLus[0].photoEnAttente'), undefined);
  p.fin();
}

log('\n=== ON ROUVRE L\'APPLICATION SANS RÉSEAU : LE PROBLÈME ET SA PHOTO SONT TOUJOURS À L\'ÉCRAN ===');
{
  const a = await ouvrir(); coupe(a);
  ouvrirBoite(a, 'Barrière brisée', true);
  await a.run('envoyerProbleme()'); await a.run('attendreEcritures()');
  const surLeTelephone = a.memoire(); a.fin();
  const b = monde({ enLigne: false, memoire: surLeTelephone });
  await b.run('loadStops()');
  eq('après réouverture hors réseau : l\'arrêt est orange, le problème est « en attente », sa photo aussi, aucune erreur', [b.run(`aProbleme(stops[${idx('s1')}])`), b.run('problemesNonLus.map(p=>[p.note,p.enAttente,p.photoEnAttente])'), b.appels.erreurs.length], [true, [['Barrière brisée', true, true]], 0]);
  eq('… et rien n\'est envoyé sans signal', b.appels.envois.length, 0);
  b.fin();
}

log('\n=== LE CODE : UN SEUL ENDROIT POSE LES PROBLÈMES AUSSI ===');
{
  const fichiers = fs.readdirSync(WWW + 'js').filter((f) => f.endsWith('.js'));
  const poses = [];
  for (const f of fichiers) lire('js/' + f).split('\n').forEach((l) => { if (/^\s*(let\s+)?problemesNonLus\s*=[^=]/.test(l) && !/^\s*\/\//.test(l)) poses.push(f); });
  eq('« problemesNonLus = … » n\'apparaît qu\'à la déclaration et dans poserProblemes', poses, ['problemes.js', 'problemes.js']);
  const pj = lire('js/problemes.js'), ph = lire('js/photos.js');
  vrai('envoyerProbleme et l\'ajout de photo n\'appellent le serveur qu\'avec un délai (avecDelai) et passent par la file en cas de panne', /avecDelai\(db\.from\('problemes'\)\.insert/.test(pj) && /avecDelai\(envoyerPhotoProbleme/.test(pj) && /avecDelai\(envoyerPhotoProbleme/.test(ph) && pj.includes('problemeSansReseau') && ph.includes('photoApresSansReseau'));
}

log('\n=== LE CODE : UN SEUL ENDROIT POSE LES ÉQUIPAGES AUSSI ===');
{
  const fichiers = fs.readdirSync(WWW + 'js').filter((f) => f.endsWith('.js'));
  const poses = [];
  for (const f of fichiers) lire('js/' + f).split('\n').forEach((l) => { if (/^\s*(let\s+)?equipages\s*=[^=]/.test(l) && !/^\s*\/\//.test(l)) poses.push(f); });
  eq('« equipages = … » n\'apparaît qu\'à la déclaration et dans poserEquipages (jamais une lecture qui contourne la superposition)', poses, ['vehicules.js', 'vehicules.js']);
  const passeJs = lire('js/passe.js');
  vrai('demarrerPasse et terminerPasse n\'appellent le serveur qu\'avec un délai (avecDelai) et passent par la file en cas de panne', /avecDelai\(db\.rpc\('debuter_passe'/.test(passeJs) && /avecDelai\(db\.rpc\('terminer_passe'/.test(passeJs) && passeJs.includes('demarrerSansReseau') && passeJs.includes('terminerSansReseau'));
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
