// Demande 5 — outil des ERREURS VOLONTAIRES de la fonction « recevoir-texto » (supabase/functions/recevoir-texto/index.ts) (ne fait PAS partie de « npm test »).
//   node mutations-etape-17/erreurs-volontaires-fonction-recevoir-texto.mjs               (toutes les mutations)
//   ONLY=3,7 node mutations-etape-17/erreurs-volontaires-fonction-recevoir-texto.mjs      (seulement celles-là)
// Chaque mutation abîme UNE règle dans une COPIE (dossier temporaire) de la fonction (variable FONCTION_TEST) ; test-recevoir-texto.mjs doit alors ÉCHOUER (ou planter).
// Le vrai fichier n'est JAMAIS touché (l'outil le vérifie à la fin). [nom, texte exact (UNE fois dans le fichier), texte abîmé]
// Mutations NON essayées parce qu'ÉQUIVALENTES ou hors d'atteinte du test : retirer « !recue || » (une signature absente donne « '' », que la comparaison refuse déjà) ; « let d = ea.length ^ eb.length » → « 0 » (les signatures
// sont du base64 : des longueurs différentes diffèrent déjà par un octet) ; le branchement « Deno.serve » et le message d'erreur de la fonction de la base (ils ne tournent que dans Supabase : essai réel).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const TESTS = fileURLToPath(new URL('../', import.meta.url));
const FICHIER = fileURLToPath(new URL('../../functions/recevoir-texto/index.ts', import.meta.url));
const SOURCE = fs.readFileSync(FICHIER, 'utf8');
const TMP = path.join(os.tmpdir(), 'recevoir-texto-mutation-' + (process.env.ONLY || 'tout').replace(/[^0-9]/g, '_') + '.ts');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;

const M = [
  // — qui peut appeler
  ['une autre méthode que POST est acceptée', `  if (req.method !== 'POST') return refus(405, 'POST seulement.');\n  try {`, `  try {`],
  ['sans jeton de Twilio, la fonction ne refuse plus tout (échoue OUVERT)', `    if (!jeton) { deps.journal('refus jeton_absent'); return refus(403, 'Refusé.'); }`, ``],
  ['la signature n\'est plus vérifiée', `    if (!recue || !egalConstant(recue, attendue)) { deps.journal('refus signature'); return refus(403, 'Refusé.'); }`, ``],
  ['une fausse signature est refusée avec le code 200', `deps.journal('refus signature'); return refus(403, 'Refusé.'); }`, `deps.journal('refus signature'); return refus(200, 'Refusé.'); }`],
  ['le refus pour jeton absent a le code 200', `deps.journal('refus jeton_absent'); return refus(403, 'Refusé.'); }`, `deps.journal('refus jeton_absent'); return refus(200, 'Refusé.'); }`],
  ['l\'adresse signée est celle de l\'adresse publique plus une barre', `const attendue = await signatureTwilio(jeton, deps.url(), params);`, `const attendue = await signatureTwilio(jeton, deps.url() + '/', params);`],
  ['les paramètres ne sont pas signés', `const attendue = await signatureTwilio(jeton, deps.url(), params);`, `const attendue = await signatureTwilio(jeton, deps.url(), []);`],
  ['la comparaison des signatures ne regarde plus les octets', `d |= (ea[i] ?? 0) ^ (eb[i] ?? 0);`, `d |= 0;`],
  ['la comparaison des signatures dit toujours oui', `  return d === 0;`, `  return true;`],
  ['les paramètres ne sont pas triés pour la signature', `const tries = [...params].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));`, `const tries = [...params];`],
  ['le tri des paramètres est à l\'envers', `(a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)`, `(a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0)`],
  ['le tri des paramètres ignore les majuscules', `const tries = [...params].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));`, `const tries = [...params].sort((a, b) => (a[0].toLowerCase() < b[0].toLowerCase() ? -1 : a[0].toLowerCase() > b[0].toLowerCase() ? 1 : 0));`],
  ['les paramètres sont séparés par « & » dans la signature', `url + tries.map(([k, v]) => k + v).join('')`, `url + tries.map(([k, v]) => k + v).join('&')`],
  ['le nom et la valeur sont séparés par « = » dans la signature', `url + tries.map(([k, v]) => k + v).join('')`, `url + tries.map(([k, v]) => k + '=' + v).join('')`],
  ['la signature est calculée en SHA-256', `{ name: 'HMAC', hash: 'SHA-1' }`, `{ name: 'HMAC', hash: 'SHA-256' }`],
  ['un corps trop grand est accepté', `    if (brut.length > TAILLE_MAX) { deps.journal('refus trop_grand'); return refus(400, 'Demande trop grande.'); }`, ``],
  ['la taille permise passe à 2 millions', `const TAILLE_MAX = 20000;`, `const TAILLE_MAX = 2000000;`],
  // — quel genre de message
  ['les accents ne sont plus retirés (« arrêt » n\'est plus reconnu)', `corps.normalize('NFD').replace(/\\p{M}/gu, '').toUpperCase()`, `corps.toUpperCase()`],
  ['les minuscules ne sont plus reconnues', `corps.normalize('NFD').replace(/\\p{M}/gu, '').toUpperCase().replace(`, `corps.normalize('NFD').replace(/\\p{M}/gu, '').replace(`],
  ['la ponctuation et les espaces autour ne sont plus retirés', `.toUpperCase().replace(/^[\\s"'«»]+|[\\s.!?,;:"'«»]+$/gu, '');`, `.toUpperCase();`],
  ['seule la ponctuation de la fin est retirée (pas les guillemets du début)', `/^[\\s"'«»]+|[\\s.!?,;:"'«»]+$/gu`, `/^[\\s]+|[\\s.!?,;:"'«»]+$/gu`],
  ['un mot-clé DANS une phrase désabonne (« ARRET SVP »)', `if (ARRET.has(mot)) return 'arret';`, `if (ARRET.has(mot) || mot.includes('ARRET')) return 'arret';`],
  ['« ARRET » n\'est plus un mot-clé', `new Set(['ARRET', 'ARRETER',`, `new Set(['ARRETER',`],
  ['« ARRETER » n\'est plus un mot-clé', `'ARRETER', `, ``],
  ['« DESABONNER » n\'est plus un mot-clé', `'DESABONNER', `, ``],
  ['« DESABONNEMENT » n\'est plus un mot-clé', `'DESABONNEMENT', `, ``],
  ['« STOP » n\'est plus un mot-clé', `'STOP', 'STOPALL'`, `'STOPALL'`],
  ['« STOPALL » n\'est plus un mot-clé', `'STOPALL', `, ``],
  ['« UNSUBSCRIBE » n\'est plus un mot-clé', `'UNSUBSCRIBE', `, ``],
  ['« CANCEL » n\'est plus un mot-clé', `'CANCEL', `, ``],
  ['« END » n\'est plus un mot-clé', `'END', `, ``],
  ['« QUIT » n\'est plus un mot-clé', `'QUIT']);`, `]);`],
  ['« ANNULER » désabonne (un client peut vouloir annuler une visite)', `'QUIT']);`, `'QUIT', 'ANNULER']);`],
  ['« AIDE » n\'est plus un mot-clé', `new Set(['AIDE', 'HELP', 'INFO'])`, `new Set(['HELP', 'INFO'])`],
  ['« HELP » n\'est plus un mot-clé', `'HELP', 'INFO'`, `'INFO'`],
  ['« INFO » n\'est plus un mot-clé', `'HELP', 'INFO'`, `'HELP'`],
  ['« START » n\'est plus un mot-clé', `new Set(['START', 'UNSTOP', 'YES'])`, `new Set(['UNSTOP', 'YES'])`],
  ['« UNSTOP » n\'est plus un mot-clé', `'UNSTOP', `, ``],
  ['« YES » n\'est plus un mot-clé', `'UNSTOP', 'YES'`, `'UNSTOP'`],
  ['« OUI » devient un mot-clé de réinscription', `'UNSTOP', 'YES'`, `'UNSTOP', 'YES', 'OUI'`],
  ['un message qui n\'est pas du texte est un mot-clé', `if (typeof corps !== 'string') return 'autre';`, ``],
  // — ARRET
  ['le numéro de l\'expéditeur n\'est plus vérifié', `      if (!EST_TELEPHONE.test(de)) { deps.journal('arret -> numero_invalide'); return twiml(MSG_ARRET_ECHEC); }`, ``],
  ['n\'importe quel numéro du monde est accepté', `const EST_TELEPHONE = /^\\+1[2-9][0-9]{2}[2-9][0-9]{6}$/;`, `const EST_TELEPHONE = /^\\+[0-9]{8,15}$/;`],
  ['la base est appelée avec le numéro DESTINATAIRE (le numéro d\'Entretien Lapointe)', `const de = valeur(params, 'From') ?? '';`, `const de = valeur(params, 'To') ?? '';`],
  ['un échec de la base est annoncé comme un succès', `try { ok = (await deps.desabonner(de)).ok === true; } catch { ok = false; }`, `try { ok = (await deps.desabonner(de)), ok = true; } catch { ok = false; }`],
  ['une exception de la base est annoncée comme un succès', `try { ok = (await deps.desabonner(de)).ok === true; } catch { ok = false; }`, `try { ok = (await deps.desabonner(de)).ok === true; } catch { ok = true; }`],
  ['la confirmation est toujours « c\'est noté »', `return twiml(ok ? MSG_ARRET : MSG_ARRET_ECHEC);`, `return twiml(MSG_ARRET);`],
  ['le message d\'échec est toujours donné', `return twiml(ok ? MSG_ARRET : MSG_ARRET_ECHEC);`, `return twiml(MSG_ARRET_ECHEC);`],
  // — AIDE, START, le reste
  ['AIDE répond le message des autres', `if (genre === 'aide') { deps.journal('aide'); return twiml(MSG_AIDE); }`, `if (genre === 'aide') { deps.journal('aide'); return twiml(MSG_AUTRE); }`],
  ['AIDE n\'est plus traité', `    if (genre === 'aide') { deps.journal('aide'); return twiml(MSG_AIDE); }\n`, ``],
  ['START n\'est plus traité', `    if (genre === 'start') { deps.journal('start'); return twiml(MSG_REINSCRIPTION); }\n`, ``],
  ['START répond le message d\'aide', `if (genre === 'start') { deps.journal('start'); return twiml(MSG_REINSCRIPTION); }`, `if (genre === 'start') { deps.journal('start'); return twiml(MSG_AIDE); }`],
  ['les autres messages ne reçoivent aucune réponse', `    deps.journal('autre');\n    return twiml(MSG_AUTRE);`, `    deps.journal('autre');\n    return twiml(null);`],
  // — les textes
  ['le message d\'aide change (promis à Twilio)', `avis de service seulement (jour ou heure de passage, horaire). Aide :`, `avis de service seulement. Aide :`],
  ['le message d\'aide perd le rappel d\'ARRET', `écrivez à info@entretienlapointe.ca. ARRET pour ne plus recevoir ces avis.';\nexport const MSG_ARRET =`, `écrivez à info@entretienlapointe.ca.';\nexport const MSG_ARRET =`],
  ['la confirmation d\'ARRET change', `c\\'est noté, vous ne recevrez plus d\\'avis par texto.`, `c\\'est noté.`],
  ['le message d\'échec change', `nous n\\'avons pas pu enregistrer votre demande.`, `une erreur est survenue.`],
  ['le message de réinscription ne donne plus la page web', `inscrivez-vous sur www.entretienlapointe.ca/avis.html ou appelez`, `appelez`],
  ['le message « autre » dit que les réponses sont lues', `ne lit pas les réponses.`, `lit les réponses.`],
  // — la réponse TwiML
  ['l\'apostrophe n\'est plus protégée', `.replace(/'/g, '&apos;')`, ``],
  ['le « & » n\'est plus protégé', `s.replace(/&/g, '&amp;')`, `s`],
  ['la réponse n\'est plus du XML', `{ 'Content-Type': 'text/xml; charset=utf-8' }`, `{ 'Content-Type': 'text/plain; charset=utf-8' }`],
  ['l\'en-tête XML disparaît', `'<?xml version="1.0" encoding="UTF-8"?><Response>'`, `'<Response>'`],
  ['le message n\'est plus dans une balise « Message »', `'<Message>' + esc(texte) + '</Message>'`, `esc(texte)`],
  ['une exception est présentée comme un succès', `    return refus(500, 'Erreur interne.');`, `    return twiml(null);`],
  // — les journaux
  ['le journal d\'ARRET contient le numéro de téléphone', "deps.journal(`arret -> ${ok ? 'ok' : 'echec'}`);", "deps.journal(`arret -> ${ok ? 'ok' : 'echec'} ${de}`);"],
  ['le journal de START contient le numéro de téléphone', `deps.journal('start');`, "deps.journal('start ' + (valeur(params, 'From') ?? ''));"],
  ['le journal des autres messages contient le texte', `deps.journal('autre');`, "deps.journal('autre ' + (valeur(params, 'Body') ?? ''));"],
  // — le branchement sur Supabase
  ['le jeton est lu d\'un autre secret', `Deno.env.get('TWILIO_AUTH_TOKEN') || null`, `Deno.env.get('TWILIO_TOKEN') || null`],
  ['l\'adresse signée est écrite en dur', `url: () => url.replace(/\\/+$/, '') + CHEMIN,`, `url: () => 'https://xyz.supabase.co' + CHEMIN,`],
  ['le chemin de la fonction change', `const CHEMIN = '/functions/v1/recevoir-texto';`, `const CHEMIN = '/functions/v1/recevoir-texto-2';`],
  ['la base désabonne le courriel au lieu du texto', `p_canal: 'texto', p_contact: telephone, p_source: 'texto_arret'`, `p_canal: 'courriel', p_contact: telephone, p_source: 'texto_arret'`],
  ['la base note une mauvaise source', `p_canal: 'texto', p_contact: telephone, p_source: 'texto_arret'`, `p_canal: 'texto', p_contact: telephone, p_source: 'lien_desabonnement'`],
];

let detectees = 0, essayees = 0; const rapport = [];
try {
  for (const [i, [nom, de, vers]] of M.entries()) {
    if (ONLY && !ONLY.includes(i + 1)) continue;
    essayees++;
    const n = SOURCE.split(de).length - 1;
    if (n !== 1) { rapport.push(`?? ${i + 1}. TEXTE ${n === 0 ? 'INTROUVABLE' : 'EN ' + n + ' EXEMPLAIRES'} : ${nom}`); console.log(rapport[rapport.length - 1]); continue; }
    const mut = SOURCE.replace(de, () => vers);
    if (mut === SOURCE) { rapport.push(`?? ${i + 1}. MUTATION SANS EFFET : ${nom}`); console.log(rapport[rapport.length - 1]); continue; }
    fs.writeFileSync(TMP, mut);
    let sortie = '';
    try { sortie = execFileSync('node', ['test-recevoir-texto.mjs'], { cwd: TESTS, env: { ...process.env, FONCTION_TEST: TMP }, encoding: 'utf8', timeout: 240000, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { sortie = String(e.stdout || '') + String(e.stderr || ''); }
    const m = sortie.match(/RÉSULTAT : (\d+) réussis, (\d+) échoués/);
    const ko = m ? Number(m[2]) : -1;
    const vu = ko !== 0;
    if (vu) detectees++;
    rapport.push(`${vu ? 'OK  détectée' : 'RATÉE      '} ${i + 1}. ${nom}${m ? ' (' + ko + ' échec(s))' : ' (plantage)'}`);
    console.log(rapport[rapport.length - 1]);
  }
} finally {
  fs.rmSync(TMP, { force: true });
}
console.log(`\n${detectees} erreurs volontaires détectées sur ${essayees}`);
console.log(fs.readFileSync(FICHIER, 'utf8') === SOURCE ? 'Le vrai fichier (recevoir-texto) est intact.' : '⚠ LE VRAI FICHIER A CHANGÉ !');
