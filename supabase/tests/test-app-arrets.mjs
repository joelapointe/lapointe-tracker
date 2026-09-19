// Étape 13b — « fait » vient du TOUR en cours (www/js/tours.js), testé avec les VRAIS fichiers de l'application
// chargés dans un faux navigateur (faux document, fausse carte Leaflet) et un FAUX Supabase.
// Ce que ces tests ne peuvent pas vérifier : le vrai Supabase (fait par reel-etape-13.mjs) et l'affichage réel (essai dans le navigateur).
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

const MEC = 'Déneigement mécanique', SEL = 'Épandage de sel';
const CH = 'route-charette', SE = 'route-saint-etienne';

// ---------------------------------------------------------------------
// Un « monde » : faux navigateur + fausse carte + faux Supabase, avec les vrais fichiers de l'application dedans
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

  const donnees = {
    stops: o.stops ?? STOPS.map((s) => ({ ...s })),
    routes: o.routes ?? ROUTES.map((r) => ({ ...r })),
    problemes: o.problemes ?? [],
    tours: o.tours ?? TOURS(),
    positions: o.positions ?? [],
  };
  const appels = { rpc: [], eq: [], ecritures: [], statut: [], erreurs: [], toasts: [], ouverts: [], confirmations: [], lectures: [], selects: [], orders: [] };
  const reponsesRpc = o.rpc ?? {};
  const reponsesEcriture = o.ecritures ?? {};

  const fauxDb = {
    rpc: async (nom, args) => {
      appels.rpc.push({ nom, args });
      if (o.reseauCoupe && nom === 'tours_en_cours') throw new Error('Failed to fetch');
      if (reponsesRpc[nom]) return typeof reponsesRpc[nom] === 'function' ? reponsesRpc[nom](args, donnees) : reponsesRpc[nom];
      if (nom === 'tours_en_cours') return { data: donnees.tours, error: null };
      return { data: null, error: { message: 'inconnu' } };
    },
    from: (table) => {
      const q = { op: 'select', valeur: null };
      q.select = (c) => { if (q.op === 'select') appels.selects.push([table, c]); return q; };
      q.eq = (c, v) => { appels.eq.push([table, c, v]); q.filtres = [...(q.filtres ?? []), [c, v]]; return q; };
      q.order = (c, opt) => { appels.orders.push([table, c, opt]); return q; };
      q.delete = () => { q.op = 'delete'; return q; };
      q.update = (v) => { q.op = 'update'; q.valeur = v; return q; };
      q.insert = (v) => { q.op = 'insert'; q.valeur = v; return q; };
      q.then = (ok_, ko_) => {
        let res;
        if (q.op === 'select') {
          appels.lectures.push(table);
          if (o.lectureLance?.includes(table)) throw new Error('Failed to fetch');
          res = o.erreurLecture?.includes(table) ? { data: null, error: { message: 'boum' } } : { data: donnees[table] ?? [], error: null };
        } else {
          appels.ecritures.push({ table, op: q.op, valeur: q.valeur, filtres: q.filtres });
          const rep = reponsesEcriture[table + '.' + q.op];
          res = typeof rep === 'function' ? rep(q.valeur, donnees, q.filtres) : (rep ?? { data: null, error: null });
        }
        return Promise.resolve(res).then(ok_, ko_);
      };
      return q;
    },
  };

  const marqueurs = [], polygones = [], retires = [];
  const sandbox = {
    document: { getElementById: el, createElement: () => creer(null) },
    localStorage: { getItem: (k) => (k === 'lp_zone' ? (o.zone ?? null) : null), setItem() {}, removeItem() {} },
    window: { open: (u) => appels.ouverts.push(u) },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    L: {
      divIcon: (opt) => opt,
      marker: (ll, opt) => { const m = { ll, opt, addTo() { return m; }, on(ev, f) { m.clic = f; } }; marqueurs.push(m); return m; },
      polygon: (pts, opt) => { const p = { pts, opt, addTo() { return p; } }; polygones.push(p); return p; },
    },
    __map: { removeLayer: (m) => retires.push(m), flyTo() {} },
    __fauxDb: fauxDb,
    setStatus: (t) => appels.statut.push(t),
    hideLoading() {},
    showErr: (m) => appels.erreurs.push(m),
    __confirmations: appels.confirmations,
    __reponseConfirmation: o.confirme ?? true,
  };
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/config.js', 'js/utilitaires.js', 'js/tours.js', 'js/arrets.js', 'js/routes.js', 'js/liste-arrets.js', 'js/placement.js', 'js/problemes.js', 'js/admin.js'])
    vm.runInContext(lire(f), ctx, { filename: f });
  vm.runInContext('db = __fauxDb; map = __map; currentUser = ' + JSON.stringify(o.utilisateur ?? { id: 'u-luc', nom: 'Luc', role: 'employe' }) + ';', ctx);
  // Les messages : on les note (toast) ; la boîte de confirmation est testée ailleurs : ici on note la question et on répond « oui » ou « non »
  vm.runInContext('toast = (m) => { __toasts.push(m); }; confirmer = async (...a) => { __confirmations.push(a); return __reponseConfirmation; };', Object.assign(ctx, { __toasts: appels.toasts }) && ctx);
  const w = {
    ctx, el, donnees, appels, marqueurs, polygones, retires,
    run: (code) => vm.runInContext(code, ctx),
    routeActive: (id) => vm.runInContext(`routeActive = ${JSON.stringify(id)};`, ctx),
    couleur: (m) => (m.opt.icon.html.match(/background:(#[0-9a-f]+)/) || [])[1],
    elementsListe: () => el('liste-body').children,
    dernierToast: () => appels.toasts[appels.toasts.length - 1],
    fin: () => vm.runInContext('clearInterval(_minuterieEnCours);_minuterieEnCours=null;', ctx),
  };
  tousLesMondes.push(w);
  return w;
}
const tousLesMondes = [];

const STOPS = [
  { id: 's1', adresse: '304 rue de l\'Église', client: 'TEST 1', route_id: CH, service: MEC, lat: 46.44, lon: -72.92, ordre: 0, actif: true },
  { id: 's2', adresse: '220 rue du Moulin', client: 'TEST 3', route_id: CH, service: MEC, lat: 46.443, lon: -72.922, ordre: 1, actif: true },
  { id: 's3', adresse: '50 rue Notre-Dame', client: 'TEST 5', route_id: CH, service: MEC, lat: 46.439, lon: -72.926, ordre: 2, actif: true },
  { id: 's4', adresse: '215 rue Bellerive', client: 'TEST 4', route_id: CH, service: SEL, lat: 46.444, lon: -72.919, ordre: 3, actif: true },
  { id: 's5', adresse: '110 rue des Gouverneurs', client: 'TEST 7', route_id: SE, service: MEC, lat: 46.445, lon: -72.78, ordre: 4, actif: true, zone_points: [[46.4, -72.7], [46.5, -72.7], [46.5, -72.8]] },
  { id: 's6', adresse: '120 rue Jonette', client: 'TEST 9', route_id: SE, service: MEC, lat: 46.443, lon: -72.76, ordre: 5, actif: true },
];
const ROUTES = [{ id: CH, nom: 'Charette', couleur: '#c8e63c' }, { id: SE, nom: 'Saint-étienne-des-grès', couleur: '#60a5fa' }];
// Luc est chauffeur du tour de déneigement de Charette (avec Marc) ; Gaby est chauffeur du tour de sel
const TOURS = () => [
  { route_id: CH, tache: MEC, numero: 1, total: 3, faits: 1, pourcentage: 33, arrets_faits: ['s1'],
    passes: [{ passe_id: 'p-luc', equipe_id: 'e1', chauffeur_id: 'u-luc', je_suis_chauffeur: true, je_suis_a_bord: true },
             { passe_id: 'p-marc', equipe_id: 'e2', chauffeur_id: 'u-marc', je_suis_chauffeur: false, je_suis_a_bord: false }] },
  { route_id: CH, tache: SEL, numero: 2, total: 1, faits: 0, pourcentage: 0, arrets_faits: [],
    passes: [{ passe_id: 'p-gaby', equipe_id: 'e3', chauffeur_id: 'u-gaby', je_suis_chauffeur: false, je_suis_a_bord: false }] },
];
const idx = (id) => STOPS.findIndex((s) => s.id === id);

// =====================================================================
log('=== CHARGEMENT : les tours sont lus avec les arrêts ===');
{
  const m = monde();
  await m.run('loadStops()');
  eq('les tours en cours sont demandés au serveur (une fois)', m.appels.rpc.map((r) => r.nom), ['tours_en_cours']);
  vrai('seuls les arrêts ACTIFS sont lus (un arrêt archivé ne s\'affiche plus)', m.appels.eq.some((e) => e[0] === 'stops' && e[1] === 'actif' && e[2] === true), JSON.stringify(m.appels.eq));
  eq('6 marqueurs (toutes les routes ensemble)', m.marqueurs.length, 6);
  eq('l\'arrêt fait dans le tour est VERT et petit', [m.couleur(m.marqueurs[0]), m.marqueurs[0].opt.icon.iconSize], ['#4ade80', [14, 14]]);
  eq('un arrêt pas encore fait est JAUNE', m.couleur(m.marqueurs[1]), '#c8e63c');
  eq('un arrêt de la même route mais d\'une AUTRE tâche (sel) n\'est pas fait', m.couleur(m.marqueurs[3]), '#c8e63c');
  eq('un arrêt sans passe en cours n\'est pas fait', m.couleur(m.marqueurs[4]), '#c8e63c');
  eq('la zone (polygone) de l\'arrêt sans passe est jaune aussi', m.polygones.map((p) => p.opt.color), ['#c8e63c']);
  await m.run('renderAll()');
  eq('redessiner efface les anciennes zones (elles ne s\'empilent plus)', m.retires.filter((x) => x.pts).length, 1);
}

log('\n=== « FAIT » : PAR TOUR (même route ET même tâche) ===');
{
  const m = monde(); await m.run('loadStops()');
  const fait = (id) => m.run(`estFait(stops[${idx(id)}])`);
  eq('s1 (déneigement, Charette) : fait', fait('s1'), true);
  eq('s2, s3 (déneigement, Charette) : pas faits', [fait('s2'), fait('s3')], [false, false]);
  eq('s4 (sel, Charette) : pas fait (autre tour)', fait('s4'), false);
  eq('s5, s6 (Saint-étienne) : pas de tour en cours, pas faits', [fait('s5'), fait('s6')], [false, false]);
  eq('le tour d\'un arrêt : déneigement = tour n° 1, sel = tour n° 2, Saint-étienne = aucun',
    ['s1', 's4', 's5'].map((id) => m.run(`(tourDe(stops[${idx(id)}])||{}).numero`) ?? null).map((x) => x ?? null), [1, 2, null]);
  // Le même arrêt marqué fait par l'AUTRE camion du même tour : identique pour tout le monde (partagé)
  const autre = monde({ utilisateur: { id: 'u-marc', nom: 'Marc', role: 'employe' } }); await autre.run('loadStops()');
  eq('vu par le 2e camion du tour : s1 est fait aussi (mêmes informations)', autre.run(`estFait(stops[${idx('s1')}])`), true);
}

log('\n=== BARRE DE PROGRESSION : une route, ou toutes les routes ensemble ===');
{
  const m = monde(); await m.run('loadStops()');
  const barre = () => [m.el('prog-txt').textContent, m.el('prog-pct').textContent, m.el('prog-fill').style.width];
  eq('toutes les routes : 1 fait sur les 4 arrêts qui ont une passe en cours = 25 %', barre(), ['1/4', '25%', '25%']);
  m.routeActive(CH); await m.run('renderAll()');
  eq('route Charette seule : 1/4, 25 % (les deux tours de la route)', barre(), ['1/4', '25%', '25%']);
  m.routeActive(SE); await m.run('renderAll()');
  eq('route Saint-étienne seule : aucune passe en cours', barre(), ['Aucune passe', '—', '0%']);
  m.routeActive(null);
  const p = m.run('progression()');
  eq('progression() toutes routes', [p.total, p.faits, p.pct, p.aucune], [4, 1, 25, false]);
}

log('\n=== LISTE DES ARRÊTS ===');
{
  const m = monde(); await m.run('loadStops()');
  m.routeActive(CH); await m.run('renderListe()');
  eq('route Charette : « 3 restants · 1 complété »', m.el('liste-sub').textContent, '3 restants · 1 complété');
  eq('4 lignes (seulement les arrêts de la route choisie)', m.elementsListe().length, 4);
  vrai('les arrêts à faire d\'abord, le fait à la fin, avec le badge « ✔ FAIT »', m.elementsListe()[3].innerHTML.includes('✔ FAIT') && m.elementsListe()[3].innerHTML.includes('304 rue de l&#39;Église'), m.elementsListe()[3].innerHTML);
  vrai('… les autres sont « À FAIRE »', m.elementsListe().slice(0, 3).every((d) => d.innerHTML.includes('À FAIRE')));
  vrai('une route choisie : le nom de la route n\'est pas répété sur chaque ligne', !m.elementsListe()[0].innerHTML.includes('Charette'));
  m.routeActive(null); await m.run('renderListe()');
  eq('toutes les routes : 6 lignes', m.elementsListe().length, 6);
  vrai('… chaque ligne nomme sa route', m.elementsListe().every((d) => /Charette|Saint-étienne-des-grès/.test(d.innerHTML)));
  m.routeActive(SE); await m.run('renderListe()');
  eq('route sans passe en cours : le dit dans le sous-titre', m.el('liste-sub').textContent, '2 restants · 0 complété · aucune passe en cours');
}

log('\n=== LE BOUTON « COMPLÉTÉ » : qui peut, quand ===');
{
  const m = monde(); await m.run('loadStops()');
  const e = (id) => m.run(`etatComplete(stops[${idx(id)}])`);
  eq('chauffeur du tour, arrêt à faire : bouton actif, vers SA passe', [e('s2').actif, e('s2').passeId, e('s2').texte], [true, 'p-luc', '✔ Complété']);
  eq('arrêt déjà fait : « Déjà complété », inactif', [e('s1').actif, e('s1').texte], [false, '✔ Déjà complété']);
  eq('arrêt d\'un autre tour dont je ne suis pas chauffeur : inactif', [e('s4').actif, e('s4').texte], [false, 'Chauffeur seulement']);
  eq('arrêt sans passe en cours : inactif', [e('s5').actif, e('s5').texte], [false, 'Aucune passe']);
  const p = monde({ tours: TOURS().map((t) => ({ ...t, passes: t.passes.map((x) => ({ ...x, je_suis_chauffeur: false })) })) }); await p.run('loadStops()');
  eq('un passager : jamais actif', p.run(`etatComplete(stops[${idx('s2')}])`).actif, false);
  const a = monde({ utilisateur: { id: 'u-joe', nom: 'Joé', role: 'admin' }, tours: TOURS().map((t) => ({ ...t, passes: t.passes.map((x) => ({ ...x, je_suis_chauffeur: false })) })) }); await a.run('loadStops()');
  eq('l\'administrateur voit tout mais ne complète pas (ses corrections viendront à l\'étape 19)', a.run(`etatComplete(stops[${idx('s2')}])`).actif, false);

  m.run(`openCard(${idx('s2')})`);
  eq('fiche de s2 : texte du bouton, actif, ligne du tour', [m.el('btn-cmp').textContent, m.el('btn-cmp').disabled, m.el('sc-tour').textContent], ['✔ Complété', false, 'Passe n° 1 · 1/3 (33 %)']);
  vrai('… la fiche est ouverte', m.el('stop-card').classList.contains('open'));
  m.run(`openCard(${idx('s4')})`);
  eq('fiche de s4 : bouton grisé « Chauffeur seulement »', [m.el('btn-cmp').textContent, m.el('btn-cmp').disabled, m.el('btn-cmp').className], ['Chauffeur seulement', true, 'scb done2']);
  m.run(`openCard(${idx('s5')})`);
  eq('fiche de s5 : « Aucune passe en cours pour ce type de service »', m.el('sc-tour').textContent, 'Aucune passe en cours pour ce type de service');
}

log('\n=== COMPLÉTER UN ARRÊT (appelle la fonction du serveur) ===');
{
  const completer = (args, donnees) => {
    const t = donnees.tours.find((x) => x.passes.some((p) => p.passe_id === args.p_passe_id));
    if (!t.arrets_faits.includes(args.p_stop_id)) { t.arrets_faits.push(args.p_stop_id); t.faits++; t.pourcentage = Math.round(100 * t.faits / t.total); }
    return { data: { statut: 'complete', faits: t.faits, total: t.total, passe_fermee: false }, error: null };
  };
  const m = monde({ rpc: { completer_arret: completer } }); await m.run('loadStops()');
  m.run(`lastPos = [46.44, -72.92]`);
  m.run(`openCard(${idx('s2')})`); await m.run('completeStop()');
  const appel = m.appels.rpc.find((r) => r.nom === 'completer_arret');
  eq('la passe de SON camion, l\'arrêt, le mode manuel et la position du téléphone', appel.args, { p_passe_id: 'p-luc', p_stop_id: 's2', p_mode: 'manuel', p_lat: 46.44, p_lon: -72.92 });
  eq('les tours sont relus ensuite (une lecture au chargement + une après le geste)', m.appels.rpc.filter((r) => r.nom === 'tours_en_cours').length, 2);
  eq('l\'arrêt est maintenant fait (vert) et la barre passe à 2/4', [m.run(`estFait(stops[${idx('s2')}])`), m.couleur(m.marqueurs.slice(-6)[1]), m.el('prog-txt').textContent], [true, '#4ade80', '2/4']);
  eq('message de réussite ; la fiche se ferme', [m.dernierToast(), m.el('stop-card').classList.contains('open')], ['✔ Stop complété !', false]);
  eq('l\'ancienne écriture dans stops.fait n\'existe plus (aucune écriture directe dans les arrêts)', m.appels.ecritures.filter((x) => x.table === 'stops').length, 0);

  m.run(`openCard(${idx('s4')})`); const avant = m.appels.rpc.length; await m.run('completeStop()');
  eq('bouton grisé (pas le chauffeur) : AUCUN appel au serveur, un message clair', [m.appels.rpc.length, m.dernierToast()], [avant, 'Seul le chauffeur de la passe peut compléter un arrêt.']);

  // Réponses particulières du serveur
  const m2 = monde({ rpc: { completer_arret: { data: { statut: 'deja_complete' }, error: null } } }); await m2.run('loadStops()');
  m2.run(`openCard(${idx('s2')})`); await m2.run('completeStop()');
  eq('l\'autre camion l\'avait déjà fait : message adapté', m2.dernierToast(), '✔ Déjà complété par un autre camion');
  const m3 = monde({ rpc: { completer_arret: { data: { statut: 'complete', passe_fermee: true }, error: null } } }); await m3.run('loadStops()');
  m3.run(`openCard(${idx('s2')})`); await m3.run('completeStop()');
  eq('dernier arrêt du tour : « Passe terminée : 100 % ! »', m3.dernierToast(), '🎉 Passe terminée : 100 % !');
  const m4 = monde({ rpc: { completer_arret: { data: { statut: 'passe_terminee' }, error: null } } }); await m4.run('loadStops()');
  m4.run(`openCard(${idx('s2')})`); await m4.run('completeStop()');
  eq('passe déjà terminée : le dit, la fiche reste ouverte', [m4.dernierToast(), m4.el('stop-card').classList.contains('open')], ['⚠ Cette passe est déjà terminée', true]);
  for (const [code, texte] of [['non_autorise', 'Seul le chauffeur de la passe peut faire ça.'], ['arret_hors_tache', 'Cet arrêt n’a pas le même type de service que la passe.'], ['arret_hors_route', 'Cet arrêt n’est pas sur la route de la passe.'], ['passe_introuvable', 'Cette passe n’existe plus.'], ['n\'importe quoi', 'Pas de réseau ou erreur. Réessaie.']]) {
    const e = monde({ rpc: { completer_arret: { data: null, error: { message: code } } } }); await e.run('loadStops()');
    e.run(`openCard(${idx('s2')})`); await e.run('completeStop()');
    eq(`refus « ${code} » : message en français, arrêt toujours pas fait`, [e.dernierToast(), e.run(`estFait(stops[${idx('s2')}])`)], ['❌ ' + texte, false]);
  }
  vrai('aucun message ne montre un code technique', ['non_autorise', 'arret_hors_tache'].every((c) => !monde().run(`messageErreurGeste({message:${JSON.stringify(c)}})`).includes('_')));
}

log('\n=== TEMPS RÉEL ET RÉSEAU COUPÉ ===');
{
  const m = monde(); await m.run('loadStops()');
  const avant = m.appels.rpc.length;
  for (let i = 0; i < 5; i++) m.run('planifierRechargementTours()');
  await attendre(120); eq('5 changements d\'un coup : pas encore relu (on patiente un instant)', m.appels.rpc.length, avant);
  await attendre(400); eq('… puis relu UNE seule fois', m.appels.rpc.length, avant + 1);
  m.donnees.tours[0].arrets_faits.push('s2'); m.donnees.tours[0].faits = 2;
  m.run('planifierRechargementTours()'); await attendre(450);
  eq('un arrêt complété par l\'autre camion apparaît sans rien toucher (vert, 2/4)', [m.run(`estFait(stops[${idx('s2')}])`), m.couleur(m.marqueurs.slice(-6)[1]), m.el('prog-txt').textContent], [true, '#4ade80', '2/4']);

  m.run(`openCard(${idx('s2')})`);
  eq('fiche ouverte sur s2 déjà fait : « Déjà complété »', m.el('btn-cmp').textContent, '✔ Déjà complété');
  m.donnees.tours[0].arrets_faits = ['s1']; m.donnees.tours[0].faits = 1;
  m.run('planifierRechargementTours()'); await attendre(450);
  eq('une annulation par l\'autre camion remet la fiche ouverte à jour (bouton « Complété » redevenu actif)', [m.el('btn-cmp').textContent, m.el('btn-cmp').disabled], ['✔ Complété', false]);

  const deconnecte = monde(); await deconnecte.run('loadStops()');
  deconnecte.run('currentUser = null'); const n0 = deconnecte.appels.rpc.length;
  deconnecte.run('planifierRechargementTours()'); await attendre(450);
  eq('personne de connecté : aucune lecture', deconnecte.appels.rpc.length, n0);

  const hors = monde(); await hors.run('loadStops()');
  hors.run(`db = { rpc: async () => { throw new Error('Failed to fetch'); }, from: __fauxDb.from };`);
  const reussi = await hors.run('chargerTours()');
  eq('réseau coupé : la lecture échoue SANS effacer ce qu\'on savait (le 1er arrêt reste fait)', [reussi, hors.run(`estFait(stops[${idx('s1')}])`), hors.run('tours.length')], [false, true, 2]);
  hors.run(`db = { rpc: async () => ({ data: null, error: { message: 'boum' } }), from: __fauxDb.from };`);
  eq('erreur du serveur : idem', [await hors.run('chargerTours()'), hors.run('tours.length')], [false, 2]);
  hors.run(`db = { rpc: async () => ({ data: [], error: null }), from: __fauxDb.from };`);
  eq('le serveur répond « aucun tour » : tout redevient à faire', [await hors.run('chargerTours()'), hors.run(`estFait(stops[${idx('s1')}])`), hors.run('progression().aucune')], [true, false, true]);
}

log('\n=== SUPPRIMER UN ARRÊT : jamais de perte d\'historique ===');
{
  let m = monde(); await m.run('loadStops()'); m.run(`openCard(${idx('s6')})`);
  await m.run('deleteStop()');
  eq('boîte de l\'application (pas la fenêtre native), avec l\'adresse', m.appels.confirmations, [['Supprimer cet arrêt ?', '120 rue Jonette', 'Supprimer', 'Annuler']]);
  eq('sans historique : supprimé, retiré de l\'écran', [m.appels.ecritures.map((x) => x.op), m.run('stops.length'), m.dernierToast()], [['delete'], 5, '🗑 Supprimé']);

  m = monde({ ecritures: { 'stops.delete': { data: null, error: { code: '23503', message: 'violates foreign key' } } } }); await m.run('loadStops()'); m.run(`openCard(${idx('s6')})`);
  await m.run('deleteStop()');
  eq('avec de l\'historique (la base refuse) : ARCHIVÉ (actif = false), retiré de l\'écran', [m.appels.ecritures.map((x) => [x.op, x.valeur]), m.run('stops.length'), m.dernierToast()], [[['delete', null], ['update', { actif: false }]], 5, '📦 Archivé (il a un historique)']);

  m = monde({ ecritures: { 'stops.delete': { data: null, error: { message: 'x' } }, 'stops.update': { data: null, error: { message: 'y' } } } }); await m.run('loadStops()'); m.run(`openCard(${idx('s6')})`);
  await m.run('deleteStop()');
  eq('tout refusé (ex. pas administrateur) : l\'arrêt RESTE affiché, message d\'erreur (plus de mensonge à l\'écran)', [m.run('stops.length'), m.dernierToast()], [6, '❌ Impossible de supprimer cet arrêt']);

  m = monde({ confirme: false }); await m.run('loadStops()'); m.run(`openCard(${idx('s6')})`);
  await m.run('deleteStop()');
  eq('réponse « Annuler » : rien n\'est écrit, rien ne bouge', [m.appels.ecritures.length, m.run('stops.length')], [0, 6]);

  m = monde(); await m.run('loadStops()'); m.run(`openCard(${idx('s6')})`);
  const pendant = m.run('deleteStop()');
  m.run(`stops = stops.slice().reverse()`);   // la liste est relue (temps réel) pendant que la boîte est ouverte : l'ordre change
  await pendant;
  eq('la liste a changé pendant la confirmation : c\'est bien l\'arrêt choisi qui disparaît (par identifiant)', m.run('stops.map(s => s.id).sort()'), ['s1', 's2', 's3', 's4', 's5']);
}

log('\n=== ROUTES : plus de « Nouvelle passe » destructrice ; suppression avec la boîte de l\'application ===');
{
  let m = monde(); await m.run('loadStops()');
  await m.run('renderRoutes()');
  const lignes = m.el('routes-body').children;
  vrai('la route Charette annonce « 2 passes en cours » (déneigement + sel)', lignes[1].innerHTML.includes('4 stops · 2 passes en cours'), lignes[1].innerHTML);
  vrai('la route Saint-étienne n\'annonce rien de plus', lignes[2].innerHTML.includes('2 stops</div>') && !lignes[2].innerHTML.includes('passe'), lignes[2].innerHTML);
  eq('la fonction qui remettait tout à zéro n\'existe plus', m.run('typeof nouvellePasse'), 'undefined');

  m = monde({ utilisateur: { id: 'u-joe', nom: 'Joé', role: 'admin' } }); await m.run('loadStops()');
  await m.run(`supprimerRoute({stopPropagation(){}}, '${SE}')`);
  eq('boîte de l\'application avec le nom de la route', m.appels.confirmations, [['Supprimer cette route ?', 'Saint-étienne-des-grès', 'Supprimer', 'Annuler']]);
  eq('route supprimée : retirée de la liste', [m.run('routes.length'), m.dernierToast()], [1, '🗑 Route supprimée']);
  m = monde({ ecritures: { 'routes.delete': { data: null, error: { message: 'fk' } } } }); await m.run('loadStops()');
  await m.run(`supprimerRoute({stopPropagation(){}}, '${SE}')`);
  eq('la base refuse (arrêts ou historique) : la route reste, message clair', [m.run('routes.length'), m.dernierToast()], [2, '❌ Impossible : cette route a des arrêts ou un historique']);
  m = monde({ confirme: false }); await m.run('loadStops()');
  await m.run(`supprimerRoute({stopPropagation(){}}, '${SE}')`);
  eq('« Annuler » : rien n\'est supprimé', [m.appels.ecritures.length, m.run('routes.length')], [0, 2]);
}

log('\n=== NAVIGUER VERS UN ARRÊT : choix Google Maps / Waze avec la boîte de l\'application ===');
{
  let m = monde({ confirme: true }); await m.run('loadStops()'); m.run(`openCard(${idx('s2')})`);
  await m.run('naviguerVersStop()');
  vrai('« Google Maps » : ouvre Google Maps vers l\'arrêt', m.appels.ouverts.length === 1 && m.appels.ouverts[0].startsWith('https://www.google.com/maps/dir/?api=1&destination=46.443,-72.922'), JSON.stringify(m.appels.ouverts));
  m = monde({ confirme: false }); await m.run('loadStops()'); m.run(`openCard(${idx('s2')})`);
  await m.run('naviguerVersStop()');
  vrai('« Waze » : ouvre Waze', m.appels.ouverts.length === 1 && m.appels.ouverts[0].startsWith('https://waze.com/ul?ll=46.443,-72.922'), JSON.stringify(m.appels.ouverts));
  eq('la boîte propose bien Google Maps / Waze, avec l\'adresse', m.appels.confirmations, [['Naviguer avec…', '220 rue du Moulin', 'Google Maps', 'Waze']]);
}


log('\n=== CLIENT « EN COURS » : un camion de son tour est sur place (étape 13c) ===');
{
  const pos = (passe, lat, lon, o = {}) => ({ passe_id: passe, lat, lon, precision_m: o.precision === undefined ? 8 : o.precision, maj_le: o.majLe ?? new Date(Date.now() - (o.ageMin ?? 0.5) * 60000).toISOString() });
  const S2 = { lat: 46.443, lon: -72.922 }, S1 = { lat: 46.44, lon: -72.92 }, S4 = { lat: 46.444, lon: -72.919 };
  const cas = async (positions, opts = {}) => { const m = monde({ positions, ...opts }); await m.run('loadStops()'); return m; };
  const enCours = (m, id) => m.run(`estEnCours(stops[${idx(id)}])`);
  const couleurDe = (m, id) => m.couleur(m.marqueurs.slice(-6)[idx(id)]);
  const avecZones = STOPS.map((s) => ({ ...s, ...(s.id === 's2' ? { zone_points: [[46.44, -72.92], [46.45, -72.92], [46.45, -72.93]] } : {}), ...(s.id === 's1' ? { zone_points: [[46.43, -72.91], [46.44, -72.91], [46.44, -72.92]] } : {}) }));

  const cfg = fs.readFileSync(WWW + 'js/config.js', 'utf8');
  eq('les réglages décidés par Joé : 20 m, 3 minutes, 30 m de précision, relecture de secours toutes les 15 s',
    ['RAYON_EN_COURS_M', 'POSITION_PERIMEE_MIN', 'PRECISION_MAX_M', 'RELECTURE_POSITIONS_S'].map((k) => Number(cfg.match(new RegExp(k + '=(\\d+)'))[1])), [20, 3, 30, 15]);
  const m0 = monde(); await m0.run('loadStops()');
  vrai('distance : 0,00017° de latitude ≈ 18,9 m', Math.abs(m0.run('distanceMetres(46.443,-72.922,46.44317,-72.922)') - 18.9) < 0.5, m0.run('distanceMetres(46.443,-72.922,46.44317,-72.922)'));

  // — Le cas de base : le camion de Luc est chez s2 —
  let m = await cas([pos('p-luc', S2.lat, S2.lon)]);
  eq('le camion de Luc est chez s2 : s2 est « en cours » (marqueur BLEU), pas les autres', [enCours(m, 's2'), couleurDe(m, 's2'), enCours(m, 's3'), couleurDe(m, 's3')], [true, '#60a5fa', false, '#c8e63c']);
  eq('… la fiche le dit', (m.run(`openCard(${idx('s2')})`), m.el('sc-tour').textContent), 'Passe n° 1 · 1/3 (33 %) · 🚜 camion sur place');
  eq('… et la fiche d\'un autre arrêt ne le dit pas', (m.run(`openCard(${idx('s3')})`), m.el('sc-tour').textContent), 'Passe n° 1 · 1/3 (33 %)');
  eq('arriver chez un client ne le complète PAS : aucune écriture, bouton « Complété » toujours à toucher', [m.appels.rpc.filter((r) => r.nom !== 'tours_en_cours').length, m.appels.ecritures.length, m.run(`etatComplete(stops[${idx('s2')}])`).actif], [0, 0, true]);

  // — Le rayon : 20 m —
  m = await cas([pos('p-luc', S2.lat + 0.00017, S2.lon)]);
  eq('à 18,9 m : en cours', enCours(m, 's2'), true);
  m = await cas([pos('p-luc', S2.lat + 0.00023, S2.lon)]);
  eq('à 25,6 m : pas en cours', enCours(m, 's2'), false);

  // — Le bon tour : même route ET même tâche, n'importe lequel des camions du tour —
  m = await cas([pos('p-marc', S2.lat, S2.lon)]);
  eq('l\'AUTRE camion du même tour (Marc) sur place : s2 est en cours (tour partagé)', enCours(m, 's2'), true);
  m = await cas([pos('p-gaby', S2.lat, S2.lon)]);
  eq('un camion d\'une autre tâche (sel) chez s2 (déneigement) : PAS en cours', enCours(m, 's2'), false);
  m = await cas([pos('p-gaby', S4.lat, S4.lon)]);
  eq('… mais chez un arrêt de SA tâche (s4, sel) : en cours', [enCours(m, 's4'), couleurDe(m, 's4')], [true, '#60a5fa']);
  m = await cas([pos('p-inconnu', S2.lat, S2.lon)]);
  eq('une position dont la passe n\'est plus en cours : ignorée', enCours(m, 's2'), false);
  m = await cas([pos('p-luc', 46.445, -72.78)]);   // chez s5 (route Saint-étienne, aucun tour en cours)
  eq('un arrêt sans tour en cours n\'est jamais « en cours »', enCours(m, 's5'), false);

  // — Un arrêt déjà fait n'est pas « en cours » —
  m = await cas([pos('p-luc', S1.lat, S1.lon)]);
  eq('le camion repasse chez un client déjà fait : reste VERT', [enCours(m, 's1'), couleurDe(m, 's1')], [false, '#4ade80']);

  // — Position récente et précise —
  for (const [nom, o, attendu] of [['vieille de 2 minutes', { ageMin: 2 }, true], ['vieille de 4 minutes', { ageMin: 4 }, false], ['à la date illisible', { majLe: 'nope' }, false],
    ['précise à 25 m', { precision: 25 }, true], ['précise à 45 m (trop imprécise)', { precision: 45 }, false], ['de précision inconnue', { precision: null }, true]]) {
    m = await cas([pos('p-luc', S2.lat, S2.lon, o)]);
    eq(`position ${nom} : ${attendu ? 'compte' : 'ne compte pas'}`, enCours(m, 's2'), attendu);
  }

  // — Priorité des couleurs —
  eq('règle unique : problème > en cours > fait > à faire',
    [[false, true, true], [false, false, true], [true, false, false], [false, false, false], [true, true, false]].map(([f, p, e]) => m.run(`couleurEtat(${f},${p},${e})`)),
    ['#fb923c', '#60a5fa', '#4ade80', '#c8e63c', '#fb923c']);
  m = await cas([pos('p-luc', S2.lat, S2.lon)], { problemes: [{ id: 'pb', stop_id: 's2', note: 'x', lu: false }] });
  eq('un problème signalé chez s2 reste ORANGE même quand le camion est là', couleurDe(m, 's2'), '#fb923c');

  // — Les zones (polygones) suivent la même règle —
  const zoneDe = (mm, id) => mm.polygones.slice(-3).find((p) => JSON.stringify(p.pts) === JSON.stringify(avecZones[idx(id)].zone_points))?.opt.color;   // 3 zones dessinées : s1, s2 et s5
  m = await cas([pos('p-luc', S2.lat, S2.lon)], { stops: avecZones });
  eq('zone de s2 (camion sur place) BLEUE ; zone de s1 (fait) VERTE ; zone de s5 (sans passe) jaune', [zoneDe(m, 's2'), zoneDe(m, 's1'), zoneDe(m, 's5')], ['#60a5fa', '#4ade80', '#c8e63c']);
  eq('… le marqueur de s2 a la même couleur que sa zone (jamais de contradiction)', couleurDe(m, 's2'), zoneDe(m, 's2'));
  m = await cas([], { stops: avecZones });
  eq('sans camion : zone de s2 jaune, zone de s1 verte', [zoneDe(m, 's2'), zoneDe(m, 's1')], ['#c8e63c', '#4ade80']);

  // — Temps réel, relecture de secours, expiration —
  m = await cas([]);
  const lect = () => m.appels.lectures.filter((t) => t === 'positions').length, tr = () => m.appels.rpc.filter((r) => r.nom === 'tours_en_cours').length;
  const l0 = lect(), t0 = tr();
  m.donnees.positions = [pos('p-luc', S2.lat, S2.lon)];
  for (let i = 0; i < 5; i++) m.run('planifierRechargementPositions()');
  await attendre(200); eq('5 changements de position d\'un coup : pas encore relu', lect(), l0);
  await attendre(600);
  eq('… puis relu UNE seule fois, sans relire les tours', [lect() - l0, tr() - t0], [1, 0]);
  eq('… et le client devient bleu tout seul', [enCours(m, 's2'), couleurDe(m, 's2')], [true, '#60a5fa']);
  const n1 = m.marqueurs.length; await m.run('rafraichirEnCours()');
  eq('positions inchangées : la carte n\'est PAS redessinée (pas de scintillement)', m.marqueurs.length, n1);
  m.donnees.positions[0].maj_le = new Date(Date.now() - 4 * 60000).toISOString();
  await m.run('rafraichirEnCours()');
  eq('le camion n\'envoie plus depuis 4 minutes : la relecture de secours retire le bleu', [enCours(m, 's2'), couleurDe(m, 's2')], [false, '#c8e63c']);
  m.donnees.positions = [pos('p-luc', S2.lat, S2.lon)]; await m.run('rafraichirEnCours()');
  m.run('__fauxDbSauve = db; db = { rpc: __fauxDb.rpc, from: () => { throw new Error("Failed to fetch"); } }');
  eq('réseau coupé : la lecture échoue SANS effacer les dernières positions', [await m.run('chargerPositionsVehicules()'), enCours(m, 's2')], [false, true]);
  m.run('db = __fauxDbSauve; currentUser = null'); const l1 = lect();
  await m.run('rafraichirEnCours()');
  eq('personne de connecté : aucune lecture', lect(), l1);
  m.run('demarrerRelecturePositions(); const _premiere = _minuterieEnCours; demarrerRelecturePositions(); globalThis.__memeMinuterie = (_premiere === _minuterieEnCours);');
  eq('la relecture de secours ne démarre qu\'une fois', m.run('__memeMinuterie'), true);
}

log('\n=== LA ROUTE CHOISIE EST RETROUVÉE AU DÉMARRAGE (l\'étiquette et la carte disent la même chose) ===');
{
  let m = monde({ zone: 'Saint-étienne-des-grès' }); await m.run('loadStops()');
  eq('nom mémorisé « Saint-étienne-des-grès » : la route est retrouvée, la carte ne montre QUE ses arrêts', [m.run('routeActive'), m.run('zone'), m.marqueurs.length, m.el('zone-val').textContent], [SE, 'Saint-étienne-des-grès', 2, 'Saint-étienne-des-grès']);
  eq('… la barre du bas suit cette route (aucune passe dessus)', m.el('prog-txt').textContent, 'Aucune passe');
  m = monde({ zone: 'Route disparue' }); await m.run('loadStops()');
  eq('nom mémorisé d\'une route qui n\'existe plus : retour à « Toutes les routes »', [m.run('routeActive'), m.run('zone'), m.marqueurs.length, m.el('zone-val').textContent], [null, '', 6, 'Toutes les routes']);
  m = monde(); await m.run('loadStops()');
  eq('rien de mémorisé : toutes les routes', [m.run('routeActive'), m.marqueurs.length], [null, 6]);
  m = monde({ zone: 'Charette' }); m.routeActive(SE); await m.run('loadStops()');
  eq('une route déjà choisie pendant la session n\'est pas écrasée par le nom mémorisé', m.run('routeActive'), SE);
}

log('\n=== PROBLÈMES : plusieurs par arrêt, jamais effacés, rattachés à la passe (étape 13) ===');
{
  const il = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
  const pb = (id, stop, note, o = {}) => ({ id, stop_id: stop, passe_id: o.passe ?? null, utilisateur_id: o.auteur ?? 'u-autre', note, cree_le: o.cree ?? il(5), utilisateurs: o.nom === null ? null : { nom: o.nom ?? (o.auteur === 'u-luc' ? 'Luc' : 'Marc-Antoine') } });
  const lignes = [pb('pb1', 's2', 'barrière fermée', { cree: il(5) }), pb('pb2', 's2', 'chien méchant', { auteur: 'u-luc', cree: il(90) }), pb('pb3', 's3', '<img src=x onerror=alert(1)>')];
  const cas = async (o = {}) => { const m = monde(o); await m.run('loadStops()'); return m; };
  const couleurDe = (m, id) => m.couleur(m.marqueurs.slice(-6)[idx(id)]);
  const fiche = (m, id) => { m.run(`openCard(${idx(id)})`); return m.el('sc-prob').innerHTML; };

  // — Lecture et affichage —
  let m = await cas({ problemes: lignes });
  const lecture = m.appels.selects.find((x) => x[0] === 'problemes');
  eq('les problèmes sont lus avec des colonnes NOMMÉES (jamais « * »)', lecture[1], 'id, stop_id, passe_id, utilisateur_id, note, cree_le, utilisateurs!utilisateur_id(nom)');
  vrai('… seulement les non lus, du plus ancien au plus récent', m.appels.eq.some((e) => e[0] === 'problemes' && e[1] === 'lu' && e[2] === false) && m.appels.orders.some((o) => o[0] === 'problemes' && o[1] === 'cree_le'), JSON.stringify(m.appels.orders));
  eq('DEUX problèmes sur s2, un sur s3, aucun sur s1', [m.run(`problemesDe(stops[${idx('s2')}]).length`), m.run(`problemesDe(stops[${idx('s3')}]).length`), m.run(`problemesDe(stops[${idx('s1')}]).length`)], [2, 1, 0]);
  eq('marqueurs ORANGES pour s2 et s3 ; s1 (fait) reste vert', [couleurDe(m, 's2'), couleurDe(m, 's3'), couleurDe(m, 's1')], ['#fb923c', '#fb923c', '#4ade80']);
  let h = fiche(m, 's2');
  vrai('la fiche de s2 annonce « 2 problèmes signalés » et montre les deux notes', h.includes('2 problèmes signalés') && h.includes('barrière fermée') && h.includes('chien méchant'), h);
  vrai('… chaque ligne dit QUI et QUAND : « Marc-Antoine · il y a 5 min », et « vous · il y a 2 h » pour celui de Luc (la personne connectée)', h.includes('barrière fermée <span>· Marc-Antoine · il y a 5 min</span>') && h.includes('chien méchant <span>· vous · il y a 2 h</span>') && !h.includes('Luc'), h);
  h = fiche(m, 's3');
  vrai('une note piégée est affichée comme du TEXTE (aucun code exécuté)', h.includes('&lt;img src=x onerror=alert(1)&gt;') && !h.includes('<img'), h);
  eq('la fiche d\'un arrêt sans problème n\'affiche rien', fiche(m, 's1'), '');
  m = await cas({ problemes: [pb('x1', 's2', 'nom piégé', { nom: 'Marc <script>alert(1)</script>' }), pb('x2', 's2', 'auteur sans nom lisible', { nom: null, cree: il(3) })] });
  h = fiche(m, 's2');
  vrai('un nom piégé est affiché comme du TEXTE ; un auteur dont le nom n\'est pas lisible : seulement l\'heure (jamais « null »)', h.includes('Marc &lt;script&gt;alert(1)&lt;/script&gt; · il y a 5 min') && !h.includes('<script>') && h.includes('auteur sans nom lisible <span>· il y a 3 min</span>') && !h.includes('null'), h);
  m = await cas({ problemes: [1, 2, 3, 4].map((i) => pb('p' + i, 's2', 'note ' + i, { cree: il(50 - i) })) });
  h = fiche(m, 's2');
  vrai('4 problèmes : les 3 plus récents + « … et 1 autre »', h.includes('4 problèmes signalés') && h.includes('note 4') && h.includes('note 3') && h.includes('note 2') && !h.includes('note 1') && h.includes('… et 1 autre'), h);

  // — Signaler —
  const inserer = (valeur, donnees) => { donnees.problemes.push(...valeur.map((v, i) => ({ id: 'nouveau' + i, utilisateur_id: 'u-luc', cree_le: new Date().toISOString(), ...v }))); return { data: null, error: null }; };
  m = await cas({ ecritures: { 'problemes.insert': inserer } });
  m.run(`openCard(${idx('s2')})`); m.run('openProbleme()');
  eq('la boîte de signalement limite la note à 500 caractères', m.el('prob-note').attrs.maxlength, '500');
  m.el('prob-note').value = '  Entrée bloquée par la neige  ';
  await m.run('envoyerProbleme()');
  const ins = m.appels.ecritures.filter((x) => x.table === 'problemes');
  eq('UN seul envoi : la note nettoyée, l\'arrêt, la passe du camion de Luc — et RIEN d\'autre (ni « lu », ni nom : c\'est la base qui les met)', [ins.length, ins[0].op, ins[0].valeur], [1, 'insert', [{ stop_id: 's2', passe_id: 'p-luc', note: 'Entrée bloquée par la neige' }]]);
  eq('aucun problème n\'est jamais effacé (aucun « delete » sur les problèmes)', m.appels.ecritures.filter((x) => x.op === 'delete').length, 0);
  eq('après l\'envoi : relu, l\'arrêt devient ORANGE, message, boîte et fiche fermées', [couleurDe(m, 's2'), m.dernierToast(), m.el('prob-overlay').classList.contains('open'), m.el('stop-card').classList.contains('open')], ['#fb923c', '⚠ Problème signalé !', false, false]);
  m.run(`openCard(${idx('s2')})`); m.run('openProbleme()'); m.el('prob-note').value = 'Deuxième problème, même arrêt'; await m.run('envoyerProbleme()');
  eq('un 2e problème sur le MÊME arrêt s\'AJOUTE au premier (rien n\'est remplacé)', [m.run(`problemesDe(stops[${idx('s2')}]).length`), m.appels.ecritures.filter((x) => x.op === 'delete').length], [2, 0]);

  // — À quelle passe le rattacher —
  const passePour = (mm, id) => mm.run(`passePourSignalement(stops[${idx(id)}])`);
  m = await cas();
  eq('dans le tour de l\'arrêt (s2) : la passe de Luc', passePour(m, 's2'), 'p-luc');
  eq('chez un arrêt d\'un autre tour (s4, sel) : la passe où Luc se trouve quand même', passePour(m, 's4'), 'p-luc');
  const passager = monde({ tours: TOURS().map((t) => ({ ...t, passes: t.passes.map((x) => ({ ...x, je_suis_chauffeur: false, je_suis_a_bord: x.passe_id === 'p-marc' })) })) }); await passager.run('loadStops()');
  eq('un passager : la passe où il est à bord', passePour(passager, 's2'), 'p-marc');
  const hors = monde({ tours: TOURS().map((t) => ({ ...t, passes: t.passes.map((x) => ({ ...x, je_suis_chauffeur: false, je_suis_a_bord: false })) })) }); await hors.run('loadStops()');
  eq('quelqu\'un qui n\'est dans aucun camion : aucune passe (permis), le signalement part quand même', [passePour(hors, 's2'), hors.run('tours.length')], [null, 2]);

  // — Refus, notes vides, doubles touchers —
  m = await cas({ ecritures: { 'problemes.insert': { data: null, error: { message: 'permission denied for table problemes' } } } });
  m.run(`openCard(${idx('s2')})`); m.run('openProbleme()'); m.el('prob-note').value = 'ma note importante';
  const lectures0 = m.appels.lectures.filter((t) => t === 'problemes').length;
  await m.run('envoyerProbleme()');
  eq('refus du serveur : message clair, la boîte reste ouverte, la NOTE EST CONSERVÉE, rien n\'est relu', [m.dernierToast(), m.el('prob-overlay').classList.contains('open'), m.el('prob-note').value, m.appels.lectures.filter((t) => t === 'problemes').length - lectures0], ['❌ Problème non envoyé (pas de réseau ?). Réessaie.', true, 'ma note importante', 0]);
  m.el('prob-note').value = '   '; const n0 = m.appels.ecritures.length;
  await m.run('envoyerProbleme()');
  eq('une note vide n\'est pas envoyée', [m.dernierToast(), m.appels.ecritures.length - n0], ['⚠ Écris une note', 0]);
  m = await cas({ ecritures: { 'problemes.insert': async (v, d) => { await attendre(60); return inserer(v, d); } } });
  m.run(`openCard(${idx('s2')})`); m.run('openProbleme()'); m.el('prob-note').value = 'toucher deux fois';
  await Promise.all([m.run('envoyerProbleme()'), m.run('envoyerProbleme()')]);
  eq('toucher « Envoyer » deux fois de suite : UN seul problème créé', m.appels.ecritures.filter((x) => x.op === 'insert').length, 1);

  // — Temps réel, réseau coupé, pastille —
  m = await cas({ problemes: [pb('a', 's3', 'x')] });
  m.run(`openCard(${idx('s2')})`);
  const l0 = m.appels.lectures.filter((t) => t === 'problemes').length;
  m.donnees.problemes.push(pb('b', 's2', 'signalé sur un autre téléphone'));
  for (let i = 0; i < 5; i++) m.run('planifierRechargementProblemes()');
  await attendre(120); eq('5 changements d\'un coup : pas encore relu', m.appels.lectures.filter((t) => t === 'problemes').length, l0);
  await attendre(400);
  eq('… puis relu UNE seule fois ; s2 devient orange et sa fiche ouverte se met à jour', [m.appels.lectures.filter((t) => t === 'problemes').length - l0, couleurDe(m, 's2'), m.el('sc-prob').innerHTML.includes('signalé sur un autre téléphone')], [1, '#fb923c', true]);
  m.donnees.problemes = []; m.run('planifierRechargementProblemes()'); await attendre(450);
  eq('l\'administrateur marque tout « lu » : les marqueurs orange disparaissent', [couleurDe(m, 's2'), couleurDe(m, 's3')], ['#c8e63c', '#c8e63c']);
  m.donnees.problemes = [pb('c', 's2', 'encore')]; await m.run('chargerProblemes()');
  m.run('__dbOk = db; db = { rpc: __fauxDb.rpc, from: () => { throw new Error("Failed to fetch"); } }');
  eq('réseau coupé : la lecture échoue SANS effacer les problèmes connus', [await m.run('chargerProblemes()'), m.run('problemesNonLus.length')], [false, 1]);
  m.run('db = __fauxDb; currentUser = null'); const l1 = m.appels.lectures.filter((t) => t === 'problemes').length;
  m.run('planifierRechargementProblemes()'); await attendre(450);
  eq('personne de connecté : aucune lecture', m.appels.lectures.filter((t) => t === 'problemes').length, l1);
  m = await cas({ problemes: lignes });
  eq('pastille du bouton ADMIN : nombre de problèmes non lus (3)', m.el('bb-admin').children.map((c) => c.textContent), [3]);
  m.donnees.problemes = []; await m.run('chargerProblemes()'); m.run('checkProblemes()');
  eq('… et elle disparaît quand il n\'y en a plus', m.el('bb-admin').children.length, 0);
}

log('\n=== PANNEAU ADMINISTRATEUR : lit les nouvelles colonnes, ne ment jamais ===');
{
  const il = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
  const admin = { id: 'u-joe', nom: 'Joé', role: 'admin' };
  const lignes = [
    { id: 'pb1', stop_id: 's2', passe_id: 'p-luc', utilisateur_id: 'u-marc', note: 'barrière fermée', cree_le: il(5), stops: { adresse: '220 rue du Moulin', service: MEC, client: 'TEST 3' }, utilisateurs: { nom: 'Marc' }, passes: { numero: 3, tache: MEC } },
    { id: 'pb2', stop_id: 's3', passe_id: null, utilisateur_id: 'u-luc', note: '<b>gras</b> & "guillemets"', cree_le: il(200), stops: { adresse: '50 rue Notre-Dame', service: MEC, client: 'TEST 5' }, utilisateurs: { nom: 'Luc <script>' }, passes: null },
  ];
  const texte = (m) => m.el('admin-body').innerHTML + m.el('admin-body').children.map((c) => c.innerHTML).join('|');
  let m = monde({ utilisateur: admin, problemes: lignes }); await m.run('loadStops()'); await m.run('openAdmin()'); await attendre(30);
  const admSel = m.appels.selects.filter((x) => x[0] === 'problemes').pop();
  eq('la lecture du panneau nomme l\'AUTEUR (« utilisateurs!utilisateur_id », car lu_par pointe aussi vers utilisateurs), la passe et l\'arrêt', admSel[1], 'id, note, cree_le, stops(adresse,service,client), utilisateurs!utilisateur_id(nom), passes(numero,tache)');
  vrai('… triée par « cree_le » (l\'ancienne colonne « created_at » n\'existe plus), le plus récent d\'abord', m.appels.orders.some((o) => o[0] === 'problemes' && o[1] === 'cree_le' && o[2]?.ascending === false), JSON.stringify(m.appels.orders));
  let t = texte(m);
  vrai('le titre compte les problèmes', t.includes('⚠ Problèmes signalés (2)') || m.el('admin-body').children[0].textContent === '⚠ Problèmes signalés (2)', t.slice(0, 200));
  vrai('chaque problème : adresse, auteur, type de service, numéro de passe, note', t.includes('220 rue du Moulin') && t.includes('Marc') && t.includes('Déneigement mécanique') && t.includes('Passe n° 3') && t.includes('barrière fermée'), t);
  vrai('un problème sans passe : pas de « Passe n° »', !t.split('|')[2].includes('Passe n°'), t);
  vrai('texte piégé (note et nom) affiché comme du TEXTE', t.includes('&lt;b&gt;gras&lt;/b&gt; &amp; &quot;guillemets&quot;') && t.includes('Luc &lt;script&gt;') && !t.includes('<b>') && !t.includes('<script>'), t);
  vrai('un bouton « Marquer comme lu » par problème', m.el('admin-body').children.filter((c) => c.children.some((b) => b.textContent === '✔ Marquer comme lu')).length === 2);

  // — « Marquer comme lu » —
  m = monde({ utilisateur: admin, problemes: lignes, ecritures: { 'problemes.update': (v, d, f) => { const i = d.problemes.findIndex((p) => p.id === f[0][1]); const [p] = d.problemes.splice(i, 1); return { data: [{ id: p.id }], error: null }; } } });
  await m.run('loadStops()'); await m.run('openAdmin()'); await attendre(30);
  m.el('admin-body').children[1].children.find((b) => b.textContent === '✔ Marquer comme lu').onclick();
  await attendre(50);
  const maj = m.appels.ecritures.find((x) => x.table === 'problemes' && x.op === 'update');
  eq('« lu » enregistre QUI l\'a lu et QUAND (le problème n\'est pas effacé)', [maj.valeur.lu, maj.valeur.lu_par, typeof maj.valeur.lu_le, maj.filtres], [true, 'u-joe', 'string', [['id', 'pb1']]]);
  eq('… message, l\'arrêt n\'est plus orange, la liste est rafraîchie (1 problème restant)', [m.dernierToast(), m.marqueurs.slice(-6)[idx('s2')] && m.couleur(m.marqueurs.slice(-6)[idx('s2')]), m.el('admin-body').children[0].textContent], ['✔ Problème marqué comme lu', '#c8e63c', '⚠ Problèmes signalés (1)']);
  eq('aucun « delete » : rien n\'est effacé', m.appels.ecritures.filter((x) => x.op === 'delete').length, 0);
  m = monde({ utilisateur: admin, problemes: lignes, ecritures: { 'problemes.update': { data: [], error: null } } });
  await m.run('loadStops()'); await m.run('openAdmin()'); await attendre(30); const nL = m.appels.lectures.filter((x) => x === 'problemes').length;
  await m.run(`marquerLu('pb1')`);
  eq('les règles d\'accès refusent sans erreur (0 ligne changée) : on le DIT, on ne relit rien', [m.dernierToast(), m.appels.lectures.filter((x) => x === 'problemes').length - nL], ['❌ Impossible de marquer comme lu', 0]);

  // — Ne jamais mentir —
  m = monde({ utilisateur: admin, problemes: lignes }); await m.run('loadStops()'); m.donnees.problemes = []; await m.run('openAdmin()'); await attendre(30);
  eq('aucun problème : « ✔ Aucun problème signalé. »', texte(m).includes('✔ Aucun problème signalé.'), true);
  m = monde({ utilisateur: admin, problemes: lignes, erreurLecture: ['problemes'] }); await m.run('loadStops()'); await m.run('openAdmin()'); await attendre(30);
  t = texte(m);
  vrai('lecture impossible : le panneau le DIT (et n\'affiche PAS « Aucun problème signalé »)', t.includes('❌ Impossible de charger les problèmes') && !t.includes('Aucun problème signalé'), t);
  m = monde({ utilisateur: admin, problemes: lignes, lectureLance: ['problemes'] }); await m.run('loadStops()'); await m.run('openAdmin()'); await attendre(30);
  vrai('… même quand le réseau est coupé', texte(m).includes('❌ Impossible de charger les problèmes'), texte(m));
  m = monde(); await m.run('loadStops()'); await m.run('openAdmin()'); await attendre(30);
  eq('un employé qui essaie d\'ouvrir le panneau : refusé', [m.dernierToast(), m.el('admin-overlay').classList.contains('open')], ['⛔ Accès admin requis', false]);
}

log('\n=== LE CODE DE L\'APPLICATION : plus de restes de l\'ancien « fait » ===');
{
  const fichiersJs = fs.readdirSync(WWW + 'js').filter((f) => f.endsWith('.js'));
  const sansCommentaires = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const trouve = (re) => fichiersJs.filter((f) => re.test(sansCommentaires(lire('js/' + f))));
  eq('plus aucune lecture ni écriture de « .fait » ou « fait: »', trouve(/\.fait\b|\bfait\s*:/), []);
  eq('plus de dbDone (écriture directe dans stops.fait)', trouve(/\bdbDone\b/), []);
  eq('plus de nouvellePasse (remise à zéro qui effaçait les problèmes)', trouve(/\bnouvellePasse\b/), []);
  eq('plus aucune fenêtre native confirm() (refusée d\'office par certains navigateurs)', trouve(/(^|[^\w.])confirm\s*\(/).filter((f) => f !== 'utilitaires.js'), []);
  const html = lire('index.html');
  eq('plus de référence à l\'ancien _onSite', trouve(/_onSite/), []);
  eq('les problèmes n\'utilisent plus « created_at » (leur colonne s\'appelle cree_le ; celle des routes, elle, s\'appelle bien created_at)', trouve(/created_at/).filter((f) => ['admin.js', 'problemes.js'].includes(f)), []);
  eq('plus de « probMap » ni de « _probleme » (un seul problème par arrêt)', trouve(/probMap|_probleme\b/), []);
  eq('l\'application n\'efface JAMAIS un problème (ni delete, ni upsert)', trouve(/from\(\s*['"]problemes['"]\s*\)\s*\.\s*(delete|upsert)/), []);
  eq('un problème neuf n\'envoie jamais « lu » (la base l\'interdit aux employés)', trouve(/from\(\s*['"]problemes['"]\s*\)\s*\.\s*insert\(\s*\[\s*\{[^}]*\blu\s*:/), []);
  vrai('la fiche d\'un arrêt a sa zone « problèmes »', lire('index.html').includes('id="sc-prob"'));
  vrai('la carte écoute aussi les problèmes en temps réel', /table:'problemes'\},\(\)=>planifierRechargementProblemes\(\)/.test(lire('js/carte.js')));
  vrai('marqueurs ET zones utilisent la règle de couleur unique', (lire('js/arrets.js').match(/couleurEtat\(/g) || []).length === 2, 'mkIcon + zones');
  vrai('la carte écoute aussi les positions en temps réel', /table:'positions'\},\(\)=>planifierRechargementPositions\(\)/.test(lire('js/carte.js')));
  vrai('la page charge tours.js', html.includes('<script src="js/tours.js"></script>'));
  vrai('le bouton « Nouvelle passe » n\'existe plus dans la page', !/nouvelle-passe|nouvellePasse/.test(html));
  vrai('la fiche d\'un arrêt a sa ligne « Passe n° … »', html.includes('id="sc-tour"'));
  vrai('aucune écriture directe dans passes / passe_arrets depuis l\'application (tout passe par les fonctions du serveur)',
    !fichiersJs.some((f) => /from\(\s*['"](passes|passe_arrets)['"]\s*\)\s*\.\s*(insert|update|delete|upsert)/.test(lire('js/' + f))));
}

tousLesMondes.forEach((w) => w.fin());
console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
