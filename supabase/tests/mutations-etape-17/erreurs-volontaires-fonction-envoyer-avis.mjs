// Demande 5, chantier C — outil des ERREURS VOLONTAIRES de la fonction « envoyer-avis » (supabase/functions/envoyer-avis/index.ts) (ne fait PAS partie de « npm test »).
//   node mutations-etape-17/erreurs-volontaires-fonction-envoyer-avis.mjs               (toutes les mutations)
//   ONLY=3,7 node mutations-etape-17/erreurs-volontaires-fonction-envoyer-avis.mjs      (seulement celles-là)
// Chaque mutation abîme UNE règle dans une COPIE (dossier temporaire) de la fonction (variable FONCTION_TEST) ; test-envoyer-avis.mjs doit alors ÉCHOUER (ou planter).
// Le vrai fichier n'est JAMAIS touché (l'outil le vérifie à la fin). [nom, texte exact (UNE fois dans le fichier), texte abîmé]
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const TESTS = fileURLToPath(new URL('../', import.meta.url));
const FICHIER = fileURLToPath(new URL('../../functions/envoyer-avis/index.ts', import.meta.url));
const SOURCE = fs.readFileSync(FICHIER, 'utf8');
const TMP = path.join(os.tmpdir(), 'envoyer-avis-mutation-' + (process.env.ONLY || 'tout').replace(/[^0-9]/g, '_') + '.ts');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;
const CATCH = `.catch(() => ({ error: { message: 'exception' } } as any))`;

const M = [
  // — qui peut appeler
  ['n\'importe qui est administrateur', `const admin = /^Bearer\\s+\\S+$/i.test(autorisation) ? await deps.identifier(autorisation) : null;`, `const admin = { id: 'x', courriel: null };`],
  ['le refus d\'un non-administrateur est retiré', `    if (!admin) {`, `    if (false) {`],
  ['un jeton mal formé est accepté', `/^Bearer\\s+\\S+$/i.test(autorisation) ? await deps.identifier(autorisation) : null`, `await deps.identifier(autorisation)`],
  ['une autre méthode que POST est acceptée', `  if (req.method !== 'POST') return repondre(refus(405, 'methode_refusee', 'POST seulement.'));`, ``],
  ['la pré-vérification CORS est retirée', `  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });`, ``],
  ['un corps qui n\'est pas un objet est accepté', `if (!corps || typeof corps !== 'object' || Array.isArray(corps)) return repondre(`, `if (!corps) return repondre(`],
  ['une action inconnue est acceptée', `} else r = refus(400, 'action_inconnue', 'Action inconnue.');`, `} else r = ok({});`],
  // — la validation
  ['un délai de 73 heures est accepté', `(d === 'demain' || Number(d.slice(0, -1)) <= 72)`, `(d === 'demain' || Number(d.slice(0, -1)) <= 99)`],
  ['le délai n\'est plus vérifié par la fonction', `typeof d === 'string' && EST_DELAI.test(d) && (d === 'demain' || Number(d.slice(0, -1)) <= 72)`, `typeof d === 'string'`],
  ['le délai « 0h » est accepté', `const EST_DELAI = /^(demain|[1-9][0-9]?h)$/;`, `const EST_DELAI = /^(demain|[0-9][0-9]?h)$/;`],
  ['plus de 300 clients sont acceptés', `if (!Array.isArray(v) || v.length < 1 || v.length > 300) return refus(`, `if (!Array.isArray(v) || v.length < 1 || v.length > 3000) return refus(`],
  ['une liste vide est acceptée', `if (!Array.isArray(v) || v.length < 1 || v.length > 300) return refus(`, `if (!Array.isArray(v) || v.length > 300) return refus(`],
  ['un identifiant de client invalide est accepté', `!EST_UUID.test(o.client_id)`, `false`],
  ['un service vide est accepté', `o.service.trim().length < 1 || o.service.length > 100`, `o.service.length > 100`],
  ['un service de 1000 caractères est accepté', `o.service.trim().length < 1 || o.service.length > 100`, `o.service.trim().length < 1 || o.service.length > 1000`],
  ['une adresse vide est acceptée', `o.adresse.trim().length < 1 || o.adresse.length > 200`, `o.adresse.length > 200`],
  ['une adresse de 1000 caractères est acceptée', `o.adresse.trim().length < 1 || o.adresse.length > 200`, `o.adresse.trim().length < 1 || o.adresse.length > 1000`],
  ['l\'identifiant du client n\'est plus mis en minuscules', `client_id: o.client_id.toLowerCase()`, `client_id: o.client_id`],
  ['des canaux invalides sont acceptés', `v.some((c) => typeof c !== 'string' || !CANAUX.includes(c))`, `false`],
  ['une liste de canaux vide est acceptée', `else if (!Array.isArray(v) || v.length < 1 || v.some(`, `else if (!Array.isArray(v) || v.some(`],
  ['les canaux ne sont plus dans l\'ordre courriel puis texto', `canaux = CANAUX.filter((c) => (v as string[]).includes(c));`, `canaux = v as string[];`],
  ['sans canaux précisés : toujours les deux (même textos non activés)', `canaux = deps.textosActifs() ? ['courriel', 'texto'] : ['courriel'];`, `canaux = ['courriel', 'texto'];`],
  ['sans canaux précisés : jamais le texto', `canaux = deps.textosActifs() ? ['courriel', 'texto'] : ['courriel'];`, `canaux = ['courriel'];`],
  ['le texto part même si les textos ne sont pas activés', `  if (canaux.includes('texto') && !deps.textosActifs()) {`, `  if (false) {`],
  // — l'aperçu et l'envoi
  ['l\'aperçu ÉCRIT au journal (il appelle avis_preparer)', `const r = await deps.rpc('avis_apercu', argsBase(`, `const r = await deps.rpc('avis_preparer', argsBase(`],
  ['l\'envoi n\'écrit rien au journal (il appelle avis_apercu)', `const r = await deps.rpc('avis_preparer', argsBase(`, `const r = await deps.rpc('avis_apercu', argsBase(`],
  ['les canaux demandés ne sont pas transmis à la base', `p_lignes: lignes, p_canaux: canaux };`, `p_lignes: lignes };`],
  ['l\'administrateur n\'est pas transmis à la base', `{ p_par: admin.id, p_delai: delai,`, `{ p_par: '00000000-0000-4000-8000-000000000000', p_delai: delai,`],
  ['le délai n\'est pas transmis à la base', `p_delai: delai, p_lignes: lignes`, `p_delai: '2h', p_lignes: lignes`],
  ['l\'heure de la demande n\'est plus transmise (essais)', `  if (quand) a.p_maintenant = quand;`, ``],
  ['les lignes refusées sont quand même envoyées', `.filter((x) => x.l.statut === 'en_attente');`, `;`],
  ['tous les envois partent en même temps (plus de limite de 5)', `for (let debut = 0; debut < aEnvoyer.length; debut += 5) {\n    await Promise.all(aEnvoyer.slice(debut, debut + 5).map(`, `for (let debut = 0; debut < aEnvoyer.length; debut += 500) {\n    await Promise.all(aEnvoyer.slice(debut, debut + 500).map(`],
  ['les envois partent un par un', `for (let debut = 0; debut < aEnvoyer.length; debut += 5) {\n    await Promise.all(aEnvoyer.slice(debut, debut + 5).map(`, `for (let debut = 0; debut < aEnvoyer.length; debut += 1) {\n    await Promise.all(aEnvoyer.slice(debut, debut + 1).map(`],
  // — les messages
  ['le courriel part sans jeton de désabonnement quand la base le refuse', `if (j.error || typeof j.data !== 'string' || !j.data) resultat = { erreur: 'jeton_indisponible' };`, `if (false) resultat = { erreur: 'jeton_indisponible' };`],
  ['le texte du courriel garde le repère au lieu du lien', `texte: texteCourriel(l.message, lien),`, `texte: l.message,`],
  ['le HTML du courriel garde le repère au lieu du lien', `html: htmlCourriel(l.message, lien), lien });`, `html: l.message, lien });`],
  ['le courriel part à une autre adresse que celle de la fiche', `resultat = await deps.courriel({ a: l.destinataire,`, `resultat = await deps.courriel({ a: 'autre@exemple.ca',`],
  ['le texto n\'est pas le message du journal', `resultat = await deps.texto({ a: l.destinataire, corps: l.message });`, `resultat = await deps.texto({ a: l.destinataire, corps: String(l.objet) });`],
  ['le texto part à une autre adresse', `resultat = await deps.texto({ a: l.destinataire, corps: l.message });`, `resultat = await deps.texto({ a: '+18195550000', corps: l.message });`],
  ['tous les repères du lien ne sont plus remplacés', `return message.split(MARQUE_LIEN).join(lien);`, `return message.replace(MARQUE_LIEN, lien);`],
  ['le lien de désabonnement n\'est plus encodé', `?c=\${encodeURIComponent(clientId)}&t=\${encodeURIComponent(jeton)}`, `?c=\${clientId}&t=\${jeton}`],
  ['le lien ne pointe plus vers la page de désabonnement', `/desabonnement.html?c=`, `/ailleurs.html?c=`],
  ['le HTML n\'échappe plus « & »', `s.replace(/&/g, '&amp;')`, `s`],
  ['le HTML n\'échappe plus « < »', `.replace(/</g, '&lt;')`, ``],
  ['le HTML n\'échappe plus les guillemets', `.replace(/"/g, '&quot;')`, ``],
  ['le HTML perd les sauts de ligne', `.replace(/\\r?\\n/g, '<br>\\n')`, ``],
  ['le HTML n\'a plus de lien cliquable', `<a href="\${esc(lien)}">Se désabonner</a>`, `Se désabonner`],
  ['le site est faux', `export const SITE = 'https://www.entretienlapointe.ca';`, `export const SITE = 'https://exemple.ca';`],
  ['l\'expéditeur est faux', `export const EXPEDITEUR = 'Entretien Lapointe <avis@entretienlapointe.ca>';`, `export const EXPEDITEUR = 'Entretien Lapointe <avis@exemple.ca>';`],
  ['l\'adresse de réponse est fausse', `export const REPONDRE_A = 'info@entretienlapointe.ca';`, `export const REPONDRE_A = 'info@exemple.ca';`],
  ['le repère du lien est faux (la base n\'y trouve plus rien)', `export const MARQUE_LIEN = '[lien de désabonnement]';`, `export const MARQUE_LIEN = '[lien]';`],
  // — les résultats et leur note
  ['un échec est noté comme un envoi réussi', `return { statut: envoye ? 'envoye' : 'echec', marquage: !marque.error };`, `return { statut: 'envoye', marquage: !marque.error };`],
  ['un envoi réussi est noté comme un échec', `return { statut: envoye ? 'envoye' : 'echec', marquage: !marque.error };`, `return { statut: envoye ? 'echec' : 'echec', marquage: !marque.error };`],
  ['la note de la base n\'est pas réessayée', `  if (marque.error) marque = await deps.rpc('avis_marquer', args)${CATCH};\n`, ``],
  ['la note manquante n\'est plus signalée', `if (marquagesRates) corps.avertissement =`, `if (false) corps.avertissement =`],
  ['la note manquante n\'est plus comptée', `      if (!f.marquage) marquagesRates++;`, ``],
  ['une exception pendant l\'envoi arrête tout', `resultat = { erreur: 'exception ' + (e instanceof Error ? e.name : 'inconnue') };`, `throw e;`],
  ['la raison d\'un échec n\'est pas notée', `p_erreur: String((resultat as { erreur: string }).erreur).slice(0, 400)`, `p_erreur: ''`],
  ['l\'identifiant du fournisseur n\'est pas noté', `p_fournisseur_id: resultat.id`, `p_fournisseur_id: 'x'`],
  ['la ligne en échec ne porte plus son motif', `      if (f.statut === 'echec') finales[i].motif = 'echec_fournisseur';\n`, ``],
  ['le résumé compte les échecs comme des envois', `envoyes: n((x) => x.statut === 'envoye'),`, `envoyes: n((x) => x.statut === 'envoye' || x.statut === 'echec'),`],
  ['le résumé ne compte plus les refus', `refuses: n((x) => x.statut === 'refuse'),`, `refuses: 0,`],
  ['la réponse de l\'envoi donne le message de chaque client', `const finales: any[] = lignes.map((l) => ({ id: l.id, client_id: l.client_id, canal: l.canal, statut: l.statut, motif: l.motif ?? null }));`, `const finales: any[] = lignes.map((l) => ({ id: l.id, client_id: l.client_id, canal: l.canal, statut: l.statut, motif: l.motif ?? null, message: l.message }));`],
  // — les refus de la base
  ['« non autorisé » de la base n\'est plus expliqué', `  if (/non_autorise/.test(m)) return NON_AUTORISE;\n`, ``],
  ['un délai refusé par la base n\'est plus expliqué', `  if (/delai_invalide/.test(m)) return refus(400, 'delai_invalide', 'Le délai est invalide (« 1h » à « 72h » ou « demain »).');\n`, ``],
  ['une liste refusée par la base n\'est plus expliquée', `  if (/lignes_invalides/.test(m)) return refus(400, 'requete_invalide', 'La liste des clients est invalide.');\n`, ``],
  ['des canaux refusés par la base ne sont plus expliqués', `  if (/canaux_invalides/.test(m)) return refus(400, 'canaux_invalides', 'Les canaux demandés sont invalides.');\n`, ``],
  ['l\'absence de modèle n\'est plus expliquée', `  if (/modele_introuvable/.test(m)) return refus(500, 'modele_introuvable', 'Aucun modèle de message n\\'est en vigueur (voir la table avis_modeles).');\n`, ``],
  ['les fichiers SQL manquants ne sont plus expliqués', `  if (/Could not find the function|PGRST202|42883/.test(m)) return refus(500, 'sql_absent', 'Les fichiers SQL 31 et 32 ne sont pas tous exécutés chez Supabase.');\n`, ``],
  // — le courriel d'essai
  ['l\'essai part même sans courriel d\'administrateur', `if (!admin.courriel) return refus(400, 'courriel_absent'`, `if (false) return refus(400, 'courriel_absent'`],
  ['l\'essai part à une autre adresse que celle de l\'administrateur', `const r = await deps.courriel({ a: admin.courriel, objet: '[ESSAI] '`, `const r = await deps.courriel({ a: 'client@exemple.ca', objet: '[ESSAI] '`],
  ['l\'essai n\'est plus marqué [ESSAI]', `objet: '[ESSAI] ' + rendre(m.objet)`, `objet: rendre(m.objet)`],
  ['l\'essai laisse le service sans valeur', `.split('{service}').join('Coupe de gazon')`, ``],
  ['l\'essai laisse l\'adresse sans valeur', `.split('{adresse}').join('10 rue des Pins, Louiseville')`, ``],
  ['l\'essai s\'envoie sans modèle', `if (!m) return refus(500, 'modele_introuvable', 'Aucun modèle de courriel`, `if (false) return refus(500, 'modele_introuvable', 'Aucun modèle de courriel`],
  ['l\'échec de l\'essai n\'est plus signalé', `if ('erreur' in r) return refus(502, 'envoi_echoue'`, `if (false) return refus(502, 'envoi_echoue'`],
  ['l\'essai écrit l\'adresse de l\'administrateur dans les journaux', `deps.journal('essai_courriel -> ok');`, `deps.journal('essai_courriel -> ok ' + admin.courriel);`],
  // — le code lui-même
  ['une clé Resend est écrite dans le code', `export const REPONDRE_A = 'info@entretienlapointe.ca';`, `export const REPONDRE_A = 'info@entretienlapointe.ca';\nconst CLE = 're_abcdefghijklmnopqrstuvwxyz1234';`],
  ['la fonction écrit directement dans une table', `const esc = (s: string) =>`, `const ECRIRE = (b: any) => b.from('avis_envois').insert({});
const esc = (s: string) =>`],
  ['la fonction fabrique un message elle-même', `const sansPrefixe = (m: string) => m.replace(/^❌\\s*/, '');`, `const sansPrefixe = (m: string) => m.replace(/^❌\\s*/, '');\nconst ENDUR = 'nous passons chez vous demain';`],
  ['les textos ne demandent plus « oui » ni les secrets', `Deno.env.get('TEXTOS_ACTIFS') === 'oui' && !!sid() && !!jeton() && !!de()`, `true`],
  ['Resend ne reçoit plus l\'adresse de réponse', `reply_to: REPONDRE_A, `, ``],
  ['Resend ne reçoit plus l\'entête de désabonnement', `, headers: { 'List-Unsubscribe': \`<\${m.lien}>\` } }),`, ` }),`],
  ['Twilio reçoit un autre corps de message', `To: m.a, From: de(), Body: m.corps`, `To: m.a, From: de(), Body: 'x'`],
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
    try { sortie = execFileSync('node', ['test-envoyer-avis.mjs'], { cwd: TESTS, env: { ...process.env, FONCTION_TEST: TMP }, encoding: 'utf8', timeout: 240000, stdio: ['ignore', 'pipe', 'pipe'] }); }
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
console.log(fs.readFileSync(FICHIER, 'utf8') === SOURCE ? 'Le vrai fichier (envoyer-avis) est intact.' : '⚠ LE VRAI FICHIER A CHANGÉ !');
