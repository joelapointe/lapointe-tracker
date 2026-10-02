// Demande 5, chantier D, étape 1 (1ᵉʳ oct. 2026) — L'ONGLET « CLIENTS » du panneau administrateur : le RÉPERTOIRE (www/js/admin-clients.js et ses branchements : admin.js, index.html, css/style.css).
// Décisions : réservé à l'ADMINISTRATEUR ; lecture et écriture directes sur la table « clients » ; le consentement (avis_texto, désabonnements) n'est JAMAIS écrit d'ici ; archiver au lieu d'effacer ;
// changer le cellulaire d'une fiche inscrite aux textos annule l'inscription (le serveur le fait : l'écran prévient avant) ; aucun avis n'est jamais activé par cet écran sauf « avertir par courriel » choisi par Joé.
// Les VRAIS fichiers de l'application sont chargés dans un faux navigateur (faux document, horloge fixe) avec un FAUX Supabase qui note chaque requête. Ce que ce test ne peut PAS vérifier : les règles d'accès
// réelles de la table (fichier SQL 30, déjà essayé séparément) et l'aspect réel de l'écran (essayé à part dans un vrai navigateur).
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
const F = (id, nom, o = {}) => ({ id, nom, nom_entreprise: null, type_client: 'particulier', adresse: null, ville: null, code_postal: null, courriel: null, telephone: null, cellulaire: null,
  avis_courriel: false, avis_texto: false, desabonne_courriel_le: null, desabonne_texto_le: null, desabonne_promo_le: null, notes: null, actif: true, ...o });
const FICHES = () => [
  F('c1', 'Claude Lafreniere', { adresse: '100 rue Boisjoli', ville: 'Saint-Boniface', telephone: '819-535-3086' }),
  F('c2', 'Hubert Kamdem', { adresse: '2029 rue billeron', ville: 'St-Laurent', courriel: 'kamtchom@yahoo.fr', telephone: '514-892-4121' }),
  F('c3', 'Côme Garceau', { adresse: '930 Chemin Bellevue', ville: 'Saint-Boniface' }),
  F('c4', 'Zedbed', { nom_entreprise: 'Zedbed inc.', adresse: '5352 Rue Burrill', ville: 'Shawinigan', courriel: 'rsile@zedbed.com', telephone: '819-539-1112', avis_courriel: true }),
  F('c5', 'Marie Inscrite', { adresse: '1 rue A', ville: 'Charette', courriel: 'm@x.ca', cellulaire: '+18195551234', avis_texto: true }),
  F('c6', 'Paul Parti', { adresse: '2 rue B', ville: 'Charette', courriel: 'p@x.ca', cellulaire: '+18195559999', avis_courriel: true, avis_texto: true, desabonne_texto_le: '2026-09-30T12:00:00Z', desabonne_courriel_le: '2026-09-30T12:00:00Z' }),
  F('c7', 'Vieille Fiche', { adresse: '3 rue C', ville: 'Charette', telephone: '819-555-0000', actif: false }),
];
const ARRETS = () => [
  { id: 's1', adresse: '100 rue boisjoli, saint-boniface', client: 'Claude Lafreniere', service: 'Coupe de gazon', actif: true, client_id: 'c1' },
  { id: 's2', adresse: '100 rue boisjoli, saint-boniface', client: 'Claude Lafreniere', service: 'Déneigement', actif: true, client_id: 'c1' },
  { id: 's3', adresse: '5352 rue burrill, shawinigan', client: 'ZedBed', service: 'Coupe de gazon', actif: true, client_id: 'c4' },
  { id: 's4', adresse: 'sans fiche', client: 'X', service: 'Coupe de gazon', actif: true, client_id: null },
  { id: 's5', adresse: '2 rue B, charette', client: 'Paul', service: 'Coupe de gazon', actif: false, client_id: 'c6' },   // un arrêt archivé ne compte pas
  // les arrêts SANS fiche (étape 2) : une adresse à deux services, une rue écrite « st-boniface », un nom seul, rien du tout
  { id: 's6', adresse: '930 ch. Bellevue, saint-boniface', client: 'Côme Garceau', service: 'Coupe de gazon', actif: true, client_id: null },
  { id: 's7', adresse: '930 ch. Bellevue, saint-boniface', client: 'Côme Garceau', service: 'Déneigement', actif: true, client_id: null },
  { id: 's8', adresse: '100 rue boisjoli, st-boniface', client: 'Voisin Test', service: 'Coupe de gazon', actif: true, client_id: null },
  { id: 's9', adresse: '7 rue Inconnue, Ville', client: 'Zedbed', service: 'Coupe de gazon', actif: true, client_id: null },
  { id: 's10', adresse: '8 rue Seule, Ville', client: '', service: 'Coupe de gazon', actif: true, client_id: null },
];

const INSC = () => [
  { id: 'i1', nom: 'Claude Lafreniere', adresse: '100 rue Boisjoli, Saint-Boniface', cellulaire: '+18195353086', courriel: null, promo_accepte: false, statut: 'nouvelle', client_id: null, cree_le: '2026-09-30T12:00:00Z', traitee_le: null },
  { id: 'i2', nom: 'Nouvelle Personne', adresse: '55 rue Nouvelle, Charette', cellulaire: '+18195550000', courriel: 'np@exemple.ca', promo_accepte: true, statut: 'nouvelle', client_id: null, cree_le: '2026-09-30T13:00:00Z', traitee_le: null },
  { id: 'i3', nom: 'Marie Inscrite', adresse: '1 rue A, Charette', cellulaire: '+18195551234', courriel: 'm@x.ca', promo_accepte: false, statut: 'reliee', client_id: 'c5', cree_le: '2026-09-29T12:00:00Z', traitee_le: '2026-09-29T15:00:00Z' },
  { id: 'i4', nom: 'Test Robot', adresse: '9 rue Faux, Ville', cellulaire: '+18195559998', courriel: null, promo_accepte: false, statut: 'ignoree', client_id: null, cree_le: '2026-09-28T12:00:00Z', traitee_le: '2026-09-28T15:00:00Z' },
];

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

  const arretsDeDepart = o.arrets ?? ARRETS();
  const donnees = { clients: o.fiches ?? FICHES(), inscriptions_avis: o.inscriptions ?? INSC(), stops: JSON.parse(JSON.stringify(arretsDeDepart)) };
  const appels = { requetes: [], toasts: [], confirmations: [], sync: [], rpc: [] };
  let compteur = 0;
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const executer = async (q) => {
    appels.requetes.push({ table: q.table, op: q.op, cols: q.cols, filtres: q.filtres, ordres: q.ordres, plage: q.plage, valeur: q.valeur, retour: q.retour });
    const lignes = donnees[q.table] ?? [];
    if (o.retards?.[q.table + '.' + q.op]?.length) await o.retards[q.table + '.' + q.op].shift();
    if (o.panne?.(q)) throw new TypeError('Failed to fetch');
    const cle = q.table + '.' + q.op;
    if (o.erreurs?.[cle]) { const e = typeof o.erreurs[cle] === 'function' ? o.erreurs[cle](q) : o.erreurs[cle]; if (e) return { data: null, error: e }; }
    const filtrer = (l) => q.filtres.every(([f, c, v]) => (f === 'eq' ? l[c] === v : f === 'in' ? v.includes(l[c]) : true));
    if (q.op === 'select') {
      if (q.table === 'inscriptions_avis' && o.sansTableInsc) return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.inscriptions_avis' in the schema cache" } };
      let r = lignes.filter(filtrer).map((l) => ({ ...l }));
      r.sort((x, y) => { for (const [c, sens] of q.ordres) { const d = cmp(x[c], y[c]); if (d) return (sens === 'desc' ? -1 : 1) * d; } return 0; });   // tous les critères ensemble, dans l'ordre demandé
      if (q.plage) r = r.slice(q.plage[0], q.plage[1] + 1);
      return { data: r, error: null };
    }
    if (q.op === 'update') {
      if (o.refus || (q.table === 'stops' && o.refusStops)) return { data: [], error: null };   // les règles d'accès refusent SANS erreur : aucune ligne changée
      let touches = lignes.filter(filtrer);
      if (q.table === 'stops' && o.partielStops) touches = touches.slice(0, o.partielStops);   // une partie seulement des lignes change
      touches.forEach((l) => Object.assign(l, q.valeur, o.serveurNormalise ? o.serveurNormalise(q.valeur, l) : {}));
      return { data: touches.map((l) => ({ ...l })), error: null };
    }
    if (q.op === 'insert') {
      if (o.refus || (q.table === 'stops' && o.refusStops)) return { data: [], error: null };
      const ajoutes = q.valeur.map((v) => (q.table === 'stops' ? { id: 's-nouveau-' + (++compteur), ...v } : { ...F('c-nouveau-' + (++compteur), v.nom), ...v }));
      ajoutes.forEach((a) => lignes.push(a));
      return { data: ajoutes.map((a) => ({ ...a })), error: null };
    }
    return { data: null, error: { message: 'opération inconnue' } };
  };
  const fauxDb = {
    channel() { const c = { on() { return c; }, subscribe() { return c; } }; return c; },
    rpc: async (nom, args) => {
      appels.rpc.push({ nom, args });
      if (o.rpcPanne?.(nom)) throw new TypeError('Failed to fetch');
      if (o.rpcErreurs?.[nom]) return { data: null, error: o.rpcErreurs[nom] };
      if (o.rpcReponse) return o.rpcReponse;
      const insc = donnees.inscriptions_avis.find((x) => x.id === args.p_inscription_id);
      if (!insc) return { data: null, error: { message: 'inscription_introuvable' } };
      if (insc.statut !== 'nouvelle') return { data: null, error: { message: 'inscription_deja_traitee' } };
      if (nom === 'admin_relier_inscription') {
        const c = donnees.clients.find((x) => x.id === args.p_client_id);
        if (!c || c.actif === false) return { data: null, error: { message: 'client_introuvable' } };
        c.cellulaire = insc.cellulaire; c.avis_texto = true; c.desabonne_texto_le = null; c.courriel = c.courriel ?? insc.courriel;
        insc.statut = 'reliee'; insc.client_id = c.id; insc.traitee_le = '2026-10-01T15:00:00Z';
        return { data: { statut: 'reliee', client_id: c.id, promo: o.promoReponse ?? (insc.promo_accepte ? 'appliquee' : 'non_demandee') }, error: null };
      }
      if (nom === 'admin_ignorer_inscription') { insc.statut = 'ignoree'; insc.traitee_le = '2026-10-01T15:00:00Z'; return { data: { statut: 'ignoree' }, error: null }; }
      return { data: null, error: null };
    },
    from: (table) => {
      const q = { table, op: 'select', cols: null, filtres: [], ordres: [], plage: null, valeur: null, retour: null };
      q.select = (c) => { if (q.op === 'select') q.cols = c; else q.retour = c ?? '*'; return q; };
      q.eq = (c, v) => { q.filtres.push(['eq', c, v]); return q; };
      q.in = (c, l) => { q.filtres.push(['in', c, l]); return q; };
      q.order = (c, opt) => { q.ordres.push([c, opt && opt.ascending === false ? 'desc' : 'asc']); return q; };
      q.range = (a, b) => { q.plage = [a, b]; return q; };
      q.update = (v) => { q.op = 'update'; q.valeur = v; return q; };
      q.insert = (rows) => { q.op = 'insert'; q.valeur = rows; return q; };
      q.then = (ok_, ko_) => Promise.resolve().then(() => executer(q)).then(ok_, ko_);
      return q;
    },
  };
  const sandbox = {
    document: { getElementById, createElement: (b) => creer(null, b), body: creer('body', 'body'), addEventListener() {}, removeEventListener() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: {}, navigator: {}, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, console,
    fetch: async () => ({ json: async () => ({}) }), setStatus() {}, hideLoading() {}, showErr() {},
    __db: fauxDb, __toasts: appels.toasts, __confirmations: appels.confirmations, __sync: appels.sync, __reponse: { oui: true },
  };
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/config.js', 'js/utilitaires.js', 'js/hors-reseau.js', 'js/routes.js', 'js/admin.js', 'js/admin-clients.js']) vm.runInContext(lire(f), ctx, { filename: f });
  vm.runInContext(`db = __db; stops = ${JSON.stringify(arretsDeDepart)}; currentUser = ${JSON.stringify(JOE)}; _adminOnglet = 'clients';
    toast = (m) => { __toasts.push(m); }; confirmer = async (...a) => { __confirmations.push(a); return __reponse.oui; }; showSync = (b) => { __sync.push(b); };`, ctx);
  const corps = () => el('admin-body');
  return { ctx, el, donnees, appels, toasts: appels.toasts, corps,
    run: (c) => vm.runInContext(c, ctx),
    repondre: (oui) => { sandbox.__reponse.oui = oui; },
    ouvrir: () => vm.runInContext('clientsOuvrir()', ctx),
    requetes: (table, op = 'select') => appels.requetes.filter((r) => r.table === table && r.op === op),
    feuilleOuverte: () => el('clients-feuille-overlay').classList.contains('open'),
    feuille: () => el('clients-feuille-corps'),
    champ: (id) => tous(el('clients-feuille-corps')).find((x) => x.id === id),
    filtres: () => (tous(corps()).filter((x) => x.className === 'su-filtres')[0]?.children ?? []).filter((x) => x.tagName === 'BUTTON'),
    recherche: () => tous(corps()).find((x) => x.id === 'cl-recherche'),
    lignes: () => parClasse(corps(), 'su-ligne').map((l) => ({
      nom: parClasse(l, 'su-nom')[0]?.textContent, badges: parClasse(l, 'su-badge').map((b) => b.textContent), n: parClasse(l, 'su-n')[0]?.textContent,
      adresses: parClasse(l, 'su-adresse').map((x) => x.textContent), contact: parClasse(l, 'su-temps')[0]?.textContent, noeud: l,
    })),
    noms: () => parClasse(corps(), 'su-nom').map((x) => x.textContent),
    resume: () => parClasse(corps(), 'su-resume')[0]?.textContent,
    messages: () => parClasse(corps(), 'su-message').map((x) => x.textContent),
    bouton: (texte) => tous(corps()).find((x) => x.tagName === 'BUTTON' && x.textContent === texte),
  };
}
const tous = (n) => [n, ...n.children.flatMap(tous)];
const parClasse = (n, c) => tous(n).filter((x) => (x.className || '').split(/\s+/).includes(c));
const cliquer = async (e) => { const r = e.onclick(); if (r && r.then) await r; };
const taper = (e, v) => { e.value = v; if (e.oninput) e.oninput(); };
const regler = (m, id, v) => { m.champ(id).value = v; };

// =====================================================================
log('=== LES FONCTIONS PURES ===');
{
  const m = monde();
  const t = (x) => m.run(`clientsTelChiffres(${JSON.stringify(x)})`);
  eq('un numéro de 10 chiffres, quelle que soit l\'écriture', [t('819-535-3086'), t('(819) 535-3086'), t('819 535 3086'), t('8195353086')], ['8195353086', '8195353086', '8195353086', '8195353086']);
  eq('… avec l\'indicatif 1 ou +1', [t('1-819-535-3086'), t('+1 819 535 3086')], ['8195353086', '8195353086']);
  eq('… pas un numéro : null (trop court, trop long, indicatif régional impossible, texte, vide)', [t('535-3086'), t('819-535-30866'), t('019-535-3086'), t('819-035-3086'), t('abc'), t(''), m.run('clientsTelChiffres(null)')], [null, null, null, null, null, null, null]);
  eq('« 819 535-3086 » pour l\'écran', [m.run(`clientsTelAffiche('(819) 5353086')`), m.run(`clientsTelAffiche('+18195353086')`)], ['819 535-3086', '819 535-3086']);
  eq('… un texte qui n\'est pas un numéro est montré tel quel (QuickBooks en avait de toutes les formes)', [m.run(`clientsTelAffiche('819 374-7526 2160')`), m.run('clientsTelAffiche(null)')], ['819 374-7526 2160', '']);
  const c = (x) => m.run(`clientsCourrielValide(${JSON.stringify(x)})`);
  eq('un courriel valide', [c('a@b.ca'), c(' a.b+c@exemple.com ')], [true, true]);
  eq('… pas valide : sans @, sans point, avec espace, vide, trop long', [c('ab.ca'), c('a@b'), c('a b@c.ca'), c(''), c('a@' + 'b'.repeat(150) + '.ca')], [false, false, false, false, false]);
  eq('la clé d\'un texte : sans accents ni majuscules ni ponctuation', m.run(`clientsCle("Côme  L'Église-Test")`), 'come l eglise test');
  eq('les arrêts par fiche : seuls les arrêts ACTIFS reliés comptent', [...m.run('clientsCompterArrets(stops)').entries()], [['c1', 2], ['c4', 1]]);
  eq('… une liste vide ou absente : rien', [m.run('clientsCompterArrets(null)').size, m.run('clientsCompterArrets([])').size], [0, 0]);
  eq('sans contact : ni courriel ni téléphone ni cellulaire', FICHES().map((f) => m.run(`clientsSansContact(${JSON.stringify(f)})`)), [false, false, true, false, false, false, false]);
  eq('… un champ de blancs compte comme vide', m.run(`clientsSansContact({courriel:'  ',telephone:'',cellulaire:null})`), true);
  eq('le texte des moyens de joindre', m.run(`clientsTexteContact(${JSON.stringify(FICHES()[4])})`), '✉ m@x.ca · 📱 819 555-1234');
  eq('… avec un téléphone aussi', m.run(`clientsTexteContact(${JSON.stringify(FICHES()[3])})`), '✉ rsile@zedbed.com · ☎ 819 539-1112');
  eq('… aucun : texte vide', m.run(`clientsTexteContact(${JSON.stringify(FICHES()[2])})`), '');
  eq('le texte de l\'adresse : adresse, ville ; l\'un ou l\'autre ; rien', [m.run(`clientsTexteAdresse({adresse:'1 rue A',ville:'Ville'})`), m.run(`clientsTexteAdresse({adresse:'',ville:'Ville'})`), m.run(`clientsTexteAdresse({})`)], ['1 rue A, Ville', 'Ville', '']);
}

log('=== LE FILTRE ET LA RECHERCHE ===');
{
  const m = monde();
  const f = (filtre, rech = '') => m.run(`clientsFiltrer(${JSON.stringify(FICHES())}, clientsCompterArrets(stops), ${JSON.stringify(filtre)}, ${JSON.stringify(rech)})`).map((x) => x.id);
  eq('« Tous » : les fiches actives (pas l\'archivée)', f('tous'), ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
  eq('« Sans arrêt » : les fiches actives sans arrêt actif (l\'arrêt archivé de Paul ne compte pas)', f('sansarret'), ['c2', 'c3', 'c5', 'c6']);
  eq('« Sans contact »', f('sanscontact'), ['c3']);
  eq('« Archivés » : seulement l\'archivée', f('archives'), ['c7']);
  eq('chercher par nom, sans accent ni majuscule', f('tous', 'COME garceau'), ['c3']);
  eq('chaque mot doit se trouver, dans n\'importe quel ordre (nom + ville)', f('tous', 'boniface lafreniere'), ['c1']);
  eq('… chercher dans l\'adresse', f('tous', 'burrill'), ['c4']);
  eq('… dans l\'entreprise', f('tous', 'zedbed inc'), ['c4']);
  eq('… dans le courriel', f('tous', 'kamtchom'), ['c2']);
  eq('… par un bout de numéro de téléphone (sans tenir compte des tirets)', f('tous', '5353086'), ['c1']);
  eq('… par un numéro de cellulaire écrit avec des espaces', f('tous', '819 555 1234'), ['c5']);
  eq('… un mot qui n\'est nulle part : aucune fiche', f('tous', 'zzz'), []);
  eq('… la recherche s\'applique aussi aux archivées dans « Archivés »', f('archives', 'vieille'), ['c7']);
  eq('… et ne montre PAS l\'archivée dans « Tous »', f('tous', 'vieille'), []);
  eq('le résumé : actives, avec arrêt, sans contact, avis courriel et texto, archivées', m.run(`clientsResume(${JSON.stringify(FICHES())}, clientsCompterArrets(stops))`), { actives: 6, archivees: 1, avecArret: 2, sansContact: 1, avisCourriel: 1, avisTexto: 1 });
}

log('=== L\'ONGLET ET LA LECTURE ===');
{
  const m = monde();
  eq('l\'onglet « Clients » est dans le panneau, après « Suivi »', m.run(`ongletsAdmin().map(o=>o.id)`).slice(-2), ['suivi', 'clients']);
  eq('… il a son titre et se charge avec clientsOuvrir', [m.run(`ongletsAdmin().find(o=>o.id==='clients').titre`), m.run(`ongletsAdmin().find(o=>o.id==='clients').charger===chargerClientsAdmin`)], ['Répertoire des clients', true]);
  await m.ouvrir();
  const q = m.requetes('clients');
  eq('une seule lecture de la table « clients », triée par nom puis identifiant', [q.length, q[0].ordres], [1, [['nom', 'asc'], ['id', 'asc']]]);
  vrai('… elle ne demande JAMAIS de colonne inutile du consentement exprès ni d\'adresse IP (seulement ce que l\'écran montre)', !/promo_consentement|ip_hash|quickbooks/.test(q[0].cols), q[0].cols);
  eq('… la lecture commence à la ligne 0 et prend 1000 lignes', q[0].plage, [0, 999]);
  eq('l\'écran liste les fiches actives, dans l\'ordre du nom', m.noms(), ['Claude Lafreniere', 'Côme Garceau', 'Hubert Kamdem', 'Marie Inscrite', 'Paul Parti', 'Zedbed']);
  eq('le résumé de la liste', m.resume(), '6 fiches · 2 avec arrêts · 1 sans moyen de joindre · 1 avis par courriel · 1 inscrit aux textos · 1 archivée');
  const l = m.lignes();
  const ligne = (nom) => l.find((x) => x.nom === nom);
  eq('une fiche avec arrêts : « 🛑 2 arrêts », adresse, téléphone', [ligne('Claude Lafreniere').n, ligne('Claude Lafreniere').adresses, ligne('Claude Lafreniere').contact], ['🛑 2 arrêts', ['100 rue Boisjoli, Saint-Boniface'], '☎ 819 535-3086']);
  eq('… un seul arrêt : au singulier', ligne('Zedbed').n, '🛑 1 arrêt');
  eq('… aucun arrêt : « aucun arrêt »', ligne('Hubert Kamdem').n, 'aucun arrêt');
  eq('… l\'entreprise est montrée avant l\'adresse', ligne('Zedbed').adresses, ['Zedbed inc.', '5352 Rue Burrill, Shawinigan']);
  eq('… une fiche sans moyen de joindre le dit', ligne('Côme Garceau').contact, 'Aucun moyen de joindre ce client');
  const memeNom = (ent) => parClasse(m.run(`clientsLigne(${JSON.stringify(F('x', 'Garage Exemple', { nom_entreprise: ent, adresse: '1 rue A' }))}, 0)`), 'su-adresse').map((x) => x.textContent);
  eq('… l’entreprise écrite comme le nom (aux accents et majuscules près) n’est PAS répétée ; une autre l’est', [memeNom('GARAGE exemple'), memeNom('Garage Exemple inc.')], [['1 rue A'], ['Garage Exemple inc.', '1 rue A']]);
  eq('… « Avis courriel » seulement pour la fiche où Joé l\'a choisi', l.filter((x) => x.badges.includes('Avis courriel')).map((x) => x.nom), ['Zedbed']);
  eq('… « Avis texto » seulement pour l\'inscrite', l.filter((x) => x.badges.includes('Avis texto')).map((x) => x.nom), ['Marie Inscrite']);
  eq('… le désabonné est marqué (courriel ET texto) et PAS « Avis texto »', ligne('Paul Parti').badges, ['Désabonné (courriel)', 'Désabonné (texto)']);
  eq('aucune requête d\'écriture à l\'ouverture', [m.requetes('clients', 'update').length, m.requetes('clients', 'insert').length], [0, 0]);
}

log('=== LES FILTRES ET LA RECHERCHE À L\'ÉCRAN ===');
{
  const m = monde();
  await m.ouvrir();
  const puce = (t) => m.filtres().find((b) => b.textContent === t);
  await cliquer(puce('Sans arrêt'));
  eq('« Sans arrêt » : la liste change', m.noms().sort(), ['Côme Garceau', 'Hubert Kamdem', 'Marie Inscrite', 'Paul Parti']);
  eq('… la puce choisie est marquée, les autres non (8 puces : « 📣 Avis aux clients » et « 📒 Journal des avis » sont les deux dernières)', [m.filtres().map((b) => b.className), m.filtres().slice(-2).map((b) => b.textContent)], [['su-puce', 'su-puce on', 'su-puce', 'su-puce', 'su-puce', 'su-puce', 'su-puce', 'su-puce'], ['📣 Avis aux clients', '📒 Journal des avis']]);
  await cliquer(puce('📣 Avis aux clients'));
  eq('sans le fichier admin-avis.js (il n’est pas chargé dans ce test), la puce « Avis aux clients » le dit sans rien casser ; les autres puces marchent encore', [m.messages(), m.filtres().at(-2).className], [['L’écran des avis n’est pas disponible (fichier admin-avis.js).'], 'su-puce on']);
  await cliquer(puce('📒 Journal des avis'));
  eq('… de même pour la puce « Journal des avis » (fichier admin-avis-journal.js absent de ce test)', [m.messages(), m.filtres().at(-1).className, m.filtres().at(-2).className], [['Le journal des avis n’est pas disponible (fichier admin-avis-journal.js).'], 'su-puce on', 'su-puce']);
  await cliquer(puce('Sans arrêt'));
  await cliquer(puce('Sans contact'));
  eq('« Sans contact »', m.noms(), ['Côme Garceau']);
  await cliquer(puce('Archivés'));
  eq('« Archivés » : l\'archivée', m.noms(), ['Vieille Fiche']);
  eq('… son badge « Archivée »', m.lignes()[0].badges, ['Archivée']);
  await cliquer(puce('Tous'));
  taper(m.recherche(), 'kamdem');
  eq('la recherche filtre à chaque lettre', m.noms(), ['Hubert Kamdem']);
  taper(m.recherche(), 'zzz');
  eq('… aucune fiche : un message', [m.noms(), m.messages()], [[], ['Aucune fiche ne correspond.']]);
  taper(m.recherche(), '');
  eq('… effacer la recherche rend toute la liste', m.noms().length, 6);
  eq('filtrer ne relit pas la base', m.requetes('clients').length, 1);
}

log('=== LA FEUILLE : MODIFIER UNE FICHE ===');
{
  const m = monde();
  await m.ouvrir();
  const ouvrirFiche = async (nom) => cliquer(m.lignes().find((x) => x.nom === nom).noeud.children[0].children[0]);
  await ouvrirFiche('Côme Garceau');
  vrai('toucher le nom ouvre la feuille', m.feuilleOuverte());
  eq('… son titre est le nom', m.el('clients-feuille-titre').textContent, 'Côme Garceau');
  eq('… les champs montrent la fiche', ['cl-nom', 'cl-adresse', 'cl-ville', 'cl-cp', 'cl-courriel', 'cl-tel', 'cl-cell'].map((id) => m.champ(id).value), ['Côme Garceau', '930 Chemin Bellevue', 'Saint-Boniface', '', '', '', '']);
  eq('… le type et la case « avertir par courriel »', [m.champ('cl-type').value, m.champ('cl-avis-courriel').checked], ['particulier', false]);
  eq('… les six types de client sont offerts', m.champ('cl-type').children.map((o) => o.value), ['particulier', 'investisseur', 'municipalite', 'commerce', 'syndicat', 'autre']);
  vrai('… le texte du consentement texto est en LECTURE SEULE (aucun champ, aucune case)', !m.champ('cl-avis-texto') && /Pas inscrit aux avis par texto/.test(parClasse(m.feuille(), 'cl-etat-texto')[0].textContent));

  regler(m, 'cl-cell', '(819) 555-4321');
  await cliquer(m.champ('cl-enregistrer'));
  const u = m.requetes('clients', 'update');
  eq('enregistrer : UNE mise à jour de CETTE fiche', [u.length, u[0].filtres], [1, [['eq', 'id', 'c3']]]);
  eq('… le cellulaire part en +1 et 10 chiffres', u[0].valeur.cellulaire, '+18195554321');
  eq('… les champs vides partent en null (pas en texte vide)', [u[0].valeur.courriel, u[0].valeur.telephone, u[0].valeur.code_postal, u[0].valeur.notes, u[0].valeur.nom_entreprise], [null, null, null, null, null]);
  eq('… la mise à jour n\'écrit JAMAIS une colonne de consentement ni « actif »', Object.keys(u[0].valeur).filter((k) => /avis_texto|desabonne|promo|actif|id$/.test(k)), []);
  eq('… avis_courriel part bien (faux)', u[0].valeur.avis_courriel, false);
  vrai('… la feuille se ferme, un message de réussite', !m.feuilleOuverte() && m.toasts.at(-1) === '✔ Fiche enregistrée');
  eq('… la liste montre le nouveau cellulaire sans relire la base', [m.lignes().find((x) => x.nom === 'Côme Garceau').contact, m.requetes('clients').length], ['📱 819 555-4321', 1]);
  eq('… aucune confirmation demandée (la fiche n\'était pas inscrite aux textos)', m.appels.confirmations.length, 0);
}

log('=== LA CASE « AVERTIR PAR COURRIEL » ===');
{
  const m = monde();
  await m.ouvrir();
  await cliquer(m.lignes().find((x) => x.nom === 'Zedbed').noeud.children[0].children[0]);
  eq('une fiche qui a choisi l’avis par courriel : la case est cochée', m.champ('cl-avis-courriel').checked, true);
  m.champ('cl-avis-courriel').checked = false;
  await cliquer(m.champ('cl-enregistrer'));
  eq('… la décocher et enregistrer envoie avis_courriel faux', m.requetes('clients', 'update')[0].valeur.avis_courriel, false);
  eq('… la liste n’affiche plus « Avis courriel » pour elle', m.lignes().find((x) => x.nom === 'Zedbed').badges.includes('Avis courriel'), false);
}

log('=== LA FEUILLE : LES REFUS AVANT D\'ENVOYER ===');
{
  const m = monde();
  await m.ouvrir();
  const ouvrirFiche = async (nom) => cliquer(m.lignes().find((x) => x.nom === nom).noeud.children[0].children[0]);
  await ouvrirFiche('Côme Garceau');
  const essai = async (id, v, msg, titre) => {
    const avant = m.requetes('clients', 'update').length;
    const ancien = m.champ(id).value; regler(m, id, v);
    await cliquer(m.champ('cl-enregistrer'));
    eq(titre, [m.toasts.at(-1), m.requetes('clients', 'update').length - avant, m.feuilleOuverte()], [msg, 0, true]);
    regler(m, id, ancien);
  };
  await essai('cl-nom', '   ', '⚠ Entre le nom du client', 'un nom vide est refusé (rien envoyé, la feuille reste ouverte)');
  await essai('cl-courriel', 'pas-un-courriel', '⚠ Ce courriel ne semble pas valide', 'un courriel invalide est refusé');
  await essai('cl-cell', '555-1234', '⚠ Le cellulaire doit avoir 10 chiffres (ex. 819 555-1234)', 'un cellulaire de 7 chiffres est refusé');
  await essai('cl-cell', 'abc', '⚠ Le cellulaire doit avoir 10 chiffres (ex. 819 555-1234)', '… du texte aussi');
  m.champ('cl-avis-courriel').checked = true;
  await cliquer(m.champ('cl-enregistrer'));
  eq('« avertir par courriel » sans courriel est refusé', [m.toasts.at(-1), m.requetes('clients', 'update').length], ['⚠ Pour avertir par courriel, il faut un courriel', 0]);
  regler(m, 'cl-courriel', 'COME@Exemple.CA');
  await cliquer(m.champ('cl-enregistrer'));
  eq('… avec un courriel : accepté, enregistré en minuscules', [m.requetes('clients', 'update')[0].valeur.courriel, m.requetes('clients', 'update')[0].valeur.avis_courriel], ['come@exemple.ca', true]);
}

log('=== LE CELLULAIRE D\'UNE FICHE INSCRITE AUX TEXTOS ===');
{
  const m = monde();
  await m.ouvrir();
  const ouvrirFiche = async (nom) => cliquer(m.lignes().find((x) => x.nom === nom).noeud.children[0].children[0]);
  await ouvrirFiche('Marie Inscrite');
  eq('la feuille dit qu\'elle est inscrite', parClasse(m.feuille(), 'cl-etat-texto')[0].textContent, 'Inscrit aux avis par texto.');
  eq('… le cellulaire est montré en 10 chiffres', m.champ('cl-cell').value, '819 555-1234');
  await cliquer(m.champ('cl-enregistrer'));
  eq('enregistrer SANS changer le cellulaire : aucune confirmation (même numéro écrit autrement)', [m.appels.confirmations.length, m.requetes('clients', 'update').length], [0, 1]);
  await ouvrirFiche('Marie Inscrite');
  regler(m, 'cl-cell', '819 555 7777');
  m.repondre(false);
  await cliquer(m.champ('cl-enregistrer'));
  eq('changer le cellulaire : une confirmation qui explique l\'annulation de l\'inscription', [m.appels.confirmations.length, /annulée/.test(m.appels.confirmations[0][1]), m.appels.confirmations[0][0]], [1, true, 'Changer le cellulaire ?']);
  eq('… « Annuler » : rien n\'est écrit, la feuille reste ouverte', [m.requetes('clients', 'update').length, m.feuilleOuverte()], [1, true]);
  m.repondre(true);
  await cliquer(m.champ('cl-enregistrer'));
  eq('… « Changer » : la mise à jour part', [m.requetes('clients', 'update').length, m.requetes('clients', 'update')[1].valeur.cellulaire], [2, '+18195557777']);
}

log('=== UNE NOUVELLE FICHE ===');
{
  const m = monde();
  await m.ouvrir();
  await cliquer(m.bouton('＋ Nouveau client'));
  vrai('la feuille s\'ouvre vide, « Nouveau client »', m.feuilleOuverte() && m.el('clients-feuille-titre').textContent === 'Nouveau client' && m.champ('cl-nom').value === '');
  eq('… le bouton s\'appelle « Créer la fiche » ; pas de bouton d\'archivage', [m.champ('cl-enregistrer').textContent, m.champ('cl-archiver')], ['Créer la fiche', undefined]);
  await cliquer(m.champ('cl-enregistrer'));
  eq('sans nom : refusé', [m.toasts.at(-1), m.requetes('clients', 'insert').length], ['⚠ Entre le nom du client', 0]);
  regler(m, 'cl-nom', 'Alice Nouvelle'); regler(m, 'cl-ville', 'Charette'); regler(m, 'cl-cell', '438 222 3333');
  await cliquer(m.champ('cl-enregistrer'));
  const ins = m.requetes('clients', 'insert');
  eq('une insertion d\'UNE fiche', [ins.length, ins[0].valeur.length], [1, 1]);
  eq('… avec le nom, la ville et le cellulaire normalisé ; type « particulier »', [ins[0].valeur[0].nom, ins[0].valeur[0].ville, ins[0].valeur[0].cellulaire, ins[0].valeur[0].type_client], ['Alice Nouvelle', 'Charette', '+14382223333', 'particulier']);
  eq('… AUCUN avis activé ni consentement écrit', [ins[0].valeur[0].avis_courriel, Object.keys(ins[0].valeur[0]).filter((k) => /avis_texto|desabonne|promo|actif/.test(k))], [false, []]);
  vrai('… elle apparaît dans la liste, la feuille est fermée', m.noms().includes('Alice Nouvelle') && !m.feuilleOuverte() && m.toasts.at(-1) === '✔ Fiche créée');
  eq('… une fiche de plus dans le résumé', /^7 fiches/.test(m.resume()), true);
  // un doublon de nom
  await cliquer(m.bouton('＋ Nouveau client'));
  regler(m, 'cl-nom', 'zedbed');
  m.repondre(false);
  await cliquer(m.champ('cl-enregistrer'));
  eq('un nom qui existe déjà (à la casse près) : une confirmation, « Annuler » n\'écrit rien', [m.appels.confirmations.at(-1)[0], m.requetes('clients', 'insert').length], ['Cette fiche existe peut-être déjà', 1]);
  m.repondre(true);
  await cliquer(m.champ('cl-enregistrer'));
  eq('… « Créer quand même » écrit', m.requetes('clients', 'insert').length, 2);
}

log('=== ARCHIVER ET RÉACTIVER ===');
{
  const m = monde();
  await m.ouvrir();
  const ouvrirFiche = async (nom) => cliquer(m.lignes().find((x) => x.nom === nom).noeud.children[0].children[0]);
  await ouvrirFiche('Hubert Kamdem');
  eq('le bouton d\'archivage est offert', m.champ('cl-archiver').textContent, '🗄 Archiver cette fiche');
  m.repondre(false);
  await cliquer(m.champ('cl-archiver'));
  eq('« Annuler » : rien n\'est écrit', [m.requetes('clients', 'update').length, m.appels.confirmations.at(-1)[0]], [0, 'Archiver Hubert Kamdem ?']);
  m.repondre(true);
  await cliquer(m.champ('cl-archiver'));
  const u = m.requetes('clients', 'update');
  eq('« Archiver » : actif passe à faux, rien d\'autre ; jamais de suppression', [u[0].valeur, u[0].filtres, m.requetes('clients', 'delete').length], [{ actif: false }, [['eq', 'id', 'c2']], 0]);
  vrai('… la fiche disparaît de la liste', !m.noms().includes('Hubert Kamdem') && m.toasts.at(-1) === '🗄 Fiche archivée');
  await cliquer(m.filtres().find((b) => b.textContent === 'Archivés'));
  eq('… elle est dans « Archivés »', m.noms().sort(), ['Hubert Kamdem', 'Vieille Fiche']);
  await ouvrirFiche('Vieille Fiche');
  eq('une fiche archivée offre « Réactiver », sans confirmation', m.champ('cl-archiver').textContent, '↩ Réactiver cette fiche');
  const avant = m.appels.confirmations.length;
  await cliquer(m.champ('cl-archiver'));
  eq('… réactiver : actif vrai, aucune confirmation', [m.requetes('clients', 'update')[1].valeur, m.appels.confirmations.length - avant, m.toasts.at(-1)], [{ actif: true }, 0, '↩ Fiche réactivée']);
}

log('=== LES PANNES ET LES REFUS ===');
{
  // la lecture échoue : pas de réseau
  let m = monde({ panne: (q) => q.op === 'select' });
  await m.ouvrir();
  eq('pas de réseau à la lecture : un message clair et « Réessayer »', [m.messages(), !!m.bouton('↻ Réessayer')], [['📴 Pas de réseau : le répertoire n’a pas pu être lu.'], true]);
  // la table n'existe pas
  m = monde({ erreurs: { 'clients.select': { code: 'PGRST205', message: "Could not find the table 'public.clients' in the schema cache" } } });
  await m.ouvrir();
  eq('table absente : il faut exécuter le SQL 30 (jamais « répertoire vide »)', m.messages(), ['Le répertoire des clients n’est pas encore activé dans ta base (fichier SQL 30).']);
  m = monde({ erreurs: { 'clients.select': { code: '42P01', message: 'relation absente' } } });
  await m.ouvrir();
  eq('table absente (code 42P01 seul) : le même message', m.messages(), ['Le répertoire des clients n’est pas encore activé dans ta base (fichier SQL 30).']);
  m = monde({ erreurs: { 'clients.select': { code: 'PGRST205', message: 'x' } } });
  await m.ouvrir();
  eq('table absente (code PGRST205 seul) : le même message', m.messages(), ['Le répertoire des clients n’est pas encore activé dans ta base (fichier SQL 30).']);
  // autre erreur
  m = monde({ erreurs: { 'clients.select': { message: 'boum' } } });
  await m.ouvrir();
  eq('autre erreur : jamais « répertoire vide »', m.messages(), ['❌ Impossible de lire le répertoire. Vérifie la connexion, puis réessaie.']);
  // les règles d'accès refusent l'écriture sans erreur
  m = monde({ refus: true });
  await m.ouvrir();
  await cliquer(m.lignes()[0].noeud.children[0].children[0]);
  await cliquer(m.champ('cl-enregistrer'));
  eq('une mise à jour qui ne change AUCUNE ligne : jamais « enregistrée »', [m.toasts.at(-1), m.feuilleOuverte()], ['❌ Rien n’a été enregistré (accès refusé ?)', true]);
  await cliquer(m.champ('cl-archiver'));
  eq('… idem pour l\'archivage', m.toasts.at(-1), '❌ Rien n’a été changé (accès refusé ?)');
  m = monde({ refus: true });
  await m.ouvrir();
  await cliquer(m.bouton('＋ Nouveau client'));
  regler(m, 'cl-nom', 'Nouvelle');
  await cliquer(m.champ('cl-enregistrer'));
  eq('… idem pour une nouvelle fiche : elle n\'apparaît pas à l\'écran', [m.toasts.at(-1), m.noms().includes('Nouvelle')], ['❌ Rien n’a été enregistré (accès refusé ?)', false]);
  // le réseau tombe à l'écriture
  m = monde({ panne: (q) => q.op === 'update' });
  await m.ouvrir();
  await cliquer(m.lignes()[0].noeud.children[0].children[0]);
  await cliquer(m.champ('cl-enregistrer'));
  eq('pas de réseau à l\'écriture : « rien n\'a été changé », la feuille reste ouverte, la liste reste intacte', [m.toasts.at(-1), m.feuilleOuverte(), m.noms().length], ['📴 Pas de réseau : rien n’a été changé.', true, 6]);
  eq('… et le bouton redevient utilisable (pas bloqué en « occupé »)', m.run('_clientsOccupe'), false);
  eq('… l\'indicateur de synchronisation est éteint', m.appels.sync.at(-1), false);
  // le serveur refuse un cellulaire
  m = monde({ erreurs: { 'clients.update': { message: 'cellulaire_invalide' } } });
  await m.ouvrir();
  await cliquer(m.lignes()[0].noeud.children[0].children[0]);
  await cliquer(m.champ('cl-enregistrer'));
  eq('le serveur refuse un cellulaire : message précis', m.toasts.at(-1), '❌ Ce cellulaire n’est pas valide.');
}

log('=== DEUX LECTURES QUI SE CROISENT ===');
{
  let lacher1, lacher2;
  const m = monde({ retards: { 'clients.select': [new Promise((r) => { lacher1 = r; }), new Promise((r) => { lacher2 = r; })] } });
  const p1 = m.ouvrir();
  const p2 = m.ouvrir();
  lacher2(); await p2;
  eq('la lecture la plus récente s\'affiche', m.noms().length, 6);
  m.donnees.clients.splice(5, 1);   // (la base change entre les deux : une fiche active de moins)
  lacher1(); await p1;
  eq('… une réponse plus vieille arrivée après est IGNORÉE', m.noms().length, 6);
}

// ═════════════════════════════════════════════════════════════════
// ÉTAPE 2 : RELIER LES ARRÊTS QUI N'ONT PAS ENCORE DE FICHE
// ═════════════════════════════════════════════════════════════════
log('=== ÉTAPE 2 : LES FONCTIONS PURES (adresses, groupes, suggestions) ===');
{
  const m = monde();
  const civ = (a) => m.run(`clientsNumeroCivique(${JSON.stringify(a)})`);
  eq('le numéro civique : le nombre au début de l\'adresse', [civ('930 ch. Bellevue'), civ('  12 rue A'), civ('Rue Laflèche, Saint-Paulin'), civ(''), m.run('clientsNumeroCivique(null)')], ['930', '12', null, null, null]);
  const mot = (a) => m.run(`clientsMotRue(${JSON.stringify(a)})`);
  eq('le mot de la rue : sans « rue », « de la », « ch. », « du »…', [mot('100 rue Boisjoli, saint-boniface'), mot('195 Rue de la Station, Charette'), mot('221 ch. du Lac Bell'), mot('5800 gene h kruger')], ['boisjoli', 'station', 'lac', 'gene']);
  eq('… « St » et « Saint » donnent le même mot (« rue St-Jean » = « rue Saint-Jean »)', [mot('85 rue St-Jean'), mot('85 rue Saint-Jean')], ['saint', 'saint']);
  eq('… une adresse sans rue : vide', [mot('46.314371,-72.799514'), mot('')], ['', '']);
  const g = m.run(`clientsGrouperArrets([
    {id:'a', adresse:'10 rue des Pins, Louiseville', client:'Tremblay', service:'Coupe de gazon', actif:true},
    {id:'b', adresse:'10 RUE DES PINS, LOUISEVILLE', client:'', service:'Déneigement', actif:true},
    {id:'c', adresse:'10 rue des pins, louiseville', client:'Tremblay', service:'Coupe de gazon', actif:true},
    {id:'d', adresse:'2 av. Zéro', client:'Z', service:'Sel', actif:false},
    {id:'e', adresse:'1 rue Avant', client:'Autre', service:'Sel', actif:true}])`);
  eq('les arrêts sont groupés par adresse (accents et majuscules ignorés), les archivés écartés, triés par adresse', g.map((x) => [x.adresse, x.ids]), [['1 rue Avant', ['e']], ['10 rue des Pins, Louiseville', ['a', 'b', 'c']]]);
  eq('… un groupe réunit les noms et les services SANS doublon', [g.find((x) => x.ids.includes('a')).noms, g.find((x) => x.ids.includes('a')).services], [['Tremblay'], ['Coupe de gazon', 'Déneigement']]);
  const sug = (groupe, max) => m.run(`clientsSuggestions(${JSON.stringify(groupe)}, ${JSON.stringify(FICHES())}, ${max ?? 6})`).map((f) => f.id);
  eq('suggestion : même numéro civique ET même rue', sug({ adresse: '100 Rue Boisjoli, St-Boniface', noms: [], services: [], ids: [] }), ['c1']);
  eq('… le même numéro sur une AUTRE rue : aucune suggestion', sug({ adresse: '100 rue Lafontaine, Ville', noms: [], services: [], ids: [] }), []);
  eq('… la même rue avec un AUTRE numéro : aucune suggestion', sug({ adresse: '101 rue Boisjoli, Saint-Boniface', noms: [], services: [], ids: [] }), []);
  eq('… même nom (accents et majuscules ignorés), adresse différente', sug({ adresse: '7 rue Inconnue', noms: ['ZEDBED'], services: [], ids: [] }), ['c4']);
  eq('… l\'entreprise de la fiche compte aussi comme nom', sug({ adresse: '7 rue Inconnue', noms: ['zedbed inc.'], services: [], ids: [] }), ['c4']);
  eq('… l’entreprise d’une fiche suffit à elle seule (le nom de la fiche est différent)', m.run(`clientsSuggestions({adresse:'7 rue Inconnue', noms:['Garage Exemple inc.'], services:[], ids:[]}, [{id:'x1', nom:'Jean Dupont', nom_entreprise:'Garage Exemple inc.', actif:true}, {id:'x2', nom:'Autre', nom_entreprise:null, actif:true}], 6)`).map((f) => f.id), ['x1']);
  eq('… un nom trop court (moins de 5 lettres) ne suggère rien par « contenu »', sug({ adresse: '7 rue Inconnue', noms: ['Zed'], services: [], ids: [] }), []);
  eq('… adresse ET nom : la fiche la plus probable passe en premier', sug({ adresse: '5352 rue Burrill', noms: ['Hubert Kamdem'], services: [], ids: [] }), ['c4', 'c2']);
  eq('… une fiche archivée n\'est jamais suggérée', sug({ adresse: '3 rue C, Charette', noms: ['Vieille Fiche'], services: [], ids: [] }), []);
  eq('… au plus « max » suggestions', sug({ adresse: '5352 rue Burrill', noms: ['Hubert Kamdem'], services: [], ids: [] }, 1), ['c4']);
  eq('… aucun nom ni adresse utilisable : rien', sug({ adresse: '', noms: [], services: [], ids: [] }), []);
  const fg = (r) => m.run(`clientsFiltrerGroupes(${JSON.stringify(g)}, ${JSON.stringify(r)})`).map((x) => x.ids[0]);
  eq('chercher parmi les adresses sans fiche : dans l’adresse, le nom ou le service ; chaque mot compte', [fg(''), fg('pins'), fg('treMblay gazon'), fg('sel'), fg('zzz')], [['e', 'a'], ['a'], ['a'], ['e'], []]);
}

log('=== ÉTAPE 2 : L\'ÉCRAN « ARRÊTS SANS FICHE » ===');
{
  const m = monde();
  await m.ouvrir();
  const puce = (t) => m.filtres().find((b) => b.textContent.startsWith(t));
  eq('une 5ᵉ puce « Arrêts sans fiche (N) » : N adresses, pas N arrêts', puce('Arrêts sans fiche').textContent, 'Arrêts sans fiche (5)');
  await cliquer(puce('Arrêts sans fiche'));
  eq('le résumé : adresses et arrêts', m.resume(), '5 adresses sans fiche (6 arrêts)');
  eq('une ligne par ADRESSE (la même adresse avec 2 services = une ligne), dans l\'ordre', m.noms(), ['100 rue boisjoli, st-boniface', '7 rue Inconnue, Ville', '8 rue Seule, Ville', '930 ch. Bellevue, saint-boniface', 'sans fiche']);
  const l = m.lignes();
  eq('… « 🛑 2 arrêts » pour l\'adresse à deux services, « 🛑 1 arrêt » sinon', [l[3].n, l[0].n], ['🛑 2 arrêts', '🛑 1 arrêt']);
  eq('… le nom écrit sur l\'arrêt, ou « Aucun nom »', [l[3].adresses[0], l[2].adresses[0]], ['Nom sur l’arrêt : Côme Garceau', 'Aucun nom sur l’arrêt']);
  eq('… les services', l[3].contact, 'Coupe de gazon · Déneigement');
  eq('l\'arrêt archivé (s5, relié) et les arrêts déjà reliés n\'y sont pas', m.noms().some((x) => /2 rue B|burrill|boisjoli, saint/.test(x)), false);
  taper(m.recherche(), 'bellevue');
  eq('la recherche s\'applique aux adresses', m.noms(), ['930 ch. Bellevue, saint-boniface']);
  taper(m.recherche(), 'zzz');
  eq('… aucune : un message', m.messages(), ['Aucune adresse ne correspond.']);
  taper(m.recherche(), '');
  eq('aucune écriture en regardant la liste', [m.requetes('stops', 'update').length, m.requetes('clients', 'update').length], [0, 0]);
  // tous reliés
  const m2 = monde({ arrets: ARRETS().filter((s) => s.client_id) });
  await m2.ouvrir();
  await cliquer(m2.filtres().find((b) => b.textContent.startsWith('Arrêts sans fiche')));
  eq('tous les arrêts reliés : un message de réussite, jamais une liste vide muette', m2.messages(), ['✔ Tous les arrêts sont reliés à une fiche.']);
}

log('=== ÉTAPE 2 : RELIER UN ARRÊT À UNE FICHE ===');
{
  const m = monde();
  await m.ouvrir();
  await cliquer(m.filtres().find((b) => b.textContent.startsWith('Arrêts sans fiche')));
  const ouvrir = async (adresse) => cliquer(m.lignes().find((x) => x.nom === adresse).noeud.children[0].children[0]);
  const choix = () => parClasse(m.feuille(), 'cl-choix').map((b) => b.textContent);
  await ouvrir('930 ch. Bellevue, saint-boniface');
  vrai('toucher une adresse ouvre la feuille « Relier »', m.feuilleOuverte() && m.el('clients-feuille-titre').textContent === 'Relier cet arrêt à une fiche');
  eq('… la fiche la plus probable est proposée (même numéro et même rue)', choix(), ['Côme Garceau — 930 Chemin Bellevue, Saint-Boniface']);
  const rech = m.champ('cl-relier-rech');
  taper(rech, 'zedbed');
  eq('… une recherche remplace les propositions', choix(), ['Zedbed — 5352 Rue Burrill, Shawinigan']);
  taper(rech, 'zzz');
  eq('… aucune fiche : un message', parClasse(m.feuille(), 'su-message').map((x) => x.textContent), ['Aucune fiche ne correspond.']);
  taper(rech, '');
  m.repondre(false);
  await cliquer(parClasse(m.feuille(), 'cl-choix')[0]);
  eq('relier demande une confirmation qui nomme l\'adresse et la fiche ; « Annuler » n\'écrit rien', [m.appels.confirmations.at(-1)[0], /930 ch\. Bellevue/.test(m.appels.confirmations.at(-1)[1]), /Côme Garceau/.test(m.appels.confirmations.at(-1)[1]), m.requetes('stops', 'update').length], ['Relier cet arrêt ?', true, true, 0]);
  m.repondre(true);
  await cliquer(parClasse(m.feuille(), 'cl-choix')[0]);
  const u = m.requetes('stops', 'update');
  eq('« Relier » : UNE mise à jour de stops, client_id seulement, sur les DEUX arrêts de l\'adresse', [u.length, u[0].valeur, u[0].filtres], [1, { client_id: 'c3' }, [['in', 'id', ['s6', 's7']]]]);
  eq('… les arrêts de l\'application sont mis à jour sans relire la base', m.run(`stops.filter(s => s.client_id === 'c3').map(s => s.id)`), ['s6', 's7']);
  vrai('… la feuille se ferme, un message, la liste se redessine', !m.feuilleOuverte() && m.toasts.at(-1) === '✔ 2 arrêts reliés à Côme Garceau' && !m.noms().includes('930 ch. Bellevue, saint-boniface'));
  eq('… la puce compte une adresse de moins', m.filtres().find((b) => b.textContent.startsWith('Arrêts sans fiche')).textContent, 'Arrêts sans fiche (4)');
  eq('… la fiche affiche maintenant ses arrêts (🛑 2) dans « Tous »', (await cliquer(m.filtres()[0]), m.lignes().find((x) => x.nom === 'Côme Garceau').n), '🛑 2 arrêts');
  eq('aucune requête n\'écrit dans « clients » en reliant', m.requetes('clients', 'update').length + m.requetes('clients', 'insert').length, 0);
}

log('=== ÉTAPE 2 : LES REFUS DE LA BASE EN RELIANT ===');
{
  // les règles d'accès refusent sans erreur (aucune ligne changée)
  let m = monde({ refusStops: true });
  await m.ouvrir();
  await cliquer(m.filtres().find((b) => b.textContent.startsWith('Arrêts sans fiche')));
  await cliquer(m.lignes().find((x) => x.nom === '930 ch. Bellevue, saint-boniface').noeud.children[0].children[0]);
  await cliquer(parClasse(m.feuille(), 'cl-choix')[0]);
  eq('aucune ligne changée : jamais « relié », rien n\'est modifié à l\'écran', [m.toasts.at(-1), m.run(`stops.filter(s => s.client_id === 'c3').length`), m.feuilleOuverte()], ['❌ Rien n’a été changé (accès refusé ?).', 0, true]);
  eq('… le bouton redevient utilisable', m.run('_clientsOccupe'), false);
  // une partie seulement
  m = monde({ partielStops: 1 });
  await m.ouvrir();
  await cliquer(m.filtres().find((b) => b.textContent.startsWith('Arrêts sans fiche')));
  await cliquer(m.lignes().find((x) => x.nom === '930 ch. Bellevue, saint-boniface').noeud.children[0].children[0]);
  await cliquer(parClasse(m.feuille(), 'cl-choix')[0]);
  eq('une partie seulement des arrêts a changé : le dit, et l\'écran montre ce qui a VRAIMENT changé', [m.toasts.at(-1), m.run(`stops.filter(s => s.client_id === 'c3').length`)], ['❌ Seulement 1 arrêt sur 2 ont changé.', 1]);
  // pas de réseau
  m = monde({ panne: (q) => q.table === 'stops' && q.op === 'update' });
  await m.ouvrir();
  await cliquer(m.filtres().find((b) => b.textContent.startsWith('Arrêts sans fiche')));
  await cliquer(m.lignes().find((x) => x.nom === '930 ch. Bellevue, saint-boniface').noeud.children[0].children[0]);
  await cliquer(parClasse(m.feuille(), 'cl-choix')[0]);
  eq('pas de réseau : « rien n\'a été changé », la feuille reste ouverte', [m.toasts.at(-1), m.feuilleOuverte(), m.run(`stops.filter(s => s.client_id === 'c3').length`)], ['📴 Pas de réseau : rien n’a été changé.', true, 0]);
}

log('=== ÉTAPE 2 : CRÉER UNE FICHE À PARTIR D\'UN ARRÊT ===');
{
  const m = monde();
  await m.ouvrir();
  await cliquer(m.filtres().find((b) => b.textContent.startsWith('Arrêts sans fiche')));
  await cliquer(m.lignes().find((x) => x.nom === '8 rue Seule, Ville').noeud.children[0].children[0]);
  eq('aucune fiche probable : le dit et propose de créer', [parClasse(m.feuille(), 'cl-choix').length, parClasse(m.feuille(), 'su-message').map((x) => x.textContent)], [0, ['Aucune fiche probable : cherche par nom, ou crée une nouvelle fiche.']]);
  await cliquer(m.champ('cl-relier-nouvelle'));
  eq('« ＋ Nouvelle fiche » ouvre la fiche avec l\'adresse de l\'arrêt', [m.el('clients-feuille-titre').textContent, m.champ('cl-nom').value, m.champ('cl-adresse').value], ['Nouveau client', '', '8 rue Seule, Ville']);
  vrai('… et dit que l\'arrêt sera relié', parClasse(m.feuille(), 'cl-lier-info')[0].textContent === 'L’arrêt « 8 rue Seule, Ville » (1 arrêt) sera relié à cette fiche.');
  regler(m, 'cl-nom', 'Nouveau Voisin');
  await cliquer(m.champ('cl-enregistrer'));
  const ins = m.requetes('clients', 'insert');
  const u = m.requetes('stops', 'update');
  eq('enregistrer : la fiche est créée PUIS l\'arrêt est relié à la NOUVELLE fiche', [ins.length, u.length, u[0].valeur.client_id === m.donnees.clients.at(-1).id, u[0].filtres[0][2]], [1, 1, true, ['s10']]);
  vrai('… un seul message : fiche créée et arrêt relié ; la liste des arrêts se met à jour', m.toasts.at(-1) === '✔ Fiche créée et arrêt relié' && !m.noms().includes('8 rue Seule, Ville') && m.filtres().find((b) => b.textContent.startsWith('Arrêts sans fiche')).textContent === 'Arrêts sans fiche (4)');
  // le nom de l'arrêt est proposé comme nom de la fiche
  await cliquer(m.lignes().find((x) => x.nom === '930 ch. Bellevue, saint-boniface').noeud.children[0].children[0]);
  await cliquer(m.champ('cl-relier-nouvelle'));
  eq('le nom écrit sur l\'arrêt devient le nom proposé de la fiche', m.champ('cl-nom').value, 'Côme Garceau');
  m.donnees.clients.pop();   // (pas de doublon de nom pour ce scénario : la fiche « Côme Garceau » existe déjà : on confirme)
  m.repondre(true);
  await cliquer(m.champ('cl-enregistrer'));
  eq('un nom déjà utilisé : la confirmation habituelle, puis la création', m.appels.confirmations.at(-1)[0], 'Cette fiche existe peut-être déjà');
  // la fiche est créée mais le lien échoue
  const m2 = monde({ refusStops: true });
  await m2.ouvrir();
  await cliquer(m2.filtres().find((b) => b.textContent.startsWith('Arrêts sans fiche')));
  await cliquer(m2.lignes().find((x) => x.nom === '8 rue Seule, Ville').noeud.children[0].children[0]);
  await cliquer(m2.champ('cl-relier-nouvelle'));
  regler(m2, 'cl-nom', 'Autre Voisin');
  await cliquer(m2.champ('cl-enregistrer'));
  eq('la fiche est créée mais le lien est refusé : un message qui dit les DEUX choses, l\'arrêt reste sans fiche', [m2.toasts.at(-1), m2.donnees.clients.some((x) => x.nom === 'Autre Voisin'), m2.run(`stops.find(s => s.id === 's10').client_id`)], ['⚠ Fiche créée, mais l’arrêt n’a pas pu être relié : Rien n’a été changé (accès refusé ?).', true, null]);
  // annuler ne garde pas le lien à relier pour la fiche suivante
  const m3 = monde();
  await m3.ouvrir();
  await cliquer(m3.filtres().find((b) => b.textContent.startsWith('Arrêts sans fiche')));
  await cliquer(m3.lignes().find((x) => x.nom === '8 rue Seule, Ville').noeud.children[0].children[0]);
  await cliquer(m3.champ('cl-relier-nouvelle'));
  m3.run('clientsFermerFeuille()');
  eq('abandonner la création vide le lien à créer (aucun reste en mémoire)', m3.run('_clientsALier'), null);
  await cliquer(m3.filtres()[0]);
  await cliquer(m3.bouton('＋ Nouveau client'));
  vrai('abandonner la création n\'oublie pas de retirer le lien : la fiche suivante n\'en porte aucun', parClasse(m3.feuille(), 'cl-lier-info').length === 0);
}

log('=== ÉTAPE 2 : DÉLIER UN ARRÊT (depuis la fiche) ===');
{
  const m = monde();
  await m.ouvrir();
  const ouvrirFiche = async (nom) => cliquer(m.lignes().find((x) => x.nom === nom).noeud.children[0].children[0]);
  await ouvrirFiche('Claude Lafreniere');
  eq('la fiche liste ses arrêts, par adresse', [parClasse(m.feuille(), 'cl-arrets-titre')[0].textContent, parClasse(m.feuille(), 'cl-arret').map((x) => x.children[0].textContent)], ['Arrêts reliés à cette fiche (2) :', ['100 rue boisjoli, saint-boniface · Coupe de gazon, Déneigement']]);
  await ouvrirFiche('Côme Garceau');
  eq('… une fiche sans arrêt le dit', parClasse(m.feuille(), 'cl-arrets-titre')[0].textContent, 'Aucun arrêt relié à cette fiche (voir « Arrêts sans fiche »).');
  await ouvrirFiche('Claude Lafreniere');
  m.repondre(false);
  await cliquer(parClasse(m.feuille(), 'cl-arret')[0].children[1]);
  eq('« Délier » demande confirmation ; « Annuler » n\'écrit rien', [m.appels.confirmations.at(-1)[0], m.requetes('stops', 'update').length], ['Délier cet arrêt ?', 0]);
  m.repondre(true);
  await cliquer(parClasse(m.feuille(), 'cl-arret')[0].children[1]);
  const u = m.requetes('stops', 'update');
  eq('« Délier » : client_id remis à vide sur les DEUX arrêts de l\'adresse', [u.length, u[0].valeur, u[0].filtres], [1, { client_id: null }, [['in', 'id', ['s1', 's2']]]]);
  eq('… les arrêts de l\'application sont mis à jour ; la feuille se rouvre à jour', [m.run(`stops.filter(s => s.client_id === 'c1').length`), parClasse(m.feuille(), 'cl-arrets-titre')[0].textContent, m.toasts.at(-1)], [0, 'Aucun arrêt relié à cette fiche (voir « Arrêts sans fiche »).', '✔ Arrêt délié']);
  eq('… l\'adresse revient dans « Arrêts sans fiche » (une de plus)', m.filtres().find((b) => b.textContent.startsWith('Arrêts sans fiche')).textContent, 'Arrêts sans fiche (6)');
  eq('délier ne modifie JAMAIS la fiche', [m.requetes('clients', 'update').length, m.requetes('stops', 'delete').length], [0, 0]);
}

log('=== ÉTAPE 2 : COPIER UN CLIENT VERS UNE AUTRE ROUTE COPIE AUSSI SA FICHE ===');
{
  const m = monde();
  vm.runInContext(lire('js/admin-routes.js'), m.ctx, { filename: 'js/admin-routes.js' });
  m.run(`routes = [{id:'r1', nom:'R1'}, {id:'r2', nom:'R2'}]; renderRoutesAdmin = () => {}; signalerEchecReseau = () => {};
    stops = [{id:'sa', adresse:'1 rue A', client:'Un', service:'Sel', lat:1, lon:2, zone_points:null, actif:true, route_id:'r1', ordre:0, client_id:'c1'},
             {id:'sb', adresse:'2 rue B', client:'Deux', service:'Sel', lat:1, lon:2, zone_points:null, actif:true, route_id:'r1', ordre:1, client_id:null}];
    routesAdminListeSource = stops.slice(); routesAdminCoches = new Set(['sa', 'sb']); routesAdminDestination = 'r2'; routesAdminServiceOverride = '';`);
  await m.run('copierClientsAdmin()');
  const ins = m.requetes('stops', 'insert');
  eq('copier vers une autre route : la copie garde la MÊME fiche du répertoire (ou aucune)', [ins.length, ins[0].valeur.map((c) => c.client_id)], [1, ['c1', null]]);
}

// ═════════════════════════════════════════════════════════════════
// ÉTAPE 3 : LES INSCRIPTIONS REÇUES DE LA PAGE PUBLIQUE
// ═════════════════════════════════════════════════════════════════
log('=== ÉTAPE 3 : LES FONCTIONS PURES ===');
{
  const m = monde();
  const ch = (x) => m.run(`clientsChiffres10(${JSON.stringify(x)})`);
  eq('les 10 derniers chiffres d’un numéro, quelle que soit l’écriture', [ch('+18195551234'), ch('(819) 555-1234'), ch('819-555-1234'), ch('555-1234'), ch(''), m.run('clientsChiffres10(null)')], ['8195551234', '8195551234', '8195551234', '', '', '']);
  const sug = (insc, max) => m.run(`clientsSuggestionsInscription(${JSON.stringify(insc)}, ${JSON.stringify(FICHES())}, ${max ?? 6})`).map((f) => f.id);
  const base = { nom: 'Inconnu Total', adresse: '9 rue Nulle part', cellulaire: '+18190000000', courriel: null };
  eq('suggestion : même cellulaire que le TÉLÉPHONE de la fiche (QuickBooks), écrit autrement', sug({ ...base, cellulaire: '+18195353086' }), ['c1']);
  eq('… même cellulaire que le cellulaire de la fiche', sug({ ...base, cellulaire: '+18195551234' }), ['c5']);
  eq('… même courriel (majuscules ignorées)', sug({ ...base, courriel: 'KAMTCHOM@yahoo.fr' }), ['c2']);
  eq('… même courriel même si la fiche l’écrit avec des majuscules', m.run(`clientsSuggestionsInscription({nom:'Z', adresse:'', cellulaire:'', courriel:'np@exemple.ca'}, [{id:'x', nom:'Autre', courriel:'Np@Exemple.CA', actif:true}], 6)`).map((f) => f.id), ['x']);
  eq('… même numéro civique ET même rue', sug({ ...base, adresse: '5352 rue Burrill, Shawinigan' }), ['c4']);
  eq('… même nom (accents et majuscules ignorés)', sug({ ...base, nom: 'COME garceau' }), ['c3']);
  eq('… un nom trop court (moins de 5 lettres) ne suggère rien par « contenu »', sug({ ...base, nom: 'Zed' }), []);
  eq('… une fiche archivée n’est jamais suggérée', sug({ ...base, cellulaire: '+18195550000', nom: 'Vieille Fiche', adresse: '3 rue C, Charette' }), []);
  eq('… plusieurs indices : la fiche la plus sûre d’abord (cellulaire 6 > courriel 5 > adresse 4 > nom 3)', sug({ nom: 'Zedbed', adresse: '5352 rue Burrill', cellulaire: '+18195391112', courriel: 'kamtchom@yahoo.fr' }), ['c4', 'c2']);
  eq('… au plus « max »', sug({ nom: 'Zedbed', adresse: '5352 rue Burrill', cellulaire: '+18195391112', courriel: 'kamtchom@yahoo.fr' }, 1), ['c4']);
  eq('… une inscription sans rien d’utilisable : aucune suggestion', sug({ nom: '', adresse: '', cellulaire: '', courriel: '' }), []);
  const p = (c) => m.run(`clientsMessagePromo(${JSON.stringify(c)})`);
  eq('le message sur les offres par courriel selon la réponse du serveur', [p('appliquee'), p('non_demandee'), p('inconnu'), p(undefined)], [' Il accepte aussi les offres par courriel : c’est noté.', '', '', '']);
  eq('… les trois cas où RIEN n’est activé le disent', [/rien n’a été activé/.test(p('desabonne_des_courriels')), /courriel de la fiche est différent/.test(p('courriel_different')), /retirées depuis/.test(p('retire_depuis'))], [true, true, true]);
  const e = (x) => m.run(`clientsMessageErreurInscription(${JSON.stringify(x)})`);
  eq('les messages d’erreur du serveur sont précis', [e({ message: 'inscription_deja_traitee' }), e({ message: 'inscription_introuvable' }), e({ message: 'client_introuvable' }), e({ message: 'non_autorise' })],
    ['❌ Cette inscription a déjà été traitée (la liste va se rafraîchir).', '❌ Cette inscription n’existe plus (la liste va se rafraîchir).', '❌ Cette fiche n’existe plus ou est archivée.', '❌ Réservé à l’administrateur.']);
  eq('… fonction absente, ou erreur inconnue', [e({ message: 'Could not find the function public.admin_relier_inscription', code: 'PGRST202' }), e({ message: 'boum' })], ['❌ La fonction n’est pas installée sur Supabase (fichier SQL 30).', '❌ L’opération a échoué : boum.']);
  eq('nouvelles et traitées : séparées selon le statut', [m.run(`clientsInscNouvelles(${JSON.stringify(INSC())}).map(i => i.id)`), m.run(`clientsInscTraitees(${JSON.stringify(INSC())}).map(i => i.id)`)], [['i1', 'i2'], ['i3', 'i4']]);
}

log('=== ÉTAPE 3 : L’ÉCRAN « INSCRIPTIONS » ===');
{
  const m = monde();
  await m.ouvrir();
  const puce = (t) => m.filtres().find((b) => b.textContent.startsWith(t));
  eq('la puce « Inscriptions (N) » compte les NOUVELLES seulement', puce('Inscriptions').textContent, 'Inscriptions (2)');
  const lect = m.requetes('inscriptions_avis');
  eq('une seule lecture des inscriptions, la plus récente d’abord', [lect.length, lect[0].ordres[0]], [1, ['cree_le', 'desc']]);
  vrai('… sans JAMAIS demander l’empreinte de l’adresse IP ni le navigateur', !/ip_hash|agent/.test(lect[0].cols), lect[0].cols);
  await cliquer(puce('Inscriptions'));
  eq('la liste montre les nouvelles inscriptions, la plus récente d’abord', m.noms(), ['Nouvelle Personne', 'Claude Lafreniere']);
  const l = m.lignes();
  eq('… chacune avec son adresse, son cellulaire en 10 chiffres et son courriel', [l[0].adresses[0], l[0].contact], ['55 rue Nouvelle, Charette', '📱 819 555-0000 · ✉ np@exemple.ca']);
  eq('… « Nouvelle » en badge ; « ✉ offres par courriel » seulement pour qui l’a coché', [l[0].badges, parClasse(l[0].noeud, 'su-n').some((x) => /offres par courriel/.test(x.textContent)), parClasse(l[1].noeud, 'su-n').some((x) => /offres par courriel/.test(x.textContent))], [['Nouvelle'], true, false]);
  const sous = parClasse(m.corps(), 'su-puces')[0].children.map((b) => b.textContent);
  eq('deux sous-puces : Nouvelles et Traitées avec leur nombre', sous, ['Nouvelles (2)', 'Traitées (2)']);
  await cliquer(parClasse(m.corps(), 'su-puces')[0].children[1]);
  eq('« Traitées » : la reliée et l’ignorée, chacune avec son état', m.lignes().map((x) => [x.nom, x.badges[0]]), [['Marie Inscrite', 'Reliée à Marie Inscrite'], ['Test Robot', 'Ignorée']]);
  eq('aucune écriture en regardant les inscriptions', [m.appels.rpc.length, m.requetes('clients', 'update').length], [0, 0]);
  // aucune nouvelle
  const m2 = monde({ inscriptions: INSC().filter((i) => i.statut !== 'nouvelle') });
  await m2.ouvrir();
  await cliquer(m2.filtres().find((b) => b.textContent.startsWith('Inscriptions')));
  eq('aucune nouvelle inscription : un message de réussite', [m2.filtres().find((b) => b.textContent.startsWith('Inscriptions')).textContent, m2.messages()], ['Inscriptions (0)', ['✔ Aucune nouvelle inscription à traiter.']]);
  // la table absente
  const m3 = monde({ sansTableInsc: true });
  await m3.ouvrir();
  await cliquer(m3.filtres().find((b) => b.textContent.startsWith('Inscriptions')));
  eq('table absente ou en panne : le dit (jamais « aucune inscription ») ; le reste du répertoire fonctionne', [m3.filtres().find((b) => b.textContent.startsWith('Inscriptions')).textContent, m3.messages(), !!m3.bouton('↻ Réessayer')], ['Inscriptions', ['Les inscriptions n’ont pas pu être lues (ou le fichier SQL 30 n’est pas encore activé).'], true]);
  await cliquer(m3.filtres()[0]);
  eq('… la liste des fiches s’affiche quand même', m3.noms().length, 6);
}

log('=== ÉTAPE 3 : RELIER UNE INSCRIPTION À UNE FICHE ===');
{
  const m = monde();
  await m.ouvrir();
  await cliquer(m.filtres().find((b) => b.textContent.startsWith('Inscriptions')));
  const ouvrir = async (nom) => cliquer(m.lignes().find((x) => x.nom === nom).noeud.children[0].children[0]);
  const choix = () => parClasse(m.feuille(), 'cl-choix').map((b) => b.textContent);
  await ouvrir('Claude Lafreniere');
  vrai('toucher une inscription ouvre sa feuille (titre = le nom)', m.feuilleOuverte() && m.el('clients-feuille-titre').textContent === 'Claude Lafreniere');
  eq('… la fiche la plus probable est proposée (même numéro de téléphone)', choix(), ['Claude Lafreniere — 100 rue Boisjoli, Saint-Boniface']);
  m.repondre(false);
  await cliquer(parClasse(m.feuille(), 'cl-choix')[0]);
  const conf = m.appels.confirmations.at(-1);
  eq('relier demande une confirmation qui dit CE QUI VA ARRIVER (numéro, inscription aux textos, date)', [conf[0], /819 535-3086/.test(conf[1]), /inscrit aux avis par texto/.test(conf[1]), /sera remplacé/.test(conf[1])], ['Relier cette inscription à « Claude Lafreniere » ?', true, true, false]);
  eq('… « Annuler » : aucun appel au serveur', m.appels.rpc.length, 0);
  m.repondre(true);
  const lecturesAvant = m.requetes('clients').length;
  await cliquer(parClasse(m.feuille(), 'cl-choix')[0]);
  eq('« Relier » : UN appel à admin_relier_inscription avec la bonne inscription et la bonne fiche', m.appels.rpc, [{ nom: 'admin_relier_inscription', args: { p_inscription_id: 'i1', p_client_id: 'c1' } }]);
  eq('… les fiches ET les inscriptions sont relues (le serveur change les deux)', [m.requetes('clients').length - lecturesAvant, m.requetes('inscriptions_avis').length], [1, 2]);
  vrai('… la feuille se ferme, le message le dit', !m.feuilleOuverte() && m.toasts.at(-1) === '✔ Inscription reliée à Claude Lafreniere.');
  eq('… l’inscription quitte les nouvelles ; la puce compte une de moins', [m.noms(), m.filtres().find((b) => b.textContent.startsWith('Inscriptions')).textContent], [['Nouvelle Personne'], 'Inscriptions (1)']);
  eq('… la fiche est maintenant inscrite aux textos (lu depuis la base)', m.donnees.clients.find((c) => c.id === 'c1').avis_texto, true);
  eq('l’application n’écrit JAMAIS elle-même un consentement (aucune écriture directe dans clients ni dans le registre)', [m.requetes('clients', 'update').length, m.requetes('clients', 'insert').length, m.requetes('consentements', 'insert').length], [0, 0, 0]);
  // le cellulaire de la fiche sera remplacé ; les offres par courriel
  await ouvrir('Nouvelle Personne');
  taper(m.champ('cl-insc-rech'), 'inscrite');
  eq('une recherche remplace les propositions', choix(), ['Marie Inscrite — 1 rue A, Charette']);
  await cliquer(parClasse(m.feuille(), 'cl-choix')[0]);
  const c2 = m.appels.confirmations.at(-1);
  eq('la confirmation dit que le cellulaire actuel de la fiche sera REMPLACÉ, et que les offres par courriel sont cochées', [/sera remplacé/.test(c2[1]), /819 555-1234/.test(c2[1]), /offres par courriel/.test(c2[1])], [true, true, true]);
  eq('… la réponse « appliquee » est annoncée', m.toasts.at(-1), '✔ Inscription reliée à Marie Inscrite. Il accepte aussi les offres par courriel : c’est noté.');
}

log('=== ÉTAPE 3 : LE MÊME NUMÉRO, ET UNE CRÉATION LAISSÉE DE CÔTÉ ===');
{
  const m = monde({ fiches: [...FICHES(), F('c9', 'Même Numéro', { adresse: '77 rue Neuve', ville: 'Charette', cellulaire: '+18195550000', courriel: 'mn@x.ca' })] });
  await m.ouvrir();
  await cliquer(m.filtres().find((b) => b.textContent.startsWith('Inscriptions')));
  await cliquer(m.lignes().find((x) => x.nom === 'Nouvelle Personne').noeud.children[0].children[0]);
  await cliquer(parClasse(m.feuille(), 'cl-choix')[0]);
  const conf = m.appels.confirmations.at(-1);
  eq('la fiche a DÉJÀ ce cellulaire (écrit autrement) : la confirmation ne parle PAS de le remplacer', [conf[0], /sera remplacé/.test(conf[1])], ['Relier cette inscription à « Même Numéro » ?', false]);
  // une création commencée à partir d'une inscription, jamais fermée, puis une autre fiche ouverte par le code
  await cliquer(m.champ('cl-insc-nouvelle') ?? m.champ('cl-enregistrer'));
  const x = monde();
  await x.ouvrir();
  await cliquer(x.filtres().find((b) => b.textContent.startsWith('Inscriptions')));
  await cliquer(x.lignes().find((l) => l.nom === 'Nouvelle Personne').noeud.children[0].children[0]);
  await cliquer(x.champ('cl-insc-nouvelle'));
  x.run('clientsOuvrirFeuille(null)');
  eq('ouvrir ensuite une fiche libre sans fermer la précédente : aucune inscription n’y reste attachée', x.run('_clientsInscALier'), null);
}

log('=== ÉTAPE 3 : LES RÉPONSES DU SERVEUR SUR LES OFFRES PAR COURRIEL ===');
{
  const m = monde();
  await m.ouvrir();
  await cliquer(m.filtres().find((b) => b.textContent.startsWith('Inscriptions')));
  await cliquer(m.lignes().find((x) => x.nom === 'Nouvelle Personne').noeud.children[0].children[0]);
  taper(m.champ('cl-insc-rech'), 'zedbed');
  await cliquer(parClasse(m.feuille(), 'cl-choix')[0]);
  eq('offres acceptées et appliquées : « c’est noté »', m.toasts.at(-1), '✔ Inscription reliée à Zedbed. Il accepte aussi les offres par courriel : c’est noté.');
  for (const [code, motif] of [['courriel_different', /courriel de la fiche est différent/], ['desabonne_des_courriels', /s’était désabonné/], ['retire_depuis', /retirées depuis/]]) {
    const x = monde({ promoReponse: code });
    await x.ouvrir();
    await cliquer(x.filtres().find((b) => b.textContent.startsWith('Inscriptions')));
    await cliquer(x.lignes().find((l) => l.nom === 'Nouvelle Personne').noeud.children[0].children[0]);
    taper(x.champ('cl-insc-rech'), 'zedbed');
    await cliquer(parClasse(x.feuille(), 'cl-choix')[0]);
    vrai('réponse « ' + code + ' » : le message dit pourquoi et que RIEN n’a été activé', motif.test(x.toasts.at(-1)) && /rien n’a été activé/.test(x.toasts.at(-1)), x.toasts.at(-1));
  }
}

log('=== ÉTAPE 3 : LES REFUS DU SERVEUR ===');
{
  const ouvrirPremiere = async (m) => {
    await m.ouvrir();
    await cliquer(m.filtres().find((b) => b.textContent.startsWith('Inscriptions')));
    await cliquer(m.lignes().find((x) => x.nom === 'Claude Lafreniere').noeud.children[0].children[0]);
    await cliquer(parClasse(m.feuille(), 'cl-choix')[0]);
  };
  let m = monde({ rpcErreurs: { admin_relier_inscription: { message: 'inscription_deja_traitee' } } });
  await ouvrirPremiere(m);
  eq('une inscription déjà traitée ailleurs : le dit, relit la liste, ferme la feuille', [m.toasts.at(-1), m.feuilleOuverte(), m.requetes('inscriptions_avis').length], ['❌ Cette inscription a déjà été traitée (la liste va se rafraîchir).', false, 2]);
  m = monde({ rpcErreurs: { admin_relier_inscription: { message: 'client_introuvable' } } });
  await ouvrirPremiere(m);
  eq('une fiche archivée entre-temps : message clair, la feuille reste ouverte (on peut choisir une autre fiche)', [m.toasts.at(-1), m.feuilleOuverte()], ['❌ Cette fiche n’existe plus ou est archivée.', true]);
  m = monde({ rpcPanne: () => true });
  await ouvrirPremiere(m);
  eq('pas de réseau : « rien n’a été changé », la feuille reste ouverte, le bouton n’est pas bloqué', [m.toasts.at(-1), m.feuilleOuverte(), m.run('_clientsOccupe')], ['📴 Pas de réseau : rien n’a été changé.', true, false]);
  eq('… l’indicateur de synchronisation est éteint', m.appels.sync.at(-1), false);
  m = monde({ rpcReponse: { data: null, error: null } });
  await ouvrirPremiere(m);
  eq('une réponse inattendue du serveur n’est JAMAIS annoncée comme réussie', [/Réponse inattendue/.test(m.toasts.at(-1)), m.feuilleOuverte()], [true, true]);
}

log('=== ÉTAPE 3 : IGNORER UNE INSCRIPTION ===');
{
  const m = monde();
  await m.ouvrir();
  await cliquer(m.filtres().find((b) => b.textContent.startsWith('Inscriptions')));
  await cliquer(m.lignes().find((x) => x.nom === 'Nouvelle Personne').noeud.children[0].children[0]);
  m.repondre(false);
  await cliquer(m.champ('cl-insc-ignorer'));
  eq('ignorer demande confirmation ; « Annuler » n’appelle rien', [m.appels.confirmations.at(-1)[0], m.appels.rpc.length], ['Ignorer cette inscription ?', 0]);
  m.repondre(true);
  await cliquer(m.champ('cl-insc-ignorer'));
  eq('« Ignorer » : UN appel à admin_ignorer_inscription', m.appels.rpc, [{ nom: 'admin_ignorer_inscription', args: { p_inscription_id: 'i2' } }]);
  vrai('… le message, la feuille fermée, l’inscription passe dans « Traitées »', m.toasts.at(-1) === '✔ Inscription ignorée' && !m.feuilleOuverte() && m.noms().join() === 'Claude Lafreniere' && m.filtres().find((b) => b.textContent.startsWith('Inscriptions')).textContent === 'Inscriptions (1)');
  eq('ignorer ne crée ni ne modifie jamais une fiche', [m.requetes('clients', 'update').length, m.requetes('clients', 'insert').length], [0, 0]);
  // refus
  const x = monde({ rpcErreurs: { admin_ignorer_inscription: { message: 'inscription_deja_traitee' } } });
  await x.ouvrir();
  await cliquer(x.filtres().find((b) => b.textContent.startsWith('Inscriptions')));
  await cliquer(x.lignes().find((l) => l.nom === 'Nouvelle Personne').noeud.children[0].children[0]);
  await cliquer(x.champ('cl-insc-ignorer'));
  eq('une inscription déjà traitée : le dit et relit la liste', [x.toasts.at(-1), x.feuilleOuverte()], ['❌ Cette inscription a déjà été traitée (la liste va se rafraîchir).', false]);
  const y = monde({ rpcReponse: { data: { statut: 'autre' }, error: null } });
  await y.ouvrir();
  await cliquer(y.filtres().find((b) => b.textContent.startsWith('Inscriptions')));
  await cliquer(y.lignes().find((l) => l.nom === 'Nouvelle Personne').noeud.children[0].children[0]);
  await cliquer(y.champ('cl-insc-ignorer'));
  eq('une réponse inattendue n’est jamais annoncée comme réussie', [/Réponse inattendue/.test(y.toasts.at(-1)), y.feuilleOuverte()], [true, true]);
  // une inscription traitée : consultation seulement
  await cliquer(y.filtres().find((b) => b.textContent.startsWith('Inscriptions')));
  await cliquer(parClasse(y.corps(), 'su-puces')[0].children[1]);
  await cliquer(y.lignes().find((l) => l.nom === 'Marie Inscrite').noeud.children[0].children[0]);
  eq('une inscription déjà traitée s’ouvre en consultation seulement (ni relier ni ignorer)', [parClasse(y.feuille(), 'cl-insc-statut')[0].textContent.startsWith('Reliée à la fiche « Marie Inscrite »'), y.champ('cl-insc-ignorer'), parClasse(y.feuille(), 'cl-choix').length], [true, undefined, 0]);
}

log('=== ÉTAPE 3 : CRÉER UNE FICHE À PARTIR D’UNE INSCRIPTION ===');
{
  const m = monde();
  await m.ouvrir();
  await cliquer(m.filtres().find((b) => b.textContent.startsWith('Inscriptions')));
  await cliquer(m.lignes().find((x) => x.nom === 'Nouvelle Personne').noeud.children[0].children[0]);
  await cliquer(m.champ('cl-insc-nouvelle'));
  eq('la fiche s’ouvre avec le nom, l’adresse et le courriel de l’inscription', [m.el('clients-feuille-titre').textContent, m.champ('cl-nom').value, m.champ('cl-adresse').value, m.champ('cl-courriel').value, m.champ('cl-cell').value], ['Nouveau client', 'Nouvelle Personne', '55 rue Nouvelle, Charette', 'np@exemple.ca', '']);
  vrai('… et dit que l’inscription lui sera reliée (cellulaire ajouté, inscription aux textos)', /sera reliée à cette fiche/.test(parClasse(m.feuille(), 'cl-lier-info')[0].textContent) && /819 555-0000/.test(parClasse(m.feuille(), 'cl-lier-info')[0].textContent));
  await cliquer(m.champ('cl-enregistrer'));
  const ins = m.requetes('clients', 'insert');
  eq('enregistrer : la fiche est créée SANS cellulaire ni avis (c’est le serveur qui les ajoute en reliant)', [ins.length, ins[0].valeur[0].cellulaire, ins[0].valeur[0].avis_courriel], [1, null, false]);
  eq('… PUIS l’inscription est reliée à la NOUVELLE fiche', [m.appels.rpc.length, m.appels.rpc[0].nom, m.appels.rpc[0].args.p_inscription_id, m.appels.rpc[0].args.p_client_id === m.donnees.clients.find((c) => c.nom === 'Nouvelle Personne').id], [1, 'admin_relier_inscription', 'i2', true]);
  vrai('… un message : fiche créée et inscription reliée (+ les offres par courriel)', m.toasts.at(-1) === '✔ Fiche créée et inscription reliée. Il accepte aussi les offres par courriel : c’est noté.' && !m.feuilleOuverte());
  eq('… la fiche est inscrite aux textos avec le cellulaire de l’inscription (lu depuis la base)', [m.donnees.clients.find((c) => c.nom === 'Nouvelle Personne').cellulaire, m.donnees.clients.find((c) => c.nom === 'Nouvelle Personne').avis_texto], ['+18195550000', true]);
  eq('… l’inscription quitte les nouvelles', m.noms(), ['Claude Lafreniere']);
  // le lien est refusé après la création
  const x = monde({ rpcErreurs: { admin_relier_inscription: { message: 'inscription_deja_traitee' } } });
  await x.ouvrir();
  await cliquer(x.filtres().find((b) => b.textContent.startsWith('Inscriptions')));
  await cliquer(x.lignes().find((l) => l.nom === 'Nouvelle Personne').noeud.children[0].children[0]);
  await cliquer(x.champ('cl-insc-nouvelle'));
  await cliquer(x.champ('cl-enregistrer'));
  eq('la fiche est créée mais le serveur refuse le lien : un message qui dit les DEUX choses', [x.toasts.at(-1), x.donnees.clients.some((c) => c.nom === 'Nouvelle Personne')], ['⚠ Fiche créée, mais l’inscription n’a pas pu être reliée : Cette inscription a déjà été traitée (la liste va se rafraîchir).', true]);
  // abandonner la création
  const z = monde();
  await z.ouvrir();
  await cliquer(z.filtres().find((b) => b.textContent.startsWith('Inscriptions')));
  await cliquer(z.lignes().find((l) => l.nom === 'Nouvelle Personne').noeud.children[0].children[0]);
  await cliquer(z.champ('cl-insc-nouvelle'));
  z.run('clientsFermerFeuille()');
  eq('abandonner la création vide l’inscription à relier (aucun reste en mémoire)', z.run('_clientsInscALier'), null);
  await cliquer(z.filtres()[0]);
  await cliquer(z.bouton('＋ Nouveau client'));
  regler(z, 'cl-nom', 'Fiche Libre');
  await cliquer(z.champ('cl-enregistrer'));
  eq('une fiche créée ensuite par « ＋ Nouveau client » ne relie AUCUNE inscription', z.appels.rpc.length, 0);
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
