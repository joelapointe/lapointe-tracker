// Demande 5 de Joé (30 sept. 2026) — Les PAGES PUBLIQUES du site : « Avis de passage par texto » (site-consentement/avis.html + js/avis.js) et « Confidentialité ».
// Les vrais fichiers sont chargés dans un vrai DOM (jsdom) : on remplit le formulaire, on clique, et un FAUX serveur (fetch) répond à la place de Supabase.
// Ce que ce test NE peut PAS vérifier : la vraie base (le fichier SQL 30 n'est pas encore exécuté chez Supabase), l'apparence sur un téléphone (essai dans le navigateur de Claude), la mise en ligne sur WHC.
// SITE_TEST : un autre dossier « site-consentement » (erreurs volontaires : voir mutations-etape-17/erreurs-volontaires-page-avis.mjs).
import { JSDOM, VirtualConsole } from 'jsdom';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import { fileURLToPath } from 'url';

const SITE = process.env.SITE_TEST ? process.env.SITE_TEST.split('\\').join('/').replace(/\/?$/, '/') : fileURLToPath(new URL('../../site-consentement/', import.meta.url));
const SQL30 = fs.readFileSync(fileURLToPath(new URL('../30-repertoire-clients-et-inscriptions.sql', import.meta.url)), 'utf8');
const CONFIG_APP = fs.readFileSync(fileURLToPath(new URL('../../www/js/config.js', import.meta.url)), 'utf8');
const lire = (f) => fs.readFileSync(SITE + f, 'utf8');

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));

const V1 = 'texto-2026-10-v1';
const CHAMPS = ['nom', 'cellulaire', 'adresse', 'courriel', 'accepte'];
const espaces = (t) => String(t).replace(/\s+/g, ' ').trim();
const attendre = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };   // laisse passer les promesses (fetch, then)
const TRACEURS = /googletagmanager|gtag\(|\bfbq\(|connect\.facebook\.net|facebook\.com\/tr|google-analytics|doubleclick|hotjar|clarity\.ms|adsbygoogle/i;

// ---------- la page ouverte dans jsdom, avec un faux serveur ----------
const rep = (ok, status, texte) => ({ ok, status, text: () => Promise.resolve(texte) });
const reponse200 = () => Promise.resolve(rep(true, 200, JSON.stringify({ statut: 'enregistree' })));
function ouvrir(opts = {}) {
  const erreursPage = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => erreursPage.push(e.message));
  const dom = new JSDOM(lire('avis.html'), { url: 'https://www.entretienlapointe.ca/avis.html', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window, doc = w.document;
  const appels = [], minuteries = [], liberees = [];
  if (opts.sansFetch) { w.fetch = undefined; }
  else w.fetch = (url, options) => { const a = { url, options, corps: JSON.parse(options.body), signal: options.signal }; appels.push(a); return (opts.reponse || reponse200)(a); };
  w.setTimeout = (f, ms) => { minuteries.push({ f, ms }); return minuteries.length; };
  w.clearTimeout = (id) => liberees.push(id);
  if (opts.sansAbort) { w.AbortController = undefined; }
  const boutonAvant = doc.getElementById('avis-envoi').disabled;
  w.eval(lire('js/avis.js'));
  return { dom, w, doc, appels, minuteries, liberees, erreursPage, boutonAvant };
}
const el = (m, id) => m.doc.getElementById(id);
const dire = (m, id, valeur) => { const e = el(m, id); e.value = valeur; e.dispatchEvent(new m.w.Event('input', { bubbles: true })); };
const cocher = (m, etat) => { const c = el(m, 'avis-accepte'); c.checked = etat; c.dispatchEvent(new m.w.Event('change', { bubbles: true })); };
const cocherPromo = (m, etat) => { const c = el(m, 'avis-promo'); c.checked = etat; c.dispatchEvent(new m.w.Event('change', { bubbles: true })); };
const remplir = (m, o = {}) => {
  const d = { nom: 'Marie Tremblay', cel: '(819) 555-1234', adr: '123, rue Principale, Charette', cour: 'marie@exemple.ca', coche: true, promo: false, ...o };
  dire(m, 'avis-nom', d.nom); dire(m, 'avis-cellulaire', d.cel); dire(m, 'avis-adresse', d.adr); dire(m, 'avis-courriel', d.cour); cocher(m, d.coche); cocherPromo(m, d.promo);
};
const soumettre = (m) => el(m, 'avis-envoi').click();
const erreurs = (m) => Object.fromEntries(CHAMPS.map((k) => { const e = el(m, 'avis-err-' + k); return [k, e.hidden ? '' : e.textContent]; }));
const champsEnErreur = (m) => CHAMPS.filter((k) => !el(m, 'avis-err-' + k).hidden);
const alerte = (m) => (el(m, 'avis-alerte').hidden ? '' : el(m, 'avis-alerte').textContent);
const merciVisible = (m) => !el(m, 'avis-merci').hidden;
const formCache = (m) => el(m, 'avis-form').hidden;
const champInvalide = (m, k) => (k === 'accepte' ? el(m, 'avis-accepte').parentNode : el(m, 'avis-' + k)).classList.contains('av-invalide');

// ---------- les fichiers du site ----------
const HTML = lire('avis.html'), HTML_CONF = lire('confidentialite.html'), JS = lire('js/avis.js'), CSS = lire('css/avis.css');
const statique = new JSDOM(HTML).window.document;          // la page telle quelle, SANS exécuter aucun script
const statiqueConf = new JSDOM(HTML_CONF).window.document;

log('=== LA PAGE D\'INSCRIPTION, TELLE QU\'ELLE EST ÉCRITE (avant tout script) ===');
{
  const f = (id) => statique.getElementById(id);
  eq('la langue est le français et le texte est en UTF-8', [statique.documentElement.lang, !!statique.querySelector('meta[charset="utf-8" i]')], ['fr', true]);
  eq('la page ne doit pas être indexée par Google (noindex) et elle a un titre', [statique.querySelector('meta[name="robots"]')?.content, /Avis de passage/.test(statique.title)], ['noindex', true]);
  eq('le formulaire envoie en POST et n\'a AUCUNE adresse d\'envoi : sans JavaScript, rien ne part dans l\'adresse de la page (ni nom, ni numéro)', [f('avis-form').getAttribute('method'), f('avis-form').hasAttribute('action'), f('avis-form').hasAttribute('novalidate')], ['post', false, true]);
  eq('nom : texte, 100 caractères au plus, rempli d\'office par le navigateur (name)', [f('avis-nom').type, f('avis-nom').maxLength, f('avis-nom').getAttribute('autocomplete')], ['text', 100, 'name']);
  eq('cellulaire : téléphone, clavier numérique, 30 caractères au plus', [f('avis-cellulaire').type, f('avis-cellulaire').getAttribute('inputmode'), f('avis-cellulaire').maxLength, f('avis-cellulaire').getAttribute('autocomplete')], ['tel', 'tel', 30, 'tel']);
  eq('adresse : texte, 200 caractères au plus', [f('avis-adresse').type, f('avis-adresse').maxLength, f('avis-adresse').getAttribute('autocomplete')], ['text', 200, 'street-address']);
  eq('courriel : facultatif (pas d\'étoile rouge), de type courriel, 150 caractères au plus', [f('avis-courriel').type, f('avis-courriel').maxLength, f('avis-courriel').getAttribute('aria-required'), /facultatif/i.test(statique.querySelector('label[for="avis-courriel"]').textContent)], ['email', 150, null, true]);
  eq('nom, cellulaire et adresse sont marqués obligatoires (étoile et aria-required)', ['avis-nom', 'avis-cellulaire', 'avis-adresse'].map((id) => [f(id).getAttribute('aria-required'), !!statique.querySelector(`label[for="${id}"] .required`)]), [['true', true], ['true', true], ['true', true]]);
  eq('la case de consentement est DÉCOCHÉE au départ (elle n\'a pas l\'attribut « checked »)', [f('avis-accepte').type, f('avis-accepte').checked, f('avis-accepte').hasAttribute('checked')], ['checkbox', false, false]);
  eq('… elle est dans son étiquette (toucher le texte coche la case) et dans l\'étiquette il y a le texte de consentement', [f('avis-accepte').closest('label')?.getAttribute('for'), f('avis-accepte').closest('label')?.contains(f('avis-consentement-texte'))], ['avis-accepte', true]);
  eq('le bouton d\'envoi est DÉSACTIVÉ dans la page (le script l\'active : sans JavaScript, il ne sert à rien)', [f('avis-envoi').type, f('avis-envoi').disabled], ['submit', true]);
  eq('le champ piège anti-robot : vide, hors du clavier (tabindex -1), sans mémoire du navigateur, dans un bloc caché aux lecteurs d\'écran', [f('avis-site-web').value, f('avis-site-web').tabIndex, f('avis-site-web').getAttribute('autocomplete'), f('avis-site-web').closest('[aria-hidden="true"]')?.classList.contains('av-piege'), f('avis-site-web').name], ['', -1, 'off', true, 'site_web']);
  eq('la version du texte de consentement est cachée dans la page', [f('avis-version').type, f('avis-version').value], ['hidden', V1]);
  eq('les zones d\'erreur et le message « merci » (avec sa mention des offres) sont cachés au départ', [...CHAMPS.map((k) => f('avis-err-' + k).hidden), f('avis-alerte').hidden, f('avis-merci').hidden, f('avis-merci-promo').hidden], [true, true, true, true, true, true, true, true]);
  eq('l\'alerte et le « merci » sont annoncés aux lecteurs d\'écran (role alert / status)', [f('avis-alerte').getAttribute('role'), f('avis-merci').getAttribute('role')], ['alert', 'status']);
  vrai('un lien vers la politique de confidentialité est juste sous le bouton', !!statique.querySelector('.av-envoi a[href="confidentialite.html"]'));
  vrai('le numéro de téléphone de Joé est joignable d\'un toucher (lien tel:) dans la page', !!statique.querySelector('a[href="tel:18192688069"]'));
  eq('à côté de la case, la page s\'identifie : l\'entreprise, son adresse postale, son téléphone et son courriel (la demande de consentement dit qui la fait)', [espaces(f('avis-identification').textContent), !!f('avis-identification').querySelector('a[href="tel:18192688069"]'), !!f('avis-identification').querySelector('a[href="mailto:info@entretienlapointe.ca"]')], ['Entretien Lapointe, 331, Le Petit Bellechasse N, Charette (Québec) G0X 1E0 · 819 268-8069 · info@entretienlapointe.ca', true, true]);
  vrai('… cette identification est dans le bloc des consentements mais HORS des étiquettes (elle ne fait pas partie des textes gardés comme preuve)', !!f('avis-identification').closest('.av-consentements') && !f('avis-identification').closest('label'));
  eq('la 2ᵉ case (offres par courriel) existe : DÉCOCHÉE d\'office, FACULTATIVE (ni étoile ni aria-required), dans son étiquette, APRÈS celle des textos', [f('avis-promo').type, f('avis-promo').checked, f('avis-promo').hasAttribute('checked'), f('avis-promo').getAttribute('aria-required'), f('avis-promo').closest('label')?.getAttribute('for'), f('avis-promo').closest('label')?.contains(f('avis-promo-texte')), !!(f('avis-accepte').compareDocumentPosition(f('avis-promo')) & 4)], ['checkbox', false, false, null, 'avis-promo', true, true]);
  eq('… la version de son texte est cachée dans la page', [f('avis-version-promo').type, f('avis-version-promo').value], ['hidden', 'promo-2026-10-v1']);
  vrai('… elle est SÉPARÉE de la case des textos (deux étiquettes, deux blocs : l\'accord aux offres n\'est jamais groupé avec l\'autre)', f('avis-promo').closest('label') !== f('avis-accepte').closest('label') && f('avis-promo').closest('.av-consentement') !== f('avis-accepte').closest('.av-consentement'));
  eq('… et la case des textos reste la SEULE obligatoire', [f('avis-accepte').getAttribute('aria-required'), f('avis-promo').getAttribute('aria-required')], ['true', null]);
  vrai('… l\'aide du courriel explique qu\'il sert aux offres seulement si la 2ᵉ case est cochée', /seulement si vous cochez la deuxième case plus bas, à nos offres/.test(espaces(f('avis-courriel').parentNode.querySelector('.av-aide').textContent)));
}

log('\n=== LE TEXTE DE CONSENTEMENT DE LA PAGE EST EXACTEMENT CELUI DE LA BASE (celui que le registre garde comme preuve) ===');
{
  const m = SQL30.match(/insert into public\.textes_consentement \(version, canal, texte\) values \(\s*'([^']+)', 'texto',\s*\$t\$([\s\S]*?)\$t\$\)/);
  vrai('le texte de la version 1 est bien trouvé dans le fichier SQL 30', !!m);
  const texteSql = m ? espaces(m[2]) : '';
  const textePage = espaces(statique.getElementById('avis-consentement-texte').textContent);
  eq('la version écrite dans la page est celle du fichier SQL', statique.getElementById('avis-version').value, m && m[1]);
  eq('le texte affiché à côté de la case est IDENTIQUE, mot pour mot, à celui du fichier SQL', textePage, texteSql);
  vrai('… et il contient tout ce que les opérateurs exigent : entreprise, aucune publicité, fréquence, frais, ARRET/STOP, AIDE/HELP, téléphone, pas vendu ni partagé, facultatif', [/Entretien Lapointe/, /Aucune publicité/, /fréquence varie/, /frais de messagerie et de données/, /ARRET \(ou STOP\)/, /AIDE \(ou HELP\)/, /819 268-8069/, /ni vendu ni partagé/, /facultative/].every((r) => r.test(textePage)));
  const mp = SQL30.match(/insert into public\.textes_consentement \(version, canal, texte\) values \(\s*'(promo[^']*)', 'courriel_promo',\s*\$t\$([\s\S]*?)\$t\$\)/);
  vrai('le texte des OFFRES PAR COURRIEL (version « promo… ») est bien trouvé dans le fichier SQL 30', !!mp);
  eq('la version des offres écrite dans la page est celle du fichier SQL', statique.getElementById('avis-version-promo').value, mp && mp[1]);
  eq('le texte des offres affiché à côté de la 2ᵉ case est IDENTIQUE, mot pour mot, à celui du fichier SQL', espaces(statique.getElementById('avis-promo-texte').textContent), mp ? espaces(mp[2]) : '');
  vrai('… et il contient ce que la loi exige d\'une demande de consentement par courriel : l\'entreprise, l\'objet (offres et nouvelles par courriel), comment se désabonner, l\'adresse postale, le téléphone et le courriel, et que la case est facultative', [/Entretien Lapointe/, /par courriel/, /offres et les nouvelles/, /me désabonner en tout temps avec le lien au bas de chaque courriel/, /331, Le Petit Bellechasse N, Charette \(Québec\) G0X 1E0/, /819 268-8069/, /info@entretienlapointe\.ca/, /facultative/].every((r) => r.test(espaces(statique.getElementById('avis-promo-texte').textContent))));
  vrai('… et il ne parle PAS de textos (la publicité par texto n\'existe pas : décision de Joé)', !/texto/i.test(espaces(statique.getElementById('avis-promo-texte').textContent)));
}

log('\n=== AUCUN SUIVI SUR CES PAGES (on y saisit un numéro de cellulaire) ===');
{
  for (const [nom, contenu] of [['avis.html', HTML], ['confidentialite.html', HTML_CONF], ['js/avis.js', JS], ['css/avis.css', CSS]]) vrai(`${nom} : aucun Pixel Meta, balise Google, ni autre traceur`, !TRACEURS.test(contenu), (contenu.match(TRACEURS) || [])[0]);
  for (const [nom, doc] of [['avis.html', statique], ['confidentialite.html', statiqueConf]]) {
    const scripts = [...doc.querySelectorAll('script')];
    eq(`${nom} : aucun script dans la page même, seulement des fichiers du site (rien d'un autre site)`, [scripts.filter((s) => !s.src).length, scripts.filter((s) => /^(https?:)?\/\//i.test(s.getAttribute('src') || '')).length], [0, 0]);
    eq(`${nom} : aucun gestionnaire « onclick » et cie dans la page`, [...doc.querySelectorAll('*')].filter((e) => [...e.attributes].some((a) => /^on/i.test(a.name))).length, 0);
    eq(`${nom} : aucune ressource d'un autre site (styles, images, polices)`, [...doc.querySelectorAll('link[href], img[src], iframe, form[action]')].filter((e) => /^(https?:)?\/\//i.test(e.getAttribute('href') || e.getAttribute('src') || e.getAttribute('action') || '')).length, 0);
  }
  vrai('le script ne garde rien dans le navigateur (ni localStorage, ni témoin) et ne lit pas l\'adresse de la page', !/localStorage|sessionStorage|document\.cookie|indexedDB|location\.(search|hash|href)/.test(JS));
  eq('seuls les scripts attendus sont chargés par avis.html : les 3 du thème du site, puis avis.js', [...statique.querySelectorAll('script')].map((s) => s.getAttribute('src')), ['js/vendor/modernizr-2.6.2.min.js', 'js/compressed.js', 'js/main.js', 'js/avis.js']);
}

log('\n=== LES LIENS ET LES FICHIERS DES DEUX PAGES EXISTENT (rien de brisé une fois sur le site) ===');
{
  const PAGES_DU_SITE = new Set(['index.html', 'services.html', 'deneigement.html', 'pelouse.html', 'realisations.html', 'soumission.html', 'contact.html']);
  const FICHIERS_DU_THEME = new Set(['css/bootstrap.min.css', 'css/animations.css', 'css/fonts.css', 'css/main.css', 'js/vendor/modernizr-2.6.2.min.js', 'js/compressed.js', 'js/main.js', 'images/logo.png']);
  const NOS_FICHIERS = new Set(['avis.html', 'confidentialite.html', 'css/avis.css', 'js/avis.js']);
  for (const [nom, doc] of [['avis.html', statique], ['confidentialite.html', statiqueConf]]) {
    const liens = [...doc.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((h) => !/^(https?:|mailto:|tel:|\.\/$)/.test(h));
    eq(`${nom} : chaque lien de la page mène à une page qui existe sur le site`, liens.filter((h) => !PAGES_DU_SITE.has(h) && !NOS_FICHIERS.has(h)), []);
    const refs = [...doc.querySelectorAll('link[href], script[src], img[src]')].map((e) => e.getAttribute('href') || e.getAttribute('src'));
    eq(`${nom} : chaque style, script et image est soit un fichier du thème de Joé, soit un de nos fichiers`, refs.filter((r) => !FICHIERS_DU_THEME.has(r) && !NOS_FICHIERS.has(r)), []);
    eq(`${nom} : nos fichiers mentionnés existent bien dans le dossier`, refs.filter((r) => NOS_FICHIERS.has(r) && !fs.existsSync(SITE + r)), []);
  }
  vrai('avis.html et confidentialite.html se renvoient l\'une à l\'autre', !!statique.querySelector('a[href="confidentialite.html"]') && !!statiqueConf.querySelector('a[href="avis.html"]'));
}

log('\n=== AU CHARGEMENT : LE SCRIPT ACTIVE LE BOUTON ET NE FAIT RIEN D\'AUTRE ===');
{
  const m = ouvrir();
  eq('le bouton était désactivé dans la page, il est activé par le script', [m.boutonAvant, el(m, 'avis-envoi').disabled], [true, false]);
  eq('aucune erreur, aucune alerte, pas de « merci » ; le formulaire est visible', [champsEnErreur(m), alerte(m), merciVisible(m), formCache(m)], [[], '', false, false]);
  eq('aucun appel au serveur tant que la personne n\'a rien envoyé', m.appels.length, 0);
  eq('aucune erreur dans la page (console)', m.erreursPage, []);
}

log('\n=== ENVOYER UN FORMULAIRE VIDE OU INCOMPLET : RIEN NE PART, LES ERREURS SONT MONTRÉES ===');
{
  const m = ouvrir();
  soumettre(m);
  await attendre();
  const e = erreurs(m);
  eq('formulaire vide : des erreurs pour le nom, le cellulaire, l\'adresse et la case (pas pour le courriel, facultatif)', champsEnErreur(m), ['nom', 'cellulaire', 'adresse', 'accepte']);
  vrai('… chaque message dit clairement quoi faire', /nom complet/i.test(e.nom) && /au moins 2 lettres/.test(e.nom) && /10 chiffres/.test(e.cellulaire) && /819 555-1234/.test(e.cellulaire) && /adresse où nous faisons vos travaux/i.test(e.adresse) && /numéro et rue/.test(e.adresse) && /Cochez la case/.test(e.accepte) && /recevoir les textos/.test(e.accepte), JSON.stringify(e));
  eq('… rien n\'est envoyé au serveur', m.appels.length, 0);
  eq('… le curseur va au premier champ en erreur (le nom)', m.doc.activeElement.id, 'avis-nom');
  eq('… les champs en erreur sont marqués (bordure rouge, aria-invalid) ; le courriel ne l\'est pas', [...CHAMPS.map((k) => champInvalide(m, k)), el(m, 'avis-nom').getAttribute('aria-invalid'), el(m, 'avis-accepte').getAttribute('aria-invalid'), el(m, 'avis-courriel').getAttribute('aria-invalid')], [true, true, true, false, true, 'true', 'true', null]);
  eq('… le bouton reste actif pour recommencer', el(m, 'avis-envoi').disabled, false);

  // un seul champ manquant à la fois
  for (const [champ, o, attendu] of [
    ['le nom', { nom: '' }, ['nom']], ['le cellulaire', { cel: '' }, ['cellulaire']], ['l\'adresse', { adr: '' }, ['adresse']], ['la case', { coche: false }, ['accepte']],
  ]) {
    const n = ouvrir(); remplir(n, o); soumettre(n); await attendre();
    eq(`tout est rempli SAUF ${champ} : seule cette erreur est montrée, rien n'est envoyé`, [champsEnErreur(n), n.appels.length], [attendu, 0]);
  }
  const n2 = ouvrir(); remplir(n2, { cour: '' }); soumettre(n2); await attendre();
  eq('sans courriel : c\'est permis, l\'inscription part (le courriel est facultatif)', [champsEnErreur(n2), n2.appels.length, n2.appels[0]?.corps.p_courriel], [[], 1, null]);
  const n3 = ouvrir(); remplir(n3, { cour: '   ' }); soumettre(n3); await attendre();
  eq('un courriel fait d\'espaces compte comme « pas de courriel »', [champsEnErreur(n3), n3.appels[0]?.corps.p_courriel], [[], null]);
}

log('\n=== LES RÈGLES DE CHAQUE CHAMP (les mêmes que dans la base) ===');
{
  const essai = async (o) => { const m = ouvrir(); remplir(m, o); soumettre(m); await attendre(); return { erreurs: champsEnErreur(m), envoyes: m.appels.length, corps: m.appels[0]?.corps }; };
  const lettres = (k, c = 'a') => c.repeat(k);
  eq('nom : 1 caractère refusé', (await essai({ nom: 'A' })).erreurs, ['nom']);
  eq('nom : 1 caractère entouré d\'espaces refusé (on compte sans les espaces)', (await essai({ nom: '   A   ' })).erreurs, ['nom']);
  eq('nom : 2 caractères acceptés', (await essai({ nom: 'Al' })).erreurs, []);
  eq('nom : 100 caractères acceptés', (await essai({ nom: lettres(100) })).erreurs, []);
  eq('nom : 101 caractères refusés', (await essai({ nom: lettres(101) })).erreurs, ['nom']);
  eq('nom : 100 caractères + espaces autour acceptés (on compte sans les espaces)', (await essai({ nom: '  ' + lettres(100) + '  ' })).erreurs, []);
  eq('adresse : 4 caractères refusés', (await essai({ adr: '1 ru' })).erreurs, ['adresse']);
  eq('adresse : 5 caractères acceptés', (await essai({ adr: '1 rue' })).erreurs, []);
  eq('adresse : 5 caractères + espaces autour acceptés, 4 + espaces refusés', [(await essai({ adr: '  1 rue  ' })).erreurs, (await essai({ adr: '  1 ru  ' })).erreurs], [[], ['adresse']]);
  eq('adresse : 200 caractères acceptés', (await essai({ adr: lettres(200) })).erreurs, []);
  eq('adresse : 201 caractères refusés', (await essai({ adr: lettres(201) })).erreurs, ['adresse']);
  const cour = (k) => lettres(k - 5, 'x') + '@b.ca';
  eq('courriel : 150 caractères acceptés', (await essai({ cour: cour(150) })).erreurs, []);
  eq('courriel : 151 caractères refusés', (await essai({ cour: cour(151) })).erreurs, ['courriel']);
  eq('courriel : 150 caractères + espaces autour acceptés', (await essai({ cour: '  ' + cour(150) + '  ' })).erreurs, []);
  const pasCoche = await essai({ coche: false });
  eq('case non cochée : refusée, rien n\'est envoyé', [pasCoche.erreurs, pasCoche.envoyes], [['accepte'], 0]);
  eq('plusieurs erreurs à la fois : toutes sont montrées', (await essai({ nom: '', cel: '123', adr: '', cour: 'pasuncourriel', coche: false })).erreurs, CHAMPS);

  // la même règle que la base pour les numéros et les courriels : on les compare avec la VRAIE fonction et la VRAIE règle du fichier SQL 30
  const pg = new PGlite();
  await pg.exec(SQL30.match(/create or replace function public\._cellulaire_normalise\(p_brut text\)[\s\S]*?\$\$;/)[0]);
  const regexSql = SQL30.match(/clients_courriel_format check \(courriel is null or \(char_length\(courriel\) <= 150 and courriel ~ '([^']+)'\)\)/)[1];
  const CELS = ['819 555-1234', '(819) 555-1234', '+1 819 555 1234', '1-819-555-1234', '8195551234', '819.555.1234', '819 555 123', '819 555 12345', '019 555 1234', '119 555 1234', '819 055 1234', '819 155 1234', '', '   ', 'abc', '5551234', '+44 20 7946 0958', '18195551234', '1819555123', '28195551234', '1 (819) 555-1234', '+1 (819) 555-1234', '819-555-1234 poste 12', 'un 819 555 1234 deux', '٨١٩ ٥٥٥ ١٢٣٤', '11195551234', '1 1 819 555 1234', '819555123x', '999 999 9999', '234 234 2345'];
  const desaccords = [];
  for (const c of CELS) {
    const sql = (await pg.query('select public._cellulaire_normalise($1) r', [c])).rows[0].r !== null;
    const page = (await essai({ cel: c })).erreurs.length === 0;
    if (sql !== page) desaccords.push(`« ${c} » : base ${sql ? 'accepte' : 'refuse'}, page ${page ? 'accepte' : 'refuse'}`);
  }
  eq(`numéros : la page et la base (fonction _cellulaire_normalise du fichier SQL) sont d'accord sur ${CELS.length} façons d'écrire un numéro, bonnes et mauvaises`, desaccords, []);
  const COURS = ['a@b.ca', 'a@b', 'a b@c.ca', '@c.ca', 'a@@c.ca', 'a@c.', 'a@.ca', 'x@y.z', 'prenom.nom+tag@exemple.co.ca', 'é@exemple.ca', 'sans-arobase.ca', 'a@b c.ca', 'a@b.c a', 'a@b..ca', '.@.', 'a@b.c'];
  const desaccordsC = [];
  for (const c of COURS) {
    const sql = (await pg.query('select $1::text ~ $2::text r', [c, regexSql])).rows[0].r;
    const page = (await essai({ cour: c })).erreurs.length === 0;
    if (sql !== page) desaccordsC.push(`« ${c} » : base ${sql ? 'accepte' : 'refuse'}, page ${page ? 'accepte' : 'refuse'}`);
  }
  eq(`courriels : la page et la règle de la base (celle du fichier SQL) sont d'accord sur ${COURS.length} façons d'écrire un courriel`, desaccordsC, []);
  vrai('(la liste de numéros contient bien des numéros acceptés ET refusés : le test compare autre chose que des « oui »)', CELS.filter((c) => /^\(?\d{3}[).\s-]*\d{3}[.\s-]*\d{4}$/.test(c)).length >= 3 && CELS.includes('819 555 123'));
  await pg.close();
}

log('\n=== UNE INSCRIPTION VALIDE : CE QUI EST ENVOYÉ À LA BASE ===');
{
  const m = ouvrir();
  remplir(m, { nom: '  Marie Tremblay  ', cel: '  (819) 555-1234 ', adr: '  123, rue Principale, Charette ', cour: ' Marie.Tremblay@Exemple.CA ' });
  soumettre(m);
  await attendre();
  const a = m.appels[0];
  eq('UN seul appel au serveur', m.appels.length, 1);
  eq('… vers la fonction « inscrire_avis » de Supabase (adresse exacte, méthode POST)', [a.url, a.options.method], ['https://uxoxdauzcxjsefuoruwt.supabase.co/rest/v1/rpc/inscrire_avis', 'POST']);
  eq('… avec les bons champs, sans les espaces autour, et le consentement TOUJOURS vrai avec la version du texte lue', a.corps, { p_nom: 'Marie Tremblay', p_adresse: '123, rue Principale, Charette', p_cellulaire: '(819) 555-1234', p_courriel: 'Marie.Tremblay@Exemple.CA', p_accepte: true, p_version: V1, p_site_web: '', p_agent: m.w.navigator.userAgent, p_promo: false, p_version_promo: null });
  const cle = JS.match(/var SUPA_KEY = '([^']+)'/)[1];
  eq('… la 2ᵉ case n\'étant pas cochée : « p_promo » est faux et aucune version des offres n\'est envoyée', [a.corps.p_promo, a.corps.p_version_promo], [false, null]);
  eq('… avec la clé PUBLIQUE dans les deux en-têtes habituels et le format JSON', [a.options.headers['apikey'] === cle, a.options.headers['Authorization'], a.options.headers['Content-Type']], [true, 'Bearer ' + cle, 'application/json']);
  const charge = JSON.parse(Buffer.from(cle.split('.')[1], 'base64url').toString());
  eq('… cette clé est bien celle du rôle « anon » (publique) de NOTRE projet, jamais la clé secrète « service_role »', [charge.role, charge.ref], ['anon', 'uxoxdauzcxjsefuoruwt']);
  eq('… c\'est la même adresse et la même clé publique que l\'application de Joé (www/js/config.js)', [CONFIG_APP.match(/SUPA_URL='([^']+)'/)[1] === JS.match(/var SUPA_URL = '([^']+)'/)[1], CONFIG_APP.match(/SUPA_KEY='([^']+)'/)[1] === cle], [true, true]);
  const params = SQL30.match(/create or replace function public\.inscrire_avis\(([\s\S]*?)\)\s*returns jsonb/)[1].split(',').map((p) => p.trim().split(/\s+/)[0]).sort();
  eq('… et les noms des paramètres sont exactement ceux de la fonction du fichier SQL 30', Object.keys(a.corps).sort(), params);
  eq('… la durée maximale d\'attente est d\'un délai de 20 secondes (une minuterie est posée avec un signal d\'annulation)', [m.minuteries.map((x) => x.ms), a.signal !== undefined], [[20000], true]);
  eq('… le navigateur est transmis pour la preuve (texte coupé à 300 caractères au plus)', a.corps.p_agent.length <= 300 && a.corps.p_agent.length > 0, true);
  eq('après la réponse « enregistree » : la minuterie est libérée', m.liberees, [1]);
  eq('… le formulaire disparaît, le « merci » s\'affiche et reçoit le curseur (lecteurs d\'écran)', [formCache(m), merciVisible(m), m.doc.activeElement.id], [true, true, 'avis-merci']);
  eq('… la mention « offres par courriel » du « merci » reste cachée (la case n\'était pas cochée)', el(m, 'avis-merci-promo').hidden, true);
  eq('… les champs sont VIDÉS (rien de la personne ne reste dans la page) et la case est décochée', [['avis-nom', 'avis-cellulaire', 'avis-adresse', 'avis-courriel'].map((id) => el(m, id).value), el(m, 'avis-accepte').checked, el(m, 'avis-accepte').parentNode.classList.contains('av-coche')], [['', '', '', ''], false, false]);
  eq('… aucune erreur dans la page', m.erreursPage, []);
  vrai('… le « merci » explique la suite : relié au dossier client, désabonnement par ARRET/STOP', /dossier client/.test(el(m, 'avis-merci').textContent) && /ARRET \(ou STOP\)/.test(el(m, 'avis-merci').textContent));

  const p = ouvrir();
  remplir(p);
  dire(p, 'avis-site-web', 'http://pourriel.example');
  soumettre(p); await attendre();
  eq('si le champ piège est rempli (un robot), sa valeur est envoyée telle quelle : la base fait semblant d\'enregistrer', p.appels[0].corps.p_site_web, 'http://pourriel.example');

  const v2 = ouvrir();
  el(v2, 'avis-version').value = 'texto-2027-v2';
  remplir(v2); soumettre(v2); await attendre();
  eq('la version du texte envoyée est celle ÉCRITE DANS LA PAGE (si la page change de version, l\'envoi suit : texte et version voyagent ensemble)', v2.appels[0].corps.p_version, 'texto-2027-v2');

  const l = ouvrir();
  Object.defineProperty(l.w.navigator, 'userAgent', { value: 'Mozilla/5.0 ' + 'x'.repeat(500), configurable: true });
  remplir(l); soumettre(l); await attendre();
  eq('un nom de navigateur de 512 caractères est coupé à 300 caractères exactement (comme dans la base)', [l.appels[0].corps.p_agent.length, l.appels[0].corps.p_agent.startsWith('Mozilla/5.0 x')], [300, true]);
  const c = ouvrir();
  Object.defineProperty(c.w.navigator, 'userAgent', { value: 'Court', configurable: true });
  remplir(c); soumettre(c); await attendre();
  eq('un nom de navigateur court est envoyé tel quel', c.appels[0].corps.p_agent, 'Court');
  const sansNom = ouvrir();
  Object.defineProperty(sansNom.w.navigator, 'userAgent', { value: undefined, configurable: true });
  remplir(sansNom); soumettre(sansNom); await attendre();
  eq('un navigateur qui ne donne pas son nom : l\'inscription part quand même (texte vide)', [sansNom.appels.length, sansNom.appels[0].corps.p_agent, sansNom.erreursPage], [1, '', []]);
}

log('\n=== LE STYLE : CE QUI CACHE CE QUI DOIT ÊTRE CACHÉ ===');
{
  vrai('l\'attribut « hidden » cache vraiment (même si une règle du thème change l\'affichage)', /#avis \[hidden\]\s*\{\s*display:\s*none\s*!important/.test(CSS));
  vrai('le champ piège est sorti de l\'écran (invisible pour une personne, visible pour un robot)', /\.av-piege\s*\{[^}]*position:\s*absolute[^}]*left:\s*-9999px/.test(CSS));
  vrai('les champs sont en 16 px (sinon l\'iPhone agrandit la page quand on touche un champ)', /\.form-control\s*\{[^}]*font-size:\s*16px/.test(CSS));
  vrai('tout le style est limité à la section #avis (rien ne change sur les autres pages du site)', CSS.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((b) => b.split('{')[0].trim()).filter((s) => s && !s.startsWith('@')).every((s) => s.split(',').every((x) => x.trim().startsWith('#avis'))), CSS.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((b) => b.split('{')[0].trim()).filter((s) => s && !s.startsWith('@') && !s.startsWith('#avis')).join(' | '));
  vrai('la section qui reçoit le style existe dans les deux pages (id="avis")', !!statique.getElementById('avis') && !!statiqueConf.getElementById('avis'));
}

log('\n=== LA 2ᵉ CASE : LES OFFRES PAR COURRIEL (facultative, jamais cochée d\'office) ===');
{
  const OFFRES = /Écrivez votre courriel pour recevoir nos offres, ou décochez la deuxième case/;
  // cochée AVEC un courriel : l'inscription part avec l'accord aux offres
  let m = ouvrir();
  remplir(m, { promo: true });
  soumettre(m); await attendre();
  eq('2ᵉ case cochée avec un courriel : un seul envoi, « p_promo » est vrai et la version du texte des offres est envoyée', [m.appels.length, m.appels[0].corps.p_promo, m.appels[0].corps.p_version_promo], [1, true, 'promo-2026-10-v1']);
  eq('… la version des textos est toujours envoyée aussi, avec l\'accord aux textos', [m.appels[0].corps.p_accepte, m.appels[0].corps.p_version], [true, V1]);
  eq('… le « merci » s\'affiche avec la mention des offres par courriel', [merciVisible(m), el(m, 'avis-merci-promo').hidden, /offres par courriel/.test(el(m, 'avis-merci-promo').textContent), /désabonner en tout temps avec le lien au bas de chaque courriel/.test(el(m, 'avis-merci-promo').textContent)], [true, false, true, true]);
  eq('… les deux cases sont vidées et ne restent pas vertes', [el(m, 'avis-promo').checked, el(m, 'avis-accepte').checked, el(m, 'avis-promo').parentNode.classList.contains('av-coche'), el(m, 'avis-accepte').parentNode.classList.contains('av-coche')], [false, false, false, false]);

  // cochée SANS courriel : une erreur sous le courriel, rien ne part
  m = ouvrir();
  remplir(m, { promo: true, cour: '' });
  soumettre(m); await attendre();
  eq('2ᵉ case cochée SANS courriel : l\'erreur est sous le COURRIEL (« écrivez votre courriel… »), le curseur y va, rien n\'est envoyé', [champsEnErreur(m), OFFRES.test(erreurs(m).courriel), m.doc.activeElement.id, m.appels.length, champInvalide(m, 'courriel')], [['courriel'], true, 'avis-courriel', 0, true]);
  cocherPromo(m, false);
  eq('… décocher la 2ᵉ case efface cette erreur (le courriel redevient facultatif)', [champsEnErreur(m), champInvalide(m, 'courriel')], [[], false]);
  soumettre(m); await attendre();
  eq('… et l\'inscription part alors sans courriel et sans offres', [m.appels.length, m.appels[0].corps.p_courriel, m.appels[0].corps.p_promo, m.appels[0].corps.p_version_promo], [1, null, false, null]);

  m = ouvrir();
  remplir(m, { promo: true, cour: '   ' });
  soumettre(m); await attendre();
  eq('un courriel fait d\'espaces compte comme « aucun » pour les offres aussi', [champsEnErreur(m), m.appels.length], [['courriel'], 0]);

  m = ouvrir();
  remplir(m, { promo: true, cour: 'pasuncourriel' });
  soumettre(m); await attendre();
  eq('2ᵉ case cochée avec un courriel INVALIDE : c\'est le message habituel du courriel (pas celui des offres)', [champsEnErreur(m), /semble incomplet/.test(erreurs(m).courriel), OFFRES.test(erreurs(m).courriel), m.appels.length], [['courriel'], true, false, 0]);
  dire(m, 'avis-courriel', 'marie@exemple.ca');
  soumettre(m); await attendre();
  eq('… corrigé, l\'inscription part avec les offres', [m.appels.length, m.appels[0].corps.p_promo], [1, true]);

  m = ouvrir();
  remplir(m, { cour: 'pasuncourriel' });
  cocherPromo(m, true); cocherPromo(m, false);
  soumettre(m); await attendre();
  eq('décocher la 2ᵉ case n\'efface PAS une erreur de courriel invalide (l\'erreur est toujours vraie)', [champsEnErreur(m), /semble incomplet/.test(erreurs(m).courriel)], [['courriel'], true]);
  cocherPromo(m, true); cocherPromo(m, false);
  eq('… même si la case est cochée puis décochée de nouveau', champsEnErreur(m), ['courriel']);

  // la case des textos reste obligatoire
  m = ouvrir();
  remplir(m, { promo: true, coche: false });
  soumettre(m); await attendre();
  eq('2ᵉ case cochée mais PAS celle des textos : seule la case des textos est en erreur, rien n\'est envoyé (les offres seules ne suffisent pas)', [champsEnErreur(m), m.appels.length], [['accepte'], 0]);

  // la version envoyée est celle de la page
  m = ouvrir();
  el(m, 'avis-version-promo').value = 'promo-2027-v2';
  remplir(m, { promo: true });
  soumettre(m); await attendre();
  eq('la version des offres envoyée est celle ÉCRITE DANS LA PAGE', m.appels[0].corps.p_version_promo, 'promo-2027-v2');
  m = ouvrir();
  el(m, 'avis-version-promo').value = 'promo-2027-v2';
  remplir(m);
  soumettre(m); await attendre();
  eq('… et sans la 2ᵉ case cochée, AUCUNE version des offres n\'est envoyée (même si la page en contient une)', [m.appels[0].corps.p_promo, m.appels[0].corps.p_version_promo], [false, null]);

  // une course : la personne décoche la case PENDANT l'envoi ; la base répond « courriel requis pour les offres » ; elle recoche : cocher n'efface jamais cette erreur
  let finirCourse;
  m = ouvrir({ reponse: () => new Promise((res) => { finirCourse = res; }) });
  remplir(m, { promo: true });
  soumettre(m); await attendre();
  cocherPromo(m, false);
  finirCourse(rep(false, 400, JSON.stringify({ message: 'courriel_requis_offres' })));
  await attendre();
  eq('la case est décochée pendant l\'envoi et la base répond « courriel requis pour les offres » : l\'erreur est montrée sous le courriel', [champsEnErreur(m), OFFRES.test(erreurs(m).courriel)], [['courriel'], true]);
  cocherPromo(m, true);
  eq('… recocher la 2ᵉ case n\'efface PAS cette erreur (seul décocher l\'efface)', champsEnErreur(m), ['courriel']);

  // la couleur de la case
  m = ouvrir();
  cocherPromo(m, true);
  eq('la 2ᵉ case cochée devient verte (av-coche), sans toucher à la case des textos', [el(m, 'avis-promo').parentNode.classList.contains('av-coche'), el(m, 'avis-accepte').parentNode.classList.contains('av-coche')], [true, false]);
  cocherPromo(m, false);
  eq('… décochée, elle redevient normale', el(m, 'avis-promo').parentNode.classList.contains('av-coche'), false);

  // les réponses de la base
  const refus = (message) => () => Promise.resolve(rep(false, 400, JSON.stringify({ code: 'P0001', details: null, hint: null, message })));
  m = ouvrir({ reponse: refus('courriel_requis_offres') });
  remplir(m, { promo: true });
  soumettre(m); await attendre();
  eq('la base répond « courriel_requis_offres » : l\'erreur est sous le courriel avec le message des offres, le curseur y va, les valeurs sont gardées', [champsEnErreur(m), OFFRES.test(erreurs(m).courriel), m.doc.activeElement.id, el(m, 'avis-promo').checked, el(m, 'avis-nom').value], [['courriel'], true, 'avis-courriel', true, 'Marie Tremblay']);
  m = ouvrir({ reponse: refus('version_promo_inconnue') });
  remplir(m, { promo: true });
  soumettre(m); await attendre();
  eq('« version_promo_inconnue » : une alerte dit de recharger la page (le texte des offres a changé), les valeurs sont gardées', [/plus à jour/.test(alerte(m)), /Rechargez/.test(alerte(m)), champsEnErreur(m), el(m, 'avis-promo').checked], [true, true, [], true]);
  m = ouvrir({ reponse: refus('courriel_invalide') });
  remplir(m, { promo: true });
  soumettre(m); await attendre();
  eq('« courriel_invalide » (même avec la 2ᵉ case) : le message habituel du courriel', [champsEnErreur(m), /semble incomplet/.test(erreurs(m).courriel)], [['courriel'], true]);

  // un échec ne vide pas la 2ᵉ case ; le succès ne montre la mention que si elle était cochée
  m = ouvrir({ reponse: () => Promise.reject(new TypeError('réseau')) });
  remplir(m, { promo: true });
  soumettre(m); await attendre();
  eq('pas de réseau : la 2ᵉ case reste cochée (la personne n\'a rien à refaire)', [el(m, 'avis-promo').checked, el(m, 'avis-promo').parentNode.classList.contains('av-coche'), merciVisible(m)], [true, true, false]);
  m = ouvrir();
  remplir(m, { promo: true });
  soumettre(m); await attendre();
  const m2 = ouvrir();
  remplir(m2, { promo: false });
  soumettre(m2); await attendre();
  eq('la mention des offres dans le « merci » n\'apparaît que si la case était cochée', [el(m, 'avis-merci-promo').hidden, el(m2, 'avis-merci-promo').hidden], [false, true]);
  eq('… aucune erreur dans la page', [m.erreursPage, m2.erreursPage], [[], []]);
}

log('\n=== PENDANT L\'ENVOI : BOUTON BLOQUÉ, PAS DE DOUBLE ENVOI ===');
{
  let repondre;
  const m = ouvrir({ reponse: () => new Promise((r) => { repondre = r; }) });
  remplir(m);
  const texteBouton = el(m, 'avis-envoi').textContent;
  soumettre(m);
  await attendre();
  eq('pendant que le serveur réfléchit : le bouton est désactivé et dit « Envoi en cours… »', [el(m, 'avis-envoi').disabled, el(m, 'avis-envoi').textContent], [true, 'Envoi en cours…']);
  m.doc.getElementById('avis-form').dispatchEvent(new m.w.Event('submit', { bubbles: true, cancelable: true }));
  m.doc.getElementById('avis-form').dispatchEvent(new m.w.Event('submit', { bubbles: true, cancelable: true }));
  await attendre();
  eq('… un deuxième envoi (touche Entrée, double toucher) ne part PAS', m.appels.length, 1);
  repondre(rep(true, 200, JSON.stringify({ statut: 'enregistree' })));
  await attendre();
  eq('… après la réponse : le « merci » s\'affiche', merciVisible(m), true);
  eq('… et le bouton a retrouvé son texte et son état', [el(m, 'avis-envoi').disabled, el(m, 'avis-envoi').textContent], [false, texteBouton]);
  // la soumission par le bouton est bien un envoi de formulaire : l'événement est annulé (la page ne change pas)
  const n = ouvrir();
  remplir(n);
  const ev = new n.w.Event('submit', { bubbles: true, cancelable: true });
  n.doc.getElementById('avis-form').dispatchEvent(ev);
  eq('la soumission est annulée par le script (la page ne se recharge pas, rien n\'est mis dans l\'adresse)', ev.defaultPrevented, true);
  const v = ouvrir();
  const ev2 = new v.w.Event('submit', { bubbles: true, cancelable: true });
  v.doc.getElementById('avis-form').dispatchEvent(ev2);
  eq('… même quand le formulaire est vide', ev2.defaultPrevented, true);
}

log('\n=== LES RÉPONSES DE LA BASE : CHAQUE REFUS EST EXPLIQUÉ, RIEN N\'EST PERDU ===');
{
  const refus = (message) => () => Promise.resolve(rep(false, 400, JSON.stringify({ code: 'P0001', details: null, hint: null, message })));
  const essai = async (reponse, o = {}) => { const m = ouvrir({ reponse, ...o }); remplir(m); soumettre(m); await attendre(); return m; };
  for (const [code, champ, regle] of [['nom_invalide', 'nom', /nom complet.*au moins 2 lettres/i], ['cellulaire_invalide', 'cellulaire', /10 chiffres.*819 555-1234/], ['adresse_invalide', 'adresse', /adresse où nous faisons vos travaux.*numéro et rue/i], ['courriel_invalide', 'courriel', /courriel semble incomplet.*vide/i], ['consentement_requis', 'accepte', /Cochez la case.*recevoir les textos/]]) {
    const m = await essai(refus(code));
    eq(`« ${code} » : l'erreur est montrée sous le bon champ (${champ}), le curseur y va, le formulaire reste, les valeurs sont gardées`, [champsEnErreur(m), m.doc.activeElement.id, formCache(m), merciVisible(m), el(m, 'avis-nom').value, alerte(m)], [[champ], champ === 'accepte' ? 'avis-accepte' : 'avis-' + champ, false, false, 'Marie Tremblay', '']);
    vrai(`… et le message est clair`, regle.test(erreurs(m)[champ]), erreurs(m)[champ]);
    eq(`… le bouton est de nouveau actif (on peut corriger et renvoyer)`, [el(m, 'avis-envoi').disabled, el(m, 'avis-envoi').textContent.length > 0 && el(m, 'avis-envoi').textContent !== 'Envoi en cours…'], [false, true]);
  }
  let m = await essai(refus('version_inconnue'));
  eq('« version_inconnue » : une alerte dit de recharger la page (le texte a changé), les champs ne sont pas marqués', [/plus à jour/.test(alerte(m)), /Rechargez/.test(alerte(m)), champsEnErreur(m)], [true, true, []]);
  m = await essai(refus('trop_de_demandes'));
  eq('« trop_de_demandes » : une alerte dit de réessayer plus tard ou de téléphoner', [/trop de demandes/i.test(alerte(m)), /819 268-8069/.test(alerte(m)), !!el(m, 'avis-alerte').querySelector('a[href="tel:18192688069"]'), champsEnErreur(m)], [true, true, true, []]);
  m = await essai(refus('quelque_chose_de_nouveau'));
  eq('un code inconnu : message général avec le téléphone ; les valeurs sont gardées', [/erreur est survenue/.test(alerte(m)), /819 268-8069/.test(alerte(m)), el(m, 'avis-cellulaire').value, merciVisible(m)], [true, true, '(819) 555-1234', false]);
  m = await essai(() => Promise.resolve(rep(false, 500, '<html>Internal Server Error</html>')));
  eq('une erreur du serveur qui n\'est pas du JSON (500) : message général', [/erreur est survenue/.test(alerte(m)), merciVisible(m)], [true, false]);
  m = await essai(() => Promise.resolve(rep(false, 401, JSON.stringify({ message: 'Invalid API key' }))));
  eq('une clé refusée (401) : message général, pas de « merci »', [/erreur est survenue/.test(alerte(m)), merciVisible(m)], [true, false]);
  m = await essai(() => Promise.resolve(rep(true, 200, JSON.stringify({ statut: 'autre' }))));
  eq('une réponse 200 qui n\'est PAS « enregistree » : pas de « merci » (on ne prétend pas avoir enregistré), message général', [merciVisible(m), /erreur est survenue/.test(alerte(m)), formCache(m)], [false, true, false]);
  m = await essai(() => Promise.resolve(rep(true, 200, '<html>une page de connexion du wifi</html>')));
  eq('une réponse 200 qui n\'est pas du JSON (page d\'un réseau wifi public) : pas de « merci »', [merciVisible(m), /erreur est survenue/.test(alerte(m))], [false, true]);
  m = await essai(() => Promise.resolve(rep(true, 200, 'null')));
  eq('une réponse 200 « null » : pas de « merci » non plus', [merciVisible(m), formCache(m)], [false, false]);
  m = await essai(() => Promise.resolve(rep(false, 400, 'null')));
  eq('une erreur dont le corps est « null » : message général, pas de plantage', [/erreur est survenue/.test(alerte(m)), m.erreursPage], [true, []]);
  m = await essai(() => Promise.reject(new TypeError('Failed to fetch')));
  eq('pas de réseau : message « Connexion impossible » avec le téléphone ; les valeurs sont gardées ; le bouton redevient actif', [/Connexion impossible/.test(alerte(m)), /819 268-8069/.test(alerte(m)), el(m, 'avis-nom').value, el(m, 'avis-envoi').disabled, merciVisible(m)], [true, true, 'Marie Tremblay', false, false]);
  eq('… la minuterie d\'attente est libérée', m.liberees, [1]);
  m = await essai(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.reject(new Error('coupé')) }));
  eq('une connexion coupée PENDANT la lecture de la réponse : message « Connexion impossible », pas de « merci »', [/Connexion impossible/.test(alerte(m)), merciVisible(m)], [true, false]);

  // l'attente trop longue
  let signal;
  m = ouvrir({ reponse: (a) => new Promise((_, rejeter) => { signal = a.signal; a.signal.addEventListener('abort', () => rejeter(Object.assign(new Error('aborted'), { name: 'AbortError' }))); }) });
  remplir(m); soumettre(m); await attendre();
  eq('une réponse qui ne vient jamais : le bouton est bloqué, une minuterie de 20 secondes attend', [el(m, 'avis-envoi').disabled, m.minuteries.map((x) => x.ms), signal.aborted], [true, [20000], false]);
  m.minuteries[0].f();
  await attendre();
  eq('… passé 20 secondes : la requête est annulée, message « Connexion impossible », le bouton redevient actif', [signal.aborted, /Connexion impossible/.test(alerte(m)), el(m, 'avis-envoi').disabled, merciVisible(m)], [true, true, false, false]);

  // un vieux navigateur
  m = ouvrir({ sansFetch: true });
  remplir(m); soumettre(m); await attendre();
  eq('navigateur sans fetch (trop ancien) : message qui renvoie au téléphone, rien ne plante, le bouton reste actif', [/trop ancien/.test(alerte(m)), /819 268-8069/.test(alerte(m)), el(m, 'avis-envoi').disabled, m.erreursPage], [true, true, false, []]);
  m = ouvrir({ sansAbort: true });
  remplir(m); soumettre(m); await attendre();
  eq('navigateur sans AbortController : l\'inscription part quand même (sans délai maximal) et le « merci » s\'affiche', [m.appels.length, m.appels[0].signal, m.minuteries.length, merciVisible(m)], [1, undefined, 0, true]);
}

log('\n=== CORRIGER, RECOMMENCER, COCHER ===');
{
  const m = ouvrir();
  soumettre(m);
  eq('au départ : 4 erreurs montrées', champsEnErreur(m).length, 4);
  dire(m, 'avis-nom', 'Marie');
  eq('écrire dans le nom fait disparaître SON erreur (pas les autres)', [champsEnErreur(m), champInvalide(m, 'nom'), el(m, 'avis-nom').hasAttribute('aria-invalid'), el(m, 'avis-err-nom').textContent], [['cellulaire', 'adresse', 'accepte'], false, false, '']);
  dire(m, 'avis-cellulaire', '8195551234');
  dire(m, 'avis-adresse', '1 rue Ok');
  eq('… idem pour le cellulaire et l\'adresse', champsEnErreur(m), ['accepte']);
  cocher(m, true);
  eq('cocher la case efface son erreur, la colore en vert (av-coche) et la retire de la liste', [champsEnErreur(m), el(m, 'avis-accepte').parentNode.classList.contains('av-coche'), champInvalide(m, 'accepte')], [[], true, false]);
  cocher(m, false);
  eq('décocher la retire du vert', el(m, 'avis-accepte').parentNode.classList.contains('av-coche'), false);
  cocher(m, true);
  soumettre(m); await attendre();
  eq('après correction : l\'inscription part et le « merci » s\'affiche', [m.appels.length, merciVisible(m)], [1, true]);

  // erreur du serveur, puis correction, puis succès
  let appel = 0;
  const n = ouvrir({ reponse: () => (++appel === 1 ? Promise.resolve(rep(false, 400, JSON.stringify({ message: 'cellulaire_invalide' }))) : reponse200()) });
  remplir(n); soumettre(n); await attendre();
  eq('la base refuse le numéro : l\'erreur est sous le cellulaire', champsEnErreur(n), ['cellulaire']);
  dire(n, 'avis-cellulaire', '819 555 9999');
  eq('… la personne corrige : l\'erreur disparaît', champsEnErreur(n), []);
  soumettre(n); await attendre();
  eq('… renvoie : deuxième appel avec le nouveau numéro, puis « merci »', [n.appels.length, n.appels[1].corps.p_cellulaire, merciVisible(n)], [2, '819 555 9999', true]);

  // un nouvel essai SANS rien changer : l'ancienne erreur du champ disparaît tout de suite (avant même la réponse)
  let phase = 0, finir;
  const r2 = ouvrir({ reponse: () => (++phase === 1 ? Promise.resolve(rep(false, 400, JSON.stringify({ message: 'cellulaire_invalide' }))) : new Promise((res) => { finir = res; })) });
  remplir(r2); soumettre(r2); await attendre();
  eq('la base refuse le numéro : l\'erreur est montrée', champsEnErreur(r2), ['cellulaire']);
  soumettre(r2);
  eq('un deuxième essai SANS rien corriger : l\'ancienne erreur disparaît tout de suite, pendant l\'envoi', [champsEnErreur(r2), champInvalide(r2, 'cellulaire'), el(r2, 'avis-envoi').disabled], [[], false, true]);
  finir(rep(true, 200, JSON.stringify({ statut: 'enregistree' })));
  await attendre();
  eq('… et la réponse favorable affiche le « merci »', merciVisible(r2), true);

  // une alerte générale disparaît au nouvel essai
  let k = 0;
  const p = ouvrir({ reponse: () => (++k === 1 ? Promise.reject(new TypeError('réseau')) : reponse200()) });
  remplir(p); soumettre(p); await attendre();
  eq('réseau coupé : alerte', /Connexion impossible/.test(alerte(p)), true);
  soumettre(p);
  eq('… au nouvel essai l\'alerte est effacée tout de suite', alerte(p), '');
  await attendre();
  eq('… et le deuxième essai réussit', merciVisible(p), true);
}

log('\n=== LA PAGE « CONFIDENTIALITÉ » DIT CE QU\'ELLE DOIT DIRE (chaque phrase dans la bonne section) ===');
{
  const texte = espaces(statiqueConf.body.textContent);
  const sections = [...statiqueConf.querySelectorAll('.av-texte h3')].map((h) => {
    const els = []; let n = h.nextElementSibling;
    while (n && n.tagName !== 'H3') { els.push(n); n = n.nextElementSibling; }
    return { titre: espaces(h.textContent), texte: espaces(els.map((e) => e.textContent).join(' ')), liens: els.flatMap((e) => [...e.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))), forts: els.flatMap((e) => [...e.querySelectorAll('li > strong')].map((x) => espaces(x.textContent))) };
  });
  const S = (n) => sections[n - 1] || { titre: '', texte: '', liens: [], forts: [] };
  eq('titre et langue', [statiqueConf.documentElement.lang, /confidentialité/i.test(statiqueConf.title)], ['fr', true]);
  eq('elle donne 12 sections numérotées, dans l\'ordre', sections.map((x) => parseInt(x.titre, 10)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  vrai('la date de mise à jour est écrite en haut de la page', /Dernière mise à jour : 30 septembre 2026/.test(espaces(statiqueConf.querySelector('.av-maj').textContent)));
  for (const [n, libelle, regle] of [
    [1, 'la personne responsable de la protection des renseignements personnels', /responsable de la protection des renseignements personnels est Joé Lapointe, propriétaire/],
    [1, 'l\'entreprise et son adresse', /Entretien Lapointe, 331, Le Petit Bellechasse N, Charette \(Québec\) G0X 1E0/],
    [2, 'les renseignements recueillis pour l\'inscription aux textos (nom, adresse, cellulaire, courriel, preuve de consentement, empreinte de l\'adresse IP)', /inscrivez aux avis de passage par texto[\s\S]*numéro de cellulaire[\s\S]*empreinte chiffrée de votre adresse IP/],
    [2, 'l\'accord aux offres par courriel (case facultative) est gardé : date et texte accepté', /case facultative des offres par courriel, nous gardons aussi cet accord \(date et texte accepté\)/],
    [3, 'les offres et nouvelles par courriel, seulement si la personne a accepté d\'en recevoir', /nos offres et nos nouvelles par courriel, seulement si vous avez accepté d'en recevoir/],
    [4, 'aucune publicité par texto', /Aucune publicité par texto\. Jamais/],
    [4, 'le désabonnement ARRET / STOP et l\'aide AIDE / HELP', /ARRET \(ou STOP\)[\s\S]*AIDE \(ou HELP\)/],
    [4, 'la fréquence', /fréquence varie selon les travaux : jusqu'à quelques textos par semaine en saison/],
    [4, 'les frais de messagerie', /frais de messagerie et de données peuvent s'appliquer/],
    [4, 'les opérateurs ne sont pas responsables des textos retardés ou non livrés (mention habituelle des opérateurs)', /opérateurs de téléphonie mobile ne sont pas responsables des textos retardés ou non livrés/],
    [4, 'pas de texto entre 21 h et 6 h', /pas de texto entre 21 h et 6 h : un avis retardé attend le matin/],
    [4, 'le numéro automatisé qui ne lit pas les réponses', /numéro automatisé qui ne lit pas les réponses \(sauf ARRET et AIDE\)/],
    [4, 'le numéro n\'est ni vendu ni partagé à des fins de marketing (exigence des opérateurs)', /Nous ne vendons ni ne partageons votre numéro de cellulaire, ni votre consentement aux textos, avec des tiers à des fins de marketing ou de promotion/],
    [4, 'l\'inscription est facultative', /L'inscription est facultative : vous recevez vos services même si vous ne vous inscrivez pas/],
    [5, 'les offres par courriel : client depuis moins de 2 ans ou accord, lien de désabonnement, 10 jours ouvrables', /moins de 2 ans ou si vous nous avez donné votre accord[\s\S]*lien de désabonnement[\s\S]*10 jours ouvrables/],
    [5, 'l\'accord se donne par la 2ᵉ case, facultative, de la page d\'inscription (ou en le disant)', /cochant la deuxième case, facultative, de la page d'inscription aux avis de passage, ou en nous le disant/],
    [5, 'cette case n\'a aucun effet sur les services ni sur les avis de passage', /Cette case n'a aucun effet sur vos services ni sur vos avis de passage/],
    [5, 'jamais de publicité par texto', /Nous n'envoyons jamais de publicité par texto/],
    [6, 'Supabase hébergée à Montréal', /Supabase : base de données[\s\S]*hébergée à Montréal, au Canada/],
    [7, 'le traitement hors du Québec', /à l'extérieur du Québec/],
    [8, 'la durée de conservation du dossier client', /2 ans après votre dernier service/],
    [8, 'la conservation des preuves de consentement', /jusqu'à 3 ans après la fin de votre consentement/],
    [9, 'l\'avis à la Commission en cas d\'incident', /Commission d'accès à l'information du Québec et les personnes touchées/],
    [10, 'les outils Google et Meta du site (et leur absence sur la page d\'inscription)', /Pixel Meta[\s\S]*Google Ads[\s\S]*n'utilise aucun de ces outils/],
    [11, 'les droits : voir, corriger, retirer le consentement, supprimer', /demander de voir[\s\S]*les faire corriger[\s\S]*retirer votre consentement[\s\S]*demander que nous supprimions/],
    [11, 'le délai de réponse de 30 jours', /Nous répondons dans les 30 jours/],
    [11, 'le recours à la Commission d\'accès à l\'information du Québec', /vous adresser à la Commission d'accès à l'information du Québec/],
    [12, 'le nouvel accord demandé si l\'usage du cellulaire change', /nous vous demanderons de nouveau votre accord/],
  ]) vrai(`section ${n} (${S(n).titre.replace(/^\d+\.\s*/, '')}) : ${libelle}`, regle.test(S(n).texte), S(n).texte.slice(0, 120));
  eq('section 6 : les fournisseurs sont NOMMÉS un par un', S(6).forts, ['Supabase', 'Twilio', 'Resend', 'QuickBooks (Intuit)', 'WHC', 'Esri (images satellite) et OpenStreetMap (recherche d\'adresses)', 'Google Fonts', 'Google et Meta (Facebook)']);
  vrai('section 6 : les polices du thème (Google Fonts) sont déclarées, car le thème du site les charge chez Google sur chaque page', /Google Fonts : les polices de caractères de notre site, que votre navigateur télécharge directement chez Google/.test(S(6).texte));
  vrai('section 6 : chaque fournisseur dit à quoi il sert', /Twilio : envoi des textos d'avis de passage[\s\S]*Resend : envoi des courriels d'avis/.test(S(6).texte));
  eq('section 1 : le courriel et le téléphone de la personne responsable sont des liens', [S(1).liens.includes('mailto:info@entretienlapointe.ca'), S(1).liens.includes('tel:18192688069')], [true, true]);
  eq('section 4 : le téléphone pour obtenir de l\'aide est un lien', S(4).liens.includes('tel:18192688069'), true);
  eq('section 11 (vos droits) : le courriel, le téléphone et la Commission d\'accès à l\'information sont des liens', [S(11).liens.includes('mailto:info@entretienlapointe.ca'), S(11).liens.includes('tel:18192688069'), S(11).liens.includes('https://www.cai.gouv.qc.ca')], [true, true, true]);
  eq('le lien vers le site de la Commission s\'ouvre dans un autre onglet sans donner accès à notre page (noopener)', [statiqueConf.querySelector('a[href="https://www.cai.gouv.qc.ca"]').target, statiqueConf.querySelector('a[href="https://www.cai.gouv.qc.ca"]').rel], ['_blank', 'noopener']);
  eq('le seul lien vers un autre site est celui de la Commission (et le réseau social du pied de page)', [...statiqueConf.querySelectorAll('a[href^="http"]')].map((a) => a.getAttribute('href')).sort(), ['https://www.cai.gouv.qc.ca', 'https://www.facebook.com/entretienlapointe']);
  vrai('les mentions de la page d\'inscription concordent avec la politique : numéro automatisé, ARRET/STOP, politique liée', /numéro automatisé/.test(espaces(statique.body.textContent)) && /numéro automatisé/.test(texte) && /ARRET \(ou STOP\)/.test(texte));
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
