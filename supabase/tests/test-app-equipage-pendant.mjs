// Étape 15c — L'ÉQUIPAGE PENDANT LA PASSE (www/js/equipage-panneau.js + passe.js), testé avec les VRAIS fichiers de l'application chargés
// dans un faux navigateur et un FAUX Supabase (equipage_ajouter, equipage_retirer, tours_en_cours).
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
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const MEC = 'Déneigement mécanique', CH = 'route-charette';
const NOMS = { 'u-luc': 'Luc', 'u-marc': 'Marc', 'u-eric': 'Eric', 'u-paul': 'Paul', 'u-nina': 'Nina', 'u-joe': 'Joé' };
const utilisateur = (id) => ({ id, nom: NOMS[id], role: id === 'u-joe' ? 'admin' : 'employe' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function monde(o = {}) {
  const moi = utilisateur(o.moi ?? 'u-luc');
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
  // Camion 1 : Luc conduit, Eric et Paul à bord. Camion 2 : Marc conduit, Nina à bord.
  const periodes = () => [
    { passe_id: 'p-luc', role: 'chauffeur', utilisateur_id: 'u-luc' }, { passe_id: 'p-luc', role: 'passager', utilisateur_id: 'u-eric' }, { passe_id: 'p-luc', role: 'passager', utilisateur_id: 'u-paul' },
    { passe_id: 'p-marc', role: 'chauffeur', utilisateur_id: 'u-marc' }, { passe_id: 'p-marc', role: 'passager', utilisateur_id: 'u-nina' },
  ].map((p) => ({ ...p, utilisateurs: { nom: NOMS[p.utilisateur_id] } }));
  const donnees = {
    stops: STOPS.map((s) => ({ ...s })), routes: [{ id: CH, nom: 'Charette', couleur: '#c8e63c', actif: true }], problemes: [], positions: [],
    equipes: [{ id: 'e1', nom: 'Camion 1' }, { id: 'e2', nom: 'Camion 2' }],
    utilisateurs: Object.keys(NOMS).map((id) => ({ id, nom: NOMS[id], actif: true })),
    tours: o.tours ?? [{ route_id: CH, tache: MEC, numero: 1, total: 2, faits: 1, pourcentage: 50, arrets_faits: ['s1'],
      passes: [{ passe_id: 'p-luc', equipe_id: 'e1', chauffeur_id: 'u-luc' }, { passe_id: 'p-marc', equipe_id: 'e2', chauffeur_id: 'u-marc' }] }],
    equipage_periodes: o.equipages ?? periodes(),
  };
  const appels = { rpc: [], toasts: [], confirmations: [], ecritures: [] };
  const nomDe = (id) => NOMS[id] ?? '?';
  const cpt = {};
  const suite = (nom, cle) => { const k = nom + '|' + cle; cpt[k] = (cpt[k] ?? 0) + 1; return cpt[k]; };
  const deja = (passe, uid) => donnees.equipage_periodes.some((p) => p.passe_id === passe && p.utilisateur_id === uid);
  const monter = (passe, uid, transfert) => {
    if (transfert) donnees.equipage_periodes = donnees.equipage_periodes.filter((p) => p.utilisateur_id !== uid);   // il quitte son autre camion
    if (!deja(passe, uid)) donnees.equipage_periodes.push({ passe_id: passe, role: 'passager', utilisateur_id: uid, utilisateurs: { nom: nomDe(uid) } });
  };
  const fauxDb = {
    rpc: async (nom, args) => {
      appels.rpc.push({ nom, args });
      if (nom === 'tours_en_cours') return { data: donnees.tours.map((t) => ({ ...t, passes: t.passes.map((p) => ({ passe_id: p.passe_id, equipe_id: p.equipe_id, chauffeur_id: p.chauffeur_id,
        je_suis_chauffeur: p.chauffeur_id === moi.id, je_suis_a_bord: donnees.equipage_periodes.some((e) => e.passe_id === p.passe_id && e.utilisateur_id === moi.id) })) })), error: null };
      if (nom === 'equipage_ajouter') {
        const n = suite('aj', args.p_utilisateur_id);
        let sc = o.ajouter?.[args.p_utilisateur_id]?.[n - 1] ?? 'ajoute';
        if (sc === 'reseau') throw new Error('Failed to fetch');
        // (comme le vrai serveur : « forcer » une personne déjà à bord d'un AUTRE camion la TRANSFÈRE)
        if (sc === 'ajoute' && args.p_forcer && donnees.equipage_periodes.some((p) => p.utilisateur_id === args.p_utilisateur_id && p.passe_id !== args.p_passe_id)) sc = 'transfere';
        if (typeof sc === 'string') {
          if (deja(args.p_passe_id, args.p_utilisateur_id) && sc === 'ajoute') return { data: { statut: 'deja_a_bord' }, error: null };
          if (sc === 'ajoute' || sc === 'transfere') monter(args.p_passe_id, args.p_utilisateur_id, sc === 'transfere');
          return { data: { statut: sc }, error: null };
        }
        if (sc.erreur) return { data: null, error: { message: sc.erreur } };
        if (sc.statut === 'avertissement' && args.p_forcer) { monter(args.p_passe_id, args.p_utilisateur_id, true); return { data: { statut: 'transfere' }, error: null }; }
        return { data: sc, error: null };
      }
      if (nom === 'equipage_retirer') {
        const n = suite('re', args.p_utilisateur_id);
        const sc = o.retirer?.[args.p_utilisateur_id]?.[n - 1] ?? 'retire';
        if (sc === 'reseau') throw new Error('Failed to fetch');
        if (typeof sc === 'object' && sc.erreur) return { data: null, error: { message: sc.erreur } };
        const st = typeof sc === 'string' ? sc : sc.statut;
        if (st === 'retire' || st === 'annule') donnees.equipage_periodes = donnees.equipage_periodes.filter((p) => !(p.passe_id === args.p_passe_id && p.utilisateur_id === args.p_utilisateur_id));
        return { data: typeof sc === 'string' ? { statut: sc } : sc, error: null };
      }
      return { data: null, error: { message: 'inconnu' } };
    },
    from: (table) => {
      const q = { op: 'select', filtres: [] };
      q.select = () => q; q.order = () => q; q.is = () => q;
      q.eq = (c, v) => { q.filtres.push([c, v]); return q; };
      q.insert = () => { q.op = 'insert'; return q; }; q.update = () => { q.op = 'update'; return q; }; q.delete = () => { q.op = 'delete'; return q; };
      q.then = (ok_, ko_) => {
        if (q.op !== 'select') appels.ecritures.push({ table, op: q.op });
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
  for (const f of ['js/config.js', 'js/utilitaires.js', 'js/hors-reseau.js', 'js/tours.js', 'js/vehicules.js', 'js/equipage.js', 'js/equipage-panneau.js', 'js/passe.js', 'js/resume-passe.js', 'js/arrets.js', 'js/routes.js', 'js/problemes.js', 'js/photos.js'])
    vm.runInContext(lire(f), ctx, { filename: f });
  vm.runInContext('db = __fauxDb; map = __map; currentUser = ' + JSON.stringify(moi) + ';', ctx);
  vm.runInContext('toast = (m) => { __toasts.push(m); }; confirmer = async (...a) => { __confirmations.push(a); return __reponses.length > 1 ? __reponses.shift() : __reponses[0]; };', ctx);

  const parcourir = (n, f) => { for (const c of n.children) { f(c); parcourir(c, f); } };
  const w = {
    ctx, el, donnees, appels,
    run: (code) => vm.runInContext(code, ctx),
    dernierToast: () => appels.toasts[appels.toasts.length - 1],
    ajouts: () => appels.rpc.filter((r) => r.nom === 'equipage_ajouter'),
    retraits: () => appels.rpc.filter((r) => r.nom === 'equipage_retirer'),
    bandeau: () => el('passe-bandeau').innerHTML,
    ouvert: () => el('equipage-overlay').classList.contains('open'),
    charge: async () => { await w.run('loadStops()'); await attendre(20); return w; },
    // les lignes du panneau : { nom, retirer (bouton ou undefined), role }
    lignes: () => el('equipage-body').children.filter((c) => c.className === 'eq-ligne').map((c) => ({ nom: c.children[0].textContent, retirer: c.children.find((x) => x.className === 'eq-retirer'), role: c.children.find((x) => x.className === 'eq-role')?.textContent })),
    ligne: (nom) => w.lignes().find((x) => x.nom.startsWith(nom)),
    choix: () => { const l = []; parcourir(el('choix-body'), (c) => { if (String(c.className).startsWith('choix-personne')) l.push(c); }); return l; },
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
const ouvrir = async (o = {}) => { const m = await monde(o).charge(); await m.run('ouvrirEquipage()'); return m; };

// =====================================================================
log('=== LE BOUTON « 👤 ÉQUIPAGE » DU BANDEAU ===');
{
  let m = await monde().charge();
  vrai('chauffeur : « 👤 Équipage · 3 à bord » (lui, Eric, Paul), à côté de « Terminer la passe »', m.bandeau().includes('id="btn-equipage"') && m.bandeau().includes('onclick="ouvrirEquipage()"') && m.bandeau().includes('👤 Équipage · 3 à bord') && m.bandeau().includes('btn-terminer'), m.bandeau());
  m = await monde({ moi: 'u-eric' }).charge();
  vrai('passager (Eric, à bord du camion de Luc) : le même bouton, SANS « Terminer », et « Débuter ma propre passe » plus discret', m.bandeau().includes('👤 Équipage · 3 à bord') && !m.bandeau().includes('btn-terminer') && m.bandeau().includes('secondaire'), m.bandeau());
  m = await monde({ moi: 'u-joe' }).charge();
  vrai('quelqu\'un qui n\'est à bord d\'aucun camion : pas de bouton « Équipage »', !m.bandeau().includes('btn-equipage') && m.bandeau().includes('btn-debuter'), m.bandeau());
  m = await monde({ equipages: [] }).charge();
  vrai('équipage pas encore lu : « 👤 Équipage » sans nombre (jamais « 0 à bord » ni « undefined »)', m.bandeau().includes('👤 Équipage</button>') && !m.bandeau().includes('undefined'), m.bandeau());
  m = await monde().charge();
  m.donnees.equipage_periodes.push({ passe_id: 'p-luc', role: 'passager', utilisateur_id: 'u-joe', utilisateurs: { nom: 'Joé' } });
  await m.run('planifierRechargementEquipages()'); await attendre(450);
  vrai('quelqu\'un monte sur un autre téléphone : le nombre passe à 4, sans rien toucher', m.bandeau().includes('👤 Équipage · 4 à bord'), m.bandeau());
}

log('\n=== LE PANNEAU : la liste de l\'équipage ===');
{
  let m = await ouvrir();
  eq('le panneau s\'ouvre, avec le camion et la passe', [m.ouvert(), m.el('equipage-sub').textContent], [true, '🚜 Camion 1 · Passe n° 1']);
  eq('la liste : le chauffeur d\'abord (« toi », étiquette Chauffeur, aucun bouton), puis les passagers en ordre alphabétique', m.lignes().map((l) => [l.nom, l.role ?? null, !!l.retirer]), [['Luc (toi)', '🚜 Chauffeur', false], ['Eric', null, true], ['Paul', null, true]]);
  eq('le chauffeur voit le bouton « ＋ AJOUTER »', m.el('btn-equipage-ajouter').style.display, 'flex');
  m.run('fermerEquipage()');
  eq('« FERMER » ferme le panneau', m.ouvert(), false);
  await m.run('ouvrirEquipage()'); m.run('bgClickEquipage({target: document.getElementById("equipage-overlay")})');
  eq('toucher en dehors le ferme aussi', m.ouvert(), false);
  await m.run('ouvrirEquipage()'); m.run('bgClickEquipage({target: {}})');
  eq('toucher dans le panneau ne le ferme pas', m.ouvert(), true);

  m = await ouvrir({ moi: 'u-eric' });
  eq('un PASSAGER voit la liste SANS aucun bouton « Retirer », avec la note « Seul le chauffeur modifie l\'équipage »', [m.lignes().map((l) => [l.nom, !!l.retirer]), m.el('equipage-body').children.some((c) => c.textContent === 'Seul le chauffeur modifie l’équipage.'), m.el('btn-equipage-ajouter').style.display], [[['Luc', false], ['Eric (toi)', false], ['Paul', false]], true, 'none']);
  await m.run('ajouterAuVehicule()');
  eq('… et « ajouter » ne fait rien pour un passager (aucune fenêtre de choix)', m.el('choix-overlay').classList.contains('open'), false);
  await m.run('retirerDuVehicule("u-paul")');
  eq('… ni « retirer » (aucune question, aucun appel)', [m.appels.confirmations.length, m.retraits().length], [0, 0]);

  m = await monde({ moi: 'u-joe' }).charge(); await m.run('ouvrirEquipage()');
  eq('quelqu\'un qui n\'est dans aucun camion : le panneau ne s\'ouvre pas', m.ouvert(), false);

  m = await monde().charge(); m.run('currentUser = null'); await m.run('ouvrirEquipage()');
  eq('personne de connecté : rien', m.ouvert(), false);
  m = await ouvrir();
  vrai('les noms venant de la base sont du TEXTE (jamais du code)', (() => { m.donnees.equipage_periodes.push({ passe_id: 'p-luc', role: 'passager', utilisateur_id: 'u-joe', utilisateurs: { nom: '<img src=x onerror=alert(1)>' } }); return true; })());
  await m.run('planifierRechargementEquipages()'); await attendre(450);
  eq('… (un nom piégé apparaît tel quel, en texte simple)', [m.ligne('<img src=x onerror=alert(1)>') !== undefined, m.el('equipage-body').children.some((c) => (c.innerHTML || '').includes('<img'))], [true, false]);
}

log('\n=== AJOUTER QUELQU\'UN : 3 touchers (« 👤 Équipage », « ＋ AJOUTER », un nom) ===');
{
  let m = await ouvrir();
  await m.run('ajouterAuVehicule()');
  eq('la liste : les employés actifs qui ne sont PAS déjà à bord (ni moi, ni Eric, ni Paul), dans l\'ordre alphabétique', m.choix().map((b) => b.innerHTML.split('<')[0]), ['Joé', 'Marc', 'Nina']);
  vrai('… Marc (chauffeur du Camion 2) et Nina (à bord du Camion 2) sont marqués, avec le nom du véhicule', m.choix().find((b) => b.innerHTML.startsWith('Marc')).innerHTML.includes('conduit « Camion 2 »') && m.choix().find((b) => b.innerHTML.startsWith('Nina')).innerHTML.includes('à bord de « Camion 2 »'));
  await m.choix().find((b) => b.innerHTML === 'Joé').onclick();
  const a = m.ajouts()[0].args;
  eq('toucher « Joé » : UN appel equipage_ajouter — ma passe, Joé, une clé unique, pas de « forcer »', [m.ajouts().length, a.p_passe_id, a.p_utilisateur_id, UUID.test(a.p_cle_client), a.p_forcer], [1, 'p-luc', 'u-joe', true, false]);
  eq('message ; le panneau montre maintenant Joé ; le bandeau dit 4 à bord ; la fenêtre de choix est fermée', [m.dernierToast(), m.lignes().map((l) => l.nom), m.bandeau().includes('👤 Équipage · 4 à bord'), m.el('choix-overlay').classList.contains('open')], ['👤 Joé est à bord', ['Luc (toi)', 'Eric', 'Joé', 'Paul'], true, false]);
  eq('aucune écriture directe dans les tables', m.appels.ecritures, []);
  await m.run('ajouterAuVehicule()');
  eq('Joé n\'est plus proposé', m.choix().map((b) => b.innerHTML.split('<')[0]), ['Marc', 'Nina']);

  // Déjà à bord d'un autre camion : la question NOMME le véhicule
  m = await ouvrir({ ajouter: { 'u-nina': [{ statut: 'avertissement', avertissements: [{ type: 'conflit_vehicule', vehicule: 'Camion 2' }] }] }, confirme: [true] });
  await m.run('ajouterAuVehicule()');
  await m.choix().find((b) => b.innerHTML.startsWith('Nina')).onclick();
  eq('Nina est à bord de Camion 2 : le serveur avertit, la boîte NOMME le véhicule et demande si elle change', m.appels.confirmations, [['Faire monter Nina ?', 'Nina est à bord de « Camion 2 » : le faire monter le fait quitter ce véhicule. Le faire monter quand même ?', 'Oui, le faire monter', 'Non']]);
  eq('« Oui » : le même geste est refait avec « forcer » et la MÊME clé ; Nina est TRANSFÉRÉE (elle quitte Camion 2)', [m.ajouts().length, m.ajouts()[1].args.p_forcer, m.ajouts()[1].args.p_cle_client === m.ajouts()[0].args.p_cle_client, m.dernierToast(), m.donnees.equipage_periodes.filter((p) => p.utilisateur_id === 'u-nina').map((p) => p.passe_id)], [2, true, true, '👤 Nina transféré depuis Camion 2', ['p-luc']]);
  m = await ouvrir({ ajouter: { 'u-nina': [{ statut: 'avertissement', avertissements: [{ type: 'conflit_vehicule', vehicule: 'Camion 2' }] }] }, confirme: [false] });
  await m.run('ajouterAuVehicule()'); await m.choix().find((b) => b.innerHTML.startsWith('Nina')).onclick();
  eq('« Non » : rien ne change (un seul appel, Nina reste dans Camion 2, aucun message)', [m.ajouts().length, m.donnees.equipage_periodes.filter((p) => p.utilisateur_id === 'u-nina').map((p) => p.passe_id), m.appels.toasts.length], [1, ['p-marc'], 0]);

  // Quart terminé depuis peu
  m = await ouvrir({ ajouter: { 'u-joe': [{ statut: 'avertissement', avertissements: [{ type: 'quart_termine', fin: new Date(Date.now() - 120 * 60000).toISOString() }] }] }, confirme: [true] });
  await m.run('ajouterAuVehicule()'); await m.choix().find((b) => b.innerHTML === 'Joé').onclick();
  eq('quart terminé il y a 2 h : question nommée', m.appels.confirmations[0].slice(0, 2), ['Faire monter Joé ?', 'Joé a terminé son quart il y a 2 h. Le faire monter quand même ?']);
  eq('« Oui » : il monte (nouvelle personne à bord)', m.lignes().some((l) => l.nom === 'Joé'), true);

  // Refus, déjà là, erreurs
  m = await ouvrir({ ajouter: { 'u-marc': [{ statut: 'refuse', raison: 'chauffeur_ailleurs', vehicule: 'Camion 2' }] } });
  await m.run('ajouterAuVehicule()'); await m.choix().find((b) => b.innerHTML.startsWith('Marc')).onclick();
  eq('Marc conduit Camion 2 (refusé par le serveur) : message clair, personne n\'est ajouté', [m.dernierToast(), m.lignes().length], ['⚠ Marc conduit déjà « Camion 2 ».', 3]);
  for (const [code, texte] of [['non_autorise', 'Seul le chauffeur de la passe peut modifier l’équipage.'], ['utilisateur_inactif', 'Cette personne n’est plus active.'], ['passe_introuvable', 'Cette passe n’existe plus.'], ['n\'importe quoi', 'Pas de réseau ou erreur. Réessaie.']]) {
    const x = await ouvrir({ ajouter: { 'u-joe': [{ erreur: code }] } });
    await x.run('ajouterAuVehicule()'); await x.choix().find((b) => b.innerHTML === 'Joé').onclick();
    eq(`refus « ${code} » : message en français, rien ne change`, [x.dernierToast(), x.lignes().length], ['❌ ' + texte, 3]);
  }
  m = await ouvrir({ ajouter: { 'u-joe': ['reseau'] } });
  await m.run('ajouterAuVehicule()'); await m.choix().find((b) => b.innerHTML === 'Joé').onclick();
  eq('réseau coupé : message, rien ne change, aucun plantage', [m.dernierToast(), m.lignes().length], ['❌ Pas de réseau ou erreur. Réessaie.', 3]);
  await m.run('ajouterAuVehicule()'); await m.choix().find((b) => b.innerHTML === 'Joé').onclick();
  eq('… on réessaie : ça marche', [m.dernierToast(), m.lignes().length], ['👤 Joé est à bord', 4]);
  m = await ouvrir({ ajouter: { 'u-joe': ['deja_a_bord'] } });
  await m.run('ajouterAuVehicule()'); await m.choix().find((b) => b.innerHTML === 'Joé').onclick();
  eq('le serveur répond « déjà à bord » (geste renvoyé) : message adapté', m.dernierToast(), '👤 Joé était déjà à bord');
  m = await ouvrir();
  const p1 = m.run('ajouterPersonneAuVehicule("p-luc", {utilisateur_id: "u-joe", nom: "Joé"})'), p2 = m.run('ajouterPersonneAuVehicule("p-luc", {utilisateur_id: "u-joe", nom: "Joé"})');
  await Promise.all([p1, p2]);
  eq('deux touchers d\'un coup : UN seul appel', m.ajouts().length, 1);
  m = await ouvrir({ employes: [] });
  m.donnees.utilisateurs = [];
  await m.run('employes = []'); await m.run('ajouterAuVehicule()');
  eq('liste des employés vide : le dit clairement', m.el('choix-body').children[0].textContent, 'Liste des employés indisponible. Vérifie la connexion, puis réessaie.');
}

log('\n=== RETIRER QUELQU\'UN : une confirmation ===');
{
  let m = await ouvrir({ confirme: [false] });
  await m.ligne('Eric').retirer.onclick();
  eq('toucher « ✕ Retirer » : la boîte nomme la personne et le camion ; « Non » : rien n\'est envoyé', [m.appels.confirmations, m.retraits().length], [[['Retirer Eric ?', 'Eric descend de « Camion 1 » maintenant.', 'Oui, retirer', 'Non']], 0]);
  m = await ouvrir({ confirme: [true] });
  await m.ligne('Eric').retirer.onclick();
  const r = m.retraits()[0].args;
  eq('« Oui » : UN appel equipage_retirer — ma passe, Eric, une clé unique', [m.retraits().length, r.p_passe_id, r.p_utilisateur_id, UUID.test(r.p_cle_client)], [1, 'p-luc', 'u-eric', true]);
  eq('message ; Eric a disparu de la liste ; le bandeau dit 2 à bord', [m.dernierToast(), m.lignes().map((l) => l.nom), m.bandeau().includes('👤 Équipage · 2 à bord')], ['👤 Eric est descendu', ['Luc (toi)', 'Paul'], true]);
  eq('aucune écriture directe dans les tables', m.appels.ecritures, []);
  await m.run('ajouterAuVehicule()');
  eq('Eric est de nouveau proposé dans la liste des employés', m.choix().some((b) => b.innerHTML.startsWith('Eric')), true);

  m = await ouvrir({ confirme: [true], retirer: { 'u-eric': [{ statut: 'annule', retour_vehicule_precedent: true }] } });
  await m.ligne('Eric').retirer.onclick();
  eq('retiré dans les 2 premières minutes : le serveur ANNULE l\'ajout (et le remet dans son camion d\'origine) : message adapté', m.dernierToast(), '↩ Ajout de Eric annulé · retour dans son camion');
  m = await ouvrir({ confirme: [true], retirer: { 'u-eric': [{ statut: 'annule', retour_vehicule_precedent: false }] } });
  await m.ligne('Eric').retirer.onclick();
  eq('annulation simple (pas de transfert) : message court', m.dernierToast(), '↩ Ajout de Eric annulé');
  m = await ouvrir({ confirme: [true], retirer: { 'u-eric': ['pas_a_bord'] } });
  await m.ligne('Eric').retirer.onclick();
  eq('le serveur répond « pas à bord » (déjà descendu ailleurs) : message adapté', m.dernierToast(), '👤 Eric n’était plus à bord');
  for (const [code, texte] of [['chauffeur_ne_peut_etre_retire', 'Le chauffeur ne peut pas être retiré.'], ['non_autorise', 'Seul le chauffeur de la passe peut modifier l’équipage.'], ['n\'importe quoi', 'Pas de réseau ou erreur. Réessaie.']]) {
    const x = await ouvrir({ confirme: [true], retirer: { 'u-eric': [{ erreur: code }] } });
    await x.ligne('Eric').retirer.onclick();
    eq(`refus « ${code} » : message en français, Eric reste à bord`, [x.dernierToast(), x.lignes().some((l) => l.nom === 'Eric')], ['❌ ' + texte, true]);
  }
  m = await ouvrir({ confirme: [true], retirer: { 'u-eric': ['reseau'] } });
  await m.ligne('Eric').retirer.onclick();
  eq('réseau coupé : message, Eric reste à bord', [m.dernierToast(), m.lignes().some((l) => l.nom === 'Eric')], ['❌ Pas de réseau ou erreur. Réessaie.', true]);
  await m.ligne('Eric').retirer.onclick();
  eq('… on réessaie : ça marche', m.dernierToast(), '👤 Eric est descendu');
  m = await ouvrir({ confirme: [true] });
  await m.run('retirerDuVehicule("u-luc")');
  eq('le CHAUFFEUR ne peut pas être retiré (aucune question, aucun appel)', [m.appels.confirmations.length, m.retraits().length], [0, 0]);
  await m.run('retirerDuVehicule("u-inconnu")');
  eq('quelqu\'un qui n\'est pas à bord : rien', m.retraits().length, 0);
  m = await ouvrir({ confirme: [true] });
  const q1 = m.ligne('Eric').retirer.onclick(), q2 = m.ligne('Paul').retirer.onclick();
  await Promise.all([q1, q2]);
  vrai('deux « Retirer » d\'un coup : un seul geste à la fois (le 2e est ignoré tant que le 1er n\'est pas fini)', m.retraits().length >= 1 && m.retraits().length <= 2 && m.retraits()[0].args.p_utilisateur_id === 'u-eric', m.retraits().length);
}

log('\n=== TEMPS RÉEL : le panneau et le bandeau suivent les autres téléphones ===');
{
  let m = await ouvrir();
  m.donnees.equipage_periodes.push({ passe_id: 'p-luc', role: 'passager', utilisateur_id: 'u-joe', utilisateurs: { nom: 'Joé' } });
  await m.run('planifierRechargementEquipages()'); await attendre(450);
  eq('quelqu\'un monte (autre téléphone) : le panneau ouvert le montre, sans rien toucher', m.lignes().map((l) => l.nom), ['Luc (toi)', 'Eric', 'Joé', 'Paul']);
  m.donnees.tours = [];   // ma passe se ferme (100 %, fermeture automatique…)
  await m.run('planifierRechargementTours()'); await attendre(450);
  eq('ma passe se ferme pendant que le panneau est ouvert : le panneau se ferme tout seul', m.ouvert(), false);

  m = await ouvrir({ moi: 'u-eric' });
  m.donnees.equipage_periodes = m.donnees.equipage_periodes.filter((p) => !(p.passe_id === 'p-luc' && p.utilisateur_id === 'u-eric'));
  await m.run('planifierRechargementTours()'); await attendre(450);
  eq('un passager que le chauffeur retire : son panneau se ferme et son bandeau redevient « Débuter la passe »', [m.ouvert(), m.bandeau().includes('btn-equipage'), m.bandeau().includes('▶ Débuter la passe')], [false, false, true]);
}

log('\n=== LE CODE : la page, le temps réel, aucune écriture directe ===');
{
  const html = lire('index.html'), css = lire('css/style.css'), fichiers = fs.readdirSync(WWW + 'js').filter((f) => f.endsWith('.js'));
  const sansCommentaires = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  vrai('la page charge equipage-panneau.js après equipage.js et avant passe.js', html.indexOf('js/equipage.js') < html.indexOf('js/equipage-panneau.js') && html.indexOf('js/equipage-panneau.js') < html.indexOf('js/passe.js'));
  vrai('la page a le panneau (titre, sous-titre, liste, « FERMER », « ＋ AJOUTER »)', ['id="equipage-overlay"', 'id="equipage-sub"', 'id="equipage-body"', 'onclick="fermerEquipage()"', 'id="btn-equipage-ajouter"', 'onclick="ajouterAuVehicule()"', 'onclick="bgClickEquipage(event)"'].every((x) => html.includes(x)));
  vrai('la carte écoute l\'équipage en temps réel ET relit aussi les tours (un passager retiré le voit tout de suite)', /table:'equipage_periodes'\},\(\)=>\{planifierRechargementEquipages\(\);planifierRechargementTours\(\);\}/.test(lire('js/carte.js')));
  vrai('aucune écriture directe dans equipage_periodes / equipage_journal / quarts (uniquement les fonctions du serveur)', !fichiers.some((f) => /from\(\s*['"](equipage_periodes|equipage_journal|quarts)['"]\s*\)\s*\.\s*(insert|update|delete|upsert)/.test(sansCommentaires(lire('js/' + f)))));
  vrai('le panneau met les noms par textContent (jamais brut)', /nom\.textContent=m\.nom/.test(lire('js/equipage-panneau.js')));
  vrai('les noms font au moins 24 px, « Retirer » et « AJOUTER » au moins 48 et 52 px de haut (au doigt, camion en mouvement)', /\.eq-nom\{[^}]*font-size:24px/.test(css) && /\.eq-retirer\{[^}]*min-height:48px/.test(css) && /#equipage-footer \.lf-btn\{[^}]*min-height:52px/.test(css) && /\.passe-equipage\{[^}]*min-height:48px/.test(css));
  vrai('le panneau est sous la fenêtre de choix et sous les boîtes de confirmation', (() => { const a = +css.match(/#equipage-overlay\{[^}]*z-index:(\d+)/)[1], b = +css.match(/#choix-overlay\{[^}]*z-index:(\d+)/)[1], c = +css.match(/#confirm-overlay\{[^}]*z-index:(\d+)/)[1]; return a < b && b < c; })());
}

tousLesMondes.forEach((w) => w.fin());
console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
