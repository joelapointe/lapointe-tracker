// Demande 5, chantier D, étape 4 (2 oct. 2026) — L'ÉCRAN « AVIS AUX CLIENTS » de l'onglet Clients (www/js/admin-avis.js et ses branchements : admin-clients.js, index.html, css/style.css).
// Les VRAIS fichiers de l'application sont chargés dans un faux navigateur ; l'écran parle à la VRAIE fonction « envoyer-avis » (supabase/functions/envoyer-avis/index.ts) et à la VRAIE base (PGlite : fichiers SQL
// 30, 31 et 32 : les fiches des clients, les modèles de messages, le journal), avec un FAUX Resend et un FAUX Twilio. Ce que ce test ne peut PAS vérifier : le vrai Supabase (le jeton de Joé, les clés), le vrai
// Resend et le vrai Twilio (le courriel d'essai à Joé, puis un vrai envoi, le vérifient) et l'aspect réel de l'écran (essayé à part dans un vrai navigateur).
// Décisions : l'écran n'écrit RIEN lui-même (ni table, ni fonction de la base) ; il demande tout à la fonction d'envoi ; l'aperçu n'écrit ni n'envoie rien ; l'envoi exige un aperçu récent, du même délai et des
// mêmes clients, puis une confirmation ; jamais deux appels à la fois ; une panne PENDANT l'envoi ne dit jamais « rien n'a été envoyé » ; un client qui reçoit un avis n'est pas « refusé » pour l'autre canal.
// WWW_TEST : un autre dossier « www » ; FONCTION_TEST : une autre copie de la fonction (erreurs volontaires).
import vm from 'vm';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { stripTypeScriptTypes } from 'node:module';
import { prepare } from './prepare.mjs';
const WWW = process.env.WWW_TEST ? process.env.WWW_TEST.split('\\').join('/').replace(/\/?$/, '/') : fileURLToPath(new URL('../../www/', import.meta.url));
const SQL_DIR = fileURLToPath(new URL('../', import.meta.url));
const lire = (f) => fs.readFileSync(WWW + f, 'utf8');
const CODE = fs.readFileSync(process.env.FONCTION_TEST || (SQL_DIR + 'functions/envoyer-avis/index.ts'), 'utf8');
const F = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(CODE)).toString('base64'));
const { traiter } = F;

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));

// ── La vraie base : les fichiers SQL 30, 31 et 32, et les clients du test ─────────────────
const FILES = ['01-etape6-utilisateurs.sql', '02-etape7-modele-passes-quarts.sql', '03-etape8-regles-acces.sql', '04-etape9a-quarts-equipage.sql',
  '05-etape9b-passes-fermetures-export.sql', '13-etape13-taches-et-tours-partages.sql', '14-etape13d-retrait-stops-fait.sql', '15-etape14c-dernier-tour-visible.sql',
  '16-etape14e-photo-probleme.sql', '17-etape15-equipage-precedent.sql', '18-etape16d-heure-des-gestes-sans-reseau.sql', '19-etape16d-annulation-ignoree-precisee.sql'];
const db = await prepare(FILES);
await db.exec(`grant usage on schema public to service_role;`);
await db.exec(`alter default privileges in schema public grant all on tables to anon, authenticated, service_role;`);
await db.exec(`alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`);
for (const f of ['30-repertoire-clients-et-inscriptions.sql', '31-avis-aux-clients.sql', '32-avis-canaux-et-apercu.sql']) await db.exec(fs.readFileSync(SQL_DIR + f, 'utf8'));
const q = async (sql, p) => { await db.query('reset role'); return (await db.query(sql, p)).rows; };
const ins = async (email, app) => (await db.query(`insert into auth.users(email, raw_app_meta_data) values ($1,$2::jsonb) returning id`, [email, JSON.stringify(app)])).rows[0].id;
const admin = await ins('joe@t.ca', { nom: 'Joé', role: 'admin' });
const fiche = async (nom, o = {}) => {
  const c = { nom, adresse: '1 rue Test', ...o };
  const cols = Object.keys(c);
  return (await q(`insert into public.clients (${cols.join(', ')}) values (${cols.map((_, i) => '$' + (i + 1)).join(', ')}) returning id`, Object.values(c)))[0].id;
};
const vider = async () => { await q(`alter table public.avis_envois disable trigger avis_envois_immuables`); await q(`alter table public.avis_envois disable trigger avis_envois_pas_de_vidage`); await q(`delete from public.avis_envois`); await q(`alter table public.avis_envois enable trigger avis_envois_immuables`); await q(`alter table public.avis_envois enable trigger avis_envois_pas_de_vidage`); };
const journal = async () => (await q(`select c.nom, e.canal, e.statut, e.motif from public.avis_envois e join public.clients c on c.id = e.client_id order by c.nom, e.canal`)).map((x) => `${x.nom}:${x.canal}:${x.statut}${x.motif ? ':' + x.motif : ''}`);
const nbJournal = async () => (await q(`select count(*)::int n from public.avis_envois`))[0].n;
const HIER = '2026-09-30T12:00:00Z';
const ID = {
  A: await fiche('Alice Courriel', { courriel: 'alice@exemple.ca', avis_courriel: true }),                                                              // courriel seulement
  B: await fiche('Bob Texto', { courriel: 'bob@exemple.ca', cellulaire: '+18195550002', avis_texto: true }),                                         // texto seulement (pas de courriel d'avis)
  C: await fiche('Carl Les Deux', { courriel: 'carl@exemple.ca', cellulaire: '+18195550003', avis_courriel: true, avis_texto: true }),
  D: await fiche('Diane Rien', { courriel: 'diane@exemple.ca', cellulaire: '+18195550004' }),                                                         // aucun avis activé
  E: await fiche('Eric Parti', { courriel: 'eric@exemple.ca', cellulaire: '+18195550005', avis_courriel: true, avis_texto: true, desabonne_courriel_le: HIER, desabonne_texto_le: HIER }),
  G: await fiche('Gaby SansCourriel', { avis_courriel: true }),                                                                                       // « avertir par courriel » coché, mais aucun courriel
  H: await fiche('Hélène Archivée', { courriel: 'helene@exemple.ca', avis_courriel: true, actif: false }),
};

// ── L'application : les routes et les arrêts (les arrêts viennent de la base de l'appli, pas de la table des clients) ──
const ROUTES = [{ id: 'r1', nom: 'Route Nord' }, { id: 'r2', nom: 'Route Sud' }];
const arret = (id, route, client, adresse, service, o = {}) => ({ id, route_id: route, client_id: client, client: 'Nom sur l’arrêt', adresse, service, actif: true, ...o });
const STOPS = () => [
  arret('s1', 'r1', ID.A, '10 rue des Pins, Louiseville', 'Coupe de gazon'),
  arret('s2', 'r1', ID.A, '10 rue des Pins, Louiseville', 'Désherbage'),                    // la même adresse, un 2ᵉ service : « Coupe de gazon et Désherbage »
  arret('s3', 'r1', ID.B, '22 rue Bleue, Charette', 'Coupe de gazon'),
  arret('s4', 'r1', ID.C, '5 rue Verte, Charette', 'Coupe de gazon'),
  arret('s5', 'r1', ID.C, '7 rue Verte, Charette', 'Coupe de gazon'),                       // une 2ᵉ adresse du même client
  arret('s6', 'r1', ID.D, '30 rue Grise, Charette', 'Coupe de gazon'),
  arret('s7', 'r1', ID.E, '31 rue Grise, Charette', 'Coupe de gazon'),
  arret('s8', 'r1', ID.G, '32 rue Grise, Charette', 'Coupe de gazon'),
  arret('s9', 'r1', null, '9 rue Perdue, Charette', 'Coupe de gazon'),                       // aucune fiche
  arret('s10', 'r1', ID.H, '33 rue Grise, Charette', 'Coupe de gazon'),                      // une fiche ARCHIVÉE : compte comme « sans fiche »
  arret('s11', 'r1', ID.A, '99 rue Fermée, Louiseville', 'Coupe de gazon', { actif: false }),   // un arrêt archivé : ignoré
  arret('s12', 'r2', ID.A, '10 rue des Pins, Louiseville', 'Déneigement'),                   // une autre route
  arret('s13', 'r2', ID.D, '30 rue Grise, Charette', 'Déneigement'),
];

// ── Les fausses dépendances de la fonction : la vraie base, un faux Resend, un faux Twilio ─────
const MIDI = '2026-10-14T12:00:00-04:00', NUIT = '2026-10-14T22:30:00-04:00';
const SIGS = { avis_preparer: ['p_par uuid', 'p_delai text', 'p_lignes jsonb', 'p_maintenant timestamptz', 'p_canaux text[]'], avis_apercu: ['p_par uuid', 'p_delai text', 'p_lignes jsonb', 'p_maintenant timestamptz', 'p_canaux text[]'],
  avis_marquer: ['p_id uuid', 'p_statut text', 'p_fournisseur_id text', 'p_erreur text'], avis_jeton: ['p_client_id uuid', 'p_canal text'] };
const journalFonction = [];
function fonction(m, o) {
  return {
    identifier: async (aut) => ({ 'Bearer admin': { id: admin, courriel: o.courrielAdmin === undefined ? 'joe@exemple.ca' : o.courrielAdmin }, 'Bearer employe': null })[aut] ?? null,
    rpc: async (nom, args) => {
      m.rpcs.push(nom);
      if (o.rpcErreur?.[nom]) return { data: null, error: { message: o.rpcErreur[nom] } };
      const sig = SIGS[nom];
      const noms = sig.map((s) => s.split(' ')[0]).filter((n) => n in args);
      const params = noms.map((n, i) => `${n} => $${i + 1}::${sig.find((s) => s.startsWith(n + ' ')).split(' ')[1]}`);
      const valeurs = noms.map((n) => (n === 'p_lignes' ? JSON.stringify(args[n]) : args[n]));
      await db.query('reset role'); await db.query('set role service_role');
      try { return { data: (await db.query(`select public.${nom}(${params.join(', ')}) as r`, valeurs)).rows[0].r, error: null }; }
      catch (e) { return { data: null, error: { message: e.message } }; }
      finally { await db.query('reset role'); }
    },
    modeleCourriel: async () => (await q(`select objet, texte from public.avis_modeles where canal = 'courriel' and variante = 'heures' and en_vigueur`))[0],
    courriel: async (c) => { m.courriels.push(c); const e = o.courrielEchec?.(c); return e ? { erreur: e } : { id: 're_' + m.courriels.length }; },
    texto: async (t) => { m.textos.push(t); return { id: 'SM' + m.textos.length }; },
    textosActifs: () => o.textos === true,
    maintenant: () => o.maintenant ?? MIDI,
    journal: (l) => { journalFonction.push(l); },
  };
}

// ── Le faux navigateur ─────────────────────────────────────────────────────────────
const tous = (n) => [n, ...n.children.flatMap(tous)];
const parClasse = (n, c) => tous(n).filter((x) => (x.className || '').split(/\s+/).includes(c));
const cliquer = async (e) => { const r = e.onclick(); if (r && r.then) await r; };
const taper = (e, v) => { e.value = v; if (e.oninput) e.oninput(); };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function monde(o = {}) {
  await vider();
  const m = { courriels: [], textos: [], rpcs: [], appels: [], toasts: [], confirmations: [], sync: [], requetes: [], rpcApp: [], reponse: { oui: true } };
  const deps = fonction(m, o);
  m.deps = deps;
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
      remove() { if (e.parent) e.parent.children = e.parent.children.filter((x) => x !== e); }, focus() {}, addEventListener() {}, querySelector() { return null; },
      scrollIntoView(opt) { m.defilements.push({ id: e.id, opt }); } };
    Object.defineProperty(e, 'innerHTML', { get() { return ''; }, set(v) { if (v === '') e.children = []; else throw new Error('innerHTML avec du texte : ' + String(v).slice(0, 40)); } });
    return e;
  };
  m.defilements = [];
  const trouverDans = (n, id) => { if (n.id === id) return n; for (const c of n.children) { const r = trouverDans(c, id); if (r) return r; } return null; };
  const el = (id) => (statiques[id] ??= creer(id, 'div'));
  ['admin-body', 'admin-sub', 'admin-tabs', 'clients-feuille-overlay', 'clients-feuille-corps', 'clients-feuille-titre', 'toast', 'sync'].forEach(el);
  // (un identifiant inconnu rend un élément jetable, JAMAIS gardé : sinon il cacherait le vrai élément quand l'écran revient)
  const getElementById = (id) => { if (statiques[id]) return statiques[id]; for (const r of Object.values(statiques)) { const t = trouverDans(r, id); if (t) return t; } return creer(id, 'div'); };

  // Les lignes lues dans la VRAIE base, mises en forme comme le fait le service de données de Supabase : les dates en texte (« jour » : AAAA-MM-JJ)
  const commePostgrest = (r) => { const o2 = {}; for (const [k, v] of Object.entries(r)) o2[k] = v instanceof Date ? (k === 'jour' ? v.toISOString().slice(0, 10) : v.toISOString()) : v; return o2; };
  // La SEULE écriture permise à l'écran : « avis_courriel » dans « clients » (l'activation en bloc), avec de vrais filtres, dans la VRAIE base
  const executerMaj = async (qy) => {
    m.requetes.push({ table: qy.table, op: 'update', valeur: qy.valeur, filtres: qy.filtres, cols: qy.cols });
    if (qy.table !== 'clients' || Object.keys(qy.valeur).join() !== 'avis_courriel') throw new Error('écriture interdite par ce test : ' + qy.table + ' ' + JSON.stringify(qy.valeur));
    const numero = m.requetes.filter((r) => r.op === 'update').length;
    if (o.majRetard) await o.majRetard(numero);
    if (o.majPanne?.(numero)) throw new TypeError('Failed to fetch');
    const erreur = o.majErreur?.(numero);
    if (erreur) return { data: null, error: erreur };
    if (o.majRefus) return { data: [], error: null };   // les règles d'accès refusent SANS erreur : aucune ligne changée
    const ou = [], params = [qy.valeur.avis_courriel];
    for (const [t, c, v] of qy.filtres) {
      if (t === 'in' && c === 'id') { params.push('{' + v.join(',') + '}'); ou.push(`id = any($${params.length}::uuid[])`); }
      else if (t === 'eq' && c === 'actif') { params.push(v); ou.push(`actif = $${params.length}`); }
      else if (t === 'is' && c === 'desabonne_courriel_le' && v === null) ou.push('desabonne_courriel_le is null');
      else throw new Error('filtre inconnu dans ce test : ' + JSON.stringify([t, c, v]));
    }
    if (!ou.length) throw new Error('mise à jour SANS filtre : interdit');
    try { return { data: await q(`update public.clients set avis_courriel = $1 where ${ou.join(' and ')} returning ${qy.cols === '*' ? 'id' : qy.cols}`, params), error: null }; }
    catch (e) { return { data: null, error: { message: e.message } }; }
  };
  const executer = async (qy) => {
    if (qy.op === 'update') return executerMaj(qy);
    m.requetes.push({ table: qy.table, op: 'select', cols: qy.cols, ordres: qy.ordres, plage: qy.plage });
    if (o.lectureRetard) await o.lectureRetard(qy.table);
    if (o.lecturePanne?.(qy.table, qy.plage)) throw new TypeError('Failed to fetch');
    const erreur = o.lectureErreur?.(qy.table, qy.plage);
    if (erreur) return { data: null, error: erreur };
    const ordre = qy.ordres.length ? ' order by ' + qy.ordres.map(([c, s]) => `${c} ${s}`).join(', ') : '';
    const lim = qy.plage ? ` limit ${qy.plage[1] - qy.plage[0] + 1} offset ${qy.plage[0]}` : '';
    try { return { data: (await q(`select ${qy.cols} from public.${qy.table}${ordre}${lim}`)).map(commePostgrest), error: null }; }
    catch (e) { return { data: null, error: { message: e.message } }; }
  };
  const invoke = async (nom, { body }) => {
    m.appels.push({ nom, body: JSON.parse(JSON.stringify(body)) });
    if (o.invokeRetard) await o.invokeRetard(body);
    if (o.invokeLance?.(body)) throw new TypeError('Failed to fetch');
    if (o.invokePanne?.(body)) return { data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function', context: new TypeError('Failed to fetch') } };
    if (o.invokeBrut) { const brut = o.invokeBrut(body); if (brut !== undefined) return brut; }   // (undefined : la vraie fonction répond)
    const r = await traiter(new Request('https://x.test/envoyer-avis', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: o.auth ?? 'Bearer admin' }, body: JSON.stringify(body) }), deps);
    if (r.status >= 200 && r.status < 300) return { data: await r.json(), error: null };
    return { data: null, error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: r } };
  };
  const fauxDb = {
    channel() { const c = { on() { return c; }, subscribe() { return c; } }; return c; },
    rpc: async (nom, args) => { m.rpcApp.push({ nom, args }); return { data: null, error: null }; },
    functions: { invoke },
    from: (table) => {
      const qy = { table, op: 'select', cols: '*', ordres: [], plage: null, filtres: [], valeur: null };
      qy.select = (c) => { qy.cols = c; return qy; };   // (après un update : les colonnes à rendre)
      qy.order = (c, opt) => { qy.ordres.push([c, opt && opt.ascending === false ? 'desc' : 'asc']); return qy; };
      qy.range = (a, b) => { qy.plage = [a, b]; return qy; };
      qy.in = (c, l) => { qy.filtres.push(['in', c, l]); return qy; };
      qy.eq = (c, v) => { qy.filtres.push(['eq', c, v]); return qy; };
      qy.is = (c, v) => { qy.filtres.push(['is', c, v]); return qy; };
      qy.update = (v) => { qy.op = 'update'; qy.valeur = v; return qy; };
      for (const op of ['insert', 'delete', 'upsert']) qy[op] = () => { m.requetes.push({ table, op }); throw new Error('écriture : ' + op + ' sur ' + table); };
      qy.then = (ok_, ko_) => Promise.resolve().then(() => executer(qy)).then(ok_, ko_);
      return qy;
    },
  };
  const sandbox = {
    document: { getElementById, createElement: (b) => creer(null, b), body: creer('body', 'body'), addEventListener() {}, removeEventListener() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: {}, navigator: {}, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, console,
    fetch: async () => ({ json: async () => ({}) }), setStatus() {}, hideLoading() {}, showErr() {},
    __db: fauxDb, __toasts: m.toasts, __confirmations: m.confirmations, __sync: m.sync, __reponse: m.reponse,
  };
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/config.js', 'js/utilitaires.js', 'js/hors-reseau.js', 'js/routes.js', 'js/admin.js', 'js/admin-clients.js', 'js/admin-avis.js', 'js/admin-avis-journal.js']) vm.runInContext(lire(f), ctx, { filename: f });
  vm.runInContext(`db = __db; stops = ${JSON.stringify(o.arrets ?? STOPS())}; routes = ${JSON.stringify(o.routes ?? ROUTES)}; currentUser = ${JSON.stringify({ id: 'u-joe', nom: 'Joé', role: 'admin' })}; _adminOnglet = 'clients';
    toast = (m) => { __toasts.push(m); }; confirmer = async (...a) => { __confirmations.push(a); return __reponse.oui; }; showSync = (b) => { __sync.push(b); };`, ctx);
  const z = {
    ctx, m, el, run: (c) => vm.runInContext(c, ctx),
    ouvrir: () => vm.runInContext('clientsOuvrir()', ctx),
    corps: () => el('admin-body'),
    puces: () => (tous(el('admin-body')).filter((x) => x.className === 'su-filtres')[0]?.children ?? []).filter((x) => x.tagName === 'BUTTON'),
    puce: (t) => z.puces().find((b) => b.textContent === t),
    recherche: () => tous(el('admin-body')).find((x) => x.id === 'cl-recherche'),
    zone: () => getElementById('cl-liste'),
    id: (id) => tous(el('admin-body')).find((x) => x.id === id),
    ouvrirAvis: async () => { await z.ouvrir(); await cliquer(z.puce('📣 Avis aux clients')); },
    // le journal : la lecture est asynchrone (la puce lance la lecture, l'écran se redessine à l'arrivée des lignes)
    attendreJournal: async () => { for (let i = 0; i < 400 && z.run('_journalOccupe'); i++) await dormir(5); await dormir(0); },
    ouvrirJournal: async () => { await cliquer(z.puce('📒 Journal des avis')); await z.attendreJournal(); },
    journal: () => parClasse(z.zone(), 'av-ligne').map((l) => ({ nom: parClasse(l, 'su-nom')[0].textContent, badge: parClasse(l, 'su-badge')[0].textContent, classe: parClasse(l, 'su-badge')[0].className, date: parClasse(l, 'su-n')[0]?.textContent,
      details: [...parClasse(l, 'su-adresse'), ...parClasse(l, 'su-temps')].map((x) => x.textContent), noeud: l })),
    sections: () => parClasse(z.zone(), 'su-section').map((s) => s.children.map((c) => c.textContent)),
    pucesJournal: () => (z.id('jr-puces')?.children ?? []),
    lecturesJournal: () => z.m.requetes.filter((r) => r.table === 'avis_envois'),
    route: () => z.id('av-route'),
    choisirRoute: (id) => { const s = z.route(); s.value = id; s.onchange(); },
    delais: () => z.id('av-delais').children,
    choisirDelai: (val) => cliquer(z.delais().find((b) => b.dataset.delai === val)),
    clients: () => parClasse(z.zone(), 'av-client').map((l) => ({ nom: l.children[1].children[0].textContent, detail: l.children[1].children[1].textContent, canaux: l.children[1].children[2].textContent, coche: l.children[0].checked, cb: l.children[0] })),
    coche: (nom, oui = true) => { const c = z.clients().find((x) => x.nom === nom); c.cb.checked = oui; c.cb.onchange(); },
    resume: () => parClasse(z.id('av-bas'), 'av-resume')[0]?.textContent,
    boite: (id) => z.id(id),
    lignes: (b) => parClasse(b, 'av-ligne').map((l) => ({ nom: parClasse(l, 'su-nom')[0].textContent, badge: parClasse(l, 'su-badge')[0].textContent, details: [...parClasse(l, 'su-temps'), ...parClasse(l, 'su-adresse')].map((x) => x.textContent) })),
    notes: (b) => parClasse(b, 'av-note').map((x) => x.textContent),
    apercu: () => cliquer(z.id('av-apercu')),
    envoyer: () => cliquer(z.id('av-envoyer')),
    essai: () => cliquer(z.id('av-essai')),
    feuilleOuverte: () => el('clients-feuille-overlay').classList.contains('open'),
    repondre: (oui) => { m.reponse.oui = oui; },
    ecritures: () => m.requetes.filter((r) => r.op !== 'select').length + m.rpcApp.length,
  };
  return z;
}
// Prépare le cas le plus courant : Route Nord, 3 heures, les clients cochés d'office
const pret = async (o = {}, delai = '3h') => { const z = await monde(o); await z.ouvrirAvis(); z.choisirRoute('r1'); await z.choisirDelai(delai); return z; };

// =====================================================================
log('=== LES FONCTIONS PURES ===');
{
  const z = await monde();
  const f = (c) => z.run(c);
  eq('les délais valides : « 1h » à « 72h » et « demain » ; rien d’autre', [['1h', '9h', '24h', '72h', 'demain'].map((d) => f(`avisDelaiValide(${JSON.stringify(d)})`)), ['0h', '73h', '100h', '3', 'h', '3 h', 'Demain', '01h', '', null, 5, undefined].map((d) => f(`avisDelaiValide(${JSON.stringify(d ?? null)})`))],
    [[true, true, true, true, true], [false, false, false, false, false, false, false, false, false, false, false, false]]);
  eq('le délai tapé en heures : « 5 », « 5 h », « 5H », « 05 » → « 5h » ; 1 à 72', ['5', ' 5 h ', '5H', '05', '72', '1'].map((t) => f(`avisDelaiDeSaisie(${JSON.stringify(t)})`)), ['5h', '5h', '5h', '5h', '72h', '1h']);
  eq('… pas un délai : 0, 73, vide, texte, décimal, négatif, trois chiffres', ['0', '73', '', 'abc', '1.5', '-3', '007', '100', null].map((t) => f(`avisDelaiDeSaisie(${JSON.stringify(t)})`)), [null, null, null, null, null, null, null, null, null]);
  eq('le délai écrit : « environ 3 h » ou « demain »', [f(`avisLibelleDelai('3h')`), f(`avisLibelleDelai('12h')`), f(`avisLibelleDelai('demain')`)], ['environ 3 h', 'environ 12 h', 'demain']);
  eq('la liste en français : « A », « A et B », « A, B et C » (les vides sont ignorés)', [f(`avisListeFrancais([])`), f(`avisListeFrancais(['A'])`), f(`avisListeFrancais(['A','B'])`), f(`avisListeFrancais(['A','','B','C'])`)], ['', 'A', 'A et B', 'A, B et C']);
  const c = (o) => f(`avisCanaux(${JSON.stringify(o)})`);
  eq('ce qu’une fiche permet : courriel seulement si « avertir par courriel » ET un courriel ET pas désabonné', [c({ avis_courriel: true, courriel: 'a@b.ca' }), c({ avis_courriel: false, courriel: 'a@b.ca' }), c({ avis_courriel: true, courriel: ' ' }), c({ avis_courriel: true, courriel: 'a@b.ca', desabonne_courriel_le: HIER })],
    [{ courriel: true, texto: false }, { courriel: false, texto: false }, { courriel: false, texto: false }, { courriel: false, texto: false }]);
  eq('… texto seulement si inscrit ET un cellulaire ET pas désabonné ; une fiche archivée ou absente : rien', [c({ avis_texto: true, cellulaire: '+18195550000' }), c({ avis_texto: true, cellulaire: null }), c({ avis_texto: true, cellulaire: '+18195550000', desabonne_texto_le: HIER }), c({ avis_courriel: true, courriel: 'a@b.ca', actif: false }), c(null)],
    [{ courriel: false, texto: true }, { courriel: false, texto: false }, { courriel: false, texto: false }, { courriel: false, texto: false }, { courriel: false, texto: false }]);
  const fiches = [{ id: 'f1', nom: 'Zoé', actif: true, avis_courriel: true, courriel: 'z@b.ca' }, { id: 'f2', nom: 'Alain', actif: true }, { id: 'f3', nom: 'Vieux', actif: false }, { id: 'f4', nom: 'Émile', actif: true }];
  const arrets = [
    { id: 'a1', route_id: 'r1', client_id: 'f1', adresse: '1 rue A', service: 'Gazon' }, { id: 'a2', route_id: 'r1', client_id: 'f1', adresse: '1 rue A', service: 'Désherbage' },
    { id: 'a3', route_id: 'r1', client_id: 'f1', adresse: '2 rue B', service: 'Taille' }, { id: 'a4', route_id: 'r1', client_id: 'f2', adresse: '3 rue C', service: 'Gazon' },
    { id: 'a5', route_id: 'r1', client_id: 'f3', adresse: '4 rue D', service: 'Gazon' }, { id: 'a6', route_id: 'r1', client_id: null, adresse: '5 rue E', service: 'Gazon' },
    { id: 'a7', route_id: 'r1', client_id: 'f4', adresse: '6 rue F', service: '' }, { id: 'a8', route_id: 'r1', client_id: 'f2', adresse: '3 rue C', service: 'Gazon', actif: false },
    { id: 'a9', route_id: 'r2', client_id: 'f2', adresse: '7 rue G', service: 'Neige' }, { id: 'a10', route_id: 'r1', client_id: 'inconnu', adresse: '8 rue H', service: 'Gazon' },
  ];
  const cand = (src) => f(`avisCandidats(${JSON.stringify(arrets)}, ${JSON.stringify(fiches)}, ${JSON.stringify(src)})`);
  const r1 = cand('r1');
  eq('les clients d’une route : un par fiche, triés par nom ; les services et les adresses d’un même client sont réunis', r1.clients.map((x) => [x.client_id, x.nom, x.adresse, x.nbAdresses, x.service]), [['f2', 'Alain', '3 rue C', 1, 'Gazon'], ['f1', 'Zoé', '1 rue A et 2 rue B', 2, 'Gazon, Désherbage et Taille']]);
  eq('… les arrêts sans fiche (aucune, archivée, inconnue) sont comptés à part ; un client sans service est « incomplet »', [r1.sansFiche, r1.incomplets], [3, 1]);
  eq('… un arrêt archivé est ignoré ; une autre route n’est pas mélangée', [cand('r2').clients.map((x) => x.client_id), cand('r2').sansFiche], [['f2'], 0]);
  eq('« à la main » (__main__) : tous les arrêts de toutes les routes', cand('__main__').clients.map((x) => x.client_id), ['f2', 'f1']);
  eq('… aucune source choisie : rien du tout', [cand('').clients.length, cand(null).clients.length], [0, 0]);
  eq('les canaux de chaque client sont indiqués d’après sa fiche', r1.clients.map((x) => x.canaux), [{ courriel: false, texto: false }, { courriel: true, texto: false }]);
  const longues = Array.from({ length: 30 }, (_, i) => ({ id: 'x' + i, route_id: 'r', client_id: 'f1', adresse: 'Adresse très longue numéro ' + i + ' rue', service: 'Service numéro ' + i }));
  const rl = f(`avisCandidats(${JSON.stringify(longues)}, ${JSON.stringify(fiches)}, 'r')`).clients[0];
  eq('trop d’adresses ou de services pour la fonction (200 et 100 caractères) : seulement le premier de chacun', [rl.adresse, rl.service, rl.nbAdresses], ['Adresse très longue numéro 0 rue', 'Service numéro 0', 30]);
  const lg = f(`avisLignes(${JSON.stringify(r1.clients)}, new Set(['f1']))`);
  eq('les lignes envoyées à la fonction : seulement les clients cochés, avec service et adresse', lg, [{ client_id: 'f1', service: 'Gazon, Désherbage et Taille', adresse: '1 rue A et 2 rue B' }]);
  const sig = (d, l) => f(`avisSignature(${JSON.stringify(d)}, ${JSON.stringify(l)})`);
  const l1 = { client_id: 'a', service: 's', adresse: 'x' }, l2 = { client_id: 'b', service: 's', adresse: 'x' };
  eq('la signature d’une demande : la même dans un autre ordre ; différente si le délai, un client ou le service change', [sig('3h', [l1, l2]) === sig('3h', [l2, l1]), sig('3h', [l1]) === sig('4h', [l1]), sig('3h', [l1]) === sig('3h', [l2]), sig('3h', [l1]) === sig('3h', [{ ...l1, service: 'autre' }])], [true, false, false, false]);
  const lib = (m, ca) => f(`avisLibelleMotif(${JSON.stringify(m)}, ${JSON.stringify(ca)})`);
  eq('les motifs de refus, par canal', [lib('pas_active', 'courriel'), lib('pas_active', 'texto'), lib('desabonne', 'texto'), lib('pas_de_coordonnee', 'courriel'), lib('hors_heures', 'texto'), lib('deja_averti_aujourdhui', 'courriel'), lib('client_introuvable', undefined), lib('echec_fournisseur', 'courriel')],
    ['avis par courriel non activés (case « Avertir par courriel » de la fiche)', 'pas inscrit aux textos', 'désabonné des textos (a répondu ARRET)', 'aucun courriel dans la fiche', 'texto interdit de 21 h à 6 h (heure du Québec)', 'déjà averti aujourd’hui', 'fiche archivée ou introuvable', 'le service de courriel a refusé l’envoi']);
  eq('… sans canal : le motif général ; un motif inconnu est montré tel quel ; aucun motif : « raison inconnue »', [lib('pas_active', undefined), lib('desabonne', null), lib('bizarre', 'courriel'), lib(null, 'courriel')], ['avis non activés', 'désabonné', 'bizarre', 'raison inconnue']);
  const lignes = [
    { client_id: 'a', canal: 'courriel', statut: 'a_envoyer' }, { client_id: 'a', canal: 'texto', statut: 'refuse', motif: 'pas_active' }, { client_id: 'b', canal: 'texto', statut: 'a_envoyer' },
    { client_id: 'b', canal: 'courriel', statut: 'refuse', motif: 'pas_active' }, { client_id: 'c', canal: 'courriel', statut: 'refuse', motif: 'pas_active' }, { client_id: 'c', canal: 'texto', statut: 'refuse', motif: 'hors_heures' },
    { client_id: 'd', canal: 'texto', statut: 'refuse', motif: 'desabonne' }, { client_id: 'd', canal: 'courriel', statut: 'a_envoyer' },
  ];
  const vis = f(`avisVisibles(${JSON.stringify(lignes)})`);
  eq('un client qui reçoit un avis n’est PAS refusé pour l’autre canal (« pas_active » caché) ; les autres refus restent', vis.map((x) => x.client_id + x.canal[0] + ':' + x.statut + (x.motif ? ':' + x.motif : '')),
    ['ac:a_envoyer', 'bt:a_envoyer', 'cc:refuse:pas_active', 'ct:refuse:hors_heures', 'dt:refuse:desabonne', 'dc:a_envoyer']);
  const rs = f(`avisResumer(${JSON.stringify(vis)})`);
  eq('le résumé : courriels et textos qui partent, refusés et leurs motifs (texte → nombre)', [rs.courriels, rs.textos, rs.refuses, rs.motifs], [2, 1, 3, { 'avis par courriel non activés (case « Avertir par courriel » de la fiche)': 1, 'texto interdit de 21 h à 6 h (heure du Québec)': 1, 'désabonné des textos (a répondu ARRET)': 1 }]);
  eq('… après un envoi : envoyés et échecs sont comptés', f(`(r=>[r.envoyes,r.echecs,r.refuses,r.courriels])(avisResumer([{canal:'courriel',statut:'envoye'},{canal:'courriel',statut:'echec',motif:'echec_fournisseur'},{canal:'texto',statut:'envoye'},{canal:'texto',statut:'refuse',motif:'hors_heures'}]))`), [2, 1, 1, 2]);
  eq('les textes : « 2 courriels + 1 texto », un seul courriel, rien', [f(`avisTexteMessages({courriels:2,textos:1})`), f(`avisTexteMessages({courriels:1,textos:0})`), f(`avisTexteMessages({courriels:0,textos:0})`)], ['2 courriels + 1 texto', '1 courriel', '']);
  eq('les motifs en texte : « 2 × … · 1 × … »', f(`avisTexteMotifs({'déjà averti aujourd’hui':2,'désabonné':1})`), '2 × déjà averti aujourd’hui · 1 × désabonné');
  const tr = f(`avisTrier(${JSON.stringify([{ client_id: 'z', statut: 'refuse', canal: 'courriel' }, { client_id: 'm', statut: 'echec', canal: 'courriel' }, { client_id: 'b', statut: 'envoye', canal: 'texto' }, { client_id: 'b', statut: 'envoye', canal: 'courriel' }, { client_id: 'a', statut: 'a_envoyer', canal: 'courriel' }, { client_id: 'a', statut: 'refuse', canal: 'courriel' }])}, id => id)`);
  eq('l’ordre de l’écran : ceux qui partent (par nom, courriel avant texto), puis les échecs, puis les refus', tr.map((x) => x.client_id + ':' + x.statut + ':' + x.canal), ['a:a_envoyer:courriel', 'b:envoye:courriel', 'b:envoye:texto', 'm:echec:courriel', 'a:refuse:courriel', 'z:refuse:courriel']);
  const me = (code, action, message) => f(`avisMessageErreur(${JSON.stringify({ code, message })}, ${JSON.stringify(action)})`);
  eq('les messages d’erreur de l’aperçu : pas de réseau, accès, textos, SQL absent, base', ['reseau', 'non_autorise', 'textos_non_actives', 'sql_absent', 'base_erreur', 'fonction_absente'].map((c) => me(c, 'apercu')),
    ['📴 Pas de réseau : rien n’a été envoyé.', '❌ Réservé à l’administrateur : reconnecte-toi, puis réessaie.', '❌ Les textos ne sont pas encore activés (en attente de l’approbation de Twilio). Rien n’a été envoyé.', '❌ Les fichiers SQL 31 et 32 ne sont pas tous exécutés chez Supabase.', '❌ La base a refusé la demande : rien n’a été envoyé (voir les journaux de la fonction).', '❌ La fonction d’envoi n’est pas installée chez Supabase (« envoyer-avis »).']);
  eq('… une demande invalide dit pourquoi ; un code inconnu montre le message du serveur', [me('requete_invalide', 'apercu', 'La liste est vide.'), me('bizarre', 'apercu', 'Panne X'), me('bizarre', 'apercu', '')], ['❌ La demande est invalide : La liste est vide.', '❌ Panne X', '❌ Une erreur est survenue.']);
  const incertain = '⚠ La réponse du serveur n’est pas arrivée : certains avis sont peut-être partis. Refais « Voir ce qui partira » : les clients déjà avertis aujourd’hui y sont marqués.';
  eq('PENDANT l’envoi, une panne (réseau, erreur interne, réponse illisible, inconnue) ne dit JAMAIS « rien n’a été envoyé »', ['reseau', 'erreur_interne', 'erreur', 'reponse_illisible', 'configuration'].map((c) => me(c, 'envoyer')), Array(5).fill(incertain));
  eq('… mais un refus net (accès, base, délai) le dit : rien n’est parti', [me('non_autorise', 'envoyer'), me('base_erreur', 'envoyer'), me('delai_invalide', 'envoyer')], ['❌ Réservé à l’administrateur : reconnecte-toi, puis réessaie.', '❌ La base a refusé la demande : rien n’a été envoyé (voir les journaux de la fonction).', '❌ Le délai est invalide.']);
}

log('=== LA PUCE ET L’ÉCRAN D’ACCUEIL ===');
{
  const z = await monde();
  await z.ouvrir();
  eq('la barre de l’onglet Clients a une 7ᵉ puce : « 📣 Avis aux clients » (après « Inscriptions », avant « Journal »)', z.puces().map((b) => b.textContent).slice(-3), ['Inscriptions (0)', '📣 Avis aux clients', '📒 Journal des avis']);
  eq('… à l’ouverture, c’est toujours la liste « Tous » (rien ne s’envoie par accident)', [z.run('clientsFiltre'), z.id('av-route') === undefined], ['tous', true]);
  await cliquer(z.puce('📣 Avis aux clients'));
  eq('toucher la puce : elle est marquée, les autres non', z.puces().map((b) => b.className), ['su-puce', 'su-puce', 'su-puce', 'su-puce', 'su-puce', 'su-puce', 'su-puce on', 'su-puce']);
  eq('l’explication du haut : les avis se font seulement si la fiche le permet, rien ne part avant « Envoyer »', parClasse(z.zone(), 'av-note')[0].textContent, 'Un client reçoit un avis seulement si sa fiche le permet (case « Avertir par courriel », ou inscrit aux textos). Rien ne part avant ton « Envoyer ».');
  eq('le choix de route : « — Choisir une route — », les routes avec leur nombre de clients, puis « à la main »', z.route().children.map((o) => o.textContent), ['— Choisir une route —', 'Route Nord (6 clients)', 'Route Sud (2 clients)', 'Choisir les clients à la main']);
  eq('… les valeurs : vide, l’identifiant de la route, « __main__ » ; rien n’est choisi', [z.route().children.map((o) => o.value), z.route().value], [['', 'r1', 'r2', '__main__'], '']);
  eq('le choix du délai : 1, 2, 3, 4, 6 h et demain ; aucun n’est choisi', [z.delais().map((b) => b.textContent), z.delais().map((b) => b.className)], [['1 h', '2 h', '3 h', '4 h', '6 h', 'Demain'], Array(6).fill('su-puce')]);
  const autre = z.id('av-autre');
  eq('… et un champ « autre délai » de 1 à 72 heures', [autre.type, autre.min, autre.max, autre.value], ['number', '1', '72', '']);
  eq('tant qu’aucune route n’est choisie : ni liste, ni « Voir ce qui partira » ; seulement le courriel d’essai', [z.clients().length, z.id('av-apercu'), z.id('av-essai').textContent, z.id('av-essai').disabled, z.id('av-tout')], [0, undefined, '✉ M’envoyer un courriel d’essai', false, undefined]);
  eq('l’écran n’a rien lu de plus que le répertoire des clients et les inscriptions, et n’a rien écrit', [z.m.requetes.map((r) => r.table + ':' + r.op), z.ecritures(), z.m.appels.length], [['clients:select', 'inscriptions_avis:select'], 0, 0]);
  vrai('la lecture des fiches se fait avec les VRAIES colonnes de la base (la base les a toutes acceptées)', z.run('clientsDonnees').length === 7 && z.run('clientsDonnees').every((x) => x.id && x.nom));
}

log('=== CHOISIR LA ROUTE ET LE DÉLAI ===');
{
  const z = await monde();
  await z.ouvrirAvis();
  z.choisirRoute('r1');
  eq('la route Nord : ses 6 clients (pas l’archivée, pas l’arrêt sans fiche), dans l’ordre du nom', z.clients().map((c) => c.nom), ['Alice Courriel', 'Bob Texto', 'Carl Les Deux', 'Diane Rien', 'Eric Parti', 'Gaby SansCourriel']);
  eq('… le service, l’adresse (réunis) et ce que la fiche permet', z.clients().map((c) => [c.detail, c.canaux]), [
    ['10 rue des Pins, Louiseville · Coupe de gazon et Désherbage', '✉ courriel'], ['22 rue Bleue, Charette · Coupe de gazon', '📱 texto'],
    ['5 rue Verte, Charette et 7 rue Verte, Charette (2 adresses) · Coupe de gazon', '✉ courriel · 📱 texto'], ['30 rue Grise, Charette · Coupe de gazon', 'Aucun avis activé pour ce client'],
    ['31 rue Grise, Charette · Coupe de gazon', 'Aucun avis activé pour ce client'], ['32 rue Grise, Charette · Coupe de gazon', 'Aucun avis activé pour ce client']]);
  eq('… sont cochés d’office ceux que leur fiche permet d’avertir (Alice, Bob, Carl) ; pas la fiche sans avis, le désabonné, ni « courriel coché mais sans courriel »', z.clients().filter((c) => c.coche).map((c) => c.nom), ['Alice Courriel', 'Bob Texto', 'Carl Les Deux']);
  eq('le résumé : 3 clients cochés sur 6, il faut choisir un délai', z.resume(), '3 clients cochés sur 6 · choisis un délai');
  eq('« Voir ce qui partira » est grisé sans délai', z.id('av-apercu').disabled, true);
  eq('l’avertissement : 2 arrêts de la route ne sont pas reliés à une fiche (celui sans fiche et celui d’une fiche archivée)', parClasse(z.zone(), 'av-note').map((x) => x.textContent).slice(-1), ['⚠ 2 arrêts de cette sélection ne sont pas reliés à une fiche : ils ne recevront rien (voir « Arrêts sans fiche »).']);
  await z.choisirDelai('3h');
  eq('le délai choisi : la puce est marquée, le résumé l’annonce, le bouton s’active', [z.delais().map((b) => b.className), z.resume(), z.id('av-apercu').disabled], [['su-puce', 'su-puce', 'su-puce on', 'su-puce', 'su-puce', 'su-puce'], '3 clients cochés sur 6 · passage environ 3 h', false]);
  await z.choisirDelai('demain');
  eq('« Demain »', [z.resume(), z.run('avisDelai')], ['3 clients cochés sur 6 · passage demain', 'demain']);
  taper(z.id('av-autre'), '5');
  eq('un autre délai tapé (5) : toutes les puces s’éteignent, le délai est « 5h »', [z.delais().map((b) => b.className), z.run('avisDelai'), z.resume()], [Array(6).fill('su-puce'), '5h', '3 clients cochés sur 6 · passage environ 5 h']);
  taper(z.id('av-autre'), '80');
  eq('… 80 n’est pas permis : plus de délai, le bouton se grise', [z.run('avisDelai'), z.id('av-apercu').disabled, z.resume()], ['', true, '3 clients cochés sur 6 · choisis un délai']);
  taper(z.id('av-autre'), '');
  eq('… vider le champ : aucun délai', z.run('avisDelai'), '');
  taper(z.id('av-autre'), '12');
  taper(z.recherche(), 'a');
  eq('un délai tapé (12) survit à un nouveau dessin de l’écran (la recherche) : le champ et le délai sont gardés', [z.id('av-autre').value, z.run('avisDelai'), z.delais().map((b) => b.className)], ['12', '12h', Array(6).fill('su-puce')]);
  taper(z.recherche(), '');
  await z.choisirDelai('2h');
  eq('toucher une puce après un délai tapé : le champ est vidé', [z.id('av-autre').value, z.run('avisDelai')], ['', '2h']);
  z.choisirRoute('r2');
  eq('une autre route : ses clients (Alice et Diane, « Déneigement »), la sélection repart (seule Alice est cochée)', [z.clients().map((c) => [c.nom, c.detail, c.coche]), z.resume()],
    [[['Alice Courriel', '10 rue des Pins, Louiseville · Déneigement', true], ['Diane Rien', '30 rue Grise, Charette · Déneigement', false]], '1 client coché sur 2 · passage environ 2 h']);
  eq('… le délai choisi reste', z.delais().map((b) => b.className), ['su-puce', 'su-puce on', 'su-puce', 'su-puce', 'su-puce', 'su-puce']);
  z.choisirRoute('__main__');
  eq('« à la main » : tous les clients ayant un arrêt, AUCUN coché d’office', [z.clients().map((c) => c.nom), z.clients().filter((c) => c.coche).length, z.resume()], [['Alice Courriel', 'Bob Texto', 'Carl Les Deux', 'Diane Rien', 'Eric Parti', 'Gaby SansCourriel'], 0, '0 client coché sur 6 · passage environ 2 h']);   // (zéro est au singulier en français)
  eq('… sans client coché, « Voir ce qui partira » est grisé', z.id('av-apercu').disabled, true);
  z.coche('Diane Rien');
  eq('cocher un client : le résumé et le bouton suivent', [z.resume(), z.id('av-apercu').disabled], ['1 client coché sur 6 · passage environ 2 h', false]);
  z.coche('Diane Rien', false);
  eq('… le décocher : le bouton se grise', [z.resume(), z.id('av-apercu').disabled], ['0 client coché sur 6 · passage environ 2 h', true]);
  z.choisirRoute('');
  eq('« — Choisir une route — » : la liste disparaît', [z.clients().length, z.id('av-apercu')], [0, undefined]);
  eq('rien de tout cela n’a écrit quoi que ce soit ni appelé la fonction', [z.ecritures(), z.m.appels.length], [0, 0]);
}

log('=== LES CLIENTS QU’ON NE PEUT PAS AVERTIR (AUCUNE FICHE, PAS DE SERVICE OU D’ADRESSE) ===');
{
  const z = await monde({ arrets: [
    arret('t1', 'r1', ID.A, '10 rue des Pins, Louiseville', 'Coupe de gazon'),
    arret('t2', 'r1', null, '9 rue Perdue', 'Coupe de gazon'),            // UN arrêt sans fiche
    arret('t3', 'r1', ID.B, '22 rue Bleue, Charette', ''),                // un client sans service
    arret('t4', 'r1', ID.C, '', 'Coupe de gazon'),                        // un client sans adresse
  ] });
  await z.ouvrirAvis();
  z.choisirRoute('r1');
  eq('les clients sans service ou sans adresse ne sont PAS offerts (la fonction les refuserait) ; ils sont comptés à part, avec l’arrêt sans fiche', [z.clients().map((c) => c.nom), parClasse(z.zone(), 'av-note').slice(-2).map((x) => x.textContent)], [['Alice Courriel'], [
    '⚠ 1 arrêt de cette sélection n’est pas relié à une fiche : il ne recevra rien (voir « Arrêts sans fiche »).', '⚠ 2 clients n’ont pas de service ou d’adresse sur leur arrêt : ils ne peuvent pas être avertis.']]);
  eq('… la route est annoncée avec le nombre de clients qu’on peut avertir', z.route().children[1].textContent, 'Route Nord (1 client)');
  z.run(`stops = stops.filter(s => s.id !== 't4'); renderClientsListe();`);
  eq('un seul client incomplet : le texte est au singulier', parClasse(z.zone(), 'av-note').slice(-1)[0].textContent, '⚠ 1 client n’a pas de service ou d’adresse sur son arrêt : il ne peut pas être averti.');
  z.run(`stops = stops.filter(s => s.id !== 't2' && s.id !== 't3'); renderClientsListe();`);
  eq('rien à signaler : aucun avertissement', parClasse(z.zone(), 'av-note').length, 1);   // (seulement l'explication du haut)
  z.run(`stops = []; renderClientsListe();`);
  eq('aucun arrêt du tout : « Aucun client à avertir ici »', [z.clients().length, parClasse(z.zone(), 'su-message').map((x) => x.textContent)], [0, ['Aucun client à avertir ici (aucun arrêt relié à une fiche).']]);
}

log('=== LA RECHERCHE, TOUT COCHER, TOUT DÉCOCHER ===');
{
  const z = await pret();
  taper(z.recherche(), 'alice');
  eq('la recherche de l’onglet filtre la liste des clients à avertir', z.clients().map((c) => c.nom), ['Alice Courriel']);
  eq('… et ne change pas ce qui est coché (Alice, Bob et Carl)', z.run('[...avisCoches].length'), 3);
  taper(z.recherche(), 'charette');
  eq('… elle cherche aussi dans l’adresse', z.clients().map((c) => c.nom), ['Bob Texto', 'Carl Les Deux', 'Diane Rien', 'Eric Parti', 'Gaby SansCourriel']);
  taper(z.recherche(), 'zzz');
  eq('… aucun client ne correspond : un message', [z.clients().length, parClasse(z.zone(), 'su-message').map((x) => x.textContent)], [0, ['Aucun client ne correspond.']]);
  taper(z.recherche(), 'alice charette');
  eq('… CHAQUE mot doit se trouver (Alice n’est pas à Charette : aucun client), dans n’importe quel ordre', [z.clients().length, parClasse(z.zone(), 'su-message').length], [0, 1]);
  taper(z.recherche(), 'charette carl');
  eq('… « charette carl » : seulement Carl', z.clients().map((c) => c.nom), ['Carl Les Deux']);
  taper(z.recherche(), 'DÉSHERBAGE');
  eq('… sans tenir compte des majuscules ni des accents, et dans le service', z.clients().map((c) => c.nom), ['Alice Courriel']);
  taper(z.recherche(), 'rien');
  await cliquer(z.id('av-tout'));
  eq('« Tout cocher » ne coche que les clients visibles (Diane seulement) ', [z.clients().map((c) => [c.nom, c.coche]), z.run('avisCoches.size')], [[['Diane Rien', true]], 4]);
  taper(z.recherche(), '');
  eq('… la recherche effacée : les 4 cochés sont à jour', z.clients().filter((c) => c.coche).map((c) => c.nom), ['Alice Courriel', 'Bob Texto', 'Carl Les Deux', 'Diane Rien']);
  await cliquer(z.id('av-rien'));
  eq('« Tout décocher »', [z.clients().filter((c) => c.coche).length, z.resume(), z.id('av-apercu').disabled], [0, '0 client coché sur 6 · passage environ 3 h', true]);
  await cliquer(z.id('av-tout'));
  eq('« Tout cocher » sans recherche : les 6', z.clients().filter((c) => c.coche).length, 6);
}

{
  // « Tout cocher » et « Tout décocher » changent la sélection : un aperçu déjà affiché ne vaut plus
  const z = await pret();
  await z.apercu();
  await cliquer(z.id('av-tout'));
  eq('« Tout cocher » après un aperçu : l’aperçu disparaît (la sélection a changé : 6 clients cochés)', [z.boite('av-apercu-boite'), z.id('av-envoyer'), z.clients().filter((c) => c.coche).length], [undefined, undefined, 6]);
  await z.apercu();
  eq('(un nouvel aperçu pour les 6 clients)', !!z.boite('av-apercu-boite'), true);
  await cliquer(z.id('av-rien'));
  eq('« Tout décocher » après un aperçu : l’aperçu disparaît (0 client coché)', [z.boite('av-apercu-boite'), z.id('av-envoyer'), z.clients().filter((c) => c.coche).length], [undefined, undefined, 0]);
}

log('=== L’APERÇU : CE QUI PARTIRAIT, SANS RIEN ÉCRIRE NI ENVOYER ===');
{
  const z = await pret();
  await z.apercu();
  const a = z.m.appels;
  eq('UN appel à la fonction « envoyer-avis » : l’action « apercu », le délai, les clients cochés avec leur service et leur adresse — rien d’autre (pas de canaux : c’est la fonction qui décide)', [a.length, a[0].nom, a[0].body], [1, 'envoyer-avis', {
    action: 'apercu', delai: '3h', lignes: [
      { client_id: ID.A, service: 'Coupe de gazon et Désherbage', adresse: '10 rue des Pins, Louiseville' }, { client_id: ID.B, service: 'Coupe de gazon', adresse: '22 rue Bleue, Charette' },
      { client_id: ID.C, service: 'Coupe de gazon', adresse: '5 rue Verte, Charette et 7 rue Verte, Charette' }] }]);
  eq('l’aperçu n’écrit RIEN au journal et n’envoie RIEN (la base et les fournisseurs n’ont rien reçu)', [await nbJournal(), z.m.courriels.length, z.m.textos.length, z.m.rpcs], [0, 0, 0, ['avis_apercu']]);
  const b = z.boite('av-apercu-boite');
  vrai('la boîte « Ce qui partirait » apparaît', !!b && parClasse(b, 'su-section')[0].textContent === 'Ce qui partirait');
  eq('le résumé : 2 courriels, passage environ 3 h ; le refus de Bob (le courriel n’est pas activé dans sa fiche) est expliqué', [parClasse(b, 'av-resume')[0].textContent, z.notes(b)[0]],
    ['✔ 2 courriels — passage environ 3 h', '✖ Refusés (1) : 1 × avis par courriel non activés (case « Avertir par courriel » de la fiche)']);
  eq('les textos ne sont pas encore activés : l’écran le dit (les courriels, oui)', z.notes(b)[1], '📱 Les textos ne sont pas encore activés : aucun texto ne partira (les courriels, oui).');
  eq('les lignes : celles qui partent d’abord (Alice, Carl) avec l’adresse du courriel, puis le refus de Bob avec sa raison', z.lignes(b), [
    { nom: 'Alice Courriel · ✉', badge: 'Partira', details: ['→ alice@exemple.ca · toucher le nom pour lire le message'] },
    { nom: 'Carl Les Deux · ✉', badge: 'Partira', details: ['→ carl@exemple.ca · toucher le nom pour lire le message'] },
    { nom: 'Bob Texto · ✉', badge: 'Refusé', details: ['avis par courriel non activés (case « Avertir par courriel » de la fiche)'] }]);
  eq('les pastilles : « Partira » en vert, « Refusé » en rouge', parClasse(b, 'su-badge').map((x) => x.className + ':' + x.textContent), ['su-badge ok:Partira', 'su-badge ok:Partira', 'su-badge retard:Refusé']);
  eq('le bouton « Envoyer maintenant » dit combien de messages', [z.id('av-envoyer').textContent, z.id('av-envoyer').disabled], ['✉ Envoyer maintenant (2 messages)', false]);
  eq('l’écran défile jusqu’à l’aperçu (une fois)', z.m.defilements.map((d) => d.id), ['av-apercu-boite']);
  eq('l’indicateur de synchronisation s’est allumé puis éteint ; les boutons sont de nouveau actifs', [z.m.sync.at(-1), z.id('av-apercu').disabled, z.id('av-essai').disabled], [false, false, false]);
  // le message exact d'une ligne
  await cliquer(parClasse(parClasse(b, 'av-ligne')[0], 'su-nom')[0]);
  const feuille = z.el('clients-feuille-corps');
  vrai('toucher le nom ouvre la feuille avec le message EXACT', z.feuilleOuverte() && z.el('clients-feuille-titre').textContent === 'Alice Courriel');
  const msg = parClasse(feuille, 'av-message')[0].textContent;
  eq('… l’adresse du courriel, l’objet et le message : le service et l’adresse y sont, le lien de désabonnement est un repère', [parClasse(feuille, 'su-adresse')[0].textContent, parClasse(feuille, 'av-objet')[0].textContent.startsWith('Objet : Entretien Lapointe'), /Coupe de gazon et Désherbage/.test(msg), /10 rue des Pins, Louiseville/.test(msg), /environ 3 heures/.test(msg), msg.includes('[lien de désabonnement]')],
    ['Courriel à alice@exemple.ca', true, true, true, true, true]);
  eq('… et la feuille explique le repère', parClasse(feuille, 'su-adresse').at(-1).textContent, 'Au moment de l’envoi, « [lien de désabonnement] » devient le lien personnel de ce client.');
  await cliquer(parClasse(feuille, 'lf-btn')[0]);
  eq('« Fermer » referme la feuille', z.feuilleOuverte(), false);
  eq('le nom d’une ligne REFUSÉE n’est pas touchable (rien ne partira : le message existe, mais il n’y a rien à lire) ; celui d’une ligne qui part l’est', [parClasse(parClasse(b, 'av-ligne')[2], 'su-nom')[0].onclick === null, typeof parClasse(parClasse(b, 'av-ligne')[0], 'su-nom')[0].onclick === 'function'], [true, true]);   // (pas de JSON : une fonction y devient « null »)
  eq('rien d’écrit dans l’application ; une seule demande à la fonction', [z.ecritures(), z.m.appels.length], [0, 1]);
}

log('=== UN SEUL MESSAGE : LES TEXTES AU SINGULIER ===');
{
  const z = await pret();
  z.coche('Bob Texto', false);
  z.coche('Carl Les Deux', false);
  await z.apercu();
  eq('un seul client coché, un seul message : « 1 client coché », « Envoyer maintenant (1 message) »', [z.resume(), z.id('av-envoyer').textContent, parClasse(z.boite('av-apercu-boite'), 'av-resume')[0].textContent], ['1 client coché sur 6 · passage environ 3 h', '✉ Envoyer maintenant (1 message)', '✔ 1 courriel — passage environ 3 h']);
  await z.envoyer();
  eq('… la confirmation et le résultat sont au singulier', [z.m.confirmations[0][1], z.m.toasts.at(-1), parClasse(z.boite('av-resultat'), 'av-resume')[0].textContent], ['1 courriel à 1 client : « nous passons chez vous dans environ 3 h ». Un avis envoyé ne se reprend pas.', '✔ 1 avis envoyé', '✔ 1 envoyé']);
}
{
  const z = await pret({}, 'demain');
  await z.apercu();
  eq('« demain » : le résumé, la confirmation et le message le disent', [parClasse(z.boite('av-apercu-boite'), 'av-resume')[0].textContent], ['✔ 2 courriels — passage demain']);
  await z.envoyer();
  eq('… la confirmation : « nous passons chez vous demain » ; le courriel part avec l’objet « demain »', [z.m.confirmations[0][1], /demain$/.test(z.m.courriels[0].objet), z.m.courriels.length], ['2 courriels à 2 clients : « nous passons chez vous demain ». Un avis envoyé ne se reprend pas.', true, 2]);
}

log('=== L’APERÇU : LES TEXTOS, LA NUIT, LES CLIENTS QUI NE RECEVRAIENT RIEN ===');
{
  const z = await pret({ textos: true });
  await z.apercu();
  const b = z.boite('av-apercu-boite');
  eq('textos ACTIVÉS : 2 courriels + 2 textos ; un client qui reçoit un avis n’est pas « refusé » pour l’autre canal (Alice, Bob)', [parClasse(b, 'av-resume')[0].textContent, z.notes(b)], ['✔ 2 courriels + 2 textos — passage environ 3 h', []]);
  eq('… les lignes : le courriel d’Alice, le texto de Bob, les deux de Carl (avec le numéro)', z.lignes(b).map((l) => [l.nom, l.badge, l.details[0]]), [
    ['Alice Courriel · ✉', 'Partira', '→ alice@exemple.ca · toucher le nom pour lire le message'], ['Bob Texto · 📱', 'Partira', '→ +18195550002 · toucher le nom pour lire le message'],
    ['Carl Les Deux · ✉', 'Partira', '→ carl@exemple.ca · toucher le nom pour lire le message'], ['Carl Les Deux · 📱', 'Partira', '→ +18195550003 · toucher le nom pour lire le message']]);
  await cliquer(parClasse(parClasse(b, 'av-ligne')[1], 'su-nom')[0]);
  const msg = parClasse(z.el('clients-feuille-corps'), 'av-message')[0].textContent;
  eq('le message d’un texto : « Texto à … », pas d’objet, le texte approuvé', [parClasse(z.el('clients-feuille-corps'), 'su-adresse')[0].textContent, parClasse(z.el('clients-feuille-corps'), 'av-objet').length, /^Entretien Lapointe : nous passerons chez vous dans environ 3 h pour le service « Coupe de gazon »/.test(msg), /ARRET pour ne plus recevoir ces avis\.$/.test(msg)],
    ['Texto à +18195550002', 0, true, true]);
  eq('… la feuille d’un texto n’explique pas de lien (il n’y en a pas)', parClasse(z.el('clients-feuille-corps'), 'su-adresse').length, 1);
  eq('rien n’est envoyé par l’aperçu, même avec les textos activés', [z.m.courriels.length, z.m.textos.length, await nbJournal()], [0, 0, 0]);
}
{
  const z = await pret({ textos: true, maintenant: NUIT });
  await z.apercu();
  const b = z.boite('av-apercu-boite');
  eq('LA NUIT (22 h 30) : les courriels partent, les textos sont refusés « hors des heures » ; l’écran l’annonce', [parClasse(b, 'av-resume')[0].textContent, z.notes(b)], [
    '✔ 2 courriels — passage environ 3 h', ['✖ Refusés (3) : 1 × avis par courriel non activés (case « Avertir par courriel » de la fiche) · 2 × texto interdit de 21 h à 6 h (heure du Québec)', 'Il est entre 21 h et 6 h (heure du Québec) : les textos sont refusés, les courriels partent.']]);
  eq('… les lignes : celles qui partent, puis les refus avec leur raison', z.lignes(b).map((l) => [l.nom, l.badge, l.details[0]]), [
    ['Alice Courriel · ✉', 'Partira', '→ alice@exemple.ca · toucher le nom pour lire le message'], ['Carl Les Deux · ✉', 'Partira', '→ carl@exemple.ca · toucher le nom pour lire le message'],
    ['Bob Texto · ✉', 'Refusé', 'avis par courriel non activés (case « Avertir par courriel » de la fiche)'], ['Bob Texto · 📱', 'Refusé', 'texto interdit de 21 h à 6 h (heure du Québec)'], ['Carl Les Deux · 📱', 'Refusé', 'texto interdit de 21 h à 6 h (heure du Québec)']]);
}
{
  const z = await monde();
  await z.ouvrirAvis();
  z.choisirRoute('__main__');
  await z.choisirDelai('1h');
  for (const n of ['Diane Rien', 'Eric Parti', 'Gaby SansCourriel']) z.coche(n);
  await z.apercu();
  const b = z.boite('av-apercu-boite');
  eq('des clients qui ne recevraient RIEN (aucun avis activé, désabonné, courriel coché sans courriel) : « Rien ne partirait », chaque raison est dite', [parClasse(b, 'av-resume')[0].textContent, z.lignes(b).map((l) => [l.nom, l.badge, l.details[0]])], [
    'Rien ne partirait.', [['Diane Rien · ✉', 'Refusé', 'avis par courriel non activés (case « Avertir par courriel » de la fiche)'], ['Eric Parti · ✉', 'Refusé', 'désabonné des courriels'], ['Gaby SansCourriel · ✉', 'Refusé', 'aucun courriel dans la fiche']]]);
  eq('… le bouton « Envoyer » est grisé', [z.id('av-envoyer').textContent, z.id('av-envoyer').disabled], ['✉ Envoyer maintenant (0 message)', true]);
  eq('… même grisé, un toucher n’envoie rien', [await z.envoyer(), z.m.appels.length, z.m.confirmations.length], [undefined, 1, 0]);
}

{
  // la nuit, mais les textos ne sont pas activés : la note sur les heures des textos n'a pas de sens (aucun texto n'est en cause)
  const z = await pret({ maintenant: NUIT });
  await z.apercu();
  eq('LA NUIT sans textos activés : seule la note « textos non activés » est montrée (pas celle des heures)', z.notes(z.boite('av-apercu-boite')).filter((x) => /21 h|pas encore activés/.test(x)), ['📱 Les textos ne sont pas encore activés : aucun texto ne partira (les courriels, oui).']);
}

log('=== L’ENVOI ===');
{
  const z = await pret();
  await z.apercu();
  z.repondre(false);
  await z.envoyer();
  eq('« Annuler » à la confirmation : AUCUN envoi (un seul appel : l’aperçu), l’aperçu reste affiché', [z.m.appels.map((a) => a.body.action), z.m.courriels.length, await nbJournal(), !!z.boite('av-apercu-boite')], [['apercu'], 0, 0, true]);
  eq('… la confirmation dit combien, à qui, et que l’avis ne se reprend pas', z.m.confirmations[0], ['Envoyer les avis ?', '2 courriels à 2 clients : « nous passons chez vous dans environ 3 h ». Un avis envoyé ne se reprend pas.', 'Envoyer', 'Annuler']);
  z.repondre(true);
  await z.envoyer();
  const a = z.m.appels;
  eq('« Envoyer » : un 2ᵉ appel, l’action « envoyer », les MÊMES clients et le MÊME délai que l’aperçu', [a.length, a[1].body.action, a[1].body.delai, JSON.stringify(a[1].body.lignes) === JSON.stringify(a[0].body.lignes), Object.keys(a[1].body)], [2, 'envoyer', '3h', true, ['action', 'delai', 'lignes']]);
  eq('les courriels sont partis : à Alice et à Carl (pas à Bob)', z.m.courriels.map((c) => c.a), ['alice@exemple.ca', 'carl@exemple.ca']);
  const c0 = z.m.courriels[0];
  eq('… l’objet, le service, l’adresse, et le lien de désabonnement PERSONNEL (le repère est remplacé, dans le texte et dans le HTML)', [/^Entretien Lapointe : nous passons chez vous d.ici environ 3 heures$/.test(c0.objet), /Coupe de gazon et Désherbage/.test(c0.texte), /10 rue des Pins, Louiseville/.test(c0.texte), c0.texte.includes('[lien de désabonnement]'), c0.html.includes('[lien de désabonnement]'),
    new RegExp(`^https://www\\.entretienlapointe\\.ca/desabonnement\\.html\\?c=${ID.A}&t=[0-9a-f]{32}$`).test(c0.lien), c0.texte.includes(c0.lien), c0.html.includes('href="' + c0.lien.replace(/&/g, '&amp;') + '"')], [true, true, true, false, false, true, true, true]);
  eq('le journal de la base : Alice et Carl « envoyé », Bob « refusé » (pas activé)', await journal(), ['Alice Courriel:courriel:envoye', 'Bob Texto:courriel:refuse:pas_active', 'Carl Les Deux:courriel:envoye']);
  eq('le toast annonce 2 avis envoyés', z.m.toasts.at(-1), '✔ 2 avis envoyés');
  eq('l’aperçu disparaît, le résultat s’affiche à sa place (et l’écran défile jusqu’à lui)', [z.boite('av-apercu-boite'), !!z.boite('av-resultat'), z.m.defilements.map((d) => d.id)], [undefined, true, ['av-apercu-boite', 'av-resultat']]);
  const r = z.boite('av-resultat');
  eq('le résultat : le résumé, le refus de Bob expliqué, une ligne par client (envoyés d’abord)', [parClasse(r, 'av-resume')[0].textContent, z.notes(r), z.lignes(r)], [
    '✔ 2 envoyés · 1 refusé', ['Refusés : 1 × avis par courriel non activés (case « Avertir par courriel » de la fiche)'],
    [{ nom: 'Alice Courriel · ✉', badge: 'Envoyé', details: [] }, { nom: 'Carl Les Deux · ✉', badge: 'Envoyé', details: [] }, { nom: 'Bob Texto · ✉', badge: 'Refusé', details: ['avis par courriel non activés (case « Avertir par courriel » de la fiche)'] }]]);
  eq('« Envoyer » n’est plus offert (il faut refaire un aperçu) ; l’écran est libre', [z.id('av-envoyer'), z.id('av-apercu').disabled, z.id('av-essai').disabled, z.m.sync.at(-1)], [undefined, false, false, false]);
  eq('l’application n’a écrit nulle part elle-même', z.ecritures(), 0);
  // un 2ᵉ aperçu le même jour : les clients déjà avertis sont refusés
  await z.apercu();
  const b2 = z.boite('av-apercu-boite');
  eq('un 2ᵉ aperçu le MÊME jour : Alice et Carl sont « déjà avertis aujourd’hui » ; rien ne partirait', [parClasse(b2, 'av-resume')[0].textContent, z.id('av-envoyer').disabled, z.lignes(b2).map((l) => [l.nom, l.details[0]])], [
    'Rien ne partirait.', true, [['Alice Courriel · ✉', 'déjà averti aujourd’hui'], ['Bob Texto · ✉', 'avis par courriel non activés (case « Avertir par courriel » de la fiche)'], ['Carl Les Deux · ✉', 'déjà averti aujourd’hui']]]);
  eq('… et le résultat précédent est remplacé par cet aperçu', [z.boite('av-resultat'), z.m.courriels.length], [undefined, 2]);
}

log('=== L’ENVOI : LES TEXTOS, LA NUIT, UN ÉCHEC DU FOURNISSEUR ===');
{
  const z = await pret({ textos: true });
  await z.apercu();
  await z.envoyer();
  eq('textos activés : 2 courriels ET 2 textos partent ; le message du texto est celui de la base', [z.m.courriels.map((c) => c.a), z.m.textos.map((t) => t.a), /^Entretien Lapointe : nous passerons chez vous dans environ 3 h pour le service « Coupe de gazon »/.test(z.m.textos[0].corps)], [['alice@exemple.ca', 'carl@exemple.ca'], ['+18195550002', '+18195550003'], true]);
  eq('… la confirmation parlait de 2 courriels + 2 textos à 3 clients', z.m.confirmations[0][1], '2 courriels + 2 textos à 3 clients : « nous passons chez vous dans environ 3 h ». Un avis envoyé ne se reprend pas.');
  eq('… le journal garde chaque envoi', await journal(), ['Alice Courriel:courriel:envoye', 'Alice Courriel:texto:refuse:pas_active', 'Bob Texto:courriel:refuse:pas_active', 'Bob Texto:texto:envoye', 'Carl Les Deux:courriel:envoye', 'Carl Les Deux:texto:envoye']);
  eq('… le résultat : 4 envoyés ; les refus « normaux » (pas inscrit à l’autre canal) ne sont pas montrés', [parClasse(z.boite('av-resultat'), 'av-resume')[0].textContent, z.lignes(z.boite('av-resultat')).length, z.notes(z.boite('av-resultat'))], ['✔ 4 envoyés', 4, []]);
}
{
  const z = await pret({ textos: true, maintenant: NUIT });
  await z.apercu();
  await z.envoyer();
  eq('LA NUIT : seuls les 2 courriels partent ; AUCUN texto (la base les refuse) ; le résultat dit pourquoi', [z.m.courriels.length, z.m.textos.length, z.m.toasts.at(-1), z.notes(z.boite('av-resultat'))],
    [2, 0, '✔ 2 avis envoyés', ['Refusés : 1 × avis par courriel non activés (case « Avertir par courriel » de la fiche) · 2 × texto interdit de 21 h à 6 h (heure du Québec)']]);
}
{
  const z = await pret({ courrielEchec: (c) => (c.a === 'carl@exemple.ca' ? 'resend 422 invalid_to_address' : null) });
  await z.apercu();
  await z.envoyer();
  const r = z.boite('av-resultat');
  eq('Resend refuse UN courriel : 1 envoyé, 1 en échec — l’écran le dit sans cacher l’échec', [z.m.toasts.at(-1), parClasse(r, 'av-resume')[0].textContent, z.lignes(r).map((l) => [l.nom, l.badge, l.details[0] ?? ''])], [
    '⚠ 1 envoyé, 1 en échec', '✔ 1 envoyé · ✖ 1 en échec · 1 refusé', [['Alice Courriel · ✉', 'Envoyé', ''], ['Carl Les Deux · ✉', 'Échec', 'le service de courriel a refusé l’envoi'], ['Bob Texto · ✉', 'Refusé', 'avis par courriel non activés (case « Avertir par courriel » de la fiche)']]]);
  eq('… les pastilles : vert pour l’envoyé, rouge pour l’échec et le refus', parClasse(r, 'su-badge').map((x) => x.className + ':' + x.textContent), ['su-badge ok:Envoyé', 'su-badge retard:Échec', 'su-badge retard:Refusé']);
  eq('… le journal garde l’échec', await journal(), ['Alice Courriel:courriel:envoye', 'Bob Texto:courriel:refuse:pas_active', 'Carl Les Deux:courriel:echec:echec_fournisseur']);
}
{
  const z = await pret({ rpcErreur: { avis_marquer: 'boum' } });
  await z.apercu();
  await z.envoyer();
  eq('si le journal n’a pas pu noter les envois, la fonction AVERTIT et l’écran montre l’avertissement', [parClasse(z.boite('av-resultat'), 'av-avertissement').map((x) => x.textContent)], [['2 envoi(s) ont été faits mais n\'ont pas pu être notés au journal : vérifiez le journal et les journaux de la fonction.']]);
}
{
  // un autre appareil (ou un autre toucher) a déjà envoyé les mêmes avis entre l'aperçu et l'envoi : la BASE refuse les doublons, l'écran le dit
  const z = await pret();
  await z.apercu();
  const lignes = z.m.appels[0].body.lignes;
  await z.run(`db.functions.invoke('envoyer-avis', { body: { action: 'envoyer', delai: '3h', lignes: ${JSON.stringify(lignes)} } })`);
  eq('(l’autre appareil a envoyé 2 courriels)', z.m.courriels.length, 2);
  await z.envoyer();
  eq('l’aperçu disait « 2 courriels », mais Alice et Carl ont déjà été avertis : AUCUN doublon ne part, l’écran dit « Aucun avis n’est parti »', [z.m.courriels.length, z.m.toasts.at(-1), parClasse(z.boite('av-resultat'), 'av-resume')[0].textContent],
    [2, 'Aucun avis n’est parti (tous refusés).', '✖ Aucun envoyé · 3 refusés']);
  eq('… chaque refus est expliqué', z.lignes(z.boite('av-resultat')).map((l) => [l.nom, l.badge, l.details[0]]), [['Alice Courriel · ✉', 'Refusé', 'déjà averti aujourd’hui'], ['Bob Texto · ✉', 'Refusé', 'avis par courriel non activés (case « Avertir par courriel » de la fiche)'], ['Carl Les Deux · ✉', 'Refusé', 'déjà averti aujourd’hui']]);
}

log('=== LES GARDES : L’ENVOI EXIGE UN APERÇU FRAIS, DU MÊME DÉLAI ET DES MÊMES CLIENTS ===');
{
  const z = await pret();
  await z.apercu();
  await z.choisirDelai('4h');
  eq('changer le délai après l’aperçu : l’aperçu disparaît, il faut le refaire (pas de bouton « Envoyer »)', [z.boite('av-apercu-boite'), z.id('av-envoyer'), z.resume()], [undefined, undefined, '3 clients cochés sur 6 · passage environ 4 h']);
  await z.apercu();
  z.coche('Alice Courriel', false);
  eq('décocher un client après l’aperçu : l’aperçu disparaît', [z.boite('av-apercu-boite'), z.id('av-envoyer')], [undefined, undefined]);
  await z.apercu();
  z.choisirRoute('r2');
  eq('changer de route après l’aperçu : l’aperçu disparaît', [z.boite('av-apercu-boite'), z.m.appels.length], [undefined, 3]);
}
{
  const z = await pret();
  await z.apercu();
  z.run(`avisCoches.delete(${JSON.stringify(ID.A)})`);   // la sélection change SANS passer par l'écran (course) : le bouton « Envoyer » est encore là
  eq('(le bouton « Envoyer » est encore affiché)', !!z.id('av-envoyer'), true);
  await z.envoyer();
  eq('la sélection ne correspond plus à l’aperçu : RIEN n’est envoyé, ni confirmation ni appel', [z.m.appels.length, z.m.confirmations.length, z.m.toasts.at(-1), z.m.courriels.length], [1, 0, '⚠ La sélection a changé : refais l’aperçu.', 0]);
}
{
  const z = await pret();
  await z.apercu();
  const ancien = z.id('av-envoyer');   // (un bouton déjà à l'écran quand l'aperçu disparaît : il n'envoie plus rien)
  await z.choisirDelai('4h');
  await cliquer(ancien);
  eq('un « Envoyer » resté à l’écran alors que l’aperçu n’existe plus : un toucher ne fait RIEN (ni confirmation, ni appel, ni plantage)', [z.m.appels.length, z.m.confirmations.length, z.m.courriels.length], [1, 0, 0]);
}
{
  const z = await pret();
  await z.apercu();
  z.run(`avisApercu.quand = Date.now() - 11 * 60 * 1000`);
  await z.envoyer();
  eq('un aperçu de plus de 10 minutes : RIEN n’est envoyé, il faut le refaire', [z.m.appels.length, z.m.confirmations.length, z.m.toasts.at(-1), z.boite('av-apercu-boite'), z.m.courriels.length], [1, 0, '⏱ L’aperçu date de plus de 10 minutes : refais-le avant d’envoyer.', undefined, 0]);
  await z.apercu();
  z.run(`avisApercu.quand = Date.now() - 9 * 60 * 1000`);
  await z.envoyer();
  eq('… à 9 minutes, c’est encore bon', [z.m.courriels.length, z.m.toasts.at(-1)], [2, '✔ 2 avis envoyés']);
}
{
  const z = await pret();
  await z.apercu();
  z.choisirRoute('r1');   // la même route : la sélection repart d'office, l'aperçu est refait de zéro
  eq('rechoisir la route : l’aperçu précédent ne vaut plus', z.boite('av-apercu-boite'), undefined);
}
{
  // le répertoire relu (« Actualiser », ou la réouverture de l'onglet) : un aperçu ou un résultat d'avant ne vaut plus
  const z = await pret();
  await z.apercu();
  await z.ouvrir();
  eq('relire le répertoire : l’écran revient avec la même route, le même délai et les mêmes cochés, mais SANS l’aperçu', [z.run('clientsFiltre'), z.route().value, z.run('avisDelai'), z.clients().filter((c) => c.coche).length, z.boite('av-apercu-boite')], ['avis', 'r1', '3h', 3, undefined]);
  await z.apercu();
  await z.envoyer();
  await z.ouvrir();
  eq('… un résultat d’envoi aussi disparaît', [z.boite('av-resultat'), z.id('av-envoyer')], [undefined, undefined]);
}
{
  const z = await pret();
  await z.apercu();
  await cliquer(z.puce('Tous'));
  await cliquer(z.puce('📣 Avis aux clients'));
  eq('aller voir une autre puce puis revenir : la sélection ET l’aperçu sont gardés (l’âge de l’aperçu reste vérifié à l’envoi)', [z.route().value, z.run('avisDelai'), z.clients().filter((c) => c.coche).length, !!z.boite('av-apercu-boite')], ['r1', '3h', 3, true]);
}
{
  const z = await pret();
  await z.apercu();
  z.run(`routes = routes.filter(r => r.id !== 'r1')`);
  await cliquer(z.puce('Tous'));
  await cliquer(z.puce('📣 Avis aux clients'));
  eq('la route choisie a été supprimée depuis : la sélection repart de zéro (aucune route, aucun client coché, pas d’aperçu)', [z.route().value, z.clients().length, z.boite('av-apercu-boite'), z.run('avisCoches.size')], ['', 0, undefined, 0]);
}

log('=== UN SEUL APPEL À LA FOIS ===');
{
  let liberer; const attente = new Promise((r) => { liberer = r; });
  const z = await pret({ invokeRetard: () => attente });
  const bouton = z.id('av-apercu');
  const p1 = bouton.onclick();
  const p2 = bouton.onclick();   // un 2ᵉ toucher pendant que le 1ᵉʳ appel attend sa réponse
  await dormir(20);
  eq('pendant l’attente : les boutons sont grisés et l’indicateur est allumé ; UN seul appel est parti', [z.id('av-apercu').disabled, z.id('av-essai').disabled, z.m.appels.length, z.m.sync.at(-1)], [true, true, 1, true]);
  liberer();
  await p1; await p2;
  eq('après la réponse : l’aperçu est là, les boutons sont libres, l’indicateur est éteint, toujours UN seul appel', [!!z.boite('av-apercu-boite'), z.id('av-apercu').disabled, z.m.appels.length, z.m.sync.at(-1)], [true, false, 1, false]);
}
{
  // un envoi lent : un 2ᵉ toucher sur « Envoyer » pendant l'attente ne fait RIEN de plus
  let liberer; const attente = new Promise((r) => { liberer = r; });
  const z = await pret({ invokeRetard: (b) => (b.action === 'envoyer' ? attente : null) });
  await z.apercu();
  const bEnv = z.id('av-envoyer');
  const p1 = bEnv.onclick();
  const p2 = bEnv.onclick();
  await dormir(20);
  eq('« Envoyer » touché deux fois : UNE confirmation, UN envoi, les boutons sont grisés pendant l’attente', [z.m.confirmations.length, z.m.appels.filter((a) => a.body.action === 'envoyer').length, z.id('av-apercu').disabled, z.id('av-envoyer').disabled, z.id('av-essai').disabled], [1, 1, true, true, true]);
  liberer();
  await p1; await p2;
  eq('… les courriels ne sont partis qu’UNE fois (2 courriels ; le journal : 2 envoyés et le refus de Bob)', [z.m.courriels.length, await nbJournal(), z.m.toasts.at(-1)], [2, 3, '✔ 2 avis envoyés']);
}

log('=== LES PANNES ET LES REFUS DU SERVEUR ===');
{
  const z = await pret({ auth: 'Bearer employe' });
  await z.apercu();
  eq('un compte qui n’est pas administrateur (la fonction répond 403) : l’aperçu dit pourquoi, rien ne s’affiche', [z.m.toasts.at(-1), z.boite('av-apercu-boite'), z.id('av-apercu').disabled, z.m.sync.at(-1)], ['❌ Réservé à l’administrateur : reconnecte-toi, puis réessaie.', undefined, false, false]);
}
{
  const z = await pret({ invokePanne: () => true });
  await z.apercu();
  eq('pas de réseau pendant l’APERÇU : « rien n’a été envoyé » (c’est vrai), les boutons sont libres', [z.m.toasts.at(-1), z.boite('av-apercu-boite'), z.id('av-apercu').disabled, z.m.courriels.length], ['📴 Pas de réseau : rien n’a été envoyé.', undefined, false, 0]);
}
{
  const z = await pret({ invokeLance: () => true });
  await z.apercu();
  eq('… la demande qui plante (exception de réseau) : même message', [z.m.toasts.at(-1), z.id('av-apercu').disabled], ['📴 Pas de réseau : rien n’a été envoyé.', false]);
}
{
  const z = await pret({ invokePanne: (b) => b.action === 'envoyer' });
  await z.apercu();
  await z.envoyer();
  eq('une panne PENDANT l’envoi : l’écran ne dit PAS « rien n’a été envoyé » ; l’aperçu est effacé (il faut le refaire pour voir qui a déjà reçu)', [z.m.toasts.at(-1), z.boite('av-apercu-boite'), z.id('av-envoyer'), z.boite('av-resultat'), z.id('av-apercu').disabled],
    ['⚠ La réponse du serveur n’est pas arrivée : certains avis sont peut-être partis. Refais « Voir ce qui partira » : les clients déjà avertis aujourd’hui y sont marqués.', undefined, undefined, undefined, false]);
}
{
  const z = await pret({ rpcErreur: { avis_apercu: 'Could not find the function public.avis_apercu(p_par) in the schema cache' } });
  await z.apercu();
  eq('les fichiers SQL pas exécutés : l’aperçu le dit', z.m.toasts.at(-1), '❌ Les fichiers SQL 31 et 32 ne sont pas tous exécutés chez Supabase.');
}
{
  const z = await pret({ rpcErreur: { avis_preparer: 'boum' } });
  await z.apercu();
  await z.envoyer();
  eq('la base refuse la préparation de l’envoi : « rien n’a été envoyé » (c’est vrai : rien n’est écrit ni envoyé), l’aperçu est effacé', [z.m.toasts.at(-1), z.m.courriels.length, z.boite('av-apercu-boite')], ['❌ La base a refusé la demande : rien n’a été envoyé (voir les journaux de la fonction).', 0, undefined]);
}
{
  const z = await pret({ invokeBrut: () => ({ data: null, error: null }) });
  await z.apercu();
  eq('une réponse vide ou illisible du serveur : un message d’erreur, rien d’affiché', [z.m.toasts.at(-1), z.boite('av-apercu-boite')], ['❌ Une erreur est survenue.', undefined]);
}
{
  const z = await pret({ invokeBrut: (b) => (b.action === 'apercu' ? { data: { ok: true, apercu: true, lignes: [] }, error: null } : { data: null, error: null }) });
  await z.apercu();
  eq('un aperçu sans aucune ligne : « Rien ne partirait. », aucune note, « Envoyer » grisé', [parClasse(z.boite('av-apercu-boite'), 'av-resume')[0].textContent, z.notes(z.boite('av-apercu-boite')), z.id('av-envoyer').disabled], ['Rien ne partirait.', [], true]);
}
{
  const z = await pret({ invokeBrut: () => ({ data: { ok: false, erreur: 'non_autorise', message: 'Un autre texte du serveur.' }, error: null }) });
  await z.apercu();
  eq('une réponse « ok: false » sans erreur HTTP : traitée comme une erreur (le CODE du serveur est lu), rien d’affiché', [z.m.toasts.at(-1), z.boite('av-apercu-boite')], ['❌ Réservé à l’administrateur : reconnecte-toi, puis réessaie.', undefined]);
}
{
  // la passerelle de Supabase refuse un jeton périmé (401) : la fonction n'a rien fait, l'écran dit de se reconnecter — même PENDANT l'envoi
  const refus401 = () => ({ data: null, error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: new Response(JSON.stringify({ code: 401, message: 'Invalid JWT' }), { status: 401 }) } });
  const z = await pret({ invokeBrut: (b) => (b.action === 'envoyer' ? refus401() : undefined) });
  await z.apercu();
  await z.envoyer();
  eq('un jeton périmé (401 de la passerelle) PENDANT l’envoi : « reconnecte-toi » — PAS le message « peut-être partis » (la fonction n’a rien fait)', [z.m.toasts.at(-1), z.m.courriels.length, z.boite('av-resultat')], ['❌ Réservé à l’administrateur : reconnecte-toi, puis réessaie.', 0, undefined]);
  const z2 = await pret({ invokeBrut: () => refus401() });
  await z2.apercu();
  eq('… et pour l’aperçu aussi', [z2.m.toasts.at(-1), z2.boite('av-apercu-boite')], ['❌ Réservé à l’administrateur : reconnecte-toi, puis réessaie.', undefined]);
}
{
  // un client que le répertoire ne connaît pas (fiche supprimée depuis, lecture plus ancienne…) : l'écran ne plante pas et le dit
  const inconnu = '00000000-0000-4000-8000-000000000000';
  const z = await pret({ invokeBrut: (b) => (b.action === 'apercu' ? { data: { ok: true, apercu: true, jour: '2026-10-14', heure_permise_texto: true, lignes: [{ id: null, client_id: inconnu, canal: 'courriel', statut: 'a_envoyer', motif: null, destinataire: 'x@y.ca', objet: 'O', message: 'M' }] }, error: null } : undefined) });
  await z.apercu();
  eq('un client absent du répertoire : « (client inconnu) » au lieu d’un nom', z.lignes(z.boite('av-apercu-boite')).map((l) => l.nom), ['(client inconnu) · ✉']);
}
{
  const z = await monde();
  await z.ouvrirAvis();
  z.choisirRoute('r1');
  await z.apercu();
  eq('« Voir ce qui partira » touché SANS délai (bouton grisé) : aucun appel', [z.id('av-apercu').disabled, z.m.appels.length], [true, 0]);
}
{
  // la sélection change PENDANT l'attente de l'aperçu : cet aperçu ne vaut plus, il n'est pas affiché
  let liberer; const attente = new Promise((r) => { liberer = r; });
  const z = await pret({ invokeRetard: () => attente });
  const p1 = z.id('av-apercu').onclick();
  await dormir(20);
  await z.choisirDelai('4h');
  liberer();
  await p1;
  eq('l’aperçu arrive pour 3 h alors qu’on a choisi 4 h entre-temps : il n’est PAS affiché, les boutons sont libres', [z.boite('av-apercu-boite'), z.id('av-apercu').disabled, z.run('avisDelai')], [undefined, false, '4h']);
}

log('=== LE COURRIEL D’ESSAI ===');
{
  const z = await monde();
  await z.ouvrirAvis();
  await z.essai();
  eq('« M’envoyer un courriel d’essai » : une confirmation d’abord, qui dit que ce n’est jamais pour un client', [z.m.confirmations.length, z.m.confirmations[0][0], /TON compte administrateur, jamais à un client/.test(z.m.confirmations[0][1])], [1, 'Courriel d’essai ?', true]);
  eq('… UN appel « essai_courriel » sans client ni délai ; UN courriel part à l’adresse de l’administrateur, marqué « [ESSAI] »', [z.m.appels.map((a) => a.body), z.m.courriels.map((c) => [c.a, c.objet.startsWith('[ESSAI] Entretien Lapointe')])], [[{ action: 'essai_courriel' }], [['joe@exemple.ca', true]]]);
  eq('… rien n’est noté au journal ; le toast dit de regarder la boîte (et les pourriels)', [await nbJournal(), z.m.toasts.at(-1)], [0, '✔ Courriel d’essai envoyé : regarde ta boîte de réception (et les pourriels).']);
  eq('… le courriel d’essai contient un lien de désabonnement qui ne désabonne personne (page seule)', [z.m.courriels[0].lien, z.m.courriels[0].texte.includes('desabonnement.html')], ['https://www.entretienlapointe.ca/desabonnement.html', true]);
  eq('… les boutons sont libres', [z.id('av-essai').disabled, z.m.sync.at(-1)], [false, false]);
}
{
  const z = await monde();
  await z.ouvrirAvis();
  z.repondre(false);
  await z.essai();
  eq('« Annuler » : aucun appel, aucun courriel', [z.m.appels.length, z.m.courriels.length], [0, 0]);
}
{
  const z = await monde({ courrielAdmin: null });
  await z.ouvrirAvis();
  await z.essai();
  eq('un compte administrateur sans courriel : l’essai dit pourquoi, rien ne part', [z.m.toasts.at(-1), z.m.courriels.length], ['❌ Ton compte n’a pas de courriel : impossible d’envoyer un essai.', 0]);
}
{
  const z = await monde({ courrielEchec: () => 'resend 403 domain_not_verified' });
  await z.ouvrirAvis();
  await z.essai();
  eq('Resend refuse l’essai : le message du serveur est montré (sans détail technique inutile)', z.m.toasts.at(-1), '❌ Le courriel d\'essai n\'a pas pu être envoyé : resend 403 domain_not_verified');
}
{
  const z = await monde({ auth: 'Bearer employe' });
  await z.ouvrirAvis();
  await z.essai();
  eq('un compte qui n’est pas administrateur : l’essai est refusé (403), rien ne part', [z.m.toasts.at(-1), z.m.courriels.length], ['❌ Réservé à l’administrateur : reconnecte-toi, puis réessaie.', 0]);
}
{
  let liberer; const attente = new Promise((r) => { liberer = r; });
  const z = await monde({ invokeRetard: () => attente });
  await z.ouvrirAvis();
  const p1 = z.id('av-essai').onclick();
  await dormir(20);
  const p2 = z.id('av-essai').onclick();
  liberer();
  await p1; await p2;
  eq('l’essai touché deux fois : UN seul courriel', [z.m.appels.length, z.m.courriels.length], [1, 1]);
}

log('=== LA LIMITE DE 300 CLIENTS ===');
{
  const z = await monde();
  await z.ouvrirAvis();
  const fiches = Array.from({ length: 301 }, (_, i) => ({ id: 'f' + i, nom: 'Client ' + String(i).padStart(3, '0'), actif: true, avis_courriel: true, courriel: `c${i}@x.ca` }));
  const arrets = fiches.map((f, i) => ({ id: 'a' + i, route_id: 'r9', client_id: f.id, adresse: i + ' rue Test', service: 'Gazon' }));
  z.run(`clientsDonnees = ${JSON.stringify(fiches)}; stops = ${JSON.stringify(arrets)}; routes = [{id:'r9', nom:'Grande route'}]; avisSource = 'r9'; avisDelai = '3h'; avisCoches = new Set(${JSON.stringify(fiches.map((f) => f.id))}); renderClientsListe();`);
  eq('301 clients cochés : le résumé le dit et « Voir ce qui partira » est grisé (la fonction n’en accepte que 300)', [z.resume(), z.id('av-apercu').disabled], ['301 clients cochés sur 301 · passage environ 3 h · 300 au plus à la fois', true]);
  z.coche('Client 300', false);
  eq('… 300 : permis', [z.resume(), z.id('av-apercu').disabled], ['300 clients cochés sur 301 · passage environ 3 h', false]);
}

// =====================================================================
// LE JOURNAL DES AVIS (www/js/admin-avis-journal.js) : la 8ᵉ puce de l'onglet Clients, en LECTURE SEULE. Les envois sont faits par l'écran « Avis aux clients », par la vraie fonction, dans la vraie base :
// le journal les relit de la vraie table « avis_envois » (mise en forme comme le fait le service de données de Supabase).
log('=== LE JOURNAL : LES FONCTIONS PURES ===');
{
  const z = await monde();
  const f = (c) => z.run(c);
  const nomDe = `(id) => ({ a: 'Alice Courriel', b: 'Bob Texto', c: 'Carl Les Deux' })[id] || '?'`;
  const L = (o2) => ({ id: 'x', client_id: 'a', statut: 'envoye', canal: 'courriel', jour: '2026-10-14', destinataire: 'alice@exemple.ca', service: 'Gazon', adresse: '1 rue A', ...o2 });
  const lignes = [L({ id: 'l1' }), L({ id: 'l2', statut: 'refuse', client_id: 'b', destinataire: 'bob@exemple.ca' }), L({ id: 'l3', jour: '2026-10-13', statut: 'echec', client_id: 'c', canal: 'texto', destinataire: '+18195550003', service: 'Désherbage', adresse: '9 rue Zéro' }), L({ id: 'l4', jour: '2026-10-13', statut: 'en_attente' })];
  const J = JSON.stringify(lignes);
  eq('compter par statut', f(`journalCompter(${J})`), { tous: 4, envoye: 1, echec: 1, refuse: 1, en_attente: 1 });
  eq('… un statut inconnu ne compte que dans « tous » ; une liste vide ou absente : des zéros', [f(`journalCompter([{statut:'bizarre'}])`), f(`journalCompter(null)`)], [{ tous: 1, envoye: 0, echec: 0, refuse: 0, en_attente: 0 }, { tous: 0, envoye: 0, echec: 0, refuse: 0, en_attente: 0 }]);
  const filtre = (fl, rech) => f(`journalFiltrer(${J}, ${JSON.stringify(fl)}, ${JSON.stringify(rech)}, ${nomDe})`).map((l) => l.id);
  eq('filtrer par statut : tous, envoyés, échecs, refusés, en attente', [filtre('tous', ''), filtre('envoye', ''), filtre('echec', ''), filtre('refuse', ''), filtre('en_attente', '')], [['l1', 'l2', 'l3', 'l4'], ['l1'], ['l3'], ['l2'], ['l4']]);
  eq('… sans filtre : tout ; un statut inconnu : rien', [f(`journalFiltrer(${J}, undefined, '', ${nomDe})`).length, filtre('inconnu', '')], [4, []]);
  eq('chercher : le nom du client, le destinataire, le service, l’adresse (sans accents ni majuscules, chaque mot)', [filtre('tous', 'CARL'), filtre('tous', 'bob exemple'), filtre('tous', 'désherbage'), filtre('tous', '9 rue zero'), filtre('tous', 'alice charette')], [['l3'], ['l2'], ['l3'], ['l3'], []]);
  eq('… le statut et la recherche ensemble', [filtre('echec', 'carl'), filtre('envoye', 'carl')], [['l3'], []]);
  eq('grouper par jour, dans l’ordre reçu', f(`journalGrouper(${J})`).map((g) => [g.jour, g.lignes.map((l) => l.id)]), [['2026-10-14', ['l1', 'l2']], ['2026-10-13', ['l3', 'l4']]]);
  eq('… un jour qui revient plus loin fait un nouveau groupe ; rien : aucun groupe', [f(`journalGrouper([{jour:'a'},{jour:'b'},{jour:'a'}])`).map((g) => g.jour), f(`journalGrouper(null)`)], [['a', 'b', 'a'], []]);
  eq('le jour écrit en toutes lettres ; une date illisible est montrée telle quelle ; rien : vide', [f(`journalJour('2026-10-14')`), f(`journalJour('pas une date')`), f(`journalJour(null)`)], ['14 octobre 2026', 'pas une date', '']);
  const tc = (l) => f(`journalTexteCompte(${JSON.stringify(l)})`);
  eq('le texte des comptes : « 1 envoyé · 1 échec · 1 refusé · 1 en attente », les pluriels, rien', [tc(lignes), tc([L({}), L({})]), tc([L({ statut: 'echec' }), L({ statut: 'echec' })]), tc([L({ statut: 'refuse' }), L({ statut: 'refuse' })]), tc([])], ['1 envoyé · 1 échec · 1 refusé · 1 en attente', '2 envoyés', '2 échecs', '2 refusés', '']);
  const rs = (l) => f(`journalRaison(${JSON.stringify(l)})`);
  eq('la raison sous une ligne : le motif d’un refus, l’échec du fournisseur, une ligne restée « en attente » ; rien pour un envoi', [rs({ statut: 'refuse', motif: 'pas_active', canal: 'courriel' }), rs({ statut: 'refuse', motif: 'hors_heures', canal: 'texto' }), rs({ statut: 'echec', canal: 'texto' }), rs({ statut: 'en_attente' }), rs({ statut: 'envoye' })],
    ['avis par courriel non activés (case « Avertir par courriel » de la fiche)', 'texto interdit de 21 h à 6 h (heure du Québec)', 'le service de textos a refusé l’envoi', 'le résultat n’a pas été noté : le client l’a peut-être reçu', '']);
  eq('a-t-on tout lu ? oui si la page n’était pas pleine ou si le garde-fou (2 000 lignes) est atteint', [[199, 199], [0, 0], [200, 200], [200, 1800], [200, 2000], [200, 2200]].map(([p, t]) => f(`journalEstFini(${p}, ${t})`)), [true, true, false, false, true, true]);
  eq('les statuts du filtre et leurs libellés', [f('JOURNAL_STATUTS.map(s => s[0])'), f('JOURNAL_LIBELLES')], [['tous', 'envoye', 'echec', 'refuse', 'en_attente'], { envoye: 'Envoyé', echec: 'Échec', refuse: 'Refusé', en_attente: 'En attente' }]);
}

log('=== LE JOURNAL : VIDE, PUIS APRÈS UN VRAI ENVOI ===');
{
  const z = await monde();
  await z.ouvrir();
  eq('la barre de l’onglet a 8 puces : « 📒 Journal des avis » est la dernière', [z.puces().length, z.puces().at(-1).textContent], [8, '📒 Journal des avis']);
  await z.ouvrirJournal();
  eq('un journal vide : « Le journal contient 0 avis » et le message dit qu’aucun avis n’a été envoyé', [parClasse(z.zone(), 'su-resume')[0].textContent, parClasse(z.zone(), 'su-message').map((x) => x.textContent), z.journal().length], ['Le journal contient 0 avis', ['Le journal est vide : aucun avis n’a encore été envoyé.'], 0]);
  eq('les puces de statut : tous les nombres à zéro, « Tous » est choisi', [z.pucesJournal().map((b) => b.textContent), z.pucesJournal().map((b) => b.className)], [['Tous (0)', 'Envoyés (0)', 'Échecs (0)', 'Refusés (0)', 'En attente (0)'], ['su-puce on', 'su-puce', 'su-puce', 'su-puce', 'su-puce']]);
  eq('rien d’autre qu’« Actualiser » (tout est lu : pas de « Voir les suivants »)', [z.id('jr-plus'), z.id('jr-maj').textContent], [undefined, '↻ Actualiser']);
  eq('l’explication du haut : le journal ne peut être ni modifié ni effacé', parClasse(z.zone(), 'av-note')[0].textContent, 'Chaque avis envoyé (ou refusé, ou raté) est noté ici, avec le message exact. Le journal ne peut être ni modifié ni effacé : même pas par toi.');
  await cliquer(z.puce('📣 Avis aux clients'));
  z.choisirRoute('r1');
  await z.choisirDelai('3h');
  await z.apercu();
  await z.envoyer();
  await z.ouvrirJournal();
  eq('un journal déjà visité (vide) est RELU après un envoi : il montre les 3 lignes (2 envoyées, 1 refusée)', [z.lecturesJournal().length, z.journal().length], [2, 3]);
  await cliquer(z.puce('📣 Avis aux clients'));
  await z.ouvrirJournal();
  eq('… revenir sans rien envoyer ne relit PAS le journal', [z.lecturesJournal().length, z.journal().length], [2, 3]);
}

log('=== LE JOURNAL : CE QU’IL MONTRE (UN ENVOYÉ, UN ÉCHEC DU FOURNISSEUR, UN REFUSÉ) ===');
{
  const z = await pret({ courrielEchec: (c) => (c.a === 'carl@exemple.ca' ? 'resend 422 invalid_to_address' : null) });
  await z.apercu();
  await z.envoyer();
  const avant = z.lecturesJournal().length;
  await z.ouvrirJournal();
  const lec = z.lecturesJournal().slice(avant);
  eq('la lecture : UNE requête sur « avis_envois », les colonnes du journal, les plus récentes d’abord, 200 lignes à la fois', [lec.length, lec[0].cols, lec[0].ordres, lec[0].plage],
    [1, 'id,lot_id,cree_le,jour,client_id,canal,destinataire,delai,service,adresse,version_modele,objet,message,statut,motif,fournisseur_id,envoye_le,erreur', [['cree_le', 'desc'], ['id', 'asc']], [0, 199]]);
  eq('les puces de statut avec leurs nombres ; « Tous » est choisi', [z.pucesJournal().map((b) => b.textContent), z.pucesJournal().map((b) => b.className)], [['Tous (3)', 'Envoyés (1)', 'Échecs (1)', 'Refusés (1)', 'En attente (0)'], ['su-puce on', 'su-puce', 'su-puce', 'su-puce', 'su-puce']]);
  eq('le résumé et UNE section pour le jour (celui de la base : le calendrier du Québec), avec ses comptes', [parClasse(z.zone(), 'su-resume')[0].textContent, z.sections()], ['Le journal contient 3 avis', [['14 octobre 2026', '1 envoyé · 1 échec · 1 refusé']]]);
  const lignes = z.journal();
  const trie = lignes.map((l) => [l.nom, l.badge, l.classe, l.details]).sort((a, b) => a[0].localeCompare(b[0]));
  eq('les trois lignes : nom et canal, pastille (verte pour l’envoi, rouge pour l’échec et le refus), destinataire · délai · service, et la raison', trie, [
    ['Alice Courriel · ✉', 'Envoyé', 'su-badge ok', ['alice@exemple.ca · environ 3 h · Coupe de gazon et Désherbage']],
    ['Bob Texto · ✉', 'Refusé', 'su-badge retard', ['bob@exemple.ca · environ 3 h · Coupe de gazon', 'avis par courriel non activés (case « Avertir par courriel » de la fiche)']],
    ['Carl Les Deux · ✉', 'Échec', 'su-badge retard', ['carl@exemple.ca · environ 3 h · Coupe de gazon', 'le service de courriel a refusé l’envoi']]]);
  const parNom = (nom) => z.journal().find((l) => l.nom === nom);
  eq('chaque ligne a sa date (celle de l’envoi pour un envoyé, celle de la préparation pour les autres)', [parNom('Alice Courriel · ✉').date.length > 0, /2026/.test(parNom('Bob Texto · ✉').date), /2026/.test(parNom('Carl Les Deux · ✉').date)], [true, true, true]);
  // la feuille d'un avis envoyé
  await cliquer(parClasse(parNom('Alice Courriel · ✉').noeud, 'su-nom')[0]);
  const feuille = z.el('clients-feuille-corps');
  const det = () => parClasse(feuille, 'jr-detail').map((x) => x.textContent);
  vrai('toucher le nom ouvre la feuille de l’avis (titre : le nom du client)', z.feuilleOuverte() && z.el('clients-feuille-titre').textContent === 'Alice Courriel');
  const d1 = det();
  eq('… l’avis envoyé : date, canal et destinataire, délai, service, adresse, modèle de message', [/^Envoyé le .+/.test(d1[0]), d1.slice(1, 6)], [true, ['Courriel à alice@exemple.ca', 'Délai annoncé : environ 3 h', 'Service : Coupe de gazon et Désherbage', 'Adresse : 10 rue des Pins, Louiseville', 'Modèle de message : avis-2026-10-v1']]);
  eq('… l’objet et le message EXACTS (tels que le client les a reçus : le repère du lien y est)', [parClasse(feuille, 'av-objet')[0].textContent, /^Bonjour,/.test(parClasse(feuille, 'av-message')[0].textContent), parClasse(feuille, 'av-message')[0].textContent.includes('[lien de désabonnement]'), /Coupe de gazon et Désherbage/.test(parClasse(feuille, 'av-message')[0].textContent)],
    ['Objet : Entretien Lapointe : nous passons chez vous d\'ici environ 3 heures', true, true, true]);
  eq('… l’explication du repère, le numéro chez Resend, l’envoi groupé (8 caractères)', [d1[6], d1[7], /^Envoi groupé : [0-9a-f]{8}$/.test(d1[8]), d1.length], ['Au moment de l’envoi, « [lien de désabonnement] » était remplacé par le lien personnel du client.', 'Numéro chez le fournisseur (Resend) : re_1', true, 9]);
  await cliquer(parClasse(feuille, 'lf-btn')[0]);
  eq('« Fermer » referme la feuille', z.feuilleOuverte(), false);
  // la feuille de l'échec
  await cliquer(parClasse(parNom('Carl Les Deux · ✉').noeud, 'su-nom')[0]);
  const d2 = det();
  eq('… l’échec du fournisseur : la raison, l’erreur notée, PAS de numéro chez le fournisseur', [/^Échec · noté le .+/.test(d2[0]), d2[1], d2.filter((x) => /^Erreur notée/.test(x)), d2.filter((x) => /^Numéro chez/.test(x))], [true, 'Raison : le service de courriel a refusé l’envoi', ['Erreur notée : resend 422 invalid_to_address'], []]);
  // la feuille du refus
  await cliquer(parClasse(parNom('Bob Texto · ✉').noeud, 'su-nom')[0]);
  const d3 = det();
  eq('… le refus : la raison, ni erreur ni numéro chez le fournisseur', [/^Refusé · noté le .+/.test(d3[0]), d3[1], d3.filter((x) => /^Erreur notée|^Numéro chez/.test(x))], [true, 'Raison : avis par courriel non activés (case « Avertir par courriel » de la fiche)', []]);
  await cliquer(parClasse(feuille, 'lf-btn')[0]);
  // les filtres
  const puceJ = async (t) => cliquer(z.pucesJournal().find((b) => b.textContent === t));
  await puceJ('Refusés (1)');
  eq('le filtre « Refusés » : seulement Bob ; sa puce est marquée ; la section et le résumé suivent', [z.journal().map((l) => l.nom), z.pucesJournal().map((b) => b.className), z.sections(), parClasse(z.zone(), 'su-resume')[0].textContent],
    [['Bob Texto · ✉'], ['su-puce', 'su-puce', 'su-puce', 'su-puce on', 'su-puce'], [['14 octobre 2026', '1 refusé']], 'Le journal contient 3 avis · 1 affiché']);
  await puceJ('Échecs (1)');
  eq('le filtre « Échecs » : seulement Carl', z.journal().map((l) => l.nom), ['Carl Les Deux · ✉']);
  await puceJ('Envoyés (1)');
  eq('le filtre « Envoyés » : seulement Alice', z.journal().map((l) => l.nom), ['Alice Courriel · ✉']);
  await puceJ('En attente (0)');
  eq('le filtre « En attente » sans aucune ligne : « Aucun avis ne correspond. »', [z.journal().length, parClasse(z.zone(), 'su-message').map((x) => x.textContent)], [0, ['Aucun avis ne correspond.']]);
  await puceJ('Tous (3)');
  eq('« Tous » rend tout', z.journal().length, 3);
  taper(z.recherche(), 'carl');
  eq('la recherche de l’onglet filtre le journal (nom, destinataire, service, adresse)', [z.journal().map((l) => l.nom), parClasse(z.zone(), 'su-resume')[0].textContent], [['Carl Les Deux · ✉'], 'Le journal contient 3 avis · 1 affiché']);
  taper(z.recherche(), 'exemple');
  eq('… par un bout du courriel : les trois', z.journal().length, 3);
  taper(z.recherche(), 'charette');
  eq('… deux lignes sur trois : « 2 affichés » (pluriel)', [z.journal().map((l) => l.nom).sort(), parClasse(z.zone(), 'su-resume')[0].textContent], [['Bob Texto · ✉', 'Carl Les Deux · ✉'], 'Le journal contient 3 avis · 2 affichés']);
  taper(z.recherche(), 'zzz');
  eq('… rien ne correspond : un message', [z.journal().length, parClasse(z.zone(), 'su-message').map((x) => x.textContent), z.sections()], [0, ['Aucun avis ne correspond.'], []]);
  taper(z.recherche(), '');
  eq('filtrer et chercher ne relisent pas la base (une seule lecture), et RIEN n’est écrit', [z.lecturesJournal().length - avant, z.ecritures()], [1, 0]);
}

log('=== LE JOURNAL : LES TEXTOS ET UN CLIENT SANS COURRIEL ===');
{
  const z = await pret({ textos: true });
  z.coche('Gaby SansCourriel');   // « avertir par courriel » coché, mais AUCUN courriel dans sa fiche : refusé, sans destinataire
  await z.apercu();
  await z.envoyer();
  await z.ouvrirJournal();
  eq('le journal garde TOUT (aussi les refus « pas inscrit à l’autre canal ») : 8 lignes, 4 par courriel et 4 par texto', [z.journal().length, z.journal().filter((l) => l.nom.endsWith('✉')).length, z.journal().filter((l) => l.nom.endsWith('📱')).length], [8, 4, 4]);
  const parNom = (nom) => z.journal().find((l) => l.nom === nom);
  eq('le texto envoyé à Bob : pastille verte, numéro · délai · service', [parNom('Bob Texto · 📱').badge, parNom('Bob Texto · 📱').classe, parNom('Bob Texto · 📱').details], ['Envoyé', 'su-badge ok', ['+18195550002 · environ 3 h · Coupe de gazon']]);
  eq('Gaby : « aucun destinataire » et la raison', [parNom('Gaby SansCourriel · ✉').badge, parNom('Gaby SansCourriel · ✉').details], ['Refusé', ['(aucun destinataire) · environ 3 h · Coupe de gazon', 'aucun courriel dans la fiche']]);
  eq('la date d’un envoyé (l’heure réelle de l’envoi) n’est pas celle d’un refus (l’heure de la préparation)', parNom('Alice Courriel · ✉').date !== parNom('Bob Texto · ✉').date, true);
  await cliquer(parClasse(parNom('Bob Texto · 📱').noeud, 'su-nom')[0]);
  const d = parClasse(z.el('clients-feuille-corps'), 'jr-detail').map((x) => x.textContent);
  eq('la feuille d’un texto : « Texto à … », le numéro chez Twilio, PAS l’explication du lien de désabonnement ni d’objet', [d[1], d.filter((x) => /^Numéro chez/.test(x)), d.filter((x) => /lien de désabonnement/.test(x)).length, parClasse(z.el('clients-feuille-corps'), 'av-objet').length, /^Entretien Lapointe : nous passerons chez vous dans environ 3 h/.test(parClasse(z.el('clients-feuille-corps'), 'av-message')[0].textContent)],
    ['Texto à +18195550002', ['Numéro chez le fournisseur (Twilio) : SM1'], 0, 0, true]);
  await cliquer(parClasse(z.el('clients-feuille-corps'), 'lf-btn')[0]);
  await cliquer(parClasse(parNom('Gaby SansCourriel · ✉').noeud, 'su-nom')[0]);
  eq('la feuille d’un refus sans courriel : « Courriel à (aucun destinataire) »', parClasse(z.el('clients-feuille-corps'), 'jr-detail').map((x) => x.textContent)[2], 'Courriel à (aucun destinataire)');
}

log('=== LE JOURNAL : UN AVIS « EN ATTENTE » (PANNE EN PLEIN ENVOI) ===');
{
  const z = await monde();
  await z.ouvrir();
  // un envoi PRÉPARÉ dont le résultat n'a jamais été noté (la fonction s'est arrêtée en plein envoi) : deux lignes « en attente »
  const r = await z.m.deps.rpc('avis_preparer', { p_par: admin, p_delai: '3h', p_lignes: [{ client_id: ID.A, service: 'Coupe de gazon', adresse: '10 rue des Pins, Louiseville' }, { client_id: ID.C, service: 'Coupe de gazon', adresse: '5 rue Verte, Charette' }], p_canaux: ['courriel'], p_maintenant: MIDI });
  eq('(deux lignes préparées, aucune notée)', [r.error, r.data.lignes.map((l) => l.statut)], [null, ['en_attente', 'en_attente']]);
  await z.ouvrirJournal();
  eq('le journal montre « En attente » en jaune, avec la raison, et un avertissement en haut', [z.journal().map((l) => [l.badge, l.classe, l.details.at(-1)]), parClasse(z.zone(), 'av-note').map((x) => x.textContent)[1]],
    [[['En attente', 'su-badge afaire', 'le résultat n’a pas été noté : le client l’a peut-être reçu'], ['En attente', 'su-badge afaire', 'le résultat n’a pas été noté : le client l’a peut-être reçu']], '⚠ 2 avis « en attente » : l’envoi a été préparé mais son résultat n’a pas été noté (panne en plein envoi). Les clients l’ont peut-être reçu.']);
  eq('… le comptage : la puce, la section', [z.pucesJournal().map((b) => b.textContent)[4], z.sections()], ['En attente (2)', [['14 octobre 2026', '2 en attente']]]);
  await cliquer(parClasse(z.journal()[0].noeud, 'su-nom')[0]);
  eq('… la feuille d’un avis en attente : « En attente · noté le … » et la raison ; ni erreur ni numéro chez le fournisseur', [parClasse(z.el('clients-feuille-corps'), 'jr-detail').map((x) => x.textContent).slice(0, 2).map((x, i) => (i === 0 ? /^En attente · noté le .+/.test(x) : x)), parClasse(z.el('clients-feuille-corps'), 'jr-detail').filter((x) => /^Erreur notée|^Numéro chez/.test(x.textContent)).length],
    [[true, 'Raison : le résultat n’a pas été noté : le client l’a peut-être reçu'], 0]);
}

{
  // UN seul avis « en attente » : l'avertissement est au singulier
  const z = await monde();
  await z.ouvrir();
  const r = await z.m.deps.rpc('avis_preparer', { p_par: admin, p_delai: '3h', p_lignes: [{ client_id: ID.A, service: 'Coupe de gazon', adresse: '10 rue des Pins, Louiseville' }], p_canaux: ['courriel'], p_maintenant: MIDI });
  eq('(une seule ligne préparée, non notée)', [r.error, r.data.lignes.map((l) => l.statut)], [null, ['en_attente']]);
  await z.ouvrirJournal();
  eq('un seul avis « en attente » : « Le client l’a peut-être reçu » (singulier) ; la section dit « 1 en attente »', [parClasse(z.zone(), 'av-note').map((x) => x.textContent)[1], z.sections()],
    ['⚠ 1 avis « en attente » : l’envoi a été préparé mais son résultat n’a pas été noté (panne en plein envoi). Le client l’a peut-être reçu.', [['14 octobre 2026', '1 en attente']]]);
}

log('=== LE JOURNAL : BEAUCOUP DE LIGNES (200 À LA FOIS) ===');
{
  const etat = { panne: false };
  const z = await monde({ lecturePanne: (t, plage) => t === 'avis_envois' && etat.panne && plage && plage[0] === 200 });
  await z.ouvrir();
  const insererRefus = (de, a) => q(`insert into public.avis_envois (lot_id, jour, envoye_par, client_id, canal, destinataire, delai, service, adresse, version_modele, objet, message, statut, motif, cree_le)
    select gen_random_uuid(), '2026-09-01'::date, $1, $2, 'courriel', 'x' || g || '@exemple.ca', '3h', 'Coupe de gazon', '1 rue Test', 'avis-2026-10-v1', 'Objet', 'Message ' || g, 'refuse', 'pas_active', '2026-09-01T12:00:00Z'::timestamptz + (g || ' minutes')::interval
    from generate_series($3::int, $4::int) g`, [admin, ID.D, de, a]);
  await insererRefus(1, 250);
  await z.ouvrirJournal();
  eq('250 lignes dans la base : la 1ʳᵉ lecture en rend 200 (les plus récentes), le résumé et le bouton « Voir les 200 suivants » le disent', [z.journal().length, parClasse(z.zone(), 'su-resume')[0].textContent, z.id('jr-plus').textContent, z.id('jr-plus').disabled, z.lecturesJournal().map((r) => r.plage)],
    [200, 'Les 200 avis les plus récents', 'Voir les 200 suivants', false, [[0, 199]]]);
  eq('… la plus récente est en haut (x250), la 200ᵉ est x51', [z.journal()[0].details[0], z.journal()[199].details[0]], ['x250@exemple.ca · environ 3 h · Coupe de gazon', 'x51@exemple.ca · environ 3 h · Coupe de gazon']);
  await insererRefus(251, 251);   // un avis ARRIVE entre les deux lectures : la 2ᵉ page reprendra la dernière ligne de la 1ʳᵉ
  await cliquer(z.id('jr-plus'));
  await z.attendreJournal();
  eq('« Voir les 200 suivants » : la 2ᵉ page [200,399] est ajoutée, SANS doublon (la ligne reprise n’est pas affichée deux fois) ; tout est lu', [z.lecturesJournal().map((r) => r.plage), z.journal().length, z.run('new Set(journalLignes.map(l => l.id)).size'), parClasse(z.zone(), 'su-resume')[0].textContent, z.id('jr-plus')],
    [[[0, 199], [200, 399]], 250, 250, 'Le journal contient 250 avis', undefined]);
  eq('… une seule section (un seul jour) avec le compte des refusés', z.sections(), [['1 septembre 2026', '250 refusés']]);
  await cliquer(z.id('jr-maj'));
  await z.attendreJournal();
  eq('« Actualiser » relit depuis le début : la ligne arrivée entre-temps (x251) est maintenant en haut', [z.lecturesJournal().at(-1).plage, z.journal()[0].details[0], z.journal().length], [[0, 199], 'x251@exemple.ca · environ 3 h · Coupe de gazon', 200]);
  // une erreur en lisant la SUITE : les lignes déjà lues restent
  etat.panne = true;
  await cliquer(z.id('jr-plus'));
  await z.attendreJournal();
  eq('une panne de réseau en lisant la suite : les 200 lignes déjà lues RESTENT, le message est en bas, le bouton reste pour réessayer', [z.journal().length, parClasse(z.zone(), 'su-message').map((x) => x.textContent), !!z.id('jr-plus')], [200, ['📴 Pas de réseau : le journal n’a pas pu être lu.'], true]);
  etat.panne = false;
  await cliquer(z.id('jr-plus'));
  await z.attendreJournal();
  eq('… réessayer : la suite arrive, le message disparaît', [z.journal().length, parClasse(z.zone(), 'su-message').length, parClasse(z.zone(), 'su-resume')[0].textContent], [251, 0, 'Le journal contient 251 avis']);
}
{
  // deux touchers sur « Voir les suivants » : UNE seule lecture ; un « Actualiser » PENDANT la lecture : la vieille réponse est ignorée
  let liberer; let attente = null;
  const z = await monde({ lectureRetard: async () => { if (attente) await attente; } });
  await q(`insert into public.avis_envois (lot_id, jour, envoye_par, client_id, canal, destinataire, delai, service, adresse, version_modele, objet, message, statut, motif, cree_le)
    select gen_random_uuid(), '2026-09-01'::date, $1, $2, 'courriel', 'y' || g || '@exemple.ca', '3h', 'Coupe de gazon', '1 rue Test', 'avis-2026-10-v1', 'Objet', 'Message ' || g, 'refuse', 'pas_active', '2026-09-01T12:00:00Z'::timestamptz + (g || ' minutes')::interval
    from generate_series(1, 250) g`, [admin, ID.D]);
  await z.ouvrir();
  await z.ouvrirJournal();
  attente = new Promise((r) => { liberer = r; });
  const bPlus = z.id('jr-plus');
  const p1 = bPlus.onclick();
  const p2 = bPlus.onclick();
  await dormir(20);
  eq('« Voir les suivants » touché deux fois : UNE seule lecture de la 2ᵉ page', z.lecturesJournal().map((r) => r.plage), [[0, 199], [200, 399]]);
  eq('… pendant la lecture, le bouton est grisé', z.id('jr-plus').disabled, true);
  await cliquer(z.id('jr-maj'));   // « Actualiser » pendant la lecture de la 2ᵉ page
  liberer();
  await p1; await p2;
  await z.attendreJournal();
  eq('« Actualiser » pendant la lecture : la vieille réponse (2ᵉ page) est IGNORÉE, le journal est relu depuis le début : 200 lignes, pas 250', [z.journal().length, z.lecturesJournal().map((r) => r.plage), z.run('journalLignes.length')], [200, [[0, 199], [200, 399], [0, 199]], 200]);
}

log('=== LE JOURNAL : LES PANNES DE LECTURE ===');
{
  const etat = { panne: true };
  const z = await monde({ lecturePanne: (t) => t === 'avis_envois' && etat.panne });
  await z.ouvrir();
  await z.ouvrirJournal();
  eq('pas de réseau : le message et « Réessayer » ; ni liste ni puces', [parClasse(z.zone(), 'su-message').map((x) => x.textContent), z.id('jr-reessayer').textContent, z.journal().length, z.pucesJournal().length], [['📴 Pas de réseau : le journal n’a pas pu être lu.'], '↻ Réessayer', 0, 0]);
  eq('… une seule lecture a été tentée (pas de boucle)', z.lecturesJournal().length, 1);
  etat.panne = false;
  await cliquer(z.id('jr-reessayer'));
  await z.attendreJournal();
  eq('« Réessayer » : le journal se charge (vide ici)', [z.lecturesJournal().length, parClasse(z.zone(), 'su-resume')[0].textContent, z.id('jr-reessayer')], [2, 'Le journal contient 0 avis', undefined]);
}
{
  const z = await monde({ lectureErreur: (t) => (t === 'avis_envois' ? { code: 'PGRST205', message: 'Could not find the table \'public.avis_envois\' in the schema cache' } : null) });
  await z.ouvrir();
  await z.ouvrirJournal();
  eq('la table du journal absente (SQL 31 pas exécuté) : le message le dit', parClasse(z.zone(), 'su-message').map((x) => x.textContent), ['Le journal des avis n’est pas encore activé dans ta base (fichier SQL 31).']);
}
{
  const z = await monde({ lectureErreur: (t) => (t === 'avis_envois' ? { message: 'boum' } : null) });
  await z.ouvrir();
  await z.ouvrirJournal();
  eq('une autre erreur : un message général', parClasse(z.zone(), 'su-message').map((x) => x.textContent), ['❌ Impossible de lire le journal. Vérifie la connexion, puis réessaie.']);
}

{
  // rouvrir l'onglet après une panne : le journal est relu tout seul (l'erreur d'avant est effacée)
  const etat = { panne: true };
  const z = await monde({ lecturePanne: (t) => t === 'avis_envois' && etat.panne });
  await z.ouvrir();
  await z.ouvrirJournal();
  etat.panne = false;
  await z.ouvrir();
  await z.attendreJournal();
  eq('rouvrir l’onglet après une panne de lecture : le journal est relu sans toucher « Réessayer »', [parClasse(z.zone(), 'su-resume')[0]?.textContent, z.lecturesJournal().length, parClasse(z.zone(), 'su-message').map((x) => x.textContent)], ['Le journal contient 0 avis', 2, ['Le journal est vide : aucun avis n’a encore été envoyé.']]);
}
{
  // une vieille lecture qui ÉCHOUE après un « Actualiser » : son erreur est ignorée, la lecture neuve s'affiche
  const etat = { panne: false }; let liberer; let attente = null;
  const z = await monde({ lectureRetard: async () => { if (attente) await attente; }, lecturePanne: (t, plage) => t === 'avis_envois' && etat.panne && plage && plage[0] === 200 });
  await q(`insert into public.avis_envois (lot_id, jour, envoye_par, client_id, canal, destinataire, delai, service, adresse, version_modele, objet, message, statut, motif, cree_le)
    select gen_random_uuid(), '2026-09-01'::date, $1, $2, 'courriel', 'z' || g || '@exemple.ca', '3h', 'Coupe de gazon', '1 rue Test', 'avis-2026-10-v1', 'Objet', 'Message ' || g, 'refuse', 'pas_active', '2026-09-01T12:00:00Z'::timestamptz + (g || ' minutes')::interval
    from generate_series(1, 250) g`, [admin, ID.D]);
  await z.ouvrir();
  await z.ouvrirJournal();
  attente = new Promise((r) => { liberer = r; });
  etat.panne = true;
  const p = z.id('jr-plus').onclick();
  await dormir(20);
  await cliquer(z.id('jr-maj'));
  liberer();
  await p;
  await z.attendreJournal();
  eq('une vieille lecture (2ᵉ page) qui échoue APRÈS un « Actualiser » : son erreur est ignorée ; la lecture neuve (200 lignes) s’affiche sans message', [z.journal().length, parClasse(z.zone(), 'su-message').length, z.run('journalErreur')], [200, 0, '']);
}
{
  const absentes = [['le code PGRST205 seul', { code: 'PGRST205', message: '' }], ['le code 42P01 seul', { code: '42P01', message: '' }], ['le message « does not exist » seul', { message: 'relation "public.avis_envois" does not exist' }], ['le message « schema cache » seul', { message: "Could not find the table 'public.avis_envois' in the schema cache" }]];
  for (const [nom, err] of absentes) {
    const z = await monde({ lectureErreur: (t) => (t === 'avis_envois' ? err : null) });
    await z.ouvrir();
    await z.ouvrirJournal();
    eq('la table du journal absente est reconnue par ' + nom, parClasse(z.zone(), 'su-message').map((x) => x.textContent), ['Le journal des avis n’est pas encore activé dans ta base (fichier SQL 31).']);
  }
  const z = await monde({ lectureErreur: (t) => (t === 'avis_envois' ? { message: "Could not find the table 'public.autre_table' in the schema cache" } : null) });
  await z.ouvrir();
  await z.ouvrirJournal();
  eq('… une table ABSENTE qui n’est pas le journal : message général (pas « journal pas activé »)', parClasse(z.zone(), 'su-message').map((x) => x.textContent), ['❌ Impossible de lire le journal. Vérifie la connexion, puis réessaie.']);
}

log('=== LE JOURNAL : ACTUALISER, ROUVRIR L’ONGLET ===');
{
  const z = await monde();
  await z.ouvrir();
  await z.ouvrirJournal();
  await cliquer(z.id('jr-maj'));
  await z.attendreJournal();
  eq('« ↻ Actualiser » relit le journal', z.lecturesJournal().length, 2);
  await z.ouvrir();   // l'onglet est rouvert (ou « Actualiser » du répertoire) : le journal affiché est relu
  await z.attendreJournal();
  eq('rouvrir l’onglet Clients relit aussi le journal (la puce « Journal » est restée choisie)', [z.run('clientsFiltre'), z.lecturesJournal().length], ['journal', 3]);
  await cliquer(z.puce('Tous'));
  await cliquer(z.puce('📒 Journal des avis'));
  await z.attendreJournal();
  eq('quitter la puce et y revenir sans rien changer : pas de nouvelle lecture', z.lecturesJournal().length, 3);
}

log('=== LE JOURNAL : LECTURE SEULE ===');
{
  const src = lire('js/admin-avis-journal.js').replace(/\/\/.*$/gm, '');
  eq('le fichier n’écrit nulle part et n’appelle aucune fonction SQL ; sa seule table est « avis_envois »', [/\.insert\(|\.update\(|\.upsert\(|\.rpc\(|\.functions\b/.test(src), [...src.matchAll(/db\.from\('([a-z_]+)'\)/g)].map((x) => x[1])], [false, ['avis_envois']]);
  eq('… aucun texte de la base n’est mis dans du HTML', [/innerHTML\s*=\s*[^'\s]|innerHTML\s*=\s*'[^']/.test(src)], [false]);
  const colonnes = z0colonnes(src);
  const reelles = (await q(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'avis_envois'`)).map((x) => x.column_name);
  eq('les colonnes lues existent TOUTES dans la vraie table (et « envoye_par » n’est pas lue : inutile)', [colonnes.filter((c) => !reelles.includes(c)), colonnes.includes('envoye_par'), colonnes.length], [[], false, 18]);
  const html = fs.readFileSync(WWW + 'index.html', 'utf8');
  const i1 = html.indexOf('js/admin-clients.js'), i2 = html.indexOf('js/admin-avis.js'), i3 = html.indexOf('js/admin-avis-journal.js');
  eq('index.html charge admin-avis-journal.js, APRÈS admin-avis.js (qui vient après admin-clients.js)', [i1 > 0, i2 > i1, i3 > i2, (html.match(/js\/admin-avis-journal\.js/g) || []).length], [true, true, true, 1]);
  const css = fs.readFileSync(WWW + 'css/style.css', 'utf8');
  eq('le style : les puces de statut qui passent à la ligne, les lignes de détail de la feuille', [/#jr-puces\{[^}]*flex-wrap:wrap/.test(css), /\.jr-detail\{[^}]*overflow-wrap:anywhere/.test(css)], [true, true]);
}
// (les colonnes de JOURNAL_COLONNES, lues dans le texte du fichier)
function z0colonnes(src) { const m = /JOURNAL_COLONNES='([^']+)'/.exec(src); return m ? m[1].split(',') : []; }

// =====================================================================
// L'ACTIVATION EN BLOC de « Avertir par courriel » (admin-avis.js) : la SEULE écriture de l'écran. Décision de Joé (2 oct. 2026) : ses clients ont tous un contrat de service avec lui et les avis ne sont que de
// l'information sur ce service. Garde-fous : jamais un client désabonné (même si l'écran est périmé : la requête elle-même l'exclut), jamais une fiche archivée, jamais un client sans courriel valide ; par paquets de 50.
// (Ces essais créent des fiches de plus dans la copie de la base : ils sont donc LES DERNIERS du fichier.)
log('=== L’ACTIVATION EN BLOC : LES FONCTIONS PURES ===');
{
  const z = await monde();
  const f = (c) => z.run(c);
  const F = (id, o2 = {}) => ({ id, actif: true, courriel: id + '@exemple.ca', avis_courriel: false, desabonne_courriel_le: null, ...o2 });
  const fiches = [F('a'), F('b', { avis_courriel: true }), F('c', { desabonne_courriel_le: HIER }), F('d', { desabonne_courriel_le: HIER, avis_courriel: true }), F('e', { courriel: null }), F('e2', { courriel: '   ' }), F('g', { courriel: 'pas-un-courriel' }),
    F('h', { actif: false }), F('i'), F('j', { courriel: 'x'.repeat(150) + '@e.ca' })];
  const r = f(`avisActivables(${JSON.stringify(['a', 'b', 'c', 'd', 'e', 'e2', 'g', 'h', 'i', 'j', 'inconnu'])}, ${JSON.stringify(fiches)})`);
  eq('qui peut être activé : une fiche active, avec un courriel valide, pas désabonnée, pas déjà activée (a, i)', r.ids, ['a', 'i']);
  eq('… le reste est compté par raison : 1 déjà activé, 2 désabonnés (même la case décochée, même la case cochée), 2 sans courriel (absent, blancs), 2 au courriel illisible (sans @, trop long)', [r.deja, r.desabonnes, r.sansCourriel, r.courrielIllisible], [1, 2, 2, 2]);
  eq('… une fiche archivée ou inconnue n’est comptée nulle part', r.deja + r.desabonnes + r.sansCourriel + r.courrielIllisible + r.ids.length, 9);
  eq('… la liste est vide ou absente : rien', [f(`avisActivables([], ${JSON.stringify(fiches)}).ids`), f(`avisActivables(null, null).ids`)], [[], []]);
  eq('un désabonné n’est JAMAIS activable : même avec un courriel valide et la case décochée', f(`avisActivables(['c'], ${JSON.stringify(fiches)}).ids`), []);
  const t = (a) => f(`avisTexteIgnores(${JSON.stringify(a)})`);
  eq('le texte des ignorés : « 2 désabonnés (jamais réactivés) · 1 sans courriel · 1 avec un courriel illisible · 3 déjà activés » ; les singuliers ; rien', [t({ desabonnes: 2, sansCourriel: 1, courrielIllisible: 1, deja: 3 }), t({ desabonnes: 1, deja: 1 }), t({})],
    ['2 désabonnés (jamais réactivés) · 1 sans courriel · 1 avec un courriel illisible · 3 déjà activés', '1 désabonné (jamais réactivé) · 1 déjà activé', '']);
  const mm = (c) => f(c);
  eq('le message après l’activation : « Avis par courriel activé pour 2 clients » (ou 1 client)', [mm(`avisMessageActivation({faites:new Set(['a','b'])}, 2)`), mm(`avisMessageActivation({faites:new Set(['a'])}, 1)`)], ['✔ Avis par courriel activé pour 2 clients.', '✔ Avis par courriel activé pour 1 client.']);
  eq('… moins de fiches que prévu (refus sans erreur, ou fiche changée entre-temps) : le dit', mm(`avisMessageActivation({faites:new Set(['a']), refus:true}, 3)`), '⚠ Seulement 1 sur 3 ont changé : certaines fiches ont été modifiées entre-temps (la liste est relue).');
  eq('… pas de réseau : « rien n’a été changé » si rien n’est passé, sinon combien l’ont été', [mm(`avisMessageActivation({faites:new Set(), erreur:new TypeError('Failed to fetch')}, 2)`), mm(`avisMessageActivation({faites:new Set(['a','b']), erreur:new TypeError('Failed to fetch')}, 5)`)],
    ['📴 Pas de réseau : rien n’a été changé.', '📴 Pas de réseau : 2 sur 5 activés ; la liste est relue, puis réessaie.']);
  eq('… une autre erreur : le message du serveur, et combien étaient passés', [mm(`avisMessageActivation({faites:new Set(), erreur:{message:'boum'}}, 4)`), mm(`avisMessageActivation({faites:new Set(['a']), erreur:{message:'boum'}}, 4)`), mm(`avisMessageActivation({faites:new Set(), erreur:{}}, 4)`)],
    ['❌ L’activation a échoué : boum.', '❌ L’activation a échoué après 1 sur 4 : boum.', '❌ L’activation a échoué.']);
  eq('l’activation se fait par paquets de 50', f('AVIS_ACTIVER_PAQUET'), 50);
}

log('=== L’ACTIVATION EN BLOC : LE BOUTON, LA CONFIRMATION, L’ÉCRITURE (VRAIE BASE), PUIS L’APERÇU ===');
const remettre = async () => {   // remet les fiches de ces essais dans leur état de départ
  await q(`update public.clients set avis_courriel = false where id in ($1, $2) or nom like 'Bulk %'`, [ID.B, ID.D]);
  await q(`update public.clients set desabonne_courriel_le = null where id = $1`, [ID.D]);
};
const etatFiches = async () => Object.fromEntries((await q(`select nom, avis_courriel, desabonne_courriel_le is not null as desabonne from public.clients where nom not like 'Bulk %' order by nom`)).map((x) => [x.nom, x.avis_courriel + (x.desabonne ? ':désabonné' : '')]));
{
  // deux fiches de plus : un client DÉSABONNÉ dont la case est décochée (il ne doit JAMAIS être réactivé) et un client sans courriel
  ID.J = await fiche('Jules Désabonné', { courriel: 'jules@exemple.ca', avis_courriel: false, desabonne_courriel_le: HIER });
  ID.K = await fiche('Karine SansCourriel');
  const arrets = () => [...STOPS(), arret('s20', 'r1', ID.J, '40 rue Verte, Charette', 'Coupe de gazon'), arret('s21', 'r1', ID.K, '41 rue Verte, Charette', 'Coupe de gazon')];
  const depart = { 'Alice Courriel': 'true', 'Bob Texto': 'false', 'Carl Les Deux': 'true', 'Diane Rien': 'false', 'Eric Parti': 'true:désabonné', 'Gaby SansCourriel': 'true', 'Hélène Archivée': 'true', 'Jules Désabonné': 'false:désabonné', 'Karine SansCourriel': 'false' };
  eq('(l’état de départ des fiches)', await etatFiches(), depart);
  const z = await pret({ arrets: arrets() });
  eq('route Nord : 8 clients ; cochés d’office : Alice, Bob, Carl (leur fiche permet un avis) ; le bouton d’activation compte Bob (courriel valide, case décochée) : « pour 1 client coché »', [z.clients().length, z.clients().filter((c) => c.coche).map((c) => c.nom), z.id('av-activer').textContent], [8, ['Alice Courriel', 'Bob Texto', 'Carl Les Deux'], '✉ Activer l’avis par courriel pour 1 client coché']);
  await cliquer(z.id('av-tout'));
  eq('« Tout cocher » : 8 clients ; le bouton compte Bob et Diane (les seuls dont la case est décochée, avec un courriel valide, sans désabonnement)', [z.clients().filter((c) => c.coche).length, z.id('av-activer').textContent, z.id('av-activer').disabled], [8, '✉ Activer l’avis par courriel pour 2 clients cochés', false]);
  eq('le bouton est entre « Voir ce qui partira » et le courriel d’essai', parClasse(z.id('av-bas'), 'su-actions')[0].children.map((b) => b.id), ['av-apercu', 'av-activer', 'av-essai']);
  z.repondre(false);
  await cliquer(z.id('av-activer'));
  eq('la confirmation dit combien de fiches, ce que ça change, et ce qui est IGNORÉ (désabonnés jamais réactivés, sans courriel, déjà activés)', z.m.confirmations[0], [
    'Activer l’avis par courriel ?',
    'La case « Avertir par courriel » sera cochée dans les fiches de 2 clients : ils recevront les avis de passage par courriel (le texte approuvé, avec le lien « Se désabonner »). Tu pourras la décocher fiche par fiche. Ignorés : 2 désabonnés (jamais réactivés) · 2 sans courriel · 2 déjà activés.',
    'Activer', 'Annuler']);
  eq('« Annuler » : AUCUNE écriture, la base n’a pas changé, le bouton est toujours là', [z.m.requetes.filter((r) => r.op === 'update').length, await etatFiches(), !!z.id('av-activer')], [0, depart, true]);
  z.repondre(true);
  await cliquer(z.id('av-activer'));
  const maj = z.m.requetes.filter((r) => r.op === 'update');
  eq('« Activer » : UNE requête, sur « clients », qui n’écrit que « avis_courriel » ; elle ne vise que Bob et Diane, les fiches ACTIVES et NON désabonnées DE LA BASE', [maj.length, maj[0].table, maj[0].valeur, maj[0].filtres, maj[0].cols],
    [1, 'clients', { avis_courriel: true }, [['in', 'id', [ID.B, ID.D]], ['eq', 'actif', true], ['is', 'desabonne_courriel_le', null]], 'id']);
  eq('la VRAIE base : Bob et Diane sont activés ; personne d’autre n’a changé (le désabonné Jules reste décoché et désabonné)', await etatFiches(), { ...depart, 'Bob Texto': 'true', 'Diane Rien': 'true' });
  eq('l’écran : « Avis par courriel activé pour 2 clients », l’indicateur est éteint, le bouton a disparu (plus rien à activer), l’écran est libre', [z.m.toasts.at(-1), z.m.sync.at(-1), z.id('av-activer'), z.id('av-apercu').disabled, z.id('av-essai').disabled], ['✔ Avis par courriel activé pour 2 clients.', false, undefined, false, false]);
  eq('… la liste montre maintenant ce que les fiches permettent (Bob : courriel et texto ; Diane : courriel)', [z.clients().find((c) => c.nom === 'Bob Texto').canaux, z.clients().find((c) => c.nom === 'Diane Rien').canaux], ['✉ courriel · 📱 texto', '✉ courriel']);
  eq('… les cases cochées restent cochées ; l’application n’a rien écrit d’autre (aucun appel à la fonction d’envoi, rien au journal)', [z.clients().filter((c) => c.coche).length, z.m.appels.length, await nbJournal(), z.m.rpcApp.length], [8, 0, 0, 0]);
  await z.apercu();
  const b = z.boite('av-apercu-boite');
  eq('l’aperçu RÉEL ensuite : 4 courriels partiraient (Alice, Bob, Carl et Diane, maintenant activés) ; les 4 autres sont refusés avec leur raison (les désabonnés restent désabonnés)', [parClasse(b, 'av-resume')[0].textContent, z.lignes(b).map((l) => [l.nom, l.badge, l.details.at(-1)])], [
    '✔ 4 courriels — passage environ 3 h', [
      ['Alice Courriel · ✉', 'Partira', '→ alice@exemple.ca · toucher le nom pour lire le message'], ['Bob Texto · ✉', 'Partira', '→ bob@exemple.ca · toucher le nom pour lire le message'],
      ['Carl Les Deux · ✉', 'Partira', '→ carl@exemple.ca · toucher le nom pour lire le message'], ['Diane Rien · ✉', 'Partira', '→ diane@exemple.ca · toucher le nom pour lire le message'],
      ['Eric Parti · ✉', 'Refusé', 'désabonné des courriels'], ['Gaby SansCourriel · ✉', 'Refusé', 'aucun courriel dans la fiche'], ['Jules Désabonné · ✉', 'Refusé', 'désabonné des courriels'],
      ['Karine SansCourriel · ✉', 'Refusé', 'avis par courriel non activés (case « Avertir par courriel » de la fiche)']]]);
  eq('… l’aperçu n’a rien écrit au journal', await nbJournal(), 0);
  await remettre();
}
{
  // un aperçu déjà affiché ne vaut plus après l'activation ; le bouton n'est offert que s'il y a quelque chose à activer
  const z = await pret();
  z.coche('Diane Rien');
  await z.apercu();
  eq('(un aperçu est affiché ; Diane est cochée et activable)', [!!z.boite('av-apercu-boite'), z.id('av-activer').textContent], [true, '✉ Activer l’avis par courriel pour 2 clients cochés']);
  await cliquer(z.id('av-activer'));
  eq('après l’activation, l’aperçu d’avant disparaît (il ne dit plus la vérité)', [z.boite('av-apercu-boite'), z.id('av-envoyer'), z.m.toasts.at(-1)], [undefined, undefined, '✔ Avis par courriel activé pour 2 clients.']);
  await remettre();
}
{
  const z = await monde();
  await z.ouvrirAvis();
  eq('sans route choisie : pas de bouton d’activation', z.id('av-activer'), undefined);
  z.choisirRoute('r1');
  z.run('avisCoches = new Set(); renderClientsListe();');
  eq('aucun client coché : pas de bouton', z.id('av-activer'), undefined);
  z.coche('Alice Courriel');
  z.coche('Carl Les Deux');
  eq('seulement des clients déjà activés : pas de bouton', z.id('av-activer'), undefined);
  z.coche('Eric Parti');
  z.coche('Gaby SansCourriel');
  eq('… ni pour un désabonné, ni pour une fiche sans courriel', z.id('av-activer'), undefined);
  z.coche('Diane Rien');
  eq('… un client activable coché : le bouton revient, au singulier', z.id('av-activer').textContent, '✉ Activer l’avis par courriel pour 1 client coché');
  const vieux = z.id('av-activer');
  z.coche('Diane Rien', false);
  const avant = z.m.confirmations.length;
  await cliquer(vieux);
  eq('un « Activer » resté à l’écran alors que plus rien n’est activable : un toucher ne fait RIEN (ni confirmation, ni écriture)', [z.id('av-activer'), z.m.confirmations.length - avant, z.m.requetes.filter((r) => r.op === 'update').length], [undefined, 0, 0]);
  z.coche('Diane Rien');
  z.run(`avisSource = '__main__'; renderClientsListe();`);
  eq('« à la main » : le même bouton (Diane est toujours cochée)', z.id('av-activer')?.textContent, '✉ Activer l’avis par courriel pour 1 client coché');
  await z.repondre(true);
  await cliquer(z.id('av-activer'));
  eq('une activation d’un seul client : la confirmation est au singulier (« la fiche de 1 client : il recevra »), avec les ignorés', z.m.confirmations[0][1], 'La case « Avertir par courriel » sera cochée dans la fiche de 1 client : il recevra les avis de passage par courriel (le texte approuvé, avec le lien « Se désabonner »). Tu pourras la décocher dans sa fiche. Ignorés : 1 désabonné (jamais réactivé) · 1 sans courriel · 2 déjà activés.');
  eq('… et le message de réussite aussi', z.m.toasts.at(-1), '✔ Avis par courriel activé pour 1 client.');
  await remettre();
}

log('=== L’ACTIVATION EN BLOC : PROTECTION, PANNES, REFUS, DEUX TOUCHERS ===');
{
  // LA LISTE À L'ÉCRAN EST PÉRIMÉE : Diane s'est désabonnée (par le lien d'un courriel) après la lecture du répertoire ; la requête ne la touche PAS
  const z = await pret();
  z.coche('Diane Rien');
  await q(`update public.clients set desabonne_courriel_le = now() where id = $1`, [ID.D]);
  await cliquer(z.id('av-activer'));
  eq('une fiche désabonnée ENTRE-TEMPS (l’écran ne le sait pas) n’est PAS réactivée : la base refuse de la toucher, l’écran le dit', [await etatFiches().then((e) => [e['Bob Texto'], e['Diane Rien']]), z.m.toasts.at(-1)],
    [['true', 'false:désabonné'], '⚠ Seulement 1 sur 2 ont changé : certaines fiches ont été modifiées entre-temps (la liste est relue).']);
  eq('… la liste est relue (la fiche de Diane est maintenant « désabonnée » à l’écran) : plus rien à activer', [z.m.requetes.filter((r) => r.table === 'clients' && r.op === 'select').length, z.id('av-activer')], [2, undefined]);
  await remettre();
}
{
  const z = await pret({ majRefus: true });
  z.coche('Diane Rien');
  await cliquer(z.id('av-activer'));
  eq('les règles d’accès refusent SANS erreur (aucune ligne changée) : « Seulement 0 sur 2 ont changé », la liste est relue, rien n’a changé, le bouton reste', [z.m.toasts.at(-1), z.m.requetes.filter((r) => r.table === 'clients' && r.op === 'select').length, (await etatFiches())['Diane Rien'], z.id('av-activer').textContent],
    ['⚠ Seulement 0 sur 2 ont changé : certaines fiches ont été modifiées entre-temps (la liste est relue).', 2, 'false', '✉ Activer l’avis par courriel pour 2 clients cochés']);
}
{
  const z = await pret({ majPanne: () => true });
  z.coche('Diane Rien');
  await cliquer(z.id('av-activer'));
  eq('pas de réseau : « rien n’a été changé », la base n’a pas changé, la liste est relue, l’écran est libre', [z.m.toasts.at(-1), (await etatFiches())['Diane Rien'], z.m.requetes.filter((r) => r.table === 'clients' && r.op === 'select').length, z.id('av-activer').disabled, z.m.sync.at(-1)],
    ['📴 Pas de réseau : rien n’a été changé.', 'false', 2, false, false]);
}
{
  const z = await pret({ majErreur: () => ({ message: 'boum' }) });
  z.coche('Diane Rien');
  await cliquer(z.id('av-activer'));
  eq('une erreur du serveur : son message est montré ; rien n’a changé', [z.m.toasts.at(-1), (await etatFiches())['Diane Rien']], ['❌ L’activation a échoué : boum.', 'false']);
}
{
  // DEUX TOUCHERS : une seule confirmation, une seule écriture ; boutons grisés pendant l'écriture
  let liberer; const attente = new Promise((r) => { liberer = r; });
  const z = await pret({ majRetard: () => attente });
  z.coche('Diane Rien');
  const bouton = z.id('av-activer');
  const p1 = bouton.onclick();
  const p2 = bouton.onclick();
  await dormir(20);
  eq('« Activer » touché deux fois : UNE confirmation, UNE écriture ; pendant l’écriture, les boutons sont grisés et l’indicateur allumé', [z.m.confirmations.length, z.m.requetes.filter((r) => r.op === 'update').length, z.id('av-activer').disabled, z.id('av-apercu').disabled, z.id('av-essai').disabled, z.m.sync.at(-1)],
    [1, 1, true, true, true, true]);
  liberer();
  await p1; await p2;
  eq('… après : une seule écriture, la base est à jour, tout est libre', [z.m.requetes.filter((r) => r.op === 'update').length, (await etatFiches())['Diane Rien'], z.id('av-apercu').disabled, z.m.sync.at(-1)], [1, 'true', false, false]);
  await remettre();
}

log('=== L’ACTIVATION EN BLOC : BEAUCOUP DE CLIENTS (PAR PAQUETS DE 50) ===');
{
  await q(`insert into public.clients (nom, adresse, courriel) select 'Bulk ' || lpad(g::text, 3, '0'), g || ' rue Bulk', 'bulk' || g || '@exemple.ca' from generate_series(1, 120) g`);
  const bulk = await q(`select id, nom, adresse from public.clients where nom like 'Bulk %' order by nom`);
  const arrets = bulk.map((c, i) => arret('b' + i, 'r1', c.id, c.adresse + ', Charette', 'Coupe de gazon'));
  const nbActifs = async () => (await q(`select count(*)::int n from public.clients where nom like 'Bulk %' and avis_courriel`))[0].n;
  const z = await pret({ arrets });
  await cliquer(z.id('av-tout'));
  eq('120 clients à courriel valide, cases décochées : cochés tous, le bouton en compte 120 (aucune limite de 300 pour l’activation)', [z.clients().filter((c) => c.coche).length, z.id('av-activer').textContent], [120, '✉ Activer l’avis par courriel pour 120 clients cochés']);
  await cliquer(z.id('av-activer'));
  const maj = z.m.requetes.filter((r) => r.op === 'update');
  eq('l’activation se fait en TROIS requêtes (50, 50 et 20 fiches)', maj.map((r) => r.filtres[0][2].length), [50, 50, 20]);
  eq('… tout est activé dans la base (120), sans oubli ni doublon dans les paquets', [await nbActifs(), new Set(maj.flatMap((r) => r.filtres[0][2])).size, z.m.toasts.at(-1)], [120, 120, '✔ Avis par courriel activé pour 120 clients.']);
  await remettre();
  const z2 = await pret({ arrets, majPanne: (n) => n === 2 });
  await cliquer(z2.id('av-tout'));
  await cliquer(z2.id('av-activer'));
  eq('une panne de réseau à la 2ᵉ requête : le 1ᵉʳ paquet (50) est passé, le reste non ; l’écran dit combien et relit la liste', [await nbActifs(), z2.m.requetes.filter((r) => r.op === 'update').length, z2.m.toasts.at(-1), z2.m.requetes.filter((r) => r.table === 'clients' && r.op === 'select').length],
    [50, 2, '📴 Pas de réseau : 50 sur 120 activés ; la liste est relue, puis réessaie.', 2]);
  eq('… après la relecture, le bouton propose les 70 restants (réessayer ne refait pas les 50)', z2.id('av-activer').textContent, '✉ Activer l’avis par courriel pour 70 clients cochés');
  await remettre();
}

log('=== L’ÉCRAN N’ÉCRIT QUE L’ACTIVATION EN BLOC ===');
{
  const src = lire('js/admin-avis.js').replace(/\/\/.*$/gm, '');
  const acces = [...src.matchAll(/db\.from\('([a-z_]+)'\)\.(\w+)\(([^)]*)\)/g)].map((x) => x.slice(1, 4).join(':'));
  eq('le fichier n’écrit QUE « avis_courriel » dans « clients » (l’activation en bloc) : aucun autre accès aux tables, aucun insert, upsert ni delete, aucune fonction SQL (rpc)', [acces, /\.insert\(|\.upsert\(|\.rpc\(|\.delete\(\)/.test(src)], [['clients:update:{avis_courriel:true}'], false]);
  eq('… cette écriture exclut les fiches archivées et les clients désabonnés (filtres de la requête), et se fait par paquets', [/\.in\('id',paquet\)\.eq\('actif',true\)\.is\('desabonne_courriel_le',null\)/.test(src), /ids\.slice\(i,i\+AVIS_ACTIVER_PAQUET\)/.test(src)], [true, true]);
  eq('… son seul accès au serveur est la fonction « envoyer-avis »', [(src.match(/functions\.invoke\(/g) || []).length, /functions\.invoke\('envoyer-avis'/.test(src)], [1, true]);
  const corps = [...src.matchAll(/avisAppeler\((\{[^)]*\})\)/g)].map((x) => x[1]);
  eq('… ses trois demandes (aperçu, envoi, essai) ne mentionnent jamais de « canaux » : c’est la fonction qui décide', [corps.length, corps.some((c) => /canaux/.test(c))], [3, false]);
  eq('… il ne met RIEN en file d’attente hors réseau (aucun appel à la file des gestes)', [/fileAttente|ajouterGeste|enfiler|queue/i.test(src)], [false]);
  eq('… aucun texte de la base n’est mis dans du HTML (jamais « innerHTML = texte »)', [/innerHTML\s*=\s*[^'\s]|innerHTML\s*=\s*'[^']/.test(src)], [false]);
  eq('… il ne contient aucun texte de message à un client (la base les fabrique) ni clé secrète', [/nous passons chez vous d['’]ici|Merci de ramasser/.test(src.replace(/« nous passons chez vous '\+/g, '')), /\bre_[A-Za-z0-9]{20,}|\bAC[0-9a-f]{32}\b|eyJ[A-Za-z0-9_-]{20,}/.test(src)], [false, false]);
  const html = fs.readFileSync(WWW + 'index.html', 'utf8');
  const i1 = html.indexOf('js/admin-clients.js'), i2 = html.indexOf('js/admin-avis.js');
  eq('index.html charge admin-avis.js, APRÈS admin-clients.js', [i1 > 0, i2 > i1, (html.match(/js\/admin-avis\.js/g) || []).length], [true, true, 1]);
  const css = fs.readFileSync(WWW + 'css/style.css', 'utf8');
  eq('le style : la boîte de l’aperçu, le message (sauts de ligne gardés), les boutons du haut de liste', [/\.av-boite\{/.test(css), /\.av-message\{[^}]*white-space:pre-wrap/.test(css), /\.av-outils \.lf-btn\{[^}]*background:#161c24/.test(css)], [true, true, true]);
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
