// Étape 18b — outil des ERREURS VOLONTAIRES du fichier SQL 22 et de la fonction « calculer-parcours » (ne fait PAS partie de « npm test »).
//   node mutations-etape-17/erreurs-volontaires-etape-18b.mjs               (toutes les mutations, ≈ 10 s chacune)
//   ONLY=3,40 node mutations-etape-17/erreurs-volontaires-etape-18b.mjs     (seulement celles-là)
//   SERIE=0/4 node …                                                        (le quart n° 0 sur 4 : pour lancer 4 séries EN PARALLÈLE)
// Chaque mutation abîme UNE règle dans une COPIE (dossier temporaire) du fichier SQL 22 (variable SQL22_TEST) ou de la fonction
// (variable FONCTION18B_TEST) ; test-etape-18b.mjs doit alors ÉCHOUER (ou planter). Les vrais fichiers ne sont JAMAIS touchés (l'outil le vérifie à la fin).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const TESTS = fileURLToPath(new URL('../', import.meta.url));   // le dossier supabase/tests/
const FICHIERS = {
  S: fileURLToPath(new URL('../../22-etape18b-parcours-segments.sql', import.meta.url)),
  F: fileURLToPath(new URL('../../functions/calculer-parcours/index.ts', import.meta.url)),
};
const VARIABLES = { S: 'SQL22_TEST', F: 'FONCTION18B_TEST' };
const SOURCES = { S: fs.readFileSync(FICHIERS.S, 'utf8'), F: fs.readFileSync(FICHIERS.F, 'utf8') };
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;
const [SERIE_K, SERIE_N] = process.env.SERIE ? process.env.SERIE.split('/').map(Number) : [0, 1];
const TMP = (f) => path.join(os.tmpdir(), `erreurs-18b-${SERIE_K}-${f}${f === 'F' ? '.ts' : '.sql'}`);

// [S = fichier SQL, F = fonction, nom, texte exact (UNE fois dans ce fichier), texte abîmé]
const M = [
  // ── La fonction : l'ordre, les suites, les tronçons voulus ──
  ['F', 'l\'ordre ne décide plus (les clients restent dans l\'ordre de lecture)', `return liste.map((s, i) => ({ s, i })).sort((a, b) => valeurOrdre(a.s) - valeurOrdre(b.s) || a.i - b.i).map((x) => x.s);`, `return liste.slice();`],
  ['F', 'à égalité d\'ordre, l\'ordre de départ n\'est plus gardé', `valeurOrdre(a.s) - valeurOrdre(b.s) || a.i - b.i`, `valeurOrdre(a.s) - valeurOrdre(b.s) || b.i - a.i`],
  ['F', 'une valeur d\'ordre illisible n\'est plus ramenée à 0', `return isFinite(n) ? n : 0;`, `return n;`],
  ['F', 'un arrêt sans service entre dans une suite', `if (!a.route_id || !a.service || !aUnePosition(a)) continue;`, `if (!a.route_id || !aUnePosition(a)) continue;`],
  ['F', 'un arrêt sans route entre dans une suite', `if (!a.route_id || !a.service || !aUnePosition(a)) continue;`, `if (!a.service || !aUnePosition(a)) continue;`],
  ['F', 'un arrêt sans position entre dans une suite', `if (!a.route_id || !a.service || !aUnePosition(a)) continue;`, `if (!a.route_id || !a.service) continue;`],
  ['F', 'les services d\'une même route sont mélangés dans une seule suite', `const cle = a.route_id + '|' + a.service;`, `const cle = a.route_id;`],
  ['F', 'les routes d\'un même service sont mélangées dans une seule suite', `const cle = a.route_id + '|' + a.service;`, `const cle = a.service;`],
  ['F', 'les suites ne sont plus mises dans l\'ordre', `return [...groupes.values()].map(enOrdre);`, `return [...groupes.values()];`],
  ['F', 'un même couple est demandé deux fois', `if (s[i].id === s[i + 1].id || vus.has(cle)) continue;`, `if (s[i].id === s[i + 1].id) continue;`],
  ['F', 'un client est relié à lui-même', `if (s[i].id === s[i + 1].id || vus.has(cle)) continue;`, `if (vus.has(cle)) continue;`],
  // ── Tronçons manquants ou périmés ──
  ['F', 'un client qui a bougé ne périme plus le tronçon (tolérance énorme)', `const EPSILON_POSITION = 1e-7; `, `const EPSILON_POSITION = 1; `],
  ['F', 'la latitude du départ n\'est plus comparée', `memePosition(s.de_lat, p.de.lat!) && `, ``],
  ['F', 'la longitude du départ n\'est plus comparée', ` && memePosition(s.de_lon, p.de.lon!)`, ``],
  ['F', 'la latitude de l\'arrivée n\'est plus comparée', ` && memePosition(s.vers_lat, p.vers.lat!)`, ``],
  ['F', 'la longitude de l\'arrivée n\'est plus comparée', ` && memePosition(s.vers_lon, p.vers.lon!)`, ``],
  ['F', 'un tronçon gardé est bon même si un client a bougé', `if (!segmentValide(s, p)) return true;`, `if (!s) return true;`],
  ['F', '« refaire_sans_route » ne refait plus rien', `return refaireSansRoute && s!.statut === 'sans_route';`, `return false;`],
  ['F', 'les « sans_route » sont toujours redemandés', `return refaireSansRoute && s!.statut === 'sans_route';`, `return s!.statut === 'sans_route';`],
  // ── La réponse de Geoapify ──
  ['F', 'latitude et longitude sont inversées', `const lon = c[0], lat = c[1];`, `const lon = c[1], lat = c[0];`],
  ['F', 'le « MultiLineString » n\'est plus lu', `if (g.type === 'MultiLineString') lignes = g.coordinates;`, `if (false) lignes = g.coordinates;`],
  ['F', 'le « LineString » n\'est plus lu', `else if (g.type === 'LineString') lignes = [g.coordinates];`, `else if (false) lignes = [g.coordinates];`],
  ['F', 'le point de raccord de deux étapes est doublé', `if (!dernier || dernier[0] !== lat || dernier[1] !== lon) points.push([lat, lon]);`, `points.push([lat, lon]);`],
  ['F', 'une latitude ou longitude impossible est acceptée', `if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;`, `if (!isFinite(lat) || !isFinite(lon)) return null;`],
  ['F', 'une ligne d\'un seul point est acceptée', `if (points.length < 2) return null;`, ``],
  ['F', 'la distance n\'est plus arrondie', `distance_m: isFinite(distance) ? Math.round(distance) : 0`, `distance_m: isFinite(distance) ? distance : 0`],
  ['F', 'une distance absente devient NaN', `distance_m: isFinite(distance) ? Math.round(distance) : 0`, `distance_m: Math.round(distance)`],
  // ── Simplifier, arrondir, distance ──
  ['F', 'la simplification enlève même les virages (tolérance × 1000)', `if (imax >= 0 && dmax > tolerance) {`, `if (imax >= 0 && dmax > tolerance * 1000) {`],
  ['F', 'la simplification ne retire plus rien (tolérance ÷ 1000)', `if (imax >= 0 && dmax > tolerance) {`, `if (imax >= 0 && dmax > tolerance / 1000) {`],
  ['F', 'le dernier point de la ligne n\'est plus gardé', `garde[0] = 1; garde[pts.length - 1] = 1;`, `garde[0] = 1;`],
  ['F', 'les mètres ne tiennent plus compte de la latitude', `kx = 111320 * Math.cos(pts[0][0] * Math.PI / 180);`, `kx = 111320;`],
  ['F', 'l\'arrondi est à 3 décimales (100 m) au lieu de 5', `const r = (x: number) => Math.round(x * 1e5) / 1e5;`, `const r = (x: number) => Math.round(x * 1e3) / 1e3;`],
  ['F', 'deux points identiques après arrondi ne sont plus fusionnés', `if (!d || d[0] !== q[0] || d[1] !== q[1]) sortie.push(q);`, `sortie.push(q);`],
  ['F', 'une ligne qui s\'écrase en un point n\'a plus ses deux extrémités', `if (sortie.length < 2) return`, `if (false) return`],
  ['F', 'la distance entre deux points est fausse (rayon × 2)', `const R = 6371008.8,`, `const R = 12742017.6,`],
  // ── Qui a le droit ──
  ['F', 'plus aucun contrôle de l\'appelant', `if (!/^Bearer\\s+\\S+$/i.test(autorisation) || !(await deps.estAdmin(autorisation))) {`, `if (false) {`],
  ['F', 'le format « Bearer » n\'est plus exigé', `if (!/^Bearer\\s+\\S+$/i.test(autorisation) || !(await deps.estAdmin(autorisation))) {`, `if (!(await deps.estAdmin(autorisation))) {`],
  ['F', 'la base n\'est plus interrogée pour savoir si l\'appelant est administrateur', `if (!/^Bearer\\s+\\S+$/i.test(autorisation) || !(await deps.estAdmin(autorisation))) {`, `if (!/^Bearer\\s+\\S+$/i.test(autorisation)) {`],
  ['F', 'GET est accepté', `if (req.method !== 'POST') return repondre(refus(405,`, `if (false) return repondre(refus(405,`],
  ['F', 'la pré-vérification (OPTIONS) n\'est plus traitée', `if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });`, ``],
  ['F', 'un corps vide est refusé', `if (texte.trim() !== '') {`, `if (true) {`],
  ['F', 'un corps qui est une liste est accepté', `if (!corps || typeof corps !== 'object' || Array.isArray(corps)) return repondre(refus(400, 'requete_invalide', 'Corps JSON invalide.'));`, `if (!corps || typeof corps !== 'object') return repondre(refus(400, 'requete_invalide', 'Corps JSON invalide.'));`],
  ['F', 'un identifiant de route invalide est accepté', `if (corps.route_id !== undefined && (typeof corps.route_id !== 'string' || !EST_UUID.test(corps.route_id))) {`, `if (false) {`],
  ['F', 'la clé Geoapify absente n\'est plus signalée', `if (!deps.cleGeoapifyPresente()) {`, `if (false) {`],
  ['F', '« refaire_sans_route » s\'active avec n\'importe quelle valeur', `const refaire = corps.refaire_sans_route === true;`, `const refaire = !!corps.refaire_sans_route;`],
  ['F', 'le filtre par route est ignoré', `const retenus = corps.route_id ? arrets.filter((a) => a.route_id === String(corps.route_id).toLowerCase()) : arrets;`, `const retenus = arrets;`],
  ['F', 'une erreur interne montre son détail technique', `'Erreur interne. Réessayez ; si le problème continue`, `'Erreur interne ' + String(e) + '. Réessayez ; si le problème continue`],
  ['F', 'les en-têtes CORS sont faux', `'Access-Control-Allow-Origin': '*',`, `'Access-Control-Allow-Origin': 'null',`],
  // ── Le calcul ──
  ['F', 'plus de limite par appel (tous les tronçons d\'un coup)', `const lot = aFaire.slice(0, TRONCONS_PAR_APPEL);`, `const lot = aFaire;`],
  ['F', 'la limite par appel est de 400', `export const TRONCONS_PAR_APPEL = 40; `, `export const TRONCONS_PAR_APPEL = 400; `],
  ['F', 'deux clients au même endroit interrogent quand même le service', `if (separes < DISTANCE_CONFONDUS_M) {`, `if (false) {`],
  ['F', 'la distance « confondus » est de 0,5 m', `export const DISTANCE_CONFONDUS_M = 8; `, `export const DISTANCE_CONFONDUS_M = 0.5; `],
  ['F', 'des clients confondus n\'ont pas de ligne', `trace: [[de.lat, de.lon], [vers.lat, vers.lon]], distance_m: Math.round(separes), duree_s: 0`, `trace: null, distance_m: Math.round(separes), duree_s: 0`],
  ['F', 'des clients confondus ne comptent pas comme traités', `calcules++; traites++;\n      continue;`, `calcules++;\n      continue;`],
  ['F', '« trop de demandes » : plus de nouvel essai', `if ('erreur' in r && r.erreur === 'limite') {   // « trop de demandes »`, `if (false) {   // « trop de demandes »`],
  ['F', '« trop de demandes » : pas de pause avant le nouvel essai', `await deps.attendre(PAUSE_LIMITE_MS);`, ``],
  ['F', '« trop de demandes » persistant : on continue avec les suivants au lieu de s\'arrêter', `if (r.erreur === 'limite') { limite = true; break; }`, `if (r.erreur === 'limite') { limite = true; }`],
  ['F', 'la limite atteinte n\'est plus annoncée', `return ok({ calcules, sans_route: sansRoute, echecs, restants, total_troncons: voulus.length, limite_atteinte: limite });`, `return ok({ calcules, sans_route: sansRoute, echecs, restants, total_troncons: voulus.length, limite_atteinte: false });`],
  ['F', 'une clé refusée n\'arrête plus le travail', `if (r.erreur === 'cle_refusee') {`, `if (false) {`],
  ['F', 'une clé refusée répond 200', `return refus(502, 'cle_refusee',`, `return refus(200, 'cle_refusee',`],
  ['F', '« sans_route » est écrit comme « ok »', `await deps.ecrireSegment({ ...base, statut: 'sans_route', trace: null, distance_m: null, duree_s: null });`, `await deps.ecrireSegment({ ...base, statut: 'ok', trace: null, distance_m: null, duree_s: null });`],
  ['F', '« sans_route » n\'est pas écrit du tout (redemandé à chaque fois)', `await deps.ecrireSegment({ ...base, statut: 'sans_route', trace: null, distance_m: null, duree_s: null });\n        sansRoute++; traites++;`, `sansRoute++; traites++;`],
  ['F', '« sans_route » n\'est pas compté comme traité', `sansRoute++; traites++;`, `sansRoute++;`],
  ['F', 'une panne passagère est gardée comme « sans_route »', `echecs++;   // panne passagère du service : rien n'est écrit, un prochain appel réessaiera`, `echecs++; await deps.ecrireSegment({ ...base, statut: 'sans_route', trace: null, distance_m: null, duree_s: null });`],
  ['F', 'la ligne n\'est ni simplifiée ni arrondie', `const trace = arrondir(simplifier(r.trace, TOLERANCE_M));`, `const trace = r.trace;`],
  ['F', 'la ligne est simplifiée mais pas arrondie', `const trace = arrondir(simplifier(r.trace, TOLERANCE_M));`, `const trace = simplifier(r.trace, TOLERANCE_M);`],
  ['F', 'le tronçon garde la position d\'arrivée à la place de celle du départ', `de_lat: de.lat, de_lon: de.lon, vers_lat: vers.lat, vers_lon: vers.lon }`, `de_lat: vers.lat, de_lon: vers.lon, vers_lat: vers.lat, vers_lon: vers.lon }`],
  ['F', 'un tronçon calculé ne compte pas comme traité', `await deps.ecrireSegment({ ...base, statut: 'ok', trace, distance_m: r.distance_m, duree_s: r.duree_s });\n      calcules++; traites++;`, `await deps.ecrireSegment({ ...base, statut: 'ok', trace, distance_m: r.distance_m, duree_s: r.duree_s });\n      calcules++;`],
  ['F', 'la distance et la durée ne sont pas gardées', `distance_m: r.distance_m, duree_s: r.duree_s });\n      calcules++; traites++;`, `distance_m: null, duree_s: null });\n      calcules++; traites++;`],
  ['F', '« restants » ignore ce qui a échoué', `const restants = aFaire.length - traites;`, `const restants = aFaire.length - lot.length;`],
  ['F', 'plus de pause entre deux demandes', `await deps.attendre(PAUSE_ENTRE_APPELS_MS);\n  }`, `}`],
  ['F', 'plus de limite de durée par appel (un service lent ferait couper la fonction)', `    if (deps.maintenant() - debut > DUREE_MAX_APPEL_MS) break;   // trop long : ce qui reste sera fait à l'appel suivant (« restants »)
`, ``],
  ['F', 'la limite de durée est de 100 000 secondes', `export const DUREE_MAX_APPEL_MS = 100_000; `, `export const DUREE_MAX_APPEL_MS = 100_000_000; `],
  ['F', 'le journal contient une position', `total=\${voulus.length}\${limite ? ' limite' : ''}\``, `total=\${voulus.length} \${lot.length ? lot[0].de.lat : ''}\${limite ? ' limite' : ''}\``],
  // ── Le fichier SQL 22 ──
  ['S', 'les employés peuvent aussi écrire', `grant select on public.parcours_segments to authenticated;`, `grant select, insert, update, delete on public.parcours_segments to authenticated;`],
  ['S', 'les employés ne peuvent plus lire', `grant select on public.parcours_segments to authenticated;`, ``],
  ['S', 'les droits donnés par défaut ne sont pas retirés', `revoke all on public.parcours_segments from public, anon, authenticated;`, ``],
  ['S', 'les règles d\'accès par ligne ne sont pas activées', `alter table public.parcours_segments enable row level security;`, ``],
  ['S', 'un employé désactivé peut lire', `using ((select public.est_actif()));`, `using (true);`],
  ['S', 'la règle n\'est pas remise à neuf à chaque exécution', `drop policy if exists parcours_segments_lecture on public.parcours_segments;\n`, ``],
  ['S', 'un tronçon ne disparaît pas avec son arrêt de départ', `de_arret_id   uuid not null references public.stops(id) on delete cascade,`, `de_arret_id   uuid not null references public.stops(id),`],
  ['S', 'un tronçon ne disparaît pas avec son arrêt d\'arrivée', `vers_arret_id uuid not null references public.stops(id) on delete cascade,`, `vers_arret_id uuid not null references public.stops(id),`],
  ['S', 'le statut « sans_route » n\'existe plus', `check (statut in ('ok', 'sans_route'))`, `check (statut in ('ok'))`],
  ['S', 'n\'importe quel statut est permis', `check (statut in ('ok', 'sans_route'))`, `check (true)`],
  ['S', 'un tronçon d\'un client vers lui-même est permis', `check (de_arret_id <> vers_arret_id),`, ``],
  ['S', 'un tronçon « ok » d\'un seul point est permis', `jsonb_array_length(trace) >= 2`, `jsonb_array_length(trace) >= 1`],
  ['S', 'un tronçon « ok » sans ligne est permis', `check (statut <> 'ok' or (trace is not null and jsonb_typeof(trace) = 'array' and jsonb_array_length(trace) >= 2))`, `check (statut <> 'ok' or true)`],
  ['S', 'un tronçon « sans_route » doit avoir une ligne', `check (statut <> 'ok' or (trace is not null`, `check (statut <> 'sans_route' or (trace is not null`],
  ['S', 'plus de clé primaire (doublons permis, upsert impossible)', `  primary key (de_arret_id, vers_arret_id),\n`, ``],
  ['S', 'la position d\'arrivée peut manquer', `vers_lon      double precision not null,`, `vers_lon      double precision,`],
  ['S', 'le temps réel n\'est pas branché', `alter publication supabase_realtime add table public.parcours_segments;`, `null;`],
  ['S', 'le contrôle « fichier 03 exécuté » est retiré', `if to_regprocedure('public.est_actif()') is null then`, `if false then`],
];

let detectees = 0, essayees = 0; const rapport = [];
try {
  for (const [i, [f, nom, de, vers]] of M.entries()) {
    if (ONLY && !ONLY.includes(i + 1)) continue;
    if (i % SERIE_N !== SERIE_K) continue;
    essayees++;
    const src = SOURCES[f];
    const n = src.split(de).length - 1;
    if (n !== 1) { rapport.push(`?? ${i + 1}. [${f}] TEXTE ${n === 0 ? 'INTROUVABLE' : 'EN ' + n + ' EXEMPLAIRES'} : ${nom}`); console.log(rapport[rapport.length - 1]); continue; }
    if (src.replace(de, () => vers) === src) { rapport.push(`?? ${i + 1}. [${f}] MUTATION SANS EFFET : ${nom}`); console.log(rapport[rapport.length - 1]); continue; }
    fs.writeFileSync(TMP(f), src.replace(de, () => vers));
    let sortie = '';
    try { sortie = execFileSync('node', ['test-etape-18b.mjs'], { cwd: TESTS, env: { ...process.env, [VARIABLES[f]]: TMP(f) }, encoding: 'utf8', timeout: 240000, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { sortie = String(e.stdout || '') + String(e.stderr || ''); }
    const m = sortie.match(/RÉSULTAT : (\d+) réussis, (\d+) échoués/);
    const ko = m ? Number(m[2]) : -1;
    const vu = ko !== 0;
    if (vu) detectees++;
    rapport.push(`${vu ? 'OK  détectée' : 'RATÉE      '} ${i + 1}. [${f}] ${nom}${m ? ' (' + ko + ' échec(s))' : ' (plantage)'}`);
    console.log(rapport[rapport.length - 1]);
  }
} finally {
  for (const f of ['S', 'F']) fs.rmSync(TMP(f), { force: true });
}
console.log(`\n${detectees} erreurs volontaires détectées sur ${essayees}`);
const intacts = ['S', 'F'].every((f) => fs.readFileSync(FICHIERS[f], 'utf8') === SOURCES[f]);
console.log(intacts ? 'Les vrais fichiers (SQL 22 et fonction) sont intacts.' : '⚠ UN VRAI FICHIER A CHANGÉ !');
