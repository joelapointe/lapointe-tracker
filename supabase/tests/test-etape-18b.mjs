// Étape 18b (suite) — LE TRACÉ QUI SUIT LES RUES : le fichier SQL 22 (la table des tronçons) et l'Edge Function « calculer-parcours ».
// La fonction est testée avec un FAUX service d'itinéraire (Geoapify) et un faux accès à la base ; le fichier SQL, lui, est essayé sur la vraie
// base locale (PGlite). Ce que ces tests NE peuvent PAS vérifier : la vraie réponse de Geoapify et le vrai Supabase (PostgREST, clés) : cela se vérifie
// sur le vrai Supabase, avec la vraie clé, par Joé (bouton « Mettre à jour le tracé » de l'application).
// SQL22_TEST / FONCTION18B_TEST (variables d'environnement) : une COPIE abîmée du fichier SQL ou de la fonction, pour les « erreurs volontaires » ;
// les vrais fichiers ne sont jamais touchés.
import { fileURLToPath } from 'url';
const SQL_DIR = fileURLToPath(new URL('../', import.meta.url));
import { prepare } from './prepare.mjs';
import fs from 'fs';
import { randomUUID as uuid } from 'crypto';
import { stripTypeScriptTypes } from 'node:module';

const CODE_FONCTION = fs.readFileSync(process.env.FONCTION18B_TEST || (SQL_DIR + 'functions/calculer-parcours/index.ts'), 'utf8');
const F = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(CODE_FONCTION)).toString('base64'));
const { traiter, enOrdre, sequences, paires, manquants, segmentValide, lireGeoapify, simplifier, arrondir, distanceM,
  TRONCONS_PAR_APPEL, PAUSE_ENTRE_APPELS_MS, PAUSE_LIMITE_MS, DUREE_MAX_APPEL_MS, TOLERANCE_M } = F;
const SQL22 = fs.readFileSync(process.env.SQL22_TEST || (SQL_DIR + '22-etape18b-parcours-segments.sql'), 'utf8');

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
const MEC = 'Déneigement mécanique', SEL = 'Épandage de sel';

// ═════════════════════════════════════════════════════════════════════
// LA FONCTION : les décisions (sans réseau)
// ═════════════════════════════════════════════════════════════════════
const R1 = uuid(), R2 = uuid();
const A = (route, service, lat, lon, ordre, id) => ({ id: id ?? uuid(), route_id: route, service, lat, lon, ordre });
const ids = (l) => l.map((a) => a.id);

log('=== LES SUITES DE CLIENTS ET LES TRONÇONS VOULUS ===');
{
  const a = A(R1, MEC, 46.50, -72.70, 3, 'a'), b = A(R1, MEC, 46.51, -72.70, 1, 'b'), c = A(R1, MEC, 46.52, -72.70, 2, 'c');
  eq('enOrdre trie par « ordre » ; à égalité, l\'ordre de départ est gardé', ids(enOrdre([a, b, c, A(R1, MEC, 46.6, -72.7, 1, 'd')])), ['b', 'd', 'c', 'a']);
  eq('un « ordre » illisible compte pour 0', ids(enOrdre([a, { ...b, ordre: 'x' }, { ...c, ordre: null }])), ['b', 'c', 'a']);
  const suites = sequences([a, b, c]);
  eq('une seule suite pour une route et un service : b, c, a (dans l\'ordre)', suites.map(ids), [['b', 'c', 'a']]);
  eq('les tronçons voulus : b→c puis c→a', paires(suites).map((p) => [p.de.id, p.vers.id]), [['b', 'c'], ['c', 'a']]);
  const deux = sequences([a, b, A(R1, SEL, 46.5, -72.6, 0, 's1'), A(R1, SEL, 46.4, -72.6, 1, 's2'), A(R2, MEC, 46.3, -72.6, 0, 'r1'), A(R2, MEC, 46.2, -72.6, 1, 'r2')]);
  eq('une suite PAR route et PAR type de service (jamais de tronçon d\'un service à l\'autre ni d\'une route à l\'autre)', deux.map((s) => ids(s).join('>')).sort(), ['b>a', 's1>s2', 'r1>r2'].sort());
  eq('sans route, sans service ou sans position : l\'arrêt n\'entre dans aucune suite',
    sequences([a, { ...b, route_id: null }, { ...c, service: null }, A(R1, MEC, null, -72.7, 0, 'x'), A(R1, MEC, 46.5, 0, 0, 'y')]).map(ids), [['a']]);
  eq('un seul client : aucun tronçon', paires(sequences([a])).length, 0);
  eq('un même couple présent dans deux suites n\'est demandé qu\'une fois', paires([[a, b], [a, b]]).length, 1);
  eq('un client suivi de lui-même (données doublées) : aucun tronçon', paires([[a, { ...a }]]).length, 0);
}

log('\n=== TRONÇONS MANQUANTS OU PÉRIMÉS ===');
{
  const a = A(R1, MEC, 46.50, -72.70, 0, 'a'), b = A(R1, MEC, 46.51, -72.71, 1, 'b'), c = A(R1, MEC, 46.52, -72.72, 2, 'c');
  const voulus = paires(sequences([a, b, c]));
  const garde = (p, plus = {}) => ({ de_arret_id: p.de.id, vers_arret_id: p.vers.id, de_lat: p.de.lat, de_lon: p.de.lon, vers_lat: p.vers.lat, vers_lon: p.vers.lon, statut: 'ok', ...plus });
  eq('rien de gardé : les deux tronçons manquent', manquants(voulus, []).length, 2);
  eq('les deux gardés et à jour : rien à calculer', manquants(voulus, voulus.map((p) => garde(p))).length, 0);
  eq('un seul gardé : l\'autre manque', manquants(voulus, [garde(voulus[0])]).map((p) => p.de.id), ['b']);
  eq('un client a bougé (de 1 mètre) : les DEUX tronçons qui le touchent sont périmés', manquants(paires(sequences([a, { ...b, lat: 46.51001 }, c])), voulus.map((p) => garde(p))).length, 2);
  eq('le DERNIER client a bougé seulement en longitude : un seul tronçon périmé (celui qui y arrive)', manquants(paires(sequences([a, b, { ...c, lon: -72.73 }])), voulus.map((p) => garde(p))).map((p) => p.vers.id), ['c']);
  eq('le PREMIER client a bougé : un seul tronçon périmé',manquants(paires(sequences([{ ...a, lon: -72.71 }, b, c])), voulus.map((p) => garde(p))).map((p) => p.de.id), ['a']);
  vrai('une différence minuscule (moins de 1e-7 degré) n\'est pas un mouvement', segmentValide(garde(voulus[0], { de_lat: a.lat + 1e-9 }), voulus[0]));
  vrai('un tronçon gardé pour un AUTRE couple ne compte pas', manquants(voulus, [{ ...garde(voulus[0]), vers_arret_id: 'zzz' }, garde(voulus[1])]).length === 1);
  eq('« sans_route » (à jour) compte comme fait : on ne le redemande pas', manquants(voulus, voulus.map((p) => garde(p, { statut: 'sans_route' }))).length, 0);
  eq('… sauf si on demande de refaire les « sans_route »', manquants(voulus, voulus.map((p) => garde(p, { statut: 'sans_route' })), true).length, 2);
  eq('… et un « sans_route » périmé (un client a bougé) est toujours refait', manquants(paires(sequences([{ ...a, lat: 46.6 }, b, c])), voulus.map((p) => garde(p, { statut: 'sans_route' }))).length, 1);
}

log('\n=== LA RÉPONSE DE GEOAPIFY, LA LIGNE ===');
{
  // La forme de la vraie réponse : MultiLineString (une ligne par étape), points [longitude, latitude], distance en mètres, temps en secondes
  const geo = (coordinates, type = 'MultiLineString', props = { distance: 1523.4, time: 142.6 }) => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: props, geometry: { type, coordinates } }] });
  const r = lireGeoapify(geo([[[-72.70, 46.50], [-72.69, 46.51]], [[-72.69, 46.51], [-72.68, 46.52]]]));
  eq('la ligne est en [latitude, longitude] (l\'ordre de Leaflet), sans doublon au raccord des étapes', r.trace, [[46.50, -72.70], [46.51, -72.69], [46.52, -72.68]]);
  eq('distance et durée arrondies (mètres, secondes)', [r.distance_m, r.duree_s], [1523, 143]);
  eq('« LineString » accepté aussi', lireGeoapify(geo([[-72.70, 46.50], [-72.69, 46.51]], 'LineString')).trace, [[46.50, -72.70], [46.51, -72.69]]);
  eq('sans distance ni temps : 0 et 0 (la ligne, elle, est gardée)', (({ distance_m, duree_s }) => [distance_m, duree_s])(lireGeoapify(geo([[[-72.7, 46.5], [-72.6, 46.6]]], 'MultiLineString', {}))), [0, 0]);
  for (const [nom, json] of [['rien', null], ['sans « features »', {}], ['« features » vide', { features: [] }], ['un point seulement', geo([[[-72.7, 46.5]]])],
    ['un type inconnu', geo([-72.7, 46.5], 'Point')], ['un point illisible', geo([[[-72.7, 'x'], [-72.6, 46.6]]])], ['une latitude impossible (95°)', geo([[[-72.7, 95], [-72.6, 46.6]]])],
    ['une longitude impossible (200°)', geo([[[200, 46.5], [-72.6, 46.6]]])], ['des lignes qui ne sont pas des lignes', geo([1, 2], 'MultiLineString')]]) {
    eq('réponse inutilisable (' + nom + ') : null, jamais de plantage', lireGeoapify(json), null);
  }
}

log('\n=== SIMPLIFIER ET ARRONDIR LA LIGNE ===');
{
  const droite = Array.from({ length: 200 }, (_, i) => [46.5 + i * 0.0001, -72.7]);   // 200 points sur une ligne droite (≈ 22 m entre deux)
  eq('200 points alignés : il ne reste que le premier et le dernier', simplifier(droite, 3), [droite[0], droite[199]]);
  const coin = [[46.5, -72.7], [46.5005, -72.7], [46.5010, -72.7], [46.5010, -72.6995], [46.5010, -72.699]];   // un virage à angle droit
  eq('un virage à angle droit est CONSERVÉ (le coin), les points du milieu des côtés partent', simplifier(coin, 3), [coin[0], coin[2], coin[4]]);
  eq('un point qui dévie de plus de 3 m est gardé', simplifier([[46.5, -72.7], [46.5005, -72.69995], [46.5010, -72.7]], 3).length, 3);
  eq('un point qui dévie de moins de 3 m est retiré', simplifier([[46.5, -72.7], [46.5005, -72.700005], [46.5010, -72.7]], 3).length, 2);
  eq('les mètres tiennent compte de la latitude : 0,000035° de longitude ≈ 2,7 m à Shawinigan (retiré), pas 3,9 m', simplifier([[46.5, -72.7], [46.5005, -72.699965], [46.5010, -72.7]], 3).length, 2);
  eq('deux points : inchangés', simplifier([[1, 2], [3, 4]], 3), [[1, 2], [3, 4]]);
  eq('les deux extrémités sont toujours gardées', (({ 0: p, length: n, [n - 1]: d }) => [p, d])(simplifier(coin, 500)), [coin[0], coin[4]].map((x) => x));
  const petit = arrondir([[46.5000004, -72.7000004], [46.5000049, -72.7000049], [46.51234567, -72.61234567]]);
  eq('5 décimales ; deux points voisins qui deviennent identiques sont fusionnés', petit, [[46.5, -72.7], [46.51235, -72.61235]]);
  eq('tout devient identique : on garde quand même deux points', arrondir([[46.5000001, -72.7], [46.5000002, -72.7]]).length, 2);
  vrai('la distance : un degré de latitude ≈ 111 km', Math.abs(distanceM({ lat: 46, lon: -72 }, { lat: 47, lon: -72 }) - 111195) < 200, String(distanceM({ lat: 46, lon: -72 }, { lat: 47, lon: -72 })));
  vrai('la distance : deux points confondus = 0', distanceM({ lat: 46, lon: -72 }, { lat: 46, lon: -72 }) === 0);
}

// ═════════════════════════════════════════════════════════════════════
// LA FONCTION : appels complets (faux service d'itinéraire, faux accès à la base)
// ═════════════════════════════════════════════════════════════════════
function faux(o = {}) {
  const etat = { arrets: o.arrets ?? [], segments: (o.segments ?? []).map((s) => ({ ...s })), ecrits: [], appels: [], attentes: [], journal: [], lecturesArrets: 0, verifsAdmin: 0, horloge: 0 };   // (horloge : une heure de mentir, en millisecondes)
  const reponse = o.itineraire ?? ((de, vers) => ({ trace: [[de.lat, de.lon], [(de.lat + vers.lat) / 2 + 0.001, (de.lon + vers.lon) / 2], [vers.lat, vers.lon]], distance_m: 1234, duree_s: 150 }));
  const deps = {
    estAdmin: async (auth) => { etat.verifsAdmin++; return /ADMIN$/.test(auth); },   // (tout en-tête qui finit par ADMIN : seul le contrôle du format « Bearer » écarte « Basic ADMIN »)
    cleGeoapifyPresente: () => o.cle !== false,
    lireArrets: async () => { etat.lecturesArrets++; if (o.pannePendantLecture) throw new Error('lecture'); return etat.arrets.map((a) => ({ ...a })); },
    lireSegments: async () => etat.segments.map((s) => ({ ...s })),
    ecrireSegment: async (s) => {
      etat.ecrits.push(s);
      const i = etat.segments.findIndex((x) => x.de_arret_id === s.de_arret_id && x.vers_arret_id === s.vers_arret_id);
      if (i >= 0) etat.segments[i] = { ...s }; else etat.segments.push({ ...s });
    },
    itineraire: async (de, vers) => { etat.appels.push([de, vers]); etat.horloge += o.dureeItineraireMs ?? 0; return typeof reponse === 'function' ? reponse(de, vers, etat.appels.length) : reponse; },
    attendre: async (ms) => { etat.attentes.push(ms); etat.horloge += ms; },
    maintenant: () => etat.horloge,
    journal: (l) => etat.journal.push(l),
  };
  return { deps, etat };
}
const appeler = async (deps, corps, { auth = 'Bearer ADMIN', methode = 'POST' } = {}) => {
  const r = await traiter(new Request('http://x/calculer', { method: methode, headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: methode === 'POST' ? (typeof corps === 'string' ? corps : JSON.stringify(corps)) : undefined }), deps);
  return { statut: r.status, corps: r.status === 204 ? null : await r.json(), entetes: r.headers };
};
const troisClients = () => [A(R1, MEC, 46.50, -72.70, 2, 'c1'), A(R1, MEC, 46.51, -72.71, 0, 'c2'), A(R1, MEC, 46.52, -72.72, 1, 'c3')];

log('\n=== APPEL : QUI A LE DROIT, ET DANS QUEL ÉTAT ===');
{
  const f = faux({ arrets: troisClients() });
  eq('un visiteur (pas d\'en-tête Authorization) : refusé, rien n\'est lu', [(await appeler(f.deps, {}, { auth: '' })).statut, f.etat.lecturesArrets, f.etat.verifsAdmin], [403, 0, 0]);
  eq('un employé (jeton valide mais pas administrateur) : refusé, RIEN n\'est lu, rien n\'est demandé, rien n\'est écrit', [(await appeler(f.deps, {}, { auth: 'Bearer EMPLOYE' })).statut, f.etat.lecturesArrets, f.etat.appels.length, f.etat.ecrits.length], [403, 0, 0, 0]);
  eq('« Basic … » n\'est pas un jeton : refusé', (await appeler(f.deps, {}, { auth: 'Basic ADMIN' })).statut, 403);
  const o = await appeler(f.deps, null, { methode: 'OPTIONS' });
  eq('la pré-vérification du navigateur (OPTIONS) passe sans rien lire', [o.statut, f.etat.lecturesArrets], [204, 0]);
  eq('GET : refusé (405)', (await appeler(f.deps, null, { methode: 'GET' })).statut, 405);
  eq('un corps qui n\'est pas du JSON : 400, rien n\'est fait', [(await appeler(f.deps, 'pas du json')).statut, f.etat.appels.length], [400, 0]);
  eq('un corps qui est une liste : 400', (await appeler(f.deps, '[1,2]')).statut, 400);
  eq('un identifiant de route invalide : 400', (await appeler(f.deps, { route_id: 'pas-un-uuid' })).statut, 400);
  eq('un corps VIDE est accepté (« tout mettre à jour »)', (await appeler(f.deps, '')).statut, 200);
  const sans = faux({ arrets: troisClients(), cle: false });
  const rs = await appeler(sans.deps, {});
  eq('la clé Geoapify n\'est pas enregistrée : 500 « cle_absente », message qui dit quoi faire, rien n\'est lu', [rs.statut, rs.corps.erreur, /GEOAPIFY_KEY/.test(rs.corps.message), sans.etat.lecturesArrets], [500, 'cle_absente', true, 0]);
  const p = faux({ pannePendantLecture: true });
  const rp = await appeler(p.deps, {});
  eq('la base ne répond pas : 500 « erreur_interne » (pas de détail technique dans la réponse)', [rp.statut, rp.corps.erreur, JSON.stringify(rp.corps).includes('lecture')], [500, 'erreur_interne', false]);
  vrai('les réponses portent les en-têtes CORS (l\'application est un autre « site »)', rs.entetes.get('Access-Control-Allow-Origin') === '*' && /authorization/.test(rs.entetes.get('Access-Control-Allow-Headers')));
}

log('\n=== APPEL : LE CALCUL ===');
{
  const f = faux({ arrets: troisClients() });
  const r = await appeler(f.deps, {});
  eq('trois clients : DEUX tronçons calculés, aucun reste', [r.statut, r.corps.calcules, r.corps.sans_route, r.corps.echecs, r.corps.restants, r.corps.total_troncons], [200, 2, 0, 0, 0, 2]);
  eq('le service est interrogé dans l\'ordre de la route : c2 (ordre 0) → c3 (1), puis c3 → c1 (2), avec les vraies positions',
    f.etat.appels, [[{ lat: 46.51, lon: -72.71 }, { lat: 46.52, lon: -72.72 }], [{ lat: 46.52, lon: -72.72 }, { lat: 46.50, lon: -72.70 }]]);
  eq('deux tronçons écrits, dans les bons sens', f.etat.ecrits.map((s) => [s.de_arret_id, s.vers_arret_id, s.statut]), [['c2', 'c3', 'ok'], ['c3', 'c1', 'ok']]);
  const s = f.etat.ecrits[0];
  eq('un tronçon écrit garde les positions des deux clients (pour savoir plus tard s\'il est périmé), la distance et la durée', [s.de_lat, s.de_lon, s.vers_lat, s.vers_lon, s.distance_m, s.duree_s], [46.51, -72.71, 46.52, -72.72, 1234, 150]);
  vrai('… et la ligne (3 points) commence chez le client de départ et finit chez le client d\'arrivée', s.trace.length === 3 && s.trace[0][0] === 46.51 && s.trace[0][1] === -72.71 && s.trace[2][0] === 46.52 && s.trace[2][1] === -72.72, JSON.stringify(s.trace));
  eq('une courte pause entre deux demandes (pas plus de quelques demandes par seconde)', f.etat.attentes, [PAUSE_ENTRE_APPELS_MS, PAUSE_ENTRE_APPELS_MS]);
  vrai('le journal ne contient ni adresse, ni position, ni clé', f.etat.journal.every((l) => !/46\.|72\.|apiKey|c1|c2|c3/.test(l)), JSON.stringify(f.etat.journal));
  const g = faux({ arrets: troisClients(), itineraire: (de, vers) => ({ trace: [[de.lat + 0.0000004, de.lon - 0.0000004], [46.51234567, -72.70234567], [vers.lat, vers.lon]], distance_m: 5, duree_s: 5 }) });
  await appeler(g.deps, {});
  eq('la ligne écrite est ARRONDIE à 5 décimales (un virage éloigné de la droite est gardé)', g.etat.ecrits[0].trace, [[46.51, -72.71], [46.51235, -72.70235], [46.52, -72.72]]);
  const r2 = await appeler(f.deps, {});
  eq('UN DEUXIÈME APPEL ne redemande RIEN (aucun crédit dépensé)',[r2.corps.calcules, r2.corps.total_troncons, f.etat.appels.length], [0, 2, 2]);

  // Un client change de place : seuls les tronçons qui le touchent sont refaits
  f.etat.arrets = f.etat.arrets.map((a) => (a.id === 'c3' ? { ...a, lat: 46.53 } : a));
  const r3 = await appeler(f.deps, {});
  eq('c3 (au milieu) a bougé : ses DEUX tronçons sont refaits, avec la nouvelle position', [r3.corps.calcules, f.etat.appels.length, f.etat.appels[2][1].lat], [2, 4, 46.53]);
  // L'administrateur inverse deux clients : seuls les NOUVEAUX couples sont demandés
  f.etat.arrets = f.etat.arrets.map((a) => (a.id === 'c1' ? { ...a, ordre: 0.5 } : a));   // ordre : c2 (0), c1 (0,5), c3 (1)
  const r4 = await appeler(f.deps, {});
  eq('l\'ordre change (c2, c1, c3) : les couples c2→c1 et c1→c3 sont NOUVEAUX, ils sont calculés (2 demandes de plus)', [r4.corps.calcules, f.etat.appels.length], [2, 6]);
  const r5 = await appeler(f.deps, {});
  eq('… et revenir à l\'ancien ordre ne coûte RIEN : les anciens tronçons sont encore là', [(f.etat.arrets = f.etat.arrets.map((a) => (a.id === 'c1' ? { ...a, ordre: 2 } : a))) && (await appeler(f.deps, {})).corps.calcules, r5.corps.calcules, f.etat.appels.length], [0, 0, 6]);
}
{
  // Plusieurs routes et services ; le filtre par route
  const arrets = [A(R1, MEC, 46.50, -72.70, 0), A(R1, MEC, 46.51, -72.70, 1), A(R1, SEL, 46.52, -72.70, 0), A(R1, SEL, 46.53, -72.70, 1), A(R2, MEC, 46.60, -72.60, 0), A(R2, MEC, 46.61, -72.60, 1), A(R2, MEC, 46.62, -72.60, 2)];
  const f = faux({ arrets });
  const r = await appeler(f.deps, {});
  eq('deux routes, deux services : 1 + 1 + 2 = 4 tronçons (jamais entre deux services ni deux routes)', [r.corps.calcules, r.corps.total_troncons], [4, 4]);
  const g = faux({ arrets });
  const rg = await appeler(g.deps, { route_id: R2 });
  eq('avec « route_id » : seulement les tronçons de cette route (2)', [rg.corps.calcules, rg.corps.total_troncons], [2, 2]);
  vrai('… dont aucun n\'est d\'une autre route (toutes les positions sont celles de la route 2)', g.etat.ecrits.length === 2 && g.etat.ecrits.every((s) => s.de_lat >= 46.6), JSON.stringify(g.etat.ecrits.map((s) => s.de_lat)));
}
{
  // Deux clients au même endroit : aucune demande au service (aucun crédit)
  const f = faux({ arrets: [A(R1, MEC, 46.50, -72.70, 0, 'x1'), A(R1, MEC, 46.50002, -72.70, 1, 'x2'), A(R1, MEC, 46.52, -72.70, 2, 'x3')] });
  const r = await appeler(f.deps, {});
  eq('deux clients à 2 m l\'un de l\'autre : le service n\'est PAS interrogé pour eux (seulement x2→x3), et rien ne reste à faire', [r.corps.calcules, f.etat.appels.length, r.corps.restants], [2, 1, 0]);
  const e = f.etat.ecrits[0];
  eq('… le tronçon est écrit quand même (une ligne de deux points, durée 0)', [e.de_arret_id, e.vers_arret_id, e.statut, e.trace.length, e.duree_s], ['x1', 'x2', 'ok', 2, 0]);
}
{
  // Beaucoup de clients : par tranches
  const foule = Array.from({ length: 60 }, (_, i) => A(R1, MEC, 46 + i * 0.01, -72, i));
  const f = faux({ arrets: foule });
  const r1 = await appeler(f.deps, {});
  eq(`60 clients (59 tronçons) : ${TRONCONS_PAR_APPEL} au premier appel, le reste est annoncé`, [r1.corps.calcules, r1.corps.restants, r1.corps.total_troncons], [TRONCONS_PAR_APPEL, 59 - TRONCONS_PAR_APPEL, 59]);
  const r2 = await appeler(f.deps, {});
  eq('… le deuxième appel finit le travail, sans refaire les 40 premiers', [r2.corps.calcules, r2.corps.restants, f.etat.appels.length], [59 - TRONCONS_PAR_APPEL, 0, 59]);
}

{
  // Un service lent : la fonction s'arrête AVANT que Supabase ne la coupe (150 s) ; ce qui est fait est gardé, l'application rappelle
  const foule = Array.from({ length: 20 }, (_, i) => A(R1, MEC, 46 + i * 0.01, -72, i));   // 19 tronçons
  const f = faux({ arrets: foule, dureeItineraireMs: 30000 });
  const r = await appeler(f.deps, {});
  eq(`un service lent (30 s par trajet) : au bout de ${DUREE_MAX_APPEL_MS / 1000} s on n'entame plus de tronçon : 4 faits, 15 restants, tout est gardé`, [r.statut, r.corps.calcules, r.corps.restants, f.etat.ecrits.length], [200, 4, 15, 4]);
  const suite = await appeler(f.deps, {});
  eq('l\'appel suivant reprend où on en était (sans refaire les 4 premiers)', [suite.corps.calcules, f.etat.appels.length], [4, 8]);
}

log('\n=== APPEL : QUAND LE SERVICE D\'ITINÉRAIRE NE VA PAS BIEN ===');
{
  // « Aucune route » : gardé (sans ligne), pas redemandé sauf sur demande
  const f = faux({ arrets: troisClients(), itineraire: (de) => (de.lat === 46.51 ? { erreur: 'sans_route' } : { trace: [[de.lat, de.lon], [46.5, -72.7]], distance_m: 10, duree_s: 5 }) });
  const r = await appeler(f.deps, {});
  eq('un couple sans route : écrit « sans_route » (sans ligne), l\'autre est calculé, rien ne reste', [r.corps.calcules, r.corps.sans_route, r.corps.restants], [1, 1, 0]);
  const e = f.etat.ecrits.find((s) => s.statut === 'sans_route');
  eq('… « sans_route » n\'a ni ligne, ni distance, ni durée', [e.trace, e.distance_m, e.duree_s], [null, null, null]);
  const n = f.etat.appels.length;
  await appeler(f.deps, {});
  eq('rappeler ne le redemande pas', f.etat.appels.length, n);
  await appeler(f.deps, { refaire_sans_route: true });
  eq('« refaire_sans_route » le redemande (une seule demande de plus)', f.etat.appels.length, n + 1);
  eq('… une valeur autre que true (« 1 », « oui ») ne compte pas', (await appeler(f.deps, { refaire_sans_route: 'oui' }), f.etat.appels.length), n + 1);
}
{
  // Panne passagère : rien n'est écrit, le prochain appel réessaie
  let panne = true;
  const f = faux({ arrets: troisClients(), itineraire: (de, vers) => (panne ? { erreur: 'indisponible' } : { trace: [[de.lat, de.lon], [vers.lat, vers.lon]], distance_m: 10, duree_s: 5 }) });
  const r = await appeler(f.deps, {});
  eq('le service est en panne : 2 échecs, RIEN n\'est écrit, 2 restants', [r.statut, r.corps.calcules, r.corps.echecs, r.corps.restants, f.etat.ecrits.length], [200, 0, 2, 2, 0]);
  panne = false;
  const r2 = await appeler(f.deps, {});
  eq('le service revient : le prochain appel calcule tout', [r2.corps.calcules, r2.corps.echecs, r2.corps.restants], [2, 0, 0]);
}
{
  // « Trop de demandes » : une pause, UN nouvel essai ; sinon on s'arrête là et on le dit
  let n = 0;
  const f = faux({ arrets: troisClients(), itineraire: (de, vers) => (++n === 1 ? { erreur: 'limite' } : { trace: [[de.lat, de.lon], [vers.lat, vers.lon]], distance_m: 10, duree_s: 5 }) });
  const r = await appeler(f.deps, {});
  eq('« trop de demandes » une seule fois : on attend 1,5 s, on réessaie, tout passe', [r.corps.calcules, r.corps.limite_atteinte, f.etat.attentes[0]], [2, false, PAUSE_LIMITE_MS]);
  const g = faux({ arrets: troisClients(), itineraire: () => ({ erreur: 'limite' }) });
  const rg = await appeler(g.deps, {});
  eq('« trop de demandes » sans arrêt : on s\'arrête, on le dit (limite_atteinte), rien n\'est écrit, tout reste à faire', [rg.statut, rg.corps.limite_atteinte, rg.corps.calcules, rg.corps.restants, g.etat.ecrits.length], [200, true, 0, 2, 0]);
  eq('… après UN seul nouvel essai (2 demandes en tout, pas une boucle)', g.etat.appels.length, 2);
  // La limite arrive au milieu : ce qui est fait est gardé
  let m = 0;
  const h = faux({ arrets: troisClients(), itineraire: (de, vers) => (++m <= 1 ? { trace: [[de.lat, de.lon], [vers.lat, vers.lon]], distance_m: 10, duree_s: 5 } : { erreur: 'limite' }) });
  const rh = await appeler(h.deps, {});
  eq('la limite arrive au 2e tronçon : le 1er est GARDÉ, l\'autre reste à faire', [rh.corps.calcules, rh.corps.limite_atteinte, rh.corps.restants, h.etat.ecrits.length], [1, true, 1, 1]);
}
{
  // Clé refusée : erreur claire, ce qui était fait est gardé
  let n = 0;
  const f = faux({ arrets: troisClients(), itineraire: (de, vers) => (++n === 1 ? { trace: [[de.lat, de.lon], [vers.lat, vers.lon]], distance_m: 10, duree_s: 5 } : { erreur: 'cle_refusee' }) });
  const r = await appeler(f.deps, {});
  eq('la clé est refusée par Geoapify : 502 « cle_refusee », message qui dit quoi vérifier, on s\'arrête tout de suite', [r.statut, r.corps.erreur, /GEOAPIFY_KEY/.test(r.corps.message), f.etat.appels.length], [502, 'cle_refusee', true, 2]);
  eq('… le tronçon déjà calculé est gardé', f.etat.ecrits.length, 1);
}

// ═════════════════════════════════════════════════════════════════════
// LE FICHIER SQL 22 (base locale PGlite)
// ═════════════════════════════════════════════════════════════════════
log('\n=== LE FICHIER SQL 22 ===');
const FILES19 = ['01-etape6-utilisateurs.sql', '02-etape7-modele-passes-quarts.sql', '03-etape8-regles-acces.sql', '04-etape9a-quarts-equipage.sql',
  '05-etape9b-passes-fermetures-export.sql', '13-etape13-taches-et-tours-partages.sql', '14-etape13d-retrait-stops-fait.sql', '15-etape14c-dernier-tour-visible.sql',
  '16-etape14e-photo-probleme.sql', '17-etape15-equipage-precedent.sql', '18-etape16d-heure-des-gestes-sans-reseau.sql', '19-etape16d-annulation-ignoree-precisee.sql'];
const db = await prepare(FILES19);
const q = async (sql, p) => { await db.query('reset role'); return (await db.query(sql, p)).rows; };
const sqlAs = async (uid, sql, p = [], role = 'authenticated') => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  await db.query(`set role ${role}`);
  try { return (await db.query(sql, p)).rows; } finally { await db.query('reset role'); }
};
async function err(l, f, motif) {
  try { await f(); fail(l, 'aurait dû échouer'); }
  catch (e) { e.message.includes(motif) ? pass(l + `  [${e.message.split('\n')[0].slice(0, 90)}]`) : fail(l, 'autre erreur : ' + e.message); }
}
const ins = async (email, app) => (await db.query(`insert into auth.users(email, raw_app_meta_data) values ($1,$2::jsonb) returning id`, [email, JSON.stringify(app)])).rows[0].id;
// Comme sur Supabase : service_role voit le schéma public, contourne les règles d'accès par ligne, et reçoit les droits des NOUVELLES tables par défaut
// (et, pour que le fichier prouve LUI-MÊME qu'il ferme la porte : les nouvelles tables donnent d'abord tous les droits aux employés et aux visiteurs)
await db.exec(`grant usage on schema public to service_role; alter role service_role bypassrls; alter default privileges in schema public grant all on tables to service_role, anon, authenticated;`);
const admin = await ins('joe@t.ca', { nom: 'Joé', role: 'admin' });
const luc = await ins('luc@t.ca', { nom: 'Luc', telephone: '8195550101' });
const inactif = await ins('ancien@t.ca', { nom: 'Ancien', telephone: '8195550102' });
await q(`update utilisateurs set actif = false where id = $1`, [inactif]);
const route = (await q(`insert into routes(nom) values ('R18b') returning id`))[0].id;
const stopsSql = [];
for (let i = 0; i < 3; i++) stopsSql.push((await q(`insert into stops(adresse, route_id, service, lat, lon, ordre) values ($1,$2,$3,$4,-72.7,$5) returning id`, ['A' + i, route, MEC, 46.5 + i / 100, i]))[0].id);
const nbActifs = (await q(`select count(*)::int n from stops where actif`))[0].n;

{
  const sans = await prepare([]);
  await err('sans le fichier 03 (pas de est_actif) : REFUSÉ avec un message clair, rien n\'est créé', () => sans.exec(SQL22), 'Rien n\'a été modifié');
  eq('… et la table n\'existe pas', (await sans.query(`select to_regclass('public.parcours_segments') as t`)).rows[0].t, null);

  const r = await db.exec(SQL22);
  const v = r[r.length - 1].rows[0].verification;
  eq('la vérification : table créée, règles actives, UNE seule règle (lecture)', [v.table_existe, v.regles_actives, v.regles], [true, true, ['parcours_segments_lecture (SELECT)']]);
  eq('… un employé peut LIRE, personne ne peut ÉCRIRE depuis l\'application, un visiteur ne peut rien', [v.employe_peut_lire, v.employe_peut_ecrire, v.visiteur_peut_lire], [true, false, false]);
  eq('… le temps réel est branché ; aucun tronçon au départ ; les arrêts actifs sont comptés', [v.temps_reel, v.troncons_existants, v.arrets_actifs], [true, 0, nbActifs]);
}
{
  const tr = JSON.stringify([[46.5, -72.7], [46.51, -72.7]]);
  const ecrire = (de, vers, plus = '') => q(`insert into parcours_segments(de_arret_id, vers_arret_id, de_lat, de_lon, vers_lat, vers_lon, statut, trace, distance_m, duree_s)
    values ($1,$2,46.5,-72.7,46.51,-72.7,'ok',$3::jsonb,1234,150) ${plus}`, [de, vers, tr]);
  await sqlAs(null, `select 1`, [], 'service_role');
  await db.query('reset role'); await db.query('set role service_role');
  await ecrire(stopsSql[0], stopsSql[1]);
  await db.query('reset role');
  eq('le serveur (service_role) écrit un tronçon', (await q(`select count(*)::int n from parcours_segments`))[0].n, 1);
  await db.query('set role service_role');
  await ecrire(stopsSql[0], stopsSql[1], `on conflict (de_arret_id, vers_arret_id) do update set trace = excluded.trace, distance_m = 999`);
  await db.query('reset role');
  eq('… et le REMPLACE (upsert, comme la fonction) sans doublon', (await q(`select count(*)::int n, max(distance_m)::int d from parcours_segments`))[0], { n: 1, d: 999 });

  const lu = await sqlAs(luc, `select de_arret_id, vers_arret_id, statut, trace, distance_m from parcours_segments`);
  eq('un employé actif LIT le tronçon (la ligne revient en liste de points)', [lu.length, lu[0].statut, lu[0].trace, lu[0].distance_m], [1, 'ok', [[46.5, -72.7], [46.51, -72.7]], 999]);
  eq('l\'administrateur le lit aussi', (await sqlAs(admin, `select 1 from parcours_segments`)).length, 1);
  eq('un employé DÉSACTIVÉ ne voit rien', (await sqlAs(inactif, `select 1 from parcours_segments`)).length, 0);
  await err('un visiteur (sans compte) : accès refusé', () => sqlAs(null, `select 1 from parcours_segments`, [], 'anon'), 'permission denied');
  await err('un employé ne peut pas écrire (insert)', () => sqlAs(luc, `insert into parcours_segments(de_arret_id, vers_arret_id, de_lat, de_lon, vers_lat, vers_lon, trace) values ($1,$2,1,1,2,2,'[[1,1],[2,2]]')`, [stopsSql[1], stopsSql[2]]), 'permission denied');
  await err('… ni modifier (update)', () => sqlAs(luc, `update parcours_segments set distance_m = 1`), 'permission denied');
  await err('… ni supprimer (delete)', () => sqlAs(luc, `delete from parcours_segments`), 'permission denied');
  await err('l\'ADMINISTRATEUR non plus (seule la fonction serveur écrit) : insert refusé', () => sqlAs(admin, `insert into parcours_segments(de_arret_id, vers_arret_id, de_lat, de_lon, vers_lat, vers_lon, trace) values ($1,$2,1,1,2,2,'[[1,1],[2,2]]')`, [stopsSql[1], stopsSql[2]]), 'permission denied');
  await err('… update refusé', () => sqlAs(admin, `update parcours_segments set distance_m = 1`), 'permission denied');
  await err('… delete refusé', () => sqlAs(admin, `delete from parcours_segments`), 'permission denied');
  eq('rien n\'a changé pendant ces refus', (await q(`select count(*)::int n, max(distance_m)::int d from parcours_segments`))[0], { n: 1, d: 999 });
}
{
  // Les règles de la table elle-même (posées par le serveur : le même chemin que la fonction)
  const S = async (sql, p) => { await db.query('reset role'); await db.query('set role service_role'); try { return (await db.query(sql, p)).rows; } finally { await db.query('reset role'); } };
  const base = (de, vers, statut, trace, plus = {}) => S(`insert into parcours_segments(de_arret_id, vers_arret_id, de_lat, de_lon, vers_lat, vers_lon, statut, trace) values ($1,$2,46.5,-72.7,46.6,-72.7,$3,$4::jsonb)`, [de, vers, statut, trace]);
  await err('un statut inconnu est refusé', () => base(stopsSql[1], stopsSql[2], 'bizarre', '[[1,1],[2,2]]'), 'check');
  await err('« ok » sans ligne est refusé', () => base(stopsSql[1], stopsSql[2], 'ok', null), 'check');
  await err('« ok » avec UN seul point est refusé', () => base(stopsSql[1], stopsSql[2], 'ok', '[[1,1]]'), 'check');
  await err('« ok » avec une ligne qui n\'est pas une liste est refusé', () => base(stopsSql[1], stopsSql[2], 'ok', '{"a":1}'), 'check');
  await err('un tronçon d\'un client vers LUI-MÊME est refusé', () => base(stopsSql[1], stopsSql[1], 'ok', '[[1,1],[2,2]]'), 'check');
  await err('un tronçon vers un arrêt qui n\'existe pas est refusé', () => base(stopsSql[1], uuid(), 'ok', '[[1,1],[2,2]]'), 'foreign key');
  await err('des positions manquantes sont refusées', () => S(`insert into parcours_segments(de_arret_id, vers_arret_id, de_lat, de_lon, vers_lat, statut, trace) values ($1,$2,1,1,2,'ok','[[1,1],[2,2]]')`, [stopsSql[1], stopsSql[2]]), 'null value');
  await base(stopsSql[1], stopsSql[2], 'sans_route', null);
  eq('« sans_route » SANS ligne est permis', (await q(`select statut, trace from parcours_segments where de_arret_id = $1`, [stopsSql[1]]))[0], { statut: 'sans_route', trace: null });
  await err('deux fois le même couple est refusé (clé primaire)', () => base(stopsSql[1], stopsSql[2], 'sans_route', null), 'duplicate key');
  // Un arrêt supprimé emporte ses tronçons
  await q(`delete from stops where id = $1`, [stopsSql[2]]);
  eq('un arrêt supprimé emporte les tronçons qui le touchent (« sans_route » 1→2), pas les autres (0→1)', (await q(`select de_arret_id from parcours_segments order by de_arret_id`)).map((x) => x.de_arret_id), [stopsSql[0]]);
  // … que l'arrêt supprimé soit le DÉPART ou l'ARRIVÉE du tronçon
  const nouv = async (nom) => (await q(`insert into stops(adresse, route_id, service, lat, lon, ordre) values ($1,$2,$3,46.9,-72.9,9) returning id`, [nom, route, MEC]))[0].id;
  const [X, Y, P, Q] = [await nouv('X'), await nouv('Y'), await nouv('P'), await nouv('Q')];
  await base(X, Y, 'sans_route', null); await base(P, Q, 'sans_route', null);
  await q(`delete from stops where id = $1`, [X]);
  await q(`delete from stops where id = $1`, [Q]);
  eq('l\'arrêt de DÉPART supprimé (X→Y) et l\'arrêt d\'ARRIVÉE supprimé (P→Q) emportent chacun leur tronçon', (await q(`select count(*)::int n from parcours_segments where de_arret_id = any($1::uuid[])`, [[X, P]]))[0].n, 0);
}
{
  // Ré-exécuter le fichier ne perd rien
  const avant = (await q(`select count(*)::int n from parcours_segments`))[0].n;
  await db.exec(SQL22);
  eq('ré-exécuter le fichier 22 ne perd AUCUN tronçon et ne casse rien', [(await q(`select count(*)::int n from parcours_segments`))[0].n, (await q(`select count(*)::int n from pg_policies where tablename = 'parcours_segments'`))[0].n], [avant, 1]);
  eq('… le temps réel n\'est pas ajouté en double', (await q(`select count(*)::int n from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'parcours_segments'`))[0].n, 1);
  eq('… un employé lit toujours', (await sqlAs(luc, `select 1 from parcours_segments`)).length, avant);
}

log('\n=== CE QUE LA FONCTION ÉCRIT ENTRE DANS LA TABLE ===');
{
  // On prend les lignes exactes que la fonction écrit (avec de vrais arrêts) et on les insère comme le fait le serveur
  const st = [];
  for (let i = 0; i < 4; i++) st.push({ id: (await q(`insert into stops(adresse, route_id, service, lat, lon, ordre) values ($1,$2,$3,$4,-72.6,$5) returning id`, ['B' + i, route, SEL, 46.6 + i / 50, i]))[0].id, lat: 46.6 + i / 50, lon: -72.6, i });
  const f = faux({
    arrets: st.map((s) => A(route, SEL, s.lat, s.lon, s.i, s.id)),
    itineraire: (de, vers) => (de.lat > 46.63 ? { erreur: 'sans_route' } : { trace: Array.from({ length: 50 }, (_, k) => [de.lat + (vers.lat - de.lat) * k / 49 + (k % 2 ? 0.0002 : 0), de.lon + k * 0.00003]), distance_m: 2222, duree_s: 200 }),
  });
  await appeler(f.deps, {});
  eq('la fonction a produit 3 tronçons (2 « ok », 1 « sans_route »)', f.etat.ecrits.map((s) => s.statut), ['ok', 'ok', 'sans_route']);
  await db.query('set role service_role');
  try {
    for (const s of f.etat.ecrits) {
      await db.query(`insert into parcours_segments(de_arret_id, vers_arret_id, de_lat, de_lon, vers_lat, vers_lon, statut, trace, distance_m, duree_s, calcule_le)
        values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10, now())
        on conflict (de_arret_id, vers_arret_id) do update set trace = excluded.trace`, [s.de_arret_id, s.vers_arret_id, s.de_lat, s.de_lon, s.vers_lat, s.vers_lon, s.statut, s.trace === null ? null : JSON.stringify(s.trace), s.distance_m, s.duree_s]);
    }
  } finally { await db.query('reset role'); }
  const lus = await sqlAs(luc, `select statut, trace, distance_m, duree_s from parcours_segments where de_arret_id = any($1::uuid[]) order by de_lat`, [st.map((s) => s.id)]);
  eq('les 3 lignes de la fonction entrent dans la table telles quelles (« sans_route » sans ligne)', lus.map((x) => [x.statut, x.trace === null ? null : x.trace.length > 1]), [['ok', true], ['ok', true], ['sans_route', null]]);
  vrai('… la ligne simplifiée (50 points → moins) revient en liste de [latitude, longitude]', Array.isArray(lus[0].trace[0]) && lus[0].trace[0].length === 2 && lus[0].trace.length < 50, JSON.stringify(lus[0].trace).slice(0, 80));
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exitCode = ko ? 1 : 0;
