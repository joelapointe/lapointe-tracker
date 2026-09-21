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
  probleme_attacher_photo: { statut: 'ok' }, quart_commencer: { statut: 'commence' }, quart_terminer: { statut: 'termine' },
  quart_terminer_equipier: { statut: 'termine' }, quart_signaler_erreur: { statut: 'signale' },
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
  const appels = { envois: [], lectures: [], sondes: [], toasts: [], confirmations: [], questionsFin: [], erreurs: [], evenements: [], uploads: [], reload: 0, signOut: 0, enCours: 0, maxEnCours: 0 };
  const echec = () => { throw new Error('Failed to fetch'); };
  const GESTES = Object.keys(REPONSES);
  const fauxDb = {
    rpc: async (nom, args) => {
      if (nom === 'tours_en_cours') { appels.lectures.push(nom); appels.evenements.push('L:' + nom); if (!etat.enLigne) echec(); return { data: donnees.tours, error: null }; }
      if (nom === 'equipage_precedent') { if (o.delaiPrecedentMs) await attendre(o.delaiPrecedentMs); if (!etat.enLigne) echec(); return { data: donnees.equipagePrecedent ?? null, error: null }; }
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
    __toasts: appels.toasts, __confirmations: appels.confirmations, __questionsFin: appels.questionsFin, __reponseFin: { oui: false },
    crypto: { randomUUID: () => crypto.randomUUID() },
  };
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/config.js', 'js/utilitaires.js', 'js/hors-reseau.js', 'js/file-attente.js', 'js/auth.js', 'js/tours.js', 'js/vehicules.js', 'js/equipage.js', 'js/equipage-panneau.js', 'js/quart.js', 'js/quart-ecrans.js', 'js/passe.js', 'js/resume-passe.js', 'js/arrets.js', 'js/routes.js', 'js/liste-arrets.js', 'js/problemes.js', 'js/photos.js'])
    vm.runInContext(lire(f), ctx, { filename: f });
  vm.runInContext('db = __fauxDb; map = __map;', ctx);
  vm.runInContext('currentUser = ' + JSON.stringify(o.utilisateur ?? LUC) + ';', ctx);
  vm.runInContext('toast = (m) => { __toasts.push(m); }; confirmer = async (...a) => { if (/a terminé sa journée/.test(String(a[0]))) { __questionsFin.push(a); return !!__reponseFin.oui; } __confirmations.push(a); return true; };', ctx);
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
    repondreFin: (oui) => { sandbox.__reponseFin.oui = oui; },   // « X a terminé sa journée ? » : « Non » par défaut (les anciens tests n'en parlent pas)
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
  m.donnees.quarts = o.quarts ?? [];   // (étape 17 : mes quarts, côté serveur)
  if (o.equipagePrecedent) m.donnees.equipagePrecedent = o.equipagePrecedent;   // (étape 17 : l'équipe de ma dernière passe, comme la donne equipage_precedent)
  if (o.utilisateurs) m.donnees.utilisateurs = o.utilisateurs;
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
  await attendre(40);   // (du temps passe entre le signalement et le retour du signal : l'heure du geste et celle de l'envoi sont différentes)
  const tRetourP = Date.now();
  m.reseau(true);
  vrai('le problème part, puis la photo, et la file se vide', await attendreQue(() => m.attentes().length === 0 && m.run('reseau.enLigne')));
  await attendreQue(() => m.appels.lectures.filter((x) => x === 'problemes').length > lecturesAvant);
  eq('l\'ordre des envois : le problème, PUIS la photo (fichier), PUIS la liaison', [m.appels.envois.map((x) => x.nom), m.appels.uploads], [['insert:problemes', 'probleme_attacher_photo'], ['u-luc/' + id + '.jpg']]);
  const envoye = { ...m.appels.envois[0].args };
  const creeLe = Date.parse(envoye.cree_le);
  delete envoye.cree_le;
  eq('le problème est envoyé avec son numéro, l\'arrêt, la passe, la note — et l\'heure du GESTE (étape 16d) — rien d\'autre', envoye, { id, stop_id: 's1', passe_id: 'p-luc', note: 'Barrière brisée' });
  vrai('… l\'heure envoyée (cree_le) est celle où le problème a été SIGNALÉ (avant le retour du signal), pas celle de l\'envoi', creeLe > 0 && creeLe <= tRetourP && tRetourP - creeLe < 60000, `${creeLe} / ${tRetourP}`);
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

// ══════════════════════════════════════════════════════════════════════
// MORCEAU 5 : L'ESSAI D'ENSEMBLE — UNE JOURNÉE SANS RÉSEAU, PUIS LE RETOUR DU SIGNAL
// ══════════════════════════════════════════════════════════════════════
// Un serveur qui applique TOUS les gestes pour de vrai (tours, équipage, problèmes) : on voit ce que l'écran devient quand il a le dernier mot.
const serveurComplet = (getMonde, o = {}) => {
  const NOM = { 'u-marc': 'Marc', 'u-nina': 'Nina', 'u-eric': 'Eric' };
  const ligne = (passeId, role, id) => ({ passe_id: passeId, role, utilisateur_id: id, utilisateurs: { nom: id === 'u-luc' ? 'Luc' : NOM[id] } });
  return {
    ...serveurProblemes(getMonde),
    debuter_passe: (args, n, d) => {
      if (!d.tours.some((t) => t.passes.some((p) => p.passe_id === args.p_id))) {
        d.tours = [tourInit({ numero: 1, passes: [{ ...PASSE_LUC, passe_id: args.p_id }] })];
        d.equipage_periodes.push(ligne(args.p_id, 'chauffeur', 'u-luc'));
        (args.p_equipage || []).forEach((x) => d.equipage_periodes.push(ligne(args.p_id, 'passager', x.utilisateur_id)));
      }
      return { data: { statut: 'debutee', numero: 1, equipage: (args.p_equipage || []).map((x) => ({ utilisateur_id: x.utilisateur_id, statut: 'ajoute' })) }, error: null };
    },
    completer_arret: appliquerCompleter,
    equipage_ajouter: (args, n, d) => {
      if (o.echecsAjout > 0) { o.echecsAjout--; throw new Error('Failed to fetch'); }   // le signal saute en plein milieu de la file
      if (!d.equipage_periodes.some((p) => p.passe_id === args.p_passe_id && p.utilisateur_id === args.p_utilisateur_id)) d.equipage_periodes.push(ligne(args.p_passe_id, 'passager', args.p_utilisateur_id));
      return { data: { statut: 'ajoute' }, error: null };
    },
    equipage_retirer: (args, n, d) => { d.equipage_periodes = d.equipage_periodes.filter((p) => !(p.passe_id === args.p_passe_id && p.utilisateur_id === args.p_utilisateur_id)); return { data: { statut: 'retire' }, error: null }; },
    terminer_passe: (args, n, d) => {
      const t = d.tours[0];
      t.passes = t.passes.filter((p) => p.passe_id !== args.p_passe_id); t.en_cours = false;
      d.equipage_periodes = d.equipage_periodes.filter((p) => p.passe_id !== args.p_passe_id);
      return { data: { statut: 'terminee', faits: t.faits, total: t.total, pourcentage: t.pourcentage }, error: null };
    },
  };
};
const LIBELLES_JOURNEE = ['▶ Passe débutée : Charette · ' + MEC + ' · Camion 1', '✔ Complété : 304 rue de l\'Église', '👤 Équipage : + Nina (Camion 1)', '👤 Équipage : − Marc (Camion 1)',
  '⚠ Problème : 220 rue du Moulin — Barrière brisée', '📷 Photo du problème : 220 rue du Moulin', '■ Passe terminée : n° 1 (à confirmer) · Charette'];

for (const capricieux of [false, true]) {
  log(`\n=== UNE JOURNÉE COMPLÈTE SANS RÉSEAU, PUIS LE RETOUR DU SIGNAL${capricieux ? ' (LE SIGNAL SAUTE EN PLEIN MILIEU DE LA FILE)' : ''} : TOUT PART DANS L'ORDRE, UNE SEULE FOIS ===`);
  let m;
  const o = { echecsAjout: capricieux ? 1 : 0 };
  m = await ouvrir({ tours: [], equipes: E1E2, equipages: [], monde: { serveur: serveurComplet(() => m, o) } }); coupe(m); avecMiniatures(m);
  // — la journée, avec les vrais écrans —
  await debuterHors(m, [{ utilisateur_id: 'u-marc', nom: 'Marc', cle: 'cle-marc', forcer: false }]);
  const passeId = passeLocale(m);
  await toucher(m, 's1');
  await m.run(`ajouterPersonneAuVehicule('${passeId}',{utilisateur_id:'u-nina',nom:'Nina'})`);
  await retirerEq(m, 'u-marc');
  m.run(`openCard(${idx('s2')})`); m.run('openProbleme()'); m.el('prob-note').value = 'Barrière brisée';
  m.ctx.__b = new Blob(['photo']); m.run("_photoChoisie={blob:__b,url:'blob:choisie'}");
  await m.run('envoyerProbleme()');
  await m.run('terminerPasse()');
  // — ce que voit l'employé, sans réseau —
  eq('les 7 gestes sont gardés, dans l\'ordre, avec un libellé lisible', m.attentes(), LIBELLES_JOURNEE);
  eq('la liste « en attente » les montre tous avec « Sera envoyé dès que le signal revient. »', [m.run('htmlListeGestes()').includes('En attente (7)'), LIBELLES_JOURNEE.every((l) => m.run('htmlListeGestes()').includes(l.replace(/'/g, '&#39;').replace(/—/g, '—'))), (m.run('htmlListeGestes()').match(/Sera envoyé dès que le signal revient\./g) || []).length], [true, true, 7]);
  eq('la bande : « Hors réseau · ⏳ 7 gestes en attente »', [m.bande().texte.includes('📴 Hors réseau'), m.bande().texte.includes('⏳ 7 gestes en attente')], [true, true]);
  eq('à l\'écran : ma passe est terminée (1/2), numéro « à confirmer », personne à bord de cette passe, l\'arrêt 2 est orange (problème), l\'arrêt 1 est fait', [m.run('maPasse()'), m.run('tours[0].en_cours'), m.run('tours[0].faits'), m.run('tours[0].numero_a_confirmer'), m.run(`equipages['${passeId}']===undefined`), m.run(`aProbleme(stops[${idx('s2')}])`), estFait(m, 's1')], [null, false, 1, true, true, true, true]);
  eq('rien n\'a été envoyé sans signal', m.appels.envois.length, 0);
  await m.run('attendreEcritures()');
  const surLeTelephone = m.memoire();
  // — le téléphone est éteint puis rallumé sans réseau : rien n'est perdu —
  const b = monde({ enLigne: false, memoire: surLeTelephone });
  await b.run('loadStops()');
  eq('après extinction/rallumage sans réseau : les 7 gestes sont toujours là (photo comprise) et l\'écran montre le même résultat', [b.attentes(), b.run('gestesEnAttente().filter(g=>g.photo!==null).length'), b.run('maPasse()'), b.run('tours[0].faits'), b.run(`aProbleme(stops[${idx('s2')}])`)], [LIBELLES_JOURNEE, 1, null, 1, true]);
  b.fin();
  // — le signal revient —
  const lecturesAvant = nbLecturesTours(m);
  const tRetour = Date.now();
  m.reseau(true);
  vrai('la file se vide (chaque geste part, dans l\'ordre)', await attendreQue(() => m.attentes().length === 0 && m.run('reseau.enLigne'), 6000));
  await attendreQue(() => nbLecturesTours(m) > lecturesAvant);
  await attendre(250);
  const noms = m.appels.envois.map((x) => x.nom);
  const attendus = ['debuter_passe', 'completer_arret', 'equipage_ajouter', 'equipage_retirer', 'insert:problemes', 'probleme_attacher_photo', 'terminer_passe'];
  if (capricieux) attendus.splice(2, 0, 'equipage_ajouter');
  eq(capricieux ? 'l\'ordre des envois (l\'ajout de Nina est retenté après la coupure, puis tout continue)' : 'l\'ordre des envois : celui des gestes', noms, attendus);
  // (l'heure du problème est « cree_le », depuis l'étape 16d : elle est comptée avec les autres)
  const moments = m.appels.envois.filter((x) => x.args?.p_moment || x.args?.cree_le).map((x) => x.args.p_moment || x.args.cree_le).filter((v, i, t) => i === 0 || v !== t[i - 1]);
  eq('les 6 gestes qui portent une heure (débuter, compléter, ajouter, retirer, problème, terminer) l\'envoient tous', m.appels.envois.filter((x) => x.args?.p_moment || x.args?.cree_le).length, 6 + (capricieux ? 1 : 0));
  vrai('les heures envoyées (p_moment) sont celles des gestes : dans l\'ordre, toutes AVANT le retour du signal', moments.every((v, i) => i === 0 || v >= moments[i - 1]) && moments.every((v) => Date.parse(v) <= tRetour), moments.join(' | '));
  eq('le serveur a chaque effet UNE seule fois : un tour terminé 1/2, un problème avec sa photo, plus personne à bord de cette passe', [m.donnees.tours.length, m.donnees.tours[0].en_cours, m.donnees.tours[0].faits, m.donnees.problemes.length, m.donnees.problemes[0].photo_chemin === 'u-luc/' + m.donnees.problemes[0].id + '.jpg', m.donnees.equipage_periodes.length], [1, false, 1, 1, true, 0]);
  eq('rien n\'est refusé, rien n\'attend, la bande est vide, plus aucun ⏳', [m.refus().length, m.attentes().length, m.bande().visible], [0, 0, false]);
  eq('l\'écran (relu du serveur) : le VRAI numéro de passe (plus « à confirmer »), passe terminée 1/2, aucune passe à moi', [m.run('tours[0].numero'), m.run('tours[0].numero_a_confirmer'), m.run('tours[0].en_cours'), m.run('tours[0].faits'), m.run('maPasse()')], [1, undefined, false, 1, null]);
  eq('le problème est celui du serveur (plus « en attente »), avec sa photo ; l\'équipage local a disparu', [m.run('problemesNonLus.length'), m.run('problemesNonLus[0].enAttente'), m.run('problemesNonLus[0].photoEnAttente'), typeof m.run('problemesNonLus[0].photo_chemin'), m.run('Object.keys(equipages).length')], [1, undefined, undefined, 'string', 0]);
  m.fin();
}

// ══════════════════════════════════════════════════════════════════════
// ÉTAPE 16d (APPLICATION) : L'HEURE DES ANNULATIONS, ET LE MESSAGE « ANNULATION IGNORÉE »
// ══════════════════════════════════════════════════════════════════════
const MESSAGE_IGNOREE = 'Cet arrêt avait été refait entre-temps, l’annulation a été ignorée.';
log('\n=== UNE ANNULATION FAITE SANS RÉSEAU PART AVEC L\'HEURE DU GESTE ===');
{
  const m = await ouvrir({ tours: [tourInit({ faits: 1, pourcentage: 50, arrets_faits: ['s1'], faits_il_y_a: { s1: 60 } })] }); coupe(m);
  await toucher(m, 's1');
  await attendre(40);
  const tRetour = Date.now();
  const lecturesAvant = nbLecturesTours(m);
  m.reseau(true);
  vrai('au retour du signal : l\'annulation part', await attendreQue(() => m.attentes().length === 0 && m.run('reseau.enLigne')));
  const a = m.appels.envois.find((x) => x.nom === 'annuler_arret')?.args;
  eq('elle porte la passe, l\'arrêt ET l\'heure du geste (p_moment) : les 10 minutes se comptent depuis le geste', [a?.p_passe_id, a?.p_stop_id, typeof a?.p_moment], ['p-luc', 's1', 'string']);
  vrai('… l\'heure est celle du geste (avant le retour du signal), pas celle de l\'envoi', Date.parse(a?.p_moment) <= tRetour && tRetour - Date.parse(a?.p_moment) < 60000, `${a?.p_moment} / ${tRetour}`);
  await attendreQue(() => nbLecturesTours(m) > lecturesAvant);
  m.fin();
}

log('\n=== L\'ARRÊT A ÉTÉ REFAIT ENTRE-TEMPS : LE CHAUFFEUR LE COMPREND TOUT DE SUITE ===');
{
  // Le serveur ignore l'annulation (arrêt refait par un autre camion après le geste) et le DIT
  const m = await ouvrir({ tours: [tourInit({ faits: 1, pourcentage: 50, arrets_faits: ['s1'], faits_il_y_a: { s1: 60 } })],
    monde: { serveur: { annuler_arret: () => ({ data: { statut: 'pas_complete', raison: 'complete_apres' }, error: null }) } } }); coupe(m);
  await toucher(m, 's1');
  eq('hors réseau : l\'arrêt paraît annulé (à faire) avec ⏳', [estFait(m, 's1'), m.run('gestesEnAttente().length')], [false, 1]);
  m.reseau(true);
  vrai('au retour du signal : l\'annulation est ignorée et notée dans « non envoyés »', await attendreQue(() => m.refus().length === 1 && m.attentes().length === 0));
  eq('LE MESSAGE À L\'ÉCRAN dit clairement ce qui s\'est passé (pas le message générique « touche la bande du haut »)', m.appels.toasts.filter((t) => t.includes('refait entre-temps')), ['⚠ ' + MESSAGE_IGNOREE]);
  eq('… la même phrase est dans la liste des gestes non envoyés (il peut la relire), avec le libellé du geste', [m.refus()[0].raison, m.refus()[0].libelle.startsWith('↩ Annulé : ')], [MESSAGE_IGNOREE, true]);
  eq('… et la bande du haut montre « ⚠ 1 geste non envoyé »', m.bande().texte.includes('⚠ 1 geste non envoyé'), true);
  await attendreQue(() => m.run(`estFait(stops[${idx('s1')}])`) === true);
  eq('l\'écran revient à la vérité du serveur : l\'arrêt est FAIT (refait par l\'autre camion)', estFait(m, 's1'), true);
  m.fin();
}
{
  // « Plus rien à annuler » (l'annulation avait déjà réussi, la réponse s'était perdue) : PAS de raison → aucun message (il serait faux)
  const m = await ouvrir({ tours: [tourInit({ faits: 1, pourcentage: 50, arrets_faits: ['s1'], faits_il_y_a: { s1: 60 } })],
    monde: { serveur: { annuler_arret: () => ({ data: { statut: 'pas_complete' }, error: null }) } } }); coupe(m);
  await toucher(m, 's1');
  m.reseau(true);
  vrai('au retour du signal : le geste est traité comme réussi', await attendreQue(() => m.attentes().length === 0 && m.run('reseau.enLigne')));
  eq('aucun message « refait entre-temps » (ce serait FAUX), rien dans « non envoyés »', [m.appels.toasts.some((t) => t.includes('refait entre-temps')), m.refus().length], [false, 0]);
  m.fin();
}
{
  // Un serveur qui ne connaît pas encore la précision (SQL 19 pas encore exécuté) : « pas_complete » sans raison → silencieux, jamais de plantage
  const m = await ouvrir({ tours: [tourInit({ faits: 1, pourcentage: 50, arrets_faits: ['s1'], faits_il_y_a: { s1: 60 } })],
    monde: { serveur: { annuler_arret: () => ({ data: { statut: 'pas_complete' }, error: null }) } } }); coupe(m);
  await m.enfiler('annuler_arret', { passeId: 'p-luc', stopId: 's1' });
  m.reseau(true);
  vrai('sans la précision du serveur : traité comme réussi (l\'application ne dépend pas du fichier 19)', await attendreQue(() => m.attentes().length === 0 && m.run('reseau.enLigne')));
  m.fin();
}
{
  // Les autres refus gardent leur message général (« touche la bande du haut »), le message direct n'est que pour ce cas
  const m = await ouvrir({ tours: [tourInit({ faits: 1, pourcentage: 50, arrets_faits: ['s1'], faits_il_y_a: { s1: 60 } })],
    monde: { serveur: { annuler_arret: () => ({ data: null, error: { code: 'P0001', message: 'delai_depasse' } }) } } }); coupe(m);
  await toucher(m, 's1');
  m.reseau(true);
  vrai('un refus « trop tard »…', await attendreQue(() => m.refus().length === 1 && m.attentes().length === 0));
  eq('… garde le message général (« touche la bande du haut ») et sa raison dans la liste', [m.appels.toasts.filter((t) => t.startsWith('⚠ Un geste n’a pas pu être envoyé')).length, m.refus()[0].raison], [1, 'Trop tard pour annuler (plus de 10 minutes).']);
  m.fin();
}

log('\n=== LE TITRE DE LA LISTE DES GESTES DIT LA VÉRITÉ ===');
{
  const m = await ouvrir(); coupe(m);
  await m.completer('s1');
  m.run('ouvrirListeGestes()');
  eq('des gestes qui attendent seulement le signal : « Gestes en attente »', m.el('gestes-h').textContent, 'Gestes en attente');
  m.run('fermerListeGestes()');
  m.run(`refuserGeste(gestesEnAttente()[0],'Refusé pour l\\'essai')`); await attendre(30);
  m.run('ouvrirListeGestes()');
  eq('dès qu\'un geste est REFUSÉ par le serveur : « Gestes non envoyés »', m.el('gestes-h').textContent, 'Gestes non envoyés');
  m.fin();
}

log('\n=== LES MESSAGES LONGS RESTENT LISIBLES SUR UN TÉLÉPHONE ===');
{
  const css = lire('css/style.css'), bloc = css.slice(css.indexOf('#toast{'), css.indexOf('#toast.show'));
  vrai('le message flottant passe à la ligne (plus de « nowrap ») et ne dépasse jamais la largeur de l\'écran', !/white-space:\s*nowrap/.test(bloc) && /max-width:\s*calc\(100vw\s*-\s*32px\)/.test(bloc), bloc);
  const m = monde();
  const durees = [];
  m.ctx.setTimeout = (fn, ms) => { durees.push(ms); return 0; };
  vm.runInContext('_tT=null;', m.ctx);
  vm.runInContext(lire('js/utilitaires.js').match(/function toast\(msg\)\{[\s\S]*?\n\}/)[0].replace('function toast', 'globalThis.__toast = function'), m.ctx);
  m.ctx.__toast('✔ Stop complété !'); m.ctx.__toast('⚠ Problème signalé ! (avec photo) · ⏳ envoyé au retour du signal · garde l’application ouverte');
  eq('un message court reste 2,5 s, un message long (offline) 4,5 s', durees, [2500, 4500]);
  m.fin();
}

// ══════════════════════════════════════════════════════════════════════
// ÉTAPE 17, MORCEAU 1 : « SUIS-JE EN SERVICE ? » (le quart de travail, le punch)
// ══════════════════════════════════════════════════════════════════════
const quartServeur = (o = {}) => ({ id: 'q-serveur', utilisateur_id: 'u-luc', debut: iso(90), fin: null, debut_source: 'manuel', a_valider: false, raison_a_valider: null, ...o });
const pastille = (m) => ({ texte: m.el('quart-pastille').textContent, classe: m.el('quart-pastille').className, visible: m.el('quart-pastille').style.display, logo: m.el('logo').style.display });
const heureDe = (m, iso_) => m.run(`heureCourte(${JSON.stringify(iso_)})`);
const cleQuart = (m) => m.cles('cache:').find((k) => k.endsWith(':quart'));

log('\n=== JE LIS MON QUART : EN SERVICE OU PAS ===');
{
  const m = await ouvrir({ quarts: [quartServeur()] });
  eq('un quart ouvert sur le serveur : je suis en service', [m.run('monQuart.id'), m.run('enService()')], ['q-serveur', true]);
  const p = pastille(m);
  eq('la pastille du haut dit « depuis » l\'heure du début (elle prend la place du logo)', [p.texte, p.classe, p.visible, p.logo], ['🟢 Depuis ' + heureDe(m, m.run('monQuart.debut')), 'quart-on', 'inline-flex', 'none']);
  eq('la copie du téléphone garde ce quart (pour l\'ouverture sans réseau)', m.memoire()[cleQuart(m)]?.data?.id, 'q-serveur');
  m.fin();
}
{
  const m = await ouvrir({ quarts: [], tours: [] });
  eq('aucun quart ouvert : pas en service, et on le SAIT (« hors service », pas « inconnu »)', [m.run('monQuart'), m.run('enService()'), m.run('_quartConnu'), pastille(m).texte, pastille(m).classe], [null, false, true, '⚪ Hors service', 'quart-off']);
  eq('la copie du téléphone dit « pas en service » (une copie « rien » existe)', [!!cleQuart(m), m.memoire()[cleQuart(m)]?.data], [true, null]);
  m.fin();
}
{
  const m = await ouvrir({ quarts: [quartServeur({ id: 'q-collegue', utilisateur_id: 'u-marc' })], tours: [] });
  eq('le quart d\'un COLLÈGUE n\'est jamais le mien : je ne suis pas en service', [m.run('monQuart'), m.run('enService()')], [null, false]);
  vrai('… on ne demande que MES quarts (filtre sur mon numéro d\'employé, en plus des règles du serveur)', /\.eq\('utilisateur_id',currentUser\.id\)/.test(lire('js/quart.js')));
  m.fin();
}
{
  const m = await ouvrir({ quarts: [quartServeur({ fin: iso(5) })], tours: [] });
  eq('un quart déjà TERMINÉ n\'est jamais « en cours », quoi que réponde le serveur', [m.run('monQuart'), pastille(m).classe], [null, 'quart-off']);
  m.fin();
}
{
  const m = await ouvrir({ quarts: [quartServeur({ a_valider: true, raison_a_valider: 'ouvert_par_passe', debut_source: 'passe' })] });
  eq('un quart ouvert automatiquement (par la passe) : la pastille l\'explique dans son titre', m.el('quart-pastille').attrs.title.includes('ouvert automatiquement : à valider'), true);
  m.fin();
}
{
  // Pas encore lu (ni du serveur ni du téléphone) : on ne prétend rien
  const m = monde({ enLigne: false });
  eq('avant toute lecture : « inconnu », jamais « en service » ni « hors service »', [m.run('_quartConnu'), m.run('etatPastilleQuart().classe')], [false, 'inconnu']);
  m.fin();
}
{
  // Une passe en cours = en service (le serveur a ouvert un quart pour elle), même si le quart n'est pas encore connu
  const m = await ouvrir({ quarts: [] });
  eq('avec une passe à moi en cours et aucun quart connu : « en service »', [m.run('maPasse()!==null'), m.run('enService()'), pastille(m).texte], [true, true, '🟢 En service']);
  m.fin();
}
{
  // Déconnecté : la pastille disparaît et le logo revient
  const m = await ouvrir({ quarts: [quartServeur()] });
  m.run('currentUser=null; majPastilleQuart()');
  eq('personne de connecté : pas de pastille, le logo est là', [pastille(m).visible, pastille(m).logo], ['none', '']);
  m.fin();
}

log('\n=== LES PUNCHS FAITS SANS RÉSEAU SE VOIENT TOUT DE SUITE (par-dessus la copie du serveur) ===');
{
  const m = await ouvrir({ quarts: [], tours: [] }); coupe(m);
  const r = await m.enfiler('quart_commencer', { id: 'q-local', lat: 46.4, lon: -72.9, precision: 12 }, { libelle: '▶ Quart commencé' });
  eq('« Je commence » sans réseau : je suis en service tout de suite, avec ⏳', [r.ok, m.run('monQuart.id'), m.run('monQuart.local'), pastille(m).texte.endsWith(' ⏳'), m.run('enService()')], [true, 'q-local', true, true, true]);
  eq('la copie du serveur est INTACTE (pas de quart) : en mémoire et sur le téléphone', [m.run('_quartServeur'), m.memoire()[cleQuart(m)]?.data], [null, null]);
  eq('l\'heure du quart est celle du GESTE', Math.abs(Date.parse(m.run('monQuart.debut')) - Date.now()) < 5000, true);
  await m.enfiler('quart_terminer', { quartId: 'q-local' }, { libelle: '■ Quart terminé' });
  eq('« Je termine » ensuite : plus en service (les deux gestes attendent, dans l\'ordre)', [m.run('monQuart'), m.run('enService()'), m.run('gestesEnAttente().map(g=>g.type)'), pastille(m).classe], [null, false, ['quart_commencer', 'quart_terminer'], 'quart-off']);
  m.fin();
}
{
  // Un quart du serveur, terminé sans réseau : avec son numéro, et sans numéro (« mon quart ouvert »)
  for (const [nom, args] of [['avec son numéro', { quartId: 'q-serveur' }], ['sans numéro (mon quart ouvert)', {}]]) {
    const m = await ouvrir({ quarts: [quartServeur()] }); coupe(m);
    await m.enfiler('quart_terminer', args);
    eq(`« Je termine » ${nom} : je ne suis plus en service ; la copie du serveur garde le quart ouvert`, [m.run('monQuart'), m.run('_quartServeur.id')], [null, 'q-serveur']);
    m.fin();
  }
  const m = await ouvrir({ quarts: [quartServeur()] }); coupe(m);
  await m.enfiler('quart_terminer', { quartId: 'un-autre-quart' });
  eq('terminer un AUTRE quart (numéro différent) : rien ne change', m.run('monQuart.id'), 'q-serveur');
  await m.enfiler('quart_commencer', { id: 'q-double' });
  eq('« Je commence » alors que je suis déjà en service : on garde le quart du serveur (le serveur répondrait « déjà en quart »)', [m.run('monQuart.id'), m.run('monQuart.local')], ['q-serveur', undefined]);
  m.fin();
}
{
  // Débuter une passe sans être en service : le serveur ouvre le quart (à valider)
  const m = await ouvrir({ tours: [], equipes: E1E2, quarts: [] }); coupe(m);
  await debuterHors(m);
  eq('débuter une passe sans avoir puncher : le quart s\'ouvre tout seul (comme le fera le serveur), « à valider », sans numéro connu', [m.run('monQuart.debut_source'), m.run('monQuart.a_valider'), m.run('monQuart.id'), m.run('enService()')], ['passe', true, null, true]);
  m.fin();
  const n = await ouvrir({ tours: [], equipes: E1E2, quarts: [quartServeur()] }); coupe(n);
  await debuterHors(n);
  eq('… mais si je suis déjà en service, mon quart reste le mien', [n.run('monQuart.id'), n.run('monQuart.debut_source')], ['q-serveur', 'manuel']);
  n.fin();
}
{
  // Le serveur a déjà le quart (réponse perdue) et le geste attend encore : aucun doublon
  const m = await ouvrir({ quarts: [quartServeur({ id: 'q-deja' })] }); coupe(m);
  await m.enfiler('quart_commencer', { id: 'q-deja' });
  eq('le serveur a déjà ce quart : c\'est SON quart qui est affiché (pas « local »), un seul', [m.run('monQuart.id'), m.run('monQuart.local')], ['q-deja', undefined]);
  m.fin();
}

log('\n=== AU RETOUR DU SIGNAL : LE QUART PART AVEC L\'HEURE DU GESTE, LE SERVEUR A LE DERNIER MOT ===');
{
  const serveur = { quart_commencer: (args, n, d) => { d.quarts.push({ id: args.p_id, utilisateur_id: 'u-luc', debut: args.p_moment, fin: null, debut_source: 'manuel', a_valider: false }); return { data: { statut: 'commence', quart_id: args.p_id }, error: null }; } };
  const m = await ouvrir({ quarts: [], monde: { serveur } }); coupe(m);
  await m.enfiler('quart_commencer', { id: 'q-retour', lat: 46.4, lon: -72.9, precision: 8 });
  await attendre(40);
  const tRetour = Date.now();
  m.reseau(true);
  vrai('le geste part et la file se vide', await attendreQue(() => m.attentes().length === 0 && m.run('reseau.enLigne')));
  const a = m.appels.envois.find((x) => x.nom === 'quart_commencer')?.args;
  eq('il porte le numéro du quart, l\'heure du geste, la position ET la précision du GPS', [a?.p_id, typeof a?.p_moment, a?.p_lat, a?.p_lon, a?.p_precision], ['q-retour', 'string', 46.4, -72.9, 8]);
  vrai('… et l\'heure est celle du geste (avant le retour du signal)', Date.parse(a?.p_moment) <= tRetour && tRetour - Date.parse(a?.p_moment) < 60000, a?.p_moment);
  await attendreQue(() => m.run('monQuart') && !m.run('monQuart.local'));
  eq('le serveur a le dernier mot : le quart est celui du serveur (plus de ⏳)', [m.run('monQuart.id'), m.run('monQuart.local'), pastille(m).texte.includes('⏳')], ['q-retour', undefined, false]);
  m.fin();
}
{
  // « Je termine » envoie le numéro du quart visé (ou rien : « mon quart ouvert »), l'heure du geste, la position et la précision
  for (const [nom, args, attendu] of [['avec le numéro du quart', { quartId: 'q-serveur', lat: 46.5, lon: -72.8, precision: 15 }, 'q-serveur'], ['sans numéro (mon quart ouvert)', { lat: 46.5, lon: -72.8, precision: 15 }, null]]) {
    const m = await ouvrir({ quarts: [quartServeur()], tours: [] }); coupe(m);
    await m.enfiler('quart_terminer', args);
    m.reseau(true);
    await attendreQue(() => m.attentes().length === 0 && m.run('reseau.enLigne'));
    const t = m.appels.envois.find((x) => x.nom === 'quart_terminer')?.args;
    eq(`« Je termine » ${nom} : le serveur reçoit le bon numéro, l'heure du geste, la position et la précision`, [t?.p_quart_id, typeof t?.p_moment, t?.p_lat, t?.p_lon, t?.p_precision], [attendu, 'string', 46.5, -72.8, 15]);
    m.fin();
  }
}
{
  // Un renvoi : le serveur répond « déjà en quart » ou « déjà terminé » : ce sont des succès
  for (const [nom, type, args, reponse] of [['« déjà en quart »', 'quart_commencer', { id: 'q-x' }, { statut: 'deja_en_quart', quart_id: 'q-autre' }], ['« déjà enregistré »', 'quart_commencer', { id: 'q-y' }, { statut: 'deja_enregistre', quart_id: 'q-y' }], ['« déjà terminé »', 'quart_terminer', { quartId: 'q-z' }, { statut: 'deja_termine', quart_id: 'q-z' }]]) {
    const m = await ouvrir({ quarts: [], monde: { serveur: { [type]: () => ({ data: reponse, error: null }) } } }); coupe(m);
    await m.enfiler(type, args);
    m.reseau(true);
    vrai(`${nom} : traité comme réussi (rien dans « non envoyés »)`, await attendreQue(() => m.attentes().length === 0 && m.run('reseau.enLigne')) && m.refus().length === 0);
    m.fin();
  }
}
{
  // Refus : chevauchement
  const m = await ouvrir({ quarts: [], tours: [], monde: { serveur: { quart_commencer: () => ({ data: { statut: 'chevauchement' }, error: null }) } } }); coupe(m);
  await m.enfiler('quart_commencer', { id: 'q-chev' }, { libelle: '▶ Quart commencé' });
  eq('hors réseau : je suis en service (⏳)', m.run('enService()'), true);
  m.reseau(true);
  vrai('« chevauchement » : refusé et noté, avec la raison en français', await attendreQue(() => m.refus().length === 1 && m.attentes().length === 0));
  eq('… la raison', m.refus()[0].raison, 'Ce quart chevauchait un autre de tes quarts : il n’a pas été enregistré.');
  await attendreQue(() => m.run('_quartConnu') && !m.run('enService()'));
  eq('l\'écran revient à la vérité du serveur : pas en service', [m.run('enService()'), pastille(m).classe], [false, 'quart-off']);
  m.fin();
}
{
  // Terminer un quart qui n'existe pas (ou qui n'est pas à moi) : refus, jamais de plantage
  const m = await ouvrir({ quarts: [], monde: { serveur: { quart_terminer: () => ({ data: null, error: { code: 'P0001', message: 'quart_introuvable' } }) } } }); coupe(m);
  await m.enfiler('quart_terminer', { quartId: 'q-fantome' });
  m.reseau(true);
  vrai('« quart introuvable » : noté dans « non envoyés » avec sa raison', await attendreQue(() => m.refus().length === 1 && m.attentes().length === 0));
  eq('… la raison', m.refus()[0].raison, 'Ce quart n’existe plus ou n’est pas à toi : la fin du quart n’a pas été enregistrée.');
  m.fin();
}

log('\n=== L\'ÉTAT DU QUART SE RELIT TOUT SEUL, ET SURVIT À LA FERMETURE DE L\'APPLICATION ===');
{
  const m = await ouvrir({ quarts: [quartServeur()], tours: [] });
  const avant = m.appels.lectures.filter((x) => x === 'quarts').length;
  m.run('_tickRelecture=3');
  await m.run('rafraichirEnCours()');   // le 4e passage (une fois par minute) relit aussi mon quart
  eq('une fois par minute : mon quart est relu (l\'administrateur ou le serveur a pu le fermer), avec la lecture de l\'avis « quart terminé par le chauffeur » : 2 lectures de mes quarts', m.appels.lectures.filter((x) => x === 'quarts').length - avant, 2);
  m.donnees.quarts = [];
  m.run('_tickRelecture=3');
  await m.run('rafraichirEnCours()');
  eq('… et si le quart a été fermé ailleurs, la pastille passe à « hors service »', [m.run('monQuart'), pastille(m).classe], [null, 'quart-off']);
  m.fin();
}
{
  const a = await ouvrir({ quarts: [quartServeur()] }); await a.run('attendreEcritures()');
  const surLeTelephone = a.memoire(); a.fin();
  const b = monde({ enLigne: false, memoire: surLeTelephone });
  await b.run('loadStops()');
  eq('on rouvre l\'application SANS réseau : je suis toujours en service (la copie du téléphone)', [b.run('monQuart.id'), pastille(b).classe, b.run('enService()')], ['q-serveur', 'quart-on', true]);
  b.fin();
  // + un punch fait hors réseau avant la fermeture
  const c = await ouvrir({ quarts: [] }); coupe(c);
  await c.enfiler('quart_commencer', { id: 'q-avant-fermeture' }); await c.run('attendreEcritures()');
  const mem = c.memoire(); c.fin();
  const d = monde({ enLigne: false, memoire: mem });
  await d.run('loadStops()');
  eq('un « Je commence » fait sans réseau AVANT la fermeture de l\'application : toujours là à la réouverture', [d.run('monQuart.id'), d.run('monQuart.local'), d.attentes().length], ['q-avant-fermeture', true, 1]);
  d.fin();
}

// ══════════════════════════════════════════════════════════════════════
// ÉTAPE 17, MORCEAU 2 : LES GROS BOUTONS DU PUNCH (« JE COMMENCE » / « JE TERMINE »)
// ══════════════════════════════════════════════════════════════════════
const ecranQuart = (m) => ({ ouvert: m.el('quart-overlay').classList.contains('open'), plein: m.el('quart-overlay').classList.contains('plein'), html: m.el('quart-boite').innerHTML, quel: m.run('_ecranQuart'), msg: m.el('quart-msg').textContent });
const nbEnvois = (m, nom) => m.appels.envois.filter((x) => x.nom === nom).length;
const envoi = (m, nom) => m.appels.envois.find((x) => x.nom === nom)?.args;
// La confirmation : le titre (« Quart commencé à ») ET l'heure EN GROS sur sa propre ligne (jamais coupée en deux)
const confirme = (e, titre, heure) => e.html.includes('>' + titre + '</div>') && e.html.includes('<div class="quart-heure">' + heure + '</div>');
const rowQuart = (id, o = {}) => ({ id, utilisateur_id: 'u-luc', debut: iso(90), fin: null, debut_source: 'manuel', a_valider: false, raison_a_valider: null, ...o });
// Moi, passager du camion 2 (celui d'Eric)
const EQ_PASSAGER = [{ passe_id: 'p-eric', role: 'chauffeur', utilisateur_id: 'u-eric', utilisateurs: { nom: 'Eric' } }, { passe_id: 'p-eric', role: 'passager', utilisateur_id: 'u-luc', utilisateurs: { nom: 'Luc' } }];
const tourPassager = () => [tourInit({ passes: [{ ...PASSE_ERIC, je_suis_a_bord: true }] })];
// Un serveur qui applique vraiment « Je commence » et « Je termine » (pour voir ce que l'écran devient quand il a le dernier mot)
const serveurQuart = (o = {}) => ({
  quart_commencer: (a, n, d) => { d.quarts.push(rowQuart(a.p_id, { debut: o.debut })); return { data: { statut: 'commence', quart_id: a.p_id, debut: o.debut }, error: null }; },
  quart_terminer: (a, n, d) => {
    const q = d.quarts.find((x) => !x.fin);
    d.quarts = d.quarts.filter((x) => x !== q);
    d.tours.forEach((t) => { t.passes = t.passes.filter((p) => !p.je_suis_chauffeur); if (!t.passes.length) t.en_cours = false; });
    d.equipage_periodes = d.equipage_periodes.filter((x) => x.utilisateur_id !== 'u-luc');
    return { data: { statut: 'termine', quart_id: q?.id ?? null, fin: o.fin, passe_fermee: o.passeFermee ?? null }, error: null };
  },
});

log('\n=== L\'ÉCRAN D\'ACCUEIL « ▶ JE COMMENCE » : UNE FOIS À L\'OUVERTURE, JAMAIS BLOQUANT ===');
{
  const m = await ouvrir({ quarts: [], tours: [] });
  const e = ecranQuart(m);
  eq('pas en service à l\'ouverture : l\'écran d\'accueil s\'ouvre, en PLEIN écran', [e.ouvert, e.plein, e.quel], [true, true, 'accueil']);
  eq('… il salue la personne par son nom, offre le gros bouton « ▶ JE COMMENCE » et le petit lien « voir la carte »', [e.html.includes('Bonjour, Luc'), e.html.includes('▶ JE COMMENCE'), e.html.includes('voir la carte')], [true, true, true]);
  eq('… le gros bouton lance « commencerQuart », le lien ferme l\'écran', [/id="btn-quart-commencer"[^>]*onclick="commencerQuart\(\)"/.test(e.html), /onclick="fermerEcranQuart\(\)">voir la carte/.test(e.html)], [true, true]);
  m.run('fermerEcranQuart()');
  eq('« voir la carte » : l\'écran se ferme', ecranQuart(m).ouvert, false);
  await m.run('loadStops()'); await m.run('chargerMonQuart()');
  m.run('_tickRelecture=3'); await m.run('rafraichirEnCours()');
  eq('… et il ne revient PAS tout seul (rechargement des arrêts, relecture du quart, relecture d\'une minute)', [ecranQuart(m).ouvert, m.run('_accueilQuartPour')], [false, 'u-luc']);
  m.fin();
}
{
  const m = await ouvrir({ quarts: [rowQuart('q-serveur')] });
  eq('déjà en service (quart ouvert) : pas d\'écran d\'accueil', [ecranQuart(m).ouvert, m.run('_accueilQuartPour')], [false, 'u-luc']);
  m.fin();
  const n = await ouvrir({ quarts: [] });   // (tours par défaut : une passe à moi en cours)
  eq('une passe à moi en cours (donc en service) : pas d\'écran d\'accueil non plus', [n.run('enService()'), ecranQuart(n).ouvert], [true, false]);
  n.fin();
  const c = monde({ enLigne: false });
  await c.run('loadStops()');
  eq('on ne SAIT pas si je suis en service (aucune lecture, aucune copie, pas de réseau) : pas d\'écran d\'accueil', [c.run('_quartConnu'), ecranQuart(c).ouvert], [false, false]);
  c.run('verifierAccueilQuart()');
  eq('… même si on demande à l\'écran d\'accueil de se décider : il attend de savoir, et ne se marque pas « vu »', [ecranQuart(c).ouvert, c.run('_accueilQuartPour')], [false, null]);
  c.run('pastilleQuartTouchee()');
  eq('… et toucher la pastille le dit au lieu de deviner', [dernier(c), ecranQuart(c).ouvert], ['Je ne sais pas encore si tu es en service : un instant…', false]);
  c.fin();
}
{
  const a = await ouvrir({ quarts: [], tours: [] }); await a.run('attendreEcritures()');
  const surLeTelephone = a.memoire(); a.fin();
  const b = monde({ enLigne: false, memoire: surLeTelephone });
  await b.run('loadStops()');
  const e = ecranQuart(b);
  eq('on rouvre l\'application SANS réseau (la copie dit « pas en service ») : l\'écran d\'accueil s\'ouvre, avec la note « pas de réseau »', [e.ouvert, e.quel, e.html.includes('Pas de réseau : l’heure est gardée')], [true, 'accueil', true]);
  b.fin();
}
{
  const m = await ouvrir({ quarts: [], tours: [] });
  m.run('fermerEcranQuart()');
  m.run('currentUser={id:\'u-marc\',nom:\'Marc\',role:\'employe\'}; poserQuart()');
  eq('une AUTRE personne se connecte sur le même téléphone (sans recharger la page) : l\'écran d\'accueil s\'ouvre pour elle, à son nom', [ecranQuart(m).ouvert, ecranQuart(m).html.includes('Bonjour, Marc'), m.run('_accueilQuartPour')], [true, true, 'u-marc']);
  m.fin();
}

log('\n=== LA PASTILLE DU HAUT EST UN BOUTON ===');
{
  const m = await ouvrir({ quarts: [], tours: [] });
  m.run('fermerEcranQuart()'); m.run('pastilleQuartTouchee()');
  eq('hors service : toucher la pastille rouvre l\'écran d\'accueil', ecranQuart(m).quel, 'accueil');
  m.fin();
  const n = await ouvrir({ quarts: [rowQuart('q-serveur')], tours: [] });
  n.run('pastilleQuartTouchee()');
  const e = ecranQuart(n);
  eq('en service : toucher la pastille ouvre « ■ JE TERMINE » (une fenêtre, pas l\'écran plein), avec « Non, continuer »', [e.quel, e.plein, e.html.includes('■ JE TERMINE'), e.html.includes('Non, continuer')], ['fin', false, true, true]);
  eq('… il dit depuis quelle heure et la durée ; sans passe, aucun avertissement de passe', [e.html.includes('En service depuis ' + heureDe(n, n.run('monQuart.debut'))), /1 h 3\d de travail/.test(e.html), e.html.includes('sera terminée aussi')], [true, true, false]);
  n.run('fermerEcranQuart()');
  eq('« Non, continuer » ferme sans rien faire : toujours en service, aucun envoi', [ecranQuart(n).ouvert, n.run('enService()'), n.appels.envois.length], [false, true, 0]);
  n.fin();
  const p = await ouvrir({ quarts: [rowQuart('q-serveur', { a_valider: true, raison_a_valider: 'ouvert_par_passe', debut_source: 'passe' })], tours: tourPassager(), equipes: E1E2, equipages: EQ_PASSAGER });
  p.run('pastilleQuartTouchee()');
  eq('passager d\'un camion : « Tu descends de « Camion 2 » » ; un quart ouvert automatiquement l\'explique', [ecranQuart(p).html.includes('Tu descends de « Camion 2 ».'), ecranQuart(p).html.includes('s’est ouvert automatiquement')], [true, true]);
  p.fin();
  const q = await ouvrir({ quarts: [], tours: [] });
  q.run('fermerEcranQuart()');
  q.run('bgClickQuart({target:document.getElementById(\'quart-overlay\')})');
  eq('un toucher à côté de la fenêtre ne ferme PAS l\'écran d\'accueil (seulement « voir la carte »)', ecranQuart(q).ouvert, false);
  q.run('pastilleQuartTouchee(); bgClickQuart({target:document.getElementById(\'quart-overlay\')})');
  eq('… (l\'écran d\'accueil rouvert résiste à un toucher à côté)', ecranQuart(q).ouvert, true);
  q.fin();
  const r = await ouvrir({ quarts: [rowQuart('q-serveur')], tours: [] });
  r.run('pastilleQuartTouchee(); bgClickQuart({target:document.getElementById(\'quart-overlay\')})');
  eq('… alors qu\'un toucher à côté de « JE TERMINE » l\'annule (« Non, continuer »)', [ecranQuart(r).ouvert, r.run('enService()')], [false, true]);
  r.fin();
}
{
  // L'état change SOUS un écran ouvert : l'écran devenu inutile se ferme
  const m = await ouvrir({ quarts: [], tours: [] });
  eq('(décor) l\'écran d\'accueil est ouvert', ecranQuart(m).quel, 'accueil');
  await m.enfiler('quart_commencer', { id: 'q-ailleurs' });   // (un « Je commence » arrive par un autre chemin)
  eq('je suis maintenant en service : l\'écran d\'accueil, devenu inutile, se ferme tout seul', [m.run('enService()'), ecranQuart(m).ouvert], [true, false]);
  m.fin();
  const n = await ouvrir({ quarts: [rowQuart('q-serveur')], tours: [] });
  n.run('pastilleQuartTouchee()');
  n.donnees.quarts = [];   // l'administrateur (ou la fermeture automatique) a terminé mon quart
  await n.run('chargerMonQuart()');
  eq('mon quart est terminé ailleurs pendant que « JE TERMINE » est ouvert : la fenêtre se ferme (il n\'y a plus rien à terminer)', [n.run('enService()'), ecranQuart(n).ouvert], [false, false]);
  n.fin();
}
{
  // Les noms viennent de la base : jamais du HTML brut dans l'écran
  const m = await ouvrir({ quarts: [rowQuart('q-serveur')] });
  m.run('currentUser={id:\'u-luc\',nom:\'<b>Luc</b>\',role:\'employe\'}; routes[0].nom=\'<u>Charette</u>\'; fermerEcranQuart()');
  m.run('pastilleQuartTouchee()');
  const fin = ecranQuart(m).html;
  eq('le nom de la route (dans « JE TERMINE ») est échappé', [fin.includes('&lt;u&gt;Charette&lt;/u&gt;'), fin.includes('<u>')], [true, false]);
  m.run('fermerEcranQuart(); ouvrirEcranQuart(\'accueil\')');
  const acc = ecranQuart(m).html;
  eq('le nom de la personne (dans l\'écran d\'accueil) est échappé', [acc.includes('Bonjour, &lt;b&gt;Luc&lt;/b&gt;'), acc.includes('<b>')], [true, false]);
  m.fin();
}

log('\n=== « ▶ JE COMMENCE » EN LIGNE : L\'HEURE DU SERVEUR, LA CONFIRMATION, JAMAIS DEUX QUARTS ===');
{
  const debutServeur = iso(3);
  const m = await ouvrir({ quarts: [], tours: [], monde: { serveur: serveurQuart({ debut: debutServeur }) } });
  m.run('lastPos=[46.5,-72.8]');
  await m.run('commencerQuart()'); await attendre(30);
  const a = envoi(m, 'quart_commencer'), e = ecranQuart(m);
  eq('UN envoi : le numéro du quart (fabriqué par le téléphone), la position, SANS heure (c\'est celle du serveur)', [nbEnvois(m, 'quart_commencer'), typeof a.p_id, 'p_moment' in a, a.p_lat, a.p_lon, a.p_precision], [1, 'string', false, 46.5, -72.8, null]);
  eq('la confirmation dit l\'heure du SERVEUR (pas celle du téléphone), sans ⏳', [e.quel, confirme(e, 'Quart commencé à', heureDe(m, debutServeur)), e.html.includes('⏳'), e.html.includes('✔')], ['confirmation', true, false, true]);
  eq('la pastille : en service depuis cette heure, sans ⏳ ; c\'est le quart du serveur (pas un quart « local »)', [pastille(m).classe, pastille(m).texte, m.run('monQuart.id') === a.p_id, m.run('monQuart.local')], ['quart-on', '🟢 Depuis ' + heureDe(m, debutServeur), true, undefined]);
  eq('rien en attente ; l\'écran d\'accueil ne revient pas', [m.attentes().length, m.run('_accueilQuartPour')], [0, 'u-luc']);
  await m.run('attendreEcritures()');
  eq('la copie du téléphone garde ce quart (pour une ouverture sans réseau plus tard)', m.memoire()[cleQuart(m)]?.data?.id, a.p_id);
  m.run('fermerEcranQuart()');
  eq('« OK » ferme la confirmation', ecranQuart(m).ouvert, false);
  await m.run('commencerQuart()');
  eq('« Je commence » alors que je suis déjà en service : rien n\'est envoyé de plus, et on le dit', [nbEnvois(m, 'quart_commencer'), dernier(m)], [1, 'Tu es déjà en service.']);
  m.fin();
}
{
  const m = await ouvrir({ quarts: [], tours: [], monde: { serveur: serveurQuart({ debut: iso(3) }) } });
  m.run('DELAI_CONFIRMATION_QUART_MS=80');
  await m.run('commencerQuart()');
  eq('la confirmation est affichée', ecranQuart(m).quel, 'confirmation');
  await attendre(250);
  eq('… et elle se ferme toute seule après quelques secondes (ici 80 ms)', [ecranQuart(m).ouvert, m.run('_ecranQuart')], [false, null]);
  m.fin();
}
{
  // La réponse du serveur arrive, PUIS le signal disparaît : la relecture de contrôle échoue, mais je suis quand même en service (le quart est posé tout de suite)
  let mm;
  const debutServeur = iso(3);
  const serveur = { quart_commencer: (a, n, d) => { d.quarts.push(rowQuart(a.p_id, { debut: debutServeur })); mm.reseau(false); return { data: { statut: 'commence', quart_id: a.p_id, debut: debutServeur }, error: null }; } };
  const m = await ouvrir({ quarts: [], tours: [], monde: { serveur } }); mm = m;
  await m.run('commencerQuart()'); await attendre(60);
  eq('le serveur répond puis le signal disparaît : je suis en service (pas « hors service »), sans ⏳ (le serveur a le quart)', [m.run('enService()'), pastille(m).classe, pastille(m).texte.includes('⏳'), m.attentes().length], [true, 'quart-on', false, 0]);
  m.fin();
}
{
  const m = await ouvrir({ quarts: [], tours: [], monde: { delaiEnvoiMs: 60, serveur: serveurQuart({ debut: iso(3) }) } });
  const premier = m.run('commencerQuart()');
  await attendre(20);
  eq('pendant l\'envoi, le gros bouton est grisé (et il redevient utilisable ensuite)', m.el('btn-quart-commencer').disabled, true);
  await Promise.all([premier, m.run('commencerQuart()')]);
  eq('deux touchers presque en même temps : UN seul envoi (jamais deux quarts)', nbEnvois(m, 'quart_commencer'), 1);
  eq('… et le bouton est de nouveau utilisable', m.el('btn-quart-commencer').disabled, false);
  m.fin();
}

log('\n=== « ▶ JE COMMENCE » : LES REFUS DU SERVEUR ET LES PANNES ===');
{
  const m = await ouvrir({ quarts: [], tours: [], monde: { serveur: { quart_commencer: () => ({ data: { statut: 'chevauchement' }, error: null }) } } });
  await m.run('commencerQuart()');
  const e = ecranQuart(m);
  eq('« chevauchement » : message clair DANS l\'écran, JAMAIS de fausse confirmation, pas en service, bouton utilisable', [e.quel, e.msg.includes('chevauche un autre de tes quarts'), m.run('enService()'), m.el('btn-quart-commencer').disabled], ['accueil', true, false, false]);
  m.fin();
}
{
  const m = await ouvrir({ quarts: [], tours: [], monde: { serveur: { quart_commencer: (a, n, d) => { d.quarts.push(rowQuart('q-autre-tel', { debut: iso(20) })); return { data: { statut: 'deja_en_quart', quart_id: 'q-autre-tel' }, error: null }; } } } });
  await m.run('commencerQuart()');
  eq('« déjà en quart » (commencé sur un autre appareil) : l\'écran se ferme, message, et c\'est CE quart-là qui est le mien', [ecranQuart(m).ouvert, dernier(m), m.run('monQuart.id')], [false, 'Tu étais déjà en service.', 'q-autre-tel']);
  m.fin();
}
{
  const m = await ouvrir({ quarts: [], tours: [], monde: { serveur: { quart_commencer: () => ({ data: null, error: { code: 'P0001', message: 'non_autorise' } }) } } });
  await m.run('commencerQuart()');
  eq('le serveur REFUSE (compte désactivé) : message dans l\'écran, rien n\'est gardé, pas en service', [ecranQuart(m).msg, m.attentes().length, m.run('enService()')], ['❌ Ton compte ne peut pas faire ce geste.', 0, false]);
  m.fin();
}
{
  const m = await ouvrir({ quarts: [], tours: [], monde: { serveur: { quart_commencer: () => new Promise(() => {}) } } });
  m.run('FILE_DELAI_DIRECT_MS=40');
  await m.run('commencerQuart()');
  eq('le serveur ne répond pas (10 s dans l\'application) : le geste passe à la file avec le MÊME numéro que l\'envoi direct (jamais deux quarts)', [nbEnvois(m, 'quart_commencer'), m.run('gestesEnAttente().map(g=>g.type)'), m.run('gestesEnAttente()[0].args.id') === envoi(m, 'quart_commencer').p_id], [1, ['quart_commencer'], true]);
  eq('… la confirmation dit ⏳, et je suis en service tout de suite (⏳ sur la pastille)', [ecranQuart(m).html.includes('⏳ Envoyé au retour du signal'), pastille(m).classe, pastille(m).texte.endsWith(' ⏳')], [true, 'quart-on', true]);
  m.fin();
}
{
  const m = await ouvrir({ quarts: [], tours: [] });
  m.reseau(false);   // le signal disparaît AU MOMENT du toucher (l'application ne le sait pas encore)
  await m.run('commencerQuart()');
  eq('le signal disparaît au toucher : le geste passe à la file, la confirmation dit ⏳', [m.run('gestesEnAttente().map(g=>g.type)'), ecranQuart(m).html.includes('⏳ Envoyé au retour du signal'), m.run('reseau.enLigne')], [['quart_commencer'], true, false]);
  m.fin();
}

log('\n=== « ▶ JE COMMENCE » SANS RÉSEAU : EN SERVICE TOUT DE SUITE, L\'HEURE EST GARDÉE ===');
{
  const m = await ouvrir({ quarts: [], tours: [] }); coupe(m);
  m.run('lastPos=[46.5,-72.8]');
  m.run('fermerEcranQuart()'); m.run('pastilleQuartTouchee()');   // (l'écran d'accueil rouvert, cette fois sans réseau)
  eq('(l\'écran d\'accueil, rouvert sans réseau, dit la note « pas de réseau »)', ecranQuart(m).html.includes('Pas de réseau : l’heure est gardée'), true);
  await m.run('commencerQuart()');
  const g = m.run('gestesEnAttente()[0]'), e = ecranQuart(m);
  eq('rien n\'est envoyé ; UN geste gardé : « Je commence », avec le numéro du quart et la position', [m.appels.envois.length, m.run('gestesEnAttente().map(g=>g.type)'), typeof g.args.id, g.args.lat, g.args.lon], [0, ['quart_commencer'], 'string', 46.5, -72.8]);
  eq('la confirmation dit l\'heure du TÉLÉPHONE (celle du geste) ET « ⏳ Envoyé au retour du signal »', [e.quel, confirme(e, 'Quart commencé à', heureDe(m, g.moment)), e.html.includes('⏳ Envoyé au retour du signal'), Math.abs(Date.parse(g.moment) - Date.now()) < 5000], ['confirmation', true, true, true]);
  eq('la pastille : en service avec ⏳ ; le quart affiché est le quart LOCAL', [pastille(m).classe, pastille(m).texte.endsWith(' ⏳'), m.run('monQuart.id') === g.args.id, m.run('monQuart.local')], ['quart-on', true, true, true]);
  m.fin();
}
{
  const m = await ouvrir({ quarts: [], tours: [] }); coupe(m);
  m.run('magasinEcrire=async()=>false');
  await m.run('commencerQuart()');
  eq('« Je commence » sans pouvoir garder le geste : JAMAIS « commencé » (pas en service, message d\'erreur dans l\'écran, bouton utilisable)', [m.run('enService()'), m.attentes().length, ecranQuart(m).msg, m.el('btn-quart-commencer').disabled], [false, 0, '❌ Le téléphone n’a pas pu garder ce geste. Réessaie.', false]);
  m.fin();
}

log('\n=== « ■ JE TERMINE » EN LIGNE : L\'HEURE DU SERVEUR, MA PASSE TERMINÉE AUSSI ===');
{
  const finServeur = iso(2);
  const m = await ouvrir({ quarts: [rowQuart('q-serveur')], monde: { serveur: serveurQuart({ fin: finServeur, passeFermee: 'p-luc' }) } });
  m.run('lastPos=[46.5,-72.8]');
  m.run('__ouv=[];{const o=ouvrirEcranQuart;ouvrirEcranQuart=(q)=>{__ouv.push(q);o(q);};}');   // (on note les écrans ouverts)
  m.run('pastilleQuartTouchee()');
  const e0 = ecranQuart(m);
  eq('avec une passe en cours : l\'écran dit qu\'elle sera terminée aussi (numéro et route)', e0.html.includes('Ta passe n° 1 (Charette) sera terminée aussi.'), true);
  eq('… le gros bouton rouge lance « terminerQuart »', /id="btn-quart-terminer"[^>]*onclick="terminerQuart\(\)"/.test(e0.html), true);
  await m.run('terminerQuart()');
  const a = envoi(m, 'quart_terminer'), e = ecranQuart(m);
  eq('UN envoi : le numéro de MON quart, la position, SANS heure (c\'est celle du serveur)', [nbEnvois(m, 'quart_terminer'), a.p_quart_id, 'p_moment' in a, a.p_lat, a.p_lon], [1, 'q-serveur', false, 46.5, -72.8]);
  eq('la confirmation dit l\'heure du SERVEUR, la durée (du début à cette heure) et que la passe est terminée aussi, sans ⏳', [e.quel, confirme(e, 'Quart terminé à', heureDe(m, finServeur)), /Durée : 1 h 2\d/.test(e.html), e.html.includes('Ta passe n° 1 a été terminée aussi.'), e.html.includes('⏳')], ['confirmation', true, true, true, false]);
  eq('je ne suis plus en service (ni quart, ni passe) : pastille « hors service » ; l\'écran d\'accueil ne revient pas tout seul', [m.run('monQuart'), m.run('maPasse()'), pastille(m).classe, e.quel], [null, null, 'quart-off', 'confirmation']);
  await attendre(80);   // (le résumé d'une passe se lit en ligne : il arriverait après un instant)
  eq('AUCUN résumé de passe (je viens de la terminer moi-même)', m.el('resume-overlay').classList.contains('open'), false);
  eq('l\'écran d\'accueil ne s\'est JAMAIS rouvert pendant tout ça (seulement « JE TERMINE », puis la confirmation)', m.run('__ouv'), ['fin']);
  await m.run('attendreEcritures()');
  eq('la copie du téléphone dit « pas en service » ; rien en attente', [m.memoire()[cleQuart(m)]?.data, m.attentes().length], [null, 0]);
  m.fin();
}
{
  // Le serveur termine le quart, PUIS le signal disparaît : la relecture échoue, mais la copie du téléphone doit dire « pas en service »
  // (sinon, rouvert sans réseau, le téléphone montrerait encore un quart ouvert)
  let mm;
  const serveur = { quart_terminer: (a, n, d) => { d.quarts = []; mm.reseau(false); return { data: { statut: 'termine', quart_id: 'q-serveur', fin: iso(1), passe_fermee: null }, error: null }; } };
  const m = await ouvrir({ quarts: [rowQuart('q-serveur')], tours: [], monde: { serveur } }); mm = m;
  m.run('pastilleQuartTouchee()'); await m.run('terminerQuart()'); await m.run('attendreEcritures()');
  eq('le serveur termine puis le signal disparaît : je ne suis plus en service, et la copie du téléphone le dit aussi (pas de quart « fantôme » à la réouverture)', [m.run('enService()'), m.memoire()[cleQuart(m)]?.data], [false, null]);
  m.fin();
}
{
  const fin30 = iso(30);
  const m = await ouvrir({ quarts: [rowQuart('q-serveur')], tours: [], monde: { serveur: { quart_terminer: (a, n, d) => { d.quarts = []; return { data: { statut: 'deja_termine', quart_id: 'q-serveur', fin: fin30 }, error: null }; } } } });
  m.run('pastilleQuartTouchee()'); await m.run('terminerQuart()');
  eq('« déjà terminé » (un renvoi, ou terminé sur un autre appareil) : la confirmation le dit, avec l\'heure de fin déjà enregistrée ; plus en service', [confirme(ecranQuart(m), 'Quart déjà terminé à', heureDe(m, fin30)), m.run('enService()')], [true, false]);
  m.fin();
}
{
  const m = await ouvrir({ quarts: [rowQuart('q-serveur')], tours: [], monde: { serveur: { quart_terminer: (a, n, d) => { d.quarts = []; return { data: { statut: 'pas_en_quart' }, error: null }; } } } });
  m.run('pastilleQuartTouchee()'); await m.run('terminerQuart()');
  eq('« pas en quart » (rien à terminer) : l\'écran se ferme et le message le dit', [ecranQuart(m).ouvert, dernier(m)], [false, 'Tu n’étais pas en service.']);
  m.fin();
}
{
  const m = await ouvrir({ quarts: [rowQuart('q-serveur')], tours: [], monde: { serveur: { quart_terminer: (a, n, d) => { d.quarts = []; return { data: null, error: { code: 'P0001', message: 'quart_introuvable' } }; } } } });
  m.run('pastilleQuartTouchee()'); await m.run('terminerQuart()');
  eq('« quart introuvable » (fermé entre-temps par le serveur ou l\'administrateur) : l\'écran se remet à jour, se ferme, et le dit', [ecranQuart(m).ouvert, dernier(m), m.run('enService()')], [false, 'Ce quart n’existe plus : il était déjà terminé.', false]);
  m.fin();
}
{
  const m = await ouvrir({ quarts: [rowQuart('q-serveur')], tours: [], monde: { serveur: { quart_terminer: () => ({ data: null, error: { code: 'P0001', message: 'non_autorise' } }) } } });
  m.run('pastilleQuartTouchee()'); await m.run('terminerQuart()');
  eq('le serveur REFUSE : message dans l\'écran, JAMAIS « terminé », toujours en service, bouton utilisable, rien en attente', [ecranQuart(m).msg, m.run('enService()'), m.el('btn-quart-terminer').disabled, m.attentes().length], ['❌ Ton compte ne peut pas faire ce geste.', true, false, 0]);
  m.fin();
}
{
  const m = await ouvrir({ quarts: [rowQuart('q-serveur')], monde: { delaiEnvoiMs: 60, serveur: serveurQuart({ fin: iso(1), passeFermee: 'p-luc' }) } });
  m.run('pastilleQuartTouchee()');
  await Promise.all([m.run('terminerQuart()'), m.run('terminerQuart()')]);
  eq('deux touchers presque en même temps : UN seul envoi', nbEnvois(m, 'quart_terminer'), 1);
  m.fin();
  const n = await ouvrir({ quarts: [], tours: [] });
  await n.run('terminerQuart()');
  eq('pas en service : « Je termine » ne fait rien, et le dit', [nbEnvois(n, 'quart_terminer'), dernier(n)], [0, 'Tu n’es pas en service.']);
  n.fin();
}

log('\n=== « ■ JE TERMINE » SANS RÉSEAU : MA PASSE SE FERME À L\'ÉCRAN, JE SORS DU CAMION ===');
{
  const m = await ouvrir({ quarts: [rowQuart('q-serveur')] }); coupe(m);   // (tours par défaut : MA passe p-luc en cours)
  m.run('__ouv=[];{const o=ouvrirEcranQuart;ouvrirEcranQuart=(q)=>{__ouv.push(q);o(q);};}');
  m.run('pastilleQuartTouchee()');
  eq('(l\'écran de fin dit la note « pas de réseau »)', ecranQuart(m).html.includes('Pas de réseau : l’heure est gardée'), true);
  await m.run('terminerQuart()');
  const e = ecranQuart(m), g = m.run('gestesEnAttente()[0]');
  eq('rien n\'est envoyé ; UN geste gardé : terminer MON quart (numéro connu), avec l\'heure du geste', [m.appels.envois.length, m.run('gestesEnAttente().map(g=>[g.type,g.args.quartId])'), Math.abs(Date.parse(g.moment) - Date.now()) < 5000], [0, [['quart_terminer', 'q-serveur']], true]);
  eq('je ne suis plus en service (ni quart, ni passe) : pastille « hors service »', [m.run('monQuart'), m.run('maPasse()'), m.run('enService()'), pastille(m).classe], [null, null, false, 'quart-off']);
  eq('ma passe est fermée à l\'écran : le bandeau offre « Débuter » et plus « Terminer », le tour n\'a plus de camion', [m.el('passe-bandeau').innerHTML.includes('btn-debuter'), m.el('passe-bandeau').innerHTML.includes('btn-terminer'), m.run('tours[0].passes.length'), m.run('tours[0].en_cours')], [true, false, 0, false]);
  eq('je suis sorti du camion (plus d\'équipage pour ma passe)', m.run('equipages[\'p-luc\']'), undefined);
  eq('AUCUN résumé de passe (je viens de terminer moi-même)', m.el('resume-overlay').classList.contains('open'), false);
  eq('l\'écran d\'accueil ne s\'est JAMAIS rouvert pendant tout ça', m.run('__ouv'), ['fin']);
  eq('la confirmation : l\'heure du téléphone, ⏳, la durée, ma passe terminée aussi', [e.quel, confirme(e, 'Quart terminé à', heureDe(m, g.moment)), e.html.includes('⏳ Envoyé au retour du signal'), /Durée : 1 h 3\d/.test(e.html), e.html.includes('Ta passe n° 1 a été terminée aussi.')], ['confirmation', true, true, true, true]);
  eq('les copies du serveur sont INTACTES (quart ouvert, passe en cours)', [m.run('_quartServeur.id'), m.run('_toursServeur[0].passes.length')], ['q-serveur', 1]);
  m.fin();
}
{
  // Un quart ouvert PAR LA PASSE (sans numéro connu du téléphone) : « Je termine » vise « mon quart ouvert »
  const m = await ouvrir({ tours: [], equipes: E1E2, quarts: [] }); coupe(m);
  await debuterHors(m);
  m.run('fermerEcranQuart()');
  m.run('pastilleQuartTouchee()');
  await m.run('terminerQuart()');
  eq('« Je termine » : le geste vise « mon quart ouvert » (numéro vide), après le début de la passe', [m.run('gestesEnAttente().map(g=>g.type)'), m.run('gestesEnAttente()[1].args.quartId')], [['debuter_passe', 'quart_terminer'], null]);
  eq('… la passe débutée hors réseau est terminée aussi ; je ne suis plus en service', [m.run('maPasse()'), m.run('enService()')], [null, false]);
  m.fin();
}
{
  // Passager d'un camion : « Je termine » me fait descendre ; le camion continue pour les autres
  const m = await ouvrir({ quarts: [rowQuart('q-serveur')], tours: tourPassager(), equipes: E1E2, equipages: EQ_PASSAGER }); coupe(m);
  eq('(décor) je suis passager du camion 2, pas chauffeur', [m.run('monBord()!==null'), m.run('maPasse()')], [true, null]);
  m.run('pastilleQuartTouchee()');
  await m.run('terminerQuart()');
  eq('après « Je termine » : plus à bord (le camion continue avec Eric) et plus en service', [m.run('monBord()'), nomsA(m, 'p-eric'), m.run('enService()')], [null, ['Eric'], false]);
  eq('… la confirmation ne parle pas de passe (ce n\'est pas la mienne)', ecranQuart(m).html.includes('Ta passe'), false);
  m.fin();
}
{
  const m = await ouvrir({ quarts: [rowQuart('q-serveur')] });
  m.reseau(false);   // le signal disparaît AU MOMENT du toucher
  m.run('pastilleQuartTouchee()');
  await m.run('terminerQuart()');
  eq('le signal disparaît au toucher : le geste passe à la file, ma passe est fermée à l\'écran, la confirmation dit ⏳', [m.run('gestesEnAttente().map(g=>g.type)'), m.run('maPasse()'), ecranQuart(m).html.includes('⏳ Envoyé au retour du signal')], [['quart_terminer'], null, true]);
  m.fin();
}
{
  const m = await ouvrir({ quarts: [rowQuart('q-serveur')] }); coupe(m);
  m.run('magasinEcrire=async()=>false');
  m.run('pastilleQuartTouchee()');
  await m.run('terminerQuart()');
  eq('« Je termine » sans pouvoir garder le geste : JAMAIS « terminé » (toujours en service, ma passe reste, message d\'erreur dans l\'écran, bouton utilisable)', [m.run('enService()'), m.run('maPasse()!==null'), m.attentes().length, ecranQuart(m).msg, m.el('btn-quart-terminer').disabled], [true, true, 0, '❌ Le téléphone n’a pas pu garder ce geste. Réessaie.', false]);
  m.fin();
}
{
  // Le serveur a DÉJÀ tout fait (la réponse s'était perdue) et le geste attend encore : rien n'est appliqué deux fois
  const m = await ouvrir({ quarts: [], tours: [tourInit({ en_cours: false, passes: [], faits: 0 })] }); coupe(m);
  await m.enfiler('quart_terminer', { quartId: 'q-serveur' });
  eq('un « Je termine » en attente alors que le serveur n\'a déjà plus ni quart ni passe : rien de plus à l\'écran (pas de plantage, pas en service)', [m.run('monQuart'), m.run('maPasse()'), m.run('enService()'), m.run('tours[0].en_cours')], [null, null, false, false]);
  m.fin();
}

// ══════════════════════════════════════════════════════════════════════
// ÉTAPE 17, ÉQUIPAGE : « TERMINER AUSSI LE QUART DE… », « A TERMINÉ SA JOURNÉE ? », L'AVIS DU PASSAGER
// ══════════════════════════════════════════════════════════════════════
const EQ_EQUIPE = [{ passe_id: 'p-luc', role: 'chauffeur', utilisateur_id: 'u-luc', utilisateurs: { nom: 'Luc' } }, { passe_id: 'p-luc', role: 'passager', utilisateur_id: 'u-marc', utilisateurs: { nom: 'Marc' } }, { passe_id: 'p-luc', role: 'passager', utilisateur_id: 'u-nina', utilisateurs: { nom: 'Nina' } }];
const nbCoches = (e) => (e.html.match(/class="quart-equipier coche"/g) || []).length;
const equipiers = (m) => m.appels.envois.filter((x) => x.nom === 'quart_terminer_equipier').map((x) => x.args);
const toursFermes = () => [tourInit({ en_cours: false, passes: [], faits: 2, pourcentage: 100, arrets_faits: ['s1', 's2'], mes_passes_annulables: [] })];
const equipePrecedente = (minFin) => ({ passe_id: 'p-fermee', fin: iso(minFin), membres: [{ utilisateur_id: 'u-marc', nom: 'Marc' }, { utilisateur_id: 'u-nina', nom: 'Nina' }] });

log('\n=== « ■ JE TERMINE » : « TERMINER AUSSI LE QUART DE : » (cochés d\'avance) ===');
{
  const m = await ouvrir({ quarts: [rowQuart('q-serveur')], equipes: E1E2, equipages: EQ_EQUIPE });
  m.run('pastilleQuartTouchee()');
  const e = ecranQuart(m);
  eq('avec deux passagers à bord de MA passe : la liste les montre, les deux COCHÉS d\'avance (jamais moi)', [e.html.includes('Terminer aussi le quart de :'), nbCoches(e), e.html.includes('☑</span> Marc'), e.html.includes('☑</span> Nina'), e.html.includes('Luc</button>')], [true, 2, true, true, false]);
  eq('… chaque ligne est un gros bouton qui bascule la case', /class="quart-equipier coche" aria-pressed="true" onclick="basculerEquipierQuart\('u-marc'\)"/.test(e.html), true);
  m.run('basculerEquipierQuart(\'u-nina\')');
  const f = ecranQuart(m);
  eq('toucher « Nina » la décoche (elle continue ailleurs) : Marc reste coché', [nbCoches(f), f.html.includes('☐</span> Nina'), f.html.includes('☑</span> Marc')], [1, true, true]);
  m.run('basculerEquipierQuart(\'u-nina\')');
  eq('… la retoucher la recoche', nbCoches(ecranQuart(m)), 2);
  m.run('basculerEquipierQuart(\'u-inconnu\')');
  eq('un numéro qui n\'est pas dans la liste ne change rien (et n\'entre pas dans les cases)', [nbCoches(ecranQuart(m)), m.run('Object.keys(_equipeFin.coches).sort()')], [2, ['u-marc', 'u-nina']]);
  m.fin();
}
{
  const m = await ouvrir({ quarts: [rowQuart('q-serveur')] });   // moi seul à bord
  m.run('pastilleQuartTouchee()');
  eq('seul à bord : pas de liste', ecranQuart(m).html.includes('Terminer aussi'), false);
  m.fin();
  const p = await ouvrir({ quarts: [rowQuart('q-serveur')], tours: tourPassager(), equipes: E1E2, equipages: EQ_PASSAGER, equipagePrecedent: equipePrecedente(20) });   // (même avec une équipe récente d'une ancienne passe à moi)
  p.run('pastilleQuartTouchee()'); await attendre(30);
  eq('un PASSAGER n\'a pas de liste (il ne termine le quart de personne)', ecranQuart(p).html.includes('Terminer aussi'), false);
  p.fin();
}

log('\n=== « ■ JE TERMINE » AVEC L\'ÉQUIPE : EN LIGNE ===');
{
  const finServeur = iso(1);
  const m = await ouvrir({ quarts: [rowQuart('q-serveur')], equipes: E1E2, equipages: EQ_EQUIPE, monde: { serveur: serveurQuart({ fin: finServeur, passeFermee: 'p-luc' }) } });
  m.run('lastPos=[46.5,-72.8]');
  m.run('pastilleQuartTouchee()');
  m.run('basculerEquipierQuart(\'u-nina\')');   // Nina continue ailleurs : décochée
  await m.run('terminerQuart()');
  eq('le chauffeur d\'abord, PUIS chaque personne cochée (Marc seulement : Nina est décochée)', m.appels.evenements.filter((x) => x === 'E:quart_terminer' || x === 'E:quart_terminer_equipier'), ['E:quart_terminer', 'E:quart_terminer_equipier']);
  const a = equipiers(m)[0];
  eq('Marc : la passe, la personne, la MÊME heure que celle donnée par le serveur pour mon quart, la position', [a.p_passe_id, a.p_utilisateur_id, a.p_moment, a.p_lat, a.p_lon], ['p-luc', 'u-marc', finServeur, 46.5, -72.8]);
  const e = ecranQuart(m);
  eq('la confirmation dit que le quart de Marc est terminé aussi (rien sur Nina), et se ferme toute seule (aucun avertissement)', [e.html.includes('Quart terminé aussi pour : Marc.'), e.html.includes('Nina'), m.run('_tConfirmationQuart') !== null], [true, false, true]);
  m.fin();
}
{
  const m = await ouvrir({ quarts: [rowQuart('q-serveur')], equipes: E1E2, equipages: EQ_EQUIPE, monde: { serveur: serveurQuart({ fin: iso(1), passeFermee: 'p-luc' }) } });
  m.run('pastilleQuartTouchee()'); await m.run('terminerQuart()');
  eq('les deux cochés d\'avance : les deux quarts sont terminés, à la même heure', [equipiers(m).map((x) => x.p_utilisateur_id).sort(), new Set(equipiers(m).map((x) => x.p_moment)).size], [['u-marc', 'u-nina'], 1]);
  eq('… la confirmation les nomme', ecranQuart(m).html.includes('Quart terminé aussi pour : Marc, Nina.'), true);
  m.fin();
}
for (const [nom, reponse, texte] of [
  ['à bord d\'un autre camion', { data: { statut: 'refuse', raison: 'a_bord_ailleurs', vehicule: 'Camion 2' }, error: null }, '⚠ Marc est à bord de « Camion 2 » : son quart n’a pas été terminé.'],
  ['pas (ou plus) à bord', { data: { statut: 'refuse', raison: 'pas_a_bord' }, error: null }, '⚠ Marc n’était pas (ou plus) à bord de ta passe : son quart n’a pas été terminé.'],
  ['compte refusé', { data: null, error: { code: 'P0001', message: 'non_autorise' } }, '⚠ Le quart de Marc n’a pas pu être terminé : Ton compte ne peut pas faire ce geste.']]) {
  const m = await ouvrir({ quarts: [rowQuart('q-serveur')], equipes: E1E2, equipages: EQ_EQUIPE, monde: { serveur: { ...serveurQuart({ fin: iso(1), passeFermee: 'p-luc' }), quart_terminer_equipier: (a) => (a.p_utilisateur_id === 'u-marc' ? reponse : { data: { statut: 'termine' }, error: null }) } } });
  m.run('pastilleQuartTouchee()'); await m.run('terminerQuart()');
  const e = ecranQuart(m);
  eq(`refus « ${nom} » : le message NOMME la personne et dit pourquoi ; Nina, elle, est terminée`, [e.html.includes(texte), e.html.includes('Quart terminé aussi pour : Nina.')], [true, true]);
  eq('… la confirmation NE se ferme PAS toute seule (elle porte un avertissement à lire) ; mon propre quart est bien terminé', [m.run('_tConfirmationQuart'), m.run('enService()')], [null, false]);
  m.fin();
}
{
  const m = await ouvrir({ quarts: [rowQuart('q-serveur')], equipes: E1E2, equipages: EQ_EQUIPE, monde: { serveur: { ...serveurQuart({ fin: iso(1), passeFermee: 'p-luc' }), quart_terminer_equipier: (a) => ({ data: { statut: a.p_utilisateur_id === 'u-marc' ? 'deja_termine' : 'pas_en_quart' }, error: null }) } } });
  m.run('pastilleQuartTouchee()'); await m.run('terminerQuart()');
  const e = ecranQuart(m);
  eq('« déjà terminé » et « pas en quart » sont des succès silencieux : aucun avertissement, la confirmation se ferme toute seule', [e.html.includes('⚠'), m.run('_tConfirmationQuart') !== null], [false, true]);
  m.fin();
}
{
  // Mon propre quart était déjà terminé (« pas en quart ») : mon équipe, elle, doit quand même être terminée
  const m = await ouvrir({ quarts: [rowQuart('q-serveur')], equipes: E1E2, equipages: EQ_EQUIPE, monde: { serveur: { quart_terminer: (a, n, d) => { d.quarts = []; return { data: { statut: 'pas_en_quart' }, error: null }; } } } });
  m.run('pastilleQuartTouchee()'); await m.run('terminerQuart()');
  eq('mon quart était déjà terminé : mon équipe est QUAND MÊME terminée, et la confirmation le dit (pas seulement « tu n\'étais pas en service »)', [equipiers(m).length, ecranQuart(m).quel, ecranQuart(m).html.includes('Quart terminé aussi pour : Marc, Nina.')], [2, 'confirmation', true]);
  m.fin();
}
{
  // Mon quart est terminé sur le serveur, PUIS le signal disparaît : les quarts des autres passent à la file, avec la MÊME heure
  let mm;
  const finServeur = iso(1);
  const base = serveurQuart({ fin: finServeur, passeFermee: 'p-luc' });
  const serveur = { ...base, quart_terminer: (a, n, d) => { const r = base.quart_terminer(a, n, d); mm.reseau(false); return r; } };
  const m = await ouvrir({ quarts: [rowQuart('q-serveur')], equipes: E1E2, equipages: EQ_EQUIPE, monde: { serveur } }); mm = m;
  m.run('pastilleQuartTouchee()'); await m.run('terminerQuart()');
  eq('le signal disparaît juste après mon quart : Marc et Nina passent à la file, avec l\'heure du serveur', [m.run('gestesEnAttente().map(g=>g.type)'), m.run('gestesEnAttente().map(g=>g.moment)')], [['quart_terminer_equipier', 'quart_terminer_equipier'], [finServeur, finServeur]]);
  eq('… la confirmation le dit', ecranQuart(m).html.includes('⏳ Marc, Nina : envoyé au retour du signal.'), true);
  m.fin();
}

log('\n=== « ■ JE TERMINE » AVEC L\'ÉQUIPE : SANS RÉSEAU ===');
{
  const m = await ouvrir({ quarts: [rowQuart('q-serveur')], equipes: E1E2, equipages: EQ_EQUIPE }); coupe(m);
  m.run('__opts=[];{const o=enfiler;enfiler=(t,a,op)=>{__opts.push([t,op]);return o(t,a,op);};}');   // (on note les options données à chaque geste)
  m.run('pastilleQuartTouchee()');
  m.run('basculerEquipierQuart(\'u-nina\')');
  await m.run('terminerQuart()');
  const g = m.run('gestesEnAttente().map(g=>[g.type,g.args.userId||g.args.quartId,g.moment])');
  eq('gardés dans l\'ordre : mon quart, puis Marc (Nina est décochée), avec la MÊME heure', [g.map((x) => x[0]), g[1][1], new Set(g.map((x) => x[2])).size], [['quart_terminer', 'quart_terminer_equipier'], 'u-marc', 1]);
  const opts = m.run('__opts');
  eq('… chaque geste reçoit EXPLICITEMENT l\'heure du toucher (jamais celle d\'un instant plus tard)', [opts.filter((x) => x[0] === 'quart_terminer' || x[0] === 'quart_terminer_equipier').every((x) => typeof x[1].moment === 'string'), new Set(opts.map((x) => x[1].moment)).size], [true, 1]);
  const e = ecranQuart(m);
  eq('rien n\'est envoyé ; la confirmation nomme Marc et dit ⏳', [m.appels.envois.length, e.html.includes('Quart terminé aussi pour : Marc.'), e.html.includes('⏳ Envoyé au retour du signal')], [0, true, true]);
  eq('la liste des gestes en attente nomme la personne', m.attentes(), ['■ Quart terminé', '■ Quart terminé : Marc']);
  m.reseau(true);
  await attendreQue(() => m.attentes().length === 0 && nbEnvois(m, 'quart_terminer_equipier') === 1);
  eq('au retour du signal : partis dans l\'ordre (moi d\'abord)', m.appels.evenements.filter((x) => x.startsWith('E:quart_')), ['E:quart_terminer', 'E:quart_terminer_equipier']);
  eq('… et chaque geste part avec l\'heure du TOUCHER (la même pour moi et pour Marc)', [envoi(m, 'quart_terminer').p_moment === g[0][2], equipiers(m)[0].p_moment === g[1][2], g[0][2] === g[1][2]], [true, true, true]);
  m.fin();
}
{
  const m = await ouvrir({ quarts: [rowQuart('q-serveur')], equipes: E1E2, equipages: EQ_EQUIPE, monde: { serveur: { quart_terminer_equipier: () => ({ data: { statut: 'refuse', raison: 'a_bord_ailleurs', vehicule: 'Camion 2' }, error: null }) } } }); coupe(m);
  m.run('pastilleQuartTouchee()'); await m.run('terminerQuart()');
  m.reseau(true);
  vrai('un refus au retour du signal : noté dans « non envoyés »', await attendreQue(() => m.refus().length === 2 && m.attentes().length === 0));
  eq('… avec le NOM de chaque personne et la raison', m.refus().map((x) => x.raison).sort(), ['Marc est à bord de « Camion 2 » : son quart n’a pas été terminé.', 'Nina est à bord de « Camion 2 » : son quart n’a pas été terminé.']);
  m.fin();
}
{
  const m = await ouvrir({ quarts: [rowQuart('q-serveur')], equipes: E1E2, equipages: EQ_EQUIPE }); coupe(m);
  m.run('pastilleQuartTouchee()');
  m.run('{let n=0;const o=magasinEcrire;magasinEcrire=async(...a)=>(++n<=1?o(...a):false);}');   // le 1er geste est gardé, les suivants ne le sont pas
  await m.run('terminerQuart()');
  eq('si le téléphone ne peut pas garder le quart d\'une personne : la confirmation le dit (à refaire), elle reste affichée', [ecranQuart(m).html.includes('⚠ Le quart de Marc n’a pas pu être gardé sur le téléphone : à refaire plus tard.'), m.run('_tConfirmationQuart')], [true, null]);
  m.fin();
}

log('\n=== « ■ JE TERMINE » : LA PASSE S\'EST FERMÉE TOUTE SEULE (l\'équipe de ma dernière passe) ===');
{
  const m = await ouvrir({ quarts: [rowQuart('q-serveur')], tours: toursFermes(), equipes: E1E2, equipages: [], equipagePrecedent: equipePrecedente(20) });
  m.run('pastilleQuartTouchee()'); await attendre(30);
  const e = ecranQuart(m);
  eq('ma passe est déjà fermée (100 %) : l\'équipe de ma dernière passe (fermée il y a 20 min) est proposée, cochée', [e.html.includes('Terminer aussi le quart de :'), nbCoches(e)], [true, 2]);
  await m.run('terminerQuart()');
  const a = equipiers(m);
  eq('le serveur reçoit LA PASSE FERMÉE (celle de cette équipe) pour chaque personne', [a.length, a.every((x) => x.p_passe_id === 'p-fermee')], [2, true]);
  m.fin();
}
{
  const m = await ouvrir({ quarts: [rowQuart('q-serveur')], tours: toursFermes(), equipes: E1E2, equipages: [], equipagePrecedent: equipePrecedente(200) });
  m.run('pastilleQuartTouchee()'); await attendre(30);
  eq('ma passe s\'est fermée il y a 3 h 20 (plus de 3 h) : pas de liste', ecranQuart(m).html.includes('Terminer aussi'), false);
  m.fin();
  const n = await ouvrir({ quarts: [rowQuart('q-serveur')], tours: toursFermes(), equipes: E1E2, equipages: [] });
  n.run('pastilleQuartTouchee()'); await attendre(30);
  eq('aucune passe terminée avant : pas de liste (et pas d\'erreur)', [ecranQuart(n).html.includes('Terminer aussi'), n.appels.erreurs.length], [false, 0]);
  n.fin();
}
{
  const m = await ouvrir({ quarts: [rowQuart('q-serveur')], tours: toursFermes(), equipes: E1E2, equipages: [], equipagePrecedent: equipePrecedente(20), monde: { delaiPrecedentMs: 80 } });
  m.run('pastilleQuartTouchee()');
  eq('pendant la lecture de l\'équipe, « JE TERMINE » est grisé (jamais un toucher trop rapide qui oublierait les passagers)', m.el('btn-quart-terminer').disabled, true);
  await attendre(250);
  eq('… puis la liste s\'affiche et le bouton est utilisable', [nbCoches(ecranQuart(m)), m.el('btn-quart-terminer').disabled], [2, false]);
  m.fin();
}
{
  // Sans réseau : la copie de l'équipe gardée à la dernière lecture (l'écran « Débuter » la relit à chaque ouverture)
  const m = await ouvrir({ quarts: [rowQuart('q-serveur')], tours: toursFermes(), equipes: E1E2, equipages: [], equipagePrecedent: equipePrecedente(20) });
  await m.run('attendreEcritures()'); coupe(m);
  m.run('pastilleQuartTouchee()'); await attendre(30);
  eq('sans réseau : la copie gardée de l\'équipe de ma dernière passe est proposée', nbCoches(ecranQuart(m)), 2);
  await m.run('terminerQuart()');
  eq('… « JE TERMINE » garde mon quart puis les deux quarts, pour la passe fermée', m.run('gestesEnAttente().map(g=>g.type+(g.args.passeId?":"+g.args.passeId:""))'), ['quart_terminer', 'quart_terminer_equipier:p-fermee', 'quart_terminer_equipier:p-fermee']);
  m.fin();
}

log('\n=== « ✕ RETIRER » : « X A TERMINÉ SA JOURNÉE ? » ===');
{
  const finR = iso(0.5);
  const serveur = { equipage_retirer: () => ({ data: { statut: 'retire', fin: finR }, error: null }) };
  const m = await ouvrirDeux({ equipages: EQ_AVEC_NINA, monde: { serveur } });
  await m.run('ouvrirEquipage()');
  await retirerEq(m, 'u-nina');
  const q = m.appels.questionsFin[0] || [];
  eq('après le retrait : la question est posée, avec l\'heure de la descente et des boutons clairs (sans « il » ni « elle »)', [m.appels.questionsFin.length, q[0], (q[1] || '').includes(heureDe(m, finR)), q[2], q[3]], [1, 'Nina a terminé sa journée ?', true, 'Oui, terminer son quart', 'Non, son quart continue']);
  eq('« Non » (la réponse par défaut) : le quart de Nina n\'est pas touché', nbEnvois(m, 'quart_terminer_equipier'), 0);
  m.fin();
  const n = await ouvrirDeux({ equipages: EQ_AVEC_NINA, monde: { serveur } }); n.repondreFin(true);
  await n.run('ouvrirEquipage()'); await retirerEq(n, 'u-nina');
  const a = equipiers(n)[0];
  eq('« Oui » : le quart de Nina est terminé à l\'heure de sa DESCENTE donnée par le serveur (pas l\'heure de la réponse), pour MA passe', [equipiers(n).length, a.p_passe_id, a.p_utilisateur_id, a.p_moment], [1, 'p-luc', 'u-nina', finR]);
  eq('… le message le dit', dernier(n).startsWith('✔ Quart de Nina terminé à ' + heureDe(n, finR)), true);
  n.fin();
  const r = await ouvrirDeux({ equipages: EQ_AVEC_NINA, monde: { serveur: { ...serveur, quart_terminer_equipier: () => ({ data: { statut: 'refuse', raison: 'a_bord_ailleurs', vehicule: 'Camion 2' }, error: null }) } } }); r.repondreFin(true);
  await r.run('ouvrirEquipage()'); await retirerEq(r, 'u-nina');
  eq('« Oui » mais le serveur refuse (elle est déjà dans un autre camion) : le message le dit', dernier(r), '⚠ Nina est à bord de « Camion 2 » : son quart n’a pas été terminé.');
  r.fin();
}
for (const [nom, statut] of [['annule un ajout fait par erreur', 'annule'], ['n\'était plus à bord', 'pas_a_bord']]) {
  const m = await ouvrirDeux({ equipages: EQ_AVEC_NINA, monde: { serveur: { equipage_retirer: () => ({ data: { statut }, error: null }) } } }); m.repondreFin(true);
  await m.run('ouvrirEquipage()'); await retirerEq(m, 'u-nina');
  eq(`le retrait « ${nom} » : AUCUNE question (rien à terminer)`, [m.appels.questionsFin.length, nbEnvois(m, 'quart_terminer_equipier')], [0, 0]);
  m.fin();
}
{
  const m = await ouvrirDeux({ equipages: EQ_AVEC_NINA }); coupe(m); m.repondreFin(true);
  m.run('__opts=[];{const o=enfiler;enfiler=(t,a,op)=>{__opts.push([t,op]);return o(t,a,op);};}');
  await m.run('ouvrirEquipage()'); await retirerEq(m, 'u-nina');
  const g = m.run('gestesEnAttente().map(g=>[g.type,g.moment])');
  const optsR = m.run('__opts');
  eq('le geste « retirer » reçoit EXPLICITEMENT l\'heure du toucher (celle de la question), et rien n\'est envoyé sans réseau', [typeof optsR.find((x) => x[0] === 'equipage_retirer')[1].moment, optsR.find((x) => x[0] === 'equipage_retirer')[1].moment === g[1][1], m.appels.envois.length], ['string', true, 0]);
  eq('sans réseau : « retirer » puis « terminer son quart », gardés avec la MÊME heure ; message ⏳', [g.map((x) => x[0]), g[0][1] === g[1][1], dernier(m).startsWith('⏳ Quart de Nina')], [['equipage_retirer', 'quart_terminer_equipier'], true, true]);
  m.fin();
}
{
  const m = await ouvrirDeux(); coupe(m); m.repondreFin(true);
  await m.run('ouvrirEquipage()');
  await ajouterEq(m, 'u-nina', 'Nina');
  await retirerEq(m, 'u-nina');
  eq('un ajout pas encore parti puis retiré : rien à envoyer, AUCUNE question', [m.appels.questionsFin.length, m.attentes().length], [0, 0]);
  m.fin();
}

log('\n=== LE PASSAGER : « LUC A TERMINÉ TON QUART À 16 H 05 » ===');
const quartTermineParChauffeur = (o = {}) => rowQuart('q-fini', { debut: iso(300), fin: iso(10), fin_source: 'equipage', fin_par: 'u-marc', ...o });
{
  const m = await ouvrir({ quarts: [quartTermineParChauffeur()], tours: [] });
  const e = ecranQuart(m);
  eq('un quart terminé par le chauffeur : la carte s\'ouvre à l\'ouverture, AVANT l\'écran d\'accueil (qui attend)', [e.quel, e.plein, m.run('_accueilQuartPour')], ['avis', false, null]);
  eq('… elle NOMME le chauffeur et l\'heure de fin (en gros), avec « OK » et « Ce n’est pas exact »', [e.html.includes('Marc a terminé ton quart à'), e.html.includes('<div class="quart-heure">' + heureDe(m, m.run('avisFin.fin')) + '</div>'), e.html.includes('id="btn-quart-ok"'), e.html.includes('Ce n’est pas exact')], [true, true, true, true]);
  m.run('avisFinLu()');
  eq('« OK » : la carte se ferme, l\'écran d\'accueil (qui attendait) s\'ouvre ; l\'avis est noté comme lu sur le téléphone', [ecranQuart(m).quel, m.run('avisFin'), m.stockage['lp_avis_quart_vu:u-luc']], ['accueil', null, 'q-fini']);
  const n = await ouvrir({ quarts: [quartTermineParChauffeur()], tours: [], monde: { stockage: { ...m.stockage } } });
  eq('à la prochaine ouverture : la carte ne revient PAS (déjà lue), l\'écran d\'accueil s\'ouvre', [ecranQuart(n).quel, n.run('avisFin')], ['accueil', null]);
  n.fin(); m.fin();
}
for (const [nom, o] of [['plus de 24 heures', { fin: iso(60 * 25) }], ['déjà signalé par la personne', { a_valider: true, raison_a_valider: 'fin_contestee' }], ['déjà examiné par l\'administrateur', { valide_le: iso(5) }], ['terminé par la personne elle-même', { fin_source: 'manuel', fin_par: null }]]) {
  const m = await ouvrir({ quarts: [quartTermineParChauffeur(o)], tours: [] });
  eq(`un quart terminé par le chauffeur mais ${nom} : aucune carte, l'écran d'accueil s'ouvre`, [ecranQuart(m).quel, m.run('avisFin')], ['accueil', null]);
  m.fin();
}
{
  const m = await ouvrir({ quarts: [quartTermineParChauffeur({ fin_par: null })], tours: [] });
  eq('chauffeur inconnu : « Ton chauffeur a terminé ton quart à »', ecranQuart(m).html.includes('Ton chauffeur a terminé ton quart à'), true);
  m.fin();
  const n = await ouvrir({ quarts: [quartTermineParChauffeur()], tours: [], utilisateurs: [{ id: 'u-luc', nom: 'Luc', actif: true }, { id: 'u-marc', nom: '<b>Marc</b>', actif: true }] });
  eq('le nom du chauffeur (vient de la base) est échappé', [ecranQuart(n).html.includes('&lt;b&gt;Marc&lt;/b&gt; a terminé ton quart'), ecranQuart(n).html.includes('<b>')], [true, false]);
  n.fin();
  eq('« à » aujourd\'hui, « hier à » hier, « le … à » avant', [n.run('quandQuart(new Date().toISOString())'), n.run('quandQuart(new Date(Date.now()-86400000).toISOString())'), n.run('quandQuart(new Date(Date.now()-5*86400000).toISOString())').startsWith('le ')], ['à', 'hier à', true]);
}
{
  // « Ce n'est pas exact »
  const m = await ouvrir({ quarts: [quartTermineParChauffeur()], tours: [] });
  await m.run('signalerErreurFinQuart()');
  const a = envoi(m, 'quart_signaler_erreur'), e = ecranQuart(m);
  eq('« Ce n’est pas exact » : le serveur reçoit le numéro de MON quart (une seule fois)', [nbEnvois(m, 'quart_signaler_erreur'), a.p_quart_id], [1, 'q-fini']);
  eq('la confirmation : « C’est signalé », l\'administrateur va vérifier, sans ⏳ ; l\'avis est lu', [e.quel, e.html.includes('C’est signalé'), e.html.includes('L’administrateur va vérifier ton quart.'), e.html.includes('⏳'), m.run('avisFin'), m.stockage['lp_avis_quart_vu:u-luc']], ['confirmation', true, true, false, null, 'q-fini']);
  m.fin();
  const n = await ouvrir({ quarts: [quartTermineParChauffeur()], tours: [] }); coupe(n);
  n.run('fermerEcranQuart(); ouvrirEcranQuart(\'avis\')');
  await n.run('signalerErreurFinQuart()');
  eq('sans réseau : le signalement est GARDÉ (rien d\'envoyé), la confirmation dit ⏳', [n.appels.envois.length, n.run('gestesEnAttente().map(g=>[g.type,g.args.quartId])'), ecranQuart(n).html.includes('⏳ Envoyé au retour du signal')], [0, [['quart_signaler_erreur', 'q-fini']], true]);
  n.reseau(true);
  vrai('… au retour du signal, il part', await attendreQue(() => n.attentes().length === 0 && nbEnvois(n, 'quart_signaler_erreur') === 1));
  n.fin();
}
{
  // Signalé sans réseau, MAIS l'administrateur avait déjà validé le quart : refusé au retour du signal, avec la raison
  const m = await ouvrir({ quarts: [quartTermineParChauffeur()], tours: [], monde: { serveur: { quart_signaler_erreur: () => ({ data: { statut: 'refuse', raison: 'deja_valide' }, error: null }) } } }); coupe(m);
  m.run('fermerEcranQuart(); ouvrirEcranQuart(\'avis\')');
  await m.run('signalerErreurFinQuart()');
  m.reseau(true);
  vrai('un signalement gardé puis refusé au retour du signal (déjà validé) : noté dans « non envoyés »', await attendreQue(() => m.refus().length === 1 && m.attentes().length === 0));
  eq('… avec la raison en français', m.refus()[0].raison, 'L’administrateur a déjà validé ce quart : parle-lui directement.');
  m.fin();
}
{
  const m = await ouvrir({ quarts: [quartTermineParChauffeur()], tours: [], monde: { serveur: { quart_signaler_erreur: () => ({ data: { statut: 'refuse', raison: 'deja_valide' }, error: null }) } } });
  await m.run('signalerErreurFinQuart()');
  eq('l\'administrateur a déjà validé ce quart : la raison est dans l\'écran (lui parler directement) ; l\'avis est lu ; « OK » ferme', [ecranQuart(m).msg, m.run('avisFin'), ecranQuart(m).quel], ['L’administrateur a déjà validé ce quart : parle-lui directement.', null, 'avis']);
  m.fin();
  const n = await ouvrir({ quarts: [quartTermineParChauffeur()], tours: [], monde: { delaiEnvoiMs: 60 } });
  const p1 = n.run('signalerErreurFinQuart()');
  await attendre(20);
  eq('pendant l\'envoi, « OK » et « Ce n’est pas exact » sont grisés', [n.el('btn-quart-ok').disabled, n.el('btn-quart-signaler').disabled], [true, true]);
  await Promise.all([p1, n.run('signalerErreurFinQuart()')]);
  eq('deux touchers presque en même temps : UN seul envoi', nbEnvois(n, 'quart_signaler_erreur'), 1);
  n.fin();
}
{
  // L'avis arrive PENDANT la séance (la relecture d'une minute)
  const m = await ouvrir({ quarts: [], tours: [] });   // l'écran d'accueil est ouvert
  m.donnees.quarts.push(quartTermineParChauffeur());
  m.run('_tickRelecture=3'); await m.run('rafraichirEnCours()');
  eq('l\'avis arrive PENDANT que l\'écran d\'accueil est ouvert : il attend (rien n\'est écrasé)', [ecranQuart(m).quel, m.run('avisFin!==null')], ['accueil', true]);
  m.run('fermerEcranQuart()');
  eq('« voir la carte » : la carte de l\'avis s\'ouvre alors', ecranQuart(m).quel, 'avis');
  m.fin();
  const n = await ouvrir({ quarts: [], tours: [] });
  n.run('fermerEcranQuart()');   // rien d'ouvert : la carte de l'avis s'ouvre dans la minute
  n.donnees.quarts.push(quartTermineParChauffeur());
  n.run('_tickRelecture=3'); await n.run('rafraichirEnCours()');
  eq('aucun écran ouvert : la carte s\'ouvre à la relecture suivante (dans la minute)', ecranQuart(n).quel, 'avis');
  n.fin();
}

log('\n=== LE CODE : L\'ÉQUIPAGE PASSE PAR LES MÊMES RÈGLES QUE LES AUTRES GESTES ===');
{
  const qe = lire('js/quart-ecrans.js'), fa = lire('js/file-attente.js'), ep = lire('js/equipage-panneau.js');
  vrai('la fin de quart d\'une personne et « ce n’est pas exact » n\'appellent le serveur qu\'avec un délai (avecDelai) et passent par la file en cas de panne', /avecDelai\(db\.rpc\('quart_terminer_equipier'/.test(qe) && /avecDelai\(db\.rpc\('quart_signaler_erreur'/.test(qe) && /enfiler\('quart_terminer_equipier'/.test(qe) && /enfiler\('quart_signaler_erreur'/.test(qe));
  vrai('la file connaît les deux gestes (exécuteurs) et donne leurs raisons en français', /quart_terminer_equipier:\{/.test(fa) && /quart_signaler_erreur:\{/.test(fa) && fa.includes('function raisonQuartEquipier') && fa.includes('function raisonSignalementQuart'));
  vrai('« Retirer » pose la question de fin de journée, avec « Non » par défaut (confirmer) et sans « il » ni « elle » dans les boutons', ep.includes('demanderFinJourneeEquipier') && ep.includes('Oui, terminer son quart') && ep.includes('Non, son quart continue'));
}

log('\n=== LE CODE : LE PUNCH PASSE PAR LES MÊMES RÈGLES QUE LES AUTRES GESTES ===');
{
  const qe = lire('js/quart-ecrans.js'), page = lire('index.html'), tj = lire('js/tours.js'), vj = lire('js/vehicules.js');
  vrai('« Je commence » et « Je termine » n\'appellent le serveur qu\'avec un délai (avecDelai) et passent par la file en cas de panne', /avecDelai\(db\.rpc\('quart_commencer'/.test(qe) && /avecDelai\(db\.rpc\('quart_terminer'/.test(qe) && qe.includes('commencerQuartSansReseau') && qe.includes('terminerQuartSansReseau'));
  vrai('la page a son écran du punch, charge quart-ecrans.js (après quart.js), et la pastille est un BOUTON qui ouvre le bon écran', page.includes('id="quart-overlay"') && page.indexOf('js/quart.js') < page.indexOf('js/quart-ecrans.js') && /<button id="quart-pastille" type="button" onclick="pastilleQuartTouchee\(\)"/.test(page));
  vrai('un « quart_terminer » en attente ferme aussi ma passe (tours.js) et me sort du camion (vehicules.js)', tj.includes('g.type===\'quart_terminer\'') && vj.includes('g.type===\'quart_terminer\''));
  vrai('l\'écran d\'accueil est décidé quand l\'état du quart est posé (poserQuart) : un seul endroit', /verifierAccueilQuart\(\)/.test(lire('js/quart.js')));
  vrai('aucune fonction du punch ne porte le nom d\'une fonction d\'un autre fichier (tout est global)', ['terminerSansReseau', 'commencerSansReseau'].every((n) => !new RegExp('function ' + n + '\\b').test(qe)));
}

log('\n=== LE CODE : UN SEUL ENDROIT POSE LE QUART, ET LA PAGE A SA PASTILLE ===');
{
  const fichiers = fs.readdirSync(WWW + 'js').filter((f) => f.endsWith('.js'));
  const poses = [];
  for (const f of fichiers) lire('js/' + f).split('\n').forEach((l) => { if (/^\s*(let\s+)?monQuart\s*=[^=]/.test(l) && !/^\s*\/\//.test(l)) poses.push(f); });
  eq('« monQuart = … » n\'apparaît qu\'à la déclaration et dans poserQuart (jamais une lecture qui contourne la superposition)', poses, ['quart.js', 'quart.js']);
  const html = lire('index.html');
  vrai('la page a sa pastille et charge quart.js', html.includes('id="quart-pastille"') && html.includes('js/quart.js'));
  vrai('la lecture du quart ne garde JAMAIS le résultat superposé dans la copie du téléphone', lire('js/quart.js').includes('lectureReussie(\'quart\',q)') && !/lectureReussie\('quart',monQuart\)/.test(lire('js/quart.js')));
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
