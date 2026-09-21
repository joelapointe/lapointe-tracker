// Étape 17, morceau 3 — LA POSITION DU TÉLÉPHONE (www/js/position.js) : obtenirPosition() (jamais bloquante : 6 s au plus), le suivi continu, la permission
// (une seule demande) et le texte de la confirmation. Les VRAIS fichiers sont chargés dans un faux navigateur avec un faux GPS de navigateur et un faux plugin
// de téléphone (@capacitor/geolocation). WWW_TEST : un autre dossier « www » (erreurs volontaires).
import vm from 'vm';
import fs from 'fs';
import { fileURLToPath } from 'url';
const WWW = process.env.WWW_TEST ? process.env.WWW_TEST.split('\\').join('/').replace(/\/?$/, '/') : fileURLToPath(new URL('../../www/', import.meta.url));
const RACINE = fileURLToPath(new URL('../../', import.meta.url));

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
const lire = (f) => fs.readFileSync(WWW + f, 'utf8');
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

// Un monde : faux navigateur (avec ou sans GPS, avec ou sans plugin de téléphone) + position.js et config.js
function monde(o = {}) {
  const appels = { lectures: [], suivis: [], demandes: 0 };
  const lecture = o.lecture ?? (() => ({ coords: { latitude: 46.5, longitude: -72.7, accuracy: 9 }, timestamp: Date.now() }));
  const executer = async () => {
    if (o.delaiLectureMs) await attendre(o.delaiLectureMs);
    if (o.jamais) return new Promise(() => {});
    if (o.erreurLecture) throw o.erreurLecture;
    return lecture();
  };
  const sandbox = { console, setTimeout, clearTimeout, localStorage: { getItem: () => null, setItem() {} } };
  if (o.navigateur !== false) {
    sandbox.navigator = {
      geolocation: {
        getCurrentPosition: (bon, mauvais, opts) => { appels.lectures.push({ via: 'navigateur', opts }); executer().then(bon, mauvais); },
        watchPosition: (bon, mauvais, opts) => { appels.suivis.push({ via: 'navigateur', opts, bon, mauvais }); return 1; },
      },
      permissions: o.permissionsNavigateur ? { query: async () => ({ state: o.permissionsNavigateur }) } : undefined,
    };
  }
  if (o.plugin) {
    let perm = o.plugin.perm;
    sandbox.Capacitor = { isPluginAvailable: (n) => !o.plugin.indisponible && n === 'Geolocation', Plugins: { Geolocation: {
      getCurrentPosition: async (opts) => { appels.lectures.push({ via: 'plugin', opts }); return executer(); },
      watchPosition: async (opts, cb) => { appels.suivis.push({ via: 'plugin', opts, cb }); if (o.plugin.erreurSuivi) throw o.plugin.erreurSuivi; return 'id-suivi'; },
      checkPermissions: async () => { if (o.plugin.erreurPermission) throw o.plugin.erreurPermission; return perm; },
      requestPermissions: async () => { appels.demandes++; perm = o.plugin.permApres ?? perm; return perm; },
    } } };
  }
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/config.js', 'js/position.js']) vm.runInContext(lire(f), ctx, { filename: f });
  if (o.attenteMs) vm.runInContext('POSITION_ATTENTE_MS=' + o.attenteMs, ctx);
  return { ctx, appels, run: (c) => vm.runInContext(c, ctx) };
}
const vieille = (m, secondes, precision = 15) => m.run(`noterPosition(46.1,-72.2,${precision}); lastPosInfo.le=Date.now()-${secondes * 1000}`);   // une lecture d'il y a N secondes
const duree = async (f) => { const t = Date.now(); const r = await f(); return [r, Date.now() - t]; };

log('=== LA DERNIÈRE LECTURE CONNUE ===');
{
  const m = monde();
  m.run('noterPosition(46.5,-72.7,12.4)');
  eq('une lecture notée : les coordonnées ET la précision sont gardées (lastPos, lastPosInfo)', [m.run('lastPos'), m.run('lastPosInfo.lat'), m.run('lastPosInfo.lon'), m.run('lastPosInfo.precision')], [[46.5, -72.7], 46.5, -72.7, 12.4]);
  vrai('… avec l\'heure de la lecture (maintenant)', Math.abs(m.run('lastPosInfo.le') - Date.now()) < 2000);
  m.run('noterPosition(45,-71,3,Date.now()-5000)');
  vrai('l\'heure donnée par l\'appareil (il y a 5 s) est utilisée', Math.abs(m.run('lastPosInfo.le') - (Date.now() - 5000)) < 2000);
  m.run('noterPosition(45,-71,3,Date.now()-3*3600000)');
  vrai('une heure ABSURDE (il y a 3 h) est remplacée par maintenant', Math.abs(m.run('lastPosInfo.le') - Date.now()) < 2000);
  m.run('noterPosition(44,-70,-5)');
  eq('une précision négative ou absente : « précision inconnue » (null)', [m.run('lastPosInfo.precision'), (m.run('noterPosition(43,-69)'), m.run('lastPosInfo.precision'))], [null, null]);
  m.run('noterPosition(50,-60,10)');
  m.run('noterPosition("x",-60,10); noterPosition(NaN,-60,10); noterPosition(50,undefined,10)');
  eq('des coordonnées invalides sont ignorées (la lecture précédente reste)', m.run('lastPos'), [50, -60]);
}

log('=== LES DÉLAIS (décidés avec Joé) ===');
{
  const m = monde();
  eq('lecture continue « récente » : 20 secondes ; attente d\'une lecture fraîche : 6 secondes ; dernière lecture reprise : 2 minutes', [m.run('POSITION_FRAICHE_S'), m.run('POSITION_ATTENTE_MS'), m.run('POSITION_RECENTE_S')], [20, 6000, 120]);
}

log('\n=== obtenirPosition() : LA LECTURE CONTINUE RÉCENTE EST UTILISÉE TOUT DE SUITE ===');
{
  const m = monde();
  m.run('noterPosition(46.5,-72.7,12)');
  const [p, ms] = await duree(() => m.run('obtenirPosition()'));
  eq('une lecture de moins de 20 s : utilisée, avec sa précision', [p.lat, p.lon, p.precision, p.source], [46.5, -72.7, 12, 'continue']);
  eq('… sans AUCUNE lecture fraîche, et sans attendre', [m.appels.lectures.length, ms < 100], [0, true]);
  vieille(m, 19);
  eq('19 s : encore « récente »', m.run('obtenirPosition()').then ? (await m.run('obtenirPosition()')).source : null, 'continue');
}

log('\n=== obtenirPosition() : UNE LECTURE FRAÎCHE QUAND LA DERNIÈRE EST TROP VIEILLE ===');
{
  const m = monde({ lecture: () => ({ coords: { latitude: 46.6, longitude: -72.8, accuracy: 7 }, timestamp: Date.now() }) });
  vieille(m, 21);
  const p = await m.run('obtenirPosition()');
  eq('une lecture de 21 s : on en lit une NOUVELLE (précision élevée), qui est utilisée', [p.lat, p.lon, p.precision, p.source, p.ageS], [46.6, -72.8, 7, 'fraiche', 0]);
  eq('… elle est demandée avec la précision élevée, une limite plus courte que la nôtre et sans vieille copie de plus de 20 s', [m.appels.lectures.length, m.appels.lectures[0].via, m.appels.lectures[0].opts.enableHighAccuracy, m.appels.lectures[0].opts.timeout < 6000, m.appels.lectures[0].opts.maximumAge], [1, 'navigateur', true, true, 20000]);
  eq('… et elle devient la dernière lecture connue', [m.run('lastPos'), m.run('lastPosInfo.precision')], [[46.6, -72.8], 7]);
  const n = monde({ lecture: () => ({ coords: { latitude: 47, longitude: -73, accuracy: 30.4 }, timestamp: Date.now() }) });
  const q = await n.run('obtenirPosition()');
  eq('aucune lecture connue du tout : une lecture fraîche', [q.source, q.precision], ['fraiche', 30.4]);
}

log('\n=== obtenirPosition() : JAMAIS BLOQUANTE (6 secondes au plus), JAMAIS D\'ERREUR ===');
{
  const m = monde({ erreurLecture: new Error('User denied Geolocation') });
  vieille(m, 60);
  const p = await m.run('obtenirPosition()');
  eq('la lecture fraîche est REFUSÉE : la dernière lecture (60 s) est reprise, marquée « récente »', [p.source, p.lat, p.ageS >= 59 && p.ageS <= 62], ['recente', 46.1, true]);
  vieille(m, 200);
  eq('… mais une lecture de 200 s (plus de 2 minutes) n\'est PAS reprise : « sans position »', await m.run('obtenirPosition()'), null);
  const n = monde({ jamais: true, attenteMs: 120 });
  const [r, ms] = await duree(() => n.run('obtenirPosition()'));
  vrai('un GPS qui ne répond JAMAIS : le punch n\'attend que la limite (ici 120 ms au lieu de 6 s), puis « sans position »', r === null && ms >= 100 && ms < 1500, `${JSON.stringify(r)} en ${ms} ms`);
  const t = monde({ delaiLectureMs: 300, attenteMs: 100 });
  const [r2, ms2] = await duree(() => t.run('obtenirPosition()'));
  eq('une lecture trop lente : « sans position » à la limite', [r2, ms2 < 250], [null, true]);
  await attendre(350);
  eq('… mais quand elle arrive quand même, elle est GARDÉE pour le punch suivant', [t.run('lastPos'), t.run('lastPosInfo.precision')], [[46.5, -72.7], 9]);
  const v = monde({ lecture: () => ({ coords: {} }) });
  eq('une lecture sans coordonnées : « sans position », sans erreur', await v.run('obtenirPosition()'), null);
  const w = monde({ navigateur: false });
  const [r3, ms3] = await duree(() => w.run('obtenirPosition()'));
  eq('AUCUN GPS (ni plugin, ni navigateur) : « sans position » tout de suite', [r3, ms3 < 100], [null, true]);
  w.run('noterPosition(46,-72,20)');
  eq('… ou la lecture récente déjà connue', (await w.run('obtenirPosition()')).source, 'continue');
}
{
  const m = monde({ lecture: () => { throw new Error('boum'); } });
  let erreur = null;
  try { await m.run('obtenirPosition()'); } catch (e) { erreur = e; }
  eq('quoi qu\'il arrive dans le GPS, obtenirPosition() ne lève JAMAIS d\'erreur', erreur, null);
}
{
  const m = monde({ delaiLectureMs: 60 });
  const [a, b] = await Promise.all([m.run('obtenirPosition()'), m.run('obtenirPosition()')]);
  eq('deux demandes en même temps (deux touchers rapprochés) : UNE SEULE lecture du GPS, le même résultat', [m.appels.lectures.length, JSON.stringify(a) === JSON.stringify(b), a.source], [1, true, 'fraiche']);
  const c = await m.run('obtenirPosition()');
  eq('… ensuite la lecture est récente : plus de nouvelle lecture', [m.appels.lectures.length, c.source], [1, 'continue']);
}

log('\n=== LE PLUGIN DU TÉLÉPHONE PASSE AVANT LE NAVIGATEUR ===');
{
  const m = monde({ plugin: { perm: { location: 'granted', coarseLocation: 'granted' } } });
  const p = await m.run('obtenirPosition()');
  eq('avec le plugin : c\'est LUI qui lit (pas le navigateur), avec les mêmes options', [p.source, m.appels.lectures.length, m.appels.lectures[0].via, m.appels.lectures[0].opts.enableHighAccuracy], ['fraiche', 1, 'plugin', true]);
  const n = monde({ plugin: { perm: { location: 'denied', coarseLocation: 'denied' } }, erreurLecture: new Error('Location permission was denied') });
  eq('le plugin refuse (permission) : « sans position », le punch continue', await n.run('obtenirPosition()'), null);
  eq('… et on ne tente PAS le navigateur derrière son dos (même permission)', n.appels.lectures.map((x) => x.via), ['plugin']);
}

{
  const m = monde({ plugin: { perm: { location: 'granted', coarseLocation: 'granted' }, indisponible: true } });
  const p = await m.run('obtenirPosition()');
  eq('un plugin déclaré INDISPONIBLE par Capacitor (pas sur ce téléphone) : on lit avec le navigateur', [p.source, m.appels.lectures.map((x) => x.via)], ['fraiche', ['navigateur']]);
}

log('\n=== LE SUIVI CONTINU (la carte) ===');
{
  const m = monde();
  eq('avec un GPS de navigateur : le suivi démarre', m.run('globalThis.__recu=[];globalThis.__erreurs=[];demarrerSuiviPosition(p=>globalThis.__recu.push(p),e=>globalThis.__erreurs.push(e))'), true);
  eq('… avec la précision élevée, une vieille lecture de 5 s au plus, 15 s de patience', [m.appels.suivis.length, m.appels.suivis[0].opts], [1, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }]);
  m.appels.suivis[0].bon({ coords: { latitude: 46.7, longitude: -72.9, accuracy: 5 }, timestamp: Date.now() });
  eq('une lecture reçue : la carte la reçoit ET elle devient la dernière lecture (avec sa précision)', [m.run('globalThis.__recu.length'), m.run('lastPos'), m.run('lastPosInfo.precision')], [1, [46.7, -72.9], 5]);
  m.appels.suivis[0].mauvais(new Error('timeout'));
  eq('un échec : la carte le sait (« Erreur »)', m.run('globalThis.__erreurs.length'), 1);
  eq('un 2e démarrage ne recommence pas un suivi (une seule surveillance)', [m.run('demarrerSuiviPosition(()=>{},()=>{})'), m.appels.suivis.length], [true, 1]);
  eq('sans aucun GPS : le suivi ne démarre pas (false)', monde({ navigateur: false }).run('demarrerSuiviPosition(()=>{},()=>{})'), false);
  const n = monde({ plugin: { perm: { location: 'granted', coarseLocation: 'granted' } } });
  n.run('globalThis.__recu=[];globalThis.__erreurs=[];demarrerSuiviPosition(p=>__recu.push(p),e=>__erreurs.push(e))');
  await attendre(20);
  eq('avec le plugin : c\'est le plugin qui surveille (pas le navigateur)', [n.appels.suivis.length, n.appels.suivis[0].via, n.appels.suivis[0].opts.enableHighAccuracy], [1, 'plugin', true]);
  n.appels.suivis[0].cb({ coords: { latitude: 46.8, longitude: -73, accuracy: 6 }, timestamp: Date.now() }, null);
  n.appels.suivis[0].cb(null, new Error('Location permission was denied'));
  eq('le plugin donne une lecture, puis une erreur : la carte reçoit les deux, la lecture est gardée avec sa précision', [n.run('__recu.length'), n.run('__erreurs.length'), n.run('lastPosInfo.precision')], [1, 1, 6]);
  const p = monde({ plugin: { perm: { location: 'granted', coarseLocation: 'granted' }, erreurSuivi: new Error('refusé') } });
  p.run('globalThis.__erreurs=[];demarrerSuiviPosition(()=>{},e=>__erreurs.push(e))');
  await attendre(20);
  eq('le plugin ne peut pas surveiller : la carte le sait, et un nouvel essai est possible', [p.run('__erreurs.length'), p.run('_suiviDemarre')], [1, false]);
}

log('\n=== LA PERMISSION DE LOCALISATION ===');
const etat = (perm) => monde({ plugin: { perm } }).run('etatPermissionPosition()');
{
  eq('précise accordée : « accordée »', await etat({ location: 'granted', coarseLocation: 'granted' }), 'accordee');
  eq('SEULEMENT approximative (Android 12 : la personne a choisi « approximative ») : « accordée »', await etat({ location: 'prompt', coarseLocation: 'granted' }), 'accordee');
  eq('jamais demandée : « à demander »', await etat({ location: 'prompt', coarseLocation: 'prompt' }), 'a_demander');
  eq('« prompt-with-rationale » (refusée une fois) : « à demander »', await etat({ location: 'prompt-with-rationale', coarseLocation: 'prompt-with-rationale' }), 'a_demander');
  eq('refusée : « refusée »', await etat({ location: 'denied', coarseLocation: 'denied' }), 'refusee');
  eq('le GPS du téléphone est ÉTEINT (le plugin lève une erreur) : « gps_desactive »', await monde({ plugin: { erreurPermission: new Error('Location services are not enabled') } }).run('etatPermissionPosition()'), 'gps_desactive');
  eq('une autre erreur du plugin : « inconnue » (jamais un plantage)', await monde({ plugin: { erreurPermission: new Error('boum') } }).run('etatPermissionPosition()'), 'inconnue');
  eq('navigateur : l\'API de permissions du navigateur (accordée / refusée / à demander)', [await monde({ permissionsNavigateur: 'granted' }).run('etatPermissionPosition()'), await monde({ permissionsNavigateur: 'denied' }).run('etatPermissionPosition()'), await monde({ permissionsNavigateur: 'prompt' }).run('etatPermissionPosition()')], ['accordee', 'refusee', 'a_demander']);
  eq('navigateur sans API de permissions : « inconnue »', await monde().run('etatPermissionPosition()'), 'inconnue');
}
{
  const m = monde({ plugin: { perm: { location: 'prompt', coarseLocation: 'prompt' }, permApres: { location: 'granted', coarseLocation: 'granted' } } });
  eq('jamais demandée : UNE demande est faite (la boîte du système), et l\'état devient « accordée »', [await m.run('demanderPermissionPosition()'), m.appels.demandes, m.run('_permissionPosition')], ['accordee', 1, 'accordee']);
  await m.run('demanderPermissionPosition()');
  eq('un 2e appel (rechargement des arrêts…) ne redemande RIEN : UNE seule demande par ouverture', m.appels.demandes, 1);
  const fermee = monde({ plugin: { perm: { location: 'prompt', coarseLocation: 'prompt' }, permApres: { location: 'prompt', coarseLocation: 'prompt' } } });
  await fermee.run('demanderPermissionPosition()'); await fermee.run('demanderPermissionPosition()');
  eq('la fenêtre du système est fermée SANS réponse : on ne redemande pas dans la foulée (une seule demande par ouverture)', fermee.appels.demandes, 1);
  const n = monde({ plugin: { perm: { location: 'prompt', coarseLocation: 'prompt' }, permApres: { location: 'denied', coarseLocation: 'denied' } } });
  eq('la personne REFUSE : l\'état devient « refusée » (l\'écran d\'accueil le dira)', [await n.run('demanderPermissionPosition()'), n.run('_permissionPosition')], ['refusee', 'refusee']);
  const p = monde({ plugin: { perm: { location: 'granted', coarseLocation: 'granted' } } });
  await p.run('demanderPermissionPosition()');
  eq('déjà accordée : on ne demande rien', p.appels.demandes, 0);
  const q = monde({ plugin: { perm: { location: 'denied', coarseLocation: 'denied' } } });
  await q.run('demanderPermissionPosition()');
  eq('déjà refusée : on ne redemande PAS (jamais d\'insistance)', q.appels.demandes, 0);
  const r = monde({ permissionsNavigateur: 'prompt' });
  eq('navigateur : rien à demander d\'ici (le navigateur montre sa boîte à la première lecture)', [await r.run('demanderPermissionPosition()'), r.appels.demandes], ['a_demander', 0]);
}

log('\n=== LE TEXTE DE LA CONFIRMATION (« 📍 … ») ===');
{
  const m = monde();
  eq('position enregistrée : la précision est arrondie', [m.run('textePosition({lat:1,lon:2,precision:12.4,source:"fraiche"})'), m.run('textePosition({lat:1,lon:2,precision:12.6,source:"continue"})')], ['📍 Position enregistrée (±12 m)', '📍 Position enregistrée (±13 m)']);
  eq('précision inconnue : pas de « ± »', m.run('textePosition({lat:1,lon:2,precision:null,source:"continue"})'), '📍 Position enregistrée');
  eq('une lecture plus ancienne : « Dernière position connue »', m.run('textePosition({lat:1,lon:2,precision:20,source:"recente"})'), '📍 Dernière position connue (±20 m)');
  eq('sans position : le GPS n\'a pas répondu', m.run('textePosition(null)'), '📍 Sans position : le GPS n’a pas répondu');
  m.run('_permissionPosition="refusee"');
  eq('… la localisation est refusée', m.run('textePosition(null)'), '📍 Sans position : la localisation est refusée pour cette application');
  m.run('_permissionPosition="gps_desactive"');
  eq('… le GPS du téléphone est désactivé', m.run('textePosition(null)'), '📍 Sans position : le GPS du téléphone est désactivé');
  const tous = [m.run('textePosition(null)'), m.run('textePosition({lat:1,lon:2,precision:5,source:"fraiche"})')];
  vrai('jamais « ⚠ » : un quart sans position n\'est pas une erreur', tous.every((t) => !t.includes('⚠')));
}

log('\n=== LE TÉLÉPHONE ET LA PAGE : PERMISSIONS, PLUGIN, ORDRE DES FICHIERS ===');
{
  const manifeste = fs.readFileSync(RACINE + 'android/app/src/main/AndroidManifest.xml', 'utf8');
  vrai('le manifeste Android déclare la position PRÉCISE et la position APPROXIMATIVE', manifeste.includes('android.permission.ACCESS_FINE_LOCATION') && manifeste.includes('android.permission.ACCESS_COARSE_LOCATION'));
  vrai('… mais PAS la position en arrière-plan (c\'est l\'étape 18 : une permission spéciale, justifiée à Google Play)', !manifeste.includes('android.permission.ACCESS_BACKGROUND_LOCATION'));
  vrai('… et la permission Internet est toujours là', manifeste.includes('android.permission.INTERNET'));
  const paquet = JSON.parse(fs.readFileSync(RACINE + 'package.json', 'utf8'));
  vrai('le plugin officiel @capacitor/geolocation (version 8, comme Capacitor) est dans package.json', /^\^8\./.test(paquet.dependencies['@capacitor/geolocation'] || ''), JSON.stringify(paquet.dependencies));
  const gradle = fs.readFileSync(RACINE + 'android/app/capacitor.build.gradle', 'utf8'), reglages = fs.readFileSync(RACINE + 'android/capacitor.settings.gradle', 'utf8');
  vrai('… et il est branché dans le projet Android (npx cap sync a été fait)', gradle.includes(':capacitor-geolocation') && reglages.includes('capacitor-geolocation'));
  const page = lire('index.html');
  vrai('la page charge position.js APRÈS config.js et AVANT carte.js', page.indexOf('js/config.js') < page.indexOf('js/position.js') && page.indexOf('js/position.js') < page.indexOf('js/carte.js'));
  const carte = lire('js/carte.js'), arrets = lire('js/arrets.js');
  vrai('la carte utilise le suivi de position.js (plugin ou navigateur) et demande la permission une seule fois', carte.includes('demarrerSuiviPosition(') && carte.includes('demanderPermissionPosition()') && !/navigator\.geolocation\.watchPosition/.test(carte));
  vrai('le suivi démarre APRÈS la connexion (loadStops), pas au chargement de la page', /demarrerSuiviGps\(\)/.test(arrets) && !/^\s*demarrerSuiviGps\(\)/m.test(carte));
}

log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
