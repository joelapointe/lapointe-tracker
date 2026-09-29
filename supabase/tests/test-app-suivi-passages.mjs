// Demande 4 de Joé (29 sept. 2026) — L'ONGLET « SUIVI » du panneau administrateur : le suivi des passages par client (www/js/admin-suivi.js et ses branchements : admin.js, index.html, css/style.css).
// Décisions de Joé : réservé à l'ADMINISTRATEUR ; un client = une ADRESSE (les copies de route sont regroupées) ; un choix de SERVICE (gazon, désherbage, déneigement, sel) ; il repart de zéro mais veut pouvoir AJOUTER
// des passages à la main ; savoir quel client doit être fait (RYTHME du service) ; un PDF à imprimer (à venir, suivi-pdf.js).
// Les VRAIS fichiers de l'application sont chargés dans un faux navigateur (faux document qui garde l'arbre des éléments, horloge fixe) avec un FAUX Supabase (qui note chaque requête : table, colonnes, filtres, pages, écritures).
// Ce que ce test ne peut PAS vérifier : la vraie base (SQL 28 : test-suivi-passages.mjs, puis la requête « verification » lue sur la vraie base) et l'aspect réel de l'écran (essayé à part dans un navigateur, puis sur le téléphone de Joé).
// WWW_TEST : un autre dossier « www » (erreurs volontaires : voir erreurs-volontaires.mjs).
import vm from 'vm';
import fs from 'fs';
import { fileURLToPath } from 'url';
const WWW = process.env.WWW_TEST ? process.env.WWW_TEST.split('\\').join('/').replace(/\/?$/, '/') : fileURLToPath(new URL('../../www/', import.meta.url));

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
const lire = (f) => fs.readFileSync(WWW + f, 'utf8');

const JOE = { id: 'u-joe', nom: 'Joé', role: 'admin' };
const AUJOURDHUI = '2026-09-29';
const MAINTENANT = new Date('2026-09-29T16:00:00Z').getTime();   // midi à Québec : le même JOUR presque partout
const T = (jour, h = 16) => `${jour}T${String(h).padStart(2, '0')}:00:00Z`;
const debutIso = (jour) => new Date(Number(jour.slice(0, 4)), Number(jour.slice(5, 7)) - 1, Number(jour.slice(8, 10))).toISOString();

const ROUTES = () => [{ id: 'r-lou', nom: 'Louiseville', actif: true }, { id: 'r-yam', nom: 'Yamachiche', actif: true }, { id: 'r-tmp', nom: 'Temporaire SS', actif: true }];
// (le tableau est volontairement dans le DÉSORDRE : le regroupement se fait par adresse et par date de création, pas par la place dans la liste)
const STOPS = () => [
  { id: 's1b', adresse: '10 Rue des Pins, Louiseville', client: '', service: 'Coupe de gazon', route_id: 'r-tmp', ordre: 3, actif: true, created_at: '2026-09-25T12:00:00Z' },
  { id: 's2', adresse: '8 av. du Parc, Louiseville', client: null, service: 'Coupe de gazon', route_id: 'r-lou', ordre: 1, actif: true, created_at: '2026-04-01T12:01:00Z' },
  { id: 's1', adresse: '10 rue des Pins, Louiseville', client: 'Famille Tremblay', service: 'Coupe de gazon', route_id: 'r-lou', ordre: 0, actif: true, created_at: '2026-04-01T12:00:00Z' },
  { id: 's3', adresse: '55 chemin du Lac, Yamachiche', client: 'Client C', service: 'Coupe de gazon', route_id: 'r-yam', ordre: 0, actif: true, created_at: '2026-04-02T12:00:00Z' },
  { id: 's4', adresse: '1 rue Sansroute, Ville', client: 'Client D', service: 'Coupe de gazon', route_id: null, ordre: 0, actif: true, created_at: '2026-04-03T12:00:00Z' },
  { id: 's5', adresse: '9 rue Fermée, Ville', client: 'Archivé', service: 'Coupe de gazon', route_id: 'r-lou', ordre: 9, actif: false, created_at: '2026-04-03T12:00:00Z' },
  { id: 's6', adresse: '10 rue des Pins, Louiseville', client: 'Famille Tremblay', service: 'Épandage de sel', route_id: 'r-lou', ordre: 0, actif: true, created_at: '2026-01-10T12:00:00Z' },
  { id: 's7b', adresse: '2 RUE ETE, VILLE', client: '', service: 'Coupe de gazon', route_id: 'r-tmp', ordre: 4, actif: true, created_at: '2026-09-26T12:00:00Z' },
  { id: 's8', adresse: '3 rue Vent, Ville', client: 'Aéré', service: 'Aération', route_id: 'r-lou', ordre: 7, actif: true, created_at: '2026-04-05T12:00:00Z' },   // un service qui n'existe QUE dans un arrêt (pas dans les types)
  { id: 's7', adresse: '2 rue Été, Ville', client: 'Client E', service: 'Coupe de gazon', route_id: 'r-yam', ordre: 1, actif: true, created_at: '2026-04-04T12:00:00Z' },
];
const COMPLETIONS = () => [
  { id: 'c01', stop_id: 's1', complete_le: T('2026-04-20'), utilisateurs: { nom: 'Luc' }, passes: { equipes: { nom: 'Camion 2' } } },
  { id: 'c02', stop_id: 's1', complete_le: T('2026-05-12'), utilisateurs: { nom: 'Éric' }, passes: { equipes: { nom: 'Camion 1' } } },
  { id: 'c03', stop_id: 's1', complete_le: T('2026-05-26'), utilisateurs: null, passes: null },
  { id: 'c04', stop_id: 's1', complete_le: T('2026-06-09'), utilisateurs: { nom: 'Luc' }, passes: { equipes: { nom: 'Camion 2' } } },
  { id: 'c05', stop_id: 's1b', complete_le: T('2026-06-09') },   // la COPIE, le même jour : un seul passage
  { id: 'c06', stop_id: 's1b', complete_le: T('2026-06-23') },
  { id: 'c07', stop_id: 's3', complete_le: T('2026-09-12') },
  { id: 'c08', stop_id: 's6', complete_le: T('2026-01-15') },   // un AUTRE service (le sel)
  { id: 'c09', stop_id: 's7b', complete_le: T('2026-09-27') },
  { id: 'c10', stop_id: 's99', complete_le: T('2026-09-01') },  // un arrêt qui n'existe pas (ou plus)
  { id: 'c11', stop_id: 's2', complete_le: 'pas une date' },
  { id: 'c12', stop_id: 's5', complete_le: T('2026-05-01') },   // un arrêt archivé
];
const MANUELS = () => [
  { id: 'm1', stop_id: 's1', jour: '2026-07-07', note: 'remplaçant' },
  { id: 'm2', stop_id: 's2', jour: '2026-09-22', note: null },
  { id: 'm3', stop_id: 's1', jour: '2026-06-09', note: 'doublon' },   // le même jour qu'un « Complété »
  { id: 'm4', stop_id: 's1', jour: '2025-12-15', note: 'avant' },    // avant la date de départ par défaut
];
const TYPES = () => [
  { nom: 'Coupe de gazon', actif: true, frequence_jours: 14 }, { nom: 'Désherbage', actif: true, frequence_jours: null },
  { nom: 'Épandage de sel', actif: true, frequence_jours: null }, { nom: 'Autre', actif: false, frequence_jours: null },
];

// ---------------------------------------------------------------------
// Un monde : faux navigateur (arbre des éléments gardé) + faux Supabase + les vrais fichiers
// ---------------------------------------------------------------------
function monde(o = {}) {
  const statiques = {};
  const creer = (id, balise = '') => {
    const e = { id: id ?? '', tagName: String(balise).toUpperCase(), children: [], style: {}, dataset: {}, attrs: {}, textContent: '', value: '', className: '', checked: false, disabled: false,
      onclick: null, onchange: null, oninput: null, type: '', min: '', max: '', placeholder: '', title: '', maxLength: 0, parent: null,
      classList: {
        add: (...c) => c.forEach((x) => { if (!e.className.split(/\s+/).includes(x)) e.className = (e.className + ' ' + x).trim(); }),
        remove: (...c) => { e.className = e.className.split(/\s+/).filter((x) => x && !c.includes(x)).join(' '); },
        contains: (c) => e.className.split(/\s+/).includes(c),
        toggle: (c, on) => { const a = e.className.split(/\s+/).includes(c); if (on === undefined ? !a : on) e.classList.add(c); else e.classList.remove(c); },
      },
      appendChild(c) { c.parent = e; e.children.push(c); return c; }, setAttribute(k, v) { e.attrs[k] = v; }, getAttribute(k) { return e.attrs[k]; },
      remove() { if (e.parent) e.parent.children = e.parent.children.filter((x) => x !== e); }, focus() {}, addEventListener() {}, querySelector() { return null; } };
    Object.defineProperty(e, 'innerHTML', { get() { return ''; }, set(v) { if (v === '') e.children = []; else throw new Error('innerHTML avec du texte : ' + String(v).slice(0, 40)); } });
    return e;
  };
  const trouverDans = (n, id) => { if (n.id === id) return n; for (const c of n.children) { const r = trouverDans(c, id); if (r) return r; } return null; };
  const el = (id) => (statiques[id] ??= creer(id, 'div'));
  const getElementById = (id) => { if (statiques[id]) return statiques[id]; for (const r of Object.values(statiques)) { const t = trouverDans(r, id); if (t) return t; } return el(id); };

  const donnees = { passe_arrets: o.completions ?? COMPLETIONS(), passages_manuels: o.manuels ?? MANUELS(), types_service: o.types ?? TYPES() };
  const appels = { requetes: [], toasts: [], confirmations: [] };
  let compteur = 0;
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const executer = async (q) => {
    appels.requetes.push({ table: q.table, op: q.op, cols: q.cols, filtres: q.filtres, ordres: q.ordres, plage: q.plage, valeur: q.valeur, opts: q.opts, retour: q.retour });
    const lignes = donnees[q.table] ?? [];   // les lignes vues au MOMENT de la requête : une réponse lente ne voit pas ce qui change après (sinon deux lectures qui se croisent ne se distinguent pas)
    if (o.retards?.[q.table + '.' + q.op]?.length) await o.retards[q.table + '.' + q.op].shift();
    if (o.panne?.(q)) throw new TypeError('Failed to fetch');
    const cle = q.table + '.' + q.op;
    if (o.erreurs?.[cle]) { const e = typeof o.erreurs[cle] === 'function' ? o.erreurs[cle](q) : o.erreurs[cle]; if (e) return { data: null, error: e }; }
    const filtrer = (l) => q.filtres.every(([f, c, v]) => (f === 'gte' ? String(l[c]) >= String(v) : f === 'eq' ? l[c] === v : f === 'in' ? v.includes(l[c]) : true));
    if (q.op === 'select') {
      if (q.table === 'passages_manuels' && o.sansTableManuels) return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.passages_manuels' in the schema cache" } };
      if (q.table === 'types_service' && o.sansRythme && /frequence_jours/.test(q.cols || '')) return { data: null, error: { code: '42703', message: 'column types_service.frequence_jours does not exist' } };
      if (q.table === 'passe_arrets' && /utilisateurs!/.test(q.cols || '') && o.sansLiens) return { data: null, error: { code: 'PGRST200', message: 'Could not find a relationship between passe_arrets and utilisateurs' } };
      let r = lignes.filter(filtrer).map((l) => ({ ...l }));
      q.ordres.forEach(([c, sens]) => { r.sort((a, b) => (sens === 'desc' ? -1 : 1) * cmp(a[c], b[c])); });
      if (q.plage) r = r.slice(q.plage[0], q.plage[1] + 1);
      if (q.cols && !/[(!]/.test(q.cols) && q.cols.trim() !== '*') { const cols = q.cols.split(',').map((x) => x.trim()); r = r.map((l) => Object.fromEntries(cols.map((c) => [c, l[c]]))); }   // (les colonnes demandées seulement ; une lecture avec des tables liées garde toute la ligne)
      return { data: r, error: null };
    }
    if (q.op === 'update') {
      const touches = lignes.filter(filtrer);
      touches.forEach((l) => Object.assign(l, q.valeur));
      return { data: touches.map((l) => (q.retour ? { [q.retour]: l[q.retour] } : l)), error: null };
    }
    if (q.op === 'delete') {
      const touches = lignes.filter(filtrer);
      donnees[q.table] = lignes.filter((l) => !touches.includes(l));
      return { data: touches.map((l) => ({ id: l.id })), error: null };
    }
    if (q.op === 'upsert') {
      const ajoutes = [];
      q.valeur.forEach((v) => {
        const existe = lignes.some((l) => l.stop_id === v.stop_id && l.jour === v.jour);
        if (existe) return;
        const n = { id: 'm-nouveau-' + (++compteur), stop_id: v.stop_id, jour: v.jour, note: v.note ?? null };
        lignes.push(n);
        ajoutes.push({ ...n });
      });
      return { data: ajoutes, error: null };
    }
    return { data: null, error: { message: 'opération inconnue' } };
  };
  const fauxDb = {
    channel() { const c = { on() { return c; }, subscribe() { return c; } }; return c; },
    rpc: async () => ({ data: null, error: null }),
    from: (table) => {
      const q = { table, op: 'select', cols: null, filtres: [], ordres: [], plage: null, valeur: null, opts: null, retour: null };
      q.select = (c) => { if (q.op === 'select') q.cols = c; else q.retour = c ?? '*'; return q; };
      q.gte = (c, v) => { q.filtres.push(['gte', c, v]); return q; };
      q.eq = (c, v) => { q.filtres.push(['eq', c, v]); return q; };
      q.in = (c, l) => { q.filtres.push(['in', c, l]); return q; };
      q.order = (c, opt) => { q.ordres.push([c, opt && opt.ascending === false ? 'desc' : 'asc']); return q; };
      q.range = (a, b) => { q.plage = [a, b]; return q; };
      q.update = (v) => { q.op = 'update'; q.valeur = v; return q; };
      q.delete = () => { q.op = 'delete'; return q; };
      q.upsert = (rows, opts) => { q.op = 'upsert'; q.valeur = rows; q.opts = opts; return q; };
      q.then = (ok_, ko_) => Promise.resolve().then(() => executer(q)).then(ok_, ko_);
      return q;
    },
  };

  class DateFausse extends Date { constructor(...a) { if (a.length) super(...a); else super(o.maintenant ?? MAINTENANT); } static now() { return o.maintenant ?? MAINTENANT; } }
  const stockage = { ...(o.stockage ?? {}) };
  const minuteries = [];
  const sandbox = {
    document: { getElementById, createElement: (b) => creer(null, b), body: creer('body', 'body'), addEventListener() {}, removeEventListener() {} },
    localStorage: { getItem: (k) => (k in stockage ? stockage[k] : null), setItem: (k, v) => { stockage[k] = String(v); }, removeItem: (k) => { delete stockage[k]; } },
    window: {}, navigator: {}, setTimeout: (f, ms) => { minuteries.push({ f, ms }); return minuteries.length; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, Date: DateFausse, console,
    fetch: async () => ({ json: async () => ({}) }), setStatus() {}, hideLoading() {}, showErr() {},
    __db: fauxDb, __toasts: appels.toasts, __confirmations: appels.confirmations, __reponse: { oui: true },
  };
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/config.js', 'js/utilitaires.js', 'js/hors-reseau.js', 'js/routes.js', 'js/admin.js', 'js/admin-suivi.js']) vm.runInContext(lire(f), ctx, { filename: f });
  vm.runInContext(`db = __db; stops = ${JSON.stringify(o.arrets ?? STOPS())}; routes = ${JSON.stringify(o.routes ?? ROUTES())}; currentUser = ${JSON.stringify(JOE)}; _adminOnglet = 'suivi';
    toast = (m) => { __toasts.push(m); }; confirmer = async (...a) => { __confirmations.push(a); return __reponse.oui; };`, ctx);
  const corps = () => el('admin-body');
  const w = { ctx, el, donnees, appels, stockage, toasts: appels.toasts, corps,
    run: (c) => vm.runInContext(c, ctx),
    repondre: (oui) => { sandbox.__reponse.oui = oui; },
    ouvrir: () => vm.runInContext('suiviOuvrir()', ctx),
    dernierToast: () => appels.toasts.at(-1),
    requetes: (table, op = 'select') => appels.requetes.filter((r) => r.table === table && r.op === op),
    feuilleOuverte: () => el('suivi-feuille-overlay').classList.contains('open'),
    puces: () => (tous(corps()).filter((x) => x.className === 'su-puces')[0]?.children ?? []),
    filtres: () => (tous(corps()).filter((x) => x.className === 'su-filtres')[0]?.children ?? []).filter((x) => x.tagName === 'BUTTON'),
    champ: (id) => tous(corps()).find((x) => x.id === id),
    lignes: () => parClasse(corps(), 'su-ligne').map((l) => ({
      nom: parClasse(l, 'su-nom')[0]?.textContent, badge: parClasse(l, 'su-badge')[0]?.textContent ?? null, n: parClasse(l, 'su-n')[0]?.textContent, adresse: parClasse(l, 'su-adresse')[0]?.textContent ?? null,
      dates: parClasse(l, 'su-date').filter((d) => !d.className.includes('su-plus')).map((d) => d.textContent), manuelles: parClasse(l, 'su-date').filter((d) => d.className.includes('manuel')).map((d) => d.textContent), noeud: l,
    })),
    sections: () => parClasse(corps(), 'su-section').map((s) => [s.children[0].textContent, s.children[1].textContent]),
    resume: () => parClasse(corps(), 'su-resume')[0]?.textContent,
    messages: () => parClasse(corps(), 'su-message').map((x) => x.textContent),
    sheet: () => el('suivi-feuille-corps'),
  };
  return w;
}
const tous = (n) => [n, ...n.children.flatMap(tous)];
const puce = (m, nom) => m.puces().find((b) => b.textContent === nom);
const parClasse = (n, c) => tous(n).filter((x) => (x.className || '').split(/\s+/).includes(c));
const texte = (n) => (n.textContent || '') + n.children.map(texte).join('');
const cliquer = async (e) => { const r = e.onclick(); if (r && r.then) await r; };
const changer = async (e, v) => { e.value = v; const r = e.onchange(); if (r && r.then) await r; };

// =====================================================================
log('=== LES FONCTIONS PURES : CLÉS, DATES, ÉTATS ===');
{
  const m = monde();
  const c = (a) => m.run(`suiviCle(${JSON.stringify(a)})`);
  eq('la clé d\'une adresse : sans accents, sans majuscules, sans ponctuation', c('10 Rue de l\'Église, Charette'), '10 rue de l eglise charette');
  eq('… deux écritures de la même adresse ont la MÊME clé', [c('2 rue Été, Ville'), c('2 RUE ETE, VILLE')], ['2 rue ete ville', '2 rue ete ville']);
  eq('… des adresses différentes ont des clés différentes', c('10 rue des Pins') !== c('12 rue des Pins'), true);
  eq('… une adresse vide ou absente : clé vide', [c(''), m.run('suiviCle(null)'), m.run('suiviCle(undefined)')], ['', '', '']);
  eq('suiviJourLocal : le jour d\'une heure du serveur', m.run(`suiviJourLocal(${JSON.stringify(T('2026-05-12'))})`), '2026-05-12');
  eq('… avec un nombre (millisecondes) aussi', m.run(`suiviJourLocal(${MAINTENANT})`), AUJOURDHUI);
  eq('… une heure illisible : null', [m.run(`suiviJourLocal('pas une date')`), m.run('suiviJourLocal(undefined)')], [null, null]);
  const d = (j, a) => m.run(`suiviDateCourte(${JSON.stringify(j)}, ${a})`);
  eq('suiviDateCourte : « 12 mai »', d('2026-05-12', 2026), '12 mai');
  eq('… « 1er mai » (le premier du mois)', d('2026-05-01', 2026), '1er mai');
  eq('… le 11 et le 31 ne sont PAS « 1er »', [d('2026-05-11', 2026), d('2026-05-31', 2026)], ['11 mai', '31 mai']);
  eq('… une autre année : l\'année est écrite', d('2025-12-15', 2026), '15 déc. 2025');
  eq('… les douze mois', ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map((mm) => d(`2026-${mm}-15`, 2026)), ['15 janv.', '15 févr.', '15 mars', '15 avr.', '15 mai', '15 juin', '15 juil.', '15 août', '15 sept.', '15 oct.', '15 nov.', '15 déc.']);
  eq('… une date illisible : texte vide', [d('abc', 2026), d('', 2026), m.run('suiviDateCourte(null, 2026)')], ['', '', '']);
  const e = (a, b) => m.run(`suiviJoursEntre(${JSON.stringify(a)}, ${JSON.stringify(b)})`);
  eq('suiviJoursEntre : du 7 juillet au 29 septembre = 84 jours', e('2026-07-07', '2026-09-29'), 84);
  eq('… le même jour : 0 ; le lendemain : 1 ; à l\'envers : négatif', [e('2026-09-29', '2026-09-29'), e('2026-09-29', '2026-09-30'), e('2026-09-30', '2026-09-29')], [0, 1, -1]);
  eq('… à travers un changement d\'heure (mars et novembre) : toujours des jours ENTIERS', [e('2026-03-01', '2026-03-31'), e('2026-10-30', '2026-11-02')], [30, 3]);
  eq('… à travers une année', e('2025-12-31', '2026-01-01'), 1);
  const s = (t, j, r) => m.run(`suiviEtat(${t}, ${j}, ${r})`);
  eq('suiviEtat : aucun passage → « aucun » (avec ou sans rythme)', [s(0, null, 14), s(0, null, null)], ['aucun', 'aucun']);
  eq('… sans rythme : « neutre »', [s(3, 0, null), s(3, 400, null)], ['neutre', 'neutre']);
  eq('… avec un rythme de 14 jours : 13 jours = à jour, 14 = à faire, 20 = à faire, 21 = en retard', [s(3, 13, 14), s(3, 14, 14), s(3, 20, 14), s(3, 21, 14)], ['ok', 'afaire', 'afaire', 'retard']);
  eq('… le jour même du passage : à jour', s(3, 0, 7), 'ok');
  eq('… un rythme de 7 jours : 10 jours = à faire, 11 = en retard (7 × 1,5 = 10,5)', [s(1, 10, 7), s(1, 11, 7)], ['afaire', 'retard']);
  eq('suiviLibelle : « Client : Adresse », comme sur la feuille de Joé (l\'adresse seule sans nom)', [m.run(`suiviLibelle({client:'Famille Tremblay', adresse:'10 rue des Pins'})`), m.run(`suiviLibelle({client:'', adresse:'10 rue des Pins'})`)], ['Famille Tremblay : 10 rue des Pins', '10 rue des Pins']);
}

// =====================================================================
log('\n=== LES LIGNES : UNE PAR ADRESSE, LES COPIES REGROUPÉES, LES DATES RÉUNIES ===');
{
  const m = monde();
  const construire = (o = {}) => m.run(`suiviConstruire(${JSON.stringify({ arrets: STOPS(), routes: ROUTES(), completions: COMPLETIONS(), manuels: MANUELS(), service: 'Coupe de gazon', depuis: '2026-01-01', aujourdhui: AUJOURDHUI, rythme: 14, ...o })})`);
  const L = construire();
  const par = (id) => L.find((l) => l.arretRef === id);
  eq('5 lignes pour la coupe de gazon (l\'arrêt archivé et l\'autre service n\'y sont pas ; les copies sont regroupées)', L.map((l) => l.arretRef).sort(), ['s1', 's2', 's3', 's4', 's7']);
  eq('l\'arrêt de RÉFÉRENCE d\'une adresse est le plus ANCIEN (la copie de la route temporaire est plus récente)', [par('s1').arretIds, par('s7').arretIds], [['s1', 's1b'], ['s7', 's7b']]);
  eq('… la SECTION vient de la route de cet arrêt (Louiseville), pas de la route temporaire', [par('s1').section, par('s7').section, par('s2').section, par('s3').section], ['Louiseville', 'Yamachiche', 'Louiseville', 'Yamachiche']);
  eq('… un arrêt sans route : « Sans route »', par('s4').section, 'Sans route');
  eq('… un arrêt dont la route n\'existe pas dans la liste : « Sans route » aussi', m.run(`suiviConstruire(${JSON.stringify({ arrets: STOPS(), routes: [], completions: [], manuels: [], service: 'Coupe de gazon', depuis: '2026-01-01', aujourdhui: AUJOURDHUI, rythme: null })})`).every((l) => l.section === 'Sans route'), true);
  eq('le NOM du client est le premier qui n\'est pas vide (dans l\'ordre du plus ancien)', [par('s1').client, par('s2').client, par('s7').client], ['Famille Tremblay', '', 'Client E']);
  eq('l\'adresse affichée est celle de l\'arrêt de référence', [par('s1').adresse, par('s7').adresse], ['10 rue des Pins, Louiseville', '2 rue Été, Ville']);
  const dates = (l) => l.dates.map((d) => [d.jour, d.app, d.manuel ? d.manuel.id : null]);
  eq('les dates réunies (Complété + à la main, copie comprise) : le même jour compte UNE fois', dates(par('s1')),
    [['2026-04-20', true, null], ['2026-05-12', true, null], ['2026-05-26', true, null], ['2026-06-09', true, 'm3'], ['2026-06-23', true, null], ['2026-07-07', false, 'm1']]);
  eq('… 6 passages, le dernier le 7 juillet, il y a 84 jours : EN RETARD (rythme de 14 jours)', [par('s1').total, par('s1').dernier, par('s1').jours, par('s1').etat], [6, '2026-07-07', 84, 'retard']);
  eq('… une date à la main seule, il y a 7 jours : À JOUR', [dates(par('s2')), par('s2').etat, par('s2').jours], [[['2026-09-22', false, 'm2']], 'ok', 7]);
  eq('… une heure de « Complété » illisible est ignorée', par('s2').total, 1);
  eq('… 17 jours : À FAIRE', [dates(par('s3')), par('s3').etat, par('s3').jours], [[['2026-09-12', true, null]], 'afaire', 17]);
  eq('… aucun passage : « aucun »', [par('s4').total, par('s4').dernier, par('s4').jours, par('s4').etat], [0, null, null, 'aucun']);
  eq('… le passage de la COPIE compte pour l\'adresse', [dates(par('s7')), par('s7').etat], [[['2026-09-27', true, null]], 'ok']);
  eq('un « Complété » d\'un arrêt inconnu (s99) ou archivé (s5) ne crée AUCUNE ligne et ne compte nulle part', [L.some((l) => l.arretIds.includes('s99') || l.arretIds.includes('s5')), L.reduce((n, l) => n + l.total, 0)], [false, 9]);
  eq('la date à la main d\'AVANT la date de départ (15 déc. 2025) n\'est pas comptée', par('s1').dates.some((d) => d.jour === '2025-12-15'), false);

  const depuisJuin = construire({ depuis: '2026-06-01' });
  eq('avec « depuis le 1er juin » : seules les dates de juin et après restent', depuisJuin.find((l) => l.arretRef === 's1').dates.map((d) => d.jour), ['2026-06-09', '2026-06-23', '2026-07-07']);
  eq('… le 20 avril et les mai ne comptent plus : 3 passages', depuisJuin.find((l) => l.arretRef === 's1').total, 3);
  eq('… la date de départ est INCLUSE (« depuis le 2026-06-09 » garde le 9 juin)', construire({ depuis: '2026-06-09' }).find((l) => l.arretRef === 's1').dates[0].jour, '2026-06-09');
  eq('… incluse aussi pour un « Complété » SEUL ce jour-là (le 20 avril : « Complété » sans date à la main)', construire({ depuis: '2026-04-20' }).find((l) => l.arretRef === 's1').dates[0], { jour: '2026-04-20', app: true, manuel: null });
  eq('… incluse aussi pour une date à la main SEULE ce jour-là (le 7 juillet, et le 22 septembre pour l\'autre client)', [construire({ depuis: '2026-07-07' }).find((l) => l.arretRef === 's1').dates.map((d) => d.jour), construire({ depuis: '2026-09-22' }).find((l) => l.arretRef === 's2').dates.map((d) => d.jour)], [['2026-07-07'], ['2026-09-22']]);
  eq('… et la veille est écartée (« depuis le 2026-04-21 » n\'a plus le 20 avril ; « depuis le 2026-07-08 » n\'a plus le 7 juillet)', [construire({ depuis: '2026-04-21' }).find((l) => l.arretRef === 's1').dates[0].jour, construire({ depuis: '2026-07-08' }).find((l) => l.arretRef === 's1').dates.length], ['2026-05-12', 0]);
  const unJour = (comp, man) => m.run(`suiviConstruire(${JSON.stringify({ arrets: [{ id: 'j1', adresse: '1 rue J', service: 'S', created_at: '2026-04-01T00:00:00Z' }, { id: 'j2', adresse: '1 rue J', service: 'S', created_at: '2026-05-01T00:00:00Z' }], routes: [], completions: comp, manuels: man, service: 'S', depuis: '2026-01-01', aujourdhui: AUJOURDHUI, rythme: null })})`)[0].dates.map((d) => [d.jour, d.app, d.manuel ? d.manuel.id : null]);
  eq('un jour à la fois « Complété » ET noté à la main, sur le MÊME arrêt : une seule date, qui garde les deux (elle ne se retire pas)', unJour([{ stop_id: 'j1', complete_le: T('2026-06-09') }], [{ id: 'mm', stop_id: 'j1', jour: '2026-06-09', note: null }]), [['2026-06-09', true, 'mm']]);
  eq('… « Complété » sur la COPIE, date à la main sur le client : les deux aussi', unJour([{ stop_id: 'j2', complete_le: T('2026-06-09') }], [{ id: 'mm', stop_id: 'j1', jour: '2026-06-09', note: null }]), [['2026-06-09', true, 'mm']]);
  eq('… « Complété » sur le client, date à la main sur la COPIE : les deux aussi', unJour([{ stop_id: 'j1', complete_le: T('2026-06-09') }], [{ id: 'mm', stop_id: 'j2', jour: '2026-06-09', note: null }]), [['2026-06-09', true, 'mm']]);
  eq('une date à la main illisible (« abc », vide, absente) est ignorée ; une date suivie d\'une heure est lue (« 2026-06-09T00:00:00+00:00 » : le 9 juin)', [unJour([], [{ id: 'mx', stop_id: 'j1', jour: 'abc', note: null }, { id: 'my', stop_id: 'j1', jour: '', note: null }, { id: 'mw', stop_id: 'j1', note: null }]), unJour([], [{ id: 'mz', stop_id: 'j1', jour: '2026-06-09T00:00:00+00:00', note: null }])], [[], [['2026-06-09', false, 'mz']]]);
  eq('… deux dates à la main le même jour, sur le client ET sur sa copie : une seule date dans la liste', unJour([], [{ id: 'm1', stop_id: 'j1', jour: '2026-06-09', note: null }, { id: 'm2', stop_id: 'j2', jour: '2026-06-09', note: null }]).length, 1);
  const sel = construire({ service: 'Épandage de sel', rythme: null });
  eq('le service « Épandage de sel » : la même adresse, SA propre ligne et ses propres dates', sel.map((l) => [l.arretRef, l.section, l.dates.map((d) => d.jour), l.etat]), [['s6', 'Louiseville', ['2026-01-15'], 'neutre']]);
  eq('sans rythme : « neutre » (sauf « aucun »)', construire({ rythme: null }).map((l) => l.etat).sort(), ['aucun', 'neutre', 'neutre', 'neutre', 'neutre']);
  eq('un service sans aucun arrêt : aucune ligne', construire({ service: 'Désherbage' }).length, 0);
  eq('un arrêt sans « actif » (champ absent) est traité comme actif', m.run(`suiviConstruire(${JSON.stringify({ arrets: [{ id: 'x1', adresse: '1 rue A', service: 'S', route_id: null }], routes: [], completions: [], manuels: [], service: 'S', depuis: '2026-01-01', aujourdhui: AUJOURDHUI, rythme: null })})`).length, 1);
  eq('deux arrêts SANS adresse ne sont pas fusionnés (chacun sa ligne)', m.run(`suiviConstruire(${JSON.stringify({ arrets: [{ id: 'a1', adresse: '', service: 'S' }, { id: 'a2', adresse: null, service: 'S' }], routes: [], completions: [], manuels: [], service: 'S', depuis: '2026-01-01', aujourdhui: AUJOURDHUI, rythme: null })})`).length, 2);
  eq('les copies dans l\'ordre de création inverse du tableau : la référence reste la plus ancienne (pas la première du tableau)', m.run(`suiviConstruire(${JSON.stringify({ arrets: [{ id: 'b', adresse: '1 rue A', service: 'S', created_at: '2026-06-01T00:00:00Z', route_id: 'r-tmp' }, { id: 'a', adresse: '1 rue A', service: 'S', created_at: '2026-04-01T00:00:00Z', route_id: 'r-lou' }], routes: ROUTES(), completions: [], manuels: [], service: 'S', depuis: '2026-01-01', aujourdhui: AUJOURDHUI, rythme: null })})`)[0].arretRef, 'a');
  const inline = (arrets) => m.run(`suiviConstruire(${JSON.stringify({ arrets, routes: [], completions: [], manuels: [], service: 'S', depuis: '2026-01-01', aujourdhui: AUJOURDHUI, rythme: null })})`);
  eq('le nom du client : le plus ancien arrêt n\'en a pas, la copie plus récente en a un : c\'est ce nom-là qui est montré', inline([{ id: 'n1', adresse: '1 rue A', client: '', service: 'S', created_at: '2026-04-01T00:00:00Z' }, { id: 'n2', adresse: '1 rue A', client: 'Nommé', service: 'S', created_at: '2026-05-01T00:00:00Z' }])[0].client, 'Nommé');
  eq('… un nom fait seulement d\'espaces compte comme « pas de nom », et les espaces autour d\'un vrai nom sont retirés', [inline([{ id: 'n1', adresse: '1 rue A', client: '   ', service: 'S', created_at: '2026-04-01T00:00:00Z' }, { id: 'n2', adresse: '1 rue A', client: '  Nommé  ', service: 'S', created_at: '2026-05-01T00:00:00Z' }])[0].client, inline([{ id: 'n3', adresse: '2 rue B', client: '   ', service: 'S' }])[0].client], ['Nommé', '']);
  eq('à égalité de date de création, la place dans la route puis l\'identifiant départagent', m.run(`suiviConstruire(${JSON.stringify({ arrets: [{ id: 'z', adresse: '1 rue A', service: 'S', created_at: '2026-04-01T00:00:00Z', ordre: 2 }, { id: 'y', adresse: '1 rue A', service: 'S', created_at: '2026-04-01T00:00:00Z', ordre: 2 }, { id: 'x', adresse: '1 rue A', service: 'S', created_at: '2026-04-01T00:00:00Z', ordre: 5 }], routes: [], completions: [], manuels: [], service: 'S', depuis: '2026-01-01', aujourdhui: AUJOURDHUI, rythme: null })})`)[0].arretRef, 'y');
}

log('\n=== FILTRER, GROUPER, RÉSUMER ===');
{
  const m = monde();
  const L = m.run(`suiviConstruire(${JSON.stringify({ arrets: STOPS(), routes: ROUTES(), completions: COMPLETIONS(), manuels: MANUELS(), service: 'Coupe de gazon', depuis: '2026-01-01', aujourdhui: AUJOURDHUI, rythme: 14 })})`);
  ctxLignes: m.ctx.__L = L;
  const f = (filtre, rech = '') => m.run(`suiviFiltrer(__L, ${JSON.stringify(filtre)}, ${JSON.stringify(rech)})`).map((l) => l.arretRef).sort();
  eq('« tous » : les 5 clients', f('tous'), ['s1', 's2', 's3', 's4', 's7']);
  eq('« à faire » : en retard, à faire, et sans passage (3)', f('afaire'), ['s1', 's3', 's4']);
  eq('« aucun passage » : seulement celui qui n\'a aucun passage', f('aucun'), ['s4']);
  eq('recherche : une partie du NOM, sans tenir compte des majuscules', f('tous', 'TREMBLAY'), ['s1']);
  eq('… une partie de l\'ADRESSE', f('tous', 'chemin du lac'), ['s3']);
  eq('… sans tenir compte des accents (« été » trouve « Été » et « ETE »)', [f('tous', 'été'), f('tous', 'ete')], [['s7'], ['s7']]);
  eq('… plusieurs mots, dans n\'importe quel ordre : CHAQUE mot doit se trouver dans l\'adresse ou le nom', [f('tous', 'rue pins'), f('tous', 'pins rue'), f('tous', 'pins parc')], [['s1'], ['s1'], []]);
  eq('… le filtre ET la recherche se combinent', [f('afaire', 'pins'), f('afaire', 'parc')], [['s1'], []]);
  eq('… une recherche vide ne filtre rien', f('tous', '   '), ['s1', 's2', 's3', 's4', 's7']);
  eq('… le nom du client ET l\'adresse sont cherchés ensemble (« tremblay pins »)', f('tous', 'tremblay pins'), ['s1']);
  const G = m.run('suiviGrouper(__L)');
  eq('les sections dans l\'ordre des noms, « Sans route » à la FIN', G.map((s) => s.nom), ['Louiseville', 'Yamachiche', 'Sans route']);
  eq('… chaque section : ses clients dans l\'ordre de la route', G.map((s) => s.lignes.map((l) => l.arretRef)), [['s1', 's2'], ['s3', 's7'], ['s4']]);
  eq('« Sans route » reste à la fin même s\'il commence par un « A » (Abitibi passe avant)', m.run(`suiviGrouper([{section:'Sans route', ordre:0, adresse:'a'}, {section:'Abitibi', ordre:0, adresse:'b'}, {section:'Zoé', ordre:0, adresse:'c'}])`).map((s) => s.nom), ['Abitibi', 'Zoé', 'Sans route']);
  eq('… les noms de section se classent sans tenir compte des accents ni des majuscules (« Été » avant « Farnham »)', m.run(`suiviGrouper([{section:'Farnham', ordre:0, adresse:'a'}, {section:'été', ordre:0, adresse:'b'}])`).map((s) => s.nom), ['été', 'Farnham']);
  eq('… à égalité de place, l\'adresse classe', m.run(`suiviGrouper([{section:'S', ordre:1, adresse:'b'}, {section:'S', ordre:1, adresse:'a'}, {section:'S', ordre:0, adresse:'z'}])`)[0].lignes.map((l) => l.adresse), ['z', 'a', 'b']);
  eq('le résumé : 5 clients, 3 à faire, 1 sans passage, 9 passages', m.run('suiviResume(__L)'), { clients: 5, aFaire: 3, aucun: 1, passages: 9 });
  eq('… sans client : des zéros', m.run('suiviResume([])'), { clients: 0, aFaire: 0, aucun: 0, passages: 0 });
}

// =====================================================================
log('\n=== L\'ONGLET « SUIVI » DU PANNEAU ADMINISTRATEUR ===');
{
  const m = monde();
  const onglets = m.run('ongletsAdmin()').map((x) => [x.id, x.icone, x.label, x.titre]);
  eq('« 📋 Suivi » est le DERNIER onglet du panneau', onglets.at(-1), ['suivi', '📋', 'Suivi', 'Suivi des passages']);
  eq('… son chargement est la fonction de admin-suivi.js', m.run(`ongletsAdmin().find(o => o.id === 'suivi').charger === chargerSuiviAdmin`), true);
}

log('\n=== L\'OUVERTURE : CE QUI EST LU (par pages) ET CE QUI EST MONTRÉ ===');
{
  const m = monde();
  await m.ouvrir();
  const lect = m.appels.requetes;
  eq('trois lectures : les « Complété », les dates à la main, les types de service (avec leur rythme)', lect.map((r) => [r.table, r.op]), [['passe_arrets', 'select'], ['passages_manuels', 'select'], ['types_service', 'select']]);
  eq('les « Complété » : seulement 2 colonnes, depuis le 1er janvier de cette année, dans un ordre stable (date puis identifiant), première page de 1000', [lect[0].cols, lect[0].filtres, lect[0].ordres, lect[0].plage],
    ['stop_id, complete_le', [['gte', 'complete_le', debutIso('2026-01-01')]], [['complete_le', 'asc'], ['id', 'asc']], [0, 999]]);
  eq('les dates à la main : depuis le même jour', [lect[1].cols, lect[1].filtres, lect[1].ordres], ['id, stop_id, jour, note', [['gte', 'jour', '2026-01-01']], [['jour', 'asc'], ['id', 'asc']]]);
  eq('les types de service : nom, actif et rythme', [lect[2].cols], ['nom, actif, frequence_jours']);
  eq('les puces de service : les types ACTIFS et tout service qu\'un arrêt porte (« Autre », désactivé, n\'y est pas)', m.puces().map((b) => b.textContent), ['Aération', 'Coupe de gazon', 'Désherbage', 'Épandage de sel']);
  eq('… le service choisi au départ : « Coupe de gazon » (allumé, et dit aux lecteurs d\'écran)', m.puces().map((b) => [b.className, b.attrs['aria-pressed']]), [['su-puce', 'false'], ['su-puce on', 'true'], ['su-puce', 'false'], ['su-puce', 'false']]);
  eq('… la date de départ : le 1er janvier', m.champ('su-depuis').value, '2026-01-01');
  eq('… le rythme du gazon : 14 jours', [m.champ('su-rythme').value, m.champ('su-rythme').min, m.champ('su-rythme').max, m.champ('su-rythme').type], ['14', '1', '365', 'number']);
  eq('… les filtres : Tous (allumé), À faire, Aucun passage', m.filtres().map((b) => [b.textContent, b.className]), [['Tous', 'su-puce on'], ['À faire', 'su-puce'], ['Aucun passage', 'su-puce']]);
  eq('les sections (comme les villes de sa feuille), avec le nombre de clients', m.sections(), [['Louiseville', '2 clients'], ['Yamachiche', '2 clients'], ['Sans route', '1 client']]);
  eq('le résumé : 5 clients, 3 à faire, 9 passages', m.resume(), '5 clients · 3 à faire · 9 passages');
  const L = m.lignes();
  eq('les clients, numérotés dans chaque section : « 1 · Famille Tremblay », l\'adresse seule quand il n\'y a pas de nom', L.map((l) => l.nom), ['1 · Famille Tremblay', '2 · 8 av. du Parc, Louiseville', '1 · Client C', '2 · Client E', '1 · Client D']);
  eq('… l\'adresse est écrite sous le nom (seulement quand il y a un nom)', L.map((l) => l.adresse), ['10 rue des Pins, Louiseville', null, '55 chemin du Lac, Yamachiche', '2 rue Été, Ville', '1 rue Sansroute, Ville']);
  eq('… le badge d\'état : en retard, à jour, à faire, à jour, aucun passage', L.map((l) => l.badge), ['En retard · 84 j', 'À jour · 7 j', 'À faire · 17 j', 'À jour · 2 j', 'Aucun passage']);
  eq('… le nombre de passages (« 1 passage », « 6 passages », « 0 passage »)', L.map((l) => l.n), ['6 passages', '1 passage', '1 passage', '1 passage', '0 passage']);
  eq('… les dates en pastilles, de la plus vieille à la plus récente', L.map((l) => l.dates), [['20 avr.', '12 mai', '26 mai', '9 juin', '23 juin', '7 juil.'], ['22 sept.'], ['12 sept.'], ['27 sept.'], []]);
  eq('… les classes des badges (couleur)', L.map((l) => parClasse(l.noeud, 'su-badge')[0].className), ['su-badge retard', 'su-badge ok', 'su-badge afaire', 'su-badge ok', 'su-badge aucun']);
  eq('… les dates notées à la main sont des BOUTONS d\'une autre couleur (« manuel ») ; celles des « Complété » ne le sont pas', [L[0].manuelles, L[1].manuelles, L[2].manuelles], [['7 juil.'], ['22 sept.'], []]);
  const bout = parClasse(L[0].noeud, 'su-date').map((d) => [d.textContent, d.tagName]);
  eq('… (bouton pour une date à la main, simple texte pour un « Complété »)', bout.map((x) => x[1]), ['SPAN', 'SPAN', 'SPAN', 'SPAN', 'SPAN', 'BUTTON', 'BUTTON']);
  eq('… chaque client a sa pastille « ＋ date », avec un nom pour les lecteurs d\'écran', L.map((l) => parClasse(l.noeud, 'su-plus')[0].attrs['aria-label']), ['Ajouter une date pour Famille Tremblay : 10 rue des Pins, Louiseville', 'Ajouter une date pour 8 av. du Parc, Louiseville', 'Ajouter une date pour Client C : 55 chemin du Lac, Yamachiche', 'Ajouter une date pour Client E : 2 rue Été, Ville', 'Ajouter une date pour Client D : 1 rue Sansroute, Ville']);
  eq('… et deux boutons en bas : une date pour plusieurs clients, actualiser', parClasse(m.corps(), 'su-actions')[0].children.map((b) => b.textContent), ['＋ Une date pour plusieurs clients', '↻ Actualiser']);
  eq('… le chemin « ＋ date » ne montre AUCUNE fenêtre au départ', m.feuilleOuverte(), false);
}

log('\n=== LES FILTRES ET LA RECHERCHE ===');
{
  const m = monde();
  await m.ouvrir();
  await cliquer(m.filtres()[1]);
  eq('« À faire » : les 3 clients qui demandent un passage, et la puce s\'allume (Tous s\'éteint)', [m.lignes().map((l) => l.nom), m.filtres().map((b) => b.className)], [['1 · Famille Tremblay', '1 · Client C', '1 · Client D'], ['su-puce', 'su-puce on', 'su-puce']]);
  eq('… les sections vides disparaissent (plus de « Yamachiche » à 2 clients : un seul)', m.sections(), [['Louiseville', '1 client'], ['Yamachiche', '1 client'], ['Sans route', '1 client']]);
  eq('… le résumé compte TOUS les clients du service (pas seulement ceux affichés)', m.resume(), '5 clients · 3 à faire · 9 passages');
  await cliquer(m.filtres()[2]);
  eq('« Aucun passage » : un seul client', m.lignes().map((l) => l.nom), ['1 · Client D']);
  await cliquer(m.filtres()[0]);
  eq('« Tous » : tout revient', m.lignes().length, 5);
  const champ = m.champ('su-recherche');
  champ.value = 'tremb'; champ.oninput();
  eq('la recherche « tremb » : un client', m.lignes().map((l) => l.nom), ['1 · Famille Tremblay']);
  champ.value = 'zzz'; champ.oninput();
  eq('… rien de trouvé : « Aucun client ne correspond. »', [m.lignes().length, m.messages()], [0, ['Aucun client ne correspond.']]);
  champ.value = ''; champ.oninput();
  eq('… la recherche effacée : tout revient', m.lignes().length, 5);
  eq('… le champ de recherche n\'est pas refait à chaque frappe (le clavier reste ouvert)', m.champ('su-recherche') === champ, true);
  champ.value = 'été'; champ.oninput();
  await cliquer(m.filtres()[1]);
  eq('la recherche RESTE quand on change de filtre : « été » et « à faire » ne laissent rien', m.lignes().length, 0);
}

log('\n=== CHANGER DE SERVICE ET DE DATE DE DÉPART ===');
{
  const m = monde();
  await m.ouvrir();
  const avant = m.appels.requetes.length;
  await cliquer(puce(m, 'Épandage de sel'));
  eq('« Épandage de sel » : SES clients (la même adresse, sa propre ligne)', [m.lignes().map((l) => [l.nom, l.dates, l.badge]), m.sections()], [[['1 · Famille Tremblay', ['15 janv.'], null]], [['Louiseville', '1 client']]]);
  eq('… sans rythme : pas de badge ; le résumé parle de clients « sans passage »', m.resume(), '1 client · 0 sans passage · 1 passage');
  eq('… même date de départ : rien n\'est relu', m.appels.requetes.length, avant);
  eq('… le service choisi est retenu pour la prochaine ouverture', m.stockage['lp_suivi_service'], 'Épandage de sel');
  eq('… la puce allumée a changé, et le rythme affiché est celui de CE service (vide)', [m.puces().map((b) => b.className), m.champ('su-rythme').value], [['su-puce', 'su-puce', 'su-puce', 'su-puce on'], '']);
  await cliquer(puce(m, 'Désherbage'));
  eq('« Désherbage » (aucun arrêt) : « Aucun client pour ce service. »', [m.lignes().length, m.messages().includes('Aucun client pour ce service.'), m.resume()], [0, true, '0 client · 0 sans passage · 0 passage']);
  await cliquer(puce(m, 'Épandage de sel'));
  const avant2 = m.appels.requetes.length;
  await cliquer(puce(m, 'Épandage de sel'));
  eq('toucher le service DÉJÀ choisi ne fait rien', m.appels.requetes.length, avant2);

  // chaque service a SA date de départ
  const n = monde({ stockage: { 'lp_suivi_depuis_Épandage de sel': '2025-11-01' } });
  await n.ouvrir();
  const requetesAvant = n.appels.requetes.length;
  await cliquer(puce(n, 'Épandage de sel'));
  const nouvelles = n.appels.requetes.slice(requetesAvant);
  eq('un service qui a SA date de départ (1er nov. 2025) : tout est relu avec cette date', [nouvelles[0].filtres, nouvelles[1].filtres], [[['gte', 'complete_le', debutIso('2025-11-01')]], [['gte', 'jour', '2025-11-01']]]);
  eq('… et la date affichée est celle-là', n.champ('su-depuis').value, '2025-11-01');

  // changer la date
  const p = monde();
  await p.ouvrir();
  const requetes0 = p.appels.requetes.length;
  await changer(p.champ('su-depuis'), '2026-06-01');
  const rel = p.appels.requetes.slice(requetes0);
  eq('changer « Depuis le » au 1er juin : les passages et les dates à la main sont relus depuis ce jour', [rel[0].filtres, rel[1].filtres], [[['gte', 'complete_le', debutIso('2026-06-01')]], [['gte', 'jour', '2026-06-01']]]);
  eq('… la date est retenue POUR CE SERVICE', p.stockage['lp_suivi_depuis_Coupe de gazon'], '2026-06-01');
  eq('… les passages d\'avant disparaissent (3 au lieu de 6 pour la première famille)', [p.lignes()[0].dates, p.lignes()[0].n], [['9 juin', '23 juin', '7 juil.'], '3 passages']);
  eq('… l\'écran montre la nouvelle date', p.champ('su-depuis').value, '2026-06-01');
  await changer(p.champ('su-depuis'), '');
  eq('une date vide : « Choisis une date de départ », rien n\'est relu, l\'ancienne date revient', [p.dernierToast(), p.appels.requetes.length === requetes0 + rel.length, p.champ('su-depuis').value], ['⚠ Choisis une date de départ', true, '2026-06-01']);
  await changer(p.champ('su-depuis'), '1999-12-31');
  eq('… une date d\'avant 2000 est refusée aussi', p.dernierToast(), '⚠ Choisis une date de départ');
  await changer(p.champ('su-depuis'), 'abc');
  eq('… un texte aussi', [p.dernierToast(), p.appels.requetes.length === requetes0 + rel.length], ['⚠ Choisis une date de départ', true]);
}

log('\n=== CE QUI EST RETENU D\'UNE OUVERTURE À L\'AUTRE ===');
{
  const m = monde({ stockage: { lp_suivi_service: 'Épandage de sel', 'lp_suivi_depuis_Épandage de sel': '2025-11-01' } });
  await m.ouvrir();
  eq('le service choisi la dernière fois est rouvert (« Épandage de sel »), avec SA date de départ (1er nov. 2025)', [m.puces().find((b) => b.className === 'su-puce on').textContent, m.champ('su-depuis').value, m.lignes().map((l) => l.nom)], ['Épandage de sel', '2025-11-01', ['1 · Famille Tremblay']]);
  eq('… les lectures finales utilisent cette date (les premières, celles de la date par défaut, sont remplacées)', [m.requetes('passe_arrets').at(-1).filtres, m.requetes('passages_manuels').at(-1).filtres], [[['gte', 'complete_le', debutIso('2025-11-01')]], [['gte', 'jour', '2025-11-01']]]);
  const n = monde({ stockage: { lp_suivi_service: 'Fantôme' } });
  await n.ouvrir();
  eq('un service retenu qui n\'existe plus : retour à « Coupe de gazon »', n.puces().find((b) => b.className === 'su-puce on').textContent, 'Coupe de gazon');
  const n2 = monde({ stockage: { lp_suivi_service: 'Fantôme', 'lp_suivi_depuis_Coupe de gazon': '2026-06-01' } });
  await n2.ouvrir();
  eq('… et c\'est la date de départ de la coupe de gazon (1er juin) qui compte : les lectures sont refaites avec elle', [n2.champ('su-depuis').value, n2.requetes('passe_arrets').map((r) => r.filtres[0][2]), n2.lignes()[0].dates], ['2026-06-01', [debutIso('2026-01-01'), debutIso('2026-06-01')], ['9 juin', '23 juin', '7 juil.']]);
  const o = monde({ stockage: { 'lp_suivi_depuis_Coupe de gazon': 'abc' } });
  await o.ouvrir();
  eq('une date de départ retenue qui est illisible : le 1er janvier de cette année', o.champ('su-depuis').value, '2026-01-01');
  const p = monde({ stockage: { 'lp_suivi_depuis_Coupe de gazon': '2026-06-01' } });
  await p.ouvrir();
  eq('la date de départ retenue pour le gazon (1er juin) est reprise à l\'ouverture', [p.champ('su-depuis').value, p.requetes('passe_arrets')[0].filtres], ['2026-06-01', [['gte', 'complete_le', debutIso('2026-06-01')]]]);
  const q = monde();
  await q.ouvrir();
  await cliquer(parClasse(q.lignes()[0].noeud, 'su-plus')[0]);
  const overlay = q.el('suivi-feuille-overlay');
  q.ctx.__cible = overlay;
  q.run('suiviBgFeuille({ target: {} })');
  eq('un toucher DANS la feuille (pas sur le fond) ne la ferme pas', q.feuilleOuverte(), true);
  q.run('suiviBgFeuille({ target: __cible })');
  eq('un toucher sur le FOND sombre autour de la feuille la ferme', q.feuilleOuverte(), false);
}

// =====================================================================
log('\n=== LE RYTHME DU SERVICE : « TOUS LES N JOURS » ===');
{
  const m = monde();
  await m.ouvrir();
  const champ = m.champ('su-rythme');
  await changer(champ, '21');
  const u = m.requetes('types_service', 'update');
  eq('choisir 21 jours : UNE mise à jour de types_service, pour CE service, avec la réponse demandée (un refus muet de la base se verrait)', [u.length, u[0].valeur, u[0].filtres, u[0].retour], [1, { frequence_jours: 21 }, [['eq', 'nom', 'Coupe de gazon']], 'nom']);
  eq('… message, et les états sont recalculés (17 jours n\'est plus « à faire » : 17 < 21)', [m.dernierToast(), m.lignes().map((l) => l.badge)], ['✔ Rythme : tous les 21 jours', ['En retard · 84 j', 'À jour · 7 j', 'À jour · 17 j', 'À jour · 2 j', 'Aucun passage']]);
  eq('… le résumé : 2 à faire (le retard et celui sans passage)', m.resume(), '5 clients · 2 à faire · 9 passages');
  await changer(champ, '7');
  eq('un rythme de 7 jours : 17 jours = en retard (≥ 10,5)', m.lignes().map((l) => l.badge), ['En retard · 84 j', 'À faire · 7 j', 'En retard · 17 j', 'À jour · 2 j', 'Aucun passage']);
  await changer(champ, '');
  eq('vider le champ : AUCUN rythme (null) ; plus de badge d\'état sauf « Aucun passage »', [m.requetes('types_service', 'update').at(-1).valeur, m.dernierToast(), m.lignes().map((l) => l.badge)], [{ frequence_jours: null }, '✔ Aucun rythme pour ce service', [null, null, null, null, 'Aucun passage']]);
  eq('… le résumé parle alors de clients sans passage', m.resume(), '5 clients · 1 sans passage · 9 passages');
  eq('… « À faire » ne garde plus que les clients sans passage', (await cliquer(m.filtres()[1]), m.lignes().map((l) => l.nom)), ['1 · Client D']);
  await cliquer(m.filtres()[0]);
  const nb = m.requetes('types_service', 'update').length;
  for (const mauvais of ['0', '366', '7.5', 'abc', '-3', '1e2x']) {
    await changer(champ, mauvais);
    eq(`« ${mauvais} » : refusé sans rien écrire, le champ revient à sa valeur`, [m.dernierToast(), m.requetes('types_service', 'update').length === nb, champ.value], ['⚠ Le rythme est un nombre de jours entre 1 et 365', true, '']);
  }
  await changer(champ, ' 30 ');
  eq('des espaces autour d\'un nombre valide sont acceptés (« 30 »)', m.requetes('types_service', 'update').at(-1).valeur, { frequence_jours: 30 });
  await changer(champ, '1');
  await changer(champ, '365');
  eq('les bornes 1 et 365 sont acceptées', m.requetes('types_service', 'update').slice(-2).map((r) => r.valeur.frequence_jours), [1, 365]);
  eq('… le rythme du service est bien gardé dans l\'écran (365)', m.champ('su-rythme').value, '365');
}
{
  // erreurs du rythme
  const m = monde({ erreurs: { 'types_service.update': { message: 'boum' } } });
  await m.ouvrir();
  await changer(m.champ('su-rythme'), '10');
  eq('un refus du serveur : « n\'a pas pu être enregistré » ; le champ et l\'écran gardent l\'ancien rythme (14)', [m.dernierToast(), m.champ('su-rythme').value, m.lignes()[2].badge], ['❌ Le rythme n’a pas pu être enregistré.', '14', 'À faire · 17 j']);
  const r = monde({ erreurs: { 'types_service.update': { message: 'Failed to fetch' } } });
  await r.ouvrir();
  await changer(r.champ('su-rythme'), '10');
  eq('le signal disparaît pendant l\'envoi : « Le signal a disparu » ; le téléphone se sait hors réseau', [r.dernierToast(), r.run('reseau.enLigne'), r.champ('su-rythme').value], ['📴 Le signal a disparu : le rythme n’a pas été enregistré.', false, '14']);
  const s = monde({ erreurs: { 'types_service.update': { code: '42703', message: 'column types_service.frequence_jours does not exist' } } });
  await s.ouvrir();
  await changer(s.champ('su-rythme'), '10');
  eq('la colonne du rythme n\'existe pas (SQL 28 pas exécuté) : un message qui le dit', s.dernierToast(), '❌ Le rythme n’est pas encore activé dans ta base (fichier SQL 28).');
  const t = monde({ arrets: [...STOPS(), { id: 's50', adresse: '1 rue X', client: 'X', service: 'Entretien paysager', route_id: null, ordre: 0, actif: true, created_at: '2026-04-01T00:00:00Z' }] });
  await t.ouvrir();
  await cliquer(t.puces().find((b) => b.textContent === 'Entretien paysager'));
  await changer(t.champ('su-rythme'), '10');
  eq('un service qui n\'est PAS dans l\'onglet Services (aucune ligne changée) : « ajoute-le d\'abord »', [t.dernierToast(), t.champ('su-rythme').value], ['❌ Ce service n’est pas dans l’onglet Services : ajoute-le d’abord.', '']);
  const u = monde();
  await u.ouvrir();
  u.run('reseau.enLigne = false');
  await changer(u.champ('su-rythme'), '10');
  eq('hors réseau : rien n\'est écrit', [u.dernierToast(), u.requetes('types_service', 'update').length], ['📴 Pas de réseau : le rythme ne peut pas être enregistré maintenant.', 0]);
  const v = monde({ panne: (q) => q.op === 'update' });
  await v.ouvrir();
  await changer(v.champ('su-rythme'), '10');
  eq('la requête PLANTE (réseau) : « Le signal a disparu »', [v.dernierToast(), v.run('reseau.enLigne'), v.el('sync').classList.contains('show')], ['📴 Le signal a disparu : le rythme n’a pas été enregistré.', false, false]);
}

// =====================================================================
log('\n=== NOTER UN PASSAGE À LA MAIN (« ＋ date ») ===');
{
  const m = monde();
  await m.ouvrir();
  const plus = () => parClasse(m.lignes()[0].noeud, 'su-plus')[0];
  await cliquer(plus());
  eq('la fenêtre s\'ouvre : « Ajouter un passage », le client, une date (aujourd\'hui, pas dans le futur, pas avant 2000), une note de 200 caractères au plus', [m.feuilleOuverte(), m.el('suivi-feuille-titre').textContent, parClasse(m.sheet(), 'su-cible')[0].textContent, tous(m.sheet()).filter((x) => x.type === 'date').map((x) => [x.value, x.max, x.min]), tous(m.sheet()).filter((x) => x.type === 'text').map((x) => x.maxLength)],
    [true, 'Ajouter un passage', 'Famille Tremblay : 10 rue des Pins, Louiseville', [[AUJOURDHUI, AUJOURDHUI, '2000-01-01']], [200]]);
  const champs = () => ({ date: tous(m.sheet()).find((x) => x.type === 'date'), note: tous(m.sheet()).find((x) => x.type === 'text'), boutons: parClasse(m.sheet(), 'su-boutons')[0].children });
  eq('… deux boutons : Annuler, Enregistrer', champs().boutons.map((b) => b.textContent), ['Annuler', 'Enregistrer']);
  await cliquer(champs().boutons[0]);
  eq('« Annuler » ferme la fenêtre sans rien écrire', [m.feuilleOuverte(), m.requetes('passages_manuels', 'upsert').length], [false, 0]);

  await cliquer(plus());
  let c = champs();
  c.date.value = ''; await cliquer(c.boutons[1]);
  eq('sans date : refusé, rien n\'est écrit, la fenêtre reste', [m.dernierToast(), m.requetes('passages_manuels', 'upsert').length, m.feuilleOuverte()], ['⚠ Choisis la date du passage.', 0, true]);
  c.date.value = '2026-09-30'; await cliquer(c.boutons[1]);
  eq('une date dans le FUTUR (demain) : refusée', [m.dernierToast(), m.requetes('passages_manuels', 'upsert').length], ['⚠ Cette date est dans le futur.', 0]);
  c.date.value = '1999-01-01'; await cliquer(c.boutons[1]);
  eq('une date d\'avant 2000 : refusée', [m.dernierToast(), m.requetes('passages_manuels', 'upsert').length], ['⚠ Cette date est trop ancienne.', 0]);
  c.date.value = 'abc'; await cliquer(c.boutons[1]);
  eq('un texte à la place d\'une date : refusé', [m.dernierToast(), m.requetes('passages_manuels', 'upsert').length], ['⚠ Choisis la date du passage.', 0]);
  await cliquer(plus());
  c = champs();
  c.date.value = '2026-09-28'; c.note.value = '  Bon travail  ';
  await cliquer(c.boutons[1]);
  const u = m.requetes('passages_manuels', 'upsert').at(-1);
  eq('« Enregistrer » : UNE écriture avec l\'arrêt de RÉFÉRENCE (le plus ancien : s1, pas la copie), le jour, la note nettoyée ; « ignorer ce qui existe déjà »', [u.valeur, u.opts, u.retour], [[{ stop_id: 's1', jour: '2026-09-28', note: 'Bon travail' }], { onConflict: 'stop_id,jour', ignoreDuplicates: true }, 'id, stop_id, jour, note']);
  eq('… la fenêtre se ferme, un message, et la date apparaît TOUT DE SUITE en pastille « à la main » (7 passages, à jour depuis 1 jour)', [m.feuilleOuverte(), m.dernierToast(), m.lignes()[0].dates.at(-1), m.lignes()[0].manuelles, m.lignes()[0].n, m.lignes()[0].badge], [false, '✔ Passage noté : 28 sept.', '28 sept.', ['7 juil.', '28 sept.'], '7 passages', 'À jour · 1 j']);
  eq('… sans relire la base (aucune lecture de plus)', m.requetes('passages_manuels').length, 1);

  await cliquer(plus());
  c = champs();
  c.date.value = '2026-09-28';
  await cliquer(c.boutons[1]);
  eq('la MÊME date une 2ᵉ fois pour ce client : « déjà notée », la fenêtre reste ouverte, rien ne double', [m.dernierToast(), m.feuilleOuverte(), m.lignes()[0].dates.filter((d) => d === '28 sept.').length], ['Cette date est déjà notée pour ce client.', true, 1]);
  c.note.value = ''; c.date.value = '2026-09-27';
  await cliquer(c.boutons[1]);
  eq('une note vide est envoyée comme « rien » (null)', m.requetes('passages_manuels', 'upsert').at(-1).valeur[0].note, null);
  eq('le message de fin nomme la date', m.dernierToast(), '✔ Passage noté : 27 sept.');
}
{
  // un client SANS nom : le libellé est l'adresse ; une date d'une autre année ; les cas d'erreur
  const m = monde();
  await m.ouvrir();
  const plus2 = () => parClasse(m.lignes()[1].noeud, 'su-plus')[0];
  await cliquer(plus2());
  eq('un client sans nom : la fenêtre nomme l\'adresse', parClasse(m.sheet(), 'su-cible')[0].textContent, '8 av. du Parc, Louiseville');
  const c = { date: tous(m.sheet()).find((x) => x.type === 'date'), b: parClasse(m.sheet(), 'su-boutons')[0].children[1] };
  c.date.value = '2025-12-20';
  await cliquer(c.b);
  eq('une date d\'AVANT la date de départ (20 déc. 2025) est enregistrée mais n\'apparaît pas dans la liste actuelle', [m.requetes('passages_manuels', 'upsert').at(-1).valeur[0].jour, m.lignes()[1].dates, m.dernierToast()], ['2025-12-20', ['22 sept.'], '✔ Passage noté : 20 déc. 2025']);
}
{
  const cas = async (o, action, attendu) => {
    const m = monde(o);
    await m.ouvrir();
    if (action) action(m);
    await cliquer(parClasse(m.lignes()[0].noeud, 'su-plus')[0]);
    const b = parClasse(m.sheet(), 'su-boutons')[0].children[1];
    await cliquer(b);
    return m;
  };
  let m = await cas({ erreurs: { 'passages_manuels.upsert': { code: '42501', message: 'permission denied' } } });
  eq('accès refusé par la base (42501) : « réservé à l\'administrateur », la fenêtre reste', [m.dernierToast(), m.feuilleOuverte()], ['❌ Accès refusé : réservé à l’administrateur.', true]);
  m = await cas({ erreurs: { 'passages_manuels.upsert': { message: 'boum' } } });
  eq('une autre erreur : « n\'ont pas pu être enregistrées »', m.dernierToast(), '❌ Les dates n’ont pas pu être enregistrées.');
  m = await cas({ erreurs: { 'passages_manuels.upsert': { code: 'PGRST205', message: "Could not find the table 'public.passages_manuels' in the schema cache" } } });
  eq('la table n\'existe pas (SQL 28 pas exécuté) : un message qui le dit', m.dernierToast(), '❌ Les dates à la main ne sont pas encore activées dans ta base (fichier SQL 28).');
  m = await cas({ erreurs: { 'passages_manuels.upsert': { message: 'Failed to fetch' } } });
  eq('le signal disparaît pendant l\'envoi : « rien n\'a été enregistré » ; hors réseau ensuite', [m.dernierToast(), m.run('reseau.enLigne'), m.lignes()[0].manuelles], ['📴 Le signal a disparu : rien n’a été enregistré.', false, ['7 juil.']]);
  m = await cas({ panne: (q) => q.op === 'upsert' });
  eq('la requête PLANTE (réseau) : même chose, « ⟳ Sync… » éteint', [m.dernierToast(), m.el('sync').classList.contains('show')], ['📴 Le signal a disparu : rien n’a été enregistré.', false]);
  m = await cas({}, (mm) => mm.run('reseau.enLigne = false'));
  eq('hors réseau : rien n\'est écrit, un message', [m.dernierToast(), m.requetes('passages_manuels', 'upsert').length], ['📴 Pas de réseau : les dates ne peuvent pas être enregistrées maintenant.', 0]);
  m = await cas({ sansTableManuels: true });
  eq('table absente DÈS L\'OUVERTURE : aucune écriture tentée, un message', [m.dernierToast(), m.requetes('passages_manuels', 'upsert').length], ['❌ Les dates à la main ne sont pas encore activées dans ta base (fichier SQL 28).', 0]);
  // double envoi : pendant qu'une écriture dure, un 2ᵉ toucher ne fait rien
  let liberer = null;
  const porte = new Promise((res) => { liberer = res; });
  const n = monde({ retards: { 'passages_manuels.upsert': [porte] } });
  await n.ouvrir();
  await cliquer(parClasse(n.lignes()[0].noeud, 'su-plus')[0]);
  const bOk = parClasse(n.sheet(), 'su-boutons')[0].children[1];
  const p1 = bOk.onclick();
  await Promise.resolve();
  const p2 = bOk.onclick();
  eq('pendant l\'écriture : « ⟳ Sync… » est allumé', n.el('sync').classList.contains('show'), true);
  liberer();
  await p1; await p2;
  eq('… un 2ᵉ toucher pendant l\'écriture n\'envoie RIEN de plus (une seule écriture)', n.requetes('passages_manuels', 'upsert').length, 1);
  eq('… « ⟳ Sync… » est éteint à la fin', n.el('sync').classList.contains('show'), false);
}

{
  const t = monde();
  await t.ouvrir();
  await cliquer(parClasse(t.lignes()[0].noeud, 'su-plus')[0]);
  await cliquer(parClasse(t.sheet(), 'su-boutons')[0].children[1]);   // la date proposée au départ : aujourd'hui
  eq('la date proposée au départ (aujourd\'hui) est permise', [t.requetes('passages_manuels', 'upsert').at(-1).valeur[0].jour, t.dernierToast()], [AUJOURDHUI, '✔ Passage noté : 29 sept.']);
}

log('\n=== UNE DATE POUR PLUSIEURS CLIENTS ===');
{
  const m = monde();
  await m.ouvrir();
  const lot = () => parClasse(m.corps(), 'su-actions')[0].children[0];
  await cliquer(lot());
  eq('la fenêtre : « Une date pour plusieurs clients », une date (aujourd\'hui), la liste des 5 clients par section', [m.feuilleOuverte(), m.el('suivi-feuille-titre').textContent, tous(m.sheet()).filter((x) => x.type === 'date').map((x) => x.value), parClasse(m.sheet(), 'su-cases-section').map((s) => s.textContent), parClasse(m.sheet(), 'su-case').map((c) => texte(c))],
    [true, 'Une date pour plusieurs clients', [AUJOURDHUI], ['Louiseville', 'Yamachiche', 'Sans route'], ['Famille Tremblay : 10 rue des Pins, Louiseville', '8 av. du Parc, Louiseville', 'Client C : 55 chemin du Lac, Yamachiche', 'Client E : 2 rue Été, Ville', 'Client D : 1 rue Sansroute, Ville']]);
  const cases = () => parClasse(m.sheet(), 'su-case').map((c) => tous(c).find((x) => x.type === 'checkbox'));
  const boutons = () => parClasse(m.sheet(), 'su-boutons')[0].children;
  const outils = () => parClasse(m.sheet(), 'su-outils')[0].children;
  eq('… rien n\'est coché au départ ; le bouton dit « Enregistrer »', [cases().map((c) => c.checked), boutons()[1].textContent], [[false, false, false, false, false], 'Enregistrer']);
  await cliquer(boutons()[1]);
  eq('« Enregistrer » sans rien cocher : « Coche au moins un client », rien n\'est écrit', [m.dernierToast(), m.requetes('passages_manuels', 'upsert').length], ['⚠ Coche au moins un client.', 0]);
  cases()[0].checked = true; cases()[0].onchange();
  cases()[3].checked = true; cases()[3].onchange();
  eq('cocher deux clients : le bouton compte (« Enregistrer (2) »)', boutons()[1].textContent, 'Enregistrer (2)');
  await cliquer(outils()[0]);
  eq('« ☑ Tout cocher » : les 5 cochés, le bouton dit (5)', [cases().map((c) => c.checked), boutons()[1].textContent], [[true, true, true, true, true], 'Enregistrer (5)']);
  await cliquer(outils()[1]);
  eq('« ☐ Tout décocher » : aucun, le bouton redevient « Enregistrer »', [cases().map((c) => c.checked), boutons()[1].textContent], [[false, false, false, false, false], 'Enregistrer']);
  cases()[0].checked = true; cases()[2].checked = true; cases()[4].checked = true;
  const dateLot = tous(m.sheet()).find((x) => x.type === 'date');
  dateLot.value = '2026-09-25';
  await cliquer(boutons()[1]);
  const u = m.requetes('passages_manuels', 'upsert').at(-1);
  eq('trois clients cochés : UNE écriture avec l\'arrêt de référence de chacun, le même jour, sans note', u.valeur, [{ stop_id: 's1', jour: '2026-09-25', note: null }, { stop_id: 's3', jour: '2026-09-25', note: null }, { stop_id: 's4', jour: '2026-09-25', note: null }]);
  eq('… « ignorer ce qui existe déjà »', u.opts, { onConflict: 'stop_id,jour', ignoreDuplicates: true });
  eq('… la fenêtre se ferme, « 3 passages notés », les dates apparaissent', [m.feuilleOuverte(), m.dernierToast(), m.lignes().map((l) => l.dates.includes('25 sept.')), m.resume()], [false, '✔ 3 passages notés', [true, false, true, false, true], '5 clients · 0 à faire · 12 passages']);
  eq('… (Client D n\'a plus « Aucun passage » : à jour depuis 4 jours)', m.lignes()[4].badge, 'À jour · 4 j');
  // recommencer : les mêmes clients, la même date → déjà notés
  await cliquer(lot());
  cases().forEach((c, i) => { c.checked = i === 0 || i === 2; });
  tous(m.sheet()).find((x) => x.type === 'date').value = '2026-09-25';
  await cliquer(boutons()[1]);
  eq('les MÊMES clients, la même date : rien de nouveau, le message le dit', [m.dernierToast(), m.lignes()[0].dates.filter((d) => d === '25 sept.').length], ['✔ 0 passage noté (2 déjà notés)', 1]);
  // un seul nouveau parmi des existants
  await cliquer(lot());
  cases().forEach((c, i) => { c.checked = i === 0 || i === 1; });
  tous(m.sheet()).find((x) => x.type === 'date').value = '2026-09-25';
  await cliquer(boutons()[1]);
  eq('un client déjà noté et un nouveau : « 1 passage noté (1 déjà noté) »', m.dernierToast(), '✔ 1 passage noté (1 déjà noté)');
  // la liste suit la recherche et le filtre
  const champRech = m.champ('su-recherche');
  champRech.value = 'pins'; champRech.oninput();
  await cliquer(lot());
  eq('avec une recherche (« pins ») : seuls les clients affichés sont proposés (un seul)', parClasse(m.sheet(), 'su-case').length, 1);
  await cliquer(boutons()[0]);
  await cliquer(m.filtres()[1]);
  await cliquer(lot());
  eq('… et avec le filtre « À faire » (plus aucun client à faire) : rien à cocher, aucune fenêtre', [m.dernierToast(), m.feuilleOuverte()], ['Aucun client à cocher.', false]);
  await cliquer(m.filtres()[0]);
  champRech.value = 'zzz'; champRech.oninput();
  await cliquer(lot());
  eq('sans client affiché : « Aucun client à cocher. », aucune fenêtre', [m.dernierToast(), m.feuilleOuverte()], ['Aucun client à cocher.', false]);
  champRech.value = ''; champRech.oninput();
  await cliquer(lot());
  tous(m.sheet()).find((x) => x.type === 'date').value = '2026-10-15';
  cases()[0].checked = true;
  await cliquer(boutons()[1]);
  eq('une date dans le futur : refusée', [m.dernierToast(), m.feuilleOuverte()], ['⚠ Cette date est dans le futur.', true]);
  const n = monde({ erreurs: { 'passages_manuels.upsert': { message: 'boum' } } });
  await n.ouvrir();
  await cliquer(parClasse(n.corps(), 'su-actions')[0].children[0]);
  parClasse(n.sheet(), 'su-case')[0].children[0].checked = true;
  await cliquer(parClasse(n.sheet(), 'su-boutons')[0].children[1]);
  eq('une erreur : « n\'ont pas pu être enregistrées », la fenêtre reste', [n.dernierToast(), n.feuilleOuverte()], ['❌ Les dates n’ont pas pu être enregistrées.', true]);
}

log('\n=== RETIRER UNE DATE NOTÉE À LA MAIN ===');
{
  const m = monde();
  await m.ouvrir();
  const pastilleManuelle = () => parClasse(m.lignes()[0].noeud, 'manuel')[0];
  const p = pastilleManuelle();
  eq('la pastille « à la main » : un bouton avec une info-bulle (la note) et un nom pour les lecteurs d\'écran', [p.textContent, p.tagName, p.title, p.attrs['aria-label']], ['7 juil.', 'BUTTON', 'Noté à la main : remplaçant', 'Date notée à la main, 7 juil. : toucher pour la retirer']);
  m.repondre(false);
  await cliquer(p);
  eq('toucher : une confirmation avec le client, la date et la note ; « Garder » : rien n\'est effacé', [m.appels.confirmations[0], m.requetes('passages_manuels', 'delete').length], [['Retirer cette date ?', 'Famille Tremblay : 10 rue des Pins, Louiseville : le passage du 7 juil., noté à la main (« remplaçant »), sera retiré.', 'Retirer', 'Garder'], 0]);
  m.repondre(true);
  await cliquer(p);
  const d = m.requetes('passages_manuels', 'delete');
  eq('« Retirer » : UNE suppression de CETTE ligne (m1), avec la réponse demandée', [d.length, d[0].filtres, d[0].retour], [1, [['eq', 'id', 'm1']], 'id']);
  eq('… la pastille disparaît, le total baisse (5 passages), le dernier passage est le 23 juin (98 jours : en retard), message', [m.lignes()[0].dates, m.lignes()[0].n, m.lignes()[0].badge, m.dernierToast()], [['20 avr.', '12 mai', '26 mai', '9 juin', '23 juin'], '5 passages', 'En retard · 98 j', '🗑 Date retirée']);
  const q = m.lignes()[1];
  await cliquer(parClasse(q.noeud, 'manuel')[0]);
  eq('une date sans note : la confirmation ne parle pas de note', m.appels.confirmations.at(-1)[1], '8 av. du Parc, Louiseville : le passage du 22 sept., noté à la main, sera retiré.');
  eq('les dates des « Complété » ne sont PAS des boutons : aucun toucher ne les retire', parClasse(m.lignes()[0].noeud, 'su-date').filter((x) => !x.className.includes('manuel') && !x.className.includes('su-plus')).every((x) => x.tagName === 'SPAN' && x.onclick === null), true);
  eq('une date à la fois « Complété » et notée à la main (9 juin) : c\'est une date de l\'application, pas retirable ici', m.lignes()[0].manuelles.includes('9 juin'), false);
}
{
  const cas = async (o, action) => {
    const m = monde(o);
    await m.ouvrir();
    if (action) action(m);
    await cliquer(parClasse(m.lignes()[0].noeud, 'manuel')[0]);
    return m;
  };
  let m = await cas({ erreurs: { 'passages_manuels.delete': { message: 'boum' } } });
  eq('un refus : « n\'a pas pu être retirée », la date reste', [m.dernierToast(), m.lignes()[0].manuelles], ['❌ La date n’a pas pu être retirée.', ['7 juil.']]);
  m = await cas({ erreurs: { 'passages_manuels.delete': { message: 'Failed to fetch' } } });
  eq('le signal disparaît : « la date n\'a pas été retirée » ; hors réseau', [m.dernierToast(), m.run('reseau.enLigne')], ['📴 Le signal a disparu : la date n’a pas été retirée.', false]);
  m = await cas({ panne: (q) => q.op === 'delete' });
  eq('la requête PLANTE : même chose', [m.dernierToast(), m.el('sync').classList.contains('show')], ['📴 Le signal a disparu : la date n’a pas été retirée.', false]);
  m = await cas({}, (mm) => mm.run('reseau.enLigne = false'));
  eq('hors réseau : rien n\'est écrit', [m.dernierToast(), m.requetes('passages_manuels', 'delete').length], ['📴 Pas de réseau : la date ne peut pas être retirée maintenant.', 0]);
  m = await cas({}, (mm) => { mm.donnees.passages_manuels = mm.donnees.passages_manuels.filter((x) => x.id !== 'm1'); });
  eq('la date a déjà été retirée ailleurs (aucune ligne changée) : le dit', m.dernierToast(), '❌ La date n’a pas pu être retirée (déjà retirée, ou accès refusé).');
}

log('\n=== LE DÉTAIL D\'UN CLIENT : TOUTES SES DATES, QUI ET QUEL CAMION ===');
{
  const m = monde();
  await m.ouvrir();
  await cliquer(parClasse(m.lignes()[0].noeud, 'su-nom')[0]);
  const rangs = () => parClasse(m.sheet(), 'su-detail').map((r) => [r.children[0].textContent, r.children[1].textContent]);
  eq('la fenêtre porte le nom du client, avec son adresse dessous', [m.feuilleOuverte(), m.el('suivi-feuille-titre').textContent, parClasse(m.sheet(), 'su-cible')[0].textContent], [true, 'Famille Tremblay', '10 rue des Pins, Louiseville']);
  const r = m.requetes('passe_arrets').at(-1);
  eq('la lecture : les personnes et les camions viennent des tables liées, pour les DEUX arrêts (le client et sa copie), depuis la date de départ, du plus récent au plus vieux', [r.cols, r.filtres, r.ordres], [
    'complete_le, utilisateurs!complete_par(nom), passes(equipes(nom))', [['in', 'stop_id', ['s1', 's1b']], ['gte', 'complete_le', debutIso('2026-01-01')]], [['complete_le', 'desc']]]);
  const lignes = rangs();
  eq('les dates, du plus récent au plus vieux (les 6 jours de l\'application + la date à la main du 7 juillet)', lignes.map((x) => x[0].replace(/, \d{1,2} h \d{2}$/, '')), ['7 juil.', '23 juin', '9 juin', '9 juin', '26 mai', '12 mai', '20 avr.']);
  eq('… la date à la main dit « Noté à la main » avec sa note', lignes[0][1], 'Noté à la main : remplaçant');
  eq('… l\'heure est écrite pour les « Complété » (« 9 h 12 » : heure locale du téléphone)', lignes.slice(1).every((x) => /, \d{1,2} h \d{2}$/.test(x[0])), true);
  eq('… la personne et le camion sont écrits quand on les connaît ; sinon « Complété avec l\'application »', lignes.slice(1).map((x) => x[1]), ['Complété avec l’application', 'Luc · Camion 2', 'Complété avec l’application', 'Complété avec l’application', 'Éric · Camion 1', 'Luc · Camion 2']);
  eq('… le bouton « Fermer »', [parClasse(m.sheet(), 'su-boutons')[0].children.map((b) => b.textContent)], [['Fermer']]);
  await cliquer(parClasse(m.sheet(), 'su-boutons')[0].children[0]);
  eq('… qui ferme la fenêtre', m.feuilleOuverte(), false);
  eq('« Chargement… » disparaît une fois la liste là', parClasse(m.sheet(), 'su-message').length, 0);
  await cliquer(parClasse(m.lignes()[4].noeud, 'su-nom')[0]);
  eq('un client sans aucun passage : « Aucun passage depuis le 1er janv. »', parClasse(m.sheet(), 'su-message').map((x) => x.textContent), ['Aucun passage depuis le 1er janv.']);
}
{
  const m = monde({ sansLiens: true });
  await m.ouvrir();
  await cliquer(parClasse(m.lignes()[0].noeud, 'su-nom')[0]);
  const rq = m.requetes('passe_arrets').slice(-2);
  eq('si le lien avec les personnes et les camions n\'existe pas : on relit les dates seules', [rq[0].cols, rq[1].cols], ['complete_le, utilisateurs!complete_par(nom), passes(equipes(nom))', 'complete_le']);
  eq('… la relecture garde les mêmes filtres (les DEUX arrêts, depuis la date de départ) et le même ordre', [rq[1].filtres, rq[1].ordres], [[['in', 'stop_id', ['s1', 's1b']], ['gte', 'complete_le', debutIso('2026-01-01')]], [['complete_le', 'desc']]]);
  eq('… et chaque date dit « Complété avec l\'application »', parClasse(m.sheet(), 'su-detail').filter((r) => r.children[1].textContent === 'Complété avec l’application').length, 6);
  const vieux = monde({ sansLiens: true, completions: [...COMPLETIONS(), { id: 'c13', stop_id: 's1', complete_le: T('2025-10-01') }, { id: 'c14', stop_id: 's1b', complete_le: T('2025-11-05') }] });
  await vieux.ouvrir();
  await cliquer(parClasse(vieux.lignes()[0].noeud, 'su-nom')[0]);
  eq('… les passages d\'AVANT la date de départ (1er oct. et 5 nov. 2025) ne sont pas montrés non plus', parClasse(vieux.sheet(), 'su-detail').map((r) => r.children[0].textContent).filter((t) => /2025|oct\.|nov\./.test(t)).length, 0);
  const n = monde({ erreurs: { 'passe_arrets.select': (q) => (/complete_le/.test(q.cols) && q.plage === null ? { message: 'boum' } : null) } });
  await n.ouvrir();
  await cliquer(parClasse(n.lignes()[0].noeud, 'su-nom')[0]);
  eq('une erreur de lecture : « Impossible de charger le détail. »', parClasse(n.sheet(), 'su-message').map((x) => x.textContent), ['❌ Impossible de charger le détail.']);
}

log('\n=== L\'OUVERTURE : SANS LE SQL 28, SANS RÉSEAU, EN ERREUR, ET DES LECTURES QUI SE CROISENT ===');
{
  const m = monde({ sansTableManuels: true });
  await m.ouvrir();
  eq('SQL 28 pas exécuté : l\'écran s\'ouvre quand même, avec les dates de l\'application', [m.lignes().length, m.lignes()[0].dates.length], [5, 5]);
  eq('… un message explique que les dates à la main ne sont pas encore activées', m.messages().includes('Les dates à la main ne sont pas encore activées dans ta base (fichier SQL 28).'), true);
  const n = monde({ sansRythme: true });
  await n.ouvrir();
  eq('la colonne du rythme absente : l\'écran s\'ouvre, sans rythme (champ vide, pas de badge d\'état)', [n.lignes().length, n.champ('su-rythme').value, n.lignes().map((l) => l.badge)], [5, '', [null, null, null, null, 'Aucun passage']]);
  eq('… les types sont relus SANS la colonne du rythme (2 lectures)', n.requetes('types_service').map((r) => r.cols), ['nom, actif, frequence_jours', 'nom, actif']);
  const o = monde();
  o.run('reseau.enLigne = false');
  await o.ouvrir();
  eq('sans réseau : « Pas de réseau », aucune lecture', [o.messages(), o.appels.requetes.length], [['📴 Pas de réseau : le suivi se lit avec du signal.'], 0]);
  const p = monde({ panne: () => true });
  await p.ouvrir();
  eq('le signal disparaît pendant la lecture : « Impossible de charger le suivi », le téléphone se sait hors réseau', [p.messages(), p.run('reseau.enLigne')], [['❌ Impossible de charger le suivi. Vérifie la connexion, puis réessaie.'], false]);
  const q = monde({ erreurs: { 'passe_arrets.select': { message: 'refusé' } } });
  await q.ouvrir();
  eq('un refus du serveur : le même message, mais le téléphone reste EN LIGNE (ce n\'est pas une zone morte)', [q.messages(), q.run('reseau.enLigne')], [['❌ Impossible de charger le suivi. Vérifie la connexion, puis réessaie.'], true]);
  const q2 = monde({ erreurs: { 'passages_manuels.select': { message: 'refusé' } } });
  await q2.ouvrir();
  eq('une erreur de lecture des dates à la main qui N\'est PAS « la table n\'existe pas » : le suivi ne s\'ouvre pas (rien n\'est caché)', [q2.messages(), q2.lignes().length], [['❌ Impossible de charger le suivi. Vérifie la connexion, puis réessaie.'], 0]);
  const a2 = monde();
  await a2.ouvrir();
  const avantMaj = a2.appels.requetes.length;
  await cliquer(parClasse(a2.corps(), 'su-actions')[0].children[1]);
  eq('« ↻ Actualiser » relit tout (les 3 lectures de plus) et redessine l\'écran', [a2.appels.requetes.length - avantMaj, a2.lignes().length], [3, 5]);
  const r = monde({ arrets: [], types: [] });
  await r.ouvrir();
  eq('aucun service du tout : un message d\'invitation', r.messages(), ['Aucun service : ajoute d\'abord des clients (＋ Stop) ou un type de service (onglet Services).']);
}
{
  // deux ouvertures qui se croisent : la plus ANCIENNE réponse est ignorée
  let liberer = null;
  const porte = new Promise((res) => { liberer = res; });
  const m = monde({ retards: { 'passe_arrets.select': [porte] } });
  const premiere = m.ouvrir();
  while (!m.appels.requetes.length) await Promise.resolve();   // la 1ʳᵉ lecture est partie (elle a vu tous les passages) et attend à la porte
  m.donnees.passe_arrets = [];   // la 2ᵉ lecture ne verra aucun passage
  const deuxieme = m.ouvrir();
  await deuxieme;
  const apres2 = m.lignes().map((l) => l.dates.length);
  liberer();
  await premiere;
  eq('une lecture lente qui arrive APRÈS une plus récente est ignorée (l\'écran garde la plus récente ; la lente, elle, avait vu 6, 1, 1, 1 et 0 dates)', [apres2, m.lignes().map((l) => l.dates.length)], [[2, 1, 0, 0, 0], [2, 1, 0, 0, 0]]);
  // si l'onglet a changé entre-temps : rien n'est dessiné
  let l2 = null;
  const porte2 = new Promise((res) => { l2 = res; });
  const n = monde({ retards: { 'passe_arrets.select': [porte2] } });
  const p = n.ouvrir();
  while (!n.appels.requetes.length) await Promise.resolve();
  n.run("_adminOnglet = 'employes'");
  n.corps().children.length = 0;
  l2();
  await p;
  eq('si l\'administrateur a changé d\'onglet pendant la lecture : le Suivi ne se dessine PAS par-dessus', n.lignes().length, 0);
}
{
  // beaucoup de lignes : lues par pages de 1000
  const beaucoup = [];
  for (let i = 0; i < 2500; i++) beaucoup.push({ id: 'p' + String(i).padStart(5, '0'), stop_id: 's3', complete_le: T('2026-05-' + String(1 + (i % 25)).padStart(2, '0')) });
  const m = monde({ completions: beaucoup });
  await m.ouvrir();
  const pages = m.requetes('passe_arrets').map((r) => r.plage);
  eq('2500 « Complété » : trois pages (0–999, 1000–1999, 2000–2999)', pages, [[0, 999], [1000, 1999], [2000, 2999]]);
  eq('… tout est utilisé : 25 jours différents pour le client', m.lignes().find((l) => l.nom === '1 · Client C').n, '25 passages');
  const exact = [];
  for (let i = 0; i < 1000; i++) exact.push({ id: 'q' + String(i).padStart(5, '0'), stop_id: 's3', complete_le: T('2026-05-01') });
  const n = monde({ completions: exact });
  await n.ouvrir();
  eq('exactement 1000 lignes : une 2ᵉ page est demandée (elle revient vide) et l\'on s\'arrête', n.requetes('passe_arrets').map((r) => r.plage), [[0, 999], [1000, 1999]]);
  const petit = monde({ completions: [] });
  await petit.ouvrir();
  eq('aucune ligne : une seule page', petit.requetes('passe_arrets').length, 1);
}

// =====================================================================
log('\n=== LE CÂBLAGE : LA PAGE, LA FEUILLE DE STYLE, LA SÛRETÉ DU CODE ===');
{
  const html = lire('index.html');
  const css = lire('css/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const regles = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((x) => ({ sel: x[1].trim().replace(/\s+/g, ' '), corps: x[2].replace(/\s+/g, '') }));
  const de = (sel) => regles.filter((r) => r.sel.split(',').map((s) => s.trim()).includes(sel));
  const derniere = (sel) => de(sel).pop();
  const scripts = [...html.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map((x) => x[1]);
  vrai('la page charge admin-suivi.js, une seule fois, après admin-routes.js et avant demarrage.js', scripts.filter((s) => s === 'admin-suivi.js').length === 1 && scripts.indexOf('admin-suivi.js') > scripts.indexOf('admin-routes.js') && scripts.indexOf('admin-suivi.js') < scripts.indexOf('demarrage.js'), scripts.join(' '));
  const feuille = html.match(/<div id="suivi-feuille-overlay"[\s\S]*?<div id="icone-tache-overlay"/)?.[0] ?? '';
  vrai('la page a la feuille du Suivi (titre, corps), fermée d\'un toucher à côté', /<div id="suivi-feuille-overlay" onclick="suiviBgFeuille\(event\)">/.test(feuille) && feuille.includes('id="suivi-feuille-titre"') && feuille.includes('id="suivi-feuille-corps"'), feuille.slice(0, 200));
  vrai('… c\'est une boîte de dialogue nommée pour les lecteurs d\'écran (role, aria-modal, aria-labelledby)', /<div id="suivi-feuille" role="dialog" aria-modal="true" aria-labelledby="suivi-feuille-titre">/.test(feuille));
  const ov = derniere('#suivi-feuille-overlay')?.corps ?? '';
  vrai('la feuille couvre l\'écran, en bas, AU-DESSUS du panneau d\'administration (2000 > 1500) et sous les confirmations (4000) ; elle laisse la place à la barre d\'accueil d\'un iPhone', /position:fixed/.test(ov) && /inset:0/.test(ov) && /align-items:flex-end/.test(ov) && /z-index:2000/.test(ov) && ov.includes('padding-bottom:var(--sa-bottom)') && /display:none/.test(ov), ov);
  vrai('… ouverte : affichée', /display:flex/.test(derniere('#suivi-feuille-overlay.open')?.corps ?? ''));
  vrai('… son contenu défile quand il est long (85 % de l\'écran au plus)', /max-height:85vh/.test(derniere('#suivi-feuille')?.corps ?? '') && /overflow-y:auto/.test(derniere('#suivi-feuille')?.corps ?? ''));
  vrai('la liste des cases à cocher défile aussi (38 % de l\'écran au plus)', /max-height:38vh/.test(derniere('.su-cases')?.corps ?? '') && /overflow-y:auto/.test(derniere('.su-cases')?.corps ?? ''));
  for (const c of ['.su-barre', '.su-puces', '.su-puce', '.su-puce.on', '.su-reglages', '.su-champ', '.su-filtres', '.su-recherche', '.su-message', '.su-resume', '.su-section', '.su-ligne', '.su-haut', '.su-nom', '.su-droite', '.su-n', '.su-badge', '.su-badge.ok', '.su-badge.afaire', '.su-badge.retard', '.su-adresse', '.su-dates', '.su-date', '.su-date.manuel', '.su-plus', '.su-actions', '.su-cible', '.su-boutons', '.su-outils', '.su-cases', '.su-cases-section', '.su-case', '.su-detail', '.su-detail-qui'])
    if (!de(c).length) fail(`la feuille de style a la règle « ${c} »`);
  pass('la feuille de style a les 34 règles de l\'écran Suivi');
  vrai('le badge « à jour » est vert', /color:#4ade80/.test(derniere('.su-badge.ok')?.corps ?? ''), derniere('.su-badge.ok')?.corps);
  vrai('le badge « à faire » est jaune', /color:#fbbf24/.test(derniere('.su-badge.afaire')?.corps ?? ''), derniere('.su-badge.afaire')?.corps);
  vrai('le badge « en retard » est rouge', /color:#ef4444/.test(derniere('.su-badge.retard')?.corps ?? ''), derniere('.su-badge.retard')?.corps);
  vrai('le badge « sans passage » est rouge aussi', /color:#ef4444/.test(derniere('.su-badge.aucun')?.corps ?? ''), derniere('.su-badge.aucun')?.corps);
  vrai('une date à la main est en pointillés bleus (elle se distingue d\'un « Complété »)', /border-style:dashed/.test(derniere('.su-date.manuel')?.corps ?? '') && /border-color:#60a5fa/.test(derniere('.su-date.manuel')?.corps ?? ''));
  vrai('la puce allumée prend la couleur d\'accent, comme les onglets du panneau', /background:var\(--accent\)/.test(derniere('.su-puce.on')?.corps ?? ''));
  vrai('les puces défilent de côté quand il y en a beaucoup (services)', /overflow-x:auto/.test(derniere('.su-puces')?.corps ?? ''));

  const src = lire('js/admin-suivi.js');
  const admin = lire('js/admin.js');
  vrai('admin.js : l\'onglet est enregistré, avec un repli sûr si le fichier n\'est pas encore chargé', /\{id:'suivi',icone:'📋',label:'Suivi',titre:'Suivi des passages',charger:\(typeof chargerSuiviAdmin==='function'\)\?chargerSuiviAdmin:null\}/.test(admin));
  const ecritures = [...src.matchAll(/db\.from\('([a-z_]+)'\)\s*\.(update|delete|upsert|insert)\(/g)].map((x) => x[1] + '.' + x[2]).sort();
  eq('les SEULES écritures du fichier : le rythme (types_service, mise à jour) et les dates à la main (passages_manuels, ajouter/retirer) : jamais passe_arrets, stops ni passes', ecritures, ['passages_manuels.delete', 'passages_manuels.upsert', 'types_service.update']);
  vrai('aucune donnée n\'est mise dans le code de la page : innerHTML n\'est jamais rempli avec du texte (seulement vidé)', [...src.matchAll(/innerHTML\s*=\s*([^;]+);/g)].every((x) => x[1].trim() === "''"), [...src.matchAll(/innerHTML\s*=\s*([^;]+);/g)].map((x) => x[1]).join(' | '));
  vrai('… ni eval, ni gestionnaire écrit dans du texte (onclick="…")', !/eval\(|new Function|onclick\s*=\s*["']|insertAdjacentHTML|document\.write/.test(src));
  vrai('pas de fonction serveur (rpc) : des lectures et des écritures directes', !/\.rpc\(/.test(src));
  vrai('le fichier ne touche à aucun autre onglet ni à la carte (pas de map., pas de renderAll)', !/\bmap\.|renderAll\(/.test(src));
  eq('les seules requêtes de LECTURE : passe_arrets, passages_manuels, types_service', [...new Set([...src.matchAll(/(?:db\.from|suiviLireTout)\(\s*'([a-z_]+)'/g)].map((x) => x[1]))].sort(), ['passages_manuels', 'passe_arrets', 'types_service']);
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
