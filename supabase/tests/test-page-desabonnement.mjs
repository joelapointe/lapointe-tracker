// Demande 5, chantier C (1ᵉʳ oct. 2026) — La PAGE PUBLIQUE de désabonnement des courriels d'avis (site-consentement/desabonnement.html + js/desabonnement.js) : le lien au bas de chaque courriel.
// Les vrais fichiers sont chargés dans un vrai DOM (jsdom) ; un FAUX serveur (fetch) répond à la place de Supabase, mais avec la VRAIE base (PGlite, fichiers SQL 30, 31 et 32) :
// le bouton désabonne VRAIMENT le client (fonction avis_desabonner_par_jeton, registre des consentements).
// Ce que ce test NE peut PAS vérifier : le vrai Supabase / PostgREST (le premier courriel d'essai, puis un vrai clic, le vérifient), ni l'apparence sur un téléphone (essai dans le navigateur de Claude).
// SITE_TEST (variable d'environnement) : une COPIE abîmée de « site-consentement » (erreurs volontaires) ; le vrai dossier n'est jamais touché.
import { JSDOM, VirtualConsole } from 'jsdom';
import { prepare } from './prepare.mjs';
import fs from 'fs';
import { fileURLToPath } from 'url';

const SITE = process.env.SITE_TEST ? process.env.SITE_TEST.split('\\').join('/').replace(/\/?$/, '/') : fileURLToPath(new URL('../../site-consentement/', import.meta.url));
const SQL_DIR = fileURLToPath(new URL('../', import.meta.url));
const lire = (f) => fs.readFileSync(SITE + f, 'utf8');
const lireVrai = (f) => fs.readFileSync(fileURLToPath(new URL('../../site-consentement/', import.meta.url)) + f, 'utf8');

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
const attendre = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
const TRACEURS = /googletagmanager|gtag\(|\bfbq\(|connect\.facebook\.net|facebook\.com\/tr|google-analytics|doubleclick|hotjar|clarity\.ms|adsbygoogle/i;

// ── La vraie base ──────────────────────────────────────────────────
const FILES = ['01-etape6-utilisateurs.sql', '02-etape7-modele-passes-quarts.sql', '03-etape8-regles-acces.sql', '04-etape9a-quarts-equipage.sql',
  '05-etape9b-passes-fermetures-export.sql', '13-etape13-taches-et-tours-partages.sql', '14-etape13d-retrait-stops-fait.sql', '15-etape14c-dernier-tour-visible.sql',
  '16-etape14e-photo-probleme.sql', '17-etape15-equipage-precedent.sql', '18-etape16d-heure-des-gestes-sans-reseau.sql', '19-etape16d-annulation-ignoree-precisee.sql'];
const db = await prepare(FILES);
await db.exec(`grant usage on schema public to service_role;`);
await db.exec(`alter default privileges in schema public grant all on tables to anon, authenticated, service_role;`);
await db.exec(`alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`);
for (const f of ['30-repertoire-clients-et-inscriptions.sql', '31-avis-aux-clients.sql', '32-avis-canaux-et-apercu.sql']) await db.exec(fs.readFileSync(SQL_DIR + f, 'utf8'));
const q = async (sql, p) => { await db.query('reset role'); return (await db.query(sql, p)).rows; };
const jeton = async (id) => (await q(`select public.avis_jeton($1::uuid, 'courriel') j`, [id]))[0].j;
const nouveau = async (nom, courriel) => (await q(`insert into public.clients (nom, courriel, avis_courriel) values ($1, $2, true) returning id`, [nom, courriel]))[0].id;
const etat = async (id) => (await q(`select desabonne_courriel_le is not null d from public.clients where id = $1`, [id]))[0].d;

// ── Le faux serveur : la vraie fonction de la base, appelée comme un VISITEUR (rôle anon) ──────────
async function serveurBase(url, options) {
  if (!/\/rest\/v1\/rpc\/avis_desabonner_par_jeton$/.test(url)) return { ok: false, status: 404, text: () => Promise.resolve('{}') };
  const a = JSON.parse(options.body);
  await db.query('reset role'); await db.query('set role anon');
  try {
    const r = await db.query(`select public.avis_desabonner_par_jeton($1::uuid, $2::text) as r`, [a.p_client_id, a.p_jeton]);
    return { ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(r.rows[0].r)) };
  } catch (e) {
    return { ok: false, status: 400, text: () => Promise.resolve(JSON.stringify({ message: e.message })) };
  } finally { await db.query('reset role'); }
}

function ouvrir(recherche, opts = {}) {
  const erreursPage = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => erreursPage.push(e.message));
  const dom = new JSDOM(lire('desabonnement.html'), { url: 'https://www.entretienlapointe.ca/desabonnement.html' + recherche, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window, doc = w.document;
  const appels = [], minuteries = [];
  if (opts.sansFetch) w.fetch = undefined;
  else w.fetch = (url, options) => { appels.push({ url, options, corps: JSON.parse(options.body), signal: options.signal }); return (opts.reponse || serveurBase)(url, options); };
  w.setTimeout = (f, ms) => { minuteries.push({ f, ms }); return minuteries.length; };
  w.clearTimeout = () => {};
  w.eval(lire('js/desabonnement.js'));
  const $ = (id) => doc.getElementById(id);
  return { w, doc, appels, minuteries, erreursPage, $,
    visible: (id) => !$(id).hidden,
    bouton: () => $('des-bouton'),
    cliquer: async () => { $('des-bouton').click(); await attendre(); },
    texte: (id) => $(id).textContent.replace(/\s+/g, ' ').trim(),
    html: (id) => $(id).innerHTML };
}

const ID = '11111111-2222-4333-8444-555555555555';
const J32 = 'a'.repeat(32);

log('=== LA PAGE ET SES FICHIERS ===');
{
  const html = lire('desabonnement.html'), js = lire('js/desabonnement.js');
  eq('les fichiers de la page existent à l\u2019endroit prévu (page, script, feuille de style)', [fs.existsSync(SITE + 'desabonnement.html'), fs.existsSync(SITE + 'js/desabonnement.js'), fs.existsSync(SITE + 'css/avis.css')], [true, true, true]);
  vrai('aucun suivi (ni Google, ni Meta, ni autre) ni dans la page ni dans le script', !TRACEURS.test(html) && !TRACEURS.test(js));
  vrai('la page utilise la feuille de style du site (css/avis.css) et celle du thème', html.includes('href="css/avis.css"') && html.includes('href="css/main.css"'));
  { const d = new JSDOM(html).window.document; eq('SANS JavaScript : les trois blocs (confirmation, lien invalide, merci) sont cachés ; seul le message « il faut JavaScript » reste', [d.getElementById('des-confirmer').hidden, d.getElementById('des-incomplet').hidden, d.getElementById('des-merci').hidden, d.querySelectorAll('noscript').length], [true, true, true, 1]); }
  vrai('la page est « noindex » (jamais dans Google)', /<meta name="robots" content="noindex">/.test(html));
  vrai('la page charge son script et PAS celui de l\u2019inscription', /<script src="js\/desabonnement\.js"><\/script>/.test(html) && !/js\/avis\.js/.test(html));
  eq('la clé publique et l\u2019adresse de la base sont celles de la page d\u2019inscription (la vraie, pas une copie fautive)', [js.match(/var SUPA_KEY = '([^']+)'/)[1] === lireVrai('js/avis.js').match(/var SUPA_KEY = '([^']+)'/)[1], js.match(/var SUPA_URL = '([^']+)'/)[1] === lireVrai('js/avis.js').match(/var SUPA_URL = '([^']+)'/)[1]], [true, true]);
  eq('aucun identifiant en double dans la page', (() => { const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((x) => x[1]); return ids.length === new Set(ids).size; })(), true);
  vrai('les coordonnées de l\u2019entreprise sont sur la page (téléphone et courriel pour un désabonnement à la main)', /819 268-8069/.test(html) && /info@entretienlapointe\.ca/.test(html));
  vrai('le désabonnement ne se fait QUE par un bouton (le script n\u2019appelle fetch qu\u2019à l\u2019intérieur d\u2019une fonction déclenchée par le clic)', /bouton\.addEventListener\('click'/.test(js) && (js.match(/fetch\(SUPA_URL/g) || []).length === 1);
}

log('=== OUVRIR LE LIEN : RIEN NE SE FAIT TOUT SEUL ===');
{
  const p = ouvrir(`?c=${ID}&t=${J32}`);
  eq('un lien complet : la demande de confirmation s\u2019affiche (et seulement elle)', [p.visible('des-confirmer'), p.visible('des-incomplet'), p.visible('des-merci')], [true, false, false]);
  eq('… AUCUNE requête au chargement (un robot de sécurité qui ouvre le lien ne désabonne personne)', p.appels.length, 0);
  eq('… le bouton est actif et dit ce qu\u2019il fait', [p.bouton().disabled, p.bouton().textContent], [false, 'Je ne veux plus recevoir ces avis par courriel']);
  eq('… aucune erreur dans la page', p.erreursPage, []);
  const IDL = 'abcdef12-abcd-4abc-8abc-abcdefabcdef', JL = 'abcdef0123456789abcdef0123456789';
  const majuscules = ouvrir(`?c=${IDL.toUpperCase()}&t=${JL.toUpperCase()}`);
  eq('un lien en majuscules (certains outils les changent) : accepté', majuscules.visible('des-confirmer'), true);
  await majuscules.cliquer();
  eq('… et la requête part avec l’identifiant et le jeton en MINUSCULES (comme la base les connaît)', majuscules.appels[0].corps, { p_client_id: IDL, p_jeton: JL });
  const inverse = ouvrir(`?t=${J32}&c=${ID}`);
  eq('les deux paramètres dans l\u2019autre ordre : accepté', inverse.visible('des-confirmer'), true);
  for (const [titre, r] of [['aucun paramètre', ''], ['un « ? » seul', '?'], ['le client seulement', `?c=${ID}`], ['le jeton seulement', `?t=${J32}`], ['un identifiant invalide', `?c=pas-un-uuid&t=${J32}`], ['un jeton trop court', `?c=${ID}&t=${'a'.repeat(31)}`],
    ['un jeton trop long', `?c=${ID}&t=${'a'.repeat(33)}`], ['un jeton qui n\u2019est pas hexadécimal', `?c=${ID}&t=${'g'.repeat(32)}`], ['un paramètre de trop', `?c=${ID}&t=${J32}&x=1`], ['un paramètre sans valeur', `?c=${ID}&t=`], ['un paramètre inconnu', `?c=${ID}&z=${J32}`],
    ['un identifiant répété', `?c=${ID}&c=${ID}`], ['du HTML dans un paramètre', `?c=<script>&t=${J32}`]]) {
    const x = ouvrir(r);
    eq(`${titre} : « lien incomplet », aucune requête`, [x.visible('des-incomplet'), x.visible('des-confirmer'), x.appels.length, x.texte('des-incomplet').includes('info@entretienlapointe.ca')], [true, false, 0, true]);
  }
}

log('=== TOUCHER LE BOUTON : LE CLIENT EST VRAIMENT DÉSABONNÉ ===');
{
  const id = await nouveau('Client du lien', 'lien.client@exemple.ca');
  const t = await jeton(id);
  const p = ouvrir(`?c=${id}&t=${t}`);
  await p.cliquer();
  eq('UNE requête, vers la fonction de désabonnement de la base, avec la clé publique', [p.appels.length, p.appels[0].url, p.appels[0].options.method, p.appels[0].options.headers.apikey === p.appels[0].options.headers.Authorization.replace('Bearer ', '')], [1, 'https://uxoxdauzcxjsefuoruwt.supabase.co/rest/v1/rpc/avis_desabonner_par_jeton', 'POST', true]);
  eq('… le corps : l\u2019identifiant du client et le jeton, rien d\u2019autre', p.appels[0].corps, { p_client_id: id, p_jeton: t });
  eq('la page dit « c\u2019est fait » ; la demande de confirmation disparaît', [p.visible('des-merci'), p.visible('des-confirmer'), p.texte('des-merci').includes('Vous ne recevrez plus nos avis de passage par courriel')], [true, false, true]);
  eq('… elle rappelle ARRET pour les textos et donne le téléphone', [/ARRET/.test(p.texte('des-merci')), /819 268-8069/.test(p.texte('des-merci'))], [true, true]);
  eq('LA BASE : le client est désabonné des courriels, le registre note le retrait par le lien', [await etat(id), (await q(`select canal, action, source, contact from public.consentements where client_id = $1`, [id]))[0]], [true, { canal: 'courriel_avis', action: 'retrait', source: 'lien_desabonnement', contact: 'lien.client@exemple.ca' }]);
  const apres = await q(`select statut from public.avis_envois`);
  eq('… et l\u2019avis suivant lui sera refusé « desabonne » par la base', apres.length, 0);
}

log('=== LES LIENS QUI NE MARCHENT PAS ===');
{
  const id = await nouveau('Autre client du lien', 'autre.lien@exemple.ca');
  const faux = ouvrir(`?c=${id}&t=${'b'.repeat(32)}`);
  await faux.cliquer();
  eq('un jeton faux (bien formé) : la base refuse, la page dit « lien incomplet ou plus valide » avec les coordonnées', [faux.visible('des-incomplet'), faux.visible('des-merci'), faux.texte('des-incomplet').includes('819 268-8069')], [true, false, true]);
  eq('… personne n\u2019a été désabonné', await etat(id), false);
  const inconnu = ouvrir(`?c=99999999-2222-4333-8444-555555555555&t=${'c'.repeat(32)}`);
  await inconnu.cliquer();
  eq('un client inconnu : la même réponse (rien ne se découvre)', [inconnu.visible('des-incomplet'), inconnu.visible('des-merci')], [true, false]);
  const t = await jeton(id);
  const autre = await nouveau('Troisième', 'troisieme@exemple.ca');
  const croise = ouvrir(`?c=${autre}&t=${t}`);
  await croise.cliquer();
  eq('le jeton d\u2019un AUTRE client : refusé ; aucun des deux n\u2019est désabonné', [croise.visible('des-incomplet'), await etat(id), await etat(autre)], [true, false, false]);
}

log('=== LES PANNES ===');
{
  const id = await nouveau('Client des pannes', 'pannes@exemple.ca');
  const t = await jeton(id);
  const p = ouvrir(`?c=${id}&t=${t}`, { reponse: () => Promise.reject(new TypeError('Failed to fetch')) });
  await p.cliquer();
  eq('pas de réseau : un message qui propose le courriel et le téléphone ; le bouton redevient utilisable ; la page ne dit PAS « c\u2019est fait »', [p.visible('des-alerte'), /Connexion impossible/.test(p.texte('des-alerte')), /819 268-8069/.test(p.texte('des-alerte')), p.bouton().disabled, p.visible('des-merci')], [true, true, true, false, false]);
  eq('… rien n\u2019a été changé en base', await etat(id), false);
  const e500 = ouvrir(`?c=${id}&t=${t}`, { reponse: () => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('{"message":"boum"}') }) });
  await e500.cliquer();
  eq('une erreur du serveur : message général avec les coordonnées ; PAS « lien invalide » ; bouton utilisable', [/Une erreur est survenue/.test(e500.texte('des-alerte')), e500.visible('des-incomplet'), e500.bouton().disabled], [true, false, false]);
  const illisible = ouvrir(`?c=${id}&t=${t}`, { reponse: () => Promise.resolve({ ok: false, status: 502, text: () => Promise.resolve('<html>erreur</html>') }) });
  await illisible.cliquer();
  eq('une réponse illisible : message général (jamais « c\u2019est fait »)', [/Une erreur est survenue/.test(illisible.texte('des-alerte')), illisible.visible('des-merci')], [true, false]);
  const faussement = ouvrir(`?c=${id}&t=${t}`, { reponse: () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{"statut":"autre"}') }) });
  await faussement.cliquer();
  eq('une réponse « ok » qui ne dit pas « desabonne » n\u2019est PAS annoncée comme un succès', [faussement.visible('des-merci'), /Une erreur est survenue/.test(faussement.texte('des-alerte'))], [false, true]);
  const vide = ouvrir(`?c=${id}&t=${t}`, { reponse: () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') }) });
  await vide.cliquer();
  eq('une réponse vide : pas un succès non plus', vide.visible('des-merci'), false);
  const lent = ouvrir(`?c=${id}&t=${t}`, { reponse: (u, o) => new Promise((res, rej) => { o.signal.addEventListener('abort', () => rej(new Error('abort'))); }) });
  lent.bouton().click(); await attendre();
  eq('une réponse qui tarde : le bouton dit « Un instant… » et est désactivé ; un délai de 20 secondes est armé', [lent.bouton().textContent, lent.bouton().disabled, lent.minuteries.map((x) => x.ms)], ['Un instant…', true, [20000]]);
  lent.minuteries[0].f(); await attendre();
  eq('… passé 20 secondes : message de réseau, bouton rendu', [/Connexion impossible/.test(lent.texte('des-alerte')), lent.bouton().disabled, lent.visible('des-merci')], [true, false, false]);
  const sans = ouvrir(`?c=${id}&t=${t}`, { sansFetch: true });
  await sans.cliquer();
  eq('un navigateur sans fetch : message clair (téléphone, courriel), rien d\u2019envoyé', [/trop ancien/.test(sans.texte('des-alerte')), sans.visible('des-merci')], [true, false]);
  const lente2 = ouvrir(`?c=${id}&t=${t}`, { reponse: () => new Promise(() => {}) });
  lente2.bouton().click(); lente2.bouton().click(); lente2.doc.getElementById('des-bouton').dispatchEvent(new lente2.w.Event('click')); await attendre();
  eq('plusieurs clics pendant l\u2019attente : UNE seule requête', lente2.appels.length, 1);
  let essai = 0;
  const reessai = ouvrir(`?c=${id}&t=${t}`, { reponse: () => (++essai === 1 ? Promise.reject(new TypeError('Failed to fetch')) : new Promise(() => {})) });
  await reessai.cliquer();
  eq('après une panne, un NOUVEL essai efface l’ancien message pendant qu’il attend', [reessai.visible('des-alerte'), (reessai.bouton().click(), await attendre(), reessai.visible('des-alerte'))], [true, false]);
  const ok2 = ouvrir(`?c=${id}&t=${t}`);
  await ok2.cliquer();
  eq('après un échec puis un nouvel essai qui réussit : le client est désabonné', [ok2.visible('des-merci'), await etat(id)], [true, true]);
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
