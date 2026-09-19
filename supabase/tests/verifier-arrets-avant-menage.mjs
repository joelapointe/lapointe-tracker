// Étape 13 — LECTURE SEULE sur la vraie base : liste les arrêts et compte leurs traces (passes, problèmes) avant le ménage.
//   node verifier-arrets-avant-menage.mjs
// N'écrit RIEN. Mot de passe de l'administrateur tapé masqué ; aucun jeton affiché.
import fs from 'fs';
import readline from 'readline/promises';
import { fileURLToPath } from 'url';

const config = fs.readFileSync(fileURLToPath(new URL('../../www/js/config.js', import.meta.url)), 'utf8');
const URL_PROJET = config.match(/SUPA_URL\s*=\s*'([^']+)'/)[1];
const CLE_PUBLIQUE = config.match(/SUPA_KEY\s*=\s*'([^']+)'/)[1];

async function http(methode, chemin, { jeton, corps } = {}) {
  const h = { apikey: CLE_PUBLIQUE, 'Content-Type': 'application/json', Authorization: 'Bearer ' + (jeton || CLE_PUBLIQUE) };
  let r;
  try { r = await fetch(URL_PROJET + chemin, { method: methode, headers: h, body: corps === undefined ? undefined : JSON.stringify(corps) }); }
  catch { return { statut: 0, json: null }; }
  let json = null; try { json = await r.json(); } catch { /* vide */ }
  return { statut: r.status, json };
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
        if (ch === String.fromCharCode(3)) process.exit(130);
        if (ch === String.fromCharCode(127) || ch === String.fromCharCode(8)) s = s.slice(0, -1); else s += ch;
      }
    };
    stdin.on('data', surDonnees);
  });
}

console.log(`Projet : ${URL_PROJET}\n(lecture seule : rien n'est écrit)\n`);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const courriel = (await rl.question('Courriel du compte administrateur : ')).trim();
rl.close();
const mdp = await lireSecret("Mot de passe (masqué, ne s'affiche pas) : ");
const c = await http('POST', '/auth/v1/token?grant_type=password', { corps: { email: courriel, password: mdp } });
const jeton = c.statut === 200 ? c.json?.access_token : null;
if (!jeton) { console.log('\n>>> ARRÊT : connexion impossible (HTTP ' + c.statut + ').'); process.exit(1); }

const lire = async (chemin) => {
  const r = await http('GET', chemin, { jeton });
  if (r.statut !== 200) { console.log(`\n>>> ARRÊT : lecture refusée sur ${chemin.split('?')[0]} (HTTP ${r.statut})`); process.exit(1); }
  return r.json;
};
const routes = await lire('/rest/v1/routes?select=id,nom');
const nomRoute = Object.fromEntries(routes.map((r) => [r.id, r.nom]));
const arrets = await lire('/rest/v1/stops?select=id,adresse,client,service,lat,lon,route_id,actif,ordre&order=ordre');
const passeArrets = await lire('/rest/v1/passe_arrets?select=stop_id');
const problemes = await lire('/rest/v1/problemes?select=stop_id');
const passes = await lire('/rest/v1/passes?select=id');
const compte = (lignes) => lignes.reduce((m, l) => (m[l.stop_id] = (m[l.stop_id] || 0) + 1, m), {});
const nPA = compte(passeArrets), nPb = compte(problemes);

console.log(`\nRoutes : ${routes.map((r) => `« ${r.nom} »`).join(', ') || '(aucune)'}`);
console.log(`Passes en base : ${passes.length} ; lignes passe_arrets : ${passeArrets.length} ; problèmes : ${problemes.length}\n`);
console.log(`Arrêts (${arrets.length}) :`);
let avecHistorique = 0;
for (const a of arrets) {
  const h = (nPA[a.id] || 0) + (nPb[a.id] || 0);
  if (h) avecHistorique++;
  console.log(`  ${String(a.ordre ?? '-').padStart(3)} | ${(a.adresse || '').slice(0, 42).padEnd(42)} | ${(a.client || '-').slice(0, 16).padEnd(16)} | ${(nomRoute[a.route_id] || 'SANS ROUTE').padEnd(24)} | ${a.actif ? 'actif ' : 'ARCHIVÉ'} | passes:${nPA[a.id] || 0} problèmes:${nPb[a.id] || 0}`);
}
console.log(`\n>>> ${arrets.length} arrêts, dont ${avecHistorique} avec un historique (ceux-là seraient archivés, pas supprimés).`);
