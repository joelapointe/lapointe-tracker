// Étape 18 — LA POSITION DU CAMION ENVOYÉE PAR LE TÉLÉPHONE DU CHAUFFEUR (www/js/tracking.js). Partie 1 : application ouverte. Partie 2 : Android, application en
// arrière-plan ou écran éteint (suivi de premier plan du plugin @capacitor-community/background-geolocation, notification permanente, permission « notifications »).
// Les VRAIS fichiers de l'application (config, position, utilitaires, hors-reseau, file-attente, tours, passe, tracking) sont chargés dans un faux navigateur avec un
// faux Supabase (envoyer_position) et, pour la partie 2, de faux plugins de téléphone (Capacitor.Plugins.<Nom>).
// Décisions de Joé (21 sept.) : toutes les 10 secondes, seulement pendant SA passe en cours ; notification « Lapointe Tracker — Passe en cours : la position du camion
// est partagée ». WWW_TEST : un autre dossier « www » (erreurs volontaires).
import vm from 'vm';
import fs from 'fs';
import { fileURLToPath } from 'url';
const WWW = process.env.WWW_TEST ? process.env.WWW_TEST.split('\\').join('/').replace(/\/?$/, '/') : fileURLToPath(new URL('../../www/', import.meta.url));

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
const lire = (f) => fs.readFileSync(WWW + f, 'utf8');
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const CHAUFFEUR = [{ route_id: 'r1', tache: 't1', numero: 1, en_cours: true, total: 2, faits: 0, pourcentage: 0, arrets_faits: [], passes: [{ passe_id: 'p1', equipe_id: 'e1', chauffeur_id: 'u-luc', je_suis_chauffeur: true, je_suis_a_bord: true }] }];
const PASSAGER = [{ route_id: 'r1', tache: 't1', numero: 1, en_cours: true, total: 2, faits: 0, pourcentage: 0, arrets_faits: [], passes: [{ passe_id: 'p2', equipe_id: 'e2', chauffeur_id: 'u-eric', je_suis_chauffeur: false, je_suis_a_bord: true }] }];

// Un monde : faux navigateur + faux Supabase (qui répond à envoyer_position comme le dit o) + les vrais fichiers
function monde(o = {}) {
  const appels = { envois: [], toursRelus: 0 };
  const els = {};
  const creer = (id) => { const classes = new Set(); return { id, children: [], style: {}, textContent: '', innerHTML: '', value: '', disabled: false, className: '', attrs: {},
    classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)), contains: (c) => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
    appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; }, focus() {}, click() {}, remove() {} }; };
  const el = (id) => (els[id] ??= creer(id));
  const fauxDb = { rpc: async (nom, args) => {
    appels.envois.push({ nom, args, t: Date.now() });
    if (o.delaiMs) await attendre(o.delaiMs);
    if (o.jamais) return new Promise(() => {});
    if (o.panne) throw new Error('Failed to fetch');
    if (o.erreur) return { data: null, error: o.erreur };
    return { data: o.reponse ?? { statut: 'ok' }, error: null };
  } };
  const stockage = {};
  // Un téléphone Android : les plugins natifs que Capacitor met dans la page (Capacitor.Plugins.<Nom>). o.telephone = { notif: 'prompt' | 'granted' | 'denied' | null (plugin absent), … }
  const bg = { ajouts: [], retraits: [], ordre: [], toasts: [], notif: o.telephone?.notif ?? null, permissionLocalisation: o.telephone?.permissionLocalisation ?? 'granted' };
  const plugins = {};
  if (o.telephone) {
    plugins.BackgroundGeolocation = {
      addWatcher: (options, cb) => { bg.ordre.push('addWatcher'); if (o.telephone.erreurAjout) throw o.telephone.erreurAjout; const id = 'w' + (bg.ajouts.length + 1); bg.ajouts.push({ id, options, cb }); return id; },
      removeWatcher: async ({ id }) => { bg.retraits.push(id); if (o.telephone.retraitMuet) return new Promise(() => {}); },
    };
    plugins.Geolocation = { checkPermissions: async () => ({ location: bg.permissionLocalisation, coarseLocation: bg.permissionLocalisation }), requestPermissions: async () => ({ location: bg.permissionLocalisation }) };
    if (bg.notif) plugins.NotificationPermission = {
      check: async () => { bg.ordre.push('check'); return { notifications: bg.notif }; },
      request: async () => { bg.ordre.push('request'); bg.notif = o.telephone.notifApres ?? 'granted'; return { notifications: bg.notif }; },
    };
  }
  const sandbox = {
    ...(o.telephone ? { Capacitor: { isPluginAvailable: (n) => n in plugins, Plugins: plugins } } : {}), document: { getElementById: el, createElement: () => creer(null), body: creer('body'), addEventListener() {}, removeEventListener() {} },
    localStorage: { getItem: (k) => (k in stockage ? stockage[k] : null), setItem: (k, v) => { stockage[k] = String(v); }, removeItem: (k) => { delete stockage[k]; } },
    window: { open() {} }, setTimeout, clearTimeout, setInterval, clearInterval, console, AbortController, Blob, location: { reload() {} },
    fetch: async () => { throw new Error('Failed to fetch'); }, L: {}, crypto: { randomUUID: () => 'x' }, __fauxDb: fauxDb, __appels: appels };
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/config.js', 'js/position.js', 'js/utilitaires.js', 'js/hors-reseau.js', 'js/file-attente.js', 'js/tours.js', 'js/passe.js', 'js/tracking.js']) vm.runInContext(lire(f), ctx, { filename: f });
  sandbox.__toasts = bg.toasts;
  vm.runInContext('db = __fauxDb; currentUser = {id:"u-luc",nom:"Luc",role:"employe"}; SONDE_INTERVALLE_MS = 100000; toast = (t) => { __toasts.push(t); }; planifierRechargementTours = () => { __appels.toursRelus++; };', ctx);
  vm.runInContext('tours = ' + JSON.stringify(o.tours ?? CHAUFFEUR) + ';', ctx);
  if (o.delaiEnvoiMs) vm.runInContext('POSITION_ENVOI_DELAI_MS=' + o.delaiEnvoiMs, ctx);
  const m = { ctx, appels, bg, run: (c) => vm.runInContext(c, ctx), fin: () => vm.runInContext('arreterTracking();arreterSonde();', ctx) };
  m.position = (secondes = 0, precision = 9) => m.run(`noterPosition(46.5,-72.7,${precision}); lastPosInfo.le=Date.now()-${secondes * 1000}`);   // une lecture d'il y a N secondes
  return m;
}
const envois = (m) => m.appels.envois.filter((x) => x.nom === 'envoyer_position');

log('=== SEUL LE CHAUFFEUR D\'UNE PASSE EN COURS ENVOIE LA POSITION ===');
{
  const m = monde({ tours: [] }); m.position();
  eq('aucune passe à moi : rien n\'est envoyé', [await m.run('envoyerPositionDuCamion()'), m.appels.envois.length], ['pas_chauffeur', 0]);
  m.fin();
  const p = monde({ tours: PASSAGER }); p.position();
  eq('passager d\'un camion (à bord sans le conduire) : rien n\'est envoyé', [await p.run('envoyerPositionDuCamion()'), p.appels.envois.length], ['pas_chauffeur', 0]);
  p.fin();
  const c = monde(); c.position();
  eq('chauffeur de sa passe en cours : la position part', [await c.run('envoyerPositionDuCamion()'), envois(c).length], ['envoyee', 1]);
  const a = envois(c)[0].args;
  eq('… avec la passe, la latitude, la longitude et la précision de la lecture', [a.p_passe_id, a.p_lat, a.p_lon, a.p_precision], ['p1', 46.5, -72.7, 9]);
  vrai('… SANS heure (c\'est celle du serveur : l\'horloge du téléphone ne fausse rien)', !('p_moment' in a));
  c.fin();
  const n = monde(); n.run('currentUser=null'); n.position();
  eq('personne n\'est connecté : rien', [await n.run('envoyerPositionDuCamion()'), n.appels.envois.length], ['pas_chauffeur', 0]);
  n.fin();
}
{
  const m = monde(); m.position(0, null);
  await m.run('envoyerPositionDuCamion()');
  eq('une précision inconnue s\'envoie « inconnue » (null), jamais inventée', envois(m)[0]?.args.p_precision, null);
  m.fin();
}

log('=== JAMAIS DE POSITION INVENTÉE : UNE LECTURE RÉCENTE DU GPS, SINON RIEN ===');
{
  const m = monde();
  eq('aucune lecture du GPS : rien', [await m.run('envoyerPositionDuCamion()'), m.appels.envois.length], ['sans_position', 0]);
  m.position(30);
  eq('une lecture d\'il y a 30 secondes : trop vieille, rien', [await m.run('envoyerPositionDuCamion()'), m.appels.envois.length], ['sans_position', 0]);
  m.position(15);
  eq('une lecture d\'il y a 15 secondes : elle part', [await m.run('envoyerPositionDuCamion()'), envois(m).length], ['envoyee', 1]);
  eq('les réglages : toutes les 3 secondes (effet d\'un vrai GPS, revu le 23 sept.), lecture de moins de 20 secondes, un envoi abandonné après 2,5 secondes', m.run('[POSITION_ENVOI_S, POSITION_ENVOI_FRAICHE_S, POSITION_ENVOI_DELAI_MS]'), [3, 20, 2500]);
  m.fin();
}

log('=== SANS RÉSEAU : RIEN N\'EST ENVOYÉ, RIEN N\'EST GARDÉ ===');
{
  const m = monde(); m.position(); m.run('reseau.enLigne=false');
  eq('hors réseau : rien ne part', [await m.run('envoyerPositionDuCamion()'), m.appels.envois.length], ['hors_reseau', 0]);
  eq('… et rien n\'est mis dans la file des gestes (seule la dernière position compte)', [m.run('gestesEnAttente().length'), m.run('fileAGestes()')], [0, false]);
  m.fin();
  const p = monde({ panne: true }); p.position();
  eq('le signal disparaît PENDANT l\'envoi : « perdue », l\'application le sait (hors réseau)', [await p.run('envoyerPositionDuCamion()'), p.run('reseau.enLigne')], ['perdue', false]);
  eq('… rien n\'est gardé non plus', [p.run('gestesEnAttente().length'), p.run('fileAGestes()')], [0, false]);
  p.fin();
}
{
  // Un départ de passe gardé sans réseau : le serveur ne la connaît pas encore
  const m = monde(); m.position();
  m.run("gestesEnAttente=()=>[{type:'debuter_passe',args:{passeId:'p1'}}]");
  eq('mon départ de passe attend d\'être envoyé (le serveur ne la connaît pas) : pas de position', [await m.run('envoyerPositionDuCamion()'), m.appels.envois.length], ['pas_chauffeur', 0]);
  m.run("gestesEnAttente=()=>[{type:'debuter_passe',args:{passeId:'autre'}},{type:'completer_arret',args:{passeId:'p1'}}]");
  eq('… un autre départ, ou un autre geste de la même passe qui attend : la position part', [await m.run('envoyerPositionDuCamion()'), envois(m).length], ['envoyee', 1]);
  m.fin();
}

log('=== LES RÉPONSES DU SERVEUR ===');
{
  const m = monde({ reponse: { statut: 'passe_terminee' } }); m.position();
  eq('le serveur dit que ma passe est terminée : l\'écran relit les passes', [await m.run('envoyerPositionDuCamion()'), m.appels.toursRelus], ['passe_terminee', 1]);
  m.fin();
  const r = monde({ erreur: { code: 'P0001', message: 'non_autorise' } }); r.position();
  eq('un refus du serveur (« non_autorise ») : « refusee », ce n\'est pas une panne de réseau', [await r.run('envoyerPositionDuCamion()'), r.run('reseau.enLigne')], ['refusee', true]);
  r.fin();
  const q = monde({ erreur: { code: 'P0001', message: 'passe_introuvable' } }); q.position();
  eq('passe introuvable : refusée sans bruit, la suivante réessaiera', [await q.run('envoyerPositionDuCamion()'), q.run('_envoiPositionEnCours')], ['refusee', false]);
  q.fin();
}

log('=== UN SEUL ENVOI À LA FOIS, ET UN ENVOI SANS RÉPONSE EST ABANDONNÉ ===');
{
  const m = monde({ delaiMs: 120 }); m.position();
  const premier = m.run('envoyerPositionDuCamion()');
  const b = await m.run('envoyerPositionDuCamion()');
  const c = await m.run('envoyerPositionDuCamion()');
  eq('un envoi est en cours : les appels rapprochés attendent (« en_cours »), UN seul envoi', [b, c, envois(m).length], ['en_cours', 'en_cours', 1]);
  eq('… le premier finit normalement', await premier, 'envoyee');
  eq('… et le suivant peut partir (le verrou est rendu)', [await m.run('envoyerPositionDuCamion()'), envois(m).length], ['envoyee', 2]);
  m.fin();
}
{
  const m = monde({ jamais: true, delaiEnvoiMs: 60 }); m.position();
  const t0 = Date.now();
  const r = await m.run('envoyerPositionDuCamion()');
  eq('le serveur ne répond jamais : l\'envoi est abandonné (« perdue ») après le délai, sans bloquer', [r, Date.now() - t0 < 1500, m.run('_envoiPositionEnCours')], ['perdue', true, false]);
  m.fin();
}

log('=== LA MINUTERIE : UNE SEULE, TOUTES LES 10 SECONDES, ARRÊTÉE À LA DÉCONNEXION ===');
{
  const m = monde(); m.position();
  m.run('POSITION_ENVOI_S=0.05');   // (50 ms au lieu de 10 s)
  m.run('demarrerEnvoiPosition()');
  const a = m.run('_minuterieEnvoiPosition');
  m.run('demarrerEnvoiPosition()');
  eq('démarrer deux fois (rechargement des arrêts) ne fait qu\'UNE minuterie', m.run('_minuterieEnvoiPosition') === a && a !== null, true);
  await attendre(20);
  eq('le premier envoi part tout de suite (le camion apparaît sans attendre)', envois(m).length >= 1, true);
  await attendre(260);
  const n = envois(m).length;
  vrai('puis un envoi à chaque tour de la minuterie (plusieurs en 280 ms, pas le double)', n >= 3 && n <= 8, 'obtenu ' + n);
  await m.run('arreterTracking()');
  eq('la déconnexion arrête la minuterie', m.run('_minuterieEnvoiPosition'), null);
  const apres = envois(m).length;
  await attendre(150);
  eq('… plus aucun envoi ensuite', envois(m).length, apres);
  m.fin();
}
{
  const m = monde({ tours: [] }); m.position();
  m.run('POSITION_ENVOI_S=0.03; demarrerEnvoiPosition()');
  await attendre(200);
  eq('la minuterie tourne sans passe à moi : elle n\'envoie rien', m.appels.envois.length, 0);
  m.fin();
}
{
  const m = monde({ tours: [] }); m.position();
  m.run('POSITION_ENVOI_S=0.03; demarrerEnvoiPosition()');
  m.run('tours = ' + JSON.stringify(CHAUFFEUR));
  await attendre(250);
  vrai('je débute ma passe pendant que l\'application tourne : les envois commencent au tour suivant', envois(m).length >= 1, 'obtenu ' + envois(m).length);
  m.run('tours = []');
  const n = envois(m).length;
  await attendre(150);
  eq('… et s\'arrêtent quand ma passe se termine', envois(m).length, n);
  m.fin();
}

const TEL = { notif: 'granted' };   // un téléphone Android dont la permission « notifications » est déjà accordée
const watchers = (m) => m.bg.ajouts.length;
const lecture = (o = {}) => ({ latitude: 46.7, longitude: -72.6, accuracy: 7, time: Date.now() - 3000, ...o });

log('=== LE SUIVI EN ARRIÈRE-PLAN (ANDROID) : IL SUIT MA PASSE ===');
{
  const m = monde();   // un navigateur : pas de plugin
  await m.run('majSuiviArrierePlan()');
  eq('dans un navigateur (aucun plugin) : rien ne se passe, sans erreur', [m.run('_suiviArrierePlan'), m.run('pluginNatif("BackgroundGeolocation")')], [null, null]);
  m.fin();
}
{
  const m = monde({ telephone: TEL });
  await m.run('majSuiviArrierePlan()');
  eq('chauffeur de sa passe en cours : le suivi du téléphone démarre (UN seul)', [watchers(m), m.run('_suiviArrierePlan.id')], [1, 'w1']);
  const o = m.bg.ajouts[0].options;
  eq('… avec la notification que Joé a validée : « Lapointe Tracker » / « Passe en cours : la position du camion est partagée »', [o.backgroundTitle, o.backgroundMessage], ['Lapointe Tracker', 'Passe en cours : la position du camion est partagée']);
  eq('… la boîte de permission de localisation permise, pas de lecture périmée, chaque lecture (aucun filtre de distance : le camion à l\'arrêt reste à jour)', [o.requestPermissions, o.stale, o.distanceFilter], [true, false, 0]);
  await m.run('majSuiviArrierePlan()');
  await Promise.all([m.run('majSuiviArrierePlan()'), m.run('majSuiviArrierePlan()')]);
  eq('les tours suivants, même en même temps, n\'en ajoutent PAS d\'autre', watchers(m), 1);
  m.fin();
}
{
  // Deux tours de minuterie qui se chevauchent AVANT que le premier suivi soit en place (la permission « notifications » attend la personne)
  const m = monde({ telephone: { notif: 'prompt' } });
  await Promise.all([m.run('majSuiviArrierePlan()'), m.run('majSuiviArrierePlan()'), m.run('majSuiviArrierePlan()')]);
  eq('trois tours en même temps au début de la passe : UN seul suivi, UNE seule demande de permission', [watchers(m), m.bg.ordre.filter((x) => x === 'request').length], [1, 1]);
  m.fin();
}
{
  const m = monde({ telephone: TEL, tours: [] });
  await m.run('majSuiviArrierePlan()');
  eq('aucune passe à moi : pas de suivi (donc pas de notification)', watchers(m), 0);
  m.fin();
  const p = monde({ telephone: TEL, tours: PASSAGER });
  await p.run('majSuiviArrierePlan()');
  eq('passager d\'un camion : pas de suivi non plus (il ne partage pas de position)', watchers(p), 0);
  p.fin();
  const n = monde({ telephone: TEL }); n.run('currentUser=null');
  await n.run('majSuiviArrierePlan()');
  eq('personne n\'est connecté : rien', watchers(n), 0);
  n.fin();
}
{
  const m = monde({ telephone: TEL });
  await m.run('majSuiviArrierePlan()');
  m.run('tours = []');
  await m.run('majSuiviArrierePlan()');
  eq('ma passe se termine : le suivi est arrêté (la notification disparaît)', [m.bg.retraits, m.run('_suiviArrierePlan')], [['w1'], null]);
  await m.run('majSuiviArrierePlan()');
  eq('… une seule fois', m.bg.retraits.length, 1);
  m.run('tours = ' + JSON.stringify(CHAUFFEUR));
  await m.run('majSuiviArrierePlan()');
  eq('une nouvelle passe : un nouveau suivi', [watchers(m), m.run('_suiviArrierePlan.id')], [2, 'w2']);
  m.fin();
}
{
  // Un départ gardé sans réseau : le suivi démarre quand même (le serveur ne connaît pas encore la passe ; la position, elle, attend)
  const m = monde({ telephone: TEL }); m.position(); m.run('reseau.enLigne=false');
  m.run("gestesEnAttente=()=>[{type:'debuter_passe',args:{passeId:'p1'}}]");
  await m.run('majSuiviArrierePlan()');
  eq('ma passe vient d\'être débutée SANS réseau : le suivi du téléphone démarre tout de suite', watchers(m), 1);
  eq('… mais aucune position ne part avant que le serveur connaisse la passe', [await m.run('envoyerPositionDuCamion()'), m.appels.envois.length], ['pas_chauffeur', 0]);
  m.fin();
}

log('=== LES LECTURES DU SERVICE DU TÉLÉPHONE ALIMENTENT L\'ENVOI ===');
{
  const m = monde({ telephone: TEL });
  await m.run('majSuiviArrierePlan()');
  eq('avant toute lecture : rien à envoyer', await m.run('envoyerPositionDuCamion()'), 'sans_position');
  m.bg.ajouts[0].cb(lecture());
  eq('une lecture du service (écran éteint) est gardée avec sa précision', [m.run('lastPosInfo.lat'), m.run('lastPosInfo.lon'), m.run('lastPosInfo.precision')], [46.7, -72.6, 7]);
  // Retour de Joé après un essai réel (23 sept.) : le point sautait d'un coup au rallumage de l'écran — Android peut mettre en
  // pause la minuterie JavaScript pendant que l'écran est éteint. CETTE lecture doit donc déclencher l'envoi ELLE-MÊME, tout de
  // suite, sans dépendre seulement de la minuterie (même route que l'application ouverte).
  eq('… et CETTE lecture déclenche l\'envoi elle-même, tout de suite', envois(m)[0]?.args, { p_passe_id: 'p1', p_lat: 46.7, p_lon: -72.6, p_precision: 7 });
  m.bg.ajouts[0].cb({ latitude: 'x', longitude: 1 });
  m.bg.ajouts[0].cb(null);
  m.bg.ajouts[0].cb(lecture({ latitude: 47.1, accuracy: null }));
  eq('une lecture sans coordonnées valables est ignorée ; une précision inconnue reste inconnue', [m.run('lastPosInfo.lat'), m.run('lastPosInfo.precision')], [47.1, null]);
  m.fin();
}

log('=== LA LOCALISATION REFUSÉE, OU LE GPS ÉTEINT ===');
{
  const m = monde({ telephone: TEL });
  await m.run('majSuiviArrierePlan()');
  m.bg.ajouts[0].cb(null, { code: 'NOT_AUTHORIZED', message: 'User denied location permission' });
  eq('la localisation est refusée : le suivi est abandonné (la notification disparaît)', [m.bg.retraits, m.run('_suiviArrierePlan')], [['w1'], null]);
  eq('… la personne en est avertie, avec où corriger', [m.bg.toasts.length, m.bg.toasts[0]?.includes('refusée'), m.bg.toasts[0]?.includes('Réglages du téléphone')], [1, true, true]);
  m.bg.ajouts[0].cb(null, { code: 'NOT_AUTHORIZED', message: 'User denied location permission' });
  eq('… UNE seule fois par passe', m.bg.toasts.length, 1);
  await m.run('majSuiviArrierePlan()');
  eq('… et le tour suivant NE redemande rien (pas de boîte à l\'écran toutes les 10 secondes)', watchers(m), 1);
  m.run('ARRIERE_PLAN_REESSAI_MS=30');
  await attendre(60); m.bg.permissionLocalisation = 'denied';
  await m.run('majSuiviArrierePlan()');
  eq('une minute plus tard, la localisation est toujours refusée : rien n\'est tenté (aucune notification qui clignote)', watchers(m), 1);
  await attendre(60); m.bg.permissionLocalisation = 'granted';
  await m.run('majSuiviArrierePlan()');
  eq('la personne l\'a accordée dans les réglages du téléphone : le suivi reprend tout seul, SANS boîte de permission ni nouveau message', [watchers(m), m.bg.ajouts[1]?.options.requestPermissions, m.bg.toasts.length], [2, false, 1]);
  m.fin();
}
{
  const m = monde({ telephone: TEL });
  await m.run('majSuiviArrierePlan()');
  m.bg.ajouts[0].cb(null, { code: 'NOT_AUTHORIZED', message: 'User denied location permission' });
  m.run('tours = []'); await m.run('majSuiviArrierePlan()');
  m.run('tours = ' + JSON.stringify(CHAUFFEUR)); await m.run('majSuiviArrierePlan()');
  eq('après un refus, une NOUVELLE passe : le suivi est retenté tout de suite, avec la boîte de permission', [watchers(m), m.bg.ajouts[1]?.options.requestPermissions], [2, true]);
  m.bg.ajouts[1].cb(null, { code: 'NOT_AUTHORIZED', message: 'User denied location permission' });
  eq('… et la personne en est avertie de nouveau (une fois par passe)', m.bg.toasts.length, 2);
  m.fin();
}
{
  const m = monde({ telephone: TEL });
  let verifs = 0;
  m.ctx.Capacitor.Plugins.Geolocation.checkPermissions = async () => { verifs++; return { location: 'denied', coarseLocation: 'denied' }; };
  await m.run('majSuiviArrierePlan()');
  m.bg.ajouts[0].cb(null, { code: 'NOT_AUTHORIZED', message: 'User denied location permission' });
  m.run('ARRIERE_PLAN_REESSAI_MS=40');
  await attendre(80);
  await m.run('majSuiviArrierePlan()'); await m.run('majSuiviArrierePlan()'); await m.run('majSuiviArrierePlan()');
  eq('la permission n\'est regardée qu\'UNE fois par minute (pas à chaque tour de 10 secondes)', verifs, 1);
  m.fin();
}
{
  const p = monde({ telephone: { ...TEL, erreurAjout: new Error('Service not running.') } });
  await p.run('majSuiviArrierePlan()'); await p.run('majSuiviArrierePlan()');
  eq('le plugin qui échoue à démarrer n\'est pas martelé à chaque tour : une seule tentative par minute', p.bg.ordre.filter((x) => x === 'addWatcher').length, 1);
  p.fin();
}
{
  const m = monde({ telephone: TEL });
  await m.run('majSuiviArrierePlan()');
  m.bg.ajouts[0].cb(null, { code: 'NOT_AUTHORIZED', message: 'Location services disabled.' });
  eq('le GPS du téléphone est éteint : le suivi RESTE en place (il donnera la position dès que le GPS sera rallumé)', [m.bg.retraits.length, m.run('_suiviArrierePlan.id')], [0, 'w1']);
  eq('… la personne est avertie une fois : « le GPS du téléphone est désactivé »', [m.bg.toasts.length, m.bg.toasts[0]?.includes('GPS du téléphone est désactivé')], [1, true]);
  m.bg.ajouts[0].cb(lecture());
  eq('… et les lectures reprennent ensuite', m.run('lastPosInfo.lat'), 46.7);
  m.bg.ajouts[0].cb(null, { code: 'AUTRE_ERREUR', message: 'quelque chose' });
  eq('une autre erreur du service est ignorée (rien à dire à la personne)', [m.bg.toasts.length, m.bg.retraits.length], [1, 0]);
  m.fin();
  const p = monde({ telephone: { ...TEL, erreurAjout: new Error('Service not running.') } });
  await p.run('majSuiviArrierePlan()');
  eq('le plugin échoue à démarrer : aucun plantage, pas de message, le suivi n\'est pas cru actif', [p.run('_suiviArrierePlan'), p.bg.toasts.length], [null, 0]);
  p.fin();
}

log('=== LA PERMISSION « NOTIFICATIONS » (ANDROID 13 ET PLUS) ===');
{
  const m = monde({ telephone: { notif: 'prompt' } });
  await m.run('majSuiviArrierePlan()');
  eq('pas encore décidée : on la demande AVANT de démarrer le suivi (sans elle la notification resterait cachée)', m.bg.ordre, ['check', 'request', 'addWatcher']);
  m.run('tours = []'); await m.run('majSuiviArrierePlan()');
  m.run('tours = ' + JSON.stringify(CHAUFFEUR)); await m.run('majSuiviArrierePlan()');
  eq('… une seule fois par ouverture de l\'application (la passe suivante ne la redemande pas)', m.bg.ordre.filter((x) => x === 'check' || x === 'request'), ['check', 'request']);
  m.fin();
  const g = monde({ telephone: { notif: 'granted' } });
  await g.run('majSuiviArrierePlan()');
  eq('déjà accordée : rien à demander', g.bg.ordre, ['check', 'addWatcher']);
  g.fin();
  const r = monde({ telephone: { notif: 'prompt-with-rationale' } });
  await r.run('majSuiviArrierePlan()');
  eq('refusée une fois, Android accepte de redemander (« prompt-with-rationale ») : on la demande', r.bg.ordre, ['check', 'request', 'addWatcher']);
  r.fin();
  const d = monde({ telephone: { notif: 'denied' } });
  await d.run('majSuiviArrierePlan()');
  eq('refusée : on ne redemande pas, et le suivi démarre quand même (seule la notification reste cachée)', [d.bg.ordre, watchers(d)], [['check', 'addWatcher'], 1]);
  d.fin();
  const a = monde({ telephone: { notif: null } });
  await a.run('majSuiviArrierePlan()');
  eq('téléphone sans ce plugin (ou Android 12 et moins) : le suivi démarre, sans rien demander', [a.bg.ordre, watchers(a)], [['addWatcher'], 1]);
  a.fin();
}

log('=== LA DÉCONNEXION ET LA MINUTERIE ===');
{
  const m = monde({ telephone: TEL });
  await m.run('majSuiviArrierePlan()');
  await m.run('arreterTracking()');
  eq('la déconnexion arrête le suivi du téléphone (la notification disparaît)', [m.bg.retraits, m.run('_suiviArrierePlan')], [['w1'], null]);
  m.fin();
  const l = monde({ telephone: { ...TEL, retraitMuet: true } });
  await l.run('majSuiviArrierePlan()');
  l.run('ARRIERE_PLAN_ARRET_DELAI_MS=80');
  const t0 = Date.now();
  await l.run('arreterTracking()');
  eq('… sans jamais bloquer la déconnexion si le téléphone ne répond pas', Date.now() - t0 < 1500, true);
  l.fin();
}
{
  const m = monde({ telephone: TEL }); m.position();
  m.run('POSITION_ENVOI_S=0.03; demarrerEnvoiPosition()');
  await attendre(200);
  eq('la minuterie démarre le suivi du téléphone toute seule (avec l\'envoi de la position), une seule fois', [watchers(m), envois(m).length >= 1], [1, true]);
  m.fin();
}

log('=== LE TÉLÉPHONE ET LA PAGE : PLUGIN, PERMISSIONS, NOTIFICATION ===');
{
  const RACINE = fileURLToPath(new URL('../../', import.meta.url));
  const lireR = (f) => fs.readFileSync(RACINE + f, 'utf8');
  const manifeste = lireR('android/app/src/main/AndroidManifest.xml'), t = lire('js/tracking.js');
  const paquet = JSON.parse(lireR('package.json'));
  const gradle = lireR('android/app/capacitor.build.gradle'), reglages = lireR('android/capacitor.settings.gradle');
  vrai('le plugin @capacitor-community/background-geolocation est dans package.json et branché dans le projet Android (npx cap sync a été fait)', !!paquet.dependencies['@capacitor-community/background-geolocation'] && gradle.includes(':capacitor-community-background-geolocation') && reglages.includes('capacitor-community-background-geolocation'));
  vrai('le manifeste déclare le service de premier plan « position » et la permission « notifications »', ['android.permission.FOREGROUND_SERVICE"', 'android.permission.FOREGROUND_SERVICE_LOCATION', 'android.permission.POST_NOTIFICATIONS'].every((p) => manifeste.includes(p)));
  vrai('… et PAS « Toujours autoriser la position » (ACCESS_BACKGROUND_LOCATION) : le service de premier plan suffit', !manifeste.includes('android.permission.ACCESS_BACKGROUND_LOCATION'));
  vrai('… et le GPS reste facultatif pour installer l\'application (le plugin le déclare obligatoire : tools:replace le corrige)', /<uses-feature android:name="android\.hardware\.location\.gps" android:required="false" tools:replace="android:required" \/>/.test(manifeste) && manifeste.includes('xmlns:tools='));
  const java = lireR('android/app/src/main/java/com/entretienlapointe/tracker/NotificationPermissionPlugin.java'), main = lireR('android/app/src/main/java/com/entretienlapointe/tracker/MainActivity.java');
  vrai('le petit plugin de l\'application demande la permission « notifications » (check et request) et MainActivity l\'enregistre AVANT super.onCreate', java.includes('POST_NOTIFICATIONS') && java.includes('public void check(') && java.includes('public void request(') && /registerPlugin\(NotificationPermissionPlugin\.class\);\s*\n\s*super\.onCreate/.test(main));
  vrai('la notification : titre « Lapointe Tracker », texte « Passe en cours : la position du camion est partagée »', t.includes("const NOTIFICATION_TITRE='Lapointe Tracker';") && t.includes("const NOTIFICATION_MESSAGE='Passe en cours : la position du camion est partagée';"));
  vrai('le suivi du téléphone se règle à la minuterie (tourEnvoiPosition) : il démarre et s\'arrête avec ma passe, et à la déconnexion', /function tourEnvoiPosition\(\)\{[^}]*majSuiviArrierePlan\(\)/.test(t) && /async function arreterTracking\(\)\{[^]*?await arreterSuiviArrierePlan\(\);/.test(t));
  vrai('les lectures du service passent par position.js (noterPosition) : une seule règle de fraîcheur', /noterPosition\(lecture\.latitude,lecture\.longitude,lecture\.accuracy,lecture\.time\)/.test(t));
}

log('=== LE CODE ===');
{
  const t = lire('js/tracking.js'), ar = lire('js/arrets.js'), au = lire('js/auth.js'), page = lire('index.html');
  const sansCommentaires = (s) => s.replace(/\/\/[^\n]*/g, '');
  const fichiers = fs.readdirSync(WWW + 'js').filter((f) => f.endsWith('.js'));
  vrai('le chargement des arrêts démarre l\'envoi dans les DEUX chemins (avec signal, et sans signal après avoir repris les copies)', (ar.match(/demarrerEnvoiPosition\(\)/g) || []).length === 2 && /demarrerRelecturePositions\(\);\s*\n\s*if\(typeof demarrerEnvoiPosition==='function'\) demarrerEnvoiPosition\(\);/.test(ar));
  vrai('la déconnexion arrête l\'envoi (arreterTracking)', au.includes('await arreterTracking()'));
  vrai('la page charge tracking.js', page.includes('js/tracking.js'));
  vrai('la position n\'est JAMAIS mise dans la file des gestes (seule la dernière compte)', !/enfiler\(/.test(sansCommentaires(t)));
  vrai('le serveur est appelé avec un délai (avecDelai), par la fonction envoyer_position, sans heure envoyée', /avecDelai\(db\.rpc\('envoyer_position'/.test(t) && !/p_moment/.test(sansCommentaires(t)));
  vrai('la position vient de position.js (positionConnue), jamais d\'une lecture directe du navigateur', /positionConnue\(POSITION_ENVOI_FRAICHE_S\)/.test(t) && !/navigator\.geolocation/.test(t));
  const ecrivent = fichiers.filter((f) => /from\('positions'\)\s*\.\s*(upsert|insert|update|delete)/.test(lire('js/' + f)));
  eq('aucun fichier n\'écrit directement dans la table « positions » (seul le serveur le fait, par envoyer_position)', ecrivent, []);
  const anciens = fichiers.filter((f) => /ANCIEN_SUIVI_ACTIF|demarrerTracking|verifierProximite|tracteurs\b/.test(lire('js/' + f)));
  eq('l\'ancien suivi (une ligne par employé) n\'existe plus', anciens, []);
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
