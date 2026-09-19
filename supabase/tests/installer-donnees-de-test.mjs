// Installe les DONNÉES DE TEST durables : 2 véhicules « Véhicule test 1 / 2 » et 4 comptes d'employés (Luc, Lionel, Ghislain, Marc).
// À exécuter par Joé, dans son terminal :   node installer-donnees-de-test.mjs
//
// SÉCURITÉ
//   • Le mot de passe de l'administrateur est tapé masqué ; il n'est ni affiché ni enregistré.
//   • Les NIP des employés sont tirés au hasard par le serveur et AFFICHÉS UNE SEULE FOIS dans ce terminal (Joé les remet
//     aux employés). Ils ne sont écrits dans aucun fichier. Ne PAS copier cet affichage dans une conversation.
//   • Les numéros de téléphone sont tapés par Joé : rien de personnel n'est écrit dans ce fichier ni dans le dépôt.
//   • Ces comptes ne sont PAS des comptes « ZZTEST » : le nettoyage 10-nettoyage-comptes-zztest.sql n'y touche jamais.
import fs from 'fs';
import readline from 'readline/promises';
import { fileURLToPath } from 'url';

const config = fs.readFileSync(fileURLToPath(new URL('../../www/js/config.js', import.meta.url)), 'utf8');
const URL_PROJET = config.match(/SUPA_URL\s*=\s*'([^']+)'/)[1];
const CLE_PUBLIQUE = config.match(/SUPA_KEY\s*=\s*'([^']+)'/)[1];
const DOMAINE = 'tel.entretienlapointe.ca';
const VEHICULES = ['Véhicule test 1', 'Véhicule test 2'];
const EMPLOYES = ['Luc', 'Lionel', 'Ghislain', 'Marc'];

let ok = 0, ko = 0;
const pass = (l) => { ok++; console.log('  ✔ ' + l); };
const fail = (l, d) => { ko++; console.log('  ✘ ' + l + (d ? '  -> ' + d : '')); };

async function http(methode, chemin, { jeton, corps, entetes } = {}) {
  const h = { apikey: CLE_PUBLIQUE, 'Content-Type': 'application/json', Authorization: 'Bearer ' + (jeton || CLE_PUBLIQUE), ...entetes };
  let r;
  try { r = await fetch(URL_PROJET + chemin, { method: methode, headers: h, body: corps === undefined ? undefined : JSON.stringify(corps) }); }
  catch { return { statut: 0, json: null }; }
  let json = null; try { json = await r.json(); } catch { /* vide */ }
  return { statut: r.status, json };
}
const rest = (jeton, chemin, methode = 'GET', corps) => http(methode, '/rest/v1/' + chemin, { jeton, corps, entetes: methode === 'GET' ? {} : { Prefer: 'return=representation' } });
const edge = (jeton, corps) => http('POST', '/functions/v1/admin-employes', { jeton, corps });
async function connexion(courriel, motDePasse) {
  const r = await http('POST', '/auth/v1/token?grant_type=password', { corps: { email: courriel, password: motDePasse } });
  return r.statut === 200 && r.json?.access_token ? r.json.access_token : null;
}
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
const chiffres = (t) => t.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');

console.log(`Projet : ${URL_PROJET}\n`);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const courriel = (await rl.question('Courriel du compte administrateur : ')).trim();

// Les 4 employés : nom complet (facultatif) et numéro de téléphone, tapés par Joé
console.log('\nPour chaque employé : tape son nom complet (ou Entrée pour garder le prénom) et son numéro de téléphone (10 chiffres).');
const saisis = [];
for (const prenom of EMPLOYES) {
  const nom = ((await rl.question(`\n${prenom} — nom complet [${prenom}] : `)).trim()) || prenom;
  let tel = '';
  while (!/^[2-9]\d{9}$/.test(tel)) {
    tel = chiffres(await rl.question(`${nom} — téléphone (10 chiffres, ex. 819 123-4567) : `));
    if (!/^[2-9]\d{9}$/.test(tel)) console.log('   Numéro invalide : il faut 10 chiffres (indicatif régional compris).');
  }
  saisis.push({ nom, tel });
}
rl.close();
if (new Set(saisis.map((s) => s.tel)).size !== saisis.length) { console.log('\n>>> ARRÊT : deux employés ont le même numéro.'); process.exit(1); }

const A = await connexion(courriel, await lireSecret('\nMot de passe de l\'administrateur (masqué, ne s\'affiche pas) : '));
if (!A) { console.log('\n>>> ARRÊT : connexion impossible (courriel ou mot de passe).'); process.exit(1); }
pass('connexion de l\'administrateur');

// ----- Véhicules -----
console.log('\n=== VÉHICULES ===');
const existants = (await rest(A, 'equipes?select=id,nom,actif')).json ?? [];
for (const nom of VEHICULES) {
  let v = existants.find((e) => e.nom === nom);
  if (v) { pass(`« ${nom} » existe déjà (rien à créer)`); continue; }
  const r = await rest(A, 'equipes', 'POST', { nom });
  v = r.json?.[0];
  r.statut === 201 && v?.id ? pass(`véhicule créé : « ${nom} »`) : fail(`création du véhicule « ${nom} »`, `HTTP ${r.statut}`);
  if (v?.id) existants.push(v);
}
// Vérifie que l'administrateur peut renommer et désactiver un véhicule (ce que fera son panneau d'administration)
const test1 = existants.find((e) => e.nom === VEHICULES[0]);
if (test1) {
  let r = await rest(A, `equipes?id=eq.${test1.id}`, 'PATCH', { nom: VEHICULES[0] });
  r.statut === 200 && r.json?.length === 1 ? pass('l\'administrateur peut RENOMMER un véhicule (droit vérifié)') : fail('renommer un véhicule', `HTTP ${r.statut}`);
  r = await rest(A, `equipes?id=eq.${test1.id}`, 'PATCH', { actif: false });
  const inactif = r.statut === 200 && r.json?.[0]?.actif === false;
  r = await rest(A, `equipes?id=eq.${test1.id}`, 'PATCH', { actif: true });
  inactif && r.statut === 200 && r.json?.[0]?.actif === true ? pass('l\'administrateur peut DÉSACTIVER puis RÉACTIVER un véhicule (droit vérifié)') : fail('désactiver / réactiver un véhicule', `HTTP ${r.statut}`);
}

// ----- Employés -----
console.log('\n=== EMPLOYÉS ===');
const nouveaux = [];
for (const { nom, tel } of saisis) {
  const r = await edge(A, { action: 'creer', nom, telephone: tel });
  if (r.statut === 200) { pass(`compte créé : ${nom}`); nouveaux.push({ nom, tel, nip: r.json.nip }); }
  else if (r.statut === 409) fail(`${nom} : ${r.json?.message ?? 'numéro déjà utilisé'}`);
  else fail(`création du compte de ${nom}`, `HTTP ${r.statut} ${r.json?.erreur ?? ''}`);
}
for (const e of nouveaux) {
  const jeton = await connexion(`${e.tel}@${DOMAINE}`, e.nip);
  jeton ? pass(`${e.nom} peut se connecter avec son numéro et son NIP`) : fail(`connexion de ${e.nom}`);
}

if (nouveaux.length) {
  console.log('\n' + '='.repeat(64));
  console.log('  NUMÉROS ET NIP À REMETTRE AUX EMPLOYÉS — affichés UNE SEULE FOIS');
  console.log('  (ne copie PAS ce tableau dans une conversation ; note-les ailleurs)');
  console.log('='.repeat(64));
  for (const e of nouveaux) console.log(`  ${e.nom.padEnd(24)} téléphone ${e.tel.replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2-$3')}    NIP ${e.nip}`);
  console.log('='.repeat(64));
  console.log('  Si un NIP est perdu : il peut être réinitialisé (action « reinitialiser_nip »).');
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
