// Demande 5, chantier C — outil des ERREURS VOLONTAIRES de la page de désabonnement (site-consentement/desabonnement.html et js/desabonnement.js) (ne fait PAS partie de « npm test »).
//   node mutations-etape-17/erreurs-volontaires-page-desabonnement.mjs               (toutes les mutations)
//   ONLY=3,7 node mutations-etape-17/erreurs-volontaires-page-desabonnement.mjs      (seulement celles-là)
// Chaque mutation abîme UN endroit d'une COPIE du dossier site-consentement (variable SITE_TEST) ; test-page-desabonnement.mjs doit alors ÉCHOUER (ou planter).
// Le vrai dossier n'est JAMAIS touché. (Mutations NON essayées parce qu'ÉQUIVALENTES : retirer le contrôle « 2 paramètres » ou « une valeur » : les contrôles de l'identifiant et du jeton qui suivent refusent déjà le lien.) [nom, fichier, texte exact (UNE fois dans le fichier), texte abîmé]
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const TESTS = fileURLToPath(new URL('../', import.meta.url));
const REEL = fileURLToPath(new URL('../../../site-consentement/', import.meta.url));
const COPIE = path.join(os.tmpdir(), 'site-desab-' + (process.env.ONLY || 'tout').replace(/[^0-9]/g, '_'));
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;
const J = 'js/desabonnement.js', H = 'desabonnement.html';

const M = [
  ['le désabonnement se fait au chargement de la page (sans clic)', J, `	bouton.addEventListener('click', function () {\n		if (enCours) { return; }\n		envoyer();\n	});`, `	envoyer();`],
  ['un double clic envoie deux requêtes', J, `		if (enCours) { return; }\n		envoyer();`, `		envoyer();`],
  ['un paramètre inconnu est accepté', J, `if (kv[0] === 'c') { c = kv[1]; } else if (kv[0] === 't') { t = kv[1]; } else { return null; }`, `if (kv[0] === 'c') { c = kv[1]; } else { t = kv[1]; }`],
  ['un identifiant de client invalide est accepté', J, `		if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c)) { return null; }`, ``],
  ['un jeton de n\'importe quelle longueur est accepté', J, `		if (!/^[0-9a-f]{32}$/i.test(t)) { return null; }`, `		if (!/^[0-9a-f]+$/i.test(t)) { return null; }`],
  ['un jeton non hexadécimal est accepté', J, `		if (!/^[0-9a-f]{32}$/i.test(t)) { return null; }`, `		if (!/^.{32}$/i.test(t)) { return null; }`],
  ['les majuscules du lien ne sont plus acceptées', J, `		if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c)) { return null; }`, `		if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(c)) { return null; }`],
  ['le client n\'est plus mis en minuscules', J, `return { client: c.toLowerCase(), jeton: t.toLowerCase() };`, `return { client: c, jeton: t.toLowerCase() };`],
  ['le jeton n\'est plus mis en minuscules', J, `return { client: c.toLowerCase(), jeton: t.toLowerCase() };`, `return { client: c.toLowerCase(), jeton: t };`],
  ['la requête va vers une autre fonction', J, `/rest/v1/rpc/avis_desabonner_par_jeton`, `/rest/v1/rpc/desabonner_contact`],
  ['la requête n\'envoie plus le jeton', J, `body: JSON.stringify({ p_client_id: lien.client, p_jeton: lien.jeton })`, `body: JSON.stringify({ p_client_id: lien.client })`],
  ['la requête n\'envoie plus l\'identifiant du client', J, `body: JSON.stringify({ p_client_id: lien.client, p_jeton: lien.jeton })`, `body: JSON.stringify({ p_jeton: lien.jeton })`],
  ['la requête n\'est plus un POST', J, `			method: 'POST',`, `			method: 'GET',`],
  ['la clé publique est fausse', J, `var SUPA_KEY = '`, `var SUPA_KEY = 'x`],
  ['l\'adresse de la base est fausse', J, `var SUPA_URL = 'https://uxoxdauzcxjsefuoruwt.supabase.co';`, `var SUPA_URL = 'https://exemple.supabase.co';`],
  ['une réponse « ok » mais sans « desabonne » est annoncée comme un succès', J, `if (r.ok && statut === 'desabonne') { enCours = false; succes(); return; }`, `if (r.ok) { enCours = false; succes(); return; }`],
  ['une erreur du serveur est annoncée comme un succès', J, `if (r.ok && statut === 'desabonne') { enCours = false; succes(); return; }`, `{ enCours = false; succes(); return; }`],
  ['« lien invalide » n\'est plus reconnu', J, `if (code === 'lien_invalide') { lienInvalide(); } else { montrerAlerte(MSG_AUTRE); }`, `montrerAlerte(MSG_AUTRE);`],
  ['toute erreur est présentée comme « lien invalide »', J, `if (code === 'lien_invalide') { lienInvalide(); } else { montrerAlerte(MSG_AUTRE); }`, `lienInvalide();`],
  ['une panne de réseau est annoncée comme un succès', J, `				fini();\n				montrerAlerte(MSG_RESEAU);`, `				succes();`],
  ['après une panne, le bouton reste bloqué', J, `				fini();\n				montrerAlerte(MSG_RESEAU);`, `				montrerAlerte(MSG_RESEAU);`],
  ['après une erreur du serveur, le bouton reste bloqué', J, `				fini();\n				if (code === 'lien_invalide')`, `				if (code === 'lien_invalide')`],
  ['le délai de 20 secondes n\'est plus armé', J, `var minuterie = controle ? setTimeout(function () { controle.abort(); }, DELAI_MAX_MS) : null;`, `var minuterie = null;`],
  ['le délai est de 2 secondes', J, `var DELAI_MAX_MS = 20000;`, `var DELAI_MAX_MS = 2000;`],
  ['un navigateur sans fetch ne le dit pas', J, `		if (typeof fetch !== 'function') { montrerAlerte(MSG_ANCIEN); return; }`, ``],
  ['le bouton ne dit plus « Un instant… » pendant l\'envoi', J, `		bouton.textContent = 'Un instant…';`, ``],
  ['le bouton n\'est pas désactivé pendant l\'envoi', J, `		bouton.disabled = true;\n		bouton.textContent = 'Un instant…';`, `		bouton.textContent = 'Un instant…';`],
  ['l\'alerte précédente reste affichée pendant un nouvel essai', J, `		alerte.hidden = true;\n		bouton.disabled = true;`, `		bouton.disabled = true;`],
  ['la page de confirmation ne s\'affiche jamais', J, `	confirmer.hidden = false;\n\n	function envoyer() {`, `\n	function envoyer() {`],
  ['le message de réussite ne s\'affiche plus', J, `		confirmer.hidden = true;\n		merci.hidden = false;`, `		confirmer.hidden = true;`],
  ['la demande de confirmation reste après le succès', J, `		confirmer.hidden = true;\n		merci.hidden = false;`, `		merci.hidden = false;`],
  ['un suivi (Google Analytics) est ajouté au script', J, `	'use strict';`, `	'use strict';\n	var ga = 'https://www.google-analytics.com/analytics.js';`],
  ['un suivi (Google) est ajouté à la page', H, `<script src="js/desabonnement.js"></script>`, `<script src="https://www.googletagmanager.com/gtag/js?id=G-X"></script><script src="js/desabonnement.js"></script>`],
  ['la page n\'est plus « noindex »', H, `<meta name="robots" content="noindex">`, ``],
  ['la page charge le script de l\'inscription', H, `<script src="js/desabonnement.js"></script>`, `<script src="js/avis.js"></script>`],
  ['la page ne charge plus son script', H, `<script src="js/desabonnement.js"></script>`, ``],
  ['la page n\'a plus le bouton', H, `<button class="av-btn" id="des-bouton" type="button">Je ne veux plus recevoir ces avis par courriel</button>`, ``],
  ['le texte du bouton est changé', H, `Je ne veux plus recevoir ces avis par courriel</button>`, `Valider</button>`],
  ['la demande de confirmation est visible d\'office', H, `<div hidden id="des-confirmer">`, `<div id="des-confirmer">`],
  ['le message « lien incomplet » est visible d\'office', H, `<div hidden id="des-incomplet">`, `<div id="des-incomplet">`],
  ['le message de réussite est visible d\'office', H, `<div class="av-merci" hidden id="des-merci"`, `<div class="av-merci" id="des-merci"`],
  ['le message « lien incomplet » n\'a plus le courriel de l\'entreprise', H, `<p class="av-intro">Pour ne plus recevoir nos avis par courriel, écrivez-nous à <a href="mailto:info@entretienlapointe.ca">info@entretienlapointe.ca</a> ou téléphonez-nous au <a href="tel:18192688069">819 268-8069</a>`, `<p class="av-intro">Pour ne plus recevoir nos avis par courriel, téléphonez-nous au <a href="tel:18192688069">819 268-8069</a>`],
  ['le message de réussite ne rappelle plus ARRET', H, `répondez ARRET (ou STOP) à l'un de nos textos pour ne plus les recevoir. `, ``],
  ['la page n\'a plus le feuille de style', H, `<link href="css/avis.css" rel="stylesheet" />`, ``],
  ['un identifiant en double dans la page', H, `<div hidden id="des-incomplet">`, `<div hidden id="des-confirmer"><div hidden id="des-incomplet">`],
];

let detectees = 0, essayees = 0; const rapport = [];
try {
  for (const [i, [nom, fichier, de, vers]] of M.entries()) {
    if (ONLY && !ONLY.includes(i + 1)) continue;
    essayees++;
    fs.rmSync(COPIE, { recursive: true, force: true });
    fs.cpSync(REEL, COPIE, { recursive: true });
    const f = path.join(COPIE, fichier);
    const src = fs.readFileSync(f, 'utf8');
    const n = src.split(de).length - 1;
    if (n !== 1) { rapport.push(`?? ${i + 1}. TEXTE ${n === 0 ? 'INTROUVABLE' : 'EN ' + n + ' EXEMPLAIRES'} : ${nom}`); console.log(rapport[rapport.length - 1]); continue; }
    fs.writeFileSync(f, src.replace(de, () => vers));
    let sortie = '';
    try { sortie = execFileSync('node', ['test-page-desabonnement.mjs'], { cwd: TESTS, env: { ...process.env, SITE_TEST: COPIE }, encoding: 'utf8', timeout: 240000, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { sortie = String(e.stdout || '') + String(e.stderr || ''); }
    const m = sortie.match(/RÉSULTAT : (\d+) réussis, (\d+) échoués/);
    const ko = m ? Number(m[2]) : -1;
    const vu = ko !== 0;
    if (vu) detectees++;
    rapport.push(`${vu ? 'OK  détectée' : 'RATÉE      '} ${i + 1}. ${nom}${m ? ' (' + ko + ' échec(s))' : ' (plantage)'}`);
    console.log(rapport[rapport.length - 1]);
  }
} finally {
  fs.rmSync(COPIE, { recursive: true, force: true });
}
console.log(`\n${detectees} erreurs volontaires détectées sur ${essayees}`);
