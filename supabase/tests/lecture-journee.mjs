// LECTURE D'UNE JOURNÉE SUR LA VRAIE BASE — LECTURE SEULE : ce script ne modifie RIEN dans Supabase. Ne fait PAS partie de « npm test ».
//
// Pour voir ce que l'application a enregistré pour une personne pendant un essai sur téléphone (étapes 17 et 18) :
//   node lecture-journee.mjs                       aujourd'hui, pour « Ghislain » : les punchs (heures, position, précision), les passes, les arrêts faits, l'équipage,
//                                                  et la DERNIÈRE position connue du camion ;
//   node lecture-journee.mjs --nom=Luc             une autre personne (une partie du nom suffit) ;
//   node lecture-journee.mjs --jour=2026-09-22     un autre jour (AAAA-MM-JJ, heure d'ici) ;
//   node lecture-journee.mjs --surveiller          EN DIRECT, pendant la journée : regarde la position du camion de cette personne toutes les 10 secondes, note les trous
//                                                  (plus de 45 secondes sans nouvelle position : écran éteint, application fermée, plus de réseau…) et, à l'arrêt (Ctrl+C),
//                                                  donne le résumé : nombre de mises à jour, part du temps « à jour », liste des trous.
//   ⚠ La base ne garde QUE la dernière position de chaque passe (pas l'historique du trajet) : pour juger le suivi de toute une journée, lance --surveiller PENDANT la journée.
//   • le mot de passe de l'administrateur est tapé masqué, jamais affiché, jamais enregistré ; aucun jeton n'est affiché ;
//   • tout ce qui s'affiche est aussi gardé dans %TEMP%\lecture-journee-resultat.txt (ou surveillance-position-resultat.txt).
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline/promises';
import { fileURLToPath } from 'url';

const arg = (nom) => process.argv.find((a) => a.startsWith('--' + nom + '='))?.slice(nom.length + 3);
const SURVEILLER = process.argv.includes('--surveiller');
const NOM = arg('nom') ?? 'Ghislain';
const SIMULE = process.env.LECTURE_SIMULEE || '';   // (pour les essais du script lui-même : une fausse base locale, sans mot de passe)
const config = fs.readFileSync(fileURLToPath(new URL('../../www/js/config.js', import.meta.url)), 'utf8');
const URL_PROJET = SIMULE || config.match(/SUPA_URL\s*=\s*'([^']+)'/)[1];
const CLE_PUBLIQUE = config.match(/SUPA_KEY\s*=\s*'([^']+)'/)[1];
const INTERVALLE_MS = Number(process.env.SURVEILLANCE_INTERVALLE_MS) || 10000;
const TROU_S = 45;   // plus de 45 secondes sans nouvelle position = un trou (l'application en envoie une toutes les 10 secondes)

const FICHIER = path.join(os.tmpdir(), SURVEILLER ? 'surveillance-position-resultat.txt' : 'lecture-journee-resultat.txt');
try { fs.writeFileSync(FICHIER, ''); } catch { /* pas grave */ }
const propre = (s) => String(s).split('').map((c) => { const k = c.charCodeAt(0); return (k < 32 && k !== 9 && k !== 10) || k === 127 ? ' ' : c; }).join('');
const log = (s = '') => { const t = propre(s); console.log(t); try { fs.appendFileSync(FICHIER, t + '\n'); } catch { /* pas grave */ } };

async function http(methode, chemin, { jeton, corps } = {}) {
  const en = { apikey: CLE_PUBLIQUE, 'Content-Type': 'application/json', Authorization: 'Bearer ' + (jeton || CLE_PUBLIQUE) };
  let r;
  try { r = await fetch(URL_PROJET + chemin, { method: methode, headers: en, body: corps === undefined ? undefined : JSON.stringify(corps) }); }
  catch { return { statut: 0, json: null }; }
  let json = null; try { json = await r.json(); } catch { /* vide */ }
  return { statut: r.status, json };
}
let session = { jeton: null, renouvellement: null, le: 0 };
async function ouvrirSession(courriel, motDePasse) {
  const r = await http('POST', '/auth/v1/token?grant_type=password', { corps: { email: courriel, password: motDePasse } });
  if (r.statut === 200 && r.json?.access_token) { session = { jeton: r.json.access_token, renouvellement: r.json.refresh_token, le: Date.now() }; return true; }
  return false;
}
// Le jeton dure une heure : on le renouvelle sans redemander le mot de passe
async function renouveler() {
  if (Date.now() - session.le < 40 * 60000) return;
  const r = await http('POST', '/auth/v1/token?grant_type=refresh_token', { corps: { refresh_token: session.renouvellement } });
  if (r.statut === 200 && r.json?.access_token) session = { jeton: r.json.access_token, renouvellement: r.json.refresh_token, le: Date.now() };
}
const lire = async (chemin) => { await renouveler(); return http('GET', '/rest/v1/' + chemin, { jeton: session.jeton }); };
const rpc = async (nom) => { await renouveler(); return http('POST', '/rest/v1/rpc/' + nom, { jeton: session.jeton, corps: {} }); };

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
class Arret extends Error {}
function arret(raison) { throw new Arret(raison); }   // (attrapée tout en bas : on ne force jamais la sortie après des requêtes réseau, Windows plante parfois)

const sansAccents = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const heure = (t) => (t ? new Date(t).toLocaleTimeString('fr-CA', { hour12: false, hour: '2-digit', minute: '2-digit' }).replace(':', ' h ') : '—');
const dateHeure = (t) => (t ? new Date(t).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' }) + ' à ' + heure(t) : '—');
const duree = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0'); };
const dureeS = (s) => (s < 120 ? Math.round(s) + ' s' : Math.floor(s / 60) + ' min ' + String(Math.round(s % 60)).padStart(2, '0') + ' s');
const carte = (lat, lon) => (lat == null || lon == null ? '' : ` https://www.google.com/maps?q=${lat},${lon}`);
const precisionTexte = (p) => (p == null ? '(précision inconnue)' : `±${Math.round(p)} m`);

// =====================================================================
async function principal() {   // (le corps n'est pas ré-indenté : il est long et ne change rien)
log(`Projet : ${SIMULE ? '(fausse base d\'essai)' : URL_PROJET}   (${SURVEILLER ? 'surveillance en direct' : 'lecture d\'une journée'} — LECTURE SEULE)`);
if (SIMULE) {
  if (!(await ouvrirSession('essai@essai', 'essai'))) arret('la fausse base d\'essai ne répond pas');
} else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const courriel = (await rl.question('Courriel du compte administrateur : ')).trim();
  rl.close();   // fermée AVANT la saisie masquée du mot de passe
  if (!(await ouvrirSession(courriel, await lireSecret('Mot de passe (masqué, ne s\'affiche pas) : ')))) arret('connexion impossible (courriel ou mot de passe)');
}
const liste = await rpc('admin_lister_utilisateurs');
if (!Array.isArray(liste.json)) arret('la liste des employés est refusée : ce compte est-il bien l\'administrateur ? (' + (liste.json?.message ?? 'HTTP ' + liste.statut) + ')');
const trouves = liste.json.filter((u) => sansAccents(u.nom).includes(sansAccents(NOM)));
if (trouves.length !== 1) arret(trouves.length ? `plusieurs personnes correspondent à « ${NOM} » : ${trouves.map((u) => u.nom).join(', ')} (précise avec --nom=…)` : `personne ne s'appelle « ${NOM} ». Les noms : ${liste.json.map((u) => u.nom).join(', ')}`);
const P = trouves[0];
log(`Personne : ${P.nom}`);

// ─────────────────────────── MODE : SURVEILLER EN DIRECT ───────────────────────────
if (SURVEILLER) {
  log(`Je regarde la position du camion de ${P.nom} toutes les ${INTERVALLE_MS / 1000} secondes. Ctrl+C pour arrêter et voir le résumé.`);
  log('(Une position n\'existe que pendant une passe : la personne doit avoir débuté sa passe.)\n');
  const debutSurveillance = Date.now();
  let derniere = null;           // le dernier « maj_le » vu
  let nbMaj = 0;
  let tempsAJour = 0, tempsMesure = 0, dernierTour = debutSurveillance;
  const trous = [];              // { de, jusqua, s }
  let trouEnCours = null;
  let dernierAffichage = 0;
  let sansPosition = null;       // vrai tant qu'aucune position n'existe
  const tour = async () => {
    const maintenant = Date.now();
    const r = await lire(`positions?select=passe_id,lat,lon,precision_m,maj_le&chauffeur_id=eq.${P.id}&order=maj_le.desc&limit=1`);
    const ligne = Array.isArray(r.json) ? r.json[0] : null;
    if (!Array.isArray(r.json)) { if (dernierAffichage + 30000 < maintenant) { log(`${heure(maintenant)}  ⚠ la base ne répond pas (${r.statut || 'pas de réseau ici'})`); dernierAffichage = maintenant; } return; }
    if (!ligne) {
      if (sansPosition !== true) { log(`${heure(maintenant)}  — aucune position pour ${P.nom} (pas de passe en cours ?)`); sansPosition = true; }
      dernierTour = maintenant; return;
    }
    if (sansPosition === true) log(`${heure(maintenant)}  ✔ une position apparaît pour ${P.nom}`);
    sansPosition = false;
    const maj = Date.parse(ligne.maj_le);
    const age = (maintenant - maj) / 1000;
    if (maj !== derniere) { nbMaj++; derniere = maj; }
    tempsMesure += (maintenant - dernierTour) / 1000;
    if (age <= TROU_S) tempsAJour += (maintenant - dernierTour) / 1000;
    dernierTour = maintenant;
    if (age > TROU_S && !trouEnCours) { trouEnCours = { de: maj, jusqua: null }; log(`${heure(maintenant)}  ⚠ plus de nouvelle position depuis ${dureeS(age)} (dernière à ${heure(maj)})`); }
    if (age <= TROU_S && trouEnCours) { trouEnCours.jusqua = maj; trouEnCours.s = (maj - trouEnCours.de) / 1000; trous.push(trouEnCours); log(`${heure(maintenant)}  ✔ ça repart, après un trou de ${dureeS(trouEnCours.s)}`); trouEnCours = null; }
    if (maintenant - dernierAffichage >= 30000 && age <= TROU_S) { log(`${heure(maintenant)}  ✔ à jour (il y a ${dureeS(age)}) ${precisionTexte(ligne.precision_m)}${carte(ligne.lat, ligne.lon)}   [${nbMaj} mises à jour vues]`); dernierAffichage = maintenant; }
  };
  const resume = () => {
    const fin = Date.now();
    if (trouEnCours) { trouEnCours.jusqua = fin; trouEnCours.s = (fin - trouEnCours.de) / 1000; trous.push({ ...trouEnCours, enCours: true }); }
    log('\n===== RÉSUMÉ DE LA SURVEILLANCE =====');
    log(`Surveillé pendant ${duree(fin - debutSurveillance)} (de ${heure(debutSurveillance)} à ${heure(fin)}).`);
    log(`Nouvelles positions vues : ${nbMaj}  (une toutes les 10 secondes si tout va bien : ${duree(fin - debutSurveillance) } ≈ ${Math.round((fin - debutSurveillance) / 10000)} attendues pendant une passe).`);
    log(tempsMesure ? `Part du temps « à jour » (position de moins de ${TROU_S} s) : ${Math.round(100 * tempsAJour / tempsMesure)} %  (calculée sur le temps où une position existait).` : 'Aucune position n\'a existé pendant la surveillance.');
    log(trous.length ? `Trous de plus de ${TROU_S} secondes : ${trous.length}` : `Aucun trou de plus de ${TROU_S} secondes.`);
    trous.forEach((t) => log(`   • de ${heure(t.de)}${t.enCours ? ' jusqu\'à l\'arrêt de la surveillance' : ' à ' + heure(t.jusqua)} : ${dureeS(t.s)}`));
    log('\nSi les trous arrivent quand l\'écran s\'éteint : regarder les réglages de batterie du téléphone (« Ne pas optimiser » pour Lapointe Tracker).');
    log('Rien n\'a été modifié dans la base.');
  };
  let fini = false, minuterie = null;
  const arreter = () => { if (fini) return; fini = true; clearInterval(minuterie); resume(); process.exitCode = 0; };   // (le programme se termine tout seul : plus rien ne le retient)
  process.on('SIGINT', arreter);
  const dureeMax = Number(process.env.LECTURE_DUREE_MS) || 0;   // (essais du script : s'arrête tout seul)
  if (dureeMax) setTimeout(arreter, dureeMax);
  await tour();
  minuterie = setInterval(() => { tour().catch(() => {}); }, INTERVALLE_MS);
  // (le programme reste en marche jusqu'à Ctrl+C)
} else {
  // ─────────────────────────── MODE : LIRE LA JOURNÉE ───────────────────────────
  const jourTexte = arg('jour') ?? new Date().toLocaleDateString('sv-SE');   // « 2026-09-22 »
  const m = jourTexte.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) arret('le jour doit s\'écrire AAAA-MM-JJ (par exemple 2026-09-22)');
  const debutJour = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0).toISOString();
  const finJour = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1, 0, 0, 0).toISOString();
  log(`Jour : ${jourTexte} (de minuit à minuit, heure d'ici)\n`);

  const arrets = new Map(((await lire('stops?select=id,client,adresse')).json ?? []).map((s) => [s.id, s.client ?? s.adresse]));
  const vehicules = new Map(((await lire('equipes?select=id,nom')).json ?? []).map((e) => [e.id, e.nom]));
  const champsQuart = 'id,debut,debut_lat,debut_lon,debut_precision_m,debut_source,fin,fin_lat,fin_lon,fin_precision_m,fin_source,fin_par,fin_estimee,a_valider,raison_a_valider';
  const duJour = (await lire(`quarts?select=${champsQuart}&utilisateur_id=eq.${P.id}&debut=gte.${encodeURIComponent(debutJour)}&debut=lt.${encodeURIComponent(finJour)}&order=debut`)).json ?? [];
  const ouverts = (await lire(`quarts?select=${champsQuart}&utilisateur_id=eq.${P.id}&fin=is.null&order=debut`)).json ?? [];
  const quarts = [...duJour, ...ouverts.filter((q) => !duJour.some((x) => x.id === q.id))].sort((a, b) => Date.parse(a.debut) - Date.parse(b.debut));
  const noms = new Map(liste.json.map((u) => [u.id, u.nom]));

  log(`── LES PUNCHS (« JE COMMENCE » / « JE TERMINE ») : ${quarts.length} quart(s)`);
  const alertes = [];
  quarts.forEach((q, i) => {
    log(`\n  Quart ${i + 1}`);
    log(`   ▶ début : ${dateHeure(q.debut)}  · source « ${q.debut_source} » · position ${q.debut_lat == null ? 'AUCUNE' : precisionTexte(q.debut_precision_m) + carte(q.debut_lat, q.debut_lon)}`);
    log(q.fin ? `   ■ fin   : ${dateHeure(q.fin)}  · source « ${q.fin_source} »${q.fin_par ? ' (par ' + (noms.get(q.fin_par) ?? '?') + ')' : ''} · position ${q.fin_lat == null ? 'AUCUNE' : precisionTexte(q.fin_precision_m) + carte(q.fin_lat, q.fin_lon)}` : '   ■ fin   : ENCORE EN SERVICE (quart ouvert)');
    log(`   durée : ${q.fin ? duree(Date.parse(q.fin) - Date.parse(q.debut)) : duree(Date.now() - Date.parse(q.debut)) + ' (jusqu\'à maintenant)'}${q.a_valider ? `  ·  ⚠ à valider (${q.raison_a_valider})` : ''}${q.fin_estimee ? '  ·  fin ESTIMÉE' : ''}`);
    if (q.debut_lat == null && q.debut_source === 'manuel') alertes.push(`Quart ${i + 1} : le punch de début n'a AUCUNE position (GPS éteint, permission refusée, ou pas de signal GPS).`);
    if (q.debut_precision_m != null && q.debut_precision_m > 100) alertes.push(`Quart ${i + 1} : position de début peu précise (${precisionTexte(q.debut_precision_m)}).`);
    if (q.fin && q.fin_lat == null && q.fin_source === 'manuel') alertes.push(`Quart ${i + 1} : le punch de fin n'a AUCUNE position.`);
    if (q.a_valider) alertes.push(`Quart ${i + 1} : « à valider » (${q.raison_a_valider}) : l'administrateur devra le valider.`);
    if (!q.fin) alertes.push(`Quart ${i + 1} : encore ouvert (le serveur le fermera tout seul après 16 h).`);
  });

  const passes = (await lire(`passes?select=id,numero,tache,debut,fin,fin_type,statut,equipe_id,nb_arrets_total,nb_arrets_faits&chauffeur_id=eq.${P.id}&debut=gte.${encodeURIComponent(debutJour)}&debut=lt.${encodeURIComponent(finJour)}&order=debut`)).json ?? [];
  log(`\n── LES PASSES (comme chauffeur) : ${passes.length}`);
  for (const p of passes) {
    log(`\n  Passe n° ${p.numero} · ${p.tache} · ${vehicules.get(p.equipe_id) ?? '?'} · ${p.statut}${p.fin_type ? ' (' + p.fin_type + ')' : ''}`);
    log(`   débutée à ${dateHeure(p.debut)}  ·  terminée à ${dateHeure(p.fin)}  ·  arrêts faits ${p.nb_arrets_faits}/${p.nb_arrets_total}`);
    const pa = (await lire(`passe_arrets?select=stop_id,complete_le&passe_id=eq.${p.id}&order=complete_le`)).json ?? [];
    pa.forEach((x) => log(`   ✔ arrêt « ${arrets.get(x.stop_id) ?? '?'} » complété à ${dateHeure(x.complete_le)}`));
    const eq = (await lire(`equipage_periodes?select=role,debut,fin,utilisateurs!utilisateur_id(nom)&passe_id=eq.${p.id}&order=debut`)).json ?? [];
    eq.forEach((x) => log(`   👤 ${x.utilisateurs?.nom ?? '?'} (${x.role}) : de ${heure(x.debut)} à ${heure(x.fin)}`));
    if (p.statut === 'en_cours') alertes.push(`Passe n° ${p.numero} : encore EN COURS.`);
  }

  const pos = (await lire(`positions?select=passe_id,lat,lon,precision_m,maj_le&chauffeur_id=eq.${P.id}&order=maj_le.desc&limit=1`)).json ?? [];
  log('\n── LA DERNIÈRE POSITION DU CAMION (la base ne garde que celle-là, pas le trajet)');
  if (pos[0]) {
    const age = (Date.now() - Date.parse(pos[0].maj_le)) / 1000;
    log(`   à ${dateHeure(pos[0].maj_le)} (il y a ${dureeS(age)}) · ${precisionTexte(pos[0].precision_m)}${carte(pos[0].lat, pos[0].lon)}`);
    log(age <= TROU_S ? '   ✔ la position est à jour : le suivi tourne en ce moment.' : '   (plus à jour : normal si la passe est terminée ; sinon le suivi s\'est arrêté)');
  } else log('   aucune position (aucune passe en cours pour cette personne).');

  log('\n── À REGARDER');
  if (!alertes.length) log('   rien d\'anormal repéré.');
  alertes.forEach((a) => log('   ⚠ ' + a));
  log('\nRien n\'a été modifié dans la base. Pour le trajet de la journée : « node lecture-journee.mjs --surveiller » PENDANT la journée.');
}
}   // fin de principal()
try {
  await principal();
} catch (e) {
  log('\n>>> ARRÊT : ' + (e instanceof Arret ? e.message : 'erreur inattendue : ' + (e?.message ?? e)));
  process.exitCode = 1;
}
