// Étape 15b — L'ÉQUIPAGE AU DÉPART (www/js/equipage.js + passe.js), testé avec les VRAIS fichiers de l'application chargés dans un faux
// navigateur et un FAUX Supabase (equipage_precedent, debuter_passe avec p_equipage, equipage_ajouter).
// Ce que ces tests ne peuvent pas vérifier : le vrai Supabase (reel-etape-15.mjs) et l'affichage réel (essai dans le navigateur).
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

const MEC = 'Déneigement mécanique', CH = 'route-charette';
const LUC = { id: 'u-luc', nom: 'Luc', role: 'employe' };
const NOMS = { 'u-luc': 'Luc', 'u-marc': 'Marc', 'u-eric': 'Eric', 'u-paul': 'Paul', 'u-nina': 'Nina', 'u-joe': 'Joé' };
const PREC = [{ utilisateur_id: 'u-eric', nom: 'Eric' }, { utilisateur_id: 'u-marc', nom: 'Marc' }];   // l'équipage de ma dernière passe
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
    stops: STOPS.map((s) => ({ ...s })), routes: [{ id: CH, nom: 'Charette', couleur: '#c8e63c', actif: true }], problemes: [], positions: [],
    equipes: [{ id: 'e1', nom: 'Camion 1' }, { id: 'e2', nom: 'Camion 2' }, { id: 'e3', nom: 'Camion 3' }],
    utilisateurs: (o.employes ?? Object.keys(NOMS)).map((id) => ({ id, nom: NOMS[id], actif: true })),
    tours: o.tours ?? [], equipage_periodes: o.equipages ?? [],
  };
  const appels = { rpc: [], eq: [], toasts: [], confirmations: [], ecritures: [] };
  const nomDe = (id) => NOMS[id] ?? '?';
  let nDebuter = 0;
  const cpt = {};
  const suite = (nom, cle) => { const k = nom + '|' + cle; cpt[k] = (cpt[k] ?? 0) + 1; return cpt[k]; };
  const deja = (passe, uid) => donnees.equipage_periodes.some((p) => p.passe_id === passe && p.utilisateur_id === uid);
  const monter = (passe, uid) => { if (!deja(passe, uid)) donnees.equipage_periodes.push({ passe_id: passe, role: 'passager', utilisateur_id: uid, utilisateurs: { nom: nomDe(uid) } }); };

  const debuterServeur = (args) => {
    donnees.tours.forEach((t) => { t.passes = t.passes.filter((p) => p.chauffeur_id !== LUC.id && p.equipe_id !== args.p_equipe_id); });
    donnees.tours = donnees.tours.filter((t) => t.passes.length);
    let t = donnees.tours.find((x) => x.route_id === args.p_route_id && x.tache === args.p_tache);
    const rejoint = !!t;
    if (!t) { t = { route_id: args.p_route_id, tache: args.p_tache, numero: 1, total: 2, faits: 0, pourcentage: 0, arrets_faits: [], passes: [] }; donnees.tours.push(t); }
    t.passes.push({ passe_id: args.p_id, equipe_id: args.p_equipe_id, chauffeur_id: LUC.id, abord: [] });
    donnees.equipage_periodes.push({ passe_id: args.p_id, role: 'chauffeur', utilisateur_id: LUC.id, utilisateurs: { nom: 'Luc' } });
    const equipage = (args.p_equipage ?? []).map((m) => {
      const sc = o.equipage?.[m.utilisateur_id] ?? 'ajoute';
      if (typeof sc === 'string') { if (sc === 'ajoute' || sc === 'transfere') monter(args.p_id, m.utilisateur_id); return { utilisateur_id: m.utilisateur_id, statut: sc }; }
      return { utilisateur_id: m.utilisateur_id, ...sc };
    });
    return { data: { statut: 'debutee', passe_id: args.p_id, numero: t.numero, tache: args.p_tache, tour_rejoint: rejoint, equipage }, error: null };
  };
  const fauxDb = {
    rpc: async (nom, args) => {
      appels.rpc.push({ nom, args });
      if (nom === 'tours_en_cours') return { data: donnees.tours.map((t) => ({ ...t, passes: t.passes.map((p) => ({ passe_id: p.passe_id, equipe_id: p.equipe_id, chauffeur_id: p.chauffeur_id, je_suis_chauffeur: p.chauffeur_id === LUC.id, je_suis_a_bord: p.chauffeur_id === LUC.id })) })), error: null };
      if (nom === 'equipage_precedent') {
        if (o.precedent === 'reseau') throw new Error('Failed to fetch');
        if (o.precedent === 'erreur') return { data: null, error: { message: 'boum' } };
        return { data: { passe_id: 'p-avant', fin: new Date().toISOString(), membres: o.precedent ?? PREC }, error: null };
      }
      if (nom === 'debuter_passe') {
        nDebuter++;
        const sc = o.debuter?.[nDebuter - 1] ?? o.debuter?.defaut;
        if (sc === 'reseau') throw new Error('Failed to fetch');
        if (sc === 'reponse-perdue') { debuterServeur(args); throw new Error('Failed to fetch'); }
        if (sc?.erreur) return { data: null, error: { message: sc.erreur } };
        return debuterServeur(args);
      }
      if (nom === 'equipage_ajouter') {
        const n = suite('aj', args.p_utilisateur_id);
        const sc = o.ajouter?.[args.p_utilisateur_id]?.[n - 1] ?? 'ajoute';
        if (sc === 'reseau') throw new Error('Failed to fetch');
        if (deja(args.p_passe_id, args.p_utilisateur_id) && sc === 'ajoute') return { data: { statut: 'deja_a_bord' }, error: null };
        if (typeof sc === 'string') { if (sc === 'ajoute' || sc === 'transfere') monter(args.p_passe_id, args.p_utilisateur_id); return { data: { statut: sc }, error: null }; }
        if (sc.erreur) return { data: null, error: { message: sc.erreur } };
        return { data: sc, error: null };
      }
      return { data: null, error: { message: 'inconnu' } };
    },
    from: (table) => {
      const q = { op: 'select', filtres: [] };
      q.select = () => q; q.order = () => q; q.is = () => q;
      q.eq = (c, v) => { appels.eq.push([table, c, v]); q.filtres.push([c, v]); return q; };
      q.insert = () => { q.op = 'insert'; return q; }; q.update = () => { q.op = 'update'; return q; }; q.delete = () => { q.op = 'delete'; return q; };
      q.then = (ok_, ko_) => {
        if (q.op !== 'select') appels.ecritures.push({ table, op: q.op });
        if (o.lectureLance?.includes(table)) return Promise.reject(new Error('Failed to fetch')).then(ok_, ko_);
        const rows = (donnees[table] ?? []).filter((r) => q.filtres.every(([c, v]) => !(c in r) || r[c] === v));
        return Promise.resolve({ data: rows, error: null }).then(ok_, ko_);
      };
      return q;
    },
  };
  const sandbox = {
    document: { getElementById: el, createElement: () => creer(null) },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: { open() {} }, setTimeout, clearTimeout, setInterval, clearInterval, console,
    L: { divIcon: (opt) => opt, marker: () => { const m = { addTo() { return m; }, on() {}, setLatLng() { return m; }, setIcon() { return m; }, bindPopup() { return m; }, setPopupContent() { return m; } }; return m; }, polygon: () => ({ addTo() { return this; } }) },
    __map: { removeLayer() {}, flyTo() {} }, __fauxDb: fauxDb, setStatus() {}, hideLoading() {}, showErr() {},
    __confirmations: appels.confirmations, __toasts: appels.toasts, __reponses: o.confirme ?? [true],
    crypto: { randomUUID: (() => { let n = 0; return () => '00000000-0000-4000-8000-' + String(++n).padStart(12, '0'); })() },
  };
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/config.js', 'js/utilitaires.js', 'js/hors-reseau.js', 'js/file-attente.js', 'js/tours.js', 'js/vehicules.js', 'js/equipage.js', 'js/equipage-panneau.js', 'js/passe.js', 'js/resume-passe.js', 'js/arrets.js', 'js/routes.js', 'js/problemes.js', 'js/photos.js'])
    vm.runInContext(lire(f), ctx, { filename: f });
  vm.runInContext('db = __fauxDb; map = __map; currentUser = ' + JSON.stringify(LUC) + ';', ctx);
  vm.runInContext('toast = (m) => { __toasts.push(m); }; confirmer = async (...a) => { __confirmations.push(a); return __reponses.length > 1 ? __reponses.shift() : __reponses[0]; };', ctx);

  const parcourir = (n, f) => { for (const c of n.children) { f(c); parcourir(c, f); } };
  const w = {
    ctx, el, donnees, appels,
    run: (code) => vm.runInContext(code, ctx),
    routeActive: (id) => vm.runInContext(`routeActive = ${JSON.stringify(id)};`, ctx),
    dernierToast: () => appels.toasts[appels.toasts.length - 1],
    debuts: () => appels.rpc.filter((r) => r.nom === 'debuter_passe'),
    ajouts: () => appels.rpc.filter((r) => r.nom === 'equipage_ajouter'),
    charge: async () => { await w.run('loadStops()'); await new Promise((r) => setTimeout(r, 20)); return w; },
    // les choix de route/tâche/véhicule (boutons « debut-choix »)
    toucher: (texte) => { const l = []; parcourir(el('debut-body'), (c) => { if (String(c.className).startsWith('debut-choix')) l.push(c); }); const b = l.find((x) => x.innerHTML.includes(texte)); if (!b) throw new Error('bouton introuvable : ' + texte); return b.onclick(); },
    // les lignes de l'équipage : { nom, oui, non, retirer }
    lignes: () => { const l = []; parcourir(el('debut-body'), (c) => { if (c.className === 'debut-personne') l.push({ nom: c.children[0].textContent, oui: c.children[1], non: c.children[2] }); }); return l; },
    ligne: (nom) => w.lignes().find((x) => x.nom === nom),
    bouton: (classe) => { let r = null; parcourir(el('debut-body'), (c) => { if (c.className === classe) r = c; }); return r; },
    texteCorps: () => { const r = []; parcourir(el('debut-body'), (c) => r.push(c.textContent + c.innerHTML)); return r.join(' | '); },
    choixPersonnes: () => { const l = []; parcourir(el('choix-body'), (c) => { if (String(c.className).startsWith('choix-personne')) l.push(c); }); return l; },
    debutOuvert: () => el('debut-overlay').classList.contains('open'),
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
// Camion 2 (chauffeur Marc) : Eric et Nina sont à bord ; Marc CONDUIT
const AILLEURS = () => ({
  tours: [{ route_id: CH, tache: MEC, numero: 1, total: 2, faits: 0, pourcentage: 0, arrets_faits: [], passes: [{ passe_id: 'p-marc', equipe_id: 'e2', chauffeur_id: 'u-marc', abord: [] }] }],
  equipages: [{ passe_id: 'p-marc', role: 'chauffeur', utilisateur_id: 'u-marc', utilisateurs: { nom: 'Marc' } }, { passe_id: 'p-marc', role: 'passager', utilisateur_id: 'u-eric', utilisateurs: { nom: 'Eric' } }, { passe_id: 'p-marc', role: 'passager', utilisateur_id: 'u-nina', utilisateurs: { nom: 'Nina' } }],
});
// ouvre l'écran, choisit la route, la tâche (une seule) et le Camion 1
const ouvrir = async (o = {}) => { const m = await monde(o).charge(); m.routeActive(CH); await m.run('ouvrirDebut()'); return m; };
const pret = async (o = {}) => { const m = await ouvrir(o); m.toucher('Camion 1'); return m; };

// =====================================================================
log('=== L\'ÉCRAN : les noms de l\'équipage précédent, EN GROS, jamais pré-cochés ===');
{
  let m = await ouvrir();
  eq('l\'équipage précédent est demandé UNE fois au serveur (fonction equipage_precedent), les employés actifs sont lus', [m.appels.rpc.filter((r) => r.nom === 'equipage_precedent').length, m.appels.eq.some((e) => e[0] === 'utilisateurs' && e[1] === 'actif' && e[2] === true)], [1, true]);
  eq('les deux noms de la dernière passe sont là, dans l\'ordre reçu', m.lignes().map((l) => l.nom), ['Eric', 'Marc']);
  eq('AUCUN n\'est pré-coché : ni « À bord » ni « Pas à bord »', m.lignes().map((l) => [l.oui.className, l.non.className]), [['debut-oui', 'debut-non'], ['debut-oui', 'debut-non']]);
  vrai('un bouton distinct « ✔ Tous à bord » et un bouton « ＋ Quelqu’un d’autre »', m.bouton('debut-tous')?.textContent === '✔ Tous à bord' && m.bouton('debut-ajout')?.textContent === '＋ Quelqu’un d’autre');
  m.toucher('Camion 1');
  eq('route, tâche et véhicule choisis MAIS l\'équipage pas tranché : « Démarrer » reste grisé, l\'écran dit quoi faire', [m.el('btn-demarrer').disabled, m.run('etatDebut().manque'), m.texteCorps().includes('Choisis encore : équipage.')], [true, ['équipage'], true]);
  await m.ligne('Eric').oui.onclick();
  eq('un seul nom tranché sur deux : toujours grisé', [m.el('btn-demarrer').disabled, m.ligne('Eric').oui.className, m.ligne('Marc').oui.className], [true, 'debut-oui choisi', 'debut-oui']);
  await m.ligne('Marc').non.onclick();
  eq('« Pas à bord » compte comme une décision : les deux sont tranchés, « Démarrer » s\'active', [m.el('btn-demarrer').disabled, m.ligne('Marc').non.className, m.run('etatDebut().pret')], [false, 'debut-non choisi', true]);
  await m.ligne('Marc').oui.onclick();
  eq('on peut changer d\'avis (Marc passe de « Pas à bord » à « À bord »)', [m.ligne('Marc').oui.className, m.ligne('Marc').non.className], ['debut-oui choisi', 'debut-non']);

  m = await pret();
  await m.bouton('debut-tous').onclick();
  eq('« ✔ Tous à bord » : tout le monde est « À bord » en un toucher, « Démarrer » s\'active', [m.lignes().map((l) => l.oui.className), m.el('btn-demarrer').disabled], [['debut-oui choisi', 'debut-oui choisi'], false]);

  m = await pret({ precedent: [] });
  eq('aucun équipage précédent : le dit, « Démarrer » n\'est pas bloqué, « Quelqu’un d’autre » reste offert', [m.texteCorps().includes('Personne d’autre à bord de ta dernière passe.'), m.el('btn-demarrer').disabled, !!m.bouton('debut-ajout')], [true, false, true]);
  for (const [nom, o] of [['réseau coupé', { precedent: 'reseau' }], ['erreur du serveur', { precedent: 'erreur' }]]) {
    m = await pret(o);
    eq(`équipage précédent illisible (${nom}) : le dit, le départ n'est PAS bloqué (on ajoute du monde après)`, [m.texteCorps().includes('Équipage précédent indisponible'), m.el('btn-demarrer').disabled, m.lignes().length], [true, false, 0]);
  }
  vrai('les noms venant de la base sont affichés comme du TEXTE', (() => { const x = monde({ precedent: [{ utilisateur_id: 'u-eric', nom: '<img src=x onerror=alert(1)>' }] }); return true; })());
  m = await ouvrir({ precedent: [{ utilisateur_id: 'u-eric', nom: '<img src=x onerror=alert(1)>' }] });
  eq('… (un nom piégé est du texte simple, jamais du code)', [m.lignes()[0].nom, m.el('debut-body').children.some((c) => (c.innerHTML || '').includes('<img'))], ['<img src=x onerror=alert(1)>', false]);
}

log('\n=== DÉJÀ À BORD D\'UN AUTRE VÉHICULE : la question NOMME le véhicule ===');
{
  const eric = { precedent: [{ utilisateur_id: 'u-eric', nom: 'Eric' }, { utilisateur_id: 'u-marc', nom: 'Marc' }, { utilisateur_id: 'u-paul', nom: 'Paul' }] };
  let m = await pret({ ...AILLEURS(), ...eric, confirme: [true] });
  await m.ligne('Eric').oui.onclick();
  eq('Eric est à bord de « Camion 2 » : la boîte le dit, demande s\'il change de véhicule (« Non » par défaut)', m.appels.confirmations, [['Faire monter Eric ?', 'Eric est à bord de « Camion 2 ». Le faire monter avec toi le fait quitter ce véhicule.', 'Oui, le faire monter', 'Non']]);
  eq('« Oui » : Eric est « À bord », marqué pour un TRANSFERT (forcer)', [m.ligne('Eric').oui.className, m.run('_debut.equipage.choix["u-eric"].forcer')], ['debut-oui choisi', true]);
  m = await pret({ ...AILLEURS(), ...eric, confirme: [false] });
  await m.ligne('Eric').oui.onclick();
  eq('« Non » : rien ne change pour Eric (il reste où il est) et il est tranché « Pas à bord »', [m.ligne('Eric').non.className, m.ligne('Eric').oui.className, m.run('_debut.equipage.choix["u-eric"].etat')], ['debut-non choisi', 'debut-oui', 'pas']);
  m = await pret({ ...AILLEURS(), ...eric, confirme: [true] });
  await m.ligne('Marc').oui.onclick();
  eq('Marc CONDUIT « Camion 2 » : on ne peut pas le faire monter (message clair, aucune question), tranché « Pas à bord »', [m.dernierToast(), m.appels.confirmations.length, m.ligne('Marc').non.className], ['⚠ Marc conduit déjà « Camion 2 »', 0, 'debut-non choisi']);
  await m.ligne('Paul').oui.onclick();
  eq('Paul est libre : « À bord » sans aucune question', [m.appels.confirmations.length, m.ligne('Paul').oui.className], [0, 'debut-oui choisi']);
  eq('« Non » ou « pas à bord » ne demandent rien', (await m.ligne('Paul').non.onclick(), m.appels.confirmations.length), 0);

  m = await pret({ ...AILLEURS(), ...eric, confirme: [true, false] });
  await m.bouton('debut-tous').onclick();
  eq('« Tous à bord » : les personnes déjà à bord ailleurs sont demandées UNE PAR UNE (Eric : oui, puis Marc conduit : refusé sans question, Paul libre)', [m.appels.confirmations.map((c) => c[0]), m.lignes().map((l) => l.oui.className.includes('choisi') ? 'abord' : 'pas')], [['Faire monter Eric ?'], ['abord', 'pas', 'abord']]);
  m = await pret({ ...AILLEURS(), ...eric, confirme: [false] });
  const p1 = m.bouton('debut-tous').onclick(); const p2 = m.bouton('debut-tous').onclick(); await Promise.all([p1, p2]);
  eq('deux touchers d\'un coup sur « Tous à bord » : une seule série de questions', m.appels.confirmations.length, 1);
}

log('\n=== « ＋ QUELQU\'UN D\'AUTRE » : la liste des employés actifs ===');
{
  let m = await pret();
  m.bouton('debut-ajout').onclick();
  eq('la liste : les employés actifs, sans moi, sans ceux déjà dans l\'équipage précédent', m.choixPersonnes().map((b) => b.innerHTML), ['Joé', 'Nina', 'Paul']);
  vrai('la fenêtre est ouverte, avec son titre', m.el('choix-overlay').classList.contains('open') && m.el('choix-title').textContent === 'Qui monte avec toi ?');
  await m.choixPersonnes().find((b) => b.innerHTML === 'Paul').onclick();
  eq('toucher « Paul » : la fenêtre se ferme, Paul est ajouté « À bord » (pas de question : il est libre)', [m.el('choix-overlay').classList.contains('open'), m.ligne('Paul')?.oui.className, m.appels.confirmations.length], [false, 'debut-oui choisi', 0]);
  m.bouton('debut-ajout').onclick();
  eq('Paul ne figure plus dans la liste', m.choixPersonnes().map((b) => b.innerHTML), ['Joé', 'Nina']);
  m.run('fermerChoixPersonne()');
  eq('« ✕ Retirer » sur un ajout : il disparaît de l\'équipage', (m.ligne('Paul').non.onclick(), m.ligne('Paul')), undefined);
  m.bouton('debut-ajout').onclick();
  eq('… et revient dans la liste', m.choixPersonnes().map((b) => b.innerHTML), ['Joé', 'Nina', 'Paul']);
  m.run('bgClickChoix({target: document.getElementById("choix-overlay")})');
  eq('toucher en dehors ferme la fenêtre sans rien ajouter', [m.el('choix-overlay').classList.contains('open'), m.lignes().length], [false, 2]);

  m = await pret({ ...AILLEURS(), confirme: [true], precedent: [] });
  m.bouton('debut-ajout').onclick();
  const nina = m.choixPersonnes().find((b) => b.innerHTML.startsWith('Nina')), marc = m.choixPersonnes().find((b) => b.innerHTML.startsWith('Marc'));
  vrai('la liste MARQUE ceux qui sont déjà à bord ailleurs, en nommant le véhicule (et ceux qui conduisent)', nina.innerHTML.includes('à bord de « Camion 2 »') && marc.innerHTML.includes('conduit « Camion 2 »') && nina.className.includes('ailleurs'), nina.innerHTML + ' / ' + marc.innerHTML);
  await nina.onclick();
  eq('ajouter Nina (à bord de Camion 2) : la question NOMME le véhicule ; « Oui » : ajoutée, prévue pour un transfert', [m.appels.confirmations[0][0], m.appels.confirmations[0][1], m.run('_debut.equipage.extras[0].forcer')], ['Faire monter Nina ?', 'Nina est à bord de « Camion 2 ». Le faire monter avec toi le fait quitter ce véhicule.', true]);
  m.bouton('debut-ajout').onclick();
  await m.choixPersonnes().find((b) => b.innerHTML.startsWith('Marc')).onclick();
  eq('Marc conduit Camion 2 : refusé avec un message clair, pas ajouté', [m.dernierToast(), m.run('_debut.equipage.extras.length')], ['⚠ Marc conduit déjà « Camion 2 »', 1]);

  m = await pret({ ...AILLEURS(), confirme: [false], precedent: [] });
  m.bouton('debut-ajout').onclick();
  await m.choixPersonnes().find((b) => b.innerHTML.startsWith('Nina')).onclick();
  eq('« Non » à la question : Nina n\'est PAS ajoutée', m.run('_debut.equipage.extras.length'), 0);

  m = await pret({ employes: ['u-luc'], precedent: [] });
  m.bouton('debut-ajout').onclick();
  eq('personne d\'autre dans la liste : « Tout le monde est déjà là. »', m.el('choix-body').children[0].textContent, 'Tout le monde est déjà là.');
  m = await pret({ lectureLance: ['utilisateurs'], precedent: [] });
  m.bouton('debut-ajout').onclick();
  eq('liste des employés illisible (réseau) : le dit clairement', m.el('choix-body').children[0].textContent, 'Liste des employés indisponible. Vérifie la connexion, puis réessaie.');
}

log('\n=== DÉMARRER AVEC L\'ÉQUIPAGE ===');
{
  let m = await pret();
  await m.ligne('Eric').oui.onclick(); await m.ligne('Marc').non.onclick();
  m.bouton('debut-ajout').onclick(); await m.choixPersonnes().find((b) => b.innerHTML === 'Paul').onclick();
  await m.run('demarrerPasse()');
  const a = m.debuts()[0].args;
  eq('l\'équipage envoyé : Eric (tranché « à bord ») et Paul (ajouté), PAS Marc (« pas à bord ») ; chacun avec une clé unique et « forcer » faux', [a.p_equipage.map((x) => x.utilisateur_id), a.p_equipage.every((x) => UUID.test(x.cle_client) && x.forcer === false), new Set(a.p_equipage.map((x) => x.cle_client)).size], [['u-eric', 'u-paul'], true, 2]);
  eq('le reste de l\'appel est inchangé (route, véhicule, tâche)', [a.p_route_id, a.p_equipe_id, a.p_tache], [CH, 'e1', MEC]);
  eq('message : passe débutée, 2 à bord', m.dernierToast(), '▶ Passe n° 1 débutée · 2 à bord');
  eq('ils sont vraiment à bord (l\'équipage est relu)', m.run('equipages[tours[0].passes[0].passe_id].map(x => x.nom)'), ['Luc', 'Eric', 'Paul']);
  eq('aucune écriture directe dans l\'équipage', m.appels.ecritures, []);

  m = await pret({ precedent: [] });
  await m.run('demarrerPasse()');
  eq('personne d\'autre à bord : AUCUN « p_equipage » envoyé (le départ est celui d\'avant), message habituel', ['p_equipage' in m.debuts()[0].args, m.dernierToast()], [false, '▶ Passe n° 1 débutée']);

  m = await pret({ ...AILLEURS(), confirme: [true] });
  await m.ligne('Eric').oui.onclick(); await m.ligne('Marc').non.onclick();
  await m.run('demarrerPasse()');
  eq('Eric était à bord de Camion 2 et le chauffeur a dit « Oui » : envoyé avec « forcer » (transfert) — la question est déjà posée, pas de 2e question', [m.debuts()[0].args.p_equipage, m.appels.confirmations.length].map((x, i) => (i === 0 ? x.map((y) => [y.utilisateur_id, y.forcer]) : x)), [[['u-eric', true]], 1]);
  eq('… le message compte la personne à bord (ici Luc rejoint la passe de Marc : même route, même tâche)', m.dernierToast(), '🤝 Tu as rejoint la passe n° 1 · 1 à bord');
}

log('\n=== LES RÉPONSES DU SERVEUR : avertissements, refus, erreurs ===');
{
  const tous = async (o) => { const m = await pret(o); await m.bouton('debut-tous').onclick(); return m; };
  // Quart terminé depuis peu (donné par le serveur)
  let m = await tous({ precedent: [{ utilisateur_id: 'u-paul', nom: 'Paul' }], equipage: { 'u-paul': { statut: 'avertissement', avertissements: [{ type: 'quart_termine', fin: new Date(Date.now() - 90 * 60000).toISOString() }] } }, confirme: [true] });
  await m.run('demarrerPasse()');
  eq('le serveur avertit : Paul a terminé son quart il y a 2 h — question NOMMÉE', m.appels.confirmations, [['Faire monter Paul ?', 'Paul a terminé son quart il y a 2 h. Le faire monter quand même ?', 'Oui, le faire monter', 'Non']]);
  const aj = m.ajouts();
  eq('« Oui » : nouveau geste equipage_ajouter avec « forcer » et la MÊME clé que celle du départ', [aj.length, aj[0].args.p_utilisateur_id, aj[0].args.p_forcer, aj[0].args.p_cle_client === m.debuts()[0].args.p_equipage[0].cle_client], [1, 'u-paul', true, true]);
  eq('… Paul est à bord, le message le compte', [m.dernierToast(), m.run('equipages[tours[0].passes[0].passe_id].map(x => x.nom)')], ['▶ Passe n° 1 débutée · 1 à bord', ['Luc', 'Paul']]);

  m = await tous({ precedent: [{ utilisateur_id: 'u-paul', nom: 'Paul' }], equipage: { 'u-paul': { statut: 'avertissement', avertissements: [{ type: 'quart_termine', fin: new Date(Date.now() - 30 * 60000).toISOString() }] } }, confirme: [false] });
  await m.run('demarrerPasse()');
  eq('« Non » : Paul ne monte pas, aucun autre geste, le message le dit', [m.ajouts().length, m.dernierToast(), m.run('equipages[tours[0].passes[0].passe_id].map(x => x.nom)')], [0, '▶ Passe n° 1 débutée · ⚠ 1 pas monté', ['Luc']]);

  // Conflit imprévu (la situation a changé pendant l'écran)
  m = await tous({ precedent: [{ utilisateur_id: 'u-eric', nom: 'Eric' }], equipage: { 'u-eric': { statut: 'avertissement', avertissements: [{ type: 'conflit_vehicule', vehicule: 'Camion 3' }, { type: 'quart_termine', fin: new Date(Date.now() - 60 * 60000).toISOString() }] } }, confirme: [true] });
  await m.run('demarrerPasse()');
  eq('deux avertissements : UNE seule question qui nomme le véhicule ET le quart', m.appels.confirmations[0][1], 'Eric est à bord de « Camion 3 » : le faire monter le fait quitter ce véhicule. Eric a terminé son quart il y a 1 h. Le faire monter quand même ?');

  // Refus : le chauffeur d'un autre véhicule
  m = await tous({ precedent: [{ utilisateur_id: 'u-marc', nom: 'Marc' }], equipage: { 'u-marc': { statut: 'refuse', raison: 'chauffeur_ailleurs', vehicule: 'Camion 2' } } });
  await m.run('demarrerPasse()');
  eq('refus « chauffeur ailleurs » : message clair (personne n\'est forcé), pas monté', [m.appels.toasts.includes('⚠ Marc conduit déjà « Camion 2 ».'), m.dernierToast(), m.appels.confirmations.length], [true, '▶ Passe n° 1 débutée · ⚠ 1 pas monté', 0]);
  m = await tous({ precedent: [{ utilisateur_id: 'u-marc', nom: 'Marc' }, { utilisateur_id: 'u-eric', nom: 'Eric' }], equipage: { 'u-marc': { statut: 'erreur', message: 'utilisateur_inactif' } } });
  await m.run('demarrerPasse()');
  eq('une erreur pour une personne (ex. désactivée entre-temps) : les autres montent quand même, le message compte 1 à bord et 1 pas monté', m.dernierToast(), '▶ Passe n° 1 débutée · 1 à bord · ⚠ 1 pas monté');
  m = await tous({ precedent: [{ utilisateur_id: 'u-marc', nom: 'Marc' }, { utilisateur_id: 'u-eric', nom: 'Eric' }, { utilisateur_id: 'u-paul', nom: 'Paul' }], equipage: { 'u-marc': 'deja_a_bord' } });
  await m.run('demarrerPasse()');
  eq('« déjà à bord » compte comme monté (geste renvoyé)', m.dernierToast(), '▶ Passe n° 1 débutée · 3 à bord');

  // La réponse du départ se perd : le serveur avait créé la passe et déjà monté l'équipage
  m = await tous({ debuter: { 0: 'reponse-perdue' } });
  await m.run('demarrerPasse()');
  const aj2 = m.ajouts();
  eq('la réponse du départ se perd : l\'application retrouve la passe, puis refait CHAQUE ajout avec la MÊME clé (jamais de doublon : « déjà à bord »)', [m.debuts().length, aj2.length, aj2.map((x) => x.args.p_cle_client).sort().join() === m.debuts()[0].args.p_equipage.map((x) => x.cle_client).sort().join(), m.dernierToast()], [1, 2, true, '▶ Passe n° 1 débutée · 2 à bord']);
  eq('… et personne n\'est ajouté deux fois', m.donnees.equipage_periodes.filter((p) => p.role === 'passager').length, 2);
  m = await tous({ debuter: { 0: 'reponse-perdue' }, ajouter: { 'u-eric': ['reseau'] } });
  await m.run('demarrerPasse()');
  eq('… un ajout qui échoue au réseau : compté « pas monté » sans plantage', m.dernierToast(), '▶ Passe n° 1 débutée · 1 à bord · ⚠ 1 pas monté');

  // Échec du départ : l'équipage choisi n'est pas perdu, mêmes clés au nouvel essai
  m = await tous({ debuter: { 0: 'reseau' } });
  await m.run('demarrerPasse()');
  const cles1 = m.debuts()[0].args.p_equipage.map((x) => x.cle_client);
  eq('le départ échoue (réseau) : un message, l\'écran reste ouvert avec l\'équipage tel qu\'il était choisi', [m.dernierToast(), m.debutOuvert(), m.lignes().map((l) => l.oui.className)], ['❌ Pas de réseau ou erreur. Réessaie.', true, ['debut-oui choisi', 'debut-oui choisi']]);
  await m.run('demarrerPasse()');
  eq('au nouvel essai : les MÊMES clés (un renvoi ne peut pas doubler un ajout)', [m.debuts()[1].args.p_equipage.map((x) => x.cle_client), m.dernierToast()], [cles1, '▶ Passe n° 1 débutée · 2 à bord']);
}

log('\n=== LE CODE : la page, aucune écriture directe ===');
{
  const html = lire('index.html'), css = lire('css/style.css'), fichiers = fs.readdirSync(WWW + 'js').filter((f) => f.endsWith('.js'));
  const sansCommentaires = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  vrai('la page charge equipage.js avant passe.js', html.indexOf('js/equipage.js') > 0 && html.indexOf('js/equipage.js') < html.indexOf('js/passe.js'));
  vrai('la page a la fenêtre de choix d\'une personne', ['id="choix-overlay"', 'id="choix-title"', 'id="choix-body"', 'onclick="fermerChoixPersonne()"', 'onclick="bgClickChoix(event)"'].every((x) => html.includes(x)));
  vrai('aucune écriture directe dans equipage_periodes / equipage_journal / quarts depuis l\'application (uniquement les fonctions du serveur)', !fichiers.some((f) => /from\(\s*['"](equipage_periodes|equipage_journal|quarts)['"]\s*\)\s*\.\s*(insert|update|delete|upsert)/.test(sansCommentaires(lire('js/' + f)))));
  vrai('les noms de l\'équipage sont mis dans la page par textContent ou esc() (jamais brut)', /nom\.textContent=p\.nom/.test(lire('js/passe.js')) && /esc\(e\.nom\)/.test(lire('js/equipage.js')));
  vrai('les noms de l\'équipage font au moins 24 px et les boutons 52 px de haut (au doigt, camion en mouvement)', /\.debut-nom\{[^}]*font-size:24px/.test(css) && /\.debut-oui,\.debut-non\{[^}]*min-height:52px/.test(css) && /\.debut-tous\{[^}]*min-height:52px/.test(css));
  vrai('la fenêtre de choix passe au-dessus de l\'écran « Débuter » (z-index plus haut)', (() => { const a = +css.match(/#debut-overlay\{[^}]*z-index:(\d+)/)[1], b = +css.match(/#choix-overlay\{[^}]*z-index:(\d+)/)[1]; return b > a; })());
}

tousLesMondes.forEach((w) => w.fin());
console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
