// Étape 11 — ESSAIS SUR LA VRAIE BASE (Supabase). Ne fait PAS partie de « npm test ».
//
//   node reel-etape-11.mjs                   essais complets (demande le courriel et le mot de passe de Joé)
//   node reel-etape-11.mjs --sans-connexion  seulement ce que voit un visiteur (aucun mot de passe)
//
// SÉCURITÉ
//   • Le mot de passe est tapé au clavier, masqué ; il n'est ni affiché, ni écrit dans un fichier, ni envoyé ailleurs qu'à Supabase.
//   • Le script n'affiche JAMAIS de jeton ni de NIP. Son affichage peut être copié-collé tel quel.
//   • L'adresse du projet et la clé PUBLIQUE viennent de www/js/config.js (elles sont déjà dans l'application).
//   • Il crée deux employés d'essai (« ZZTEST Alpha » et « ZZTEST Beta », téléphones 819 555 0191 et 0192).
//     Alpha est supprimé à la fin. Beta reçoit un quart (donc de l'historique) et reste DÉSACTIVÉ : un nettoyage SQL le retirera.
import fs from 'fs';
import readline from 'readline/promises';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

const config = fs.readFileSync(fileURLToPath(new URL('../../www/js/config.js', import.meta.url)), 'utf8');
const URL_PROJET = config.match(/SUPA_URL\s*=\s*'([^']+)'/)[1];
const CLE_PUBLIQUE = config.match(/SUPA_KEY\s*=\s*'([^']+)'/)[1];
const SANS_CONNEXION = process.argv.includes('--sans-connexion');
const DOMAINE = 'tel.entretienlapointe.ca';

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l, d) => { ok++; log('  ✔ ' + l + (d ? '  [' + d + ']' : '')); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));

// ---------------------------------------------------------------------
async function http(methode, chemin, { jeton, corps, sansAutorisation, entetes } = {}) {
  const h = { apikey: CLE_PUBLIQUE, 'Content-Type': 'application/json', ...entetes };
  if (!sansAutorisation) h.Authorization = 'Bearer ' + (jeton || CLE_PUBLIQUE);
  let r;
  try { r = await fetch(URL_PROJET + chemin, { method: methode, headers: h, body: corps === undefined ? undefined : JSON.stringify(corps) }); }
  catch (e) { return { statut: 0, json: null, reseau: e.message }; }
  let json = null; try { json = await r.json(); } catch { /* corps vide */ }
  return { statut: r.status, json };
}
const edge = (jeton, corps, opts = {}) => http('POST', '/functions/v1/admin-employes', { jeton, corps, ...opts });
const rpc = (jeton, nom, args = {}) => http('POST', '/rest/v1/rpc/' + nom, { jeton, corps: args });
const rest = (jeton, chemin, methode = 'GET', corps) => http(methode, '/rest/v1/' + chemin, { jeton, corps, entetes: methode === 'GET' ? {} : { Prefer: 'return=representation' } });
const refuse = (r) => r.statut >= 400 || (Array.isArray(r.json) && r.json.length === 0);
const detail = (r) => `HTTP ${r.statut}${r.json?.erreur ? ' ' + r.json.erreur : r.json?.code ? ' ' + r.json.code : r.json?.error_code ? ' ' + r.json.error_code : ''}`;

async function connexion(courriel, motDePasse) {
  const r = await http('POST', '/auth/v1/token?grant_type=password', { corps: { email: courriel, password: motDePasse } });
  return r.statut === 200 && r.json?.access_token ? { jeton: r.json.access_token, statut: 200 } : { jeton: null, statut: r.statut, code: r.json?.error_code ?? r.json?.msg ?? '?' };
}
const emailTel = (tel) => `${tel}@${DOMAINE}`;

async function lireSecret(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    if (!stdin.isTTY) { console.log('\n(Ce script doit être lancé dans un terminal.)'); process.exit(2); }
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    let s = '';
    const surDonnees = (c) => {
      for (const ch of c) {
        if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', surDonnees); process.stdout.write('\n'); return resolve(s); }
        if (ch === String.fromCharCode(3)) process.exit(130);   // Ctrl+C
        if (ch === String.fromCharCode(127) || ch === String.fromCharCode(8)) s = s.slice(0, -1); else s += ch;   // retour arrière
      }
    };
    stdin.on('data', surDonnees);
  });
}

// =====================================================================
log(`Projet : ${URL_PROJET}`);
log('\n=== A. CE QUE VOIT UN VISITEUR (clé publique, aucune connexion) ===');
{
  const tentative = { action: 'creer', nom: 'ZZTEST Pirate', telephone: '8195550199' };
  let r = await edge(null, tentative);
  eq('la fonction admin-employes refuse la clé publique (403 non_autorise)', [r.statut, r.json?.erreur], [403, 'non_autorise']);
  r = await edge(null, tentative, { sansAutorisation: true });
  vrai('sans aucun jeton : refusé', r.statut === 401 || r.statut === 403, detail(r));
  r = await edge('jeton.invalide.du-tout', tentative);
  vrai('avec un faux jeton : refusé', r.statut === 401 || r.statut === 403, detail(r));
  r = await http('GET', '/functions/v1/admin-employes', {});
  vrai('GET refusé', r.statut >= 400, detail(r));
  for (const f of ['_utilisateur_a_de_l_historique', 'creer_profil_depuis_auth', 'est_admin', 'admin_lister_utilisateurs', 'fermer_expires', 'quart_commencer']) {
    r = await rpc(null, f, f === '_utilisateur_a_de_l_historique' ? { p_id: randomUUID() } : {});
    vrai(`fonction « ${f} » : refusée au visiteur`, r.statut >= 400 && r.statut !== 200, detail(r));
  }
  for (const t of ['utilisateurs', 'stops', 'routes', 'equipes', 'passes', 'passe_arrets', 'problemes', 'positions', 'quarts', 'equipage_periodes', 'equipage_journal', 'journal_modifications', 'reglages']) {
    r = await rest(null, `${t}?select=*`);
    vrai(`table « ${t} » : rien de lisible pour un visiteur`, refuse(r), detail(r));
  }
  r = await rest(null, 'utilisateurs', 'POST', { id: randomUUID(), nom: 'Pirate', role: 'admin' });
  vrai('un visiteur ne peut pas créer un profil administrateur', refuse(r), detail(r));
}

if (SANS_CONNEXION) {
  console.log(`\n===== RÉSULTAT (sans connexion) : ${ok} réussis, ${ko} échoués =====`);
  process.exit(ko ? 1 : 0);
}

// =====================================================================
log('\n=== B. CONNEXION DE L\'ADMINISTRATEUR ===');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const courrielAdmin = (await rl.question('Courriel du compte administrateur : ')).trim();
rl.close();
const motDePasseAdmin = await lireSecret('Mot de passe (masqué, ne s\'affiche pas) : ');
const co = await connexion(courrielAdmin, motDePasseAdmin);
if (!co.jeton) { fail('connexion de l\'administrateur', `HTTP ${co.statut} ${co.code}`); console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`); process.exit(1); }
pass('connexion réussie (Supabase Auth, mot de passe)');
const A = co.jeton;

let r = await rpc(A, 'est_admin');
eq('est_admin() est vrai pour ce compte', [r.statut, r.json], [200, true]);
r = await rpc(A, 'admin_lister_utilisateurs');
vrai('admin_lister_utilisateurs fonctionne', r.statut === 200 && Array.isArray(r.json), detail(r));
const admins = (r.json ?? []).filter((u) => u.role === 'admin');
eq('un seul administrateur, actif', admins.map((u) => [u.nom, u.actif]), [['Joé', true]]);
const dejaTest = (r.json ?? []).filter((u) => (u.nom ?? '').startsWith('ZZTEST'));
if (dejaTest.length) { fail('restes d\'un essai précédent (comptes ZZTEST)', dejaTest.map((u) => u.nom).join(', ') + ' : nettoyer avant de recommencer'); process.exit(1); }
r = await rest(A, 'stops?select=id');
eq('l\'administrateur voit les 13 arrêts de test', r.json?.length, 13);
r = await rest(A, 'utilisateurs?select=*');
vrai('même l\'administrateur ne peut pas faire « select * » sur utilisateurs (règle de l\'étape 8 : noms de colonnes exigés)', refuse(r), detail(r));

// ---------------------------------------------------------------------
log('\n=== C. CRÉER UN EMPLOYÉ (vrai Supabase Auth) ===');
const TEL_A = '8195550191', TEL_B = '8195550192';
r = await edge(A, { action: 'creer', nom: 'ZZTEST Alpha', telephone: '819 555-0191' });
const nipA0 = r.json?.nip;
vrai('création d\'Alpha (numéro écrit « 819 555-0191 », NIP tiré au hasard)', r.statut === 200 && r.json?.ok && /^[0-9]{6}$/.test(nipA0 ?? '') && r.json.nip_genere === true, detail(r));
const idA = r.json?.employe?.id;
if (!idA || !nipA0) {
  log('\n>>> ARRÊT : la création d\'Alpha a échoué, les essais suivants n\'auraient aucun sens. Colle-moi tout l\'affichage.');
  log('    (Vérifie aussi Supabase > Authentication > Users : il ne doit rester que ton compte.)');
  console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués (arrêt anticipé) =====`);
  process.exit(1);
}
eq('… le numéro est normalisé, le compte actif', [r.json?.employe?.telephone, r.json?.employe?.actif], [TEL_A, true]);
r = await edge(A, { action: 'creer', nom: 'ZZTEST Alpha bis', telephone: TEL_A });
eq('même numéro : refusé (409)', [r.statut, r.json?.erreur], [409, 'telephone_deja_utilise']);
r = await edge(A, { action: 'creer', nom: 'ZZTEST Faible', telephone: '8195550193', nip: '123456' });
eq('NIP évident (123456) : refusé (400)', [r.statut, r.json?.erreur], [400, 'nip_trop_facile']);
r = await edge(A, { action: 'creer', nom: 'ZZTEST Roi', telephone: '8195550194', role: 'admin' });
const idRoi = r.json?.employe?.id;
vrai('« role: admin » envoyé par l\'appelant : le compte créé est quand même un employé', r.statut === 200, detail(r));
r = await rpc(A, 'admin_lister_utilisateurs');
eq('… vérifié dans la liste réelle', (r.json ?? []).filter((u) => u.nom === 'ZZTEST Roi').map((u) => u.role), ['employe']);
r = await edge(A, { action: 'supprimer', id: idRoi });
eq('… et il est supprimé tout de suite (aucun historique)', [r.statut, r.json?.resultat], [200, 'supprime']);
r = await rpc(A, 'admin_lister_utilisateurs');
const alpha = (r.json ?? []).find((u) => u.id === idA);
eq('Alpha apparaît dans la liste, avec son téléphone (visible seulement par l\'administrateur)', [alpha?.nom, alpha?.telephone, alpha?.actif, alpha?.role], ['ZZTEST Alpha', TEL_A, true, 'employe']);

// ---------------------------------------------------------------------
log('\n=== D. CE QUE PEUT FAIRE L\'EMPLOYÉ ===');
let ca = await connexion(emailTel(TEL_A), nipA0);
vrai('Alpha se connecte avec son numéro + son NIP (identifiant numéro@' + DOMAINE + ')', !!ca.jeton, `HTTP ${ca.statut} ${ca.code ?? ''}`);
const E = ca.jeton;
r = await rpc(E, 'est_admin');
eq('est_admin() est faux pour Alpha', r.json, false);
r = await rpc(E, 'est_actif');
eq('est_actif() est vrai pour Alpha', r.json, true);
r = await edge(E, { action: 'creer', nom: 'ZZTEST Pirate', telephone: '8195550199' });
eq('Alpha ne peut PAS utiliser la fonction admin-employes (403)', [r.statut, r.json?.erreur], [403, 'non_autorise']);
r = await edge(E, { action: 'supprimer', id: admins[0]?.id });
eq('Alpha ne peut pas supprimer l\'administrateur (403)', r.statut, 403);
r = await rpc(E, 'admin_lister_utilisateurs');
vrai('Alpha ne peut pas lister les utilisateurs / téléphones', r.statut >= 400, detail(r));
r = await rest(E, 'utilisateurs?select=id,nom,role,actif,cree_le');
vrai('Alpha voit les noms de ses collègues', r.statut === 200 && r.json.length >= 2, detail(r));
vrai('… sans aucun téléphone dans la réponse', !JSON.stringify(r.json).match(/8195550\d{3}/), '');
r = await rest(E, 'utilisateurs?select=telephone');
vrai('Alpha ne peut pas demander la colonne « telephone »', refuse(r), detail(r));
r = await rest(E, 'utilisateurs?select=*');
vrai('Alpha ne peut pas faire « select * » sur utilisateurs', refuse(r), detail(r));
r = await rest(E, `utilisateurs?id=eq.${idA}`, 'PATCH', { role: 'admin' });
vrai('Alpha ne peut pas se donner le rôle admin (PATCH refusé)', refuse(r), detail(r));
r = await rest(E, `utilisateurs?id=eq.${idA}`, 'PATCH', { actif: false });
vrai('Alpha ne peut pas se désactiver / modifier son propre état', refuse(r), detail(r));
r = await rpc(A, 'admin_lister_utilisateurs');
eq('… et son rôle est toujours « employe », actif', (r.json ?? []).filter((u) => u.id === idA).map((u) => [u.role, u.actif]), [['employe', true]]);
r = await rest(E, 'stops?select=id');
eq('Alpha voit les 13 arrêts', r.json?.length, 13);
r = await rest(E, 'quarts', 'POST', { id: randomUUID(), utilisateur_id: idA, debut: new Date().toISOString() });
vrai('Alpha ne peut pas écrire directement dans les quarts (seulement par les fonctions)', refuse(r), detail(r));
r = await rest(E, 'passes', 'POST', { id: randomUUID() });
vrai('… ni dans les passes', refuse(r), detail(r));

// ---------------------------------------------------------------------
log('\n=== E. DÉSACTIVER / RÉACTIVER / CHANGER LE NIP (vrai blocage de connexion) ===');
r = await edge(A, { action: 'desactiver', id: idA });
eq('désactivation d\'Alpha', [r.statut, r.json?.employe?.actif], [200, false]);
ca = await connexion(emailTel(TEL_A), nipA0);
vrai('Alpha désactivé ne peut plus SE CONNECTER (blocage réel de Supabase Auth)', !ca.jeton, `HTTP ${ca.statut} ${ca.code ?? ''}`);
r = await rpc(E, 'est_actif');
eq('son ancien jeton (encore valide) : est_actif() = faux', r.json, false);
r = await rest(E, 'stops?select=id');
eq('… et il ne voit plus AUCUN arrêt', r.json, []);
r = await rpc(E, 'quart_commencer', { p_id: randomUUID() });
vrai('… et ne peut plus faire « Je commence »', r.statut >= 400, detail(r));
r = await edge(A, { action: 'reactiver', id: idA });
eq('réactivation d\'Alpha', [r.statut, r.json?.employe?.actif], [200, true]);
ca = await connexion(emailTel(TEL_A), nipA0);
vrai('Alpha se reconnecte avec le MÊME NIP (déblocage réel)', !!ca.jeton, `HTTP ${ca.statut} ${ca.code ?? ''}`);
r = await edge(A, { action: 'reinitialiser_nip', id: idA, nip: '111111' });
eq('NIP évident refusé lors d\'une réinitialisation', [r.statut, r.json?.erreur], [400, 'nip_trop_facile']);
r = await edge(A, { action: 'reinitialiser_nip', id: idA, nip: '739104' });
eq('réinitialisation du NIP', [r.statut, r.json?.nip], [200, '739104']);
ca = await connexion(emailTel(TEL_A), nipA0);
vrai('l\'ancien NIP ne fonctionne plus', !ca.jeton, `HTTP ${ca.statut} ${ca.code ?? ''}`);
ca = await connexion(emailTel(TEL_A), '739104');
vrai('le nouveau NIP fonctionne', !!ca.jeton, `HTTP ${ca.statut} ${ca.code ?? ''}`);
r = await edge(A, { action: 'reinitialiser_nip', id: admins[0]?.id });
eq('impossible de réinitialiser le mot de passe de l\'administrateur par cette fonction', [r.statut, r.json?.erreur], [403, 'compte_administrateur']);
r = await edge(A, { action: 'desactiver', id: admins[0]?.id });
eq('impossible de se désactiver soi-même par cette fonction', [r.statut, r.json?.erreur], [403, 'compte_administrateur']);
r = await rpc(A, 'est_admin');
eq('l\'administrateur est toujours administrateur après ces essais', r.json, true);

// ---------------------------------------------------------------------
log('\n=== F. SUPPRIMER : sans historique = supprimé ; avec historique = désactivé ===');
r = await edge(A, { action: 'creer', nom: 'ZZTEST Beta', telephone: TEL_B, nip: '482915' });
const idB = r.json?.employe?.id;
vrai('création de Beta (NIP choisi)', r.statut === 200 && r.json?.nip_genere === false, detail(r));
if (!idB) { console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués (arrêt anticipé) =====`); process.exit(1); }
const cb = await connexion(emailTel(TEL_B), '482915');
vrai('Beta se connecte', !!cb.jeton, `HTTP ${cb.statut} ${cb.code ?? ''}`);
const idQuart = randomUUID();
r = await rpc(cb.jeton, 'quart_commencer', { p_id: idQuart });
vrai('Beta fait « Je commence » (vraie fonction, vraie base)', r.statut === 200, detail(r));
r = await rpc(cb.jeton, 'quart_terminer', { p_quart_id: idQuart });
vrai('Beta fait « Je termine »', r.statut === 200, detail(r));
r = await edge(A, { action: 'supprimer', id: idB });
eq('« supprimer » Beta, qui a un quart : désactivé, PAS supprimé', [r.statut, r.json?.resultat, r.json?.raison], [200, 'desactive', 'historique']);
const cb2 = await connexion(emailTel(TEL_B), '482915');
vrai('… et Beta ne peut plus se connecter', !cb2.jeton, `HTTP ${cb2.statut} ${cb2.code ?? ''}`);
r = await rpc(A, 'admin_lister_utilisateurs');
eq('… son profil existe toujours, inactif', (r.json ?? []).filter((u) => u.id === idB).map((u) => u.actif), [false]);

r = await edge(A, { action: 'supprimer', id: idA });
eq('« supprimer » Alpha, sans historique : supprimé pour vrai', [r.statut, r.json?.resultat], [200, 'supprime']);
ca = await connexion(emailTel(TEL_A), '739104');
vrai('… et son compte n\'existe plus (connexion impossible)', !ca.jeton, `HTTP ${ca.statut} ${ca.code ?? ''}`);
r = await rpc(A, 'admin_lister_utilisateurs');
eq('… il a disparu de la liste', (r.json ?? []).filter((u) => u.id === idA).length, 0);
r = await edge(A, { action: 'creer', nom: 'ZZTEST Alpha revenu', telephone: TEL_A, nip: '739104' });
vrai('son numéro peut être réutilisé', r.statut === 200, detail(r));
const idA2 = r.json?.employe?.id;
r = await edge(A, { action: 'supprimer', id: idA2 });
eq('… (et ce compte de plus est supprimé)', [r.statut, r.json?.resultat], [200, 'supprime']);

// ---------------------------------------------------------------------
console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
log('Reste à nettoyer : le compte « ZZTEST Beta » (désactivé, avec un quart d\'essai). Un SQL de nettoyage sera fourni.');
process.exit(ko ? 1 : 0);
