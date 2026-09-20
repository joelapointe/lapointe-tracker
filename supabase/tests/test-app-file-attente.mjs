// Étape 16b — LA FILE D'ATTENTE COMMUNE DES GESTES (www/js/file-attente.js + hors-reseau.js + auth.js), testée avec les VRAIS fichiers de
// l'application chargés dans un faux navigateur, un FAUX Supabase qui peut couper le signal, refuser, répondre mal ou ne jamais répondre,
// et un faux stockage. Ce que ces tests ne peuvent pas vérifier : le vrai IndexedDB d'un téléphone (voir l'essai dans le navigateur).
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

// =====================================================================
log('=== UN GESTE EST GARDÉ SUR LE TÉLÉPHONE AVANT QUE L\'ÉCRAN DISE « FAIT » ===');
{
  const m = monde({ enLigne: false });
  const r = await m.completer('s1', '✔ Complété : 304 rue de l\'Église');
  vrai('enfiler répond « ok » (et « durable » : c\'est une mémoire, mais le service le dit)', r.ok === true && typeof r.id === 'string' && typeof r.durable === 'boolean', JSON.stringify(r));
  const cles = m.cles();
  eq('une seule clé, sous « file:<employé>:att:<ordre> » (15 chiffres)', [cles.length, /^file:u-luc:att:\d{15}$/.test(cles[0])], [1, true]);
  const g = m.memoire()[cles[0]];
  eq('le geste gardé : type, arguments, libellé lisible, essais à 0', [g.type, g.args.stopId, g.libelle, g.essais], ['completer_arret', 's1', '✔ Complété : 304 rue de l\'Église', 0]);
  vrai('l\'heure gardée est celle du geste (maintenant), pas celle d\'un envoi futur', Math.abs(Date.now() - Date.parse(g.moment)) < 3000, g.moment);
  eq('hors réseau : aucun envoi n\'est tenté', m.appels.envois.length, 0);
  eq('la bande du haut dit « Hors réseau » ET « 1 geste en attente », et elle est cliquable', [m.bande().visible, m.bande().texte.includes('📴 Hors réseau'), m.bande().texte.includes('⏳ 1 geste en attente'), m.bande().actif], [true, true, true, true]);
  eq('les gestes en attente (pour les écrans de 16c)', m.attentes(), ['✔ Complété : 304 rue de l\'Église']);
  m.fin();
  // Le pluriel
  const m2 = monde({ enLigne: false }); await m2.completer('s1'); await m2.completer('s2');
  vrai('« 2 gestes en attente » (pluriel)', m2.bande().texte.includes('⏳ 2 gestes en attente'), m2.bande().texte);
  m2.fin();
  // Enfiler pour rien : type inconnu ou personne de connecté
  const m3 = monde({ enLigne: false });
  eq('un type de geste inconnu est refusé (rien n\'est gardé)', [(await m3.enfiler('n_importe_quoi', {})).ok, m3.cles().length], [false, 0]);
  m3.run('currentUser = null');
  eq('personne de connecté : rien n\'est gardé', [(await m3.completer()).ok, m3.cles().length], [false, 0]);
  m3.fin();
}

log('\n=== LES CLÉS SONT ORDONNÉES, MÊME EN RAFALE ET MÊME SI L\'HORLOGE RECULE ===');
{
  const m = monde({ enLigne: false });
  for (let i = 0; i < 25; i++) await m.completer('s' + i);   // 25 gestes dans la même milliseconde ou presque
  const ordres = m.cles().map((k) => k.split(':')[3]);
  eq('25 gestes : 25 clés différentes, strictement croissantes', [new Set(ordres).size, ordres.every((x, i) => i === 0 || x > ordres[i - 1])], [25, true]);
  eq('l\'ordre des clés = l\'ordre des gestes (le 1er est s0, le dernier s24)', [m.attentes()[0], m.attentes()[24]], ['✔ Complété : s0', '✔ Complété : s24']);
  // L'horloge recule (téléphone remis à l'heure) : le geste suivant reste APRÈS les précédents
  m.run('fileEtat.dernierOrdre = Date.now() + 5 * 3600 * 1000');   // les gestes précédents portent une heure « future »
  await m.completer('apres');
  const c = m.cles(); const ordres2 = c.map((k) => k.split(':')[3]);
  vrai('horloge reculée : le nouveau geste passe quand même APRÈS les anciens (26 clés, la dernière est la plus grande)', ordres2.length === 26 && ordres2[25] === [...ordres2].sort().pop(), ordres2.slice(-2).join(' / '));
  m.fin();
}

log('\n=== LA FILE NE S\'EFFACE JAMAIS TOUTE SEULE ===');
{
  const m = monde({ enLigne: false });
  await m.completer('s1');
  m.run('cacheEcrire("stops",[1])'); await m.run('attendreEcritures()');
  eq('avant : une copie « cache: » et un geste « file: »', [m.cles('cache:').length, m.cles('file:').length], [1, 1]);
  await m.run('effacerCache()');
  eq('effacerCache() efface les copies… et JAMAIS la file', [m.cles('cache:').length, m.cles('file:').length], [0, 1]);
  const src = lire('js/hors-reseau.js') + lire('js/auth.js') + lire('js/file-attente.js');
  const effacements = [...src.matchAll(/magasinEffacer\(\s*['"]([^'"]*)['"]/g)].map((x) => x[1]);
  eq('dans TOUT le code de l\'application, le seul effacement par préfixe vise « cache: »', effacements, ['cache:']);
  m.fin();
}

log('\n=== UN EMPLOYÉ NE VOIT NI N\'ENVOIE LES GESTES D\'UN AUTRE (téléphone partagé) ===');
{
  const m0 = monde({ enLigne: false }); await m0.completer('s1'); const gardee = m0.memoire(); m0.fin();
  const marcCles = {}; Object.entries(gardee).forEach(([k, v]) => { marcCles[k.replace('u-luc', 'u-marc')] = v; });
  const m = monde({ memoire: marcCles });   // Luc est connecté, la file de Marc est sur le téléphone
  await monter(m); await m.run('rejouerFile()');
  eq('Luc ne voit aucun geste (ceux de Marc ne sont pas les siens)', [m.attentes().length, m.bande().visible], [0, false]);
  eq('et rien n\'est envoyé au serveur sous son nom', m.appels.envois.length, 0);
  eq('la file de Marc est intacte sur le téléphone', m.cles().length, 1);
  m.fin();
}

log('\n=== ENVOYER : dans l\'ordre, avec l\'heure du GESTE, un à la fois ===');
{
  const m = monde({ delaiEnvoiMs: 15 });
  await m.completer('s1'); await attendre(5);
  // (en ligne, ils partent tout de suite : on veut voir la file complète, donc on la remplit hors réseau)
  m.fin();
  const h = monde({ enLigne: false, delaiEnvoiMs: 15 });
  h.run('reseau.enLigne = false');
  await h.completer('s1'); await attendre(20); await h.completer('s2'); await attendre(20);
  await h.enfiler('terminer_passe', { passeId: 'p-luc' }, { libelle: '■ Passe terminée' });
  const moments = h.run('gestesEnAttente().map(g=>g.moment)');
  h.reseau(true); h.run('reseau.enLigne = true');
  const [a, b] = await Promise.all([h.run('rejouerFile()'), h.run('rejouerFile()')]);   // DEUX rejeux demandés en même temps
  eq('trois gestes partis, dans l\'ordre où ils ont été faits', h.envoisGestes(), ['completer_arret:s1', 'completer_arret:s2', 'terminer_passe']);
  eq('UN SEUL geste à la fois (jamais deux envois en même temps), malgré les deux rejeux demandés ensemble', h.appels.maxEnCours, 1);
  eq('chacun est parti UNE seule fois', h.appels.envois.length, 3);
  eq('les deux demandes ont eu le même résultat (le même rejeu)', [a.envoyes, b.envoyes], [3, 3]);
  eq('chaque geste part avec l\'heure où il a été FAIT (p_moment), pas celle de l\'envoi', h.appels.envois.map((x) => x.args.p_moment), moments);
  vrai('… et ces heures sont bien étalées dans le passé du rejeu', Date.parse(moments[0]) < Date.parse(moments[1]) && Date.parse(moments[1]) < Date.parse(moments[2]), moments.join(' '));
  eq('la file est vide, sur le téléphone aussi', [h.attentes().length, h.cles().length], [0, 0]);
  eq('plus de bande', h.bande().visible, false);
  eq('la position du geste est envoyée avec lui', [h.appels.envois[0].args.p_lat, h.appels.envois[0].args.p_lon], [46.4, -72.9]);
  h.fin();
}

log('\n=== UN GESTE FAIT PENDANT UN REJEU N\'EST PAS OUBLIÉ ===');
{
  const m = monde({ enLigne: false, delaiEnvoiMs: 40 });
  await m.completer('s1');
  m.reseau(true); m.run('reseau.enLigne = true');
  const p = m.run('rejouerFile()');
  await attendre(10);   // le 1er envoi est en route
  await m.completer('s2');   // un nouveau geste arrive pendant l'envoi
  const bilan = await p;
  await attendre(120);
  eq('les deux gestes sont partis, dans l\'ordre', m.envoisGestes(), ['completer_arret:s1', 'completer_arret:s2']);
  eq('la file est vide à la fin', m.attentes().length, 0);
  m.fin();
}

log('\n=== UN GESTE AJOUTÉ AU TOUT DERNIER INSTANT D\'UN REJEU (après la dernière vérification de la file) ===');
{
  const m = monde({});
  await m.completer('s1'); await attendre(40);   // la file est vide
  // On simule la course : un geste arrive PILE après que le rejeu a constaté « plus rien à envoyer », avant qu'il se termine
  m.run("{ const vrai_ = _passeDeRejeu; let fait = false; _passeDeRejeu = async () => { const b = await vrai_(); if (!fait) { fait = true; fileEtat.att.push({ v: 1, id: 'course', ordre: '999999999999999', type: 'completer_arret', args: { passeId: 'p-luc', stopId: 's2' }, moment: new Date().toISOString(), libelle: 'course', essais: 0, photo: null }); rejouerFile(); } return b; }; }");
  m.appels.envois.length = 0;
  await m.completer('s1'); await attendre(80);
  eq('le geste arrivé au dernier instant est quand même envoyé (le rejeu repasse une fois de plus)', m.envoisGestes().filter((x) => x === 'completer_arret:s2').length, 1);
  m.fin();
}

log('\n=== APRÈS UN SUCCÈS, LES DÉLAIS REPARTENT DU PLUS COURT ===');
{
  const vus = {};
  const m = monde({ delais: [20, 600, 900], serveur: { completer_arret: async (a) => { vus[a.p_stop_id] = (vus[a.p_stop_id] ?? 0) + 1; if (vus[a.p_stop_id] === 1) return { data: null, error: { message: 'Service Unavailable', status: 503 } }; } } });
  await m.completer('s1'); await attendre(120);
  eq('s1 : un échec (délai 20 ms) puis le succès', [vus.s1, m.attentes().length], [2, 0]);
  await m.completer('s2'); await attendre(120);
  eq('s2 : son échec repart du délai le plus COURT (20 ms), pas du palier suivant (600 ms) : déjà envoyé', [vus.s2, m.attentes().length], [2, 0]);
  m.fin();
}

log('\n=== SANS DOUBLON : rejouer deux fois, réponse perdue, application fermée en plein envoi ===');
{
  // Un serveur qui applique le geste puis PERD la réponse (le téléphone croit que ça a échoué)
  const appliques = new Set(); let perdre = true;
  const serveur = { completer_arret: async (a) => {
    const deja = appliques.has(a.p_stop_id); appliques.add(a.p_stop_id);
    if (perdre) { perdre = false; throw new Error('Failed to fetch'); }
    return { data: { statut: deja ? 'deja_complete' : 'complete' }, error: null };
  } };
  const m = monde({ serveur });
  await m.completer('s1'); await attendre(30);
  eq('la réponse s\'est perdue : le geste est TOUJOURS là (jamais retiré sans réponse)', [m.attentes().length, m.appels.envois.length], [1, 1]);
  m.reseau(true); m.run('reseau.enLigne = true');
  await m.run('rejouerFile()');
  eq('rejoué : le serveur répond « déjà complété » — c\'est un succès, le geste sort de la file', [m.attentes().length, m.refus().length], [0, 0]);
  eq('l\'arrêt n\'a été appliqué qu\'UNE fois côté serveur', appliques.size, 1);
  m.fin();
  // L'application est fermée pendant l'envoi : le geste est toujours sur le téléphone, la séance suivante le renvoie
  const a = monde({ suspendu: true });
  await a.completer('s1'); await attendre(20);
  const surLeTelephone = a.memoire();
  eq('envoi en cours, application fermée : le geste est encore sur le téléphone', Object.keys(surLeTelephone).length, 1);
  a.fin();
  const b = monde({ memoire: surLeTelephone });
  await monter(b); await attendre(60);
  eq('à la séance suivante, il est renvoyé (une fois) et la file se vide', [b.envoisGestes(), b.attentes().length], [['completer_arret:s1'], 0]);
  b.fin();
}

log('\n=== PANNE DE RÉSEAU : le geste reste en tête, l\'ordre est gardé, rien n\'est abandonné ===');
{
  const m = monde({ enLigne: false });
  await m.completer('s1'); await m.completer('s2');
  m.reseau(true); m.run('reseau.enLigne = true');   // le téléphone croit avoir du signal…
  m.reseau(false);                                  // …mais le serveur ne répond pas
  await m.run('rejouerFile()');
  eq('un seul essai (le premier geste), pas un pour chaque geste', m.appels.envois.length, 1);
  eq('les DEUX gestes sont toujours là, dans l\'ordre (le 2e n\'a pas doublé le 1er)', m.attentes(), ['✔ Complété : s1', '✔ Complété : s2']);
  eq('l\'application se sait hors réseau : sonde en marche, bande visible', [m.run('reseau.enLigne'), m.run('reseau.sonde !== null')], [false, true]);
  eq('aucun essai « inconnu » n\'est compté : une panne de réseau n\'use pas le geste', m.run('gestesEnAttente()[0].essais'), 0);
  await attendre(120);
  eq('pendant la panne, on ne martèle pas le serveur (les sondes seules, aucun nouvel envoi)', m.appels.envois.length, 1);
  // Le signal revient : la sonde le voit, les gestes partent dans l'ordre, PUIS l'application relit le serveur
  m.reseau(true);
  await attendre(250);
  eq('signal revenu : les 2 gestes partent, dans l\'ordre', m.envoisGestes(), ['completer_arret:s1', 'completer_arret:s1', 'completer_arret:s2']);
  eq('la file est vide, la bande disparaît', [m.attentes().length, m.bande().visible], [0, false]);
  const ev = m.appels.evenements, iLecture = ev.indexOf('L:stops'), dernierEnvoi = ev.lastIndexOf('E:completer_arret');
  vrai('au retour du signal : TOUS les gestes partent D\'ABORD, puis l\'application relit le serveur (il a le dernier mot sur un état qui les contient)', iLecture > dernierEnvoi && dernierEnvoi > 0, ev.join(' '));
  m.fin();
}

log('\n=== LE SERVEUR RÉPOND MAL (panne, jeton) : on réessaie espacé, sans jamais abandonner ===');
{
  for (const [nom, erreur] of [['503', { message: 'Service Unavailable', status: 503 }], ['429', { message: 'too many requests', status: 429 }], ['jeton expiré', { message: 'JWT expired', code: 'PGRST301' }]]) {
    let n = 0;
    const m = monde({ delais: [30, 60, 120], serveur: { completer_arret: async () => (++n <= 3 ? { data: null, error: erreur } : undefined) } });
    await m.completer('s1');
    await attendre(80);
    const avant = m.appels.envois.length;
    eq(`[${nom}] le geste reste en attente (ni refusé, ni perdu) et le nombre d'essais reste 0`, [m.attentes().length, m.refus().length, m.run('gestesEnAttente()[0].essais')], [1, 0, 0]);
    vrai(`[${nom}] les essais sont espacés (pas plus de 3 essais en 80 ms)`, avant <= 3, avant);
    await attendre(500);
    eq(`[${nom}] dès que le serveur répond bien, le geste part`, [m.attentes().length, m.appels.envois.length, m.refus().length], [0, 4, 0]);
    m.fin();
  }
  // Une panne qui dure : jamais de refus, quelle que soit la durée
  const m = monde({ delais: [10, 10, 10], serveur: { completer_arret: async () => ({ data: null, error: { message: 'Bad Gateway', status: 502 } }) } });
  await m.completer('s1'); await attendre(400);
  eq('serveur en panne pendant 400 ms (des dizaines d\'essais possibles) : toujours en attente, jamais refusé', [m.attentes().length, m.refus().length], [1, 0]);
  m.fin();
}

log('\n=== UN REFUS DÉFINITIF : la liste « Gestes non envoyés », avec la raison ; la suite continue ===');
{
  const refus = { completer_arret: async (a) => (a.p_stop_id === 's1' ? { data: null, error: { message: 'passe_introuvable', code: 'P0001' } } : undefined) };
  const m = monde({ enLigne: false, serveur: refus });
  await m.completer('s1', '✔ Complété : 304 rue de l\'Église'); await m.completer('s2', '✔ Complété : 220 rue du Moulin');
  m.reseau(true); m.run('reseau.enLigne = true');
  await m.run('rejouerFile()');
  eq('le geste refusé est en « non envoyés », avec sa raison en français', m.refus(), [{ libelle: '✔ Complété : 304 rue de l\'Église', raison: 'Cette passe n’existe plus.' }]);
  eq('le suivant n\'est pas bloqué : il est parti', [m.envoisGestes(), m.attentes().length], [['completer_arret:s1', 'completer_arret:s2'], 0]);
  vrai('un message prévient (rien en silence)', m.appels.toasts.some((t) => t.includes('n’a pas pu être envoyé')), JSON.stringify(m.appels.toasts));
  eq('sur le téléphone : plus dans « att », maintenant sous « ref » avec l\'heure du refus', [m.cles('file:u-luc:att:').length, m.cles('file:u-luc:ref:').length, typeof m.memoire()[m.cles('file:u-luc:ref:')[0]].refus.le], [0, 1, 'string']);
  eq('la bande dit « 1 geste non envoyé » (et elle est cliquable)', [m.bande().texte, m.bande().actif], ['⚠ 1 geste non envoyé', true]);
  // Après une « relance » de l'application : la liste est toujours là
  const m2 = monde({ memoire: m.memoire() }); await monter(m2);
  eq('l\'application redémarre : le geste non envoyé est toujours dans la liste', m2.refus().length, 1);
  // Le chauffeur le ferme
  m2.run('fermerGesteNonEnvoye(gestesNonEnvoyes()[0].id)'); await attendre(20);
  eq('« Fermer » le retire (liste et téléphone) et la bande disparaît', [m2.refus().length, m2.cles().length, m2.bande().visible], [0, 0, false]);
  m.fin(); m2.fin();
  // Chaque refus connu a sa raison en français
  const cas = { non_autorise: 'permis', delai_depasse: '10 minutes', geste_trop_ancien: '3 jours', passe_terminee: 'terminée', impossible_de_rouvrir: 'nouvelle passe', arret_hors_route: 'route' };
  for (const [code, mot] of Object.entries(cas)) {
    const x = monde({ serveur: { completer_arret: async () => ({ data: null, error: { message: code, code: 'P0001' } }) } });
    await x.completer('s1'); await attendre(30);
    vrai(`« ${code} » : refus définitif, raison lisible (« …${mot}… »), aucun texte technique`, x.refus().length === 1 && x.refus()[0].raison.includes(mot) && !x.refus()[0].raison.includes(code), JSON.stringify(x.refus()));
    x.fin();
  }
  // Un code que l'application ne connaît pas : le message du serveur est montré tel quel
  const y = monde({ serveur: { completer_arret: async () => ({ data: null, error: { message: 'regle_nouvelle_du_serveur', code: 'P0001' } }) } });
  await y.completer('s1'); await attendre(30);
  vrai('une règle inconnue du serveur (P0001) : refus définitif, le message est repris', y.refus().length === 1 && y.refus()[0].raison.includes('regle_nouvelle_du_serveur'), JSON.stringify(y.refus()));
  y.fin();
}

log('\n=== LE SERVEUR RÉPOND « OK » MAIS N\'A PAS APPLIQUÉ (passe terminée, équipier refusé) ===');
{
  let m = monde({ serveur: { completer_arret: async () => ({ data: { statut: 'passe_terminee' }, error: null }) } });
  await m.completer('s1'); await attendre(30);
  eq('compléter après la fin de la passe : « non envoyé » avec sa raison', m.refus().map((r) => r.raison), ['La passe était déjà terminée : cet arrêt n’a pas été enregistré.']);
  m.fin();
  m = monde({ serveur: { equipage_ajouter: async () => ({ data: { statut: 'refuse', raison: 'chauffeur_ailleurs', vehicule: 'Camion 2' }, error: null }) } });
  await m.enfiler('equipage_ajouter', { cle: crypto.randomUUID(), passeId: 'p-luc', userId: 'u-eric', nom: 'Eric' }, { libelle: '👤 Eric monte à bord' }); await attendre(30);
  eq('équipier qui conduit déjà un autre camion : la raison nomme la personne et le camion', m.refus().map((r) => r.raison), ['Eric conduit déjà « Camion 2 ».']);
  eq('et l\'ajout est TOUJOURS envoyé avec « forcer » (décision A : jamais de question des heures plus tard)', m.appels.envois[0].args.p_forcer, true);
  m.fin();
  // Ajout ou transfert réussis : aucune trace dans les refus
  for (const statut of ['ajoute', 'transfere', 'deja_a_bord']) {
    const x = monde({ serveur: { equipage_ajouter: async () => ({ data: { statut }, error: null }) } });
    await x.enfiler('equipage_ajouter', { cle: crypto.randomUUID(), passeId: 'p-luc', userId: 'u-eric', nom: 'Eric' }, { libelle: 'Eric' }); await attendre(20);
    eq(`équipage « ${statut} » = réussi, file vide, aucun refus`, [x.attentes().length, x.refus().length], [0, 0]);
    x.fin();
  }
}

log('\n=== ERREUR INCONNUE : 5 essais espacés, puis la liste (un geste coincé ne retient pas les autres) ===');
{
  let n = 0;
  const m = monde({ delais: [40, 40, 40], serveur: { completer_arret: async (a) => { if (a.p_stop_id === 's1') { n++; return { data: null, error: { message: 'quelque chose d\'imprévu' } }; } } } });
  await m.completer('s1'); await m.completer('s2');
  await attendre(20);
  eq('après le 1er échec inconnu : le geste attend (essai 1/5), le 2e ne le dépasse pas', [m.attentes().length, m.run('gestesEnAttente()[0].essais')], [2, 1]);
  await attendre(400);
  eq('après 5 essais exactement, le geste va dans « non envoyés » (« après 5 essais »)', [n, m.refus().length, m.refus()[0]?.raison.includes('après 5 essais')], [5, 1, true]);
  eq('et le 2e geste, qui attendait derrière, est enfin parti', [m.envoisGestes().filter((x) => x === 'completer_arret:s2').length, m.attentes().length], [1, 0]);
  m.fin();
  // Le nombre d'essais survit à un redémarrage
  const a = monde({ delais: [5000], serveur: { completer_arret: async () => ({ data: null, error: { message: 'imprévu' } }) } });
  await a.completer('s1'); await attendre(20);
  const b = monde({ memoire: a.memoire(), delais: [5000] });
  await monter(b);
  eq('le nombre d\'essais est gardé sur le téléphone (il ne repart pas à zéro à chaque ouverture)', b.run('gestesEnAttente()[0].essais'), 1);
  a.fin(); b.fin();
  // « Accès refusé » (42501) n'est pas un refus tout de suite : une session pas encore renouvelée en est souvent la cause
  const c = monde({ delais: [5000], serveur: { completer_arret: async () => ({ data: null, error: { message: 'permission denied for function completer_arret', code: '42501' } }) } });
  await c.completer('s1'); await attendre(20);
  eq('« permission denied » (42501) : traité comme inconnu (le geste attend, il n\'est pas jeté)', [c.attentes().length, c.refus().length], [1, 0]);
  c.fin();
}

log('\n=== SANS SESSION VALABLE : on n\'envoie pas (la demande partirait sans identité) ===');
{
  const m = monde({ delais: [5000] });
  m.etat.session = null;
  await m.completer('s1'); await attendre(30);
  eq('aucun envoi, le geste attend', [m.appels.envois.length, m.attentes().length, m.refus().length], [0, 1, 0]);
  m.etat.session = { user: { id: 'u-luc' } };
  await m.run('rejouerFile()');
  eq('la session est là : le geste part', [m.appels.envois.length, m.attentes().length], [1, 0]);
  m.fin();
}

log('\n=== UN PROBLÈME ET SA PHOTO ===');
{
  // Le problème part, puis la photo ; un renvoi (« déjà là ») n'est pas une erreur
  const photo = new Blob(['jpeg'], { type: 'image/jpeg' });
  const dejaLa = { 'insert:problemes': async () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }) };
  const m = monde({ serveur: dejaLa, upload: async () => ({ data: null, error: { statusCode: '409', message: 'The resource already exists' } }) });
  await m.enfiler('probleme', { id: 'pb-1', stopId: 's1', passeId: 'p-luc', note: 'barrière fermée' }, { libelle: '⚠ Problème : barrière fermée' });
  await m.enfiler('probleme_photo', { problemeId: 'pb-1' }, { libelle: '📷 Photo du problème', photo });
  await attendre(60);
  eq('problème déjà enregistré (clé en double) = succès ; photo déjà envoyée (409) = succès', [m.attentes().length, m.refus().length], [0, 0]);
  eq('ordre : le problème (texte) d\'abord, puis la photo dans l\'espace privé, puis le lien au problème', [m.envoisGestes(), m.appels.uploads, m.appels.envois.map((x) => x.nom).pop()], [['insert:problemes', 'probleme_attacher_photo'], ['u-luc/pb-1.jpg'], 'probleme_attacher_photo']);
  eq('le problème part avec son numéro, son arrêt, sa passe, sa note (jamais « lu » ni le nom)', Object.keys(m.appels.envois[0].args).sort(), ['id', 'note', 'passe_id', 'stop_id']);
  m.fin();
  // Le problème est refusé : la photo l'est aussi (elle n'a rien à quoi se relier), les deux sont dans la liste
  const r = monde({ serveur: { 'insert:problemes': async () => ({ data: null, error: { message: 'new row violates row-level security policy', code: '42501' } }) }, delais: [5000] });
  await r.enfiler('probleme', { id: 'pb-2', stopId: 's1', passeId: null, note: 'x' }, { libelle: '⚠ Problème : x' });
  await attendre(20);
  eq('« accès refusé » sur un problème : il attend (inconnu), la photo derrière lui aussi — rien ne se perd', [r.attentes().length, r.refus().length], [1, 0]);
  r.fin();
  // Une photo perdue du téléphone (pas de blob) : refus clair, pas de plantage
  const p = monde({});
  await p.enfiler('probleme_photo', { problemeId: 'pb-3' }, { libelle: '📷 Photo' }); await attendre(30);
  eq('photo sans fichier : refus lisible', p.refus().map((x) => x.raison), ['La photo n’a pas pu être envoyée.']);
  p.fin();
}

log('\n=== UNE PASSE DÉBUTÉE SANS RÉSEAU : les équipiers que le serveur refuse sont notés à part ===');
{
  const eq_ = [{ utilisateur_id: 'u-marc', cle_client: crypto.randomUUID(), forcer: false, nom: 'Marc' }, { utilisateur_id: 'u-eric', cle_client: crypto.randomUUID(), forcer: true, nom: 'Eric' }];
  const m = monde({ serveur: { debuter_passe: async () => ({ data: { statut: 'debutee', equipage: [{ utilisateur_id: 'u-marc', statut: 'ajoute' }, { utilisateur_id: 'u-eric', statut: 'refuse', raison: 'chauffeur_ailleurs', vehicule: 'Camion 2' }] }, error: null }) } });
  await m.enfiler('debuter_passe', { passeId: 'p-neuve', routeId: CH, equipeId: 'e1', tache: MEC, lat: 46.4, lon: -72.9, equipage: eq_ }, { libelle: '▶ Passe débutée (Camion 1)' });
  await attendre(40);
  const a = m.appels.envois[0].args;
  eq('la passe part avec son identifiant, sa route, son camion, sa tâche, l\'heure du geste et l\'équipage (avec « forcer »)', [a.p_id, a.p_route_id, a.p_equipe_id, a.p_tache, typeof a.p_moment, a.p_equipage.map((x) => x.forcer)], ['p-neuve', CH, 'e1', MEC, 'string', [false, true]]);
  eq('la passe est débutée : plus rien en attente', m.attentes().length, 0);
  eq('mais Eric n\'a pas pu monter : c\'est noté dans « non envoyés », avec la raison', m.refus(), [{ libelle: 'Équipage : Eric (passe débutée sans réseau)', raison: 'Eric conduit déjà « Camion 2 ».' }]);
  m.fin();
}

log('\n=== TOUS LES TYPES DE GESTES APPELLENT LA BONNE FONCTION DU SERVEUR ===');
{
  const m = monde({});
  const cle = crypto.randomUUID();
  await m.completer('s1'); await m.enfiler('annuler_arret', { passeId: 'p-luc', stopId: 's1' }, {}); await m.enfiler('terminer_passe', { passeId: 'p-luc' }, {});
  await m.enfiler('equipage_ajouter', { cle, passeId: 'p-luc', userId: 'u-eric', nom: 'Eric' }, {}); await m.enfiler('equipage_retirer', { cle: crypto.randomUUID(), passeId: 'p-luc', userId: 'u-eric', nom: 'Eric' }, {});
  await attendre(60);
  eq('les 5 gestes : la bonne fonction, dans l\'ordre', m.appels.envois.map((x) => x.nom), ['completer_arret', 'annuler_arret', 'terminer_passe', 'equipage_ajouter', 'equipage_retirer']);
  eq('terminer et compléter portent l\'heure du geste', [typeof m.appels.envois[0].args.p_moment, typeof m.appels.envois[2].args.p_moment], ['string', 'string']);
  eq('la clé client de l\'équipage est celle du geste (un renvoi ne fait pas de doublon)', m.appels.envois[3].args.p_cle_client, cle);
  eq('« annuler » n\'envoie PAS encore d\'heure (le fichier SQL 18, étape 16d, ne l\'accepte pas encore : sinon le serveur refuserait)', Object.keys(m.appels.envois[1].args).sort(), ['p_passe_id', 'p_stop_id']);
  eq('tout est parti', [m.attentes().length, m.refus().length], [0, 0]);
  m.fin();
}

log('\n=== L\'APPLICATION S\'OUVRE AVEC UNE FILE DE LA SÉANCE PRÉCÉDENTE ===');
{
  const a = monde({ enLigne: false }); await a.completer('s1'); await a.completer('s2');
  // Ouverture SANS signal : la bande le dit, rien n'est envoyé
  const hors = monde({ enLigne: false, memoire: a.memoire() });
  hors.run('reseau.enLigne = false');
  await monter(hors);
  eq('ouverture sans signal : 2 gestes en attente dans la bande, aucun envoi', [hors.bande().texte.includes('2 gestes en attente'), hors.appels.envois.length], [true, 0]);
  hors.fin();
  // Ouverture AVEC signal : ils partent, l'application se relit ensuite
  const en = monde({ memoire: a.memoire() });
  await en.run('loadStops()'); await attendre(80);
  eq('ouverture avec signal : les 2 gestes partent dans l\'ordre', en.envoisGestes(), ['completer_arret:s1', 'completer_arret:s2']);
  eq('la file est vide, plus de bande', [en.attentes().length, en.bande().visible], [0, false]);
  a.fin(); en.fin();
}

log('\n=== UN GESTE ILLISIBLE OU DÉJÀ REFUSÉ NE REVIENT PAS EN ATTENTE ===');
{
  const m0 = monde({ enLigne: false }); await m0.completer('s1'); const mem = m0.memoire(); m0.fin();
  const cle = Object.keys(mem)[0];
  // Un geste d'une autre version de l'application
  const futur = JSON.parse(JSON.stringify(mem)); futur[cle].v = 99;
  const m = monde({ enLigne: false, memoire: futur }); await monter(m);
  eq('geste d\'une autre version : jamais jeté en silence, jamais envoyé : il est dans « non envoyés »', [m.attentes().length, m.refus().length, m.refus()[0]?.raison.includes('cette version')], [0, 1, true]);
  m.fin();
  // Refusé (ref) mais l'application s'est fermée avant de le retirer de « att » : il ne doit pas repartir
  const double = JSON.parse(JSON.stringify(mem)); const g = double[cle];
  double[cle.replace(':att:', ':ref:')] = { ...g, refus: { raison: 'Cette passe n’existe plus.', le: iso(1) } };
  const d = monde({ memoire: double }); await monter(d); await attendre(30);
  eq('à la fois « att » et « ref » : on garde le refus, on n\'envoie rien, et « att » est nettoyé', [d.attentes().length, d.refus().length, d.appels.envois.length, d.cles('file:u-luc:att:').length], [0, 1, 0, 0]);
  d.fin();
}

log('\n=== DÉCONNEXION : BLOQUÉE TANT QU\'UN GESTE ATTEND ===');
{
  const m = monde({ enLigne: false }); await m.completer('s1'); await m.completer('s2');
  await m.run('doLogout()');
  eq('geste en attente : la déconnexion est refusée avec un message clair (et rien n\'est déconnecté)', [m.appels.confirmations[0][0], m.appels.confirmations[0][1].includes('2 gestes ne sont pas encore envoyés'), m.appels.signOut, m.appels.reload], ['Déconnexion impossible', true, 0, 0]);
  eq('on n\'a PAS demandé « Se déconnecter ? » (une seule boîte)', m.appels.confirmations.length, 1);
  eq('« Voir la liste » ouvre la liste des gestes', m.el('gestes-overlay').classList.contains('open'), true);
  eq('la file est intacte', m.cles().length, 2);
  m.fin();
  // Les gestes REFUSÉS ne bloquent pas la déconnexion (il n'y a plus rien à envoyer) ; ils restent sur le téléphone
  const r = monde({ serveur: { completer_arret: async () => ({ data: null, error: { message: 'passe_introuvable', code: 'P0001' } }) } });
  await r.completer('s1'); await attendre(30);
  await r.run('doLogout()');
  eq('seulement un geste refusé : la déconnexion se déroule (elle demande la confirmation habituelle)', [r.appels.confirmations[0][0], r.appels.signOut, r.appels.reload], ['Se déconnecter ?', 1, 1]);
  eq('… et la liste des gestes non envoyés reste sur le téléphone (la file n\'est jamais effacée)', r.cles('file:u-luc:ref:').length, 1);
  r.fin();
  // File vide : déconnexion normale
  const v = monde({}); await v.run('doLogout()');
  eq('file vide : déconnexion normale', [v.appels.confirmations[0][0], v.appels.signOut], ['Se déconnecter ?', 1]);
  v.fin();
}

log('\n=== LA BANDE ET LA LISTE ===');
{
  const m = monde({ delais: [5000], serveur: { completer_arret: async (a) => (a.p_stop_id === 's1' ? { data: null, error: { message: 'delai_depasse', code: 'P0001' } } : undefined) } });
  await m.completer('s1', '✔ Complété : <img src=x onerror=alert(1)>'); await attendre(30);
  m.reseau(false); m.run('reseau.enLigne = false');
  await m.completer('s2', '✔ Complété : <b onmouseover=alert(2)>');
  eq('la bande : hors réseau + 1 en attente + 1 non envoyé', m.bande().texte, '📴 Hors réseau · ⏳ 1 geste en attente · ⚠ 1 geste non envoyé');
  eq('toucher la bande ouvre la liste', typeof m.el('bandeau-reseau').onclick, 'function');
  m.run('ouvrirListeGestes()');
  const html = m.el('gestes-corps').innerHTML;
  eq('la liste ouverte', m.el('gestes-overlay').classList.contains('open'), true);
  vrai('la liste montre les non envoyés (raison + bouton « Fermer ») puis les en attente (sans bouton)', html.includes('Non envoyés (1)') && html.includes('Trop tard pour annuler') && html.includes('geste-fermer') && html.includes('En attente (1)') && (html.match(/geste-fermer/g) || []).length === 1, html.slice(0, 300));
  vrai('le texte d\'un geste est protégé (aucun HTML exécutable)', !html.includes('<img') && html.includes('&lt;img') && !html.includes('<b ') && html.includes('&lt;b onmouseover'), html.slice(0, 200));
  m.run('fermerListeGestes()');
  eq('« Fermer la fenêtre » la ferme', m.el('gestes-overlay').classList.contains('open'), false);
  // Plus rien : la bande n'est plus cliquable et la liste se ferme d'elle-même
  const v = monde({});
  eq('file vide : bande cachée, pas cliquable', [v.bande().visible, v.el('bandeau-reseau').onclick], [false, null]);
  v.run('ouvrirListeGestes()');
  eq('file vide : la liste ne s\'ouvre pas', v.el('gestes-overlay').classList.contains('open'), false);
  m.fin(); v.fin();
}

log('\n=== RÉSEAU PARTIEL : la sonde répond, les gestes échouent → pas de boucle qui martèle le serveur ===');
{
  // La sonde (auth/health) réussit, mais chaque envoi de geste échoue comme une coupure : l'application saute entre « en ligne » et « hors réseau »
  const m = monde({ enLigne: false, sondeMs: 25, serveur: { completer_arret: async () => { throw new Error('Failed to fetch'); } } });
  await m.completer('s1');
  m.run('demarrerSonde()');   // l'application surveille le retour du signal
  m.reseau(true);
  await attendre(400);
  vrai('400 ms de signal « partiel » (sonde toutes les 25 ms) : au plus un essai par passage de sonde, pas des centaines', m.appels.envois.length > 0 && m.appels.envois.length < 40, m.appels.envois.length);
  eq('le geste est toujours là (jamais perdu, jamais compté comme échec inconnu)', [m.attentes().length, m.refus().length, m.run('gestesEnAttente()[0].essais')], [1, 0, 0]);
  m.fin();
}

log('\n=== LA PAGE ===');
{
  const html = lire('index.html');
  vrai('la page charge file-attente.js après hors-reseau.js et avant auth.js', html.indexOf('js/hors-reseau.js') < html.indexOf('js/file-attente.js') && html.indexOf('js/file-attente.js') < html.indexOf('js/auth.js'));
  vrai('la fenêtre « Gestes non envoyés » existe (fond, boîte, corps, boutons)', ['gestes-overlay', 'gestes-corps', 'fermerListeGestes()', 'bgClickGestes(event)'].every((s) => html.includes(s)));
  const css = lire('css/style.css');
  vrai('le style de la liste et de la bande cliquable existe', css.includes('#gestes-overlay.open') && css.includes('#bandeau-reseau.actif'));
  vrai('rien de secret dans le code de la file (aucune clé de service, aucun NIP)', !/service_role|sb_secret|nip|password/i.test(lire('js/file-attente.js').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')));
}

tousLesMondes.forEach((w) => w.fin());
console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
