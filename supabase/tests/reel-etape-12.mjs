// Étape 12 — ESSAIS SUR LA VRAIE BASE : « Changer mon NIP » (employé) avec le vrai Supabase Auth. Ne fait PAS partie de « npm test ».
//   node reel-etape-12.mjs
// Même précautions que les autres essais réels : mot de passe de l'administrateur tapé masqué, aucun jeton ni NIP affiché,
// un seul compte d'essai « ZZTEST Nip » (819 555 0198) à effacer ensuite avec 10-nettoyage-comptes-zztest.sql.
import fs from 'fs';
import readline from 'readline/promises';
import { fileURLToPath } from 'url';

const config = fs.readFileSync(fileURLToPath(new URL('../../www/js/config.js', import.meta.url)), 'utf8');
const URL_PROJET = config.match(/SUPA_URL\s*=\s*'([^']+)'/)[1];
const CLE_PUBLIQUE = config.match(/SUPA_KEY\s*=\s*'([^']+)'/)[1];
const DOMAINE = 'tel.entretienlapointe.ca';

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l, d) => { ok++; log('  ✔ ' + l + (d ? '  [' + d + ']' : '')); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));

async function http(methode, chemin, { jeton, corps, entetes } = {}) {
  const h = { apikey: CLE_PUBLIQUE, 'Content-Type': 'application/json', Authorization: 'Bearer ' + (jeton || CLE_PUBLIQUE), ...entetes };
  let r;
  try { r = await fetch(URL_PROJET + chemin, { method: methode, headers: h, body: corps === undefined ? undefined : JSON.stringify(corps) }); }
  catch { return { statut: 0, json: null }; }
  let json = null; try { json = await r.json(); } catch { /* vide */ }
  return { statut: r.status, json };
}
const connexion = async (email, password) => {
  const r = await http('POST', '/auth/v1/token?grant_type=password', { corps: { email, password } });
  return r.statut === 200 && r.json?.access_token ? { jeton: r.json.access_token, refresh: r.json.refresh_token } : { jeton: null, statut: r.statut, code: r.json?.error_code };
};
const changerNip = (jeton, password) => http('PUT', '/auth/v1/user', { jeton, corps: { password } });
const detail = (r) => `HTTP ${r.statut}${r.json?.error_code ? ' ' + r.json.error_code : r.json?.code ? ' ' + r.json.code : ''}`;

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
        if (ch === String.fromCharCode(3)) process.exit(130);
        if (ch === String.fromCharCode(127) || ch === String.fromCharCode(8)) s = s.slice(0, -1); else s += ch;
      }
    };
    stdin.on('data', surDonnees);
  });
}

log(`Projet : ${URL_PROJET}\n`);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const courriel = (await rl.question('Courriel du compte administrateur : ')).trim();
rl.close();
const A = (await connexion(courriel, await lireSecret('Mot de passe (masqué, ne s\'affiche pas) : '))).jeton;
if (!A) { console.log('\n>>> ARRÊT : connexion impossible.'); process.exit(1); }
pass('connexion de l\'administrateur');
const restes = ((await http('POST', '/rest/v1/rpc/admin_lister_utilisateurs', { jeton: A })).json ?? []).filter((u) => (u.nom ?? '').startsWith('ZZTEST'));
if (restes.length) { console.log('\n>>> ARRÊT : restes d\'un essai précédent (ZZTEST) : exécute d\'abord 10-nettoyage-comptes-zztest.sql'); process.exit(1); }

log('\n=== L\'EMPLOYÉ CHANGE SON NIP (vrai Supabase Auth) ===');
const tel = '8195550198', courrielEmp = `${tel}@${DOMAINE}`;
const c = await http('POST', '/functions/v1/admin-employes', { jeton: A, corps: { action: 'creer', nom: 'ZZTEST Nip', telephone: tel } });
if (c.statut !== 200) { console.log(`\n>>> ARRÊT : création du compte d'essai impossible (${detail(c)})`); process.exit(1); }
const nipDepart = c.json.nip;
let e = await connexion(courrielEmp, nipDepart);
vrai('l\'employé d\'essai se connecte avec son NIP de départ', !!e.jeton);
if (!e.jeton) process.exit(1);

// 1) Le NIP actuel est revérifié (ce que fait l'application avant de changer)
const faux = await connexion(courrielEmp, '000001');
vrai('un NIP actuel FAUX est refusé par le serveur (code invalid_credentials)', !faux.jeton && faux.code === 'invalid_credentials', `code ${faux.code}`);

// 2) Changement
let r = await changerNip(e.jeton, '739104');
eq('changer le NIP avec sa session : accepté SANS étape de sécurité supplémentaire (200)', r.statut, 200);
if (r.statut !== 200) console.log('   Détail du refus : ' + JSON.stringify({ statut: r.statut, code: r.json?.error_code ?? r.json?.code, msg: r.json?.msg ?? r.json?.message }));
let ancien = await connexion(courrielEmp, nipDepart);
vrai('l\'ANCIEN NIP ne fonctionne plus', !ancien.jeton, `code ${ancien.code}`);
let nouveau = await connexion(courrielEmp, '739104');
vrai('le NOUVEAU NIP fonctionne', !!nouveau.jeton);
e = nouveau.jeton ? nouveau : e;

// 3) Les erreurs que l'application traduit en français
r = await changerNip(e.jeton, '739104');
eq('même NIP une 2e fois : le serveur répond « same_password » (message que l\'application affiche)', [r.statut, r.json?.error_code ?? r.json?.code], [422, 'same_password']);
r = await changerNip(e.jeton, '73910');
vrai('NIP de 5 chiffres : refusé par le serveur (validation de l\'application redondante)', r.statut === 422 || r.statut === 400, detail(r));
console.log(`   (code renvoyé par le serveur pour un NIP trop court : ${r.json?.error_code ?? r.json?.code ?? '?'})`);
r = await changerNip(e.jeton, '123456');
console.log(`   NIP évident « 123456 » envoyé directement au serveur : HTTP ${r.statut} — ${r.statut === 200 ? 'ACCEPTÉ par le serveur (limite connue : les NIP évidents ne sont refusés que par l\'application et la fonction admin-employes)' : 'refusé par le serveur'}`);
if (r.statut === 200) { const retour = await changerNip((await connexion(courrielEmp, '123456')).jeton, '739104'); vrai('… remis à un NIP non évident', retour.statut === 200, detail(retour)); }

// 4) Ce que l'employé NE peut PAS faire avec sa session
const employeApres = await connexion(courrielEmp, '739104');
const tj = employeApres.jeton;
r = await http('GET', '/auth/v1/admin/users', { jeton: tj });
vrai('la liste des comptes de connexion (API d\'administration Auth) est INTERDITE à un employé', r.statut === 401 || r.statut === 403, detail(r));
r = await http('PUT', '/auth/v1/admin/users/00000000-0000-0000-0000-000000000000', { jeton: tj, corps: { password: '739104' } });
vrai('changer le mot de passe d\'un AUTRE compte par l\'API d\'administration est INTERDIT à un employé', r.statut === 401 || r.statut === 403 || r.statut === 404, detail(r));
r = await http('GET', '/rest/v1/utilisateurs?select=nom,role', { jeton: tj });
vrai('après le changement, l\'employé voit toujours ce qu\'il doit voir (session valide, compte actif)', r.statut === 200 && Array.isArray(r.json) && r.json.length >= 1, detail(r));
// « return=representation » : le serveur renvoie les lignes modifiées (une liste VIDE = aucune ligne touchée).
// Sans cet en-tête, un succès et un refus silencieux répondent tous deux 204 (pas de contenu) : le test ne pouvait pas les distinguer.
r = await http('PATCH', '/rest/v1/utilisateurs?role=eq.admin', { jeton: tj, corps: { actif: false }, entetes: { Prefer: 'return=representation' } });
vrai('… et ne peut toujours pas désactiver l\'administrateur (aucune ligne modifiée)', r.statut >= 400 || (Array.isArray(r.json) && r.json.length === 0), detail(r) + ' ' + String(JSON.stringify(r.json)).slice(0, 80));
const admin = await http('POST', '/rest/v1/rpc/est_admin', { jeton: A });
eq('l\'administrateur est toujours administrateur', admin.json, true);

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
log('Reste à faire : exécuter 10-nettoyage-comptes-zztest.sql dans Supabase (SQL Editor) pour effacer le compte d\'essai.');
process.exit(ko ? 1 : 0);
