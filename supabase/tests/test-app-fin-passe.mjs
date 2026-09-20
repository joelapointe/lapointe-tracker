// Étape 14c — le tour terminé reste VERT jusqu'au prochain « Débuter », le résumé de fin de passe, « Annuler » un arrêt (10 minutes).
// Testé avec les VRAIS fichiers de l'application chargés dans un faux navigateur et un FAUX Supabase qui répond dans le format du
// fichier 15 (tours_en_cours avec « en_cours », « faits_il_y_a », « mes_passes_annulables »). Le vrai Supabase : reel-etape-14.mjs.
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
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();

const MEC = 'Déneigement mécanique', SEL = 'Épandage de sel';
const CH = 'route-charette', SE = 'route-saint-etienne';
const LUC = { id: 'u-luc', nom: 'Luc', role: 'employe' }, JOE = { id: 'u-joe', nom: 'Joé', role: 'admin' };

function monde(o = {}) {
  const els = {};
  const creer = (id) => {
    const classes = new Set(); const attrs = {};
    const e = { id, children: [], style: {}, textContent: '', _html: '', value: '', disabled: false, className: '', onclick: null, dataset: {},
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
      appendChild(c) { c.parent = this; this.children.push(c); return c; }, setAttribute(k, v) { attrs[k] = v; }, getAttribute(k) { return k in attrs ? attrs[k] : null; }, focus() {},
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); },
      querySelector(sel) { return this.children.find((c) => '.' + c.className === sel) ?? null; } };
    Object.defineProperty(e, 'innerHTML', { get() { return this._html; }, set(v) { this._html = v; if (v === '') this.children = []; } });
    return e;
  };
  const el = (id) => (els[id] ??= creer(id));
  const user = o.utilisateur ?? LUC;
  const memo = { ...(o.memo ?? {}) };
  const donnees = {
    stops: STOPS.map((s) => ({ ...s })), routes: ROUTES.map((r) => ({ ...r })), problemes: [], positions: o.positions ?? [],
    equipes: [{ id: 'e1', nom: 'Camion 1' }, { id: 'e2', nom: 'Camion 2' }], equipage_periodes: [],
    tours: o.tours ?? [], passes: o.passes ?? [],
  };
  const appels = { rpc: [], eq: [], toasts: [], confirmations: [], ecritures: [], lectures: [] };
  const fauxDb = {
    rpc: async (nom, args) => {
      appels.rpc.push({ nom, args });
      if (o.toursCoupes && nom === 'tours_en_cours') throw new Error('Failed to fetch');
      if (o.rpc?.[nom]) { const r = o.rpc[nom](args, donnees); if (r instanceof Error) throw r; return r; }
      if (nom === 'tours_en_cours') return { data: donnees.tours, error: null };
      return { data: null, error: { message: 'inconnu' } };
    },
    from: (table) => {
      const q = { op: 'select', filtres: [], ordre: null, max: null, unique: false };
      q.select = () => q;
      q.eq = (c, v) => { appels.eq.push([table, c, v]); q.filtres.push([c, v]); return q; };
      q.order = (c, opt) => { q.ordre = [c, opt?.ascending !== false]; return q; };
      q.limit = (n) => { q.max = n; return q; };
      q.maybeSingle = () => { q.unique = true; return q; };
      q.is = () => q;
      q.insert = () => { q.op = 'insert'; return q; };
      q.update = () => { q.op = 'update'; return q; };
      q.delete = () => { q.op = 'delete'; return q; };
      q.then = (ok_, ko_) => {
        if (q.op !== 'select') appels.ecritures.push({ table, op: q.op });
        appels.lectures.push(table);
        if (o.lectureLance?.includes(table)) throw new Error('Failed to fetch');
        let rows = (donnees[table] ?? []).filter((r) => q.filtres.every(([c, v]) => !(c in r) || r[c] === v));
        if (q.ordre) rows = [...rows].sort((a, b) => (a[q.ordre[0]] < b[q.ordre[0]] ? -1 : 1) * (q.ordre[1] ? 1 : -1));
        if (q.max != null) rows = rows.slice(0, q.max);
        return Promise.resolve({ data: q.unique ? (rows[0] ?? null) : rows, error: null }).then(ok_, ko_);
      };
      return q;
    },
  };
  const sandbox = {
    document: { getElementById: el, createElement: () => creer(null) },
    localStorage: { getItem: (k) => (k in memo ? memo[k] : null), setItem: (k, v) => { memo[k] = String(v); }, removeItem: (k) => { delete memo[k]; } },
    window: { open() {} }, setTimeout, clearTimeout, setInterval, clearInterval, console,
    L: { divIcon: (opt) => opt, marker: (ll, opt) => { const m = { ll, opt, addTo() { return m; }, on() {}, setLatLng() { return m; }, setIcon() { return m; }, bindPopup() { return m; }, setPopupContent() { return m; } }; (opt?.zIndexOffset === 500 ? camions : marqueurs).push(m); return m; }, polygon: () => ({ addTo() { return this; } }) },
    __map: { removeLayer() {}, flyTo() {} }, __fauxDb: fauxDb, setStatus() {}, hideLoading() {}, showErr() {},
    __confirmations: appels.confirmations, __toasts: appels.toasts, __reponses: o.confirme ?? [true],
  };
  const marqueurs = [], camions = [];
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/config.js', 'js/utilitaires.js', 'js/hors-reseau.js', 'js/file-attente.js', 'js/tours.js', 'js/vehicules.js', 'js/equipage.js', 'js/equipage-panneau.js', 'js/passe.js', 'js/resume-passe.js', 'js/arrets.js', 'js/routes.js', 'js/liste-arrets.js', 'js/problemes.js', 'js/photos.js'])
    vm.runInContext(lire(f), ctx, { filename: f });
  vm.runInContext('db = __fauxDb; map = __map; currentUser = ' + JSON.stringify(user) + ';', ctx);
  vm.runInContext('toast = (m) => { __toasts.push(m); }; confirmer = async (...a) => { __confirmations.push(a); return __reponses.length > 1 ? __reponses.shift() : __reponses[0]; };', ctx);
  const w = {
    ctx, el, donnees, appels, memo, marqueurs, camions,
    run: (code) => vm.runInContext(code, ctx),
    routeActive: (id) => vm.runInContext(`routeActive = ${JSON.stringify(id)};`, ctx),
    dernierToast: () => appels.toasts[appels.toasts.length - 1],
    couleur: (mk) => (mk.opt.icon.html.match(/background:(#[0-9a-f]+)/) || [])[1],
    couleurs: () => marqueurs.slice(-4).map((mk) => (mk.opt.icon.html.match(/background:(#[0-9a-f]+)/) || [])[1]),   // s1, s2, s3, s4 (dernier dessin)
    resumeOuvert: () => el('resume-overlay').classList.contains('open'),
    rpcs: (nom) => appels.rpc.filter((r) => r.nom === nom),
    charge: async () => { await w.run('loadStops()'); await attendre(20); return w; },
    fin: () => vm.runInContext('clearInterval(_minuterieEnCours);_minuterieEnCours=null;arreterSonde();', ctx),
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
];
const ROUTES = [{ id: CH, nom: 'Charette', couleur: '#c8e63c', actif: true }, { id: SE, nom: 'Saint-étienne-des-grès', couleur: '#60a5fa', actif: true }];
const idx = (id) => STOPS.findIndex((s) => s.id === id);
// Un tour EN COURS dont je suis le chauffeur (s1 fait il y a 2 minutes) et un tour TERMINÉ (les deux arrêts faits), dans le format du fichier 15
const tourEC = (o = {}) => ({ route_id: CH, tache: MEC, numero: 1, en_cours: true, debut: iso(60), fin: null, fin_type: null, fin_estimee: false, total: 2, faits: 1, pourcentage: 50,
  arrets_faits: ['s1'], faits_il_y_a: { s1: 120 }, mes_passes_annulables: [], passes: [{ passe_id: 'p-luc', equipe_id: 'e1', chauffeur_id: 'u-luc', je_suis_chauffeur: true, je_suis_a_bord: true }], ...o });
const tourFini = (o = {}) => ({ route_id: CH, tache: MEC, numero: 1, en_cours: false, debut: iso(134), fin: iso(0), fin_type: 'complete', fin_estimee: false, total: 2, faits: 2, pourcentage: 100,
  arrets_faits: ['s1', 's2'], faits_il_y_a: { s1: 3000, s2: 60 }, mes_passes_annulables: ['p-luc'], passes: [], ...o });
const ligne = (o = {}) => ({ id: 'p-luc', numero: 1, tache: MEC, route_id: CH, equipe_id: 'e1', chauffeur_id: 'u-luc', debut: iso(134), fin: iso(0), fin_type: 'complete', fin_estimee: false, statut: 'terminee',
  nb_arrets_total: 2, nb_arrets_faits: 2, pourcentage: 100, ...o });

// =====================================================================
log('=== LE TOUR TERMINÉ RESTE VERT jusqu\'au prochain « Débuter la passe » ===');
{
  let m = await monde({ tours: [tourFini()] }).charge();
  eq('passe complétée (2/2) : les deux arrêts de Charette restent VERTS, celui de Saint-étienne et celui de sel restent jaunes', m.couleurs(), ['#4ade80', '#4ade80', '#c8e63c', '#c8e63c']);
  eq('… estFait : vrai pour s1 et s2', [m.run(`estFait(stops[${idx('s1')}])`), m.run(`estFait(stops[${idx('s2')}])`), m.run(`estFait(stops[${idx('s3')}])`)], [true, true, false]);
  m.routeActive(CH); await m.run('renderAll()');
  eq('la barre du bas de la route montre l\'avancement final : 2/2, 100 %', [m.el('prog-txt').textContent, m.el('prog-pct').textContent], ['2/2', '100%']);
  eq('progression() : pas « aucune passe », mais plus aucune passe EN COURS', m.run('[progression().aucune, progression().enCours]'), [false, false]);
  m.run(`openCard(${idx('s1')})`);
  eq('la fiche d\'un arrêt fait : « Passe n° 1 terminée · 2/2 (100 %) »', m.el('sc-tour').textContent, 'Passe n° 1 terminée · 2/2 (100 %)');
  m.run(`openCard(${idx('s3')})`);
  eq('un arrêt d\'une AUTRE tâche (sel, sans tour) : « Aucune passe en cours pour ce type de service »', m.el('sc-tour').textContent, 'Aucune passe en cours pour ce type de service');
  m.run('renderRoutes()');
  vrai('la liste des routes ne compte PAS le tour terminé comme « passe en cours »', !m.el('routes-body').children[1].innerHTML.includes('passe'), m.el('routes-body').children[1].innerHTML);
  m.run('renderListe()');
  eq('la liste des arrêts : les 2 arrêts du tour terminé sont complétés, celui de sel (sans tour) reste à faire', m.el('liste-sub').textContent, '1 restant · 2 complétés · passe terminée');
  eq('aucun camion sur la carte pour un tour terminé', m.run('listeCamions().length'), 0);
  eq('un tour terminé ne se « rejoint » pas', m.run(`tourARejoindre('${CH}', '${MEC}')`), null);

  // Passe arrêtée à la main à 1/2 : ce qui a été fait reste vert, le reste jaune
  m = await monde({ tours: [tourFini({ faits: 1, pourcentage: 50, fin_type: 'manuelle', arrets_faits: ['s1'], faits_il_y_a: { s1: 3000 }, mes_passes_annulables: [] })] }).charge();
  eq('passe terminée à la main (1/2) : s1 fait reste VERT, s2 reste JAUNE', m.couleurs().slice(0, 2), ['#4ade80', '#c8e63c']);
  m.routeActive(CH); m.run('renderListe()');
  eq('la liste dit « passe terminée »', m.el('liste-sub').textContent, '2 restants · 1 complété · passe terminée');
  const e2 = m.run(`etatComplete(stops[${idx('s2')}])`);
  eq('l\'arrêt pas fait d\'un tour terminé : bouton grisé « Passe terminée », avec l\'explication', [e2.actif, e2.texte, e2.explication], [false, 'Passe terminée', 'Cette passe est terminée : il faut débuter une nouvelle passe.']);
  m.run(`openCard(${idx('s2')})`); await m.run('completeStop()');
  eq('le toucher explique et n\'appelle jamais le serveur', [m.dernierToast(), m.rpcs('completer_arret').length], ['Cette passe est terminée : il faut débuter une nouvelle passe.', 0]);

  // Un camion près d'un client d'un tour terminé : jamais bleu
  m = await monde({ tours: [tourFini({ faits: 0, pourcentage: 0, arrets_faits: [], faits_il_y_a: {}, mes_passes_annulables: [] })], positions: [{ passe_id: 'p-luc', lat: 46.443, lon: -72.922, precision_m: 8, maj_le: iso(0.2) }] }).charge();
  eq('un camion (position récente) sur place chez un client d\'un tour TERMINÉ : jamais « en cours » (bleu)', [m.run(`estEnCours(stops[${idx('s2')}])`), m.couleurs()[1]], [false, '#c8e63c']);

  // « Débuter » remet à zéro : le nouveau tour remplace le tour terminé
  m = await monde({
    tours: [tourFini()],
    rpc: { debuter_passe: (a, d) => { d.tours = [tourEC({ numero: 2, faits: 0, pourcentage: 0, arrets_faits: [], faits_il_y_a: {}, passes: [{ passe_id: a.p_id, equipe_id: a.p_equipe_id, chauffeur_id: 'u-luc', je_suis_chauffeur: true, je_suis_a_bord: true }] })]; return { data: { statut: 'debutee', numero: 2, tour_rejoint: false }, error: null }; },
      tours_en_cours: (a, d) => ({ data: d.tours, error: null }) } }).charge();
  m.routeActive(CH); await m.run('ouvrirDebut()');
  m.run('choisirRouteDebut(' + JSON.stringify(CH) + ')'); m.run('choisirTacheDebut(' + JSON.stringify(MEC) + ')'); m.run("choisirVehiculeDebut('e1')");
  vrai('avant de démarrer, l\'écran NE dit PAS « tu rejoins » (le tour terminé n\'est pas à rejoindre)', !m.el('debut-body').children.some((c) => c.innerHTML.includes('Tu la rejoins')));
  await m.run('demarrerPasse()');
  eq('« Débuter » : aucune question, le serveur est appelé une fois', [m.appels.confirmations.length, m.rpcs('debuter_passe').length], [0, 1]);
  eq('le nouveau tour (n° 2, 0/2) remplace le tour terminé : les arrêts de Charette redeviennent JAUNES', [m.run('tours.length'), m.run('tours[0].numero'), m.couleurs().slice(0, 2)], [1, 2, ['#c8e63c', '#c8e63c']]);
  eq('… la barre du bas repart à 0/2', [m.el('prog-txt').textContent, m.el('prog-pct').textContent], ['0/2', '0%']);
  vrai('… le bandeau montre MA nouvelle passe (0 %)', m.el('passe-bandeau').innerHTML.includes('0 %') && m.el('passe-bandeau').innerHTML.includes('btn-terminer'), m.el('passe-bandeau').innerHTML);
  eq('… et le démarrage ne provoque AUCUN résumé de fin', m.resumeOuvert(), false);

  // Compatibilité : un serveur qui ne connaît pas encore « en_cours » (avant le fichier 15) : tout est « en cours » comme avant
  m = await monde({ tours: [{ route_id: CH, tache: MEC, numero: 1, total: 2, faits: 1, pourcentage: 50, arrets_faits: ['s1'], passes: [{ passe_id: 'p-luc', equipe_id: 'e1', chauffeur_id: 'u-luc', je_suis_chauffeur: true, je_suis_a_bord: true }] }] }).charge();
  eq('ancien format du serveur (sans « en_cours ») : traité comme un tour en cours, aucun « Annuler » offert', [m.run('tourEnCours(tours[0])'), m.run(`etatComplete(stops[${idx('s2')}])`).actif, m.run(`etatComplete(stops[${idx('s1')}])`).texte], [true, true, '✔ Déjà complété']);
}

log('\n=== ANNULER UN ARRÊT COMPLÉTÉ PAR ERREUR (10 minutes) ===');
{
  const ouvrir = async (o = {}, id = 's1') => { const m = await monde(o).charge(); m.run(`openCard(${idx(id)})`); return m; };
  const etat = (m, id = 's1') => m.run(`etatComplete(stops[${idx(id)}])`);

  let m = await ouvrir({ tours: [tourEC()] });
  let e = etat(m);
  eq('chauffeur, arrêt fait il y a 2 min : le bouton devient « ↩ Annuler (8 min) », actif, vers MA passe', [e.texte, e.actif, e.action, e.passeId, e.termine], ['↩ Annuler (8 min)', true, 'annuler', 'p-luc', false]);
  eq('la fiche montre le bouton orange « Annuler »', [m.el('btn-cmp').textContent, m.el('btn-cmp').className, m.el('btn-cmp').disabled], ['↩ Annuler (8 min)', 'scb annulable', false]);

  for (const [age, attendu] of [[599, '↩ Annuler (1 min)'], [540, '↩ Annuler (1 min)'], [420, '↩ Annuler (3 min)'], [600, '✔ Déjà complété'], [601, '✔ Déjà complété'], [7200, '✔ Déjà complété']]) {
    const x = await monde({ tours: [tourEC({ faits_il_y_a: { s1: age } })] }).charge();
    eq(`arrêt fait il y a ${age} s : ${attendu}`, etat(x).texte, attendu);
  }
  m = await ouvrir({ tours: [tourEC()] });
  m.run('_toursLusLe -= 5 * 60000');
  eq('le temps passe SANS relire le serveur (5 min depuis la lecture) : il reste 3 min', etat(m).texte, '↩ Annuler (3 min)');
  m.run('_toursLusLe -= 4 * 60000');
  eq('… 9 min après la lecture : il n\'y a plus de bouton « Annuler »', etat(m).texte, '✔ Déjà complété');
  m = await ouvrir({ tours: [tourEC({ faits_il_y_a: { s1: 590 } })] });
  vrai('la fiche ouverte : le délai est renouvelé par la relecture de secours (toutes les 15 s) et le bouton disparaît de lui-même', m.el('btn-cmp').className === 'scb annulable', m.el('btn-cmp').className);
  m.run('_toursLusLe -= 30000');
  await m.run('rafraichirEnCours()');
  eq('… après 30 s de plus : « Déjà complété », grisé (sans rien toucher)', [m.el('btn-cmp').textContent, m.el('btn-cmp').disabled], ['✔ Déjà complété', true]);

  // Qui peut annuler
  m = await ouvrir({ tours: [tourEC({ passes: [{ passe_id: 'p-marc', equipe_id: 'e2', chauffeur_id: 'u-marc', je_suis_chauffeur: false, je_suis_a_bord: true }] })] });
  eq('un PASSAGER ne peut pas annuler', [etat(m).actif, etat(m).texte], [false, '✔ Déjà complété']);
  m = await ouvrir({ utilisateur: JOE, tours: [tourEC({ passes: [{ passe_id: 'p-marc', equipe_id: 'e2', chauffeur_id: 'u-marc', je_suis_chauffeur: false, je_suis_a_bord: false }] })] });
  eq('l\'administrateur qui n\'est pas le chauffeur : pas de bouton (ses corrections viendront à l\'étape 19)', etat(m).actif, false);
  m = await ouvrir({ utilisateur: JOE, tours: [tourEC({ passes: [{ passe_id: 'p-joe', equipe_id: 'e1', chauffeur_id: 'u-joe', je_suis_chauffeur: true, je_suis_a_bord: true }] })] });
  eq('l\'administrateur qui est LE chauffeur de sa passe : il annule comme un autre chauffeur', [etat(m).actif, etat(m).passeId], [true, 'p-joe']);
  m = await ouvrir({ tours: [tourEC({ faits_il_y_a: {} })] });
  eq('un serveur qui ne donne pas l\'âge de l\'arrêt : aucun « Annuler » (jamais de deviner)', etat(m).texte, '✔ Déjà complété');
  m = await ouvrir({ tours: [tourEC({ faits: 1, arrets_faits: ['s1'], faits_il_y_a: { s1: 60 } })] }, 's2');
  eq('un arrêt PAS fait garde son bouton « Complété »', [etat(m, 's2').texte, etat(m, 's2').action ?? null], ['✔ Complété', null]);

  // Tour terminé
  m = await ouvrir({ tours: [tourFini()] }, 's2');
  e = etat(m, 's2');
  eq('tour TERMINÉ à 100 % (dernier arrêt fait il y a 1 min) : « ↩ Annuler (9 min) » par MA passe terminée', [e.texte, e.passeId, e.termine], ['↩ Annuler (9 min)', 'p-luc', true]);
  eq('… l\'arrêt fait il y a 50 min du même tour : pas de bouton', etat(m, 's1').texte, '✔ Déjà complété');
  m = await ouvrir({ tours: [tourFini({ mes_passes_annulables: [] })] }, 's2');
  eq('tour terminé dont je n\'ai pas de passe annulable (autre chauffeur, ou terminée à la main) : pas de bouton', etat(m, 's2').texte, '✔ Déjà complété');

  // Le geste
  m = await ouvrir({ tours: [tourEC()], confirme: [false] });
  await m.run('completeStop()');
  eq('toucher « Annuler » : la boîte de l\'application, avec l\'adresse ; « Non » (par défaut) : rien n\'est envoyé', [m.appels.confirmations, m.rpcs('annuler_arret').length], [[['Annuler ce « Complété » ?', '304 rue de l\'Église redeviendra à faire.', 'Oui, annuler', 'Non']], 0]);
  const annule = (a, d) => { d.tours = [tourEC({ faits: 0, pourcentage: 0, arrets_faits: [], faits_il_y_a: {} })]; return { data: { statut: 'annule', passe_rouverte: false, faits: 0 }, error: null }; };
  m = await ouvrir({ tours: [tourEC()], rpc: { annuler_arret: annule, tours_en_cours: (a, d) => ({ data: d.tours, error: null }) } });
  await m.run('completeStop()');
  eq('« Oui, annuler » : UN appel annuler_arret avec MA passe et l\'arrêt, rien d\'autre', m.rpcs('annuler_arret').map((r) => r.args), [{ p_passe_id: 'p-luc', p_stop_id: 's1' }]);
  eq('l\'arrêt redevient à faire (jaune), la fiche reste ouverte avec « ✔ Complété » de nouveau actif, message', [m.couleurs()[0], m.el('stop-card').classList.contains('open'), m.el('btn-cmp').textContent, m.el('btn-cmp').disabled, m.dernierToast()], ['#c8e63c', true, '✔ Complété', false, '↩ Arrêt annulé']);
  eq('aucune écriture directe dans les tables', m.appels.ecritures, []);

  // Annuler dans un tour terminé : la passe se rouvre
  const rouvre = (a, d) => { d.tours = [tourEC({ faits: 1, pourcentage: 50, arrets_faits: ['s1'], faits_il_y_a: { s1: 3000 } })]; return { data: { statut: 'annule', passe_rouverte: true }, error: null }; };
  m = await ouvrir({ tours: [tourFini()], rpc: { annuler_arret: rouvre, tours_en_cours: (a, d) => ({ data: d.tours, error: null }) } }, 's2');
  await m.run('completeStop()');
  eq('tour terminé : la boîte prévient que « la passe terminée sera rouverte »', m.appels.confirmations[0][1], '220 rue du Moulin redeviendra à faire. La passe terminée sera rouverte.');
  eq('… appel avec MA passe terminée', m.rpcs('annuler_arret').map((r) => r.args), [{ p_passe_id: 'p-luc', p_stop_id: 's2' }]);
  eq('… message « la passe est rouverte » ; le tour est de nouveau EN COURS (1/2) ; le bandeau montre ma passe', [m.dernierToast(), m.run('tours[0].en_cours'), m.el('passe-bandeau').innerHTML.includes('50 %'), m.el('passe-bandeau').innerHTML.includes('btn-terminer')], ['↩ Arrêt annulé : la passe est rouverte', true, true, true]);
  eq('… et la réouverture ne fait apparaître AUCUN résumé de fin', m.resumeOuvert(), false);

  // Refus et erreurs : le serveur a le dernier mot
  for (const [code, texte] of [['delai_depasse', 'Trop tard pour annuler (plus de 10 minutes).'], ['impossible_de_rouvrir', 'Impossible : une nouvelle passe est déjà commencée.'],
    ['passe_terminee', 'Cette passe a été terminée : impossible d’annuler un arrêt.'], ['non_autorise', 'Seul le chauffeur de la passe peut faire ça.'], ['n\'importe quoi', 'Pas de réseau ou erreur. Réessaie.']]) {
    const x = await ouvrir({ tours: [tourEC()], rpc: { annuler_arret: () => ({ data: null, error: { message: code } }), tours_en_cours: (a, d) => ({ data: d.tours, error: null }) } });
    const avant = x.rpcs('tours_en_cours').length;
    await x.run('completeStop()');
    eq(`refus « ${code} » : message en français, arrêt toujours fait, tours relus`, [x.dernierToast(), x.run(`estFait(stops[${idx('s1')}])`), x.rpcs('tours_en_cours').length - avant], ['❌ ' + texte, true, 1]);
  }
  m = await ouvrir({ tours: [tourEC()], rpc: { annuler_arret: () => new Error('Failed to fetch') } });
  await m.run('completeStop()');
  eq('réseau coupé : message, arrêt toujours fait, aucun plantage', [m.dernierToast(), m.run(`estFait(stops[${idx('s1')}])`)], ['❌ Pas de réseau ou erreur. Réessaie.', true]);
  m = await ouvrir({ tours: [tourEC()], rpc: { annuler_arret: () => ({ data: { statut: 'pas_complete' }, error: null }) } });
  await m.run('completeStop()');
  eq('« pas complété » (annulé ailleurs entre-temps) : message adapté', m.dernierToast(), 'Cet arrêt n’était pas complété.');
  m = await ouvrir({ tours: [tourEC()], confirme: [true] });
  await Promise.all([m.run('completeStop()'), m.run('completeStop()'), m.run('completeStop()')]);
  eq('trois touchers sur « Annuler » : UNE seule question, UN seul appel', [m.appels.confirmations.length, m.rpcs('annuler_arret').length], [1, 1]);
}

log('\n=== LE RÉSUMÉ DE FIN DE PASSE ===');
{
  const fermeCote = (o = {}) => async (m, ligneServeur, tourApres) => {   // le serveur ferme MA passe : les tours changent, la ligne « passes » aussi
    m.donnees.tours = tourApres ? [tourApres] : [];
    m.donnees.passes = [ligneServeur];
    m.run('planifierRechargementTours()');
    await attendre(500);
  };
  const ferme = fermeCote();
  const details = (m) => m.el('resume-details').innerHTML;

  let m = await monde({ tours: [tourEC({ faits: 2, pourcentage: 99 })] }).charge();
  eq('avant : aucun résumé', m.resumeOuvert(), false);
  await ferme(m, ligne(), tourFini());
  eq('MA passe se ferme à 100 % : la carte de résumé s\'ouvre', m.resumeOuvert(), true);
  eq('titre « Passe complétée : 100 % » et le pourcentage en très gros', [m.el('resume-titre').textContent, m.el('resume-pct').textContent], ['🎉 Passe complétée : 100 %', '100 %']);
  vrai('… la passe, la route, la tâche, les arrêts, la durée et le camion', details(m).includes('Passe n° 1 · Charette') && details(m).includes(MEC + ' · 2/2 arrêts') && details(m).includes('Durée : 2 h 14 · 🚜 Camion 1'), details(m));
  vrai('… la note « Annuler pendant 10 minutes » et « les arrêts faits restent verts »', details(m).includes('« Annuler » est offert pendant 10 minutes') && details(m).includes('restent verts sur la carte jusqu’à la prochaine passe'), details(m));
  eq('… la carte est lue dans MA passe (identifiant précis)', m.appels.eq.some((e) => e[0] === 'passes' && e[1] === 'id' && e[2] === 'p-luc'), true);
  eq('et derrière, la route reste verte', m.couleurs().slice(0, 2), ['#4ade80', '#4ade80']);
  m.run('fermerResume()');
  eq('« OK » ferme la carte et mémorise qu\'elle a été lue', [m.resumeOuvert(), m.memo.lp_resume_vu.startsWith('p-luc|')], [false, true]);
  await ferme(m, ligne(), tourFini());
  eq('un nouveau dessin sans changement ne rouvre pas le résumé', m.resumeOuvert(), false);

  // Les autres raisons
  for (const [type, titre, note] of [['delai_max', '⏱ Passe fermée automatiquement', 'la fin est estimée'], ['manuelle', '■ Passe terminée', null], ['admin', '■ Passe terminée par l’administrateur', null],
    ['fin_quart', '■ Passe fermée avec ton quart', null], ['remplacee', '■ Passe remplacée par une nouvelle passe', null]]) {
    const x = await monde({ tours: [tourEC()] }).charge();
    await ferme(x, ligne({ fin_type: type, nb_arrets_faits: 1, pourcentage: 50, fin_estimee: type === 'delai_max' }), tourFini({ fin_type: type, faits: 1, pourcentage: 50, arrets_faits: ['s1'], mes_passes_annulables: [] }));
    eq(`raison « ${type} » : « ${titre} »`, [x.resumeOuvert(), x.el('resume-titre').textContent, x.el('resume-pct').textContent], [true, titre, '50 %']);
    if (note) vrai('… avec la note sur la fin estimée', details(x).includes(note), details(x));
    vrai('… sans la note « Annuler » (seule une passe complétée se rouvre)', !details(x).includes('« Annuler »'), details(x));
  }

  // Fermée par l'autre camion (le tour est complété par lui)
  m = await monde({ tours: [tourEC({ passes: [{ passe_id: 'p-luc', equipe_id: 'e1', chauffeur_id: 'u-luc', je_suis_chauffeur: true, je_suis_a_bord: true }, { passe_id: 'p-marc', equipe_id: 'e2', chauffeur_id: 'u-marc', je_suis_chauffeur: false, je_suis_a_bord: false }] })] }).charge();
  await ferme(m, ligne(), tourFini());
  eq('le tour est complété par l\'AUTRE camion : mon résumé apparaît aussi (100 %)', [m.resumeOuvert(), m.el('resume-pct').textContent], [true, '100 %']);

  // La lecture de la passe échoue : on montre ce qu'on savait
  m = await monde({ tours: [tourEC()], lectureLance: ['passes'] }).charge();
  m.donnees.tours = []; m.run('planifierRechargementTours()'); await attendre(500);
  eq('réseau coupé pendant la lecture de la passe : résumé de secours avec ce que l\'on savait (1/2, 50 %), sans plantage', [m.resumeOuvert(), m.el('resume-titre').textContent, m.el('resume-pct').textContent, details(m).includes('1/2 arrêts')], [true, '■ Passe terminée', '50 %', true]);

  // Pas de résumé
  m = await monde({ tours: [tourEC()], confirme: [true], rpc: { terminer_passe: (a, d) => { d.tours = [tourFini({ faits: 1, pourcentage: 50, fin_type: 'manuelle', mes_passes_annulables: [] })]; d.passes = [ligne({ fin_type: 'manuelle' })]; return { data: { statut: 'terminee', pourcentage: 50, faits: 1, total: 2 }, error: null }; }, tours_en_cours: (a, d) => ({ data: d.tours, error: null }) } }).charge();
  await m.run('terminerPasse()'); await attendre(100);
  eq('quand JE la termine moi-même (« Terminer » + confirmation) : pas de résumé, seulement le message', [m.resumeOuvert(), m.dernierToast()], [false, '■ Passe n° 1 terminée : 1/2 (50 %)']);
  m = await monde({ tours: [tourEC()] }).charge();
  await ferme(m, ligne({ statut: 'en_cours', fin: null, fin_type: null }), tourEC({ faits: 0, pourcentage: 0, arrets_faits: [], faits_il_y_a: {} }));
  eq('rien ne change (la passe existe toujours) : pas de résumé', m.resumeOuvert(), false);
  m = await monde({ tours: [tourEC({ passes: [{ passe_id: 'p-marc', equipe_id: 'e2', chauffeur_id: 'u-marc', je_suis_chauffeur: false, je_suis_a_bord: true }] })] }).charge();
  await ferme(m, ligne({ id: 'p-marc', chauffeur_id: 'u-marc' }), tourFini({ mes_passes_annulables: [] }));
  eq('un PASSAGER (pas le chauffeur) ne reçoit pas de résumé', m.resumeOuvert(), false);
  m = await monde({ tours: [] }).charge(); m.donnees.tours = [tourFini()]; m.run('planifierRechargementTours()'); await attendre(500);
  eq('quelqu\'un qui n\'avait aucune passe : aucun résumé quand un tour se termine', m.resumeOuvert(), false);
  m = await monde({ tours: [tourEC()] }).charge();
  m.run('currentUser = null; renderAll()'); m.donnees.tours = []; m.run('currentUser = ' + JSON.stringify(LUC) + '; renderAll()'); await attendre(50);
  eq('déconnexion puis reconnexion : la passe « vue » est oubliée, pas de faux résumé', m.resumeOuvert(), false);

  // Textes piégés
  m = await monde({ tours: [tourEC()] }).charge();
  m.donnees.routes[0].nom = '<img src=x onerror=alert(1)>'; await m.run('loadRoutes()');
  await ferme(m, ligne({ tache: '<b>x</b>' }), tourFini());
  vrai('les noms venant de la base sont affichés comme du TEXTE', !details(m).includes('<img') && !details(m).includes('<b>x') && details(m).includes('&lt;img src=x onerror=alert(1)&gt;'), details(m));
}

log('\n=== AU DÉMARRAGE : le résumé d\'une passe terminée à l\'instant (rechargement de l\'application) ===');
{
  let m = await monde({ passes: [ligne({ fin: iso(5) })], tours: [tourFini({ fin: iso(5) })] }).charge();
  eq('ma dernière passe s\'est terminée il y a 5 min et je n\'ai pas lu son résumé : il s\'ouvre', [m.resumeOuvert(), m.el('resume-titre').textContent], [true, '🎉 Passe complétée : 100 %']);
  eq('… la lecture ne demande QUE mes passes (chauffeur = moi), la plus récente', m.appels.eq.some((e) => e[0] === 'passes' && e[1] === 'chauffeur_id' && e[2] === 'u-luc'), true);
  const lectures = () => m.appels.eq.filter((e) => e[0] === 'passes' && e[1] === 'chauffeur_id').length;
  await m.run('loadStops()'); await attendre(50);
  eq('UNE seule lecture par ouverture de l\'application : un nouveau chargement (arrêt modifié par un autre téléphone) ne relit rien tant que « OK » n\'est pas touché', lectures(), 1);
  m.run('fermerResume()');
  await m.run('loadStops()'); await attendre(50);
  eq('… et après « OK », un nouveau chargement ne le rouvre pas', [m.resumeOuvert(), lectures()], [false, 1]);

  m = await monde({ passes: [ligne({ fin: iso(30) })], tours: [tourFini({ fin: iso(30) })] }).charge();
  eq('terminée il y a 30 min : plus une nouvelle, pas de résumé', m.resumeOuvert(), false);
  const fin = iso(5);
  m = await monde({ passes: [ligne({ fin })], memo: { lp_resume_vu: 'p-luc|' + fin }, tours: [tourFini({ fin })] }).charge();
  eq('résumé déjà lu (« OK » touché) : pas remontré au rechargement', m.resumeOuvert(), false);
  m = await monde({ passes: [ligne({ statut: 'en_cours', fin: null, fin_type: null })], tours: [tourEC()] }).charge();
  eq('passe encore en cours : pas de résumé', m.resumeOuvert(), false);
  m = await monde({ passes: [], tours: [] }).charge();
  eq('aucune passe dans l\'historique : rien', m.resumeOuvert(), false);
  m = await monde({ passes: [ligne({ chauffeur_id: 'u-marc', fin: iso(2) })], tours: [] }).charge();
  eq('la passe d\'un AUTRE chauffeur n\'est jamais montrée', m.resumeOuvert(), false);
  m = await monde({ passes: [ligne({ fin: iso(2) })], lectureLance: ['passes'], tours: [] }).charge();
  eq('réseau coupé à la lecture : rien, aucun plantage, l\'application s\'ouvre normalement', [m.resumeOuvert(), m.run('stops.length')], [false, 4]);
  m = await monde({ passes: [ligne({ fin: iso(2) })], tours: [tourEC()] }).charge();
  eq('j\'ai une passe en cours : jamais de résumé au démarrage', m.resumeOuvert(), false);
}

log('\n=== LE CODE : la page et aucune écriture directe ===');
{
  const html = lire('index.html'), css = lire('css/style.css'), fichiers = fs.readdirSync(WWW + 'js').filter((f) => f.endsWith('.js'));
  const sansCommentaires = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  vrai('la page charge resume-passe.js après passe.js et avant demarrage.js', html.indexOf('js/passe.js') < html.indexOf('js/resume-passe.js') && html.indexOf('js/resume-passe.js') < html.lastIndexOf('js/demarrage.js'));
  vrai('la page a la carte de résumé (titre, pourcentage, détails, « OK »)', ['id="resume-overlay"', 'id="resume-titre"', 'id="resume-pct"', 'id="resume-details"', 'onclick="fermerResume()"'].every((x) => html.includes(x)));
  vrai('le pourcentage du résumé est en très gros et le bouton « Annuler » est orange', /#resume-pct\{[^}]*font-size:72px/.test(css) && /\.scb\.annulable\{/.test(css));
  vrai('« annuler_arret » n\'est appelé que par la fonction du serveur (aucune écriture directe dans passe_arrets)', !fichiers.some((f) => /from\(\s*['"](passes|passe_arrets)['"]\s*\)\s*\.\s*(insert|update|delete|upsert)/.test(sansCommentaires(lire('js/' + f)))));
  vrai('resume-passe.js ne lit que les colonnes de passes NOMMÉES (jamais « * »)', !/from\('passes'\)\s*\.select\('\*'\)/.test(lire('js/resume-passe.js')) && /COLONNES_PASSE=/.test(lire('js/resume-passe.js')));
  vrai('resume-passe.js : tout texte de la base passe par esc()', /esc\(p\?p\.tache:v\.tache\)/.test(lire('js/resume-passe.js')) && /esc\(nomRoute\(/.test(lire('js/resume-passe.js')));
}

tousLesMondes.forEach((w) => w.fin());
console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
