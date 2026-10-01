// Demande 5 — outil des ERREURS VOLONTAIRES des pages du site (site-consentement/ : avis.html, js/avis.js, css/avis.css, confidentialite.html) (ne fait PAS partie de « npm test »).
//   node mutations-etape-17/erreurs-volontaires-page-avis.mjs               (toutes les mutations ; plusieurs à la fois)
//   MATCH="texte du nom" node mutations-etape-17/erreurs-volontaires-page-avis.mjs   (seulement celles dont le nom correspond)
//   VALIDER=1 node mutations-etape-17/erreurs-volontaires-page-avis.mjs     (vérifie seulement que chaque texte à abîmer est présent UNE fois dans son fichier)
// Chaque mutation abîme UNE règle dans une COPIE du dossier site-consentement (dossier temporaire) ; test-page-avis.mjs (variable SITE_TEST) doit alors ÉCHOUER (ou planter).
// Le vrai dossier n'est JAMAIS touché (l'outil le vérifie à la fin).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';

const TESTS = fileURLToPath(new URL('../', import.meta.url));
const SITE = fileURLToPath(new URL('../../../site-consentement/', import.meta.url));
const FICHIERS = ['avis.html', 'confidentialite.html', 'js/avis.js', 'css/avis.css'];
const lireTout = () => Object.fromEntries(FICHIERS.map((f) => [f, fs.readFileSync(SITE + f, 'utf8').replace(/\r\n/g, '\n')]));
const SOURCE = lireTout();
const MATCH = process.env.MATCH ? new RegExp(process.env.MATCH, 'i') : null;
const PARALLELE = Number(process.env.PARALLELE) || 6;
const R = String.raw;

const M = [];   // { nom, fichier, paires: [[de, vers], …] }
const ajout = (fichier) => (nom, de, vers, equivalente) => M.push({ nom, fichier, paires: Array.isArray(de) ? de : [[de, vers]], equivalente: Array.isArray(de) ? vers : equivalente });   // « equivalente » : la raison pour laquelle l'erreur ne change RIEN au comportement (elle peut survivre sans que ce soit un trou)
const js = ajout('js/avis.js'), html = ajout('avis.html'), conf = ajout('confidentialite.html'), css = ajout('css/avis.css');
const variantes = (f, ligne, liste) => liste.forEach(([nom, vers]) => f(nom, ligne, vers));

// =================== js/avis.js ===================
// ---- où et comment on parle à la base
js('l\'adresse de la base est changée', `var SUPA_URL = 'https://uxoxdauzcxjsefuoruwt.supabase.co';`, `var SUPA_URL = 'https://exemple.supabase.co';`);
js('la fonction appelée n\'est plus inscrire_avis', `'/rest/v1/rpc/inscrire_avis'`, `'/rest/v1/rpc/inscrire'`);
js('l\'appel n\'est plus un RPC (mauvais chemin)', `'/rest/v1/rpc/inscrire_avis'`, `'/rest/v1/inscrire_avis'`);
js('la clé publique est altérée (dernier caractère)', `.wkCtoY3_273C-XWx9c2hP2PIWOC1c1I_3sFjG9cN55A';`, `.wkCtoY3_273C-XWx9c2hP2PIWOC1c1I_3sFjG9cN55B';`);
js('l\'en-tête « apikey » est retiré', `'apikey': SUPA_KEY, `, ``);
js('l\'en-tête « Authorization » est retiré', `, 'Authorization': 'Bearer ' + SUPA_KEY`, ``);
js('« Authorization » n\'a plus « Bearer »', `'Authorization': 'Bearer ' + SUPA_KEY`, `'Authorization': SUPA_KEY`);
js('l\'en-tête « Content-Type » est retiré', `'Content-Type': 'application/json', `, ``);
js('la méthode n\'est plus POST', `method: 'POST',`, `method: 'GET',`);
js('le délai maximal passe à 2 secondes', `var DELAI_MAX_MS = 20000;`, `var DELAI_MAX_MS = 2000;`);
js('le délai maximal passe à 200 secondes', `var DELAI_MAX_MS = 20000;`, `var DELAI_MAX_MS = 200000;`);
js('plus de minuterie d\'attente', `var minuterie = controle ? setTimeout(function () { controle.abort(); }, DELAI_MAX_MS) : null;`, `var minuterie = null;`);
js('la minuterie n\'annule plus la requête', `setTimeout(function () { controle.abort(); }, DELAI_MAX_MS)`, `setTimeout(function () { void 0; }, DELAI_MAX_MS)`);
js('la requête n\'a plus de signal d\'annulation', `if (controle) { options.signal = controle.signal; }`, ``);
js('AbortController est supposé présent (plante sur un vieux navigateur)', `var controle = typeof AbortController === 'function' ? new AbortController() : null;`, `var controle = new AbortController();`);
js('un navigateur sans fetch n\'est plus repéré', `if (typeof fetch !== 'function') { montrerAlerte(MSG_ANCIEN); return; }`, ``);
js('après une réponse, la minuterie n\'est plus libérée', `\t\t\t.then(function (r) {\n\t\t\t\tif (minuterie) { clearTimeout(minuterie); }\n`, `\t\t\t.then(function (r) {\n`);
js('après une erreur réseau, la minuterie n\'est plus libérée', `\t\t\t.catch(function () {\n\t\t\t\tif (minuterie) { clearTimeout(minuterie); }\n`, `\t\t\t.catch(function () {\n`);
js('après une réponse, le bouton n\'est plus remis en état', `\t\t\t\tfini();\n\t\t\t\tvar statut = '';`, `\t\t\t\tvar statut = '';`);
js('après une erreur réseau, le bouton n\'est plus remis en état', `\t\t\t\tfini();\n\t\t\t\tmontrerAlerte(MSG_RESEAU);`, `\t\t\t\tmontrerAlerte(MSG_RESEAU);`);
js('une erreur réseau affiche le message général au lieu de « Connexion impossible »', `montrerAlerte(MSG_RESEAU);`, `montrerAlerte(MSG_AUTRE);`);

// ---- ce qui est envoyé
js('le nom et l\'adresse sont inversés dans l\'envoi', [[`p_nom: v.nom,`, `p_nom: v.adresse,`], [`p_adresse: v.adresse,`, `p_adresse: v.nom,`]]);
js('le cellulaire envoyé est le courriel', `p_cellulaire: v.cellulaire,`, `p_cellulaire: v.courriel,`);
js('le courriel vide est envoyé comme texte vide (au lieu de « aucun »)', `p_courriel: v.courriel === '' ? null : v.courriel,`, `p_courriel: v.courriel,`);
js('le courriel n\'est jamais envoyé', `p_courriel: v.courriel === '' ? null : v.courriel,`, `p_courriel: null,`);
js('le consentement envoyé est « faux »', `p_accepte: true,`, `p_accepte: false,`);
js('la version du texte envoyée est une autre', `p_version: v.version,`, `p_version: 'texto-2026-10-v0',`);
js('la version du texte n\'est plus lue dans la page', `version: $('avis-version').value,`, `version: 'texto-2026-10-v1',`);
js('le champ piège n\'est plus envoyé (toujours vide)', `p_site_web: v.piege,`, `p_site_web: '',`);
js('le champ piège est lu dans un autre champ', `piege: $('avis-site-web').value`, `piege: $('avis-nom').value`);
js('le navigateur n\'est plus coupé à 300 caractères', `String(navigator.userAgent || '').slice(0, 300)`, `String(navigator.userAgent || '')`);
js('le navigateur est coupé à 299 caractères', `String(navigator.userAgent || '').slice(0, 300)`, `String(navigator.userAgent || '').slice(0, 299)`);
js('un navigateur sans nom fait planter l\'envoi', `String(navigator.userAgent || '').slice(0, 300)`, `navigator.userAgent.slice(0, 300)`);
js('le navigateur n\'est pas envoyé', `p_agent: String(navigator.userAgent || '').slice(0, 300)`, `p_agent: null`);

// ---- les règles de chaque champ
const NOM = `if (v.nom.length < 2 || v.nom.length > 100) { e.nom = MSG_CHAMP.nom; }`;
variantes(js, NOM, [
  ['le nom n\'est plus vérifié', `if (false) { e.nom = MSG_CHAMP.nom; }`],
  ['un nom d\'un caractère est accepté', `if (v.nom.length < 1 || v.nom.length > 100) { e.nom = MSG_CHAMP.nom; }`],
  ['un nom de 2 caractères est refusé', `if (v.nom.length < 3 || v.nom.length > 100) { e.nom = MSG_CHAMP.nom; }`],
  ['un nom de 101 caractères est accepté', `if (v.nom.length < 2 || v.nom.length > 101) { e.nom = MSG_CHAMP.nom; }`],
  ['un nom de 100 caractères est refusé', `if (v.nom.length < 2 || v.nom.length > 99) { e.nom = MSG_CHAMP.nom; }`],
  ['le nom n\'a plus de maximum', `if (v.nom.length < 2) { e.nom = MSG_CHAMP.nom; }`],
  ['le nom n\'a plus de minimum', `if (v.nom.length > 100) { e.nom = MSG_CHAMP.nom; }`]]);
const ADR = `if (v.adresse.length < 5 || v.adresse.length > 200) { e.adresse = MSG_CHAMP.adresse; }`;
variantes(js, ADR, [
  ['l\'adresse n\'est plus vérifiée', `if (false) { e.adresse = MSG_CHAMP.adresse; }`],
  ['une adresse de 4 caractères est acceptée', `if (v.adresse.length < 4 || v.adresse.length > 200) { e.adresse = MSG_CHAMP.adresse; }`],
  ['une adresse de 5 caractères est refusée', `if (v.adresse.length < 6 || v.adresse.length > 200) { e.adresse = MSG_CHAMP.adresse; }`],
  ['une adresse de 201 caractères est acceptée', `if (v.adresse.length < 5 || v.adresse.length > 201) { e.adresse = MSG_CHAMP.adresse; }`],
  ['une adresse de 200 caractères est refusée', `if (v.adresse.length < 5 || v.adresse.length > 199) { e.adresse = MSG_CHAMP.adresse; }`],
  ['l\'adresse n\'a plus de maximum', `if (v.adresse.length < 5) { e.adresse = MSG_CHAMP.adresse; }`],
  ['l\'adresse n\'a plus de minimum', `if (v.adresse.length > 200) { e.adresse = MSG_CHAMP.adresse; }`]]);
js('le cellulaire n\'est plus vérifié', `if (!cellulaireValide(v.cellulaire)) { e.cellulaire = MSG_CHAMP.cellulaire; }`, `if (false) { e.cellulaire = MSG_CHAMP.cellulaire; }`);
js('un cellulaire valide est refusé (test inversé)', `if (!cellulaireValide(v.cellulaire)) { e.cellulaire = MSG_CHAMP.cellulaire; }`, `if (cellulaireValide(v.cellulaire)) { e.cellulaire = MSG_CHAMP.cellulaire; }`);
const CEL = R`function cellulaireValide(t) { return /^1?[2-9][0-9]{2}[2-9][0-9]{6}$/.test(chiffres(t)); }`;
variantes(js, CEL, [
  ['cellulaire : le début du texte n\'est plus vérifié', R`function cellulaireValide(t) { return /1?[2-9][0-9]{2}[2-9][0-9]{6}$/.test(chiffres(t)); }`],
  ['cellulaire : la fin du texte n\'est plus vérifiée', R`function cellulaireValide(t) { return /^1?[2-9][0-9]{2}[2-9][0-9]{6}/.test(chiffres(t)); }`],
  ['cellulaire : l\'indicatif régional peut commencer par 0 ou 1', R`function cellulaireValide(t) { return /^1?[0-9][0-9]{2}[2-9][0-9]{6}$/.test(chiffres(t)); }`],
  ['cellulaire : le central peut commencer par 0 ou 1', R`function cellulaireValide(t) { return /^1?[2-9][0-9]{2}[0-9][0-9]{6}$/.test(chiffres(t)); }`],
  ['cellulaire : un numéro de 9 chiffres est permis', R`function cellulaireValide(t) { return /^1?[2-9][0-9]{2}[2-9][0-9]{5}$/.test(chiffres(t)); }`],
  ['cellulaire : un numéro de 11 chiffres sans le 1 est permis', R`function cellulaireValide(t) { return /^1?[2-9][0-9]{2}[2-9][0-9]{7}$/.test(chiffres(t)); }`],
  ['cellulaire : le 1 du début est obligatoire', R`function cellulaireValide(t) { return /^1[2-9][0-9]{2}[2-9][0-9]{6}$/.test(chiffres(t)); }`],
  ['cellulaire : le 1 du début n\'est plus permis', R`function cellulaireValide(t) { return /^[2-9][0-9]{2}[2-9][0-9]{6}$/.test(chiffres(t)); }`],
  ['cellulaire : plusieurs 1 de tête sont permis', R`function cellulaireValide(t) { return /^1*[2-9][0-9]{2}[2-9][0-9]{6}$/.test(chiffres(t)); }`],
  ['cellulaire : on ne retire plus les espaces et tirets avant de vérifier', R`function cellulaireValide(t) { return /^1?[2-9][0-9]{2}[2-9][0-9]{6}$/.test(t); }`]]);
js('cellulaire : seuls les espaces et les tirets sont retirés (pas les parenthèses ni les points)', R`return String(t || '').replace(/[^0-9]/g, '');`, R`return String(t || '').replace(/[ -]/g, '');`);
js('cellulaire : seul le premier caractère non numérique est retiré', R`return String(t || '').replace(/[^0-9]/g, '');`, R`return String(t || '').replace(/[^0-9]/, '');`);
const COUR = `if (v.courriel !== '' && !courrielValide(v.courriel)) { e.courriel = MSG_CHAMP.courriel; }`;
variantes(js, COUR, [
  ['le courriel n\'est plus vérifié', `if (false) { e.courriel = MSG_CHAMP.courriel; }`],
  ['le courriel devient obligatoire', `if (!courrielValide(v.courriel)) { e.courriel = MSG_CHAMP.courriel; }`],
  ['un courriel valide est refusé (test inversé)', `if (v.courriel !== '' && courrielValide(v.courriel)) { e.courriel = MSG_CHAMP.courriel; }`]]);
const COURV = R`function courrielValide(t) { return t.length <= 150 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t); }`;
variantes(js, COURV, [
  ['courriel : 151 caractères sont permis', R`function courrielValide(t) { return t.length <= 151 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t); }`],
  ['courriel : 150 caractères sont refusés', R`function courrielValide(t) { return t.length <= 149 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t); }`],
  ['courriel : la longueur n\'est plus vérifiée', R`function courrielValide(t) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t); }`],
  ['courriel : l\'arobase suffit', R`function courrielValide(t) { return t.length <= 150 && /@/.test(t); }`],
  ['courriel : le point du domaine n\'est plus exigé', R`function courrielValide(t) { return t.length <= 150 && /^[^@\s]+@[^@\s]+$/.test(t); }`],
  ['courriel : les espaces sont permis', R`function courrielValide(t) { return t.length <= 150 && /^[^@]+@[^@]+\.[^@]+$/.test(t); }`],
  ['courriel : le début du texte n\'est plus vérifié', R`function courrielValide(t) { return t.length <= 150 && /[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t); }`],
  ['courriel : la fin du texte n\'est plus vérifiée', R`function courrielValide(t) { return t.length <= 150 && /^[^@\s]+@[^@\s]+\.[^@\s]+/.test(t); }`],
  ['courriel : le nom avant l\'arobase peut être vide', R`function courrielValide(t) { return t.length <= 150 && /^[^@\s]*@[^@\s]+\.[^@\s]+$/.test(t); }`]]);
js('la case de consentement n\'est plus exigée', `if (!v.accepte) { e.accepte = MSG_CHAMP.accepte; }`, `if (false) { e.accepte = MSG_CHAMP.accepte; }`);
js('la case est toujours considérée cochée', `accepte: champ.accepte.checked === true,`, `accepte: true,`);
js('la case est lue à l\'envers', `accepte: champ.accepte.checked === true,`, `accepte: champ.accepte.checked !== true,`);
for (const [cle, ligne] of [['nom', `nom: champ.nom.value.replace(/^\\s+|\\s+$/g, ''),`], ['cellulaire', `cellulaire: champ.cellulaire.value.replace(/^\\s+|\\s+$/g, ''),`], ['adresse', `adresse: champ.adresse.value.replace(/^\\s+|\\s+$/g, ''),`], ['courriel', `courriel: champ.courriel.value.replace(/^\\s+|\\s+$/g, ''),`]])
  js(`${cle} : les espaces autour ne sont plus retirés`, ligne, `${cle}: champ.${cle}.value,`, cle === 'courriel' ? 'un champ de type « courriel » perd déjà ses espaces autour (règle du navigateur) : aucune différence' : undefined);
js('nom : seuls les espaces du début sont retirés', `nom: champ.nom.value.replace(/^\\s+|\\s+$/g, ''),`, `nom: champ.nom.value.replace(/^\\s+/g, ''),`);
js('adresse : seuls les espaces de la fin sont retirés', `adresse: champ.adresse.value.replace(/^\\s+|\\s+$/g, ''),`, `adresse: champ.adresse.value.replace(/\\s+$/g, ''),`);

// ---- l'affichage des erreurs
js('le curseur va au dernier champ en erreur au lieu du premier', `for (var i = 0; i < CHAMPS.length; i++) { if (erreurs[CHAMPS[i]]) { return CHAMPS[i]; } }`, `for (var i = CHAMPS.length - 1; i >= 0; i--) { if (erreurs[CHAMPS[i]]) { return CHAMPS[i]; } }`);
js('le curseur n\'est plus placé sur le champ en erreur', `if (champ[premier].focus) { champ[premier].focus(); }`, ``);
js('seul le premier champ en erreur est montré', `CHAMPS.forEach(function (cle) { if (erreurs[cle]) { montrerErreur(cle, erreurs[cle]); } });`, `montrerErreur(premier, erreurs[premier]);`);
js('l\'ordre des champs est changé (le cellulaire d\'abord)', `var CHAMPS = ['nom', 'cellulaire', 'adresse', 'courriel', 'accepte'];`, `var CHAMPS = ['cellulaire', 'nom', 'adresse', 'courriel', 'accepte'];`);
js('un champ en erreur n\'est plus marqué (bordure rouge)', `if (invalide) { cible.classList.add(classe); el.setAttribute('aria-invalid', 'true'); }`, `if (invalide) { el.setAttribute('aria-invalid', 'true'); }`);
js('un champ en erreur n\'a plus aria-invalid', `if (invalide) { cible.classList.add(classe); el.setAttribute('aria-invalid', 'true'); }`, `if (invalide) { cible.classList.add(classe); }`);
js('la marque d\'erreur du champ ne disparaît jamais', `else { cible.classList.remove(classe); el.removeAttribute('aria-invalid'); }`, `else { el.removeAttribute('aria-invalid'); }`);
js('aria-invalid ne disparaît jamais', `else { cible.classList.remove(classe); el.removeAttribute('aria-invalid'); }`, `else { cible.classList.remove(classe); }`);
js('la marque d\'erreur de la case va sur la case au lieu de son étiquette', `var cible = cle === 'accepte' ? el.parentNode : el;`, `var cible = el;`);
js('le texte de l\'erreur n\'est plus écrit', `zone.textContent = message;\n\t\tzone.hidden = false;\n\t\tmarquer(cle, true);`, `zone.hidden = false;\n\t\tmarquer(cle, true);`);
js('la zone d\'erreur reste cachée', `zone.textContent = message;\n\t\tzone.hidden = false;`, `zone.textContent = message;`);
js('effacer une erreur ne vide plus son texte', `zone.textContent = '';\n\t\tzone.hidden = true;\n\t\tmarquer(cle, false);`, `zone.hidden = true;\n\t\tmarquer(cle, false);`);
js('effacer une erreur ne la cache plus', `zone.textContent = '';\n\t\tzone.hidden = true;\n\t\tmarquer(cle, false);`, `zone.textContent = '';\n\t\tmarquer(cle, false);`);
js('l\'alerte générale n\'est plus affichée', `alerte.innerHTML = html;\n\t\talerte.hidden = false;`, `alerte.innerHTML = html;`);
js('l\'alerte générale ne garde pas son texte', `alerte.innerHTML = html;\n\t\talerte.hidden = false;`, `alerte.hidden = false;`);
js('l\'alerte générale n\'est plus effacée au nouvel essai', `alerte.innerHTML = '';\n\t\talerte.hidden = true;\n\t}`, `}`);
js('les anciennes erreurs ne sont plus effacées au nouvel essai', `function effacerTout() {\n\t\tCHAMPS.forEach(effacerErreur);`, `function effacerTout() {`);
js('les erreurs ne sont plus effacées quand la personne corrige un champ', `champ[cle].addEventListener(evenement, function () {\n\t\t\teffacerErreur(cle);`, `champ[cle].addEventListener(evenement, function () {`);
js('le champ corrigé n\'est écouté qu\'au changement de focus (blur)', `var evenement = cle === 'accepte' ? 'change' : 'input';`, `var evenement = cle === 'accepte' ? 'change' : 'blur';`);
js('la case n\'est plus écoutée au changement (clic)', `var evenement = cle === 'accepte' ? 'change' : 'input';`, `var evenement = cle === 'accepte' ? 'click' : 'input';`);
js('la case cochée ne devient plus verte', `if (champ.accepte.checked) { champ.accepte.parentNode.classList.add('av-coche'); }`, `if (champ.accepte.checked) { void 0; }`);
js('la case décochée reste verte', `else { champ.accepte.parentNode.classList.remove('av-coche'); }\n\t\t\t}`, `else { void 0; }\n\t\t\t}`);

// ---- l'envoi et le résultat
js('la soumission n\'est plus annulée (la page se rechargerait avec les données dans l\'adresse)', `ev.preventDefault();\n\t\tif (enCours) { return; }`, `if (enCours) { return; }`);
js('le double envoi n\'est plus empêché', `if (enCours) { return; }\n\t\teffacerTout();`, `effacerTout();`);
js('« en cours » n\'est jamais levé après une erreur (plus de nouvel essai possible)', `function fini() {\n\t\tenCours = false;`, `function fini() {`);
js('« en cours » n\'est jamais posé (le double envoi passe)', `enCours = true;\n\t\tbouton.disabled = true;`, `bouton.disabled = true;`);
js('le bouton n\'est pas bloqué pendant l\'envoi', `enCours = true;\n\t\tbouton.disabled = true;`, `enCours = true;`);
js('le bouton ne dit pas « Envoi en cours… »', `bouton.textContent = 'Envoi en cours…';`, ``);
js('le bouton reste désactivé après l\'envoi', `function fini() {\n\t\tenCours = false;\n\t\tbouton.disabled = false;`, `function fini() {\n\t\tenCours = false;`);
js('le bouton garde « Envoi en cours… » après l\'envoi', `bouton.textContent = TEXTE_BOUTON;\n\t}`, `}`);
js('le texte du bouton d\'origine est oublié', `var TEXTE_BOUTON = bouton.textContent;`, `var TEXTE_BOUTON = 'Envoyer';`);
js('le bouton n\'est jamais activé au chargement', `\tbouton.disabled = false;\n})();`, `})();`);
js('le formulaire n\'écoute plus l\'envoi (mais le clic)', `form.addEventListener('submit', function (ev) {`, `form.addEventListener('click', function (ev) {`);
js('le succès n\'efface pas les champs', `CHAMPS.forEach(function (cle) { if (cle === 'accepte') { champ.accepte.checked = false; } else { champ[cle].value = ''; } });`, ``);
js('le succès n\'efface que la case, pas les champs texte', `if (cle === 'accepte') { champ.accepte.checked = false; } else { champ[cle].value = ''; }`, `if (cle === 'accepte') { champ.accepte.checked = false; }`);
js('le succès n\'efface que les champs texte, pas la case', `if (cle === 'accepte') { champ.accepte.checked = false; } else { champ[cle].value = ''; }`, `if (cle !== 'accepte') { champ[cle].value = ''; }`);
js('le succès laisse la case verte', `champ.accepte.parentNode.classList.remove('av-coche');\n\t\tform.hidden = true;`, `form.hidden = true;`);
js('le succès ne cache pas le formulaire', `form.hidden = true;\n\t\tmerci.hidden = false;`, `merci.hidden = false;`);
js('le succès n\'affiche pas le « merci »', `form.hidden = true;\n\t\tmerci.hidden = false;`, `form.hidden = true;`);
js('le « merci » ne reçoit pas le curseur', `if (merci.focus) { merci.focus(); }`, ``);
js('le succès plante sur un navigateur sans scrollIntoView', `if (merci.scrollIntoView) { merci.scrollIntoView(); }`, `merci.scrollIntoView();`);
js('toute réponse « ok » est prise pour un succès', `if (r.ok && statut === 'enregistree') { succes(v.promo); } else { echec(r.texte); }`, `if (r.ok) { succes(v.promo); } else { echec(r.texte); }`);
js('le statut seul décide du succès (même avec une erreur HTTP)', `if (r.ok && statut === 'enregistree') { succes(v.promo); } else { echec(r.texte); }`, `if (statut === 'enregistree') { succes(v.promo); } else { echec(r.texte); }`, 'le statut n\'est lu que si la réponse est « ok » : pour une erreur HTTP il reste vide, donc aucune différence');
js('tout est pris pour un succès', `if (r.ok && statut === 'enregistree') { succes(v.promo); } else { echec(r.texte); }`, `succes(v.promo);`);
js('un échec est aussi pris pour un succès', `else { echec(r.texte); }`, `else { succes(v.promo); }`);
js('une réponse illisible est prise pour un succès', `catch (e) { statut = ''; } }`, `catch (e) { statut = 'enregistree'; } }`);
js('le statut n\'est lu que si la réponse est « ok »', `if (r.ok) { try { statut`, `if (true) { try { statut`, 'le succès exige déjà « r.ok » : lire le statut de plus ne change rien');
js('une erreur illisible est prise pour un champ en erreur', `try { code = String(JSON.parse(texte).message || ''); } catch (e) { code = ''; }`, `try { code = String(JSON.parse(texte).message || ''); } catch (e) { code = 'nom_invalide'; }`);
for (const [code, cle, autre] of [['nom_invalide', 'nom', 'adresse'], ['cellulaire_invalide', 'cellulaire', 'nom'], ['adresse_invalide', 'adresse', 'nom'], ['courriel_invalide', 'courriel', 'adresse'], ['consentement_requis', 'accepte', 'nom']])
  js(`« ${code} » est montré sous le mauvais champ`, `${code}: '${cle}'`, `${code}: '${autre}'`);
js('« consentement_requis » n\'est plus reconnu', `,\n\t\tconsentement_requis: 'accepte'\n`, `\n`);
js('« nom_invalide » n\'est plus reconnu', `\t\tnom_invalide: 'nom',\n`, ``);
js('le message d\'erreur de la base n\'est plus lu (tout est « général »)', `code = String(JSON.parse(texte).message || '');`, `code = '';`);
js('l\'erreur d\'un champ ne met plus le curseur sur ce champ', `montrerErreur(cle, MSG_CODE[code] || MSG_CHAMP[cle]);\n\t\t\tif (champ[cle].focus) { champ[cle].focus(); }`, `montrerErreur(cle, MSG_CODE[code] || MSG_CHAMP[cle]);`);
js('l\'erreur d\'un champ n\'est plus montrée', `montrerErreur(cle, MSG_CODE[code] || MSG_CHAMP[cle]);\n\t\t\tif (champ[cle].focus)`, `if (champ[cle].focus)`);
js('« version_inconnue » n\'est plus expliqué', `CODE_ALERTE[code]) {\n\t\t\tmontrerAlerte(CODE_ALERTE[code]);`, `CODE_ALERTE[code]) {\n\t\t\tmontrerAlerte(MSG_AUTRE);`);
js('« version_inconnue » ne dit plus de recharger la page', `Rechargez la page, puis réessayez.`, `Réessayez.`);
js('« trop_de_demandes » ne donne plus le téléphone', `Réessayez plus tard ou téléphonez-nous au ' + TEL + '.'`, `Réessayez plus tard.'`);
js('« trop_de_demandes » n\'est plus reconnu', `\t\ttrop_de_demandes: 'Il y a eu trop de demandes`, `\t\ttrop_de_demandes_x: 'Il y a eu trop de demandes`);
js('le lien téléphonique des alertes est retiré', `var TEL = '<a href="tel:18192688069">819 268-8069</a>';`, `var TEL = '819 268-8069';`);
js('le numéro de téléphone des alertes est faux', `var TEL = '<a href="tel:18192688069">819 268-8069</a>';`, `var TEL = '<a href="tel:18192680000">819 268-0000</a>';`);
js('le message « navigateur trop ancien » ne donne plus le téléphone', `Votre navigateur est trop ancien pour envoyer l\\'inscription. Téléphonez-nous au ' + TEL + '.'`, `Votre navigateur est trop ancien pour envoyer l\\'inscription.'`);
js('le message général ne donne plus le téléphone', `Une erreur est survenue. Réessayez dans un instant, ou téléphonez-nous au ' + TEL + '.'`, `Une erreur est survenue. Réessayez dans un instant.'`);
js('le message réseau ne donne plus le téléphone', `Connexion impossible. Vérifiez votre réseau et réessayez, ou téléphonez-nous au ' + TEL + '.'`, `Connexion impossible. Vérifiez votre réseau et réessayez.'`);
js('les messages de champ ne disent plus quoi faire (cellulaire)', `Écrivez un numéro de cellulaire à 10 chiffres, par exemple 819 555-1234.`, `Numéro invalide.`);
js('les messages de champ ne disent plus quoi faire (nom)', `Écrivez votre nom complet (au moins 2 lettres).`, `Nom invalide.`);
js('les messages de champ ne disent plus quoi faire (adresse)', `Écrivez l\\'adresse où nous faisons vos travaux (numéro et rue).`, `Adresse invalide.`);
js('les messages de champ ne disent plus quoi faire (case)', `Cochez la case pour accepter de recevoir les textos.`, `Case obligatoire.`);
js('l\'élément « merci » est cherché sous un autre nom', `var merci = $('avis-merci');`, `var merci = $('avis-merci-x');`);
js('le script s\'arrête en silence s\'il ne trouve pas le formulaire (mais le cherche mal)', `var form = $('avis-form');`, `var form = $('avis-formulaire');`);
js('le piège anti-robot est lu sous un autre nom', `$('avis-site-web').value`, `$('avis-site').value`);

// =================== avis.html ===================
html('la page est notée en anglais', `<html lang="fr">`, `<html lang="en">`);
html('la page peut être indexée par Google', `\t<meta name="robots" content="noindex">\n`, ``);
html('le formulaire envoie en GET (les données iraient dans l\'adresse sans JavaScript)', `<form id="avis-form" method="post" novalidate>`, `<form id="avis-form" method="get" novalidate>`);
html('le formulaire a une adresse d\'envoi', `<form id="avis-form" method="post" novalidate>`, `<form id="avis-form" method="post" action="soumission-form.php" novalidate>`);
html('le formulaire n\'est plus « novalidate » (le navigateur ajoute ses propres messages)', `<form id="avis-form" method="post" novalidate>`, `<form id="avis-form" method="post">`);
html('le nom peut avoir 101 caractères', `maxlength="100" name="nom"`, `maxlength="101" name="nom"`);
html('le nom peut avoir 99 caractères seulement', `maxlength="100" name="nom"`, `maxlength="99" name="nom"`);
html('le cellulaire peut avoir 31 caractères', `maxlength="30" name="cellulaire"`, `maxlength="31" name="cellulaire"`);
html('l\'adresse peut avoir 201 caractères', `maxlength="200" name="adresse"`, `maxlength="201" name="adresse"`);
html('le courriel peut avoir 151 caractères', `maxlength="150" name="courriel"`, `maxlength="151" name="courriel"`);
html('le champ cellulaire n\'est plus de type téléphone', `inputmode="tel" maxlength="30" name="cellulaire" placeholder="819 555-1234" type="tel"`, `inputmode="tel" maxlength="30" name="cellulaire" placeholder="819 555-1234" type="text"`);
html('le champ cellulaire n\'a plus le clavier numérique', `inputmode="tel" maxlength="30"`, `maxlength="30"`);
html('le champ courriel n\'est plus de type courriel', `name="courriel" placeholder="Courriel" type="email"`, `name="courriel" placeholder="Courriel" type="text"`);
html('le nom n\'est plus rempli d\'office par le navigateur', `autocomplete="name"`, `autocomplete="off"`);
html('l\'adresse n\'est plus remplie d\'office par le navigateur', `autocomplete="street-address" class`, `class`);
html('le courriel devient obligatoire dans la page', `<input autocomplete="email"`, `<input aria-required="true" autocomplete="email"`);
html('le courriel n\'est plus marqué « facultatif »', `Courriel <span class="av-facultatif">(facultatif)</span>`, `Courriel`);
html('le nom n\'est plus marqué obligatoire', `Nom complet <span class="required">*</span>`, `Nom complet`);
html('le cellulaire n\'est plus marqué obligatoire (aria)', `<input aria-required="true" autocomplete="tel"`, `<input autocomplete="tel"`);
html('la case de consentement est cochée d\'avance', `<input aria-required="true" id="avis-accepte" name="accepte" type="checkbox" value="oui" />`, `<input aria-required="true" checked id="avis-accepte" name="accepte" type="checkbox" value="oui" />`);
html('la case de consentement n\'est plus une case à cocher', `name="accepte" type="checkbox" value="oui"`, `name="accepte" type="radio" value="oui"`);
html('l\'étiquette de la case ne pointe plus vers la case', `<label class="av-case" for="avis-accepte">`, `<label class="av-case" for="avis-autre">`);
html('le bouton d\'envoi est actif dès le départ', `<button class="av-btn" disabled id="avis-envoi" type="submit">`, `<button class="av-btn" id="avis-envoi" type="submit">`);
html('le bouton d\'envoi n\'envoie plus le formulaire', `disabled id="avis-envoi" type="submit">`, `disabled id="avis-envoi" type="button">`);
html('le champ piège devient accessible au clavier', `tabindex="-1" type="text" value="" />`, `tabindex="0" type="text" value="" />`);
html('le champ piège est rempli d\'avance', `tabindex="-1" type="text" value="" />`, `tabindex="-1" type="text" value="x" />`);
html('le champ piège est rempli par le navigateur', `<input autocomplete="off" id="avis-site-web"`, `<input autocomplete="on" id="avis-site-web"`);
html('le champ piège n\'est plus caché aux lecteurs d\'écran', `<div aria-hidden="true" class="av-piege">`, `<div class="av-piege">`);
html('le champ piège n\'est plus dans le bloc caché', `<div aria-hidden="true" class="av-piege">`, `<div aria-hidden="true" class="av-autre">`);
html('le champ piège porte un autre nom', `id="avis-site-web" name="site_web"`, `id="avis-site-web" name="site"`);
html('la version cachée du texte change', `<input id="avis-version" name="version" type="hidden" value="texto-2026-10-v1" />`, `<input id="avis-version" name="version" type="hidden" value="texto-2026-10-v2" />`);
html('la version du texte n\'est plus cachée (modifiable)', `<input id="avis-version" name="version" type="hidden"`, `<input id="avis-version" name="version" type="text"`);
html('le texte de consentement n\'annonce plus « Aucune publicité »', `Aucune publicité. La fréquence`, `La fréquence`);
html('le texte de consentement n\'annonce plus STOP', `répondant ARRET (ou STOP), ou obtenir`, `répondant ARRET, ou obtenir`);
html('le texte de consentement n\'annonce plus HELP', `AIDE (ou HELP) ou en appelant`, `AIDE ou en appelant`);
html('le texte de consentement n\'annonce plus les frais', `Des frais de messagerie et de données peuvent s'appliquer selon mon forfait. `, ``);
html('le texte de consentement n\'annonce plus la fréquence', `La fréquence varie selon les travaux (jusqu'à quelques textos par semaine en saison). `, ``);
html('le texte de consentement ne dit plus que le numéro n\'est ni vendu ni partagé', `Mon numéro n'est ni vendu ni partagé avec des tiers, sauf le fournisseur qui envoie les textos pour Entretien Lapointe. `, ``);
html('le texte de consentement ne dit plus que c\'est facultatif', `Cette inscription est facultative : je reçois mes services même si je ne m'inscris pas.`, `Cette inscription est obligatoire.`);
html('le texte de consentement a une virgule de plus', `J'accepte de recevoir des textos d'Entretien Lapointe au numéro ci-dessus,`, `J'accepte de recevoir des textos d'Entretien Lapointe au numéro ci-dessus, `.replace(' ', ', '));
html('le texte de consentement change d\'un seul mot', `pour les avis liés à mes services`, `pour les avis liés à nos services`);
html('le numéro de téléphone du texte de consentement est faux', `en appelant le 819 268-8069. Mon numéro`, `en appelant le 819 268-8096. Mon numéro`);
html('le lien vers la politique de confidentialité est retiré', `<a href="confidentialite.html">Politique de confidentialité</a></p>\n</div>\n\n</form>`, `Politique de confidentialité</p>\n</div>\n\n</form>`);
html('un traceur (Pixel Meta) est ajouté à la page', `</head>`, `<script>!function(f,b,e,v,n,t,s){n=f.fbq=function(){};}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init', '309521644485015');</script>\n</head>`);
html('une balise Google est ajoutée à la page', `</head>`, `<script async src="https://www.googletagmanager.com/gtag/js?id=AW-869096486"></script>\n</head>`);
html('un script d\'un autre site est chargé', `<script src="js/avis.js"></script>`, `<script src="https://exemple.com/avis.js"></script>`);
html('un script est écrit dans la page', `<script src="js/avis.js"></script>`, `<script src="js/avis.js"></script><script>var x = 1;</script>`);
html('un lien téléphonique appelle un suivi (onclick)', `<a href="tel:18192688069" style="color: inherit; text-decoration: none;">819 268-8069</a>\n</div>\n</div>\n\n<div class="media small-teaser">`, `<a href="tel:18192688069" onclick="gtag_report_conversion()" style="color: inherit; text-decoration: none;">819 268-8069</a>\n</div>\n</div>\n\n<div class="media small-teaser">`);
html('une image d\'un autre site est ajoutée', `</form>\n\n<div class="av-merci"`, `</form>\n<img src="https://www.facebook.com/tr?id=1&ev=PageView" alt="" />\n\n<div class="av-merci"`);
html('le fichier de style n\'existe pas', `<link href="css/avis.css" rel="stylesheet" />`, `<link href="css/avis-x.css" rel="stylesheet" />`);
html('le script de la page n\'existe pas', `<script src="js/avis.js"></script>`, `<script src="js/avis-x.js"></script>`);
html('un lien du menu mène à une page qui n\'existe pas', `<li><a href="contact.html">Contact</a></li>`, `<li><a href="contacts.html">Contact</a></li>`);
html('le thème du site n\'est plus chargé (main.css)', `<link class="color-switcher-link" href="css/main.css" rel="stylesheet" />`, `<link class="color-switcher-link" href="css/main-x.css" rel="stylesheet" />`);
html('la zone d\'erreur du nom est renommée (le script ne la trouve plus)', `id="avis-err-nom"`, `id="avis-err-nom-x"`);
html('la zone d\'erreur de la case est renommée', `id="avis-err-accepte"`, `id="avis-err-accepte-x"`);
html('l\'alerte n\'est plus annoncée aux lecteurs d\'écran', `hidden id="avis-alerte" role="alert"`, `hidden id="avis-alerte"`);
html('le « merci » n\'est plus annoncé aux lecteurs d\'écran', `hidden id="avis-merci" role="status" tabindex="-1"`, `hidden id="avis-merci" tabindex="-1"`);
html('le « merci » est visible dès le départ', `<div class="av-merci" hidden id="avis-merci"`, `<div class="av-merci" id="avis-merci"`);
html('l\'alerte est visible dès le départ', `<div class="av-alerte" hidden id="avis-alerte"`, `<div class="av-alerte" id="avis-alerte"`);
html('une zone d\'erreur est visible dès le départ', `<div class="av-erreur" id="avis-err-nom" hidden></div>`, `<div class="av-erreur" id="avis-err-nom"></div>`);
html('le « merci » ne peut pas recevoir le curseur', `hidden id="avis-merci" role="status" tabindex="-1"`, `hidden id="avis-merci" role="status"`);
html('le « merci » ne parle plus du dossier client', `Nous allons la relier à votre dossier client. `, ``);
html('le « merci » ne parle plus du désabonnement', `Vous pouvez vous désabonner en tout temps en répondant ARRET (ou STOP) à l'un de nos textos. `, ``);
html('plus aucun lien « tel: » vers le numéro de Joé dans la page (il n\'est plus joignable d\'un toucher)', [[`href="tel:18192688069"`, `href="#"`, 'tous']]);
html('la page ne donne plus l\'adresse postale à côté de la case', `Entretien Lapointe, 331, Le Petit Bellechasse N, Charette (Québec) G0X 1E0 · `, `Entretien Lapointe · `);
html('la page ne donne plus le nom de l\'entreprise à côté de la case', `id="avis-identification">Entretien Lapointe, 331,`, `id="avis-identification">331,`);
html('le téléphone n\'est plus un lien à côté de la case', `Charette (Québec) G0X 1E0 · <a href="tel:18192688069">819 268-8069</a> · <a href="mailto:info@entretienlapointe.ca">`, `Charette (Québec) G0X 1E0 · 819 268-8069 · <a href="mailto:info@entretienlapointe.ca">`);
html('le courriel n\'est plus un lien à côté de la case', `<a href="mailto:info@entretienlapointe.ca">info@entretienlapointe.ca</a></p>\n</div>\n\n<input id="avis-version"`, `info@entretienlapointe.ca</p>\n</div>\n\n<input id="avis-version"`);
html('la page ne dit plus que les textos viennent d\'un numéro automatisé', `Les textos viennent d'un numéro automatisé qui ne lit pas les réponses (sauf ARRET et AIDE). `, ``);

// =================== confidentialite.html ===================
conf('la personne responsable n\'est plus nommée', `est Joé Lapointe, propriétaire.`, `est un employé.`);
conf('la date de mise à jour change', `Dernière mise à jour : 30 septembre 2026`, `Dernière mise à jour : 1 janvier 2020`);
conf('la politique n\'annonce plus « aucune publicité par texto »', `<li><strong>Aucune publicité</strong> par texto. Jamais.</li>\n`, ``);
conf('la politique n\'annonce plus STOP', `(ou <strong>STOP</strong>)`, ``);
conf('la politique n\'annonce plus HELP', `(ou <strong>HELP</strong>)`, ``);
conf('la politique n\'annonce plus les frais de messagerie', `<li>Des frais de messagerie et de données peuvent s'appliquer selon votre forfait.</li>\n`, ``);
conf('la politique ne dit plus que les opérateurs ne sont pas responsables des textos retardés', `<li>Les opérateurs de téléphonie mobile ne sont pas responsables des textos retardés ou non livrés.</li>\n`, ``);
conf('la politique n\'annonce plus la fréquence', `<li>La fréquence varie selon les travaux : jusqu'à quelques textos par semaine en saison.</li>\n`, ``);
conf('la politique n\'annonce plus l\'interdiction de textos entre 21 h et 6 h', `<li>Nous n'envoyons pas de texto entre 21 h et 6 h : un avis retardé attend le matin.</li>\n`, ``);
conf('la politique ne promet plus de ne pas vendre ni partager le numéro', `<li><strong>Nous ne vendons ni ne partageons votre numéro de cellulaire, ni votre consentement aux textos, avec des tiers à des fins de marketing ou de promotion.</strong></li>\n`, ``);
conf('la politique affaiblit la promesse sur le numéro', `Nous ne vendons ni ne partageons votre numéro de cellulaire, ni votre consentement aux textos, avec des tiers à des fins de marketing ou de promotion.`, `Nous ne vendons pas votre numéro de cellulaire.`);
conf('la politique ne dit plus que l\'inscription est facultative', `<li>L'inscription est facultative : vous recevez vos services même si vous ne vous inscrivez pas.</li>\n`, ``);
conf('la politique ne nomme plus Resend', `<li><strong>Resend</strong> : envoi des courriels d'avis (États-Unis).</li>\n`, ``);
conf('la politique ne nomme plus Twilio', `<li><strong>Twilio</strong> : envoi des textos d'avis de passage (États-Unis).</li>\n`, ``);
conf('la politique ne dit plus où est hébergée la base (Montréal)', `(hébergée à Montréal, au Canada)`, ``);
conf('la politique ne parle plus du traitement hors du Québec', `<h3>7. Renseignements traités hors du Québec</h3>\n<p>Certains de ces fournisseurs (Twilio, Resend, Intuit, Google, Meta) sont situés aux États-Unis : des renseignements peuvent donc être traités à l'extérieur du Québec.`, `<h3>7. Renseignements traités hors du Québec</h3>\n<p>Certains de ces fournisseurs (Twilio, Resend, Intuit, Google, Meta) sont situés aux États-Unis.`);
conf('la durée de conservation du dossier client change', `puis 2 ans après votre dernier service`, `puis 5 ans après votre dernier service`);
conf('le délai de réponse de 30 jours disparaît', `Nous répondons dans les 30 jours.`, `Nous répondons rapidement.`);
conf('la Commission d\'accès à l\'information n\'est plus nommée', `vous pouvez vous adresser à la Commission d'accès à l'information du Québec (<a href="https://www.cai.gouv.qc.ca" rel="noopener" target="_blank">cai.gouv.qc.ca</a>).`, `vous pouvez nous écrire.`);
conf('la politique ne dit plus que la page d\'inscription n\'a aucun traceur', `<p><strong>La page d'inscription aux avis de passage par texto n'utilise aucun de ces outils.</strong> Cette page de confidentialité non plus.</p>`, ``);
conf('la politique ne parle plus du Pixel Meta', `le Pixel Meta (Facebook) et la balise Google Ads`, `une balise`);
conf('la politique ne déclare plus les polices Google Fonts du thème', `\t<li><strong>Google Fonts</strong> : les polices de caractères de notre site, que votre navigateur télécharge directement chez Google pour afficher chaque page, y compris celle-ci.</li>\n`, ``);
conf('la politique ne parle plus d\'Esri et d\'OpenStreetMap', `<li><strong>Esri (images satellite) et OpenStreetMap (recherche d'adresses)</strong> : utilisés par le formulaire de soumission pour afficher la carte et trouver l'adresse que vous tapez.</li>\n`, ``);
conf('les offres par courriel : la durée passe à 5 ans', `seulement si vous êtes client depuis moins de 2 ans`, `seulement si vous êtes client depuis moins de 5 ans`);
conf('les offres par courriel : plus de délai de désabonnement', ` (au plus tard dans les 10 jours ouvrables)`, ``);
conf('une section n\'est plus numérotée', `<h3>7. Renseignements traités hors du Québec</h3>`, `<h3>Renseignements traités hors du Québec</h3>`);
conf('le droit de faire supprimer son dossier n\'est plus mentionné', `<li>demander que nous supprimions votre dossier, sauf ce que la loi nous oblige à garder.</li>\n`, ``);
conf('le droit de retirer son consentement n\'est plus mentionné', `<li>retirer votre consentement (par exemple, arrêter les textos ou les courriels d'offres) ;</li>\n`, ``);
conf('le lien de retour vers l\'inscription est retiré', `<p><a href="avis.html">← Retour à l'inscription aux avis de passage</a></p>`, ``);
conf('le courriel de contact n\'est plus un lien (demande d\'accès)', `Écrivez à <a href="mailto:info@entretienlapointe.ca">info@entretienlapointe.ca</a> ou appelez le`, `Écrivez à info@entretienlapointe.ca ou appelez le`);
conf('le numéro de téléphone n\'est plus un lien (demande d\'accès)', `ou appelez le <a href="tel:18192688069">819 268-8069</a>. Nous répondons`, `ou appelez le 819 268-8069. Nous répondons`);
conf('la section 4 ne parle plus du numéro automatisé', `<li>Les textos viennent d'un numéro automatisé qui ne lit pas les réponses (sauf ARRET et AIDE). Pour nous joindre, appelez-nous.</li>\n`, ``);
conf('la section 2 ne parle plus de l\'empreinte de l\'adresse IP', ` une empreinte chiffrée de votre adresse IP (elle ne permet pas de retrouver l'adresse elle-même)`, ``);
conf('la section 8 ne parle plus des preuves de consentement', `<li>Les preuves de consentement et de désabonnement : jusqu'à 3 ans après la fin de votre consentement, pour pouvoir respecter votre choix et le prouver.</li>\n`, ``);
conf('la section 9 ne parle plus de l\'avis en cas d\'incident', `<li>Si un incident de confidentialité présente un risque de préjudice sérieux, nous avisons la Commission d'accès à l'information du Québec et les personnes touchées, comme la loi l'exige.</li>\n`, ``);
conf('la section 12 ne promet plus de redemander l\'accord', ` Si le changement touche la façon dont nous utilisons votre numéro de cellulaire, nous vous demanderons de nouveau votre accord.`, ``);
conf('le lien vers la Commission n\'est plus sécurisé (noopener)', `rel="noopener" target="_blank">cai.gouv.qc.ca`, `target="_blank">cai.gouv.qc.ca`);
conf('un lien vers un autre site est ajouté à la politique', `<p><a href="avis.html">`, `<p><a href="https://exemple.com">Pourriel</a> <a href="avis.html">`);
conf('la section 5 ne parle plus de l\'accord pour les offres', `ou si vous nous avez donné votre accord`, ``);
conf('un fournisseur est nommé sans dire à quoi il sert (Twilio)', `<strong>Twilio</strong> : envoi des textos d'avis de passage (États-Unis).`, `<strong>Twilio</strong>.`);
conf('un traceur est ajouté à la politique', `</head>`, `<script async src="https://www.googletagmanager.com/gtag/js?id=AW-869096486"></script>\n</head>`);
conf('un script d\'un autre site est chargé par la politique', `<script src="js/main.js"></script>`, `<script src="js/main.js"></script><script src="https://exemple.com/x.js"></script>`);
conf('un lien de la politique mène à une page qui n\'existe pas', `<li><a href="realisations.html">R&eacute;alisations</a></li>\n\t<li><a href="soumission.html">Soumission</a></li>`, `<li><a href="realisations.html">R&eacute;alisations</a></li>\n\t<li><a href="soumission2.html">Soumission</a></li>`);

// =================== css/avis.css ===================
css('la règle « hidden » est retirée du style', `#avis [hidden] { display: none !important; }\n`, ``);
css('la règle « hidden » ne cache plus rien', `#avis [hidden] { display: none !important; }`, `#avis [hidden] { display: block; }`);
css('le champ piège n\'est plus sorti de l\'écran', `left: -9999px;`, `left: 0;`);
css('le champ piège n\'est plus en position absolue', `#avis .av-piege {\n\tposition: absolute;`, `#avis .av-piege {\n\tposition: static;`);
css('les champs ne sont plus en 16 px (zoom de l\'iPhone)', `font-size: 16px; /* 16 px`, `font-size: 14px; /* 14 px`);
css('une règle du style touche toute la page (plus limitée à #avis)', `#avis .av-intro { font-size: 16px; line-height: 26px; }`, `.av-intro { font-size: 16px; line-height: 26px; }`);
css('le style d\'une balise touche tout le site', `#avis label { display: block;`, `label { display: block;`);

// =================== la 2ᵉ case : les offres par courriel ===================
const PROMO_TEXTE = `J'accepte aussi de recevoir par courriel, de temps en temps, les offres et les nouvelles d'Entretien Lapointe (par exemple, un rappel avant la saison des feuilles). Je peux me désabonner en tout temps avec le lien au bas de chaque courriel ou en écrivant à info@entretienlapointe.ca. Cette case est facultative : elle n'a aucun effet sur mes services ni sur mes avis de passage. Entretien Lapointe, 331, Le Petit Bellechasse N, Charette (Québec) G0X 1E0, 819 268-8069.`;
const PROMO_BLOC = `<div class="av-consentement av-promo">\n<label class="av-case" for="avis-promo">\n<input id="avis-promo" name="promo" type="checkbox" value="oui" />\n<span id="avis-promo-texte">${PROMO_TEXTE}</span>\n</label>\n</div>\n\n`;
const IDENTIFICATION = `<p class="av-aide" id="avis-identification">Entretien Lapointe, 331, Le Petit Bellechasse N, Charette (Québec) G0X 1E0 · <a href="tel:18192688069">819 268-8069</a> · <a href="mailto:info@entretienlapointe.ca">info@entretienlapointe.ca</a></p>`;

// ---- avis.js
js('la 2ᵉ case est lue comme toujours cochée', `promo: champ.promo.checked === true,`, `promo: true,`);
js('la 2ᵉ case est lue comme jamais cochée', `promo: champ.promo.checked === true,`, `promo: false,`);
js('la 2ᵉ case est lue à l\'envers', `promo: champ.promo.checked === true,`, `promo: champ.promo.checked !== true,`);
js('la version des offres n\'est plus lue dans la page', `versionPromo: $('avis-version-promo').value,`, `versionPromo: 'promo-2026-10-v1',`);
js('la version des offres est lue dans le champ de la version des textos', `versionPromo: $('avis-version-promo').value,`, `versionPromo: $('avis-version').value,`);
js('les offres cochées n\'exigent plus de courriel dans la page', `\t\telse if (v.promo && v.courriel === '') { e.courriel = MSG_OFFRES; }\n`, ``);
js('le courriel est exigé même sans les offres', `else if (v.promo && v.courriel === '')`, `else if (v.courriel === '')`);
js('le courriel est exigé quand les offres ne sont PAS cochées', `else if (v.promo && v.courriel === '')`, `else if (!v.promo && v.courriel === '')`);
js('les offres sans courriel donnent le message habituel du courriel', `e.courriel = MSG_OFFRES; }`, `e.courriel = MSG_CHAMP.courriel; }`);
js('« p_promo » est toujours vrai', `p_promo: v.promo,`, `p_promo: true,`);
js('« p_promo » est toujours faux', `p_promo: v.promo,`, `p_promo: false,`);
js('« p_promo » est envoyé à l\'envers', `p_promo: v.promo,`, `p_promo: !v.promo,`);
js('les offres ne sont pas envoyées du tout', `.slice(0, 300),\n\t\t\t\tp_promo: v.promo,\n\t\t\t\tp_version_promo: v.promo ? v.versionPromo : null\n`, `.slice(0, 300)\n`);
js('« p_version_promo » est envoyé même sans les offres', `p_version_promo: v.promo ? v.versionPromo : null`, `p_version_promo: v.versionPromo`);
js('« p_version_promo » n\'est jamais envoyé', `p_version_promo: v.promo ? v.versionPromo : null`, `p_version_promo: null`);
js('« p_version_promo » est envoyé seulement SANS les offres', `p_version_promo: v.promo ? v.versionPromo : null`, `p_version_promo: v.promo ? null : v.versionPromo`);
js('le « merci » ne mentionne jamais les offres', `succes(v.promo);`, `succes(false);`);
js('le « merci » mentionne toujours les offres', `succes(v.promo);`, `succes(true);`);
js('le succès n\'a plus son paramètre des offres', `function succes(avecOffres) {`, `function succes() {`);
js('la mention des offres du « merci » n\'est plus gérée', `\t\t$('avis-merci-promo').hidden = !avecOffres;\n`, ``);
js('la mention des offres du « merci » est à l\'envers', `.hidden = !avecOffres;`, `.hidden = avecOffres;`);
js('le succès ne décoche pas la 2ᵉ case', `\t\tchamp.promo.checked = false;\n`, ``);
js('le succès laisse la 2ᵉ case verte', `\t\tchamp.promo.parentNode.classList.remove('av-coche');\n\t\t$('avis-merci-promo')`, `\t\t$('avis-merci-promo')`);
js('« courriel_requis_offres » n\'est plus reconnu', `\t\tcourriel_requis_offres: 'courriel',\n`, ``);
js('« courriel_requis_offres » est montré sous le nom', `courriel_requis_offres: 'courriel',`, `courriel_requis_offres: 'nom',`);
js('le message propre des offres n\'est plus utilisé pour « courriel_requis_offres »', `var MSG_CODE = { courriel_requis_offres: MSG_OFFRES };`, `var MSG_CODE = {};`);
js('« version_promo_inconnue » n\'est plus expliqué', `\t\tversion_promo_inconnue: MSG_PAS_A_JOUR,\n`, ``);
js('le message des offres est vague', `Écrivez votre courriel pour recevoir nos offres, ou décochez la deuxième case.`, `Courriel invalide.`);
js('le message des offres ne dit plus de décocher la case', `, ou décochez la deuxième case.`, `.`);
js('la 2ᵉ case cochée ne devient plus verte', `if (champ.promo.checked) { champ.promo.parentNode.classList.add('av-coche'); }`, `if (champ.promo.checked) { void 0; }`);
js('la 2ᵉ case décochée reste verte', `else { champ.promo.parentNode.classList.remove('av-coche'); }`, `else { void 0; }`);
js('décocher la 2ᵉ case n\'efface plus l\'erreur « courriel requis »', `\t\tif (!champ.promo.checked && $('avis-err-courriel').textContent === MSG_OFFRES) { effacerErreur('courriel'); }\n`, ``);
js('décocher la 2ᵉ case efface n\'importe quelle erreur de courriel', `if (!champ.promo.checked && $('avis-err-courriel').textContent === MSG_OFFRES)`, `if (!champ.promo.checked)`);
js('cocher la 2ᵉ case efface aussi l\'erreur « courriel requis »', `if (!champ.promo.checked && $('avis-err-courriel').textContent === MSG_OFFRES)`, `if ($('avis-err-courriel').textContent === MSG_OFFRES)`);
js('la 2ᵉ case n\'est plus écoutée au changement (clic)', `champ.promo.addEventListener('change', function () {`, `champ.promo.addEventListener('click', function () {`);
js('l\'élément de la 2ᵉ case est cherché sous un autre nom', `promo: $('avis-promo')`, `promo: $('avis-promo-x')`);
js('l\'élément de la version des offres est cherché sous un autre nom', `$('avis-version-promo').value`, `$('avis-version-promo-x').value`);

// ---- avis.html
html('la 2ᵉ case est cochée d\'avance', `<input id="avis-promo" name="promo" type="checkbox" value="oui" />`, `<input checked id="avis-promo" name="promo" type="checkbox" value="oui" />`);
html('la 2ᵉ case n\'est plus une case à cocher', `name="promo" type="checkbox"`, `name="promo" type="radio"`);
html('la 2ᵉ case devient obligatoire dans la page', `<input id="avis-promo" name="promo"`, `<input aria-required="true" id="avis-promo" name="promo"`);
html('l\'étiquette de la 2ᵉ case ne pointe plus vers elle', `<label class="av-case" for="avis-promo">`, `<label class="av-case" for="avis-autre">`);
html('la 2ᵉ case est retirée de la page', PROMO_BLOC, ``);
html('la 2ᵉ case est fusionnée dans le bloc de la case des textos', `<div class="av-erreur" id="avis-err-accepte" hidden></div>\n</div>\n\n<div class="av-consentement av-promo">`, `<div class="av-erreur" id="avis-err-accepte" hidden></div>\n<div class="av-promo">`);
html('la version cachée du texte des offres change', `name="version_promo" type="hidden" value="promo-2026-10-v1"`, `name="version_promo" type="hidden" value="promo-2026-10-v2"`);
html('la version du texte des offres n\'est plus cachée (modifiable)', `name="version_promo" type="hidden"`, `name="version_promo" type="text"`);
html('la version du texte des offres est retirée de la page', `<input id="avis-version-promo" name="version_promo" type="hidden" value="promo-2026-10-v1" />\n`, ``);
html('le texte des offres ne dit plus « par courriel »', `J'accepte aussi de recevoir par courriel, de temps en temps,`, `J'accepte aussi de recevoir, de temps en temps,`);
html('le texte des offres parle aussi de textos', `J'accepte aussi de recevoir par courriel, de temps en temps,`, `J'accepte aussi de recevoir par courriel et par texto, de temps en temps,`);
html('le texte des offres ne dit plus « de temps en temps »', `par courriel, de temps en temps, les offres`, `par courriel les offres`);
html('le texte des offres ne donne plus l\'exemple des feuilles', ` (par exemple, un rappel avant la saison des feuilles)`, ``);
html('le texte des offres ne dit plus comment se désabonner', `Je peux me désabonner en tout temps avec le lien au bas de chaque courriel ou en écrivant à info@entretienlapointe.ca. `, ``);
html('le texte des offres ne parle plus du lien de désabonnement', `avec le lien au bas de chaque courriel ou en écrivant`, `en écrivant`);
html('le texte des offres ne dit plus que la case est facultative', `Cette case est facultative : elle n'a aucun effet sur mes services ni sur mes avis de passage. `, ``);
html('le texte des offres ne dit plus qu\'il n\'y a aucun effet sur les services', `elle n'a aucun effet sur mes services ni sur mes avis de passage`, `elle compte`);
html('le texte des offres ne donne plus l\'adresse postale', `Entretien Lapointe, 331, Le Petit Bellechasse N, Charette (Québec) G0X 1E0, 819 268-8069.</span>`, `Entretien Lapointe, 819 268-8069.</span>`);
html('le texte des offres ne donne plus le code postal', `Charette (Québec) G0X 1E0, 819 268-8069.</span>`, `Charette (Québec), 819 268-8069.</span>`);
html('le texte des offres donne un mauvais code postal', `Charette (Québec) G0X 1E0, 819 268-8069.</span>`, `Charette (Québec) G0X 1E1, 819 268-8069.</span>`);
html('la ligne d\'identification ne donne plus le code postal', `Charette (Québec) G0X 1E0 · <a href="tel:18192688069">819 268-8069</a>`, `Charette (Québec) · <a href="tel:18192688069">819 268-8069</a>`);
html('la ligne d\'identification donne un mauvais code postal', `Charette (Québec) G0X 1E0 · <a href="tel:18192688069">819 268-8069</a>`, `Charette (Québec) G0X 1E1 · <a href="tel:18192688069">819 268-8069</a>`);
conf('la section 1 ne donne plus le code postal', `Charette (Québec) G0X 1E0.</p>`, `Charette (Québec).</p>`);
conf('la section 1 donne un mauvais code postal', `Charette (Québec) G0X 1E0.</p>`, `Charette (Québec) G0X 1E1.</p>`);
html('le texte des offres ne donne plus le téléphone', `Charette (Québec) G0X 1E0, 819 268-8069.</span>`, `Charette (Québec) G0X 1E0.</span>`);
html('le texte des offres donne un mauvais courriel', `en écrivant à info@entretienlapointe.ca.`, `en écrivant à info@exemple.ca.`);
html('le texte des offres change d\'un seul mot', `les offres et les nouvelles d'Entretien Lapointe`, `les offres et les nouvelles de Lapointe`);
html('le « merci » montre la mention des offres dès le départ', `<p hidden id="avis-merci-promo">`, `<p id="avis-merci-promo">`);
html('la mention des offres du « merci » est renommée (le script ne la trouve plus)', `id="avis-merci-promo"`, `id="avis-merci-promo-x"`);
html('la mention des offres du « merci » ne parle plus d\'offres par courriel', `Nous avons aussi noté votre accord pour recevoir nos offres par courriel : `, `Merci : `);
html('la mention des offres du « merci » ne parle plus du désabonnement', `vous pouvez vous désabonner en tout temps avec le lien au bas de chaque courriel.</p>`, `merci.</p>`);
html('le bloc des consentements est renommé (l\'identification n\'est plus dedans)', `<div class="av-consentements">`, `<div class="av-autres">`);
html('l\'aide du courriel ne parle plus des offres', `Votre courriel sert aux avis liés à vos services et, seulement si vous cochez la deuxième case plus bas, à nos offres.`, `Votre courriel sert uniquement aux avis liés à vos services.`);
html('l\'identification est sortie du bloc des consentements', `${IDENTIFICATION}\n</div>\n\n<input id="avis-version"`, `</div>\n${IDENTIFICATION}\n\n<input id="avis-version"`);
html('l\'identification est déplacée DANS l\'étiquette de la 2ᵉ case (donc dans le texte gardé comme preuve)', [[`<span id="avis-promo-texte">${PROMO_TEXTE}</span>\n</label>\n</div>\n\n${IDENTIFICATION}\n</div>`, `<span id="avis-promo-texte">${PROMO_TEXTE}</span>\n${IDENTIFICATION}\n</label>\n</div>\n\n</div>`]]);

// ---- confidentialite.html
conf('la section 2 ne parle plus de l\'accord aux offres qui est gardé', ` Si vous cochez la case facultative des offres par courriel, nous gardons aussi cet accord (date et texte accepté).`, ``);
conf('la section 3 ne parle plus des offres par courriel', `\t<li>Vous envoyer nos offres et nos nouvelles par courriel, seulement si vous avez accepté d'en recevoir.</li>\n`, ``);
conf('la section 5 ne parle plus de la 2ᵉ case de la page', ` Vous pouvez nous donner cet accord en cochant la deuxième case, facultative, de la page d'inscription aux avis de passage, ou en nous le disant.`, ``);
conf('la section 5 ne dit plus que la case n\'a aucun effet sur les services', ` Cette case n'a aucun effet sur vos services ni sur vos avis de passage.`, ``);
conf('la section 5 ne promet plus qu\'il n\'y aura jamais de publicité par texto', ` Nous n'envoyons jamais de publicité par texto.`, ``);

// =================== l'exécution ===================
const APPLIQUER = (texte, paires) => paires.reduce((t, [a, b, tous]) => (tous ? t.split(a).join(b) : t.replace(a, () => b)), texte);   // « tous » : remplace TOUTES les occurrences
const tache = [];
const rapport = [];
for (const [i, mu] of M.entries()) {
  if (MATCH && !MATCH.test(mu.nom)) continue;
  const mauvais = mu.paires.map(([a, , tous]) => (tous ? (SOURCE[mu.fichier].includes(a) ? 1 : 0) : SOURCE[mu.fichier].split(a).length - 1)).find((c) => c !== 1);
  if (mauvais !== undefined) { rapport.push(`?? ${i + 1}. TEXTE ${mauvais === 0 ? 'INTROUVABLE' : 'EN ' + mauvais + ' EXEMPLAIRES'} (${mu.fichier}) : ${mu.nom}`); console.log(rapport[rapport.length - 1]); continue; }
  const abime = APPLIQUER(SOURCE[mu.fichier], mu.paires);
  if (abime === SOURCE[mu.fichier]) { rapport.push(`?? ${i + 1}. MUTATION SANS EFFET : ${mu.nom}`); console.log(rapport[rapport.length - 1]); continue; }
  tache.push({ i, mu, abime });
}

let detectees = 0, essayees = 0, equivalentes = 0;
if (process.env.VALIDER) {
  console.log(`\n${M.length} mutations examinées, ${rapport.length} à corriger`);
} else {
  const racineTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'page-avis-mut-'));
  const lancer = ({ i, mu, abime }) => new Promise((resolve) => {
    const dossier = path.join(racineTmp, String(i + 1));
    fs.cpSync(SITE, dossier, { recursive: true });
    fs.writeFileSync(path.join(dossier, mu.fichier), abime);
    execFile('node', ['test-page-avis.mjs'], { cwd: TESTS, env: { ...process.env, SITE_TEST: dossier }, encoding: 'utf8', timeout: 240000, maxBuffer: 50 * 1024 * 1024 }, (erreur, stdout, stderr) => {
      const sortie = String(stdout || '') + String(stderr || '');
      const r = sortie.match(/RÉSULTAT : (\d+) réussis, (\d+) échoués/);
      const ko = r ? Number(r[2]) : -1;
      const vu = ko !== 0;
      essayees++; if (vu) detectees++;
      if (!vu && mu.equivalente) { equivalentes++; rapport.push(`=  équivalente ${i + 1}. ${mu.nom}  [${mu.equivalente}]`); console.log(rapport[rapport.length - 1]); fs.rmSync(dossier, { recursive: true, force: true }); return resolve(); }
      rapport.push(`${vu ? 'OK  détectée' : 'RATÉE      '} ${i + 1}. ${mu.nom}${r ? ' (' + ko + ' échec(s))' : ' (plantage)'}`);
      console.log(rapport[rapport.length - 1]);
      fs.rmSync(dossier, { recursive: true, force: true });
      resolve();
    });
  });
  let suivant = 0;
  await Promise.all(Array.from({ length: PARALLELE }, async () => { while (suivant < tache.length) await lancer(tache[suivant++]); }));
  fs.rmSync(racineTmp, { recursive: true, force: true });
  console.log(`\n${detectees} erreurs volontaires détectées sur ${essayees - equivalentes}` + (equivalentes ? `, et ${equivalentes} équivalente(s) qui ne changent rien au comportement (pas des trous)` : ''));
  const rates = rapport.filter((l) => l.startsWith('RATÉE') || l.startsWith('??'));
  if (rates.length) console.log('À REGARDER :\n' + rates.join('\n'));
}
const apres = lireTout();
console.log(FICHIERS.every((f) => apres[f] === SOURCE[f]) ? 'Le vrai dossier (site-consentement) est intact.' : '⚠ LE VRAI DOSSIER A CHANGÉ !');
