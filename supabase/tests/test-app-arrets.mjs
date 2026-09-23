// Étape 13b — « fait » vient du TOUR en cours (www/js/tours.js), testé avec les VRAIS fichiers de l'application
// chargés dans un faux navigateur (faux document, fausse carte Leaflet) et un FAUX Supabase.
// Ce que ces tests ne peuvent pas vérifier : le vrai Supabase (fait par reel-etape-13.mjs) et l'affichage réel (essai dans le navigateur).
import vm from 'vm';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { stripTypeScriptTypes } from 'node:module';   // (la fonction serveur « calculer-parcours » est du TypeScript : on retire les types pour la charger)
// WWW_TEST : un autre dossier « www » (les erreurs volontaires modifient une COPIE du code, jamais le vrai)
const WWW = process.env.WWW_TEST ? process.env.WWW_TEST.split('\\').join('/').replace(/\/?$/, '/') : fileURLToPath(new URL('../../www/', import.meta.url));

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
    equipes: o.equipes ?? [],
    equipage_periodes: o.equipages ?? [],
    parcours_segments: o.segments ?? [],   // les tronçons du tracé (étape 18b, parcours.js)
    reglages: o.reglages ?? [],
    types_service: o.typesService ?? [],
  };
  const appels = { rpc: [], eq: [], ecritures: [], statut: [], erreurs: [], toasts: [], ouverts: [], confirmations: [], informations: [], lectures: [], selects: [], orders: [], is: [], ranges: [], fonctions: [], canaux: [], attributions: [] };
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
      q.is = (c, v) => { appels.is.push([table, c, v]); return q; };
      q.range = (a, b) => { q.plage = [a, b]; return q; };   // (lecture par tranches : comme le vrai service de données)
      q.delete = () => { q.op = 'delete'; return q; };
      q.update = (v) => { q.op = 'update'; q.valeur = v; return q; };
      q.insert = (v) => { q.op = 'insert'; q.valeur = v; return q; };
      q.then = (ok_, ko_) => {
        let res;
        if (q.op === 'select') {
          appels.lectures.push(table);
          if (o.lectureLance?.includes(table)) throw new Error('Failed to fetch');
          // (les arrêts sont rendus en COPIE, comme le fait un vrai serveur : l'application qui change l'ordre d'un arrêt chez elle ne change pas « la base » toute seule)
          let lignes = table === 'stops' ? (donnees.stops ?? []).map((s) => ({ ...s })) : (donnees[table] ?? []);
          if (q.plage) { appels.ranges.push([table, q.plage[0], q.plage[1]]); lignes = lignes.slice(q.plage[0], q.plage[1] + 1); }
          res = o.erreurLecture?.includes(table) ? { data: null, error: { message: 'boum' } } : { data: lignes, error: null };
        } else {
          appels.ecritures.push({ table, op: q.op, valeur: q.valeur, filtres: q.filtres });
          const rep = reponsesEcriture[table + '.' + q.op];
          res = typeof rep === 'function' ? rep(q.valeur, donnees, q.filtres) : (rep ?? { data: null, error: null });
        }
        return Promise.resolve(res).then(ok_, ko_);
      };
      return q;
    },
    // Les fonctions du serveur (étape 18b : calculer-parcours) : la réponse vient de o.fonction (une valeur, ou une fonction (corps, donnees, numeroDAppel))
    functions: {
      invoke: async (nom, opt) => {
        appels.fonctions.push({ nom, corps: opt && opt.body });
        const rep = o.fonction;
        if (typeof rep === 'function') return rep(opt && opt.body, donnees, appels.fonctions.length);
        return rep ?? { data: { ok: true, calcules: 0, sans_route: 0, echecs: 0, restants: 0, total_troncons: 0, limite_atteinte: false }, error: null };
      },
    },
    // Le temps réel : on note les canaux ouverts (parcours.js n'en ouvre un qu'une fois la table lisible)
    channel: (nom) => {
      const ch = { nom, liens: [], on(type, filtre, cb) { ch.liens.push({ type, filtre, cb }); return ch; }, subscribe() { appels.canaux.push(ch); return ch; } };
      return ch;
    },
  };

  // « camions » : les marqueurs de véhicules (zIndexOffset 500), à part des arrêts ; « traces » : les polylignes du tracé, « groupes » : les couches qui les regroupent (étape 18b)
  const marqueurs = [], polygones = [], retires = [], camions = [], traces = [], groupes = [];
  const memoire = new Map(Object.entries(o.memo ?? {}));   // le stockage du téléphone (localStorage), propre à chaque monde
  const sandbox = {
    document: { getElementById: el, createElement: () => creer(null) },
    localStorage: { getItem: (k) => (memoire.has(k) ? memoire.get(k) : (k === 'lp_zone' ? (o.zone ?? null) : null)), setItem: (k, v) => { memoire.set(k, String(v)); }, removeItem: (k) => { memoire.delete(k); } },
    window: { open: (u) => appels.ouverts.push(u) },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    L: {
      divIcon: (opt) => opt,
      marker: (ll, opt) => {
        const m = { ll, opt, deplacements: 0, popup: null, addTo() { return m; }, on(ev, f) { m.clic = f; },
          setLatLng(x) { m.ll = x; m.deplacements++; return m; }, setIcon(i) { m.opt = { ...m.opt, icon: i }; return m; },
          bindPopup(h) { m.popup = h; return m; }, setPopupContent(h) { m.popup = h; return m; } };
        (opt?.zIndexOffset === 500 ? camions : marqueurs).push(m);
        return m;
      },
      polygon: (pts, opt) => { const p = { pts, opt, addTo() { return p; } }; polygones.push(p); return p; },
      polyline: (lignes, opt) => { const p = { lignes, opt, addTo() { return p; } }; traces.push(p); return p; },
      layerGroup: (couches) => { const g = { couches, addTo() { groupes.push(g); return g; } }; return g; },
    },
    __map: { removeLayer: (m) => retires.push(m), flyTo() {}, attributionControl: { addAttribution: (t) => appels.attributions.push(['+', t]), removeAttribution: (t) => appels.attributions.push(['-', t]) } },
    __fauxDb: fauxDb,
    setStatus: (t) => appels.statut.push(t),
    hideLoading() {},
    showErr: (m) => appels.erreurs.push(m),
    __confirmations: appels.confirmations,
    __reponseConfirmation: o.confirme ?? true,
  };
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/config.js', 'js/utilitaires.js', 'js/hors-reseau.js', 'js/file-attente.js', 'js/tours.js', 'js/vehicules.js', 'js/equipage.js', 'js/equipage-panneau.js', 'js/passe.js', 'js/resume-passe.js', 'js/arrets.js', 'js/routes.js', 'js/liste-arrets.js', 'js/ordre.js', 'js/parcours.js', 'js/placement.js', 'js/problemes.js', 'js/photos.js', 'js/admin.js', 'js/admin-employes.js', 'js/admin-vehicules.js', 'js/admin-reglages.js', 'js/admin-types-service.js'])
    vm.runInContext(lire(f), ctx, { filename: f });
  vm.runInContext('db = __fauxDb; map = __map; currentUser = ' + JSON.stringify(o.utilisateur ?? { id: 'u-luc', nom: 'Luc', role: 'employe' }) + ';', ctx);
  // Les messages : on les note (toast) ; la boîte de confirmation est testée ailleurs : ici on note la question et on répond « oui » ou « non »
  vm.runInContext('toast = (m) => { __toasts.push(m); }; confirmer = async (...a) => { __confirmations.push(a); return __reponseConfirmation; }; informer = async (...a) => { __informations.push(a); };',
    Object.assign(ctx, { __toasts: appels.toasts, __informations: appels.informations }) && ctx);
  const w = {
    ctx, el, donnees, appels, marqueurs, polygones, retires, camions, traces, groupes, memoire,
    run: (code) => vm.runInContext(code, ctx),
    routeActive: (id) => vm.runInContext(`routeActive = ${JSON.stringify(id)};`, ctx),
    couleur: (m) => (m.opt.icon.html.match(/background:(#[0-9a-f]+)/) || [])[1],
    elementsListe: () => el('liste-body').children,
    dernierToast: () => appels.toasts[appels.toasts.length - 1],
    dernierInfo: () => appels.informations[appels.informations.length - 1],
    fin: () => vm.runInContext('clearInterval(_minuterieEnCours);_minuterieEnCours=null;arreterSonde();', ctx),
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
  vrai('… le premier à faire est le PROCHAIN client de ma passe (étape 18b), les deux suivants sont « À FAIRE »', m.elementsListe()[0].innerHTML.includes('▶ PROCHAIN') && m.elementsListe().slice(1, 3).every((d) => d.innerHTML.includes('À FAIRE')));
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
  await attendre(60);   // (la copie anticipée de l'écran « Débuter », en arrière-plan, est terminée : elle n'est pas ce qu'on compte ici)
  const nbTours = (x) => x.appels.rpc.filter((r) => r.nom === 'tours_en_cours').length;
  const avant = nbTours(m);
  for (let i = 0; i < 5; i++) m.run('planifierRechargementTours()');
  await attendre(120); eq('5 changements d\'un coup : pas encore relu (on patiente un instant)', nbTours(m), avant);
  await attendre(400); eq('… puis relu UNE seule fois', nbTours(m), avant + 1);
  m.donnees.tours[0].arrets_faits.push('s2'); m.donnees.tours[0].faits = 2;
  m.run('planifierRechargementTours()'); await attendre(450);
  eq('un arrêt complété par l\'autre camion apparaît sans rien toucher (vert, 2/4)', [m.run(`estFait(stops[${idx('s2')}])`), m.couleur(m.marqueurs.slice(-6)[1]), m.el('prog-txt').textContent], [true, '#4ade80', '2/4']);

  m.run(`openCard(${idx('s2')})`);
  eq('fiche ouverte sur s2 déjà fait : « Déjà complété »', m.el('btn-cmp').textContent, '✔ Déjà complété');
  m.donnees.tours[0].arrets_faits = ['s1']; m.donnees.tours[0].faits = 1;
  m.run('planifierRechargementTours()'); await attendre(450);
  eq('une annulation par l\'autre camion remet la fiche ouverte à jour (bouton « Complété » redevenu actif)', [m.el('btn-cmp').textContent, m.el('btn-cmp').disabled], ['✔ Complété', false]);

  const deconnecte = monde(); await deconnecte.run('loadStops()');
  await attendre(60);
  deconnecte.run('currentUser = null'); const n0 = nbTours(deconnecte);
  deconnecte.run('planifierRechargementTours()'); await attendre(450);
  eq('personne de connecté : aucune lecture', nbTours(deconnecte), n0);

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
  eq('les problèmes sont lus avec des colonnes NOMMÉES (jamais « * »)', lecture[1], 'id, stop_id, passe_id, utilisateur_id, note, cree_le, photo_chemin, utilisateurs!utilisateur_id(nom)');
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
  eq('UN seul envoi : la note nettoyée, l\'arrêt, la passe du camion de Luc — et RIEN d\'autre (ni « lu », ni nom : c\'est la base qui les met)', [ins.length, ins[0].op, (({ id, ...reste }) => [/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id), reste])(ins[0].valeur[0])], [1, 'insert', [true, { stop_id: 's2', passe_id: 'p-luc', note: 'Entrée bloquée par la neige' }]]);
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
  eq('la lecture du panneau nomme l\'AUTEUR (« utilisateurs!utilisateur_id », car lu_par pointe aussi vers utilisateurs), la passe et l\'arrêt', admSel[1], 'id, note, cree_le, photo_chemin, stops(adresse,service,client), utilisateurs!utilisateur_id(nom), passes(numero,tache)');
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

// ══════════════════════════════════════════════════════════════════════
// ÉTAPE 19 (SUITE) : LE PANNEAU ADMINISTRATEUR DEVIENT PLUSIEURS ONGLETS ; L'ONGLET « EMPLOYÉS » (www/js/admin.js, admin-employes.js)
// ══════════════════════════════════════════════════════════════════════
const ADMIN19 = { id: 'u-joe', nom: 'Joé', role: 'admin' };
const EMPLOYES = [
  { id: 'e-luc', nom: 'Luc Boisvert', telephone: '8195550101', role: 'employe', actif: true, cree_le: '2026-01-01T00:00:00Z' },
  { id: 'e-marc', nom: 'Marc Tremblay', telephone: '8195550102', role: 'employe', actif: false, cree_le: '2026-01-02T00:00:00Z' },
  { id: 'u-joe', nom: 'Joé', telephone: null, role: 'admin', actif: true, cree_le: '2026-01-01T00:00:00Z' },
];
const mondeEmp = async (o = {}) => {
  const m = monde({ utilisateur: ADMIN19, rpc: { admin_lister_utilisateurs: { data: EMPLOYES, error: null } }, ...o });
  await m.run('loadStops()');
  return m;
};
const ligneEmploye = (m, id) => m.el('admin-body').children.find((c) => c.className === 'emp-item' && c.children[0].children[0].textContent === EMPLOYES.find((e) => e.id === id).nom);
const boutonEmp = (ligne, texte) => ligne.children[2].children.find((b) => b.textContent === texte);

log('\n=== LE PANNEAU ADMINISTRATEUR A DES ONGLETS ===');
{
  const m = await mondeEmp({ problemes: [] });
  await m.run('openAdmin()'); await attendre(30);
  eq('à l\'ouverture : l\'onglet « Problèmes » est actif, le sous-titre le dit', [m.el('admin-sub').textContent, m.el('admin-tabs').children.map((b) => [b.textContent, b.className])],
    ['Problèmes signalés', [['⚠ Problèmes', 'admin-tab active'], ['👤 Employés', 'admin-tab'], ['🚚 Véhicules', 'admin-tab'], ['🕒 Réglages', 'admin-tab'], ['🧰 Services', 'admin-tab']]]);
  eq('… aucun appel « admin_lister_utilisateurs » tant qu\'on n\'a pas touché l\'onglet', m.appels.rpc.filter((r) => r.nom === 'admin_lister_utilisateurs').length, 0);
  m.el('admin-tabs').children[1].onclick();
  await attendre(30);
  eq('toucher « Employés » : l\'onglet devient actif, le sous-titre change, la liste se charge', [m.el('admin-tabs').children.map((b) => b.className), m.el('admin-sub').textContent, m.appels.rpc.filter((r) => r.nom === 'admin_lister_utilisateurs').length], [['admin-tab', 'admin-tab active', 'admin-tab', 'admin-tab', 'admin-tab'], 'Employés', 1]);
  m.el('admin-tabs').children[1].onclick();
  eq('toucher le même onglet une deuxième fois : rien n\'est relu', m.appels.rpc.filter((r) => r.nom === 'admin_lister_utilisateurs').length, 1);
  m.el('admin-tabs').children[0].onclick();
  await attendre(30);
  eq('revenir sur « Problèmes » : son contenu (et non celui des employés) est affiché', m.el('admin-sub').textContent, 'Problèmes signalés');
  m.fin();
}
{
  // Marquer un problème comme lu ne doit PAS faire sauter l'écran sur « Problèmes » si on est sur un AUTRE onglet
  const m = await mondeEmp({ problemes: [{ id: 'pb1', stop_id: 's2', passe_id: null, utilisateur_id: 'u-marc', note: 'x', cree_le: new Date().toISOString(), stops: { adresse: 'a', service: MEC, client: 'c' }, utilisateurs: { nom: 'Marc' }, passes: null }], ecritures: { 'problemes.update': { data: [{ id: 'pb1' }], error: null } } });
  await m.run('openAdmin()'); await attendre(30);
  m.el('admin-tabs').children[1].onclick(); await attendre(30);
  const relu = m.appels.rpc.filter((r) => r.nom === 'admin_lister_utilisateurs').length;
  await m.run(`marquerLu('pb1')`);
  eq('« marquer comme lu » pendant que l\'onglet « Employés » est ouvert : il reste sur « Employés », il n\'est PAS relu pour rien', [m.el('admin-sub').textContent, m.appels.rpc.filter((r) => r.nom === 'admin_lister_utilisateurs').length - relu], ['Employés', 0]);
  m.fin();
}
{
  const m = await mondeEmp();
  await m.run(`_adminOnglet='employes';`);
  await m.run('openAdmin()');
  eq('ouvrir le panneau repart TOUJOURS sur « Problèmes » (jamais coincé sur un autre onglet)', m.run('_adminOnglet'), 'problemes');
  m.fin();
}

log('\n=== L\'ONGLET « EMPLOYÉS » : LA LISTE ===');
{
  const m = await mondeEmp();
  await m.run(`_adminOnglet='employes';chargerPanneauAdmin();`);
  await attendre(30);
  const lus = m.appels.rpc.find((r) => r.nom === 'admin_lister_utilisateurs');
  vrai('la liste vient de admin_lister_utilisateurs() (le serveur)', !!lus);
  const luc = ligneEmploye(m, 'e-luc'), marc = ligneEmploye(m, 'e-marc'), joe = ligneEmploye(m, 'u-joe');
  vrai('un employé actif : son nom, son téléphone bien formaté, le badge « Actif »', !!luc && luc.children[0].children[1].textContent === '819 555-0101' && luc.children[1].textContent === 'Actif' && luc.children[1].className === 'emp-badge actif');
  vrai('un employé désactivé : le badge « Désactivé »', !!marc && marc.children[1].textContent === 'Désactivé' && marc.children[1].className === 'emp-badge inactif');
  vrai('un employé a trois boutons : Désactiver/Réactiver, NIP, Supprimer', luc.children[2].children.map((b) => b.textContent).join('|') === 'Désactiver|🔑 NIP|🗑' && marc.children[2].children.map((b) => b.textContent).join('|') === 'Réactiver|🔑 NIP|🗑');
  vrai('un compte ADMINISTRATEUR : « 👑 Administrateur » à la place du téléphone, AUCUN bouton (il ne se gère pas ici)', !!joe && joe.children[0].children[1].textContent === '👑 Administrateur' && joe.children.length === 2);
  vrai('le bouton « ＋ NOUVEL EMPLOYÉ » est là, au-dessus de la liste', m.el('admin-body').children[0].children[0].textContent === '＋ NOUVEL EMPLOYÉ');
  m.fin();
}
{
  const vide = await mondeEmp({ rpc: { admin_lister_utilisateurs: { data: [], error: null } } });
  await vide.run(`_adminOnglet='employes';chargerPanneauAdmin();`); await attendre(30);
  vrai('aucun compte : « Aucun compte. », le bouton « ＋ NOUVEL EMPLOYÉ » reste là', vide.el('admin-body').children[1].textContent === 'Aucun compte.');
  vide.fin();
  const err = await mondeEmp({ rpc: { admin_lister_utilisateurs: { data: null, error: { message: 'boum' } } } });
  await err.run(`_adminOnglet='employes';chargerPanneauAdmin();`); await attendre(30);
  vrai('la liste ne peut pas être lue : message clair, jamais « Aucun compte » (ce serait un mensonge)', err.el('admin-body').innerHTML.includes('❌ Impossible de charger les employés') && !err.el('admin-body').innerHTML.includes('Aucun compte'));
  err.fin();
  const planté = await mondeEmp({ rpc: { admin_lister_utilisateurs: () => { throw new Error('Failed to fetch'); } } });
  await planté.run(`_adminOnglet='employes';chargerPanneauAdmin();`); await attendre(30);
  vrai('… même si l\'appel plante carrément (jamais de plantage de l\'écran)', planté.el('admin-body').innerHTML.includes('❌ Impossible de charger les employés'));
  planté.fin();
  const pasListe = await mondeEmp({ rpc: { admin_lister_utilisateurs: { data: { length: 2 }, error: null } } });
  await pasListe.run(`_adminOnglet='employes';chargerPanneauAdmin();`); await attendre(30);
  eq('la réponse n\'est pas une VRAIE liste, même si elle a un « length » (jamais attendu, mais jamais un plantage) : traité comme « aucun compte »', pasListe.el('admin-body').children[1]?.textContent, 'Aucun compte.');
  pasListe.fin();
}

log('\n=== « ＋ NOUVEL EMPLOYÉ » ===');
{
  const m = await mondeEmp({ fonction: (corps) => ({ data: { ok: true, employe: { id: 'nouveau', nom: corps.nom, telephone: '8195559999', actif: true }, nip: '482915', nip_genere: true }, error: null }) });
  await m.run(`_adminOnglet='employes';chargerPanneauAdmin();`); await attendre(30);
  m.el('ne-nom').value = 'reste du dernier employé'; m.el('ne-telephone').value = '8195550000'; m.el('ne-nip-manuel').checked = true; m.el('ne-nip').value = '111111'; m.el('ne-nip-zone').style.display = 'block';
  m.el('admin-body').children[0].children[0].onclick();
  eq('le bouton ouvre la fenêtre, avec des champs vides (rien du dernier employé créé) et le NIP manuel décoché', [m.el('nouvel-employe-overlay').classList.contains('open'), m.el('ne-nom').value, m.el('ne-telephone').value, m.el('ne-nip-manuel').checked, m.el('ne-nip-zone').style.display], [true, '', '', false, 'none']);
  eq('toucher en dehors de la fenêtre la ferme', (m.run(`bgClickNE({target:document.getElementById('nouvel-employe-overlay')})`), m.el('nouvel-employe-overlay').classList.contains('open')), false);
  eq('… mais toucher DEDANS ne la ferme pas', (m.el('admin-body').children[0].children[0].onclick(), m.run(`bgClickNE({target:document.getElementById('ne-nom')})`), m.el('nouvel-employe-overlay').classList.contains('open')), true);
  m.el('ne-nip-manuel').checked = true;
  m.run('basculerNipManuel()');
  eq('cocher « je choisis le NIP » montre le champ NIP', m.el('ne-nip-zone').style.display, 'block');
  m.el('ne-nip').value = '482915';
  m.el('ne-nip-manuel').checked = false;
  m.run('basculerNipManuel()');
  eq('décocher le cache et vide un NIP déjà tapé (il ne doit pas être envoyé en cachette)', [m.el('ne-nip-zone').style.display, m.el('ne-nip').value], ['none', '']);
  await m.run('creerEmploye()');
  eq('sans nom : rien n\'est appelé, message clair', [m.dernierToast(), m.appels.fonctions.length], ['⚠ Entre un nom', 0]);
  m.el('ne-nom').value = 'Nouvelle Personne';
  await m.run('creerEmploye()');
  eq('sans téléphone : rien n\'est appelé', [m.dernierToast(), m.appels.fonctions.length], ['⚠ Entre un numéro de téléphone', 0]);
  m.el('ne-telephone').value = '819 555-9999';
  m.el('ne-nip-manuel').checked = true;
  m.el('ne-nip').value = '123';
  await m.run('creerEmploye()');
  eq('NIP manuel de moins de 6 chiffres : refusé AVANT d\'appeler le serveur', [m.dernierToast(), m.appels.fonctions.length], ['⚠ Le NIP doit avoir exactement 6 chiffres', 0]);
  m.el('ne-nip-manuel').checked = false;
  const relu = m.appels.rpc.filter((r) => r.nom === 'admin_lister_utilisateurs').length;
  await m.run('creerEmploye()');
  eq('nom et téléphone présents, sans NIP manuel : la fonction est appelée SANS champ « nip »', m.appels.fonctions[0], { nom: 'admin-employes', corps: { action: 'creer', nom: 'Nouvelle Personne', telephone: '819 555-9999' } });
  eq('la fenêtre se ferme, la liste est relue, le NIP est montré UNE FOIS (informer, pas un toast qui disparaîtrait)', [m.el('nouvel-employe-overlay').classList.contains('open'), m.appels.rpc.filter((r) => r.nom === 'admin_lister_utilisateurs').length - relu, m.dernierInfo()], [false, 1, ['Compte créé : Nouvelle Personne', 'NIP : 482915 (choisi au hasard)', 'J’ai noté le NIP']]);
  m.fin();
}
{
  const m = await mondeEmp({ fonction: (corps) => ({ data: { ok: true, employe: { id: 'x', nom: corps.nom, telephone: corps.telephone, actif: true }, nip: corps.nip, nip_genere: false }, error: null }) });
  await m.run(`_adminOnglet='employes';chargerPanneauAdmin();`); await attendre(30);
  m.el('ne-nom').value = 'Choix Manuel'; m.el('ne-telephone').value = '8195551234'; m.el('ne-nip-manuel').checked = true; m.el('ne-nip').value = '482917';
  await m.run('creerEmploye()');
  eq('un NIP choisi par Joé est envoyé au serveur, et redit SANS « (choisi au hasard) »', [m.appels.fonctions[0].corps, m.dernierInfo()[1]], [{ action: 'creer', nom: 'Choix Manuel', telephone: '8195551234', nip: '482917' }, 'NIP : 482917']);
  m.fin();
}
{
  // Chaque erreur du serveur, en mots simples ; rien n'est jamais annoncé comme un succès
  const essaiCreation = async (reponse) => {
    const m = await mondeEmp({ fonction: typeof reponse === 'function' ? reponse : () => reponse });
    await m.run(`_adminOnglet='employes';chargerPanneauAdmin();`); await attendre(30);
    m.run('ouvrirNouvelEmploye()');
    m.el('ne-nom').value = 'X'; m.el('ne-telephone').value = '8195551111';
    await m.run('creerEmploye()');
    const t = m.dernierToast(), ouverte = m.el('nouvel-employe-overlay').classList.contains('open');
    m.fin();
    return { toast: t, ouverte };
  };
  const http = (statut, corps) => ({ data: null, error: { message: 'non-2xx', context: { status: statut, json: async () => corps } } });
  eq('téléphone déjà utilisé : le message du serveur est montré, la fenêtre RESTE ouverte (rien n\'est perdu)', await essaiCreation(http(409, { ok: false, erreur: 'telephone_deja_utilise', message: 'Ce numéro est déjà celui de Marc.' })), { toast: '❌ Ce numéro est déjà celui de Marc.', ouverte: true });
  eq('NIP trop facile', (await essaiCreation(http(400, { ok: false, erreur: 'nip_trop_facile', message: 'NIP trop facile à deviner.' }))).toast, '❌ NIP trop facile à deviner.');
  eq('pas administrateur', (await essaiCreation(http(403, { ok: false, erreur: 'non_autorise', message: 'Réservé à l\'administrateur.' }))).toast, '❌ Réservé à l’administrateur.');
  eq('la fonction n\'est pas installée (404)', (await essaiCreation(http(404, { code: 'NOT_FOUND' }))).toast, '❌ La fonction « admin-employes » n’est pas installée sur Supabase.');
  eq('pas de réseau (aucune réponse)', (await essaiCreation({ data: null, error: { name: 'FunctionsFetchError', message: 'x', context: new TypeError('Failed to fetch') } })).toast, '📴 Pas de réseau : rien n’a été changé.');
  eq('une réponse illisible : jamais annoncée comme un succès', (await essaiCreation({ data: null, error: null })).toast, '❌ Une erreur est survenue.');
  eq('une réponse SANS « ok:true » n\'est jamais prise pour un succès, même si elle contient des données', (await essaiCreation({ data: { nip: '123456' }, error: null })).toast, '❌ Une erreur est survenue.');
  eq('un code reconnu mais SANS message du serveur : un texte par défaut compréhensible (pas le texte générique)', (await essaiCreation(http(400, { ok: false, erreur: 'nom_invalide', message: '' }))).toast, '❌ Renseignement invalide.');
  eq('l\'appel plante carrément', (await essaiCreation(() => { throw new Error('boum'); })).toast, '❌ boum');
  const m2 = await mondeEmp({ fonction: () => { throw new TypeError('Failed to fetch'); } });
  await m2.run(`_adminOnglet='employes';chargerPanneauAdmin();`); await attendre(30);
  await m2.run('reseau.enLigne=true;');
  m2.el('ne-nom').value = 'X'; m2.el('ne-telephone').value = '8195551111';
  await m2.run('creerEmploye()');
  eq('l\'appel plante avec une VRAIE panne de réseau (TypeError « Failed to fetch ») : le téléphone se sait hors réseau ensuite', m2.run('reseau.enLigne'), false);
  m2.fin();
}

log('\n=== DÉSACTIVER / RÉACTIVER ===');
{
  const m = await mondeEmp({ confirme: true, fonction: () => ({ data: { ok: true, employe: {} }, error: null }) });
  await m.run(`_adminOnglet='employes';chargerPanneauAdmin();`); await attendre(30);
  boutonEmp(ligneEmploye(m, 'e-luc'), 'Désactiver').onclick();
  await attendre(30);
  eq('désactiver demande UNE confirmation nommée, avec ce que ça change', m.appels.confirmations[0], ['Désactiver Luc Boisvert ?', 'Il ne pourra plus se connecter ni voir quoi que ce soit. Son historique est conservé.', 'Désactiver', 'Annuler']);
  eq('… puis appelle le serveur avec le bon identifiant, confirme par un message, relit la liste', [m.appels.fonctions[0].corps, m.dernierToast(), m.appels.rpc.filter((r) => r.nom === 'admin_lister_utilisateurs').length], [{ action: 'desactiver', id: 'e-luc' }, '✔ Luc Boisvert est désactivé', 2]);
  m.fin();
  const non = await mondeEmp({ confirme: false });
  await non.run(`_adminOnglet='employes';chargerPanneauAdmin();`); await attendre(30);
  boutonEmp(ligneEmploye(non, 'e-luc'), 'Désactiver').onclick();
  await attendre(30);
  eq('« Annuler » : RIEN n\'est appelé', non.appels.fonctions.length, 0);
  non.fin();
  const re = await mondeEmp({ fonction: () => ({ data: { ok: true, employe: {} }, error: null }) });
  await re.run(`_adminOnglet='employes';chargerPanneauAdmin();`); await attendre(30);
  boutonEmp(ligneEmploye(re, 'e-marc'), 'Réactiver').onclick();
  await attendre(30);
  eq('réactiver ne demande AUCUNE confirmation (sans risque) : appel direct, bon message', [re.appels.confirmations.length, re.appels.fonctions[0].corps, re.dernierToast()], [0, { action: 'reactiver', id: 'e-marc' }, '✔ Marc Tremblay est réactivé']);
  re.fin();
}

log('\n=== RÉINITIALISER LE NIP ===');
{
  const m = await mondeEmp({ confirme: true, fonction: () => ({ data: { ok: true, employe: {}, nip: '135790', nip_genere: true }, error: null }) });
  await m.run(`_adminOnglet='employes';chargerPanneauAdmin();`); await attendre(30);
  boutonEmp(ligneEmploye(m, 'e-luc'), '🔑 NIP').onclick();
  await attendre(30);
  eq('demande confirmation nommée, prévient que l\'ancien NIP ne marche plus', m.appels.confirmations[0], ['Nouveau NIP pour Luc Boisvert ?', 'L’ancien NIP ne fonctionnera plus.', 'Nouveau NIP', 'Annuler']);
  eq('… appelle le serveur (SANS proposer de NIP : toujours choisi au hasard), montre le nouveau NIP UNE FOIS', [m.appels.fonctions[0].corps, m.dernierInfo()], [{ action: 'reinitialiser_nip', id: 'e-luc' }, ['Nouveau NIP de Luc Boisvert', '135790', 'J’ai noté le NIP']]);
  eq('aucun toast : le NIP ne doit JAMAIS disparaître tout seul', m.appels.toasts.length, 0);
  m.fin();
  const non = await mondeEmp({ confirme: false });
  await non.run(`_adminOnglet='employes';chargerPanneauAdmin();`); await attendre(30);
  boutonEmp(ligneEmploye(non, 'e-luc'), '🔑 NIP').onclick();
  await attendre(30);
  eq('« Annuler » : rien n\'est appelé, rien n\'est montré', [non.appels.fonctions.length, non.appels.informations.length], [0, 0]);
  non.fin();
}

log('\n=== SUPPRIMER (OU DÉSACTIVER S\'IL Y A DE L\'HISTORIQUE) ===');
{
  const m = await mondeEmp({ confirme: true, fonction: () => ({ data: { ok: true, resultat: 'supprime', employe: {} }, error: null }) });
  await m.run(`_adminOnglet='employes';chargerPanneauAdmin();`); await attendre(30);
  boutonEmp(ligneEmploye(m, 'e-luc'), '🗑').onclick();
  await attendre(30);
  eq('demande confirmation, prévient qu\'un employé avec de l\'historique est désactivé plutôt que supprimé', m.appels.confirmations[0], ['Supprimer Luc Boisvert ?', 'S’il a de l’historique (quarts, passes…), il sera désactivé à la place.', 'Supprimer', 'Annuler']);
  eq('supprimé pour de vrai : le message le dit', [m.appels.fonctions[0].corps, m.dernierToast()], [{ action: 'supprimer', id: 'e-luc' }, '🗑 Luc Boisvert est supprimé']);
  m.fin();
  const av = await mondeEmp({ confirme: true, fonction: () => ({ data: { ok: true, resultat: 'desactive', employe: {}, message: 'a de l\'historique' }, error: null }) });
  await av.run(`_adminOnglet='employes';chargerPanneauAdmin();`); await attendre(30);
  boutonEmp(ligneEmploye(av, 'e-luc'), '🗑').onclick();
  await attendre(30);
  eq('avec de l\'historique : DÉSACTIVÉ, pas supprimé, et le message le dit clairement', av.dernierToast(), '⚠ Luc Boisvert a de l’historique : désactivé plutôt que supprimé');
  av.fin();
}
{
  // Un employé introuvable (supprimé ailleurs entre-temps) : la liste se relit toute seule, jamais de « succès » inventé
  const m = await mondeEmp({ confirme: true, fonction: () => ({ data: null, error: { message: 'x', context: { status: 404, json: async () => ({ ok: false, erreur: 'employe_introuvable', message: 'Employé introuvable.' }) } } }) });
  await m.run(`_adminOnglet='employes';chargerPanneauAdmin();`); await attendre(30);
  const relu = m.appels.rpc.filter((r) => r.nom === 'admin_lister_utilisateurs').length;
  boutonEmp(ligneEmploye(m, 'e-luc'), 'Désactiver').onclick();
  await attendre(30);
  eq('« introuvable » : message ET relecture automatique de la liste (elle a changé ailleurs)', [m.dernierToast(), m.appels.rpc.filter((r) => r.nom === 'admin_lister_utilisateurs').length - relu], ['❌ Cet employé n’existe plus (la liste va se rafraîchir).', 1]);
  m.fin();
}

log('\n=== LE CODE : LE PANNEAU ADMINISTRATEUR (étape 19) ===');
{
  const page = lire('index.html'), css = lire('css/style.css'), adm = lire('js/admin.js'), admE = lire('js/admin-employes.js');
  vrai('la page charge admin-employes.js juste après admin.js', page.indexOf('js/admin.js') < page.indexOf('js/admin-employes.js') && page.indexOf('js/admin-employes.js') < page.indexOf('js/liste-arrets.js'));
  vrai('le panneau a une zone d\'onglets ENTRE l\'en-tête et le corps, et la fenêtre « ＋ Nouvel employé »', page.indexOf('id="admin-header"') < page.indexOf('id="admin-tabs"') && page.indexOf('id="admin-tabs"') < page.indexOf('id="admin-body"') && page.includes('id="nouvel-employe-overlay"'));
  vrai('la fenêtre « Nouvel employé » se ferme au toucher en dehors, comme les autres', /onclick="bgClickNE\(event\)"/.test(page));
  vrai('… et respecte la zone sûre d\'un iPhone (comme les 9 autres fenêtres qui montent du bas)', new RegExp('#nouvel-employe-overlay[^{]*\\{[^}]*align-items:flex-end').test(css) && /#liste-overlay,#overlay,#admin-overlay,#routes-overlay,#nouvelle-route-overlay,#nouvel-employe-overlay,#nouveau-vehicule-overlay,#nouveau-type-service-overlay,#prob-overlay,#debut-overlay,#choix-overlay,#equipage-overlay\{padding-bottom:var\(--sa-bottom\);\}/.test(css));
  vrai('les onglets sont une FONCTION (pas une liste figée au chargement) : les fichiers des futurs onglets peuvent se charger après celui-ci', /function ongletsAdmin\(\)/.test(adm));
  vrai('ouvrir le panneau repart toujours sur l\'onglet « Problèmes »', /_adminOnglet='problemes';/.test(adm));
  vrai('un compte administrateur ne se gère pas ici : la liste ne montre ses boutons qu\'aux employés', /if\(u\.role==='employe'\)\{/.test(admE));
  vrai('le NIP n\'est JAMAIS envoyé par toast (qui disparaît seul) : toujours informer()', /await informer\('Nouveau NIP de/.test(admE) && /await informer\('Compte créé/.test(admE) && !/toast\([^)]*\+\s*(r\.)?nip\b/.test(admE));
  vrai('création, désactivation, réactivation, suppression et réinitialisation passent TOUJOURS par la fonction serveur, jamais une écriture directe sur « utilisateurs »', /action:'creer'/.test(admE) && /action:actif\?'reactiver':'desactiver'/.test(admE) && /action:'reinitialiser_nip'/.test(admE) && /action:'supprimer'/.test(admE) && !/db\.from\('utilisateurs'\)\.(update|insert|delete)/.test(admE));
  vrai('le style : les onglets, la liste des employés, les badges actif/inactif', /\.admin-tab\.active\{background:var\(--accent\)/.test(css) && /\.emp-badge\.actif\{background:rgba\(74,222,128/.test(css) && /\.emp-badge\.inactif\{background:rgba\(239,68,68/.test(css));
}

// ══════════════════════════════════════════════════════════════════════
// ÉTAPE 19 (SUITE) : L'ONGLET « VÉHICULES » (www/js/admin.js, admin-vehicules.js)
// Un véhicule = une ligne de « equipes » (nom, actif) : AUCUNE fonction serveur (contrairement aux employés) — des écritures
// directes suffisent, les règles d'accès (equipes_admin) laissant déjà tout faire à l'administrateur. Jamais de suppression
// (un véhicule reste lié à son historique) : seulement créer, renommer, désactiver/réactiver.
// ══════════════════════════════════════════════════════════════════════
const VEHICULES = [
  { id: 'v-1', nom: 'Camion 1', actif: true },
  { id: 'v-2', nom: 'Camion sel', actif: false },
];
const mondeVeh = async (o = {}) => {
  const m = monde({ utilisateur: ADMIN19, equipes: VEHICULES.map((v) => ({ ...v })), ...o });
  await m.run('loadStops()');
  return m;
};
const ligneVehicule = (m, nom) => m.el('admin-body').children.find((c) => c.className === 'emp-item' && c.children[0].children[0].textContent === nom);
const boutonVeh = (ligne, texte) => ligne.children[2].children.find((b) => b.textContent === texte);

log('\n=== L\'ONGLET « VÉHICULES » : LA LISTE ===');
{
  const m = await mondeVeh();
  await m.run(`_adminOnglet='vehicules';chargerPanneauAdmin();`);
  await attendre(30);
  vrai('la liste vient d\'une lecture DIRECTE de la table « equipes » (pas de fonction serveur, contrairement aux employés)', m.appels.lectures.includes('equipes'));
  const c1 = ligneVehicule(m, 'Camion 1'), c2 = ligneVehicule(m, 'Camion sel');
  vrai('un véhicule actif : son nom, le badge « Actif »', !!c1 && c1.children[1].textContent === 'Actif' && c1.children[1].className === 'emp-badge actif');
  vrai('un véhicule désactivé : le badge « Désactivé »', !!c2 && c2.children[1].textContent === 'Désactivé' && c2.children[1].className === 'emp-badge inactif');
  vrai('chaque véhicule a deux boutons : Renommer, Désactiver/Réactiver (jamais Supprimer)', c1.children[2].children.map((b) => b.textContent).join('|') === '✏️ Renommer|Désactiver' && c2.children[2].children.map((b) => b.textContent).join('|') === '✏️ Renommer|Réactiver');
  vrai('le bouton « ＋ NOUVEAU VÉHICULE » est là, au-dessus de la liste', m.el('admin-body').children[0].children[0].textContent === '＋ NOUVEAU VÉHICULE');
  m.fin();
}
{
  const vide = await mondeVeh({ equipes: [] });
  await vide.run(`_adminOnglet='vehicules';chargerPanneauAdmin();`); await attendre(30);
  vrai('aucun véhicule : « Aucun véhicule. », le bouton « ＋ NOUVEAU VÉHICULE » reste là', vide.el('admin-body').children[1].textContent === 'Aucun véhicule.');
  vide.fin();
  const err = await mondeVeh({ erreurLecture: ['equipes'] });
  await err.run(`_adminOnglet='vehicules';chargerPanneauAdmin();`); await attendre(30);
  vrai('la liste ne peut pas être lue : message clair, jamais « Aucun véhicule » (ce serait un mensonge)', err.el('admin-body').innerHTML.includes('❌ Impossible de charger les véhicules') && !err.el('admin-body').innerHTML.includes('Aucun véhicule'));
  err.fin();
  const planté = await mondeVeh({ lectureLance: ['equipes'] });
  await planté.run(`_adminOnglet='vehicules';chargerPanneauAdmin();`); await attendre(30);
  vrai('… même si l\'appel plante carrément (jamais de plantage de l\'écran)', planté.el('admin-body').innerHTML.includes('❌ Impossible de charger les véhicules'));
  planté.fin();
}

log('\n=== « ＋ NOUVEAU VÉHICULE » ===');
{
  const ins = (v, d) => { d.equipes.push({ id: 'v-nouveau', nom: v[0].nom, actif: true }); return { data: null, error: null }; };
  const m = await mondeVeh({ ecritures: { 'equipes.insert': ins } });
  await m.run(`_adminOnglet='vehicules';chargerPanneauAdmin();`); await attendre(30);
  m.el('nv-nom').value = 'reste du précédent';
  m.el('admin-body').children[0].children[0].onclick();
  eq('le bouton ouvre la fenêtre en mode création : titre, bouton « Créer », champ vide', [m.el('nouveau-vehicule-overlay').classList.contains('open'), m.el('nv-titre').textContent, m.el('nv-btn-save').textContent, m.el('nv-nom').value], [true, '＋ Nouveau véhicule', 'Créer', '']);
  eq('toucher en dehors de la fenêtre la ferme', (m.run(`bgClickNV({target:document.getElementById('nouveau-vehicule-overlay')})`), m.el('nouveau-vehicule-overlay').classList.contains('open')), false);
  eq('… mais toucher DEDANS ne la ferme pas', (m.el('admin-body').children[0].children[0].onclick(), m.run(`bgClickNV({target:document.getElementById('nv-nom')})`), m.el('nouveau-vehicule-overlay').classList.contains('open')), true);
  await m.run('sauvegarderVehicule()');
  eq('sans nom : rien n\'est écrit, message clair', [m.dernierToast(), m.appels.ecritures.length], ['⚠ Entre un nom de véhicule', 0]);
  m.el('nv-nom').value = '  Camion 3  ';
  await m.run('sauvegarderVehicule()');
  eq('le nom est envoyé nettoyé (espaces autour retirés) : une CRÉATION, sans id ni actif imposés', m.appels.ecritures[0], { table: 'equipes', op: 'insert', valeur: [{ nom: 'Camion 3' }], filtres: undefined });
  eq('la fenêtre se ferme, message « créé », la liste relue le montre', [m.el('nouveau-vehicule-overlay').classList.contains('open'), m.dernierToast(), !!ligneVehicule(m, 'Camion 3')], [false, '✔ Véhicule créé', true]);
  m.fin();
}

log('\n=== « RENOMMER » (MÊME FENÊTRE QUE « ＋ NOUVEAU », PRÉ-REMPLIE) ===');
{
  const upd = (v, d, f) => { d.equipes.find((x) => x.id === f[0][1]).nom = v.nom; return { data: null, error: null }; };
  const m = await mondeVeh({ ecritures: { 'equipes.update': upd } });
  await m.run(`_adminOnglet='vehicules';chargerPanneauAdmin();`); await attendre(30);
  boutonVeh(ligneVehicule(m, 'Camion 1'), '✏️ Renommer').onclick();
  eq('« Renommer » ouvre la même fenêtre, pré-remplie avec le nom actuel, bouton « Enregistrer »', [m.el('nouveau-vehicule-overlay').classList.contains('open'), m.el('nv-titre').textContent, m.el('nv-btn-save').textContent, m.el('nv-nom').value], [true, 'Renommer un véhicule', 'Enregistrer', 'Camion 1']);
  m.el('nv-nom').value = 'Camion Un';
  await m.run('sauvegarderVehicule()');
  eq('l\'écriture est une MODIFICATION du bon véhicule (jamais une nouvelle création)', m.appels.ecritures[0], { table: 'equipes', op: 'update', valeur: { nom: 'Camion Un' }, filtres: [['id', 'v-1']] });
  eq('la fenêtre se ferme, message « renommé », la liste relue le montre', [m.el('nouveau-vehicule-overlay').classList.contains('open'), m.dernierToast(), !!ligneVehicule(m, 'Camion Un')], [false, '✔ Véhicule renommé', true]);
  boutonVeh(ligneVehicule(m, 'Camion sel'), '✏️ Renommer').onclick();
  m.run('fermerNouveauVehicule()');
  m.el('admin-body').children[0].children[0].onclick();
  eq('après avoir fermé une « Renommer », « ＋ Nouveau » repart bien en mode création (jamais coincé en renommage)', [m.el('nv-titre').textContent, m.el('nv-btn-save').textContent], ['＋ Nouveau véhicule', 'Créer']);
  m.el('nv-nom').value = 'Camion Quatre';
  await m.run('sauvegarderVehicule()');
  eq('… et « Créer » écrit vraiment une CRÉATION (pas un renommage du véhicule ouvert juste avant)', m.appels.ecritures[1], { table: 'equipes', op: 'insert', valeur: [{ nom: 'Camion Quatre' }], filtres: undefined });
  m.fin();
}

log('\n=== ERREURS (CRÉER / RENOMMER UN VÉHICULE) ===');
{
  const essai = async (rep) => {
    const m = await mondeVeh({ ecritures: { 'equipes.insert': rep } });
    await m.run(`_adminOnglet='vehicules';chargerPanneauAdmin();`); await attendre(30);
    m.run('ouvrirNouveauVehicule()');
    m.el('nv-nom').value = 'X';
    await m.run('sauvegarderVehicule()');
    const t = m.dernierToast(), ouverte = m.el('nouveau-vehicule-overlay').classList.contains('open');
    m.fin();
    return { toast: t, ouverte };
  };
  eq('nom déjà utilisé (contrainte unique) : message clair en mots simples, la fenêtre RESTE ouverte (rien n\'est perdu)', await essai({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "equipes_nom_unique"' } }), { toast: '❌ Ce nom de véhicule existe déjà.', ouverte: true });
  eq('pas de réseau (message du serveur) : message clair', await essai({ data: null, error: { message: 'Failed to fetch' } }), { toast: '📴 Pas de réseau : rien n’a été changé.', ouverte: true });
  eq('une autre erreur du serveur : son message tel quel', await essai({ data: null, error: { message: 'permission denied for table equipes' } }), { toast: '❌ permission denied for table equipes', ouverte: true });
  const m2 = await mondeVeh({ ecritures: { 'equipes.insert': () => { throw new TypeError('Failed to fetch'); } } });
  await m2.run(`_adminOnglet='vehicules';chargerPanneauAdmin();`); await attendre(30);
  await m2.run('reseau.enLigne=true;');
  m2.run('ouvrirNouveauVehicule()');
  m2.el('nv-nom').value = 'X';
  await m2.run('sauvegarderVehicule()');
  eq('l\'appel plante avec une VRAIE panne de réseau (TypeError « Failed to fetch ») : le téléphone se sait hors réseau ensuite', m2.run('reseau.enLigne'), false);
  m2.fin();
}

log('\n=== DÉSACTIVER / RÉACTIVER UN VÉHICULE ===');
{
  const upd = (v, d, f) => { d.equipes.find((x) => x.id === f[0][1]).actif = v.actif; return { data: null, error: null }; };
  const m = await mondeVeh({ confirme: true, ecritures: { 'equipes.update': upd } });
  await m.run(`_adminOnglet='vehicules';chargerPanneauAdmin();`); await attendre(30);
  boutonVeh(ligneVehicule(m, 'Camion 1'), 'Désactiver').onclick();
  await attendre(30);
  eq('désactiver demande UNE confirmation nommée, avec ce que ça change', m.appels.confirmations[0], ['Désactiver Camion 1 ?', 'Il ne sera plus proposé pour une nouvelle passe. Son historique est conservé.', 'Désactiver', 'Annuler']);
  eq('… puis écrit directement sur « equipes » (pas de fonction serveur), confirme par un message, relit la liste', [m.appels.ecritures[0], m.dernierToast(), ligneVehicule(m, 'Camion 1').children[1].textContent], [{ table: 'equipes', op: 'update', valeur: { actif: false }, filtres: [['id', 'v-1']] }, '✔ Camion 1 est désactivé', 'Désactivé']);
  m.fin();
  const non = await mondeVeh({ confirme: false });
  await non.run(`_adminOnglet='vehicules';chargerPanneauAdmin();`); await attendre(30);
  boutonVeh(ligneVehicule(non, 'Camion 1'), 'Désactiver').onclick();
  await attendre(30);
  eq('« Annuler » : RIEN n\'est écrit', non.appels.ecritures.length, 0);
  non.fin();
  const re = await mondeVeh({ ecritures: { 'equipes.update': upd } });
  await re.run(`_adminOnglet='vehicules';chargerPanneauAdmin();`); await attendre(30);
  boutonVeh(ligneVehicule(re, 'Camion sel'), 'Réactiver').onclick();
  await attendre(30);
  eq('réactiver ne demande AUCUNE confirmation (sans risque) : écriture directe, bon message', [re.appels.confirmations.length, re.appels.ecritures[0], re.dernierToast()], [0, { table: 'equipes', op: 'update', valeur: { actif: true }, filtres: [['id', 'v-2']] }, '✔ Camion sel est réactivé']);
  re.fin();
  const planté = await mondeVeh({ ecritures: { 'equipes.update': () => { throw new TypeError('Failed to fetch'); } } });
  await planté.run(`_adminOnglet='vehicules';chargerPanneauAdmin();`); await attendre(30);
  await planté.run('reseau.enLigne=true;');
  boutonVeh(ligneVehicule(planté, 'Camion sel'), 'Réactiver').onclick();
  await attendre(30);
  eq('désactiver/réactiver qui plante avec une VRAIE panne de réseau (TypeError « Failed to fetch ») : le téléphone se sait hors réseau ensuite', planté.run('reseau.enLigne'), false);
  planté.fin();
}

log('\n=== LE CODE : L\'ONGLET « VÉHICULES » (étape 19) ===');
{
  const page = lire('index.html'), css = lire('css/style.css'), adm = lire('js/admin.js'), admV = lire('js/admin-vehicules.js');
  vrai('la page charge admin-vehicules.js juste après admin-employes.js, avant liste-arrets.js', page.indexOf('js/admin-employes.js') < page.indexOf('js/admin-vehicules.js') && page.indexOf('js/admin-vehicules.js') < page.indexOf('js/liste-arrets.js'));
  vrai('la fenêtre « Nouveau véhicule » est dans la page, et se ferme au toucher en dehors, comme les autres', page.includes('id="nouveau-vehicule-overlay"') && /onclick="bgClickNV\(event\)"/.test(page));
  vrai('… et respecte la zone sûre d\'un iPhone (comme les autres fenêtres qui montent du bas)', /#nouveau-vehicule-overlay\{display:none;position:fixed;inset:0;[^}]*align-items:flex-end;\}/.test(css) && css.includes('#nouvel-employe-overlay,#nouveau-vehicule-overlay,#nouveau-type-service-overlay,#prob-overlay'));
  vrai('le nouvel onglet est enregistré dans ongletsAdmin(), avec repli sûr si le fichier n\'est pas encore chargé', /\{id:'vehicules',icone:'🚚',label:'Véhicules',titre:'Véhicules',charger:\(typeof chargerVehiculesAdmin==='function'\)\?chargerVehiculesAdmin:null\}/.test(adm));
  vrai('un véhicule ne se supprime JAMAIS ici (il reste lié à son historique) : seulement créer, renommer, désactiver/réactiver', !/db\.from\('equipes'\)\.delete\(\)/.test(admV) && /db\.from\('equipes'\)\.insert/.test(admV) && /db\.from\('equipes'\)\.update\(\{nom\}\)/.test(admV) && /db\.from\('equipes'\)\.update\(\{actif\}\)/.test(admV));
  vrai('aucune fonction serveur ici : des écritures directes sur « equipes » (contrairement aux employés)', !/db\.functions\.invoke/.test(admV));
  vrai('le nom est toujours nettoyé (espaces autour retirés) avant d\'être envoyé', /const nom=document\.getElementById\('nv-nom'\)\.value\.trim\(\);/.test(admV));
  vrai('le style : les mêmes badges actif/inactif que les employés sont réutilisés (pas de nouvelle classe CSS dupliquée)', !/\.veh-/.test(css));
}

// ══════════════════════════════════════════════════════════════════════
// ÉTAPE 19 (SUITE) : L'ONGLET « RÉGLAGES » (www/js/admin.js, admin-reglages.js)
// La table « reglages » (cle, valeur, description) existe depuis l'étape 7 ; Joé la changeait par SQL. Écran GÉNÉRIQUE (toute la
// table, sans nommer les réglages en dur) : aucune fonction serveur, AUCUN SQL — les règles d'accès laissent déjà l'administrateur
// modifier « valeur » (jamais « cle » ni « description », non accordées en écriture).
// ══════════════════════════════════════════════════════════════════════
const REGLAGES = [
  { cle: 'alerte_quart_termine_heures', valeur: 4, description: 'Avertit le chauffeur si l’employé qu’il ajoute à bord a terminé son quart depuis moins de ce nombre d’heures.' },
  { cle: 'duree_max_quart_heures', valeur: 16, description: 'Un quart encore ouvert après ce nombre d’heures est fermé automatiquement (fin estimée, à valider).' },
  { cle: 'rappel_en_service_heures', valeur: 12, description: 'Rappel dans l’application : « Tu es encore en service depuis N heures : as-tu oublié de terminer ton quart ? »' },
];
const mondeRegl = async (o = {}) => {
  const m = monde({ utilisateur: ADMIN19, reglages: REGLAGES.map((r) => ({ ...r })), ...o });
  await m.run('loadStops()');
  return m;
};
const ligneReglage = (m, i) => m.el('admin-body').children[i];
const inputReglage = (ligne) => ligne.children[1].children[0];
const boutonReglage = (ligne) => ligne.children[1].children[2];

log('\n=== L\'ONGLET « RÉGLAGES » : LA LISTE (ÉCRAN GÉNÉRIQUE SUR LA TABLE « reglages ») ===');
{
  const m = await mondeRegl();
  await m.run(`_adminOnglet='reglages';chargerPanneauAdmin();`); await attendre(30);
  vrai('la liste vient d\'une lecture DIRECTE de la table « reglages » (pas de fonction serveur)', m.appels.lectures.includes('reglages'));
  const l0 = ligneReglage(m, 0), l1 = ligneReglage(m, 1);
  eq('chaque réglage montre sa description (déjà en français dans la base) et sa valeur actuelle', [l0.children[0].textContent, inputReglage(l0).value, l1.children[0].textContent, inputReglage(l1).value], [REGLAGES[0].description, '4', REGLAGES[1].description, '16']);
  vrai('la valeur se change avec un clavier numérique, un bouton « Enregistrer » à côté', inputReglage(l0).type === 'number' && boutonReglage(l0).textContent === 'Enregistrer');
  m.fin();
}
{
  const vide = await mondeRegl({ reglages: [] });
  await vide.run(`_adminOnglet='reglages';chargerPanneauAdmin();`); await attendre(30);
  vrai('aucun réglage : « Aucun réglage. »', vide.el('admin-body').children[0].textContent === 'Aucun réglage.');
  vide.fin();
  const err = await mondeRegl({ erreurLecture: ['reglages'] });
  await err.run(`_adminOnglet='reglages';chargerPanneauAdmin();`); await attendre(30);
  vrai('la liste ne peut pas être lue : message clair, jamais « Aucun réglage » (ce serait un mensonge)', err.el('admin-body').innerHTML.includes('❌ Impossible de charger les réglages') && !err.el('admin-body').innerHTML.includes('Aucun réglage'));
  err.fin();
  const planté = await mondeRegl({ lectureLance: ['reglages'] });
  await planté.run(`_adminOnglet='reglages';chargerPanneauAdmin();`); await attendre(30);
  vrai('… même si l\'appel plante carrément (jamais de plantage de l\'écran)', planté.el('admin-body').innerHTML.includes('❌ Impossible de charger les réglages'));
  planté.fin();
}

log('\n=== CHANGER UN RÉGLAGE ===');
{
  const upd = (v, d, f) => { d.reglages.find((x) => x.cle === f[0][1]).valeur = v.valeur; return { data: null, error: null }; };
  const m = await mondeRegl({ ecritures: { 'reglages.update': upd } });
  await m.run(`_adminOnglet='reglages';chargerPanneauAdmin();`); await attendre(30);
  const lues = m.appels.lectures.filter((t) => t === 'reglages').length;
  inputReglage(ligneReglage(m, 1)).value = '18';
  boutonReglage(ligneReglage(m, 1)).onclick();
  await attendre(30);
  eq('écrit directement sur « reglages » (SEULE la valeur, jamais cle ni description), confirme, RELIT la liste depuis le serveur (pas seulement ce qu\'on a tapé)', [m.appels.ecritures[0], m.dernierToast(), m.appels.lectures.filter((t) => t === 'reglages').length - lues, inputReglage(ligneReglage(m, 1)).value], [{ table: 'reglages', op: 'update', valeur: { valeur: 18 }, filtres: [['cle', 'duree_max_quart_heures']] }, '✔ Réglage enregistré', 1, '18']);
  m.fin();
}
{
  // La validation se fait AVANT d'écrire : rien n'est envoyé pour une valeur invalide
  const essaiInvalide = async (texte) => {
    const m = await mondeRegl();
    await m.run(`_adminOnglet='reglages';chargerPanneauAdmin();`); await attendre(30);
    inputReglage(ligneReglage(m, 0)).value = texte;
    boutonReglage(ligneReglage(m, 0)).onclick();
    await attendre(30);
    const t = m.dernierToast(), n = m.appels.ecritures.length;
    m.fin();
    return { toast: t, ecritures: n };
  };
  eq('zéro : refusé avant d\'écrire', await essaiInvalide('0'), { toast: '⚠ Entre un nombre d’heures valide (plus grand que 0)', ecritures: 0 });
  eq('négatif : refusé', await essaiInvalide('-2'), { toast: '⚠ Entre un nombre d’heures valide (plus grand que 0)', ecritures: 0 });
  eq('vide : refusé', await essaiInvalide(''), { toast: '⚠ Entre un nombre d’heures valide (plus grand que 0)', ecritures: 0 });
}
{
  const essai = async (rep) => {
    const m = await mondeRegl({ ecritures: { 'reglages.update': rep } });
    await m.run(`_adminOnglet='reglages';chargerPanneauAdmin();`); await attendre(30);
    inputReglage(ligneReglage(m, 0)).value = '5';
    boutonReglage(ligneReglage(m, 0)).onclick();
    await attendre(30);
    const t = m.dernierToast();
    m.fin();
    return t;
  };
  eq('pas de réseau (message du serveur) : message clair', await essai({ data: null, error: { message: 'Failed to fetch' } }), '📴 Pas de réseau : rien n’a été changé.');
  eq('une autre erreur du serveur : son message tel quel', await essai({ data: null, error: { message: 'permission denied for table reglages' } }), '❌ permission denied for table reglages');
  const m2 = await mondeRegl({ ecritures: { 'reglages.update': () => { throw new TypeError('Failed to fetch'); } } });
  await m2.run(`_adminOnglet='reglages';chargerPanneauAdmin();`); await attendre(30);
  await m2.run('reseau.enLigne=true;');
  inputReglage(ligneReglage(m2, 0)).value = '5';
  boutonReglage(ligneReglage(m2, 0)).onclick();
  await attendre(30);
  eq('l\'appel plante avec une VRAIE panne de réseau (TypeError « Failed to fetch ») : le téléphone se sait hors réseau ensuite', m2.run('reseau.enLigne'), false);
  m2.fin();
}

log('\n=== LE CODE : L\'ONGLET « RÉGLAGES » (étape 19) ===');
{
  const page = lire('index.html'), adm = lire('js/admin.js'), admR = lire('js/admin-reglages.js');
  vrai('la page charge admin-reglages.js juste après admin-vehicules.js, avant liste-arrets.js', page.indexOf('js/admin-vehicules.js') < page.indexOf('js/admin-reglages.js') && page.indexOf('js/admin-reglages.js') < page.indexOf('js/liste-arrets.js'));
  vrai('le nouvel onglet est enregistré dans ongletsAdmin(), avec repli sûr si le fichier n\'est pas encore chargé', /\{id:'reglages',icone:'🕒',label:'Réglages',titre:'Réglages',charger:\(typeof chargerReglagesAdmin==='function'\)\?chargerReglagesAdmin:null\}/.test(adm));
  vrai('l\'écran est GÉNÉRIQUE : aucun nom de réglage n\'est écrit en dur (un futur réglage ajouté par SQL apparaîtrait tout seul, sans changer ce fichier)', !/rappel_en_service_heures|suggestion_pause_heures|duree_max_quart_heures|duree_max_passe_heures|fin_equipe_apres_passe_heures|alerte_quart_termine_heures/.test(admR));
  vrai('seule « valeur » est écrite (jamais « cle » ni « description », non accordées en écriture par les règles d\'accès)', /db\.from\('reglages'\)\.update\(\{valeur:v\}\)/.test(admR) && !/update\(\{[^}]*cle:/.test(admR) && !/update\(\{[^}]*description:/.test(admR));
  vrai('aucune fonction serveur ici, aucun SQL requis : une écriture directe sur « reglages »', !/db\.functions\.invoke/.test(admR));
}

// ══════════════════════════════════════════════════════════════════════
// ÉTAPE 19 (SUITE) : L'ONGLET « SERVICES » (types de service, www/js/admin.js, admin-types-service.js, SQL 23)
// Un type de service = une ligne de « types_service » (nom, actif) : AUCUNE fonction serveur (comme les véhicules) — des
// écritures directes suffisent. stops.service reste un simple texte SANS lien (clé étrangère) vers cette table : renommer
// ou désactiver un type ne change jamais les arrêts déjà créés. On ne supprime donc jamais un type ici, seulement « Désactiver ».
// ══════════════════════════════════════════════════════════════════════
const TYPES_SERVICE = [
  { id: 'ts-1', nom: 'Déneigement mécanique', actif: true },
  { id: 'ts-2', nom: 'Engrais', actif: false },
];
const mondeTS = async (o = {}) => {
  const m = monde({ utilisateur: ADMIN19, typesService: TYPES_SERVICE.map((t) => ({ ...t })), ...o });
  await m.run('loadStops()');
  return m;
};
const ligneTS = (m, nom) => m.el('admin-body').children.find((c) => c.className === 'emp-item' && c.children[0].children[0].textContent === nom);
const boutonTS = (ligne, texte) => ligne.children[2].children.find((b) => b.textContent === texte);

log('\n=== L\'ONGLET « SERVICES » : LA LISTE ===');
{
  const m = await mondeTS();
  await m.run(`_adminOnglet='types-service';chargerPanneauAdmin();`); await attendre(30);
  vrai('la liste vient d\'une lecture DIRECTE de la table « types_service » (pas de fonction serveur)', m.appels.lectures.includes('types_service'));
  const c1 = ligneTS(m, 'Déneigement mécanique'), c2 = ligneTS(m, 'Engrais');
  vrai('un type actif : le badge « Actif »', !!c1 && c1.children[1].textContent === 'Actif' && c1.children[1].className === 'emp-badge actif');
  vrai('un type désactivé : le badge « Désactivé »', !!c2 && c2.children[1].textContent === 'Désactivé' && c2.children[1].className === 'emp-badge inactif');
  vrai('chaque type a deux boutons : Renommer, Désactiver/Réactiver (jamais Supprimer)', c1.children[2].children.map((b) => b.textContent).join('|') === '✏️ Renommer|Désactiver' && c2.children[2].children.map((b) => b.textContent).join('|') === '✏️ Renommer|Réactiver');
  vrai('le bouton « ＋ NOUVEAU TYPE DE SERVICE » est là, au-dessus de la liste', m.el('admin-body').children[0].children[0].textContent === '＋ NOUVEAU TYPE DE SERVICE');
  m.fin();
}
{
  const vide = await mondeTS({ typesService: [] });
  await vide.run(`_adminOnglet='types-service';chargerPanneauAdmin();`); await attendre(30);
  vrai('aucun type : « Aucun type de service. »', vide.el('admin-body').children[1].textContent === 'Aucun type de service.');
  vide.fin();
  const err = await mondeTS({ erreurLecture: ['types_service'] });
  await err.run(`_adminOnglet='types-service';chargerPanneauAdmin();`); await attendre(30);
  vrai('la liste ne peut pas être lue : message clair, jamais « Aucun type » (ce serait un mensonge)', err.el('admin-body').innerHTML.includes('❌ Impossible de charger les types de service') && !err.el('admin-body').innerHTML.includes('Aucun type'));
  err.fin();
  const planté = await mondeTS({ lectureLance: ['types_service'] });
  await planté.run(`_adminOnglet='types-service';chargerPanneauAdmin();`); await attendre(30);
  vrai('… même si l\'appel plante carrément (jamais de plantage de l\'écran)', planté.el('admin-body').innerHTML.includes('❌ Impossible de charger les types de service'));
  planté.fin();
}

log('\n=== « ＋ NOUVEAU TYPE DE SERVICE » ===');
{
  const ins = (v, d) => { d.types_service.push({ id: 'ts-nouveau', nom: v[0].nom, actif: true }); return { data: null, error: null }; };
  const m = await mondeTS({ ecritures: { 'types_service.insert': ins } });
  await m.run(`_adminOnglet='types-service';chargerPanneauAdmin();`); await attendre(30);
  m.el('admin-body').children[0].children[0].onclick();
  eq('le bouton ouvre la fenêtre en mode création : titre, bouton « Créer », champ vide', [m.el('nouveau-type-service-overlay').classList.contains('open'), m.el('nts-titre').textContent, m.el('nts-btn-save').textContent, m.el('nts-nom').value], [true, '＋ Nouveau type de service', 'Créer', '']);
  eq('toucher en dehors de la fenêtre la ferme', (m.run(`bgClickNTS({target:document.getElementById('nouveau-type-service-overlay')})`), m.el('nouveau-type-service-overlay').classList.contains('open')), false);
  await m.run('sauvegarderTypeService()');
  eq('sans nom : rien n\'est écrit, message clair', [m.dernierToast(), m.appels.ecritures.length], ['⚠ Entre un nom de type de service', 0]);
  m.el('nts-nom').value = '  Déglaçage  ';
  await m.run('sauvegarderTypeService()');
  eq('le nom est envoyé nettoyé (espaces autour retirés) : une CRÉATION', m.appels.ecritures[0], { table: 'types_service', op: 'insert', valeur: [{ nom: 'Déglaçage' }], filtres: undefined });
  eq('la fenêtre se ferme, message « créé », la liste relue le montre', [m.el('nouveau-type-service-overlay').classList.contains('open'), m.dernierToast(), !!ligneTS(m, 'Déglaçage')], [false, '✔ Type de service créé', true]);
  m.fin();
}

log('\n=== « RENOMMER » ET DÉSACTIVER/RÉACTIVER UN TYPE DE SERVICE ===');
{
  const upd = (v, d, f) => { Object.assign(d.types_service.find((x) => x.id === f[0][1]), v); return { data: null, error: null }; };
  const m = await mondeTS({ ecritures: { 'types_service.update': upd } });
  await m.run(`_adminOnglet='types-service';chargerPanneauAdmin();`); await attendre(30);
  boutonTS(ligneTS(m, 'Déneigement mécanique'), '✏️ Renommer').onclick();
  eq('« Renommer » ouvre la même fenêtre, pré-remplie avec le nom actuel, bouton « Enregistrer »', [m.el('nouveau-type-service-overlay').classList.contains('open'), m.el('nts-titre').textContent, m.el('nts-btn-save').textContent, m.el('nts-nom').value], [true, 'Renommer un type de service', 'Enregistrer', 'Déneigement mécanique']);
  m.el('nts-nom').value = 'Déneigement';
  await m.run('sauvegarderTypeService()');
  eq('l\'écriture est une MODIFICATION du bon type (jamais une nouvelle création)', m.appels.ecritures[0], { table: 'types_service', op: 'update', valeur: { nom: 'Déneigement' }, filtres: [['id', 'ts-1']] });
  m.run('ouvrirNouveauTypeService()');
  eq('rouvrir « ＋ Nouveau » ensuite repart bien en mode création (jamais coincé en renommage)', [m.el('nts-titre').textContent, m.el('nts-btn-save').textContent], ['＋ Nouveau type de service', 'Créer']);
  m.el('nts-nom').value = 'Toiture';
  await m.run('sauvegarderTypeService()');
  eq('… et « Créer » écrit vraiment une CRÉATION (pas un renommage du type ouvert juste avant)', m.appels.ecritures[1], { table: 'types_service', op: 'insert', valeur: [{ nom: 'Toiture' }], filtres: undefined });
  m.fin();
}
{
  const upd = (v, d, f) => { Object.assign(d.types_service.find((x) => x.id === f[0][1]), v); return { data: null, error: null }; };
  const m = await mondeTS({ confirme: true, ecritures: { 'types_service.update': upd } });
  await m.run(`_adminOnglet='types-service';chargerPanneauAdmin();`); await attendre(30);
  boutonTS(ligneTS(m, 'Déneigement mécanique'), 'Désactiver').onclick();
  await attendre(30);
  eq('désactiver demande UNE confirmation nommée, avec ce que ça change', m.appels.confirmations[0], ['Désactiver Déneigement mécanique ?', 'Il ne sera plus proposé pour un nouvel arrêt. Les arrêts déjà créés avec ce type ne changent pas.', 'Désactiver', 'Annuler']);
  eq('… puis écrit directement sur « types_service » (pas de fonction serveur), confirme, relit la liste', [m.appels.ecritures[0], m.dernierToast(), ligneTS(m, 'Déneigement mécanique').children[1].textContent], [{ table: 'types_service', op: 'update', valeur: { actif: false }, filtres: [['id', 'ts-1']] }, '✔ Déneigement mécanique est désactivé', 'Désactivé']);
  m.fin();
  const non = await mondeTS({ confirme: false });
  await non.run(`_adminOnglet='types-service';chargerPanneauAdmin();`); await attendre(30);
  boutonTS(ligneTS(non, 'Déneigement mécanique'), 'Désactiver').onclick();
  await attendre(30);
  eq('« Annuler » : RIEN n\'est écrit', non.appels.ecritures.length, 0);
  non.fin();
  const re = await mondeTS({ ecritures: { 'types_service.update': upd } });
  await re.run(`_adminOnglet='types-service';chargerPanneauAdmin();`); await attendre(30);
  boutonTS(ligneTS(re, 'Engrais'), 'Réactiver').onclick();
  await attendre(30);
  eq('réactiver ne demande AUCUNE confirmation (sans risque) : écriture directe, bon message', [re.appels.confirmations.length, re.appels.ecritures[0], re.dernierToast()], [0, { table: 'types_service', op: 'update', valeur: { actif: true }, filtres: [['id', 'ts-2']] }, '✔ Engrais est réactivé']);
  re.fin();
  const planté = await mondeTS({ ecritures: { 'types_service.update': () => { throw new TypeError('Failed to fetch'); } } });
  await planté.run(`_adminOnglet='types-service';chargerPanneauAdmin();`); await attendre(30);
  await planté.run('reseau.enLigne=true;');
  boutonTS(ligneTS(planté, 'Engrais'), 'Réactiver').onclick();
  await attendre(30);
  eq('désactiver/réactiver qui plante avec une VRAIE panne de réseau (TypeError « Failed to fetch ») : le téléphone se sait hors réseau ensuite', planté.run('reseau.enLigne'), false);
  planté.fin();
}

log('\n=== ERREURS (CRÉER / RENOMMER UN TYPE DE SERVICE) ===');
{
  const essai = async (rep) => {
    const m = await mondeTS({ ecritures: { 'types_service.insert': rep } });
    await m.run(`_adminOnglet='types-service';chargerPanneauAdmin();`); await attendre(30);
    m.run('ouvrirNouveauTypeService()');
    m.el('nts-nom').value = 'X';
    await m.run('sauvegarderTypeService()');
    const t = m.dernierToast(), ouverte = m.el('nouveau-type-service-overlay').classList.contains('open');
    m.fin();
    return { toast: t, ouverte };
  };
  eq('nom déjà utilisé (contrainte unique) : message clair, la fenêtre RESTE ouverte', await essai({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }), { toast: '❌ Ce nom de type de service existe déjà.', ouverte: true });
  eq('pas de réseau (message du serveur) : message clair', await essai({ data: null, error: { message: 'Failed to fetch' } }), { toast: '📴 Pas de réseau : rien n’a été changé.', ouverte: true });
  eq('une autre erreur du serveur : son message tel quel', await essai({ data: null, error: { message: 'permission denied for table types_service' } }), { toast: '❌ permission denied for table types_service', ouverte: true });
  const m2 = await mondeTS({ ecritures: { 'types_service.insert': () => { throw new TypeError('Failed to fetch'); } } });
  await m2.run(`_adminOnglet='types-service';chargerPanneauAdmin();`); await attendre(30);
  await m2.run('reseau.enLigne=true;');
  m2.run('ouvrirNouveauTypeService()');
  m2.el('nts-nom').value = 'X';
  await m2.run('sauvegarderTypeService()');
  eq('l\'appel plante avec une VRAIE panne de réseau (TypeError « Failed to fetch ») : le téléphone se sait hors réseau ensuite', m2.run('reseau.enLigne'), false);
  m2.fin();
}

log('\n=== LE CODE : L\'ONGLET « SERVICES » (étape 19) ===');
{
  const page = lire('index.html'), css = lire('css/style.css'), adm = lire('js/admin.js'), admTS = lire('js/admin-types-service.js');
  vrai('la page charge admin-types-service.js juste après admin-reglages.js, avant liste-arrets.js', page.indexOf('js/admin-reglages.js') < page.indexOf('js/admin-types-service.js') && page.indexOf('js/admin-types-service.js') < page.indexOf('js/liste-arrets.js'));
  vrai('la fenêtre « Nouveau type de service » est dans la page, et se ferme au toucher en dehors, comme les autres', page.includes('id="nouveau-type-service-overlay"') && /onclick="bgClickNTS\(event\)"/.test(page));
  vrai('… et respecte la zone sûre d\'un iPhone (comme les autres fenêtres qui montent du bas)', /#nouveau-type-service-overlay\{display:none;position:fixed;inset:0;[^}]*align-items:flex-end;\}/.test(css) && css.includes('#nouveau-vehicule-overlay,#nouveau-type-service-overlay,#prob-overlay'));
  vrai('le nouvel onglet est enregistré dans ongletsAdmin(), avec repli sûr si le fichier n\'est pas encore chargé', /\{id:'types-service',icone:'🧰',label:'Services',titre:'Types de service',charger:\(typeof chargerTypesServiceAdmin==='function'\)\?chargerTypesServiceAdmin:null\}/.test(adm));
  vrai('un type de service ne se supprime JAMAIS ici (les arrêts déjà créés ne doivent pas perdre leur texte) : seulement créer, renommer, désactiver/réactiver', !/db\.from\('types_service'\)\.delete\(\)/.test(admTS) && /db\.from\('types_service'\)\.insert/.test(admTS) && /db\.from\('types_service'\)\.update\(\{nom\}\)/.test(admTS) && /db\.from\('types_service'\)\.update\(\{actif\}\)/.test(admTS));
  vrai('aucune fonction serveur ici : des écritures directes sur « types_service » (comme les véhicules)', !/db\.functions\.invoke/.test(admTS));
  vrai('après avoir créé ou renommé un type, le menu déroulant « ＋ Nouveau stop » est aussi rafraîchi tout de suite', /await chargerTypesService\(\);/.test(admTS));
  vrai('le style : les mêmes badges actif/inactif que les employés/véhicules sont réutilisés (pas de nouvelle classe CSS dupliquée)', !/\.svc-/.test(css) && !/\.ts-item/.test(css));
}

log('\n=== LE MENU « TYPE DE SERVICE » DE « ＋ NOUVEAU STOP » VIENT DE « types_service » (étape 19) ===');
{
  // (le faux serveur ne filtre pas vraiment .eq() : on vérifie SÉPARÉMENT que le filtre est bien demandé, et qu'une réponse déjà filtrée est bien lue)
  const actifs = [{ id: 't1', nom: 'Coupe de gazon', actif: true }, { id: 't2', nom: 'Déneigement mécanique', actif: true }];
  const m = monde({ typesService: actifs });
  await m.run('loadStops()');
  vrai('la lecture demande bien SEULEMENT les types actifs (actif=true)', m.appels.eq.some((e) => e[0] === 'types_service' && e[1] === 'actif' && e[2] === true));
  eq('au chargement, les types actifs sont installés pour le menu', m.run('typesServiceActifs'), ['Coupe de gazon', 'Déneigement mécanique']);
  m.run('openModal()');
  eq('ouvrir « ＋ Nouveau stop » remplit le menu déroulant avec ces types (jamais le type désactivé)', m.el('f-svc').children.map((o) => o.value), ['Coupe de gazon', 'Déneigement mécanique']);
  m.fin();
}
{
  // Le filet : la table est illisible (pas de réseau, ou le SQL 23 pas encore exécuté) -> le menu garde les 8 options d'avant l'étape 19
  const m = monde({ erreurLecture: ['types_service'] });
  await m.run('loadStops()');
  eq('table illisible : le filet (les 8 anciennes options) est utilisé, rien ne casse', m.run('typesServiceActifs'), []);
  m.run('openModal()');
  eq('… le menu déroulant reste utilisable (les 8 options d\'avant l\'étape 19)', m.el('f-svc').children.map((o) => o.value), ['Déneigement mécanique', 'Déneigement manuel', 'Épandage de sel', 'Entretien paysager', 'Coupe de gazon', 'Engrais', 'Ramassage de feuilles', 'Autre']);
  m.fin();
}
{
  // Rouvrir « ＋ Nouveau stop » garde le choix déjà fait s'il existe toujours dans la liste rafraîchie
  const m = monde({ typesService: [{ id: 't1', nom: 'Coupe de gazon', actif: true }, { id: 't2', nom: 'Engrais', actif: true }] });
  await m.run('loadStops()');
  m.run('openModal()');
  m.el('f-svc').value = 'Engrais';
  m.run('remplirTypesService()');
  eq('re-remplir le menu GARDE le choix déjà fait (s\'il est toujours dans la liste)', m.el('f-svc').value, 'Engrais');
  m.fin();
}

log('\n=== LES CAMIONS SUR LA CARTE, AVEC LEUR ÉQUIPAGE (étape 13f) ===');
{
  const il = (min) => new Date(Date.now() - min * 60000).toISOString();
  const posv = (passe, lat, lon, min = 0.2) => ({ passe_id: passe, lat, lon, precision_m: 8, maj_le: il(min) });
  const equipes = [{ id: 'e1', nom: 'Camion 1' }, { id: 'e2', nom: 'Camion 2' }, { id: 'e3', nom: 'Camion sel' }];
  const eqp = (passe, role, id, nom) => ({ passe_id: passe, role, utilisateur_id: id, utilisateurs: nom === null ? null : { nom } });
  const equipages = [eqp('p-luc', 'passager', 'u-2', 'Lionel'), eqp('p-luc', 'chauffeur', 'u-luc', 'Luc'), eqp('p-luc', 'passager', 'u-3', 'Éric'), eqp('p-marc', 'chauffeur', 'u-marc', 'Marc'), eqp('p-gaby', 'chauffeur', 'u-gaby', 'Ghislain')];
  const trois = () => [posv('p-luc', 46.443, -72.922), posv('p-marc', 46.441, -72.92), posv('p-gaby', 46.444, -72.919)];
  const cas = async (o = {}) => { const m = monde({ equipes, equipages, ...o }); await m.run('loadStops()'); return m; };
  const html = (mk) => mk.opt.icon.html;
  const camionDe = (m, nom) => m.camions.filter((c) => c.popup && c.popup.includes(nom)).pop();

  let m = await cas({ positions: trois() });
  eq('les noms des véhicules et les équipages sont lus (colonnes nommées ; la PERSONNE à bord, pas celui qui l\'a ajoutée ; seulement les périodes ouvertes)',
    [m.appels.selects.find((x) => x[0] === 'equipes')[1], m.appels.selects.find((x) => x[0] === 'equipage_periodes')[1], m.appels.is.some((x) => x[0] === 'equipage_periodes' && x[1] === 'fin' && x[2] === null)],
    ['id, nom', 'passe_id, role, utilisateur_id, utilisateurs!utilisateur_id(nom)', true]);
  eq('UN point par camion : 3 camions avec une position = 3 marqueurs', m.camions.length, 3);
  const luc = camionDe(m, 'Camion 1');
  vrai('le pourcentage du camion (33 %) est écrit sur son étiquette, visible par tout le monde (étape 14b)', html(luc).includes('<strong>33 %</strong>'), html(luc));
  vrai('le point de Camion 1 : son nom et « 👤 3 » (Luc, Lionel, Éric)', html(luc).includes('Camion 1') && html(luc).includes('👤 3') && !html(luc).includes('perime'), html(luc));
  vrai('la bulle : passe, tâche, avancement, chauffeur, personnes à bord (le chauffeur d\'abord, les autres par ordre alphabétique), position récente',
    luc.popup.includes('Passe n° 1 · Déneigement mécanique') && luc.popup.includes('1/3 (33 %)') && luc.popup.includes('Chauffeur : Luc') && luc.popup.includes('À bord : Éric, Lionel') && luc.popup.includes('position à l’instant'), luc.popup);
  vrai('un camion sans passager : « personne d’autre »', camionDe(m, 'Camion 2').popup.includes('À bord : personne d’autre'), camionDe(m, 'Camion 2').popup);
  vrai('le camion de sel a son propre tour (passe n° 2)', camionDe(m, 'Camion sel').popup.includes('Passe n° 2 · Épandage de sel'), camionDe(m, 'Camion sel').popup);
  eq('le point est bien à la position envoyée par le téléphone du chauffeur', luc.ll, [46.443, -72.922]);

  m = await cas({ positions: [posv('p-luc', 46.443, -72.922)] });
  eq('un camion SANS position n\'a pas de point (Marc et Ghislain : rien)', m.camions.length, 1);
  m = await cas({ positions: trois(), equipes: [] });
  vrai('nom de véhicule inconnu : « Camion » (jamais « undefined »)', m.camions.every((c) => c.popup.includes('<b>🚜 Camion</b>')) && !m.camions.some((c) => c.popup.includes('undefined')), m.camions[0].popup);

  // — Une route ou toutes les routes ensemble —
  m = await cas({ positions: trois() });
  const n = () => m.run('Object.keys(marqueursVehicules).length');
  m.routeActive(SE); m.run('majVehicules()');
  eq('route Saint-étienne choisie : aucun camion de Charette à l\'écran (ils sont retirés)', [n(), m.retires.filter((x) => x.popup).length], [0, 3]);
  m.routeActive(CH); m.run('majVehicules()');
  eq('route Charette : les 3 camions reviennent', n(), 3);
  m.routeActive(null); m.run('majVehicules()');
  eq('toutes les routes : les 3 camions', n(), 3);

  // — Position ancienne, position qui bouge, camion qui disparaît —
  m = await cas({ positions: [posv('p-luc', 46.443, -72.922, 4)] });
  vrai('position vieille de 4 minutes : le camion reste affiché mais ATTÉNUÉ, avec « ⚠ position il y a 4 min »', html(m.camions[0]).includes('camion perime') && m.camions[0].popup.includes('⚠ position il y a 4 min'), html(m.camions[0]) + m.camions[0].popup);
  m = await cas({ positions: [posv('p-luc', 46.443, -72.922)] });
  const avant = m.camions.length; m.donnees.positions = [posv('p-luc', 46.4431, -72.9221)];
  await m.run('rafraichirEnCours()');
  eq('le camion se DÉPLACE (même marqueur, pas de doublon)', [m.camions.length - avant, m.camions[0].deplacements, m.camions[0].ll], [0, 1, [46.4431, -72.9221]]);
  m.donnees.positions = []; await m.run('rafraichirEnCours()');
  eq('plus de position (passe terminée : le serveur l\'efface) : le point disparaît', [m.run('Object.keys(marqueursVehicules).length'), m.retires.filter((x) => x.popup).length], [0, 1]);

  // — Texte piégé —
  m = await cas({ positions: [posv('p-luc', 46.443, -72.922)], equipes: [{ id: 'e1', nom: '<img src=x onerror=alert(1)>' }], equipages: [eqp('p-luc', 'chauffeur', 'u-luc', '<b>Luc</b>'), eqp('p-luc', 'passager', 'u-9', null)] });
  vrai('noms piégés (camion, personne) affichés comme du TEXTE ; une personne sans nom lisible : « ? »',
    !html(m.camions[0]).includes('<img') && !m.camions[0].popup.includes('<img') && m.camions[0].popup.includes('&lt;b&gt;Luc&lt;/b&gt;') && m.camions[0].popup.includes('À bord : ?'), m.camions[0].popup);

  // — Temps réel : l'équipage change —
  m = await cas({ positions: trois() });
  const lE = () => m.appels.lectures.filter((t) => t === 'equipage_periodes').length, lP = () => m.appels.lectures.filter((t) => t === 'positions').length, tr = () => m.appels.rpc.filter((r) => r.nom === 'tours_en_cours').length;
  const e0 = lE(), p0 = lP(), t0 = tr();
  m.donnees.equipage_periodes.push(eqp('p-marc', 'passager', 'u-9', 'Nouvel arrivant'));
  for (let i = 0; i < 5; i++) m.run('planifierRechargementEquipages()');
  await attendre(120); eq('5 changements d\'équipage d\'un coup : pas encore relu', lE(), e0);
  await attendre(400);
  eq('… puis relu UNE seule fois (sans relire les positions ni les tours)', [lE() - e0, lP() - p0, tr() - t0], [1, 0, 0]);
  vrai('… et la bulle du camion de Marc montre la nouvelle personne à bord', camionDe(m, 'Camion 2').popup.includes('À bord : Nouvel arrivant') && html(camionDe(m, 'Camion 2')).includes('👤 2'), camionDe(m, 'Camion 2').popup);
  m.run('currentUser = null'); const e1 = lE(); m.run('planifierRechargementEquipages()'); await attendre(450);
  eq('personne de connecté : aucune lecture', lE(), e1);
  m.run('currentUser = { id: "u-luc", nom: "Luc", role: "employe" }');
  const e2 = lE(); for (let i = 0; i < 4; i++) await m.run('rafraichirEnCours()');
  eq('la relecture de secours relit aussi les équipages, une fois sur quatre (environ chaque minute)', lE() - e2, 1);

  // — Réseau coupé —
  m = await cas({ positions: trois() });
  m.run('__dbOk2 = db; db = { rpc: __fauxDb.rpc, from: () => { throw new Error("Failed to fetch"); } }');
  eq('réseau coupé : la lecture échoue SANS effacer les équipages connus', [await m.run('chargerVehiculesEtEquipages()'), m.run('Object.keys(equipages).length'), m.run('Object.keys(nomsVehicules).length')], [false, 3, 3]);
  m.run('db = __fauxDb');
  m = await cas({ positions: trois(), erreurLecture: ['equipage_periodes'] });
  eq('erreur du serveur : idem, les camions restent affichés (avec un équipage vide)', [m.camions.length, m.run('Object.keys(equipages).length')], [3, 0]);
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

// ══════════════════════════════════════════════════════════════════════
// ÉTAPE 18b : L'ORDRE DES CLIENTS, LE PROCHAIN CLIENT, LE PARCOURS DANS GOOGLE MAPS (www/js/ordre.js)
// Demande de Joé (21 sept.) : « appuyer sur le nombre de clients pour voir la liste que je pourrais placer selon un ordre précis » ; seul l'administrateur change l'ordre ;
// la navigation reste Google Maps.
// ══════════════════════════════════════════════════════════════════════
const ADMIN = { id: 'u-joe', nom: 'Joé', role: 'admin' };
const sansMaPasse = () => TOURS().map((t) => ({ ...t, passes: t.passes.map((x) => ({ ...x, je_suis_chauffeur: false, je_suis_a_bord: false })) }));
const adresses = (m) => m.elementsListe().map((d) => (d.innerHTML.match(/ci-addr [^>]*>([^<]*)</) || [])[1]);   // les adresses, dans l'ordre où la liste les affiche
const misesAJourOrdre = (m) => m.appels.ecritures.filter((e) => e.table === 'stops' && e.op === 'update').map((e) => [e.filtres[0][1], e.valeur.ordre]).sort();
const stopsAvec = (ordres) => STOPS.map((s) => ({ ...s, ordre: ordres[s.id] ?? s.ordre }));

log('\n=== L\'ORDRE DES CLIENTS : TRIER PAR « ORDRE » ===');
{
  const m = monde(); await m.run('loadStops()');
  eq('enOrdre trie par « ordre » ; à égalité (ou sans ordre), l\'ordre de départ est gardé', m.run("enOrdre([{id:'a',ordre:2},{id:'b',ordre:0},{id:'c',ordre:0},{id:'d'}]).map(s=>s.id)"), ['b', 'c', 'd', 'a']);
  eq('une valeur d\'ordre illisible compte pour 0 (jamais de plantage)', [m.run("valeurOrdre({ordre:'x'})"), m.run('valeurOrdre(null)'), m.run("valeurOrdre({ordre:'4'})")], [0, 0, 4]);
  m.fin();
}

log('\n=== LE PROCHAIN CLIENT DE MA PASSE ===');
{
  const m = monde(); await m.run('loadStops()');
  eq('Luc conduit le tour de déneigement de Charette, l\'arrêt s1 est fait : le prochain est s2', m.run('prochainArret().id'), 's2');
  eq('les clients restants de sa passe, dans l\'ordre (s2, s3 : pas s4, qui est du sel)', m.run('clientsRestants().map(s=>s.id)'), ['s2', 's3']);
  m.fin();
  const t = monde({ stops: stopsAvec({ s2: 9, s3: 1 }) }); await t.run('loadStops()');
  eq('l\'ORDRE décide : s3 (ordre 1) passe avant s2 (ordre 9)', t.run('prochainArret().id'), 's3');
  t.fin();
  const g = monde({ stops: STOPS.map((s) => (s.id === 's2' ? { ...s, lat: null, lon: null } : { ...s })) }); await g.run('loadStops()');
  eq('un client sans position sur la carte est laissé de côté', g.run('prochainArret().id'), 's3');
  g.fin();
  const f = monde({ tours: TOURS().map((t2) => (t2.tache === MEC ? { ...t2, faits: 3, pourcentage: 100, arrets_faits: ['s1', 's2', 's3'] } : t2)) }); await f.run('loadStops()');
  eq('tous les clients de la passe sont faits : plus de prochain client', [f.run('prochainArret()'), f.run('clientsRestants().length')], [null, 0]);
  f.fin();
  const p = monde({ tours: TOURS().map((t2) => ({ ...t2, passes: t2.passes.map((x) => ({ ...x, je_suis_chauffeur: false, je_suis_a_bord: x.passe_id === 'p-marc' })) })) }); await p.run('loadStops()');
  eq('un PASSAGER du camion de Marc voit le même prochain client (celui de la passe où il est à bord)', p.run('prochainArret().id'), 's2');
  p.fin();
  const a = monde({ utilisateur: ADMIN, tours: sansMaPasse() }); await a.run('loadStops()');
  eq('sans passe (conduite ou à bord) : aucun prochain client', [a.run('prochainArret()'), a.run('urlParcoursGoogle()')], [null, null]);
  a.fin();
}

log('\n=== LE PROCHAIN CLIENT S\'AFFICHE : BANDEAU, MARQUEUR, LISTE ===');
{
  const m = monde(); await m.run('loadStops()');
  const h = m.el('passe-bandeau').innerHTML;
  vrai('le bandeau : « ▶ » suivi de l\'adresse du prochain client, en bouton relié à ouvrirProchain(event)', /<button type="button" class="passe-prochain" onclick="ouvrirProchain\(event\)">▶ 220 rue du Moulin<\/button>/.test(h), h);
  vrai('… les autres lignes du bandeau sont toujours là (camion, avancement, passe, route, tâche)', h.includes('Passe n° 1 · Charette · ' + MEC) && h.includes('1/3'), h);
  eq('le marqueur du prochain client est plus gros (24) et cerclé de blanc ; les autres gardent leur taille', [m.marqueurs[1].opt.icon.iconSize, m.marqueurs[1].opt.icon.html.includes('border:3px solid #fff'), m.marqueurs[2].opt.icon.iconSize, m.marqueurs[0].opt.icon.iconSize], [[24, 24], true, [18, 18], [14, 14]]);
  eq('… et sa couleur suit la règle unique (jaune : pas encore fait)', m.couleur(m.marqueurs[1]), '#c8e63c');
  m.run('ouvrirProchain({stopPropagation(){globalThis.__ar=(globalThis.__ar||0)+1;}})');
  eq('toucher le prochain client ouvre sa fiche (s2) ; le toucher ne réduit pas le bandeau (stopPropagation)', [m.run('activeIdx'), m.el('stop-card').classList.contains('open'), m.run('globalThis.__ar')], [idx('s2'), true, 1]);
  m.fin();
  const f = monde({ tours: TOURS().map((t2) => (t2.tache === MEC ? { ...t2, faits: 3, pourcentage: 100, arrets_faits: ['s1', 's2', 's3'] } : t2)) }); await f.run('loadStops()');
  vrai('100 % : « ✔ Tous les clients sont faits » (pas de bouton)', f.el('passe-bandeau').innerHTML.includes('✔ Tous les clients sont faits') && !f.el('passe-bandeau').innerHTML.includes('passe-prochain"'), f.el('passe-bandeau').innerHTML);
  f.fin();
}
{
  const l = monde(); await l.run('loadStops()'); l.routeActive(CH); await l.run('renderListe()');
  eq('la liste : les clients à faire dans l\'ordre, puis le fait ; le premier à faire est marqué « ▶ PROCHAIN »', [adresses(l).slice(0, 3), l.elementsListe()[0].innerHTML.includes('▶ PROCHAIN'), l.elementsListe()[0].className.includes('ci-prochain')], [['220 rue du Moulin', '50 rue Notre-Dame', '215 rue Bellerive'], true, true]);
  vrai('un employé ne voit AUCUNE flèche pour changer l\'ordre', !l.elementsListe().some((d) => d.innerHTML.includes('ci-mv')));
  l.fin();
  const o = monde({ stops: stopsAvec({ s2: 9, s3: 1 }) }); await o.run('loadStops()'); o.routeActive(CH); await o.run('renderListe()');
  eq('la liste suit « ordre » (s3 = 1, s4 = 3, s2 = 9) et non l\'ordre de lecture', adresses(o).slice(0, 3), ['50 rue Notre-Dame', '215 rue Bellerive', '220 rue du Moulin']);
  o.fin();
}

log('\n=== L\'ADMINISTRATEUR CHANGE L\'ORDRE (▲ ▼) ===');
{
  const a = monde({ utilisateur: ADMIN, tours: sansMaPasse() }); await a.run('loadStops()'); a.routeActive(CH); await a.run('renderListe()');
  const rangs = a.elementsListe();
  vrai('l\'administrateur, route choisie : des flèches ▲ ▼ sur chaque client À FAIRE (3), aucune sur le client fait', rangs.slice(0, 3).every((d) => d.innerHTML.includes('ci-mv')) && !rangs[3].innerHTML.includes('ci-mv'), rangs.map((d) => d.innerHTML.includes('ci-mv')).join());
  vrai('… ▲ est grisé pour le premier, ▼ pour le dernier client à faire', /aria-label="Plus tôt dans l’ordre" disabled/.test(rangs[0].innerHTML) && !/aria-label="Plus tard dans l’ordre" disabled/.test(rangs[0].innerHTML) && /aria-label="Plus tard dans l’ordre" disabled/.test(rangs[2].innerHTML) && !/aria-label="Plus tôt dans l’ordre" disabled/.test(rangs[2].innerHTML));
  vrai('… sans passe à lui, aucun « prochain » : tous « À FAIRE »', rangs.slice(0, 3).every((d) => d.innerHTML.includes('À FAIRE')) && !rangs.some((d) => d.innerHTML.includes('PROCHAIN')));
  a.routeActive(null); await a.run('renderListe()');
  vrai('« toutes les routes » : aucune flèche (l\'ordre est propre à UNE route)', !a.elementsListe().some((d) => d.innerHTML.includes('ci-mv')));
  a.fin();
  const j = monde({ utilisateur: { id: 'u-luc', nom: 'Luc', role: 'employe' } }); await j.run('loadStops()'); j.routeActive(CH);
  await j.run(`deplacerArret(null,${idx('s3')},-1)`);
  eq('un employé qui appellerait quand même deplacerArret : rien n\'est écrit, rien ne change', [misesAJourOrdre(j), j.run('stops[' + idx('s3') + '].ordre')], [[], 2]);
  j.fin();
}
{
  const m = monde({ utilisateur: ADMIN, tours: sansMaPasse() }); await m.run('loadStops()'); m.routeActive(CH);
  await m.run(`deplacerArret({stopPropagation(){}},${idx('s3')},-1)`);
  eq('s3 monte : s3 et s2 ÉCHANGENT leurs valeurs d\'ordre (DEUX lignes seulement : s2 = 2, s3 = 1)', misesAJourOrdre(m), [['s2', 2], ['s3', 1]]);
  eq('… la liste montre le nouvel ordre tout de suite (s3, s2, s4) et les valeurs locales sont à jour', [(await m.run('renderListe()'), adresses(m).slice(0, 3)), m.run('stops[' + idx('s3') + '].ordre'), m.run('stops[' + idx('s2') + '].ordre')], [['50 rue Notre-Dame', '220 rue du Moulin', '215 rue Bellerive'], 1, 2]);
  eq('… aucune erreur, aucun message', [m.appels.toasts.length, m.run('_deplacementEnCours')], [0, false]);
  const avant = m.appels.ecritures.length;
  await m.run(`deplacerArret(null,${idx('s3')},-1)`);
  eq('le premier client à faire ne peut pas monter (rien n\'est écrit)', m.appels.ecritures.length, avant);
  await m.run(`deplacerArret(null,${idx('s4')},1)`);
  eq('le dernier client à faire ne peut pas descendre (rien n\'est écrit)', m.appels.ecritures.length, avant);
  await m.run(`deplacerArret(null,${idx('s1')},1)`);
  eq('un client déjà FAIT ne se déplace pas (rien n\'est écrit)', m.appels.ecritures.length, avant);
  m.fin();
}
{
  // Deux clients de même ordre (rare) : la route est renumérotée, mais seules les lignes qui changent sont écrites
  const m = monde({ utilisateur: ADMIN, tours: sansMaPasse(), stops: stopsAvec({ s3: 1 }) }); await m.run('loadStops()'); m.routeActive(CH);
  await m.run(`deplacerArret(null,${idx('s3')},-1)`);
  eq('s2 et s3 avaient le MÊME ordre (1) : s3 monte quand même, une seule ligne est écrite (s2 = 2)', [misesAJourOrdre(m), m.run('enOrdre(stops.filter(s=>s.route_id===' + JSON.stringify(CH) + ').filter(s=>!estFait(s))).map(s=>s.id)')], [[['s2', 2]], ['s3', 's2', 's4']]);
  m.fin();
}
{
  // Deux touchers rapprochés : un seul déplacement à la fois
  const m = monde({ utilisateur: ADMIN, tours: sansMaPasse(), ecritures: { 'stops.update': () => new Promise((r) => setTimeout(() => r({ data: null, error: null }), 80)) } }); await m.run('loadStops()'); m.routeActive(CH);
  const a = m.run(`deplacerArret(null,${idx('s3')},-1)`), b = m.run(`deplacerArret(null,${idx('s4')},-1)`);
  await Promise.all([a, b]);
  eq('deux touchers rapprochés : UN seul déplacement (deux lignes écrites, pas quatre)', misesAJourOrdre(m).length, 2);
  m.fin();
}
{
  // Le serveur refuse, ou le signal disparaît : l'ordre n'est pas gardé en silence
  const r = monde({ utilisateur: ADMIN, tours: sansMaPasse(), ecritures: { 'stops.update': { data: null, error: { message: 'permission denied' } } } }); await r.run('loadStops()'); r.routeActive(CH);
  const lecturesAvant = r.appels.lectures.filter((x) => x === 'stops').length;
  await r.run(`deplacerArret(null,${idx('s3')},-1)`);
  eq('le serveur REFUSE : message d\'erreur, l\'ordre est RELU (le serveur a le dernier mot) : s2 reste avant s3', [r.dernierToast(), r.appels.lectures.filter((x) => x === 'stops').length - lecturesAvant, r.run('stops[' + idx('s3') + '].ordre'), r.run('_deplacementEnCours')], ['❌ L’ordre n’a pas pu être enregistré.', 1, 2, false]);
  r.fin();
  const s = monde({ utilisateur: ADMIN, tours: sansMaPasse(), ecritures: { 'stops.update': { data: null, error: { message: 'Failed to fetch' } } } }); await s.run('loadStops()'); s.routeActive(CH);
  await s.run(`deplacerArret(null,${idx('s3')},-1)`);
  eq('le signal disparaît PENDANT l\'écriture : le dit et relit l\'ordre (s2 reste avant s3)', [s.dernierToast(), s.run('stops[' + idx('s3') + '].ordre')], ['📴 Le signal a disparu : l’ordre n’a pas été enregistré.', 2]);
  s.fin();
  const h = monde({ utilisateur: ADMIN, tours: sansMaPasse() }); await h.run('loadStops()'); h.routeActive(CH); h.run('reseau.enLigne=false');
  await h.run(`deplacerArret(null,${idx('s3')},-1)`);
  eq('sans réseau : « pas de réseau », RIEN n\'est changé ni écrit (un changement d\'ordre n\'est pas gardé pour plus tard)', [h.dernierToast(), misesAJourOrdre(h), h.run('stops[' + idx('s3') + '].ordre')], ['📴 Pas de réseau : l’ordre ne peut pas être changé maintenant.', [], 2]);
  h.fin();
}

log('\n=== LES VRAIES FLÈCHES ▲ ▼, ET TOUT SE REDESSINE APRÈS UN DÉPLACEMENT ===');
{
  // On lit ce que CHAQUE bouton de la liste ferait au toucher (l'attribut onclick), puis on le lance : ▲ doit monter, ▼ doit descendre
  const a = monde({ utilisateur: ADMIN, tours: sansMaPasse() }); await a.run('loadStops()'); a.routeActive(CH); await a.run('renderListe()');
  const rang = (m, id) => m.elementsListe()[adresses(m).indexOf(STOPS[idx(id)].adresse)].innerHTML;
  const appelDe = (html, etiquette) => (html.match(new RegExp('aria-label="' + etiquette + '"[^>]*onclick="(deplacerArret\\(event,\\d+,-?1\\))"')) || [])[1];
  const haut = appelDe(rang(a, 's4'), 'Plus tôt dans l’ordre'), bas = appelDe(rang(a, 's2'), 'Plus tard dans l’ordre');
  eq('▲ du client s4 appelle deplacerArret(s4, -1) ; ▼ du client s2 appelle deplacerArret(s2, 1)', [haut, bas], [`deplacerArret(event,${idx('s4')},-1)`, `deplacerArret(event,${idx('s2')},1)`]);
  await a.run(haut.replace('event', 'null'));
  eq('toucher ▲ sur s4 : s4 passe avant s3 (s3 = 3, s4 = 2)', misesAJourOrdre(a), [['s3', 3], ['s4', 2]]);
  a.fin();
  const b = monde({ utilisateur: ADMIN, tours: sansMaPasse() }); await b.run('loadStops()'); b.routeActive(CH); await b.run('renderListe()');
  await b.run(appelDe(rang(b, 's2'), 'Plus tard dans l’ordre').replace('event', 'null'));
  eq('toucher ▼ sur s2 : s2 passe après s3 (s2 = 2, s3 = 1)', misesAJourOrdre(b), [['s2', 2], ['s3', 1]]);
  b.fin();
}
{
  // L'administrateur conduit aussi un camion : après un déplacement, la liste OUVERTE, la carte et le bandeau montrent le nouvel ordre sans rien toucher d'autre
  const m = monde({ utilisateur: ADMIN }); await m.run('loadStops()'); m.routeActive(CH); await m.run('openListe()');
  vrai('au départ : la liste ouverte commence par s2 (le prochain client)', adresses(m)[0] === '220 rue du Moulin', adresses(m).join(' | '));
  const avant = m.marqueurs.length;
  await m.run(`deplacerArret(null,${idx('s3')},-1)`);
  const neufs = m.marqueurs.slice(avant), gros = neufs.filter((x) => x.opt.icon.html.includes('border:3px solid #fff'));
  eq('la CARTE est redessinée : le marqueur cerclé de blanc est maintenant celui de s3 (le nouveau prochain client)', [neufs.length > 0, gros.length, gros[0] && gros[0].ll], [true, 1, [STOPS[idx('s3')].lat, STOPS[idx('s3')].lon]]);
  eq('la LISTE ouverte est redessinée : s3 en premier, marqué « ▶ PROCHAIN »', [adresses(m).slice(0, 2), m.elementsListe()[0].innerHTML.includes('▶ PROCHAIN')], [['50 rue Notre-Dame', '220 rue du Moulin'], true]);
  vrai('le BANDEAU montre le nouveau prochain client (s3)', m.el('passe-bandeau').innerHTML.includes('▶ 50 rue Notre-Dame'), m.el('passe-bandeau').innerHTML);
  m.fin();
  const f = monde({ utilisateur: ADMIN }); await f.run('loadStops()'); f.routeActive(CH);
  await f.run(`deplacerArret(null,${idx('s3')},-1)`);
  vrai('la liste FERMÉE n\'est pas redessinée pour rien (elle se dessine à l\'ouverture)', f.el('liste-body').children.length === 0);
  f.fin();
}
{
  // Les clients FAITS suivent eux aussi l'ordre de la route (s2 = 0 passe avant s1 = 5)
  const d = monde({ stops: stopsAvec({ s1: 5, s2: 0 }), tours: TOURS().map((t2) => (t2.tache === MEC ? { ...t2, faits: 2, pourcentage: 66, arrets_faits: ['s1', 's2'] } : t2)) }); await d.run('loadStops()'); d.routeActive(CH); await d.run('renderListe()');
  eq('les clients à faire (s3, s4) puis les FAITS dans l\'ordre de la route : s2 (ordre 0) avant s1 (ordre 5)', [adresses(d).slice(0, 3), adresses(d)[3].includes('Église')], [['50 rue Notre-Dame', '215 rue Bellerive', '220 rue du Moulin'], true]);
  d.fin();
}

log('\n=== LE PARCOURS DANS GOOGLE MAPS (les clients restants, dans l\'ordre, un seul lien) ===');
{
  const m = monde(); await m.run('loadStops()');
  const u = m.run('urlParcoursGoogle()');
  eq('Luc : reste s2 puis s3 : arrivée = s3, étape = s2, en voiture, SANS point de départ (Google prend la position du téléphone)', u, 'https://www.google.com/maps/dir/?api=1&destination=46.439,-72.926&waypoints=46.443%2C-72.922&travelmode=driving');
  vrai('… pas de « origin= » dans le lien', !u.includes('origin='));
  m.routeActive(CH); await m.run('renderListe()');
  vrai('la liste offre le bouton « 🧭 Parcours dans Google Maps · 2 clients », relié à ouvrirParcoursGoogle()', /<button type="button" class="lf-btn parcours" onclick="ouvrirParcoursGoogle\(\)">🧭 Parcours dans Google Maps · 2 clients<\/button>/.test(m.el('liste-parcours').innerHTML), m.el('liste-parcours').innerHTML);
  await m.run('ouvrirParcoursGoogle()');
  eq('le bouton ouvre ce lien dans un nouvel onglet', m.appels.ouverts, [u]);
  m.fin();
  const un = monde({ tours: TOURS().map((t2) => (t2.tache === MEC ? { ...t2, faits: 2, pourcentage: 66, arrets_faits: ['s1', 's2'] } : t2)) }); await un.run('loadStops()');
  eq('un seul client restant : arrivée seulement, aucune étape (« waypoints » absent)', un.run('urlParcoursGoogle()'), 'https://www.google.com/maps/dir/?api=1&destination=46.439,-72.926&travelmode=driving');
  un.routeActive(CH); await un.run('renderListe()');
  vrai('… « 1 client » au singulier', un.el('liste-parcours').innerHTML.includes('· 1 client<'), un.el('liste-parcours').innerHTML);
  un.fin();
  const a = monde({ utilisateur: ADMIN, tours: sansMaPasse() }); await a.run('loadStops()'); a.routeActive(CH); await a.run('renderListe()');
  await a.run('ouvrirParcoursGoogle()');
  eq('sans passe : pas de bouton, et si on l\'appelle : un message, aucune fenêtre ouverte', [a.el('liste-parcours').innerHTML, a.dernierToast(), a.appels.ouverts], ['', 'Aucun client à faire pour ta passe.', []]);
  a.fin();
}
{
  // Plus de 10 clients à faire : les 10 prochains seulement (9 étapes + l'arrivée, la limite d'un lien Google Maps)
  const douze = Array.from({ length: 12 }, (_, i) => ({ id: 'c' + (i + 1), adresse: 'rue ' + (i + 1), client: 'C' + (i + 1), route_id: CH, service: MEC, lat: 46 + i / 100, lon: -72 - i / 100, ordre: i, actif: true }));
  const m = monde({ stops: douze, tours: [{ route_id: CH, tache: MEC, numero: 1, total: 12, faits: 0, pourcentage: 0, arrets_faits: [], passes: [{ passe_id: 'p-luc', equipe_id: 'e1', chauffeur_id: 'u-luc', je_suis_chauffeur: true, je_suis_a_bord: true }] }] }); await m.run('loadStops()');
  const u = decodeURIComponent(m.run('urlParcoursGoogle()'));
  const etapes = (u.match(/waypoints=([^&]*)/)?.[1] ?? '').split('|');
  eq('12 clients à faire : les 10 premiers seulement : 9 étapes (c1 à c9) et l\'arrivée c10', [etapes.length, etapes[0], etapes[8], u.match(/destination=([^&]*)/)[1]], [9, '46,-72', '46.08,-72.08', '46.09,-72.09']);
  m.routeActive(CH); await m.run('renderListe()');
  vrai('… le bouton annonce 10 clients (pas 12)', m.el('liste-parcours').innerHTML.includes('· 10 clients<'), m.el('liste-parcours').innerHTML);
  m.fin();
}

log('\n=== LES ARRÊTS QUI CHANGENT SONT RELUS UNE SEULE FOIS ===');
{
  const m = monde(); await m.run('loadStops()');
  const avant = m.appels.lectures.filter((x) => x === 'stops').length;
  m.run('planifierRechargementArrets();planifierRechargementArrets();planifierRechargementArrets()');
  await attendre(1200);
  eq('trois changements d\'arrêts d\'un coup (déplacer un client en modifie deux) : UNE seule relecture', m.appels.lectures.filter((x) => x === 'stops').length - avant, 1);
  m.fin();
}

// ══════════════════════════════════════════════════════════════════════
// ÉTAPE 18b (SUITE) : LE TRACÉ QUI SUIT LES RUES (www/js/parcours.js ; les tronçons viennent de la table parcours_segments, calculés par la fonction serveur)
// Demande de Joé (21 sept.) : « un tracé qui suit des rues d'un client à l'autre » ; « possibilité pour l'employé d'enlever et remettre les lignes lui-même ».
// ══════════════════════════════════════════════════════════════════════
const cinq = ['c1', 'c2', 'c3', 'c4', 'c5'].map((id, i) => ({ id, adresse: 'rue ' + id, client: id.toUpperCase(), route_id: CH, service: MEC, lat: 46.4 + i * 0.01, lon: -72.9 - i * 0.01, ordre: i, actif: true }));
const toursCinq = (faits = ['c1'], moi = { je_suis_chauffeur: true, je_suis_a_bord: true }) => [{ route_id: CH, tache: MEC, numero: 1, total: 5, faits: faits.length, pourcentage: faits.length * 20, arrets_faits: faits,
  passes: [{ passe_id: 'p-luc', equipe_id: 'e1', chauffeur_id: 'u-luc', ...moi }] }];
const sansPasse = { je_suis_chauffeur: false, je_suis_a_bord: false };
const seg = (a, b, plus = {}) => ({ de_arret_id: a.id, vers_arret_id: b.id, de_lat: a.lat, de_lon: a.lon, vers_lat: b.lat, vers_lon: b.lon, statut: 'ok',
  trace: [[a.lat, a.lon], [(a.lat + b.lat) / 2, a.lon - 0.001], [b.lat, b.lon]], ...plus });
const tousSeg = (l = cinq) => l.slice(0, -1).map((a, i) => seg(a, l[i + 1]));   // c1→c2, c2→c3, c3→c4, c4→c5
const trace = (i, j) => seg(cinq[i], cinq[j]).trace;
const copies = (l = cinq) => l.map((s) => ({ ...s }));
async function mondeP(o = {}) {
  const m = monde({ stops: copies(), tours: toursCinq(), segments: tousSeg(), ...o });
  await m.run('loadStops()');
  m.run('clearTimeout(_tMajParcours)');   // (le calcul automatique de l'administrateur a son propre test : ici il ne doit pas se mêler aux autres)
  return m;
}
const groupeActuel = (m) => { const g = m.groupes[m.groupes.length - 1]; return g && !m.retires.includes(g) ? g : null; };
const lignesDe = (m) => { const g = groupeActuel(m); return g ? g.couches[1].lignes : null; };
const F18B = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(fs.readFileSync(fileURLToPath(new URL('../functions/calculer-parcours/index.ts', import.meta.url)), 'utf8'))).toString('base64'));

log('\n=== LE TRACÉ : CE QUI EST DESSINÉ PENDANT UNE PASSE ===');
{
  const m = await mondeP();
  eq('Luc conduit, c1 est fait : la ligne va du PROCHAIN client (c2) au dernier (c5) : trois tronçons dans l\'ordre (pas c1→c2)', lignesDe(m), [trace(1, 2), trace(2, 3), trace(3, 4)]);
  const c = groupeActuel(m).couches;
  eq('deux couches superposées : un contour sombre plus épais dessous, la ligne cyan dessus ; ni l\'une ni l\'autre ne capte les touchers', [c.length, c[0].opt.color, c[0].opt.weight, c[1].opt.color, c[1].opt.weight, c.every((x) => x.opt.interactive === false)], [2, '#0b1220', 8, '#22d3ee', 4, true]);
  eq('les deux couches dessinent les MÊMES lignes', c[0].lignes, c[1].lignes);
  eq('la mention Geoapify / OpenStreetMap est posée une seule fois, avec liens', [m.appels.attributions.length, m.appels.attributions[0][0], /Geoapify/.test(m.appels.attributions[0][1]), /OpenStreetMap/.test(m.appels.attributions[0][1]), /href="https:\/\/www\.geoapify\.com/.test(m.appels.attributions[0][1])], [1, '+', true, true, true]);
  eq('le bouton rond 🛣 est allumé (lignes affichées), pas grisé (une passe est en cours)', [m.el('btn-trace').classList.contains('on'), m.el('btn-trace').classList.contains('inactif'), m.el('btn-trace').attrs['aria-pressed']], [true, false, 'true']);
  m.run('renderAll()'); m.run('renderAll()');
  eq('rien n\'a changé : la carte redessinée ne redessine PAS le tracé (une seule couche créée)', [m.groupes.length, m.appels.attributions.length], [1, 1]);
  m.run(`installerTours(${JSON.stringify(toursCinq(['c1', 'c2']))}, Date.now())`); m.run('renderAll()');
  eq('c2 devient fait : le tracé se refait, il commence maintenant à c3 (deux tronçons) ; l\'ancienne couche est retirée', [lignesDe(m), m.groupes.length, m.retires.includes(m.groupes[0])], [[trace(2, 3), trace(3, 4)], 2, true]);
  eq('… la mention n\'est pas posée en double', m.appels.attributions.filter((a) => a[0] === '+').length - m.appels.attributions.filter((a) => a[0] === '-').length, 1);
  m.run(`installerTours(${JSON.stringify(toursCinq(['c1', 'c2', 'c3', 'c4']))}, Date.now())`); m.run('renderAll()');
  eq('un seul client restant (c5) : rien à relier, aucune ligne', lignesDe(m), null);
  m.run(`installerTours(${JSON.stringify(toursCinq(['c1', 'c2']))}, Date.now())`); m.run('renderAll()');
  m.run(`installerTours(${JSON.stringify(toursCinq(['c1', 'c2'], sansPasse))}, Date.now())`); m.run('renderAll()');
  eq('la passe se termine (plus de camion à moi) : les lignes disparaissent, la mention aussi ; le bouton se grise', [lignesDe(m), m.appels.attributions.filter((a) => a[0] === '+').length - m.appels.attributions.filter((a) => a[0] === '-').length, m.el('btn-trace').classList.contains('inactif')], [null, 0, true]);
  m.run(`installerTours(${JSON.stringify(toursCinq(['c1', 'c2']))}, Date.now())`); m.run('renderAll()');
  m.run('currentUser=null'); m.run('majParcours()');
  eq('après la déconnexion : plus aucune ligne', lignesDe(m), null);
  m.fin();
}
{
  const p = await mondeP({ tours: toursCinq(['c1'], { je_suis_chauffeur: false, je_suis_a_bord: true }) });
  eq('un PASSAGER du camion voit la même ligne', lignesDe(p), [trace(1, 2), trace(2, 3), trace(3, 4)]);
  p.fin();
  const a = await mondeP({ utilisateur: ADMIN, tours: toursCinq(['c1'], sansPasse) });
  eq('l\'administrateur SANS passe (ni au volant ni à bord) : aucune ligne, aucun message', [lignesDe(a), a.dernierToast()], [null, undefined]);
  eq('… le bouton rond est grisé (rien à montrer) mais il est là', [a.el('btn-trace').classList.contains('inactif'), a.el('btn-trace').classList.contains('on')], [true, true]);
  a.fin();
  const t = await mondeP({ tours: toursCinq(['c1', 'c2', 'c3', 'c4', 'c5']) });
  eq('tous les clients faits : aucune ligne', lignesDe(t), null);
  t.fin();
}
{
  // Jamais de ligne inventée : un tronçon absent, périmé ou sans route n'est simplement pas dessiné
  const sans = tousSeg().filter((s) => !(s.de_arret_id === 'c3' && s.vers_arret_id === 'c4'));
  const a = await mondeP({ segments: sans });
  eq('le tronçon c3→c4 manque : on dessine c2→c3 et c4→c5, RIEN entre c3 et c4 (jamais de ligne droite inventée)', lignesDe(a), [trace(1, 2), trace(3, 4)]);
  a.fin();
  const bouge = cinq.map((s) => (s.id === 'c3' ? { ...s, lat: s.lat + 0.001 } : { ...s }));
  const b = await mondeP({ stops: bouge });
  eq('c3 a changé de place depuis le calcul : ses DEUX tronçons sont périmés et ne sont pas dessinés (reste c4→c5)', lignesDe(b), [trace(3, 4)]);
  b.fin();
  const c = await mondeP({ segments: tousSeg().map((s) => (s.de_arret_id === 'c3' ? { ...s, statut: 'sans_route', trace: null } : s)) });
  eq('un tronçon « sans_route » n\'est pas dessiné', lignesDe(c), [trace(1, 2), trace(3, 4)]);
  c.fin();
  const d = await mondeP({ segments: [...tousSeg(), seg(STOPS[4], STOPS[5]), seg(STOPS[0], STOPS[1])] });
  eq('les tronçons d\'une autre route (s5→s6) ou d\'un autre trajet sont ignorés', lignesDe(d), [trace(1, 2), trace(2, 3), trace(3, 4)]);
  d.fin();
  const inverse = cinq.map((s) => ({ ...s, ordre: { c1: 0, c2: 1, c3: 3, c4: 2, c5: 4 }[s.id] }));   // l'administrateur a mis c4 avant c3
  const e = await mondeP({ stops: inverse });
  eq('l\'ordre a changé (c4 avant c3) : les nouveaux couples n\'ont pas encore de tronçon : on ne dessine que ce qui est vrai (rien)', [lignesDe(e), e.run('tronconsManquants()').length], [null, 3]);
  e.fin();
  const f = await mondeP({ segments: [{ ...tousSeg()[1], trace: [[46.4, -72.9]] }, tousSeg()[2]] });
  eq('un tronçon dont la ligne n\'a qu\'un point est ignoré (jamais de plantage)', lignesDe(f), [trace(2, 3)]);
  f.fin();
}

log('\n=== LE BOUTON 🛣 : ENLEVER ET REMETTRE LES LIGNES ===');
{
  const m = await mondeP();
  m.run('basculerTrace()');
  eq('un toucher : les lignes disparaissent (couche et mention retirées), le bouton s\'éteint, le message le dit', [lignesDe(m), m.appels.attributions[m.appels.attributions.length - 1][0], m.el('btn-trace').classList.contains('on'), m.el('btn-trace').attrs['aria-pressed'], m.dernierToast()], [null, '-', false, 'false', '🛣 Tracé caché']);
  eq('… le choix est gardé sur le téléphone', m.memoire.get('lp_trace_visible'), '0');
  m.run('renderAll()');
  eq('… un redessin de la carte ne les remet PAS', lignesDe(m), null);
  m.run('basculerTrace()');
  eq('un deuxième toucher : elles reviennent, le message le dit, le choix est gardé', [lignesDe(m), m.el('btn-trace').classList.contains('on'), m.dernierToast(), m.memoire.get('lp_trace_visible')], [[trace(1, 2), trace(2, 3), trace(3, 4)], true, '🛣 Tracé affiché', '1']);
  m.fin();
  const c = await mondeP({ memo: { lp_trace_visible: '0' } });
  eq('un téléphone où l\'employé les avait cachées les garde cachées à l\'ouverture', [lignesDe(c), c.el('btn-trace').classList.contains('on')], [null, false]);
  c.fin();
  const s = await mondeP({ tours: toursCinq(['c1'], sansPasse), memo: { lp_trace_visible: '0' } });
  s.run('basculerTrace()');
  eq('sans passe : le bouton marche quand même, et dit que les lignes apparaîtront pendant une passe', [s.dernierToast(), s.el('btn-trace').classList.contains('inactif')], ['🛣 Tracé affiché · il apparaît pendant une passe', true]);
  s.fin();
  const v = await mondeP({ segments: [], memo: { lp_trace_visible: '0' } });
  v.run('basculerTrace()');
  eq('en passe, mais aucun tronçon calculé : le message le dit honnêtement', v.dernierToast(), '🛣 Tracé affiché · rien à tracer pour l’instant');
  v.fin();
}

log('\n=== LES TRONÇONS : LECTURE, COPIE, TEMPS RÉEL ===');
{
  const m = await mondeP();
  eq('la lecture demande la table parcours_segments par tranches de 1000, triée', [m.appels.ranges.filter((r) => r[0] === 'parcours_segments'), m.appels.orders.filter((o) => o[0] === 'parcours_segments').map((o) => o[1])], [[['parcours_segments', 0, 999]], ['de_arret_id', 'vers_arret_id']]);
  eq('les arrêts sont demandés dans l\'ordre choisi, puis la date de création, puis l\'identifiant (le MÊME ordre que la fonction serveur)', m.appels.orders.filter((o) => o[0] === 'stops').map((o) => o[1]), ['ordre', 'created_at', 'id']);
  eq('4 tronçons installés', m.run('segmentsParcours.length'), 4);
  const lus = m.appels.lectures.filter((x) => x === 'parcours_segments').length;
  eq('une deuxième lecture tout de suite est inutile : rien n\'est relu (les tronçons changent très rarement)', [await m.run('chargerSegments()'), m.appels.lectures.filter((x) => x === 'parcours_segments').length], [true, lus]);
  await m.run('chargerSegments({forcer:true})');
  eq('… « forcer » relit', m.appels.lectures.filter((x) => x === 'parcours_segments').length, lus + 1);
  eq('le temps réel : UN canal « parcours-changes » sur la table parcours_segments, ouvert après la première lecture réussie (pas en double)', [m.appels.canaux.length, m.appels.canaux[0].nom, m.appels.canaux[0].liens.map((l) => [l.filtre.table, l.filtre.event])], [1, 'parcours-changes', [['parcours_segments', '*']]]);
  // De nouveaux tronçons arrivent en rafale : UNE seule relecture, et la carte suit
  m.donnees.parcours_segments = m.donnees.parcours_segments.filter((s) => !(s.de_arret_id === 'c3'));
  await m.run('chargerSegments({forcer:true})'); m.run('renderAll()');
  eq('(le tronçon c3→c4 manque : la ligne a un trou)', lignesDe(m), [trace(1, 2), trace(3, 4)]);
  m.donnees.parcours_segments.push(seg(cinq[2], cinq[3]));
  const avant = m.appels.lectures.filter((x) => x === 'parcours_segments').length;
  m.run('planifierRechargementParcours();planifierRechargementParcours();planifierRechargementParcours()');
  await attendre(1800);
  eq('trois avis du temps réel d\'un coup : UNE seule relecture, et le trou se comble à l\'écran', [m.appels.lectures.filter((x) => x === 'parcours_segments').length - avant, lignesDe(m)], [1, [trace(1, 2), trace(2, 3), trace(3, 4)]]);
  m.fin();
}
{
  const plein = [];
  for (let i = 0; i < 1200; i++) plein.push({ de_arret_id: 'a' + i, vers_arret_id: 'b' + i, de_lat: 1, de_lon: 1, vers_lat: 2, vers_lon: 2, statut: 'sans_route', trace: null });
  const m = await mondeP({ segments: plein });
  eq('1200 tronçons : lus en DEUX tranches (0 à 999, puis 1000 à 1999), aucun oublié', [m.appels.ranges.filter((r) => r[0] === 'parcours_segments').map((r) => r.slice(1)), m.run('segmentsParcours.length')], [[[0, 999], [1000, 1999]], 1200]);
  m.fin();
}
{
  // Pas de table (SQL 22 pas encore exécuté) ou un serveur qui refuse : l'application marche comme avant, sans bruit
  const m = await mondeP({ erreurLecture: ['parcours_segments'] });
  eq('la table n\'existe pas encore : les arrêts se chargent, aucune ligne, AUCUN message, aucune erreur, AUCUN canal temps réel', [m.run('stops.length'), lignesDe(m), m.appels.toasts.length, m.appels.erreurs.length, m.appels.canaux.length], [5, null, 0, 0, 0]);
  m.fin();
  const o = { lectureLance: [] };
  const r = monde({ stops: copies(), tours: toursCinq(), segments: tousSeg(), ...o }); await r.run('loadStops()'); r.run('clearTimeout(_tMajParcours)');
  o.lectureLance.push('parcours_segments');
  eq('le signal disparaît pendant la relecture : false, les tronçons connus sont GARDÉS (les lignes restent), et le téléphone se sait hors réseau', [await r.run('chargerSegments({forcer:true})'), (r.run('renderAll()'), lignesDe(r)), r.run('reseau.enLigne')], [false, [trace(1, 2), trace(2, 3), trace(3, 4)], false]);
  r.fin();
}
{
  // La copie pour le hors réseau
  const m = monde({ stops: copies(), tours: toursCinq(), segments: tousSeg() });
  m.run('globalThis.__copies=[]; cacheEcrire=(nom,data)=>{__copies.push([nom,data.length]);return Promise.resolve(true);}');
  await m.run('loadStops()'); m.run('clearTimeout(_tMajParcours)');
  eq('une lecture réussie garde une copie « parcours » (4 tronçons) pour le hors réseau', m.run('__copies').filter((c) => c[0] === 'parcours'), [['parcours', 4]]);
  m.run('installerSegments([])');
  m.run('cacheLire=async(nom)=>nom===\'parcours\'?{data:' + JSON.stringify(tousSeg().slice(0, 2)) + ',le:"2026-09-21T18:00:00.000Z"}:null');
  await m.run('restaurerParcours()');
  eq('au démarrage sans signal : la dernière copie est reprise (2 tronçons)', m.run('segmentsParcours.length'), 2);
  m.run('cacheLire=async()=>({data:"pas une liste",le:"x"})');
  await m.run('restaurerParcours()');
  eq('une copie illisible est ignorée (les 2 tronçons connus restent)', m.run('segmentsParcours.length'), 2);
  m.run('cacheLire=async()=>{throw new Error("boum");}');
  eq('une copie qui plante à la lecture ne plante rien', await m.run('restaurerParcours().then(()=>"ok")'), 'ok');
  m.fin();
}

log('\n=== L\'ADMINISTRATEUR : FAIRE CALCULER CE QUI MANQUE ===');
const mondeA = async (o = {}) => mondeP({ utilisateur: ADMIN, tours: toursCinq(['c1'], sansPasse), ...o });
const bilan = (o = {}) => ({ data: { ok: true, calcules: 0, sans_route: 0, echecs: 0, restants: 0, total_troncons: 4, limite_atteinte: false, ...o }, error: null });
const erreurHttp = (statut, corps) => ({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { status: statut, json: async () => corps } } });
{
  const m = await mondeA({ segments: tousSeg().slice(0, 2) });
  eq('deux tronçons manquent (c3→c4 et c4→c5)', m.run('tronconsManquants()'), ['c3|c4', 'c4|c5']);
  m.fin();
  eq('tout est à jour : aucun manquant', (await mondeA()).run('tronconsManquants().length'), 0);
  const b = await mondeA({ stops: cinq.map((s) => (s.id === 'c3' ? { ...s, lon: -73 } : { ...s })) });
  eq('un client a bougé : les deux tronçons qui le touchent manquent', b.run('tronconsManquants()'), ['c2|c3', 'c3|c4']);
  b.fin();
  const c = await mondeA({ segments: tousSeg().map((s) => (s.de_arret_id === 'c2' ? { ...s, statut: 'sans_route', trace: null } : s)) });
  eq('un « sans_route » à jour compte comme fait (on ne le redemande pas tout seul)', c.run('tronconsManquants().length'), 0);
  c.fin();
  const d = await mondeA({ stops: [...cinq, { id: 'z1', adresse: 'sans service', route_id: CH, service: null, lat: 46.9, lon: -72.5, ordre: 9, actif: true }, { id: 'z1b', adresse: 'sans service aussi', route_id: CH, service: null, lat: 46.91, lon: -72.5, ordre: 10, actif: true }, { id: 'z2', adresse: 'sans position', route_id: CH, service: MEC, lat: null, lon: null, ordre: 10, actif: true }, { id: 'z3', adresse: 'archivé', route_id: CH, service: MEC, lat: 46.95, lon: -72.5, ordre: 11, actif: false }].map((s) => ({ ...s })) });
  eq('un arrêt sans service, sans position ou archivé n\'ajoute aucun tronçon voulu', d.run('tronconsManquants().length'), 0);
  d.fin();
}
{
  // Le bouton « Mettre à jour le tracé » : ce qu'il dit
  const m = await mondeA();
  await m.run('majParcoursManuel()');
  eq('tout est à jour : « déjà à jour », aucun appel au serveur', [m.dernierToast(), m.appels.fonctions.length], ['✔ Le tracé est déjà à jour.', 0]);
  m.fin();
  let nouveaux = null;
  const a = await mondeA({ segments: tousSeg().slice(0, 2), fonction: (corps, d) => { nouveaux = corps; d.parcours_segments.push(...tousSeg().slice(2)); return bilan({ calcules: 2, total_troncons: 4 }); } });
  const lus = a.appels.lectures.filter((x) => x === 'parcours_segments').length;
  a.donnees.parcours_segments = a.donnees.parcours_segments.slice();   // (une copie : la lecture du serveur change de contenu pendant l'appel)
  await a.run('majParcoursManuel()');
  eq('deux tronçons manquent : la fonction « calculer-parcours » est appelée UNE fois, avec « refaire_sans_route »', [a.appels.fonctions.map((f) => f.nom), nouveaux], [['calculer-parcours'], { refaire_sans_route: true }]);
  eq('… les nouveaux tronçons sont relus tout de suite, le message dit ce qui s\'est passé, le voyant de synchro s\'éteint, le verrou est rendu', [a.appels.lectures.filter((x) => x === 'parcours_segments').length - lus, a.dernierToast(), a.el('sync').classList.contains('show'), a.run('_majParcoursEnCours')], [1, '✔ Tracé mis à jour : 2 tronçons calculés', false, false]);
  eq('… il n\'y a plus rien à calculer', a.run('tronconsManquants().length'), 0);
  a.fin();
  // L'administrateur conduit aussi un camion : après le calcul, les nouvelles lignes apparaissent tout de suite sur SA carte
  const v = await mondeP({ utilisateur: ADMIN, tours: toursCinq(['c1']), segments: tousSeg().slice(0, 2), fonction: (corps, d) => { d.parcours_segments.push(...tousSeg().slice(2)); return bilan({ calcules: 2 }); } });
  v.run('clearTimeout(_tMajParcours)');
  eq('(avant : seul c2→c3 est connu)', lignesDe(v), [trace(1, 2)]);
  await v.run('majParcoursManuel()');
  eq('après le calcul, la carte de l\'administrateur (en passe) montre les nouvelles lignes sans rien toucher', lignesDe(v), [trace(1, 2), trace(2, 3), trace(3, 4)]);
  v.fin();
  const u = await mondeA({ segments: tousSeg().slice(0, 3), fonction: (corps, d) => { d.parcours_segments.push(...tousSeg().slice(3)); return bilan({ calcules: 1 }); } });
  await u.run('majParcoursManuel()');
  eq('un seul tronçon : « 1 tronçon calculé » (singulier)', u.dernierToast(), '✔ Tracé mis à jour : 1 tronçon calculé');
  u.fin();
}
{
  // Plusieurs appels (40 tronçons à la fois), jusqu'à la fin, sans jamais tourner en rond
  const rondes = [bilan({ calcules: 40, restants: 60 }), bilan({ calcules: 40, restants: 20 }), bilan({ calcules: 20, restants: 0 })];
  const m = await mondeA({ segments: [], fonction: (c, d, n) => rondes[n - 1] });
  await m.run('majParcoursManuel()');
  eq('100 tronçons : trois appels ; « refaire_sans_route » seulement au PREMIER ; message total', [m.appels.fonctions.map((f) => f.corps), m.dernierToast()], [[{ refaire_sans_route: true }, {}, {}], '✔ Tracé mis à jour : 100 tronçons calculés']);
  m.fin();
  const t = await mondeA({ segments: [], fonction: () => bilan({ calcules: 1, restants: 9 }) });
  await t.run('majParcoursManuel()');
  eq('un service qui n\'en finit pas : au plus SIX appels, le message dit ce qui reste', [t.appels.fonctions.length, t.dernierToast()], [6, '✔ Tracé mis à jour : 6 tronçons calculés · il en reste 9']);
  t.fin();
  const p = await mondeA({ segments: [], fonction: () => bilan({ echecs: 3, restants: 3 }) });
  await p.run('majParcoursManuel()');
  eq('aucun progrès (le service est en panne) : UN seul appel, pas de boucle', [p.appels.fonctions.length, p.dernierToast()], [1, '✔ Le tracé est à jour · 3 à refaire (service indisponible)']);
  p.fin();
  const l = await mondeA({ segments: [], fonction: () => bilan({ calcules: 5, restants: 10, limite_atteinte: true }) });
  await l.run('majParcoursManuel()');
  eq('la limite du service est atteinte : UN seul appel, on le dit', [l.appels.fonctions.length, l.dernierToast()], [1, '✔ Tracé mis à jour : 5 tronçons calculés · limite du service atteinte : réessaie plus tard']);
  l.fin();
  const s = await mondeA({ segments: [], fonction: () => bilan({ calcules: 1, sans_route: 2 }) });
  await s.run('majParcoursManuel()');
  eq('des couples sans route trouvée : le message le dit', s.dernierToast(), '✔ Tracé mis à jour : 1 tronçon calculé · 2 sans route trouvée');
  s.fin();
  const q = await mondeA({ segments: [...tousSeg().slice(0, 3), { ...tousSeg()[3], statut: 'sans_route', trace: null }], fonction: () => bilan({ calcules: 1 }) });
  await q.run('majParcoursManuel()');
  eq('rien ne manque mais un tronçon était « sans route » : le bouton REDEMANDE (l\'administrateur le veut)', [q.appels.fonctions.length, q.appels.fonctions[0].corps], [1, { refaire_sans_route: true }]);
  q.fin();
}
{
  // Les erreurs, dites simplement (le bouton est le seul endroit qui parle)
  const essai = async (fonction, o = {}) => { const m = await mondeA({ segments: [], fonction, ...o }); await m.run('majParcoursManuel()'); const t = m.dernierToast(); m.fin(); return t; };
  eq('pas l\'administrateur (403)', await essai(() => erreurHttp(403, { ok: false, erreur: 'non_autorise', message: 'Réservé à l\'administrateur.' })), '❌ Réservé à l’administrateur.');
  eq('la clé Geoapify n\'est pas enregistrée : le message du serveur (qui dit quoi faire) est montré', await essai(() => erreurHttp(500, { ok: false, erreur: 'cle_absente', message: 'La clé Geoapify n\'est pas enregistrée : Supabase > Edge Functions > Secrets > ajouter GEOAPIFY_KEY.' })), '❌ La clé Geoapify n\'est pas enregistrée : Supabase > Edge Functions > Secrets > ajouter GEOAPIFY_KEY.');
  eq('la clé est refusée : idem', /GEOAPIFY_KEY/.test(await essai(() => erreurHttp(502, { ok: false, erreur: 'cle_refusee', message: 'Geoapify a refusé la clé : vérifiez GEOAPIFY_KEY dans Supabase.' }))), true);
  eq('la fonction n\'est pas installée (404)', await essai(() => erreurHttp(404, { code: 'NOT_FOUND', message: 'Requested function was not found' })), '❌ La fonction « calculer-parcours » n’est pas encore installée sur Supabase.');
  const sansSignal = () => ({ data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function', context: new TypeError('Failed to fetch') } });   // (l'erreur réelle de supabase-js quand la demande n'obtient AUCUNE réponse)
  eq('pas de signal (aucune réponse du serveur)', await essai(sansSignal), '📴 Pas de réseau : le tracé n’a pas pu être mis à jour.');
  eq('… et le téléphone se sait alors hors réseau (la relecture qui suit échoue aussi ; la sonde reprend la main)', await (async () => {
    const o = { lectureLance: [] };
    const m = await mondeA({ segments: [], fonction: () => { o.lectureLance.push('parcours_segments'); return sansSignal(); }, ...o });
    await attendre(100); await m.run('majParcoursManuel()'); const r = m.run('reseau.enLigne'); m.fin(); return r;
  })(), false);
  eq('une erreur interne du serveur : message général', await essai(() => erreurHttp(500, { ok: false, erreur: 'erreur_interne', message: '' })), '❌ Le tracé n’a pas pu être mis à jour.');
  eq('une réponse illisible : message général, jamais de plantage', await essai(() => ({ data: null, error: null })), '❌ Le tracé n’a pas pu être mis à jour.');
  eq('une réponse « ok: false » sans erreur HTTP : jamais prise pour un succès, le message du serveur est montré', await essai(() => ({ data: { ok: false, erreur: 'cle_absente', message: 'La clé manque.' }, error: null })), '❌ La clé manque.');
  eq('… « pas de signal » prévient le téléphone (marquerHorsReseau) UNE fois', await (async () => {
    const m = await mondeA({ segments: [], fonction: sansSignal });
    await attendre(100); m.run('globalThis.__hors=0; marquerHorsReseau=function(){__hors++;};');
    await m.run('majParcoursManuel()'); const n = m.run('__hors'); m.fin(); return n;
  })(), 1);
  eq('l\'appel lui-même plante : message général, jamais de plantage', await essai(() => { throw new Error('boum'); }), '❌ Le tracé n’a pas pu être mis à jour. boum');
  eq('un appel qui échoue avant de rien calculer ne laisse pas le voyant de synchro allumé', await (async () => { const m = await mondeA({ segments: [], fonction: () => erreurHttp(500, { erreur: 'x' }) }); await m.run('majParcoursManuel()'); const r = m.el('sync').classList.contains('show'); m.fin(); return r; })(), false);
}
{
  // Sans réseau, sans être administrateur, deux à la fois
  const m = await mondeA({ segments: [] });
  await attendre(100);   // (les lectures en arrière-plan du chargement finissent d'abord : elles remettraient « en ligne »)
  m.run('reseau.enLigne=false');
  await m.run('majParcoursManuel()'); await m.run('majParcoursServeur({manuel:false})');
  eq('sans réseau : le bouton le dit, l\'automatique se tait ; aucun appel dans les deux cas', [m.dernierToast(), m.appels.toasts.length, m.appels.fonctions.length], ['📴 Pas de réseau : le tracé ne peut pas être mis à jour maintenant.', 1, 0]);
  m.fin();
  const e = await mondeP({ segments: [] });
  const r = await e.run('majParcoursManuel()');
  eq('un EMPLOYÉ ne peut pas le faire : rien n\'est demandé, aucun message', [r, e.appels.fonctions.length, e.appels.toasts.length], [null, 0, 0]);
  e.fin();
  const c = await mondeA({ segments: [], fonction: async () => { await attendre(150); return bilan({ calcules: 1 }); } });
  await Promise.all([c.run('majParcoursManuel()'), c.run('majParcoursManuel()')]);
  eq('deux touchers rapprochés : UN seul calcul à la fois', c.appels.fonctions.length, 1);
  c.fin();
}
{
  // Le calcul AUTOMATIQUE (ordre changé, arrêt ajouté ou déplacé) : silencieux, une fois par situation
  const m = await mondeA({ segments: tousSeg().slice(0, 2), fonction: () => bilan({ echecs: 2, restants: 2 }) });
  await m.run('majParcoursServeur({manuel:false})');
  eq('deux tronçons manquent : demandés UNE fois, SANS « refaire_sans_route », et sans aucun message', [m.appels.fonctions.map((f) => f.corps), m.appels.toasts.length], [[{}], 0]);
  await m.run('majParcoursServeur({manuel:false})');
  eq('la même situation (le service n\'a rien donné) : PAS redemandé (pas de boucle qui martèle le service)', m.appels.fonctions.length, 1);
  m.donnees.stops = m.donnees.stops.map((s) => (s.id === 'c5' ? { ...s, lat: 46.6 } : s));
  await m.run('loadStops()'); m.run('clearTimeout(_tMajParcours)');
  await m.run('majParcoursServeur({manuel:false})');
  eq('un arrêt a bougé : la situation a changé, on redemande', m.appels.fonctions.length, 2);
  m.fin();
  const ok_ = await mondeA();
  await ok_.run('majParcoursServeur({manuel:false})');
  eq('rien ne manque : aucun appel, aucun message', [ok_.appels.fonctions.length, ok_.appels.toasts.length], [0, 0]);
  ok_.fin();
  const fait = await mondeA({ segments: tousSeg().slice(0, 2), fonction: (corps, d) => { d.parcours_segments.push(...tousSeg().slice(2)); return bilan({ calcules: 2 }); } });
  await fait.run('majParcoursServeur({manuel:false})');
  await fait.run('majParcoursServeur({manuel:false})');
  eq('une fois tout calculé, l\'automatique ne redemande RIEN (un seul appel en tout, pas un de trop)', fait.appels.fonctions.length, 1);
  fait.fin();
  const err = await mondeA({ segments: [], fonction: () => erreurHttp(500, { erreur: 'cle_absente', message: 'x' }) });
  await err.run('majParcoursServeur({manuel:false})');
  eq('une erreur du serveur en mode automatique : AUCUN message (seul le bouton parle)', [err.appels.fonctions.length, err.appels.toasts.length], [1, 0]);
  err.fin();
}
{
  // Le déclenchement : après le chargement des arrêts (administrateur seulement), après un changement d'ordre ; groupé
  const m = monde({ utilisateur: ADMIN, stops: copies(), tours: toursCinq(['c1'], sansPasse), segments: tousSeg().slice(0, 2), fonction: () => bilan({ calcules: 2 }) });
  await m.run('loadStops()');
  await attendre(600);
  eq('au chargement des arrêts, l\'administrateur voit qu\'il manque des tronçons : rien tout de suite (on attend qu\'il ait fini de toucher à l\'écran)', m.appels.fonctions.length, 0);
  await attendre(2400);
  eq('… puis UN appel à la fonction, silencieux', [m.appels.fonctions.length, m.appels.toasts.length], [1, 0]);
  m.fin();
  const e = monde({ utilisateur: { id: 'u-luc', nom: 'Luc', role: 'employe' }, stops: copies(), tours: toursCinq(), segments: tousSeg().slice(0, 2) });
  await e.run('loadStops()'); e.run('planifierMajParcours()');
  await attendre(2800);
  eq('un EMPLOYÉ (même avec des tronçons manquants) ne déclenche JAMAIS de calcul', e.appels.fonctions.length, 0);
  e.fin();
  const d = monde({ utilisateur: ADMIN, stops: copies(), tours: toursCinq(['c1'], sansPasse), segments: tousSeg(), fonction: () => bilan({ calcules: 3 }) });
  await d.run('loadStops()'); d.run('clearTimeout(_tMajParcours)'); d.routeActive(CH);
  const idx4 = d.run("stops.findIndex(s=>s.id==='c4')");
  await d.run(`deplacerArret(null,${idx4},-1)`);   // c4 monte avant c3 : trois nouveaux couples
  eq('l\'administrateur change l\'ordre : rien n\'est demandé tout de suite', d.appels.fonctions.length, 0);
  await d.run(`deplacerArret(null,${d.run("stops.findIndex(s=>s.id==='c2')")},1)`);
  await attendre(2800);
  eq('… puis, quand il a fini de toucher ▲ ▼, UN SEUL appel (groupé)', d.appels.fonctions.length, 1);
  d.fin();
}
{
  // Le bouton dans la liste
  const m = await mondeA({ segments: tousSeg().slice(0, 2) }); m.routeActive(CH); await m.run('renderListe()');
  const h = m.el('liste-trace-admin').innerHTML;
  eq('l\'administrateur voit « 🛣 Mettre à jour le tracé · 2 à calculer », relié à majParcoursManuel()', /<button type="button" class="lf-btn parcours-maj" onclick="majParcoursManuel\(\)">🛣 Mettre à jour le tracé · 2 à calculer<\/button>/.test(h), true, h);
  m.fin();
  const a = await mondeA(); a.routeActive(CH); await a.run('renderListe()');
  eq('tout est à jour : le bouton est là, sans compte', a.el('liste-trace-admin').innerHTML.includes('Mettre à jour le tracé</button>'), true);
  a.fin();
  const e = await mondeP({ segments: tousSeg().slice(0, 2) }); e.routeActive(CH); await e.run('renderListe()');
  eq('un employé ne voit PAS ce bouton', e.el('liste-trace-admin').innerHTML, '');
  e.fin();
}

log('\n=== L\'APPLICATION ET LA FONCTION SERVEUR ÉCRIVENT LA MÊME SUITE DE CLIENTS ===');
{
  // Si les deux se trompaient d'ordre, les tronçons calculés ne serviraient à rien : mêmes suites, mêmes égalités, mêmes exclusions
  const mel = [
    { id: 'k1', route_id: CH, service: MEC, lat: 46.1, lon: -72.1, ordre: 5 }, { id: 'k2', route_id: CH, service: MEC, lat: 46.2, lon: -72.2, ordre: 5 }, { id: 'k3', route_id: CH, service: MEC, lat: 46.3, lon: -72.3, ordre: 1 },
    { id: 'k4', route_id: CH, service: MEC, lat: 46.4, lon: -72.4, ordre: null }, { id: 'k5', route_id: CH, service: MEC, lat: 46.5, lon: -72.5, ordre: 'x' }, { id: 'k6', route_id: CH, service: MEC, lat: 46.6, lon: -72.6, ordre: 1 },
    { id: 'k7', route_id: CH, service: SEL, lat: 46.7, lon: -72.7, ordre: 2 }, { id: 'k8', route_id: CH, service: SEL, lat: 46.8, lon: -72.8, ordre: 1 },
    { id: 'k9', route_id: SE, service: MEC, lat: 46.9, lon: -72.9, ordre: 0 }, { id: 'ka', route_id: SE, service: MEC, lat: 47.0, lon: -73.0, ordre: 0 },
    { id: 'kb', route_id: CH, service: MEC, lat: null, lon: null, ordre: 0 }, { id: 'kc', route_id: CH, service: null, lat: 47.1, lon: -73.1, ordre: 0 }, { id: 'kd', route_id: null, service: MEC, lat: 47.2, lon: -73.2, ordre: 0 },
    { id: 'ke', route_id: CH, service: MEC, lat: 47.3, lon: -73.3, ordre: 3, actif: false },
  ].map((s) => ({ actif: true, ...s }));
  const m = monde({ stops: mel, tours: [] }); await m.run('loadStops()');
  const appApp = (route, service) => m.run(`sequenceParcours(${JSON.stringify(route)},${JSON.stringify(service)}).map(s=>s.id)`);
  const serveur = F18B.sequences(mel.filter((s) => s.actif !== false));   // (la fonction ne lit que les arrêts actifs)
  const cle = (s) => s[0].route_id + '|' + s[0].service;
  const vus = new Map(serveur.map((s) => [cle(s), s.map((x) => x.id)]));
  eq('route Charette, déneigement : les égalités gardent l\'ordre de départ, « x » et « vide » comptent 0, sans position / sans service / sans route / archivé sont exclus', appApp(CH, MEC), ['k4', 'k5', 'k3', 'k6', 'k1', 'k2']);
  for (const [r, s] of [[CH, MEC], [CH, SEL], [SE, MEC]]) eq(`suite ${r} / ${s} : l\'application et la fonction sont d\'accord`, appApp(r, s), vus.get(r + '|' + s));
  eq('… et les tronçons voulus par la fonction sont ceux que l\'application dit manquer (aucun tronçon gardé)', F18B.paires(serveur).map((p) => p.de.id + '|' + p.vers.id).sort(), m.run('tronconsManquants()').sort());
  m.fin();
}

log('\n=== LE CODE : ORDRE, PARCOURS, PAGE ===');
{
  const page = lire('index.html'), css = lire('css/style.css'), carte = lire('js/carte.js'), ordre = lire('js/ordre.js');
  vrai('la page charge ordre.js après liste-arrets.js et avant tracking.js, et a la place du bouton « Parcours »', page.indexOf('js/liste-arrets.js') < page.indexOf('js/ordre.js') && page.indexOf('js/ordre.js') < page.indexOf('js/tracking.js') && page.includes('id="liste-parcours"'));
  vrai('les changements d\'arrêts en temps réel passent par le regroupement (planifierRechargementArrets)', /table:'stops'\},\(\)=>planifierRechargementArrets\(\)/.test(carte));
  vrai('le lien Google Maps : au plus 10 clients (9 étapes + l\'arrivée), pas de départ imposé, en voiture', /const MAX_ETAPES_GOOGLE=10;/.test(ordre) && /travelmode=driving/.test(ordre) && !/origin/.test(ordre.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')));
  vrai('SEUL l\'administrateur, avec une route choisie, change l\'ordre', /return !!\(currentUser&&currentUser\.role==='admin'&&routeActive!==null\);/.test(ordre));
  vrai('l\'ordre s\'écrit dans stops.ordre par « update » (règle stops_admin : pas de SQL) et jamais autrement', /db\.from\('stops'\)\.update\(\{ordre:valeurOrdre\(x\)\}\)\.eq\('id',x\.id\)/.test(ordre));
  vrai('le style : l\'adresse d\'un client passe sur 2 lignes au plus (les flèches ▲ ▼ prennent de la place), sans être coupée sur une seule', /\.ci-addr\{[^}]*-webkit-line-clamp:2/.test(css) && !/\.ci-addr\{[^}]*white-space:nowrap/.test(css));
  vrai('le style : le prochain client, les flèches (40 px), le bouton Google Maps',/\.ci\.ci-prochain\{[^}]*box-shadow:inset 3px 0 0/.test(css) && /\.ci-mv\{width:40px;height:40px/.test(css) && /\.lf-btn\.parcours\{width:100%;min-height:48px/.test(css) && /\.passe-prochain\{[^}]*color:var\(--accent\)/.test(css));
  // ── Étape 18b (suite) : le tracé qui suit les rues ──
  const parcours = lire('js/parcours.js'), arrets = lire('js/arrets.js'), horsReseau = lire('js/hors-reseau.js'), listeArrets = lire('js/liste-arrets.js');
  vrai('la page charge parcours.js après ordre.js et avant tracking.js', page.indexOf('js/ordre.js') < page.indexOf('js/parcours.js') && page.indexOf('js/parcours.js') < page.indexOf('js/tracking.js'));
  vrai('la page a le bouton rond 🛣 (après ◎, allumé au départ, relié à basculerTrace) et la zone du bouton d\'administration sous « Parcours »',
    /id="btn-trace" type="button" onclick="basculerTrace\(\)"[^>]*aria-pressed="true">🛣<\/button>/.test(page) && page.indexOf('centerUser()') < page.indexOf('id="btn-trace"') && page.indexOf('id="liste-parcours"') < page.indexOf('id="liste-trace-admin"'));
  vrai('arrets.js : les tronçons sont lus au chargement des arrêts, le tracé suit chaque redessin de la carte, l\'administrateur fait calculer ce qui manque',
    /if\(typeof chargerSegments==='function'\) await chargerSegments\(\);/.test(arrets) && /if\(typeof majParcours==='function'\) majParcours\(\);/.test(arrets) && /if\(typeof planifierMajParcours==='function'\) planifierMajParcours\(\);/.test(arrets));
  vrai('les arrêts sont lus dans l\'ordre « ordre, created_at, id » (le même ordre que la fonction serveur)', /\.order\('ordre'\)\.order\('created_at'\)\.order\('id'\)/.test(arrets));
  vrai('hors-reseau.js : la copie des tronçons est reprise au démarrage sans signal', /if\(typeof restaurerParcours==='function'\) await restaurerParcours\(\);/.test(horsReseau));
  vrai('ordre.js : un changement d\'ordre fait planifier le calcul des nouveaux tronçons', /if\(typeof planifierMajParcours==='function'\) planifierMajParcours\(\);/.test(ordre));
  vrai('liste-arrets.js : le bouton « Mettre à jour le tracé » de l\'administrateur est redessiné avec la liste', /if\(typeof majBoutonTraceAdmin==='function'\) majBoutonTraceAdmin\(\);/.test(listeArrets));
  vrai('le temps réel des tronçons a son PROPRE canal (une table absente ne doit pas faire tomber les autres)', /db\.channel\('parcours-changes'\)/.test(parcours) && !/parcours_segments/.test(carte));
  vrai('la fonction serveur s\'appelle « calculer-parcours » et le corps n\'envoie ni clé ni position', /db\.functions\.invoke\('calculer-parcours',\{body:corps\}\)/.test(parcours) && !/apiKey|GEOAPIFY|api\.geoapify/i.test(parcours.split('\n').filter((l) => !/^\s*\/\//.test(l) && !/ATTRIBUTION_TRACE=/.test(l) && !/messageErreur|La clé Geoapify pose/.test(l)).join('\n')));
  vrai('le style : bouton grisé sans passe, mention Geoapify/OpenStreetMap remontée AU-DESSUS de la barre du bas (74 px + zone sûre), bouton d\'administration, boussole sous QUATRE boutons',
    /\.ctrl\.inactif\{opacity:\.55;\}/.test(css) && /\.leaflet-bottom\.leaflet-right\{margin-bottom:calc\(74px \+ var\(--sa-bottom\)\);\}/.test(css) && /\.lf-btn\.parcours-maj\{width:100%;min-height:44px/.test(css) && /\.leaflet-top\.leaflet-right\{margin-top:calc\(296px \+ var\(--sa-top\)\);\}/.test(css));
}

tousLesMondes.forEach((w) => w.fin());
console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
