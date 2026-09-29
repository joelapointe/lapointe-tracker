// Demande 4 de Joé (29 sept. 2026) — REMETTRE UN FICHIER (www/js/partage-fichier.js) : le PDF du suivi et le CSV de la paie. Sur le téléphone (APK Capacitor) un « téléchargement » ne fait RIEN (aucun écouteur de
// téléchargement dans Capacitor ni dans l'application) : le fichier est écrit dans le dossier temporaire par le plugin « Filesystem », puis la feuille de partage d'Android est ouverte par le plugin « Share ».
// Dans un navigateur : le téléchargement habituel. Les VRAIS fichiers de l'application sont chargés dans un faux navigateur avec de FAUX plugins qui notent chaque appel.
// Ce que ce test ne peut PAS vérifier : la vraie feuille de partage d'Android (essai sur le téléphone de Joé).
// WWW_TEST : un autre dossier « www » (erreurs volontaires : voir erreurs-volontaires.mjs).
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
const attendre = () => new Promise((r) => setImmediate(r));
const ERREUR = '❌ Le fichier n’a pas pu être envoyé.';
const OPTIONS = { nom: 'essai.pdf', typeMime: 'application/pdf', titre: 'Un titre', invite: 'Envoyer l\'essai', erreur: ERREUR, telecharge: '✔ Essai téléchargé' };

// Un faux navigateur + de faux plugins ; les vrais partage-fichier.js, admin-export.js et « pluginNatif » (de tracking.js)
function monde(o = {}) {
  const appels = { toasts: [], writeFile: [], share: [], blobs: [], urls: [], minuteries: [], clics: [] };
  const body = { children: [], appendChild(e) { e.parent = body; body.children.push(e); return e; }, removeChild(e) { body.children = body.children.filter((x) => x !== e); } };
  const creerA = () => ({ tagName: 'A', href: '', download: '', parent: null, click() { appels.clics.push({ href: this.href, download: this.download, dansLaPage: body.children.includes(this) }); }, remove() { if (this.parent) body.removeChild(this); } });
  const capacitor = o.capacitor === undefined ? undefined : o.capacitor(appels);
  const sandbox = {
    document: { createElement: creerA, body }, console, btoa, TextEncoder,
    toast: (m) => appels.toasts.push(m),
    setTimeout: (f, ms) => { appels.minuteries.push({ f, ms }); return appels.minuteries.length; },
    Blob: class { constructor(parts, opts) { this.parts = parts; this.type = opts && opts.type; appels.blobs.push(this); } },
    URL: { createObjectURL: (b) => { appels.urls.push(['creer']); return 'blob:essai-' + appels.urls.length; }, revokeObjectURL: (u) => appels.urls.push(['liberer', u]) },
  };
  if (capacitor !== undefined && capacitor !== null) sandbox.Capacitor = capacitor;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(lire('js/partage-fichier.js'), ctx, { filename: 'js/partage-fichier.js' });
  vm.runInContext(lire('js/admin-export.js'), ctx, { filename: 'js/admin-export.js' });
  const fonction = lire('js/tracking.js').match(/function pluginNatif\(nom\)\{[\s\S]*?\n\}/);
  if (!fonction) throw new Error('pluginNatif est introuvable dans tracking.js');
  vm.runInContext(fonction[0], ctx);
  return { ctx, appels, body, run: (c) => vm.runInContext(c, ctx) };
}
// Un faux Capacitor (téléphone) : les deux plugins, qui marchent ou pas
const telephone = (opts = {}) => (appels) => ({
  Plugins: {
    Filesystem: { writeFile: async (a) => { appels.writeFile.push(a); if (opts.erreurEcriture) throw new Error(opts.erreurEcriture); return opts.sansUri ? {} : { uri: 'file:///data/user/0/com.entretienlapointe.tracker/cache/' + a.path }; } },
    Share: { share: async (a) => { appels.share.push({ ...a, apresEcriture: appels.writeFile.length }); if (opts.attente) await opts.attente; if (opts.erreurPartage) throw (opts.rejetTexte ? opts.erreurPartage : new Error(opts.erreurPartage)); return { activityType: 'x' }; } },
  },
  isPluginAvailable: (n) => !(opts.absents || []).includes(n), isNativePlatform: () => opts.natif !== false,
});
const octets = (...n) => Uint8Array.from(n);

log('=== LES OCTETS EN BASE64 ===');
{
  const m = monde();
  m.ctx.__o = octets(0, 1, 2, 250, 251, 252, 253, 254, 255);
  eq('des octets de toutes sortes (0 à 255) : le même base64 que Buffer', m.run('octetsEnBase64(__o)'), Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]).toString('base64'));
  eq('aucun octet : un texte vide', m.run('octetsEnBase64(new Uint8Array(0))'), '');
  eq('100 000 octets (plusieurs paquets de 8192) : identique à Buffer, rien de perdu ni de doublé', m.run('octetsEnBase64(new Uint8Array(100000).fill(200))') === Buffer.alloc(100000, 200).toString('base64'), true);
  m.ctx.__g = new Uint8Array(20000).map((_, i) => (i * 7 + (i >> 8)) & 255);
  eq('… avec des octets qui changent (chaque paquet a son propre contenu)', m.run('octetsEnBase64(__g)') === Buffer.from(m.ctx.__g).toString('base64'), true);
  eq('8192 octets exactement, puis 8193 (les frontières d\'un paquet)', [m.run('octetsEnBase64(new Uint8Array(8192).fill(1))') === Buffer.alloc(8192, 1).toString('base64'), m.run('octetsEnBase64(new Uint8Array(8193).fill(1))') === Buffer.alloc(8193, 1).toString('base64')], [true, true]);
}

log('\n=== SUR LE TÉLÉPHONE : ÉCRIRE DANS LE DOSSIER TEMPORAIRE, PUIS OUVRIR LE PARTAGE ===');
{
  const m = monde({ capacitor: telephone() });
  m.ctx.__o = octets(37, 80, 68, 70);
  const r = await m.run('remettreFichier(__o, ' + JSON.stringify(OPTIONS) + ')');
  eq('« Filesystem » : UN fichier, avec le nom donné, dans le dossier temporaire (CACHE), en base64 ; rien d\'autre dans la demande', [r, m.appels.writeFile, Object.keys(m.appels.writeFile[0]).sort()], ['partage', [{ path: 'essai.pdf', data: Buffer.from('%PDF').toString('base64'), directory: 'CACHE' }], ['data', 'directory', 'path']]);
  eq('« Share » : UNE fois, APRÈS l\'écriture, avec le chemin rendu par l\'écriture, le titre (sujet et texte) et le titre de la fenêtre', [m.appels.share.length, m.appels.share[0].apresEcriture, m.appels.share[0].url, m.appels.share[0].title, m.appels.share[0].text, m.appels.share[0].dialogTitle],
    [1, 1, 'file:///data/user/0/com.entretienlapointe.tracker/cache/essai.pdf', 'Un titre', 'Un titre', 'Envoyer l\'essai']);
  eq('… rien n\'est téléchargé (aucun lien, aucun fichier du navigateur)', [m.appels.clics.length, m.appels.blobs.length], [0, 0]);
  const e1 = monde({ capacitor: telephone({ sansUri: true }) });
  e1.ctx.__o = octets(1);
  let msg = null; try { await e1.run('remettreFichier(__o, ' + JSON.stringify(OPTIONS) + ')'); } catch (e) { msg = e.message; }
  eq('l\'écriture ne rend pas le chemin du fichier : une erreur, le partage n\'est PAS ouvert', [msg, e1.appels.share.length], ['fichier non écrit', 0]);
  const e2 = monde({ capacitor: telephone({ erreurEcriture: 'ENOSPC' }) });
  e2.ctx.__o = octets(1);
  msg = null; try { await e2.run('remettreFichier(__o, ' + JSON.stringify(OPTIONS) + ')'); } catch (e) { msg = e.message; }
  eq('l\'écriture échoue (téléphone plein…) : l\'erreur remonte, le partage n\'est pas ouvert', [msg, e2.appels.share.length], ['ENOSPC', 0]);
  const e3 = monde({ capacitor: telephone({ absents: ['Share'] }) });
  e3.ctx.__o = octets(1);
  msg = null; try { await e3.run('remettreFichier(__o, ' + JSON.stringify(OPTIONS) + ')'); } catch (e) { msg = e.message; }
  eq('téléphone SANS le plugin « Share » (une vieille version) : une erreur claire, RIEN d\'écrit, aucun faux téléchargement', [msg, e3.appels.writeFile.length, e3.appels.clics.length, e3.appels.blobs.length], ['plugins de partage absents', 0, 0, 0]);
  const e4 = monde({ capacitor: telephone({ absents: ['Filesystem'] }) });
  e4.ctx.__o = octets(1);
  msg = null; try { await e4.run('remettreFichier(__o, ' + JSON.stringify(OPTIONS) + ')'); } catch (e) { msg = e.message; }
  eq('… ou SANS le plugin « Filesystem » : de même', [msg, e4.appels.share.length, e4.appels.clics.length], ['plugins de partage absents', 0, 0]);
  const e5 = monde({ capacitor: () => ({ Plugins: {}, isPluginAvailable: () => false, isNativePlatform: () => true }) });
  e5.ctx.__o = octets(1);
  msg = null; try { await e5.run('remettreFichier(__o, ' + JSON.stringify(OPTIONS) + ')'); } catch (e) { msg = e.message; }
  eq('un téléphone sans aucun des deux plugins : la même erreur', [msg, e5.appels.clics.length], ['plugins de partage absents', 0]);
}

log('\n=== DANS UN NAVIGATEUR : LE TÉLÉCHARGEMENT ===');
{
  const web = (capacitor) => monde({ capacitor });
  for (const [nom, cap] of [['sans Capacitor du tout', undefined], ['avec un Capacitor de navigateur (pas de plateforme native, pas de plugins)', () => ({ Plugins: {}, isPluginAvailable: () => false, isNativePlatform: () => false })], ['avec un Capacitor sans « isNativePlatform »', () => ({ Plugins: {}, isPluginAvailable: () => false })]]) {
    const m = web(cap);
    m.ctx.__o = octets(37, 80, 68, 70);
    const r = await m.run('remettreFichier(__o, ' + JSON.stringify(OPTIONS) + ')');
    eq('téléchargement ' + nom + ' : un Blob du bon type, un lien vers lui avec le nom du fichier, cliqué DANS la page, puis retiré', [r, m.appels.blobs.length, m.appels.blobs[0].type, m.appels.clics, m.body.children.length], ['telecharge', 1, 'application/pdf', [{ href: 'blob:essai-1', download: 'essai.pdf', dansLaPage: true }], 0]);
  }
  const m = web(undefined);
  m.ctx.__o = octets(1, 2, 3);
  await m.run('remettreFichier(__o, ' + JSON.stringify({ ...OPTIONS, typeMime: 'text/csv;charset=utf-8', nom: 'paie.csv' }) + ')');
  eq('le type du fichier est celui demandé (« text/csv;charset=utf-8 »), et le contenu est bien celui donné', [m.appels.blobs[0].type, Array.from(m.appels.blobs[0].parts[0])], ['text/csv;charset=utf-8', [1, 2, 3]]);
  eq('l\'adresse temporaire du fichier est libérée plus tard : une minuterie de 60 secondes', [m.appels.urls.map((u) => u[0]), m.appels.minuteries.map((x) => x.ms)], [['creer'], [60000]]);
  m.appels.minuteries[0].f();
  eq('… et quand elle sonne, c\'est CETTE adresse qui est libérée', m.appels.urls.map((u) => u.join(' ')), ['creer', 'liberer blob:essai-1']);
}

log('\n=== PARTAGER : LES MESSAGES, L\'ANNULATION, LE DOUBLE TOUCHER ===');
{
  const cas = async (opts) => { const m = monde({ capacitor: telephone(opts) }); m.ctx.__o = octets(1); await m.run('partagerFichier(__o, ' + JSON.stringify(OPTIONS) + ')'); return m; };
  let m = await cas({});
  eq('tout marche : ni message ni erreur (la feuille de partage d\'Android parle d\'elle-même)', [m.appels.toasts, m.appels.writeFile.length, m.appels.share.length], [[], 1, 1]);
  for (const [mot, texte] of [['Share canceled', false], ['Abort', false], ['Dismissed', false], ['share CANCELED by user', false], ['Share canceled', true], ['dismiss', true]]) {
    m = await cas({ erreurPartage: mot, rejetTexte: texte });
    eq('la feuille de partage fermée sans rien choisir (« ' + mot + ' »' + (texte ? ', refus en simple texte' : '') + ') : aucun message', m.appels.toasts, []);
  }
  m = await cas({ erreurPartage: 'Something exploded' });
  eq('une vraie erreur du partage : le message d\'erreur DEMANDÉ (celui de l\'appelant)', m.appels.toasts, [ERREUR]);
  m = await cas({ erreurPartage: 'Boum', rejetTexte: true });
  eq('… même quand le refus est un simple texte', m.appels.toasts, [ERREUR]);
  m = await cas({ erreurEcriture: 'ENOSPC' });
  eq('l\'écriture échoue : le message d\'erreur demandé, le partage n\'est pas ouvert', [m.appels.toasts, m.appels.share.length], [[ERREUR], 0]);
  m = await cas({ absents: ['Share'] });
  eq('les plugins sont absents : le message d\'erreur demandé, rien d\'écrit', [m.appels.toasts, m.appels.writeFile.length], [[ERREUR], 0]);
  const web = monde({});
  web.ctx.__o = octets(1);
  await web.run('partagerFichier(__o, ' + JSON.stringify(OPTIONS) + ')');
  eq('dans un navigateur : le message « téléchargé » demandé', web.appels.toasts, ['✔ Essai téléchargé']);
  // le double toucher pendant que la feuille de partage est ouverte
  let liberer = null;
  const porte = new Promise((res) => { liberer = res; });
  const n = monde({ capacitor: telephone({ attente: porte }) });
  n.ctx.__o = octets(1);
  const p1 = n.run('partagerFichier(__o, ' + JSON.stringify(OPTIONS) + ')');
  await attendre();
  const p2 = n.run('partagerFichier(__o, ' + JSON.stringify(OPTIONS) + ')');
  await p2;
  eq('un 2e appel pendant que la feuille de partage est ouverte ne fait RIEN (un seul fichier, un seul partage)', [n.appels.writeFile.length, n.appels.share.length], [1, 1]);
  liberer();
  await p1;
  await n.run('partagerFichier(__o, ' + JSON.stringify(OPTIONS) + ')');
  eq('… la feuille fermée, on peut de nouveau partager', [n.appels.writeFile.length, n.appels.share.length], [2, 2]);
  const q = await cas({ erreurPartage: 'Boum' });
  await q.run('partagerFichier(__o, ' + JSON.stringify(OPTIONS) + ')');
  eq('après une erreur, on peut aussi de nouveau partager (le verrou est retiré)', [q.appels.writeFile.length, q.appels.share.length], [2, 2]);
  const r = await cas({ erreurPartage: 'Share canceled' });
  await r.run('partagerFichier(__o, ' + JSON.stringify(OPTIONS) + ')');
  eq('… et après une annulation aussi', [r.appels.writeFile.length, r.appels.share.length], [2, 2]);
}

log('\n=== LA PAIE : LE BOUTON « ⬇ TÉLÉCHARGER (CSV) » PASSE PAR LE PARTAGE ===');
{
  const DONNEES = { employes: [
    { nom: 'Luc Boisvert', heures: 42.5, quarts: 5, repartition: [{ vehicule: 'Camion 1', route: 'Charette', heures: 40 }], hors_equipage: 2.5 },
    { nom: 'Éric « Le Chef » Tremblay', heures: 10, quarts: 1, repartition: [], hors_equipage: 0 },
  ] };
  const attendu = 'Employé,Total heures,Quarts,Véhicule,Route,Heures\r\nLuc Boisvert,42.5,5,Camion 1,Charette,40\r\nLuc Boisvert,42.5,5,,Hors équipage,2.5\r\nÉric « Le Chef » Tremblay,10,1,,,';
  const prepare = (m) => { m.ctx.__d = DONNEES; m.run("exportPaieAdmin = __d; _periodeExportAdmin = {debut: '2026-09-01', fin: '2026-09-15'};"); };
  let m = monde({ capacitor: telephone() });
  prepare(m);
  await m.run('telechargerExportPaieCsv()');
  const ecrit = m.appels.writeFile[0];
  eq('sur le téléphone : le fichier « paie_2026-09-01_au_2026-09-15.csv » est écrit dans le dossier temporaire', [m.appels.writeFile.length, ecrit.path, ecrit.directory], [1, 'paie_2026-09-01_au_2026-09-15.csv', 'CACHE']);
  const bytes = Buffer.from(ecrit.data, 'base64');
  eq('… son contenu : le BOM UTF-8 (Excel lit les accents), puis le CSV de la paie, en UTF-8 (« é » sur deux octets)', [Array.from(bytes.subarray(0, 3)), bytes.subarray(3).toString('utf8'), bytes.includes(Buffer.from([0xC3, 0xA9]))], [[0xEF, 0xBB, 0xBF], attendu, true]);
  eq('… puis la feuille de partage : titre « Export de paie du … au … », titre de fenêtre « Envoyer le fichier de paie »', [m.appels.share.length, m.appels.share[0].url, m.appels.share[0].title, m.appels.share[0].text, m.appels.share[0].dialogTitle],
    [1, 'file:///data/user/0/com.entretienlapointe.tracker/cache/paie_2026-09-01_au_2026-09-15.csv', 'Export de paie du 2026-09-01 au 2026-09-15', 'Export de paie du 2026-09-01 au 2026-09-15', 'Envoyer le fichier de paie']);
  eq('… aucun message, aucun téléchargement', [m.appels.toasts, m.appels.clics.length], [[], 0]);
  m = monde({});
  prepare(m);
  await m.run('telechargerExportPaieCsv()');
  eq('dans un navigateur : un fichier « text/csv;charset=utf-8 » du même nom, cliqué, et « ✔ Fichier de paie téléchargé »', [m.appels.blobs[0].type, m.appels.clics.map((c) => c.download), m.appels.toasts, Buffer.from(m.appels.blobs[0].parts[0]).toString('utf8')], ['text/csv;charset=utf-8', ['paie_2026-09-01_au_2026-09-15.csv'], ['✔ Fichier de paie téléchargé'], '﻿' + attendu]);
  m = monde({ capacitor: telephone({ erreurPartage: 'Boum' }) });
  prepare(m);
  await m.run('telechargerExportPaieCsv()');
  eq('une erreur du partage : « Le fichier de paie n\'a pas pu être envoyé… »', m.appels.toasts, ['❌ Le fichier de paie n’a pas pu être envoyé à l’application de partage du téléphone.']);
  m = monde({ capacitor: telephone({ erreurPartage: 'Share canceled' }) });
  prepare(m);
  await m.run('telechargerExportPaieCsv()');
  eq('la feuille de partage fermée sans rien choisir : aucun message', m.appels.toasts, []);
  m = monde({ capacitor: telephone() });
  await m.run('telechargerExportPaieCsv()');
  eq('aucun export généré (rien à envoyer) : le bouton ne fait rien', [m.appels.writeFile.length, m.appels.share.length, m.appels.toasts], [0, 0, []]);
  m = monde({ capacitor: telephone() });
  m.ctx.__d = DONNEES;
  m.run('exportPaieAdmin = __d; _periodeExportAdmin = null;');
  await m.run('telechargerExportPaieCsv()');
  eq('… ni sans période', [m.appels.writeFile.length, m.appels.share.length], [0, 0]);
  m = monde({ capacitor: telephone({ natif: true, absents: ['Share'] }) });
  prepare(m);
  await m.run('telechargerExportPaieCsv()');
  eq('téléphone sans le plugin « Share » : message clair, rien d\'écrit', [m.appels.toasts, m.appels.writeFile.length], [['❌ Le fichier de paie n’a pas pu être envoyé à l’application de partage du téléphone.'], 0]);
}

log('\n=== LE CODE ET LA PAGE ===');
{
  const src = lire('js/partage-fichier.js');
  const exp = lire('js/admin-export.js');
  const html = lire('index.html');
  const nu = (s) => s.replace(/\/\/.*$/gm, '');
  vrai('partage-fichier.js ne lit ni n\'écrit rien dans la base ni sur le réseau (ni db., ni fetch, ni XMLHttpRequest, ni rpc, ni innerHTML, ni eval, ni Function)', !/\bdb\b|fetch\(|XMLHttpRequest|\.rpc\(|innerHTML|eval\(|new Function/.test(nu(src)), (nu(src).match(/\bdb\b|fetch\(|XMLHttpRequest|\.rpc\(|innerHTML|eval\(|new Function/) || [])[0]);
  eq('les seuls plugins nommés : Filesystem et Share (trouvés par « pluginNatif » de tracking.js)', [...new Set([...src.matchAll(/pluginNatif\('([A-Za-z]+)'\)/g)].map((x) => x[1]))].sort(), ['Filesystem', 'Share']);
  vrai('le fichier est écrit dans le dossier TEMPORAIRE (CACHE), jamais dans les documents de la personne', /directory:'CACHE'/.test(src) && !/DOCUMENTS|EXTERNAL|Directory\.Data/.test(src));
  vrai('admin-export.js ne fait plus son propre téléchargement (ni Blob, ni createObjectURL, ni lien « download ») : tout passe par partagerFichier', !/new Blob\(|createObjectURL|\.download\s*=|\.click\(\)/.test(nu(exp)) && /partagerFichier\(/.test(exp), (nu(exp).match(/new Blob\(|createObjectURL|\.download\s*=|\.click\(\)/) || [])[0]);
  const scripts = [...html.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map((x) => x[1]);
  eq('la page charge partage-fichier.js UNE fois, avant admin.js, admin-export.js et suivi-pdf.js', [scripts.filter((s) => s === 'partage-fichier.js').length, scripts.indexOf('partage-fichier.js') < scripts.indexOf('admin.js'), scripts.indexOf('partage-fichier.js') < scripts.indexOf('admin-export.js'), scripts.indexOf('partage-fichier.js') < scripts.indexOf('suivi-pdf.js')], [1, true, true, true]);
  eq('et « pluginNatif » (tracking.js) est chargé avant de démarrer l\'application', scripts.indexOf('tracking.js') < scripts.indexOf('demarrage.js'), true);
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
