// Étape 18b (suite) — ESSAI SUR LA VRAIE BASE : le tracé qui suit les rues (fonction « calculer-parcours » + Geoapify + table parcours_segments).
// Ne fait PAS partie de « npm test ».   Dans PowerShell, dossier supabase\tests :
//   node reel-etape-18b.mjs
//   • le mot de passe de l'administrateur est tapé masqué, jamais affiché ni enregistré ; aucun jeton et aucune clé ne sont affichés ;
//   • il appelle la VRAIE fonction (elle dépense quelques crédits Geoapify : 1 par tronçon, UNE seule fois), lit ce qu'elle a écrit dans la base et vérifie que
//     les lignes ont du sens (elles partent et arrivent près des bons clients, la distance est plausible, l'ordre latitude/longitude est le bon) ;
//   • le 2e appel ne doit RIEN redemander (aucun crédit) ; un visiteur ne peut pas appeler la fonction ni lire la table ; l'administrateur ne peut pas y écrire ;
//   • rien n'est effacé, rien d'autre n'est modifié : les tronçons calculés RESTENT (c'est le but) ;
//   • l'affichage est aussi gardé dans %TEMP%\reel-18b-resultat.txt (adresses des clients incluses : ne pas le partager).
// PRÉREQUIS : le fichier SQL 22 exécuté, le secret GEOAPIFY_KEY enregistré, la fonction « calculer-parcours » déployée (fait le 21 septembre 2026).
process.removeAllListeners('warning');   // cache l'avertissement technique « stripTypeScriptTypes is experimental » (sans rapport avec cet essai)
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { stripTypeScriptTypes } from 'node:module';

const config = fs.readFileSync(fileURLToPath(new URL('../../www/js/config.js', import.meta.url)), 'utf8');
const URL_PROJET = config.match(/SUPA_URL\s*=\s*'([^']+)'/)[1];
const CLE_PUBLIQUE = config.match(/SUPA_KEY\s*=\s*'([^']+)'/)[1];
// Le même code de décision que la fonction (les tronçons voulus) : ce qu'on attend = ce que la fonction calcule
const F = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(fs.readFileSync(fileURLToPath(new URL('../functions/calculer-parcours/index.ts', import.meta.url)), 'utf8'))).toString('base64'));

const FICHIER_SORTIE = path.join(os.tmpdir(), 'reel-18b-resultat.txt');
try { fs.writeFileSync(FICHIER_SORTIE, ''); } catch { /* pas grave */ }
const propre = (s) => String(s).split('').map((c) => { const k = c.charCodeAt(0); return (k < 32 && k !== 9 && k !== 10) || k === 127 ? ' ' : c; }).join('');
let ok = 0, ko = 0, avertissements = 0;
const log = (s) => { const t = propre(s); console.log(t); try { fs.appendFileSync(FICHIER_SORTIE, t + '\n'); } catch { /* pas grave */ } };
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const attention = (l, d) => { avertissements++; log('  ⚠ ' + l + (d ? '  -> ' + d : '')); };
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));

class Arret extends Error {}
const arret = (raison) => { throw new Arret(raison); };

async function http(methode, chemin, { jeton, corps, entetes } = {}) {
  const en = { apikey: CLE_PUBLIQUE, 'Content-Type': 'application/json', Authorization: 'Bearer ' + (jeton || CLE_PUBLIQUE), ...entetes };
  let r;
  try { r = await fetch(URL_PROJET + chemin, { method: methode, headers: en, body: corps === undefined ? undefined : JSON.stringify(corps) }); }
  catch { return { statut: 0, json: null }; }
  let json = null; try { json = await r.json(); } catch { /* vide */ }
  return { statut: r.status, json };
}
const rpc = (jeton, nom, args = {}) => http('POST', '/rest/v1/rpc/' + nom, { jeton, corps: args });
const lire = (jeton, chemin) => http('GET', '/rest/v1/' + chemin, { jeton });
const calculer = (jeton, corps = {}) => http('POST', '/functions/v1/calculer-parcours', { jeton, corps });
async function connexion(courriel, motDePasse) {
  const r = await http('POST', '/auth/v1/token?grant_type=password', { corps: { email: courriel, password: motDePasse } });
  return r.statut === 200 && r.json?.access_token ? r.json.access_token : null;
}
// Une ligne tapée au clavier, caractère par caractère (masquée si demandé). Ne passe PAS par le module « readline » : sur certains terminaux (dont
// celui-ci), un retour à la ligne resté « en attente » après la question précédente arrive ici EN PREMIER et viderait le champ tout seul ; on l'ignore
// tant que rien n'a encore été tapé (« demarre »).
async function lireLigne(question, masquer) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    if (!stdin.isTTY) { console.log('\n(Ce script doit être lancé dans un terminal.)'); process.exitCode = 2; resolve(''); return; }
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    let s = '', demarre = false;
    const surDonnees = (c) => {
      for (const ch of c) {
        if (ch === '\r' || ch === '\n') {
          if (!demarre) continue;   // un retour à la ligne isolé, arrivé avant toute frappe : ignoré (pas un « Entrée » du champ)
          stdin.setRawMode(false); stdin.pause(); stdin.off('data', surDonnees); process.stdout.write('\n'); return resolve(s);
        }
        if (ch === String.fromCharCode(3)) process.exit(130);   // Ctrl+C
        if (ch === String.fromCharCode(127) || ch === String.fromCharCode(8)) { if (s.length) { s = s.slice(0, -1); if (!masquer) process.stdout.write('\b \b'); } continue; }
        demarre = true;
        s += ch;
        if (!masquer) process.stdout.write(ch);   // le courriel s'affiche en tapant ; le mot de passe, jamais
      }
    };
    stdin.on('data', surDonnees);
  });
}
const nom = (a) => (a && (a.client || a.adresse)) ? String(a.client || a.adresse) : '?';
const detail = (r) => `HTTP ${r.statut}${r.json?.erreur ? ' ' + r.json.erreur : ''}${r.json?.message ? ' — ' + String(r.json.message).slice(0, 160) : ''}`;
// Ce que dit chaque refus de la fonction, en mots simples
function expliquer(r) {
  if (r.statut === 0) return 'aucune réponse (pas de réseau ?)';
  if (r.statut === 404) return 'la fonction « calculer-parcours » est introuvable : elle n\'est pas déployée, ou son nom est différent (il doit être exactement calculer-parcours)';
  if (r.statut === 403) return 'refusé : ce compte n\'est pas administrateur';
  if (r.json?.erreur === 'cle_absente') return 'le secret GEOAPIFY_KEY n\'est pas enregistré dans Supabase (Edge Functions > Secrets), ou son nom n\'est pas exactement GEOAPIFY_KEY';
  if (r.json?.erreur === 'cle_refusee') return 'Geoapify refuse la clé : elle est mal copiée, ou désactivée chez Geoapify (myprojects.geoapify.com)';
  if (r.statut === 401) return 'le jeton a été refusé par Supabase (« Verify JWT ») : reconnecte-toi et recommence';
  return 'erreur inattendue : ' + detail(r);
}

async function principal() {
  log(`Projet : ${URL_PROJET}`);
  const courrielAdmin = (await lireLigne('Courriel du compte administrateur : ', false)).trim();
  const A0 = await connexion(courrielAdmin, await lireLigne('Mot de passe (masqué, ne s\'affiche pas) : ', true));
  if (!A0) arret('connexion de l\'administrateur impossible (courriel ou mot de passe)');
  const estAdmin = await rpc(A0, 'est_admin');
  if (estAdmin.json !== true) arret('ce compte n\'est pas administrateur');
  pass('connecté en administrateur');

  // ── Ce qu'on attend ──
  const arrets = (await lire(A0, 'stops?select=id,client,adresse,route_id,service,lat,lon,ordre,created_at&actif=eq.true&order=ordre.asc,created_at.asc,id.asc')).json;
  if (!Array.isArray(arrets)) arret('les arrêts n\'ont pas pu être lus');
  const parId = new Map(arrets.map((a) => [a.id, a]));
  const voulus = F.paires(F.sequences(arrets));
  log(`\n${arrets.length} arrêts actifs → ${voulus.length} tronçon(s) voulu(s) (un client vers le suivant, pour chaque route et chaque type de service).`);
  const avant = await lire(A0, 'parcours_segments?select=de_arret_id,vers_arret_id,statut,calcule_le');
  vrai('la table parcours_segments se lit (SQL 22 exécuté)', avant.statut === 200 && Array.isArray(avant.json), detail(avant));
  const gardesAvant = Array.isArray(avant.json) ? avant.json : [];
  log(`   ${gardesAvant.length} tronçon(s) déjà en base avant l'essai.`);
  if (!voulus.length) { attention('aucun tronçon voulu (aucune route n\'a au moins deux clients du même type de service avec une position) : rien à essayer'); return; }

  // ── La sécurité, avant de dépenser quoi que ce soit ──
  log('\n=== QUI A LE DROIT ===');
  const visiteur = await calculer(undefined, {});
  vrai('un visiteur (sans compte) ne peut PAS appeler la fonction', visiteur.statut === 401 || visiteur.statut === 403, detail(visiteur));
  const lectureVisiteur = await lire(undefined, 'parcours_segments?select=de_arret_id&limit=1');
  vrai('un visiteur ne peut PAS lire la table', lectureVisiteur.statut >= 400 || (Array.isArray(lectureVisiteur.json) && lectureVisiteur.json.length === 0), detail(lectureVisiteur));
  const faux = '00000000-0000-4000-8000-000000000001';
  const ecriture = await http('POST', '/rest/v1/parcours_segments', { jeton: A0, corps: { de_arret_id: faux, vers_arret_id: faux.replace(/1$/, '2'), de_lat: 1, de_lon: 1, vers_lat: 2, vers_lon: 2, statut: 'sans_route' } });
  vrai('l\'administrateur ne peut PAS écrire dans la table (seule la fonction le peut)', ecriture.statut >= 400 && /permission|42501/i.test(JSON.stringify(ecriture.json)), detail(ecriture));
  const suppression = await http('DELETE', `/rest/v1/parcours_segments?de_arret_id=eq.${faux}`, { jeton: A0 });
  vrai('… ni supprimer', suppression.statut >= 400, detail(suppression));

  // ── Le vrai calcul ──
  log('\n=== LE CALCUL (vraie fonction, vraie clé Geoapify) ===');
  let dernier = null, total = { calcules: 0, sans_route: 0, echecs: 0 };
  for (let tour = 1; tour <= 6; tour++) {
    const r = await calculer(A0, {});
    if (r.statut !== 200 || r.json?.ok !== true) { fail(`appel n° ${tour} de la fonction`, expliquer(r)); return; }
    dernier = r.json;
    total.calcules += r.json.calcules; total.sans_route += r.json.sans_route; total.echecs += r.json.echecs;
    log(`   appel n° ${tour} : ${r.json.calcules} calculé(s), ${r.json.sans_route} sans route, ${r.json.echecs} échec(s), ${r.json.restants} restant(s), ${r.json.total_troncons} voulus${r.json.limite_atteinte ? ', LIMITE DU SERVICE ATTEINTE' : ''}`);
    if (!(r.json.restants > 0) || r.json.limite_atteinte || (r.json.calcules + r.json.sans_route) === 0) break;
  }
  pass('la fonction répond (admin, clé Geoapify acceptée)');
  vrai('la fonction connaît le même nombre de tronçons voulus que ce script', dernier.total_troncons === voulus.length, `${dernier.total_troncons} contre ${voulus.length}`);
  if (dernier.limite_atteinte) attention('la limite du service Geoapify est atteinte : réessaie plus tard');
  if (total.echecs) attention(`${total.echecs} tronçon(s) n'ont pas pu être calculés (panne passagère ou réponse inattendue de Geoapify) : le journal de la fonction (Supabase > Edge Functions > calculer-parcours > Logs) dira pourquoi`);

  // ── Ce qui est en base ──
  log('\n=== CE QUI EST EN BASE ===');
  const lus = await lire(A0, 'parcours_segments?select=*&order=de_arret_id.asc,vers_arret_id.asc');
  if (lus.statut !== 200 || !Array.isArray(lus.json)) arret('la table n\'a pas pu être relue : ' + detail(lus));
  const segments = lus.json;
  const parCouple = new Map(segments.map((s) => [s.de_arret_id + '|' + s.vers_arret_id, s]));
  const manquantsApres = F.manquants(voulus, segments.map((s) => ({ de_arret_id: s.de_arret_id, vers_arret_id: s.vers_arret_id, de_lat: s.de_lat, de_lon: s.de_lon, vers_lat: s.vers_lat, vers_lon: s.vers_lon, statut: s.statut })));
  vrai(`les ${voulus.length} tronçons voulus ont tous un tronçon À JOUR en base (calculé ou « sans route »)`, manquantsApres.length === 0, `${manquantsApres.length} manquant(s)`);
  let octets = 0, nbPoints = 0, plusLong = 0, sansRoute = 0;
  const boite = { minLat: Math.min(...arrets.filter((a) => a.lat).map((a) => a.lat)) - 0.5, maxLat: Math.max(...arrets.filter((a) => a.lat).map((a) => a.lat)) + 0.5,
    minLon: Math.min(...arrets.filter((a) => a.lon).map((a) => a.lon)) - 0.5, maxLon: Math.max(...arrets.filter((a) => a.lon).map((a) => a.lon)) + 0.5 };
  for (const p of voulus) {
    const s = parCouple.get(p.de.id + '|' + p.vers.id);
    const a = parId.get(p.de.id), b = parId.get(p.vers.id);
    const droit = F.distanceM({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon });
    const etiquette = `« ${nom(a)} » → « ${nom(b)} »`;
    if (!s) { fail(`tronçon ${etiquette} absent`); continue; }
    if (s.statut === 'sans_route') { sansRoute++; attention(`${etiquette} : Geoapify n'a trouvé AUCUNE route (à vol d'oiseau : ${Math.round(droit)} m)`); continue; }
    const t = s.trace;
    octets += JSON.stringify(t).length; nbPoints += t.length; plusLong = Math.max(plusLong, t.length);
    const problemes = [];
    if (!Array.isArray(t) || t.length < 2) problemes.push('moins de deux points');
    else {
      const [d0, d1] = [F.distanceM({ lat: t[0][0], lon: t[0][1] }, { lat: a.lat, lon: a.lon }), F.distanceM({ lat: t[t.length - 1][0], lon: t[t.length - 1][1] }, { lat: b.lat, lon: b.lon })];
      if (d0 > 300) problemes.push(`la ligne commence à ${Math.round(d0)} m du client de départ`);
      if (d1 > 300) problemes.push(`la ligne finit à ${Math.round(d1)} m du client d'arrivée`);
      if (t.some((q) => !Array.isArray(q) || q.length !== 2 || !isFinite(q[0]) || !isFinite(q[1]) || q[0] < boite.minLat || q[0] > boite.maxLat || q[1] < boite.minLon || q[1] > boite.maxLon)) problemes.push('des points sont hors de la région des clients (latitude et longitude inversées ?)');
    }
    if (s.distance_m < droit * 0.9 - 50) problemes.push(`distance ${s.distance_m} m plus courte que la ligne droite (${Math.round(droit)} m)`);
    if (s.distance_m > droit * 8 + 500) problemes.push(`distance ${s.distance_m} m bien plus longue que la ligne droite (${Math.round(droit)} m)`);
    if (s.distance_m > 100 && !(s.duree_s > 0)) problemes.push('durée absente');
    if (!(Math.abs(s.de_lat - a.lat) < 1e-7 && Math.abs(s.de_lon - a.lon) < 1e-7 && Math.abs(s.vers_lat - b.lat) < 1e-7 && Math.abs(s.vers_lon - b.lon) < 1e-7)) problemes.push('les positions gardées ne sont pas celles des clients');
    const resume = `${etiquette} : ${s.distance_m} m par la route (${Math.round(droit)} m à vol d'oiseau), ${Math.round(s.duree_s / 60 * 10) / 10} min, ${t.length} points`;
    problemes.length ? fail(resume, problemes.join(' ; ')) : pass(resume);
  }
  const lignes = segments.length - sansRoute;
  if (lignes) log(`   ${lignes} ligne(s) : ${Math.round(nbPoints / lignes)} points en moyenne (au plus ${plusLong}), ${Math.round(octets / 1024 * 10) / 10} Ko en tout.`);
  const dt = new Set(segments.map((s) => s.calcule_le));
  vrai('les tronçons portent une date de calcul', segments.every((s) => s.calcule_le && !isNaN(Date.parse(s.calcule_le))));

  // ── Un deuxième appel ne redemande rien ──
  log('\n=== UN DEUXIÈME APPEL NE DOIT RIEN REDEMANDER ===');
  const r2 = await calculer(A0, {});
  vrai('deuxième appel : rien à calculer, aucun crédit dépensé', r2.statut === 200 && r2.json?.calcules === 0 && r2.json?.sans_route === 0 && (r2.json?.restants ?? 0) === (total.echecs ? r2.json.restants : 0), detail(r2) + ' ' + JSON.stringify(r2.json));
  const apres = await lire(A0, 'parcours_segments?select=de_arret_id,vers_arret_id,calcule_le');
  vrai('… et rien n\'a été réécrit (mêmes dates de calcul)', Array.isArray(apres.json) && JSON.stringify(apres.json.map((s) => s.calcule_le).sort()) === JSON.stringify(segments.map((s) => s.calcule_le).sort()));

  log('\nTout ce qui a été calculé RESTE en base : c\'est ce que les employés verront pendant une passe.');
}

let code = 0;
try { await principal(); }
catch (e) {
  if (e instanceof Arret) { log('\n>>> ARRÊT : ' + e.message); code = 1; }
  else { log('\n>>> ERREUR INATTENDUE : ' + (e && e.message ? e.message : e)); code = 1; }
}
log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués${avertissements ? ', ' + avertissements + ' avertissement(s)' : ''} =====`);
log('(Le détail est aussi dans ' + FICHIER_SORTIE + ')');
process.exitCode = code || (ko ? 1 : 0);
