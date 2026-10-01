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

  const donnees = { clients: o.fiches ?? FICHES() };
  const appels = { requetes: [], toasts: [], confirmations: [], sync: [] };
  let compteur = 0;
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const executer = async (q) => {
    appels.requetes.push({ table: q.table, op: q.op, cols: q.cols, filtres: q.filtres, ordres: q.ordres, plage: q.plage, valeur: q.valeur, retour: q.retour });
    const lignes = donnees[q.table] ?? [];
    if (o.retards?.[q.table + '.' + q.op]?.length) await o.retards[q.table + '.' + q.op].shift();
    if (o.panne?.(q)) throw new TypeError('Failed to fetch');
    const cle = q.table + '.' + q.op;
    if (o.erreurs?.[cle]) { const e = typeof o.erreurs[cle] === 'function' ? o.erreurs[cle](q) : o.erreurs[cle]; if (e) return { data: null, error: e }; }
    const filtrer = (l) => q.filtres.every(([f, c, v]) => (f === 'eq' ? l[c] === v : true));
    if (q.op === 'select') {
      let r = lignes.filter(filtrer).map((l) => ({ ...l }));
      r.sort((x, y) => { for (const [c, sens] of q.ordres) { const d = cmp(x[c], y[c]); if (d) return (sens === 'desc' ? -1 : 1) * d; } return 0; });   // tous les critères ensemble, dans l'ordre demandé
      if (q.plage) r = r.slice(q.plage[0], q.plage[1] + 1);
      return { data: r, error: null };
    }
    if (q.op === 'update') {
      if (o.refus) return { data: [], error: null };   // les règles d'accès refusent SANS erreur : aucune ligne changée
      const touches = lignes.filter(filtrer);
      touches.forEach((l) => Object.assign(l, q.valeur, o.serveurNormalise ? o.serveurNormalise(q.valeur, l) : {}));
      return { data: touches.map((l) => ({ ...l })), error: null };
    }
    if (q.op === 'insert') {
      if (o.refus) return { data: [], error: null };
      const ajoutes = q.valeur.map((v) => ({ ...F('c-nouveau-' + (++compteur), v.nom), ...v }));
      ajoutes.forEach((a) => lignes.push(a));
      return { data: ajoutes.map((a) => ({ ...a })), error: null };
    }
    return { data: null, error: { message: 'opération inconnue' } };
  };
  const fauxDb = {
    channel() { const c = { on() { return c; }, subscribe() { return c; } }; return c; },
    rpc: async () => ({ data: null, error: null }),
    from: (table) => {
      const q = { table, op: 'select', cols: null, filtres: [], ordres: [], plage: null, valeur: null, retour: null };
      q.select = (c) => { if (q.op === 'select') q.cols = c; else q.retour = c ?? '*'; return q; };
      q.eq = (c, v) => { q.filtres.push(['eq', c, v]); return q; };
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
  vm.runInContext(`db = __db; stops = ${JSON.stringify(o.arrets ?? ARRETS())}; currentUser = ${JSON.stringify(JOE)}; _adminOnglet = 'clients';
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
  eq('… la puce choisie est marquée, les autres non', m.filtres().map((b) => b.className), ['su-puce', 'su-puce on', 'su-puce', 'su-puce']);
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

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
