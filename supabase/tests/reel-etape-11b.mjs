// Étape 11 (2e partie) — ESSAIS DE COMPORTEMENT SUR LA VRAIE BASE : quarts, passes, équipage, transferts, export de paie.
// Ne fait PAS partie de « npm test ». Même précautions que reel-etape-11.mjs :
//   • le mot de passe est tapé masqué, jamais affiché ni enregistré ; aucun jeton ni NIP n'est affiché ;
//   • les comptes d'essai sont « ZZTEST Gamma / Delta / Hector » (téléphones 819 555 0193 à 0195), et « ZZTEST Iota » (0196) avec --cron ;
//   • à la fin, exécuter 10-nettoyage-comptes-zztest.sql dans Supabase (SQL Editor) pour tout effacer.
//
//   node reel-etape-11b.mjs           essais de comportement (rapide, environ 1 minute)
//   node reel-etape-11b.mjs --cron    + essai de la vraie tâche automatique pg_cron (dure jusqu'à 11 minutes ;
//                                       abaisse TEMPORAIREMENT le délai maximal d'un quart, puis le remet comme avant)
import fs from 'fs';
import readline from 'readline/promises';
import { randomUUID as uuid } from 'crypto';
import { fileURLToPath } from 'url';

const config = fs.readFileSync(fileURLToPath(new URL('../../www/js/config.js', import.meta.url)), 'utf8');
const URL_PROJET = config.match(/SUPA_URL\s*=\s*'([^']+)'/)[1];
const CLE_PUBLIQUE = config.match(/SUPA_KEY\s*=\s*'([^']+)'/)[1];
const AVEC_CRON = process.argv.includes('--cron');
const DOMAINE = 'tel.entretienlapointe.ca';

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const minutes = (n) => new Date(Date.now() + n * 60000).toISOString();   // n négatif = dans le passé

async function http(methode, chemin, { jeton, corps, entetes } = {}) {
  const h = { apikey: CLE_PUBLIQUE, 'Content-Type': 'application/json', Authorization: 'Bearer ' + (jeton || CLE_PUBLIQUE), ...entetes };
  let r;
  try { r = await fetch(URL_PROJET + chemin, { method: methode, headers: h, body: corps === undefined ? undefined : JSON.stringify(corps) }); }
  catch (e) { return { statut: 0, json: null }; }
  let json = null; try { json = await r.json(); } catch { /* vide */ }
  return { statut: r.status, json };
}
const edge = (jeton, corps) => http('POST', '/functions/v1/admin-employes', { jeton, corps });
const rpc = (jeton, nom, args = {}) => http('POST', '/rest/v1/rpc/' + nom, { jeton, corps: args });
const rest = (jeton, chemin, methode = 'GET', corps) => http(methode, '/rest/v1/' + chemin, { jeton, corps, entetes: methode === 'GET' ? {} : { Prefer: 'return=representation' } });
const detail = (r) => `HTTP ${r.statut}${r.json?.message ? ' ' + String(r.json.message).slice(0, 60) : r.json?.erreur ? ' ' + r.json.erreur : ''}`;
const refuse = (r) => r.statut >= 400;
const message = (r) => r.json?.message ?? r.json?.erreur ?? '';
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
function arret(raison) {
  log('\n>>> ARRÊT : ' + raison);
  console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués (arrêt anticipé) =====`);
  log('N\'oublie pas d\'exécuter 10-nettoyage-comptes-zztest.sql dans Supabase pour effacer les comptes d\'essai.');
  process.exit(1);
}

// =====================================================================
log(`Projet : ${URL_PROJET}${AVEC_CRON ? '   (avec l\'essai de la tâche automatique)' : ''}`);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const courrielAdmin = (await rl.question('Courriel du compte administrateur : ')).trim();
rl.close();
const A = await connexion(courrielAdmin, await lireSecret('Mot de passe (masqué, ne s\'affiche pas) : '));
if (!A) arret('connexion de l\'administrateur impossible');
const admins = (await rpc(A, 'admin_lister_utilisateurs')).json ?? [];
if (admins.some((u) => (u.nom ?? '').startsWith('ZZTEST'))) arret('restes d\'un essai précédent : exécute d\'abord 10-nettoyage-comptes-zztest.sql');
pass('connexion de l\'administrateur, aucun reste d\'essai précédent');

// ----- Ce qu'on utilise dans la base réelle -----
const routes = (await rest(A, 'routes?select=id,nom,actif')).json ?? [];
const stopsTous = (await rest(A, 'stops?select=id,route_id,actif')).json ?? [];
const route = routes.filter((r) => r.actif).map((r) => ({ ...r, arrets: stopsTous.filter((s) => s.route_id === r.id && s.actif) })).sort((a, b) => b.arrets.length - a.arrets.length)[0];
const equipes = ((await rest(A, 'equipes?select=id,nom,actif')).json ?? []).filter((e) => e.actif);
if (!route || route.arrets.length < 4) arret('il faut une route active avec au moins 4 arrêts');
if (equipes.length < 2) arret(`il faut au moins 2 véhicules (équipes) actifs ; il y en a ${equipes.length}. Dis-le-moi : je te donnerai le SQL pour en ajouter.`);
const [cam1, cam2] = equipes;
const stops = route.arrets.map((s) => s.id);
log(`Route d'essai : « ${route.nom} » (${stops.length} arrêts) ; véhicules : « ${cam1.nom} » et « ${cam2.nom} »`);

// ----- Les employés d'essai -----
const employes = {};
async function nouvelEmploye(cle, nom, tel) {
  const r = await edge(A, { action: 'creer', nom, telephone: tel });
  if (r.statut !== 200) arret(`création de ${nom} impossible (${detail(r)})`);
  const jeton = await connexion(`${tel}@${DOMAINE}`, r.json.nip);
  if (!jeton) arret(`connexion de ${nom} impossible`);
  employes[cle] = { id: r.json.employe.id, nom, jeton };
}
await nouvelEmploye('G', 'ZZTEST Gamma', '8195550193');
await nouvelEmploye('D', 'ZZTEST Delta', '8195550194');
await nouvelEmploye('H', 'ZZTEST Hector', '8195550195');
const { G, D, H } = employes;
pass('3 employés d\'essai créés et connectés (Gamma = chauffeur 1, Delta = passager, Hector = chauffeur 2)');

// =====================================================================
log('\n=== 1. « JE COMMENCE » / « JE TERMINE » ===');
const t0 = -90;   // tout est placé dans le passé récent, avec des heures réalistes
const quart1 = uuid();
let r = await rpc(G.jeton, 'quart_commencer', { p_id: quart1, p_moment: minutes(t0), p_lat: 46.55, p_lon: -72.75 });
eq('Gamma « Je commence » (il y a 90 min)', r.json?.statut, 'commence');
r = await rpc(G.jeton, 'quart_commencer', { p_id: quart1, p_moment: minutes(t0), p_lat: 46.55, p_lon: -72.75 });
eq('renvoyer le même geste (hors réseau) : pas de doublon', r.json?.statut, 'deja_enregistre');
r = await rpc(G.jeton, 'quart_commencer', { p_id: uuid(), p_moment: minutes(t0 + 1) });
eq('un 2e « Je commence » pendant un quart ouvert : refusé proprement', r.json?.statut, 'deja_en_quart');
r = await rpc(D.jeton, 'quart_terminer', { p_quart_id: quart1 });
vrai('Delta ne peut pas terminer le quart de Gamma', refuse(r), detail(r));
r = await rpc(G.jeton, 'quart_terminer', { p_quart_id: quart1, p_moment: minutes(t0 + 10) });
eq('Gamma « Je termine »', r.json?.statut, 'termine');
r = await rpc(G.jeton, 'quart_terminer', { p_quart_id: quart1, p_moment: minutes(t0 + 10) });
eq('renvoyer le même geste : pas de doublon', r.json?.statut, 'deja_termine');
r = await rpc(G.jeton, 'quart_commencer', { p_id: uuid(), p_moment: minutes(t0 + 5) });
eq('un quart qui commence PENDANT un quart déjà terminé : refusé proprement', r.json?.statut, 'deja_en_quart');
r = await rpc(G.jeton, 'quart_commencer', { p_id: uuid(), p_moment: minutes(t0 - 5) });
eq('un quart qui commence AVANT un quart existant et resterait ouvert (chevauchement) : refusé', r.json?.statut, 'chevauchement');
r = await rpc(G.jeton, 'quart_commencer', { p_id: uuid(), p_moment: minutes(-60 * 24 * 5) });
vrai('un geste vieux de 5 jours : refusé', refuse(r) && /trop_ancien/.test(message(r)), detail(r));

// =====================================================================
log('\n=== 2. DÉBUTER UNE PASSE, ARRÊTS, POSITION ===');
const passe1 = uuid();
r = await rpc(G.jeton, 'debuter_passe', { p_id: passe1, p_route_id: route.id, p_equipe_id: cam1.id, p_moment: minutes(t0 + 20), p_lat: 46.55, p_lon: -72.75,
  p_equipage: [{ utilisateur_id: D.id, cle_client: uuid() }] });
eq('Gamma débute la passe avec Delta à bord', [r.json?.statut, r.json?.nb_arrets_total, r.json?.equipage?.[0]?.statut], ['debutee', stops.length, 'ajoute']);
const numero1 = r.json?.numero;
vrai('un numéro de passe est attribué (par route)', Number.isInteger(numero1) && numero1 >= 1, JSON.stringify(numero1));
r = await rpc(G.jeton, 'debuter_passe', { p_id: passe1, p_route_id: route.id, p_equipe_id: cam1.id });
eq('renvoyer « Débuter la passe » : pas de deuxième passe', r.json?.statut, 'deja_enregistre');
r = await rest(A, `quarts?select=id,debut_source,a_valider,raison_a_valider,fin&utilisateur_id=eq.${G.id}&order=debut`);
eq('les quarts de Gamma : le 1er (manuel, terminé) + celui ouvert par la passe, « à valider »', [r.json?.length, r.json?.[1]?.debut_source, r.json?.[1]?.a_valider, r.json?.[1]?.raison_a_valider], [2, 'passe', true, 'ouvert_par_passe']);
r = await rest(A, `quarts?select=id,debut_source,a_valider,raison_a_valider&utilisateur_id=eq.${D.id}`);
eq('le quart de Delta (passager) s\'est ouvert automatiquement, « à valider »', [r.json?.length, r.json?.[0]?.debut_source, r.json?.[0]?.a_valider, r.json?.[0]?.raison_a_valider], [1, 'equipage', true, 'ouvert_par_equipage']);

r = await rpc(G.jeton, 'completer_arret', { p_passe_id: passe1, p_stop_id: stops[0], p_moment: minutes(t0 + 25), p_lat: 46.55, p_lon: -72.75 });
eq('arrêt n° 1 complété : pourcentage calculé', [r.json?.statut, r.json?.faits, r.json?.total, r.json?.pourcentage], ['complete', 1, stops.length, Math.floor(100 / stops.length)]);
r = await rpc(G.jeton, 'completer_arret', { p_passe_id: passe1, p_stop_id: stops[0], p_moment: minutes(t0 + 25) });
eq('renvoyer le même arrêt : pas de doublon', [r.json?.statut, r.json?.faits], ['deja_complete', 1]);
r = await rpc(G.jeton, 'completer_arret', { p_passe_id: passe1, p_stop_id: stops[1], p_moment: minutes(t0 + 30) });
eq('arrêt n° 2 complété', [r.json?.statut, r.json?.faits], ['complete', 2]);
r = await rpc(D.jeton, 'completer_arret', { p_passe_id: passe1, p_stop_id: stops[2] });
vrai('Delta (passager) ne peut pas compléter un arrêt', refuse(r) && /non_autorise/.test(message(r)), detail(r));
r = await rpc(H.jeton, 'completer_arret', { p_passe_id: passe1, p_stop_id: stops[2] });
vrai('Hector (autre chauffeur) ne peut pas compléter un arrêt de la passe de Gamma', refuse(r) && /non_autorise/.test(message(r)), detail(r));
r = await rpc(G.jeton, 'completer_arret', { p_passe_id: passe1, p_stop_id: randomStop() });
vrai('un arrêt qui n\'est pas sur la route : refusé', refuse(r) && /arret_hors_route/.test(message(r)), detail(r));
function randomStop() { return uuid(); }
r = await rpc(G.jeton, 'completer_arret', { p_passe_id: passe1, p_stop_id: stops[2] });   // maintenant
eq('arrêt n° 3 complété maintenant', [r.json?.statut, r.json?.faits], ['complete', 3]);
r = await rpc(G.jeton, 'annuler_arret', { p_passe_id: passe1, p_stop_id: stops[2] });
eq('annuler l\'arrêt n° 3 (moins de 10 minutes) : accepté', [r.json?.statut, r.json?.faits], ['annule', 2]);
r = await rpc(G.jeton, 'annuler_arret', { p_passe_id: passe1, p_stop_id: stops[0] });
vrai('annuler l\'arrêt n° 1 (fait il y a plus de 10 minutes) : refusé pour le chauffeur', refuse(r) && /delai_depasse/.test(message(r)), detail(r));
r = await rpc(A, 'annuler_arret', { p_passe_id: passe1, p_stop_id: stops[0] });
eq('… mais l\'administrateur peut l\'annuler, sans limite de temps', [r.json?.statut, r.json?.faits], ['annule', 1]);
r = await rpc(G.jeton, 'completer_arret', { p_passe_id: passe1, p_stop_id: stops[0], p_moment: minutes(t0 + 25) });
eq('… et le chauffeur le refait', [r.json?.statut, r.json?.faits], ['complete', 2]);

r = await rpc(G.jeton, 'envoyer_position', { p_passe_id: passe1, p_lat: 46.56, p_lon: -72.76, p_precision: 8 });
eq('Gamma (chauffeur) envoie la position du véhicule', r.json?.statut, 'ok');
r = await rpc(D.jeton, 'envoyer_position', { p_passe_id: passe1, p_lat: 46.57, p_lon: -72.77 });
vrai('Delta (passager) ne peut PAS envoyer de position (un véhicule = un seul point)', refuse(r) && /non_autorise/.test(message(r)), detail(r));
r = await rpc(G.jeton, 'envoyer_position', { p_passe_id: passe1, p_lat: 91, p_lon: 0 });
vrai('une position impossible (latitude 91) : refusée', refuse(r) && /position_invalide/.test(message(r)), detail(r));
r = await rpc(G.jeton, 'envoyer_position', { p_passe_id: passe1, p_lat: 46.50, p_lon: -72.70, p_moment: minutes(-30) });
r = await rest(A, `positions?select=lat,lon&passe_id=eq.${passe1}`);
eq('une position ancienne (envoi hors réseau) n\'écrase pas la plus récente', [r.json?.length, r.json?.[0]?.lat], [1, 46.56]);

// =====================================================================
log('\n=== 3. CE QUE VOIT UN AUTRE EMPLOYÉ (Hector) ===');
r = await rest(H.jeton, 'passes?select=id,pourcentage,statut');
eq('Hector voit la passe de Gamma, avec son pourcentage', [r.json?.length, r.json?.[0]?.id, r.json?.[0]?.pourcentage], [1, passe1, Math.floor(200 / stops.length)]);
r = await rest(H.jeton, 'positions?select=passe_id,lat');
eq('Hector voit la position du véhicule (un seul point)', [r.json?.length, r.json?.[0]?.passe_id], [1, passe1]);
r = await rest(H.jeton, 'equipage_periodes?select=passe_id,utilisateur_id,role');
eq('Hector voit l\'équipage complet du véhicule (Gamma + Delta)', (r.json ?? []).map((p) => p.utilisateur_id).sort(), [G.id, D.id].sort());
r = await rest(H.jeton, 'quarts?select=id,utilisateur_id');
eq('Hector ne voit AUCUN quart de ses collègues (heures privées)', r.json, []);
for (const t of ['equipage_journal', 'journal_modifications', 'reglages']) {
  r = await rest(H.jeton, `${t}?select=*`);
  vrai(`Hector ne voit rien dans « ${t} »`, refuse(r) || (Array.isArray(r.json) && r.json.length === 0), detail(r));
}
r = await rest(H.jeton, `passe_arrets?select=stop_id&passe_id=eq.${passe1}`);
eq('Hector voit quels arrêts ont été faits (avancement partagé)', r.json?.length, 2);
r = await rest(H.jeton, 'problemes', 'POST', { stop_id: stops[3], note: 'ZZTEST barrière fermée' });
vrai('Hector peut signaler un problème (à son nom)', r.statut === 201 && r.json?.[0]?.utilisateur_id === H.id, detail(r));
r = await rest(H.jeton, 'problemes', 'POST', { stop_id: stops[3], note: 'faux', utilisateur_id: G.id });
vrai('… mais pas au nom de quelqu\'un d\'autre', refuse(r), detail(r));
r = await rpc(H.jeton, 'admin_export_paie', { p_debut: minutes(-600), p_fin: minutes(60) });
vrai('Hector ne peut pas exporter la paie', refuse(r), detail(r));
r = await rpc(H.jeton, 'admin_valider_quart', { p_quart_id: quart1 });
vrai('Hector ne peut pas valider un quart', refuse(r), detail(r));

// =====================================================================
log('\n=== 4. ÉQUIPAGE : CONFLIT, TRANSFERT, RETRAIT, ANNULATION ===');
const passe2 = uuid();
r = await rpc(H.jeton, 'debuter_passe', { p_id: passe2, p_route_id: route.id, p_equipe_id: cam2.id, p_moment: minutes(t0 + 35), p_lat: 46.6, p_lon: -72.8 });
eq('Hector débute sa passe (2e véhicule, même route) : numéro suivant', [r.json?.statut, r.json?.numero], ['debutee', numero1 + 1]);

const cleTransfert = uuid();
r = await rpc(H.jeton, 'equipage_ajouter', { p_cle_client: cleTransfert, p_passe_id: passe2, p_utilisateur_id: D.id, p_moment: minutes(t0 + 40) });
eq('Hector ajoute Delta, déjà à bord du véhicule 1 : AVERTISSEMENT qui nomme le véhicule', [r.json?.statut, r.json?.avertissements?.[0]?.type, r.json?.avertissements?.[0]?.vehicule], ['avertissement', 'conflit_vehicule', cam1.nom]);
r = await rest(A, `equipage_periodes?select=passe_id&utilisateur_id=eq.${D.id}&fin=is.null`);
eq('… l\'avertissement n\'a rien changé : Delta est toujours dans le véhicule 1 seulement', (r.json ?? []).map((p) => p.passe_id), [passe1]);
r = await rpc(H.jeton, 'equipage_ajouter', { p_cle_client: cleTransfert, p_passe_id: passe2, p_utilisateur_id: D.id, p_moment: minutes(t0 + 40), p_forcer: true });
eq('Hector confirme : TRANSFERT (de la passe de Gamma)', [r.json?.statut, !!r.json?.transfert_id, r.json?.de_passe_id], ['transfere', true, passe1]);
const transfertId = r.json?.transfert_id;
r = await rpc(H.jeton, 'equipage_ajouter', { p_cle_client: cleTransfert, p_passe_id: passe2, p_utilisateur_id: D.id, p_moment: minutes(t0 + 40), p_forcer: true });
eq('renvoyer le même geste (hors réseau) : sans doublon, marqué « rejoué »', [r.json?.statut, r.json?.rejoue], ['transfere', true]);
r = await rest(A, `equipage_periodes?select=passe_id,debut,fin,transfert_id&utilisateur_id=eq.${D.id}&order=debut`);
const [sortie, entree] = r.json ?? [];
eq('Delta : exactement 2 périodes (sortie de l\'ancien véhicule, entrée dans le nouveau), pas de doublon', r.json?.length, 2);
eq('… MÊME HEURE de sortie et d\'entrée (sans trou ni chevauchement), même identifiant de transfert', [sortie?.passe_id, entree?.passe_id, sortie?.fin === entree?.debut, !!sortie?.transfert_id && sortie?.transfert_id === entree?.transfert_id], [passe1, passe2, true, true]);
r = await rpc(G.jeton, 'equipage_retirer', { p_cle_client: uuid(), p_passe_id: passe1, p_utilisateur_id: D.id });
eq('Gamma ne peut plus retirer Delta (il n\'est plus dans son véhicule)', r.json?.statut, 'pas_a_bord');
r = await rpc(G.jeton, 'equipage_retirer', { p_cle_client: uuid(), p_passe_id: passe2, p_utilisateur_id: D.id });
vrai('Gamma ne peut pas modifier l\'équipage du véhicule d\'Hector', refuse(r) && /non_autorise/.test(message(r)), detail(r));
r = await rpc(H.jeton, 'equipage_retirer', { p_cle_client: uuid(), p_passe_id: passe2, p_utilisateur_id: H.id });
vrai('un chauffeur ne peut pas être retiré de SON véhicule', refuse(r) && /chauffeur_ne_peut_etre_retire/.test(message(r)), detail(r));
r = await rpc(H.jeton, 'equipage_ajouter', { p_cle_client: uuid(), p_passe_id: passe2, p_utilisateur_id: G.id });
eq('un chauffeur d\'une passe en cours ne peut pas être ajouté à un autre véhicule (refus, avec le nom du véhicule)', [r.json?.statut, r.json?.raison, r.json?.vehicule], ['refuse', 'chauffeur_ailleurs', cam1.nom]);
r = await rpc(H.jeton, 'equipage_retirer', { p_cle_client: uuid(), p_passe_id: passe2, p_utilisateur_id: D.id });
eq('Hector retire Delta (plus de 2 minutes après son entrée) : retrait normal, conservé dans l\'historique', r.json?.statut, 'retire');
r = await rpc(A, 'admin_annuler_transfert', { p_transfert_id: transfertId });
eq('l\'administrateur annule ce transfert : Delta reste dans le véhicule 1', [r.json?.statut, r.json?.reste_dans_passe_id], ['transfert_annule', passe1]);
r = await rest(A, `equipage_periodes?select=passe_id,fin&utilisateur_id=eq.${D.id}`);
eq('… l\'entrée dans le véhicule 2 a disparu ; il ne reste que sa période dans le véhicule 1', (r.json ?? []).map((p) => p.passe_id), [passe1]);
r = await rpc(G.jeton, 'equipage_ajouter', { p_cle_client: uuid(), p_passe_id: passe1, p_utilisateur_id: D.id });
eq('Gamma ajoute Delta maintenant', r.json?.statut, 'ajoute');
r = await rpc(G.jeton, 'equipage_retirer', { p_cle_client: uuid(), p_passe_id: passe1, p_utilisateur_id: D.id });
eq('… puis clique « Annuler » tout de suite (moins de 2 minutes) : l\'erreur est effacée, pas une trace de quelques secondes', r.json?.statut, 'annule');

log('   « Débuter la passe » archive la précédente :');
const passe1b = uuid();
r = await rpc(G.jeton, 'debuter_passe', { p_id: passe1b, p_route_id: route.id, p_equipe_id: cam1.id, p_moment: minutes(-2), p_lat: 46.55, p_lon: -72.75 });
eq('Gamma débute une nouvelle passe : l\'ancienne est archivée', [r.json?.statut, r.json?.passes_archivees], ['debutee', [passe1]]);
eq('… la nouvelle passe reçoit le numéro suivant de la route', r.json?.numero, numero1 + 2);
r = await rest(A, `passes?select=statut,fin_type,nb_arrets_faits&id=eq.${passe1}`);
eq('… l\'ancienne passe est CONSERVÉE avec son historique (terminée « remplacée », 2 arrêts faits), pas effacée', [r.json?.[0]?.statut, r.json?.[0]?.fin_type, r.json?.[0]?.nb_arrets_faits], ['terminee', 'remplacee', 2]);
r = await rest(A, `passe_arrets?select=stop_id&passe_id=eq.${passe1}`);
eq('… et ses arrêts complétés sont toujours là', r.json?.length, 2);
r = await rest(A, `passe_arrets?select=stop_id&passe_id=eq.${passe1b}`);
eq('… la nouvelle passe repart à zéro', r.json?.length, 0);

// =====================================================================
log('\n=== 5. EXPORT DE PAIE ET VALIDATION ===');
const periode = { p_debut: minutes(-60 * 4), p_fin: minutes(60) };
r = await rpc(A, 'admin_export_paie', periode);
eq('l\'export est REFUSÉ tant qu\'un quart est « à valider »', [r.json?.statut, r.json?.raison], ['refuse', 'quarts_a_valider']);
vrai('… le refus ne renvoie AUCUNE heure', !('employes' in (r.json ?? {})), JSON.stringify(Object.keys(r.json ?? {})));
vrai('… il nomme les employés concernés', /ZZTEST/.test(JSON.stringify(r.json?.quarts ?? [])), '');
r = await rpc(G.jeton, 'terminer_passe', { p_passe_id: passe1b });
eq('Gamma termine sa passe', r.json?.statut, 'terminee');
r = await rpc(H.jeton, 'terminer_passe', { p_passe_id: passe2 });
eq('Hector termine sa passe', r.json?.statut, 'terminee');
async function quartOuvert(e) { return ((await rest(e.jeton, 'quarts?select=id&fin=is.null')).json ?? [])[0]?.id; }
for (const e of [G, D, H]) {
  const q = await quartOuvert(e);
  r = await rpc(e.jeton, 'quart_terminer', { p_quart_id: q });
  eq(`${e.nom} « Je termine » son quart`, r.json?.statut, 'termine');
}
r = await rpc(A, 'admin_export_paie', periode);
eq('tous les quarts sont fermés mais encore « à valider » : refusé', [r.json?.statut, r.json?.raison], ['refuse', 'quarts_a_valider']);
const aValider = (await rest(A, 'quarts?select=id,utilisateur_id&a_valider=eq.true')).json ?? [];
vrai('la liste « À valider » contient les quarts d\'essai (ouverts par la passe ou par l\'équipage)', aValider.length >= 3, String(aValider.length));
for (const q of aValider) {
  r = await rpc(A, 'admin_valider_quart', { p_quart_id: q.id, p_note: 'ZZTEST' });
  if (r.json?.statut !== 'valide') fail('validation d\'un quart', detail(r));
}
pass(`${aValider.length} quart(s) validé(s) par l'administrateur`);
r = await rpc(A, 'admin_export_paie', periode);
eq('après validation : l\'export réussit', r.json?.statut, 'ok');
const lignes = Object.fromEntries((r.json?.employes ?? []).map((e) => [e.nom, e]));
eq('… il liste les 3 employés d\'essai', Object.keys(lignes).sort(), ['ZZTEST Delta', 'ZZTEST Gamma', 'ZZTEST Hector']);
vrai('… avec des heures positives pour chacun', Object.values(lignes).every((e) => e.heures > 0), JSON.stringify(Object.values(lignes).map((e) => e.heures)));
vrai('… Gamma : heures réparties par véhicule et par route', (lignes['ZZTEST Gamma']?.repartition ?? []).some((x) => x.vehicule === cam1.nom && x.route === route.nom), JSON.stringify(lignes['ZZTEST Gamma']?.repartition));
r = await rpc(A, 'admin_export_paie', { p_debut: minutes(-60 * 4), p_fin: minutes(-60 * 3.9) });
eq('une période sans aucun quart d\'essai : export vide, sans erreur', [r.json?.statut, (r.json?.employes ?? []).filter((e) => /ZZTEST/.test(e.nom)).length], ['ok', 0]);
r = await rpc(A, 'admin_export_paie', { p_debut: minutes(60), p_fin: minutes(0) });
vrai('une période à l\'envers : refusée', refuse(r) && /periode_invalide/.test(message(r)), detail(r));

// =====================================================================
if (AVEC_CRON) {
  log('\n=== 6. LA VRAIE TÂCHE AUTOMATIQUE (pg_cron) : fermeture d\'un quart oublié ===');
  const lecture = await rest(A, 'reglages?select=cle,valeur&cle=eq.duree_max_quart_heures');
  const original = lecture.json?.[0]?.valeur;
  if (original === undefined) { fail('lecture du réglage « duree_max_quart_heures »', detail(lecture)); }
  else {
    await nouvelEmploye('I', 'ZZTEST Iota', '8195550196');   // créé AVANT de toucher au réglage : un échec ici ne laisse rien à remettre
    const restaurer = async () => { const x = await rest(A, 'reglages?cle=eq.duree_max_quart_heures', 'PATCH', { valeur: original }); return x.statut < 300; };
    process.on('SIGINT', async () => { log('\nInterruption : remise du réglage…'); log((await restaurer()) ? 'Réglage remis comme avant.' : 'ATTENTION : remets « duree_max_quart_heures » à ' + JSON.stringify(original) + ' dans la table reglages.'); process.exit(130); });
    try {
      const maj = await rest(A, 'reglages?cle=eq.duree_max_quart_heures', 'PATCH', { valeur: 0.05 });
      if (maj.statut >= 300 || (Array.isArray(maj.json) && maj.json.length === 0)) { fail('l\'administrateur ne peut pas modifier les réglages (essai impossible)', detail(maj)); }
      else {
        log(`   Délai maximal d'un quart abaissé à 3 minutes (valeur d'origine : ${JSON.stringify(original)}, sera remise).`);
        const qi = uuid();
        r = await rpc(employes.I.jeton, 'quart_commencer', { p_id: qi });
        eq('Iota « Je commence » et ne termine jamais (oubli)', r.json?.statut, 'commence');
        log('   Attente de la tâche automatique (toutes les 5 minutes)… jusqu\'à 11 minutes.');
        let ferme = null;
        for (let i = 0; i < 22 && !ferme; i++) {
          await new Promise((res) => setTimeout(res, 30000));
          const q = (await rest(A, `quarts?select=fin,fin_source,fin_estimee,a_valider,raison_a_valider,debut&id=eq.${qi}`)).json?.[0];
          if (q?.fin) ferme = q; else process.stdout.write(`   … ${(i + 1) * 30} s\n`);
        }
        if (!ferme) fail('la tâche automatique a fermé le quart oublié', 'toujours ouvert après 11 minutes : la tâche pg_cron ne tourne pas ?');
        else {
          pass('la tâche automatique pg_cron a fermé le quart oublié (vraie base, vraie tâche)');
          eq('… fin ESTIMÉE, source « délai maximal », marqué « à valider » (raison : fin estimée)', [ferme.fin_source, ferme.fin_estimee, ferme.a_valider, ferme.raison_a_valider], ['delai_max', true, true, 'fin_estimee']);
          r = await rpc(A, 'admin_export_paie', { p_debut: minutes(-60), p_fin: minutes(60) });
          eq('l\'export de paie est refusé à cause de cette fin estimée (à confirmer avec Joé : voir cahier)', [r.json?.statut, r.json?.raison], ['refuse', 'quarts_a_valider']);
          r = await rpc(A, 'admin_valider_quart', { p_quart_id: qi, p_note: 'ZZTEST' });
          eq('l\'administrateur valide ce quart', r.json?.statut, 'valide');
        }
      }
    } finally {
      log((await restaurer()) ? '   Réglage « duree_max_quart_heures » remis comme avant.' : '   ATTENTION : remets « duree_max_quart_heures » à ' + JSON.stringify(original) + ' dans la table reglages.');
    }
    const verifie = (await rest(A, 'reglages?select=valeur&cle=eq.duree_max_quart_heures')).json?.[0]?.valeur;
    eq('le réglage a bien retrouvé sa valeur d\'origine', verifie, original);
  }
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
log('Reste à faire : exécuter 10-nettoyage-comptes-zztest.sql dans Supabase (SQL Editor) pour effacer les comptes et données d\'essai.');
process.exit(ko ? 1 : 0);
