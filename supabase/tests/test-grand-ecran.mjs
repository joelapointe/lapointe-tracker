// La mise en page « GRAND ÉCRAN » (www/css/grand-ecran.css) : le panneau Admin en poste de commande, les listes sur plusieurs colonnes, les feuilles du téléphone
// en fenêtres centrées. Ce test lit index.html, css/style.css, css/grand-ecran.css et les fichiers js/ (WWW_TEST : un autre dossier « www », pour les erreurs volontaires).
// Ce qu'il garantit surtout : (1) le TÉLÉPHONE ne change pas (le fichier ne contient que des règles DANS un @media de grande fenêtre, rien dehors) ;
// (2) aucune feuille « qui monte du bas » n'est oubliée (règle générale : si on en ajoute une dans style.css, ce test échoue tant qu'elle n'est pas centrée en grand écran) ;
// (3) aucun sélecteur faux (une faute de frappe dans un identifiant ne ferait RIEN, sans bruit).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const WWW = process.env.WWW_TEST ? process.env.WWW_TEST.split('\\').join('/').replace(/\/?$/, '/') : fileURLToPath(new URL('../../www/', import.meta.url));

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));

const html = fs.readFileSync(WWW + 'index.html', 'utf8');
const sansCommentaires = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
const cssTel = sansCommentaires(fs.readFileSync(WWW + 'css/style.css', 'utf8'));
const cssGrand = sansCommentaires(fs.readFileSync(WWW + 'css/grand-ecran.css', 'utf8'));
const compact = (t) => t.replace(/\s+/g, '');
const js = fs.readdirSync(WWW + 'js').filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(WWW + 'js/' + f, 'utf8')).join('\n');
const texteApp = html + '\n' + cssTel + '\n' + js;

// Découpe un texte CSS au NIVEAU 0 : [{prelude, corps}] (le corps garde ses accolades internes : @media, @keyframes)
function blocs(texte) {
  const res = [];
  let i = 0;
  while (i < texte.length) {
    const ouv = texte.indexOf('{', i);
    if (ouv < 0) { if (texte.slice(i).trim()) res.push({ prelude: texte.slice(i).trim(), corps: null }); break; }
    const prelude = texte.slice(i, ouv).trim();
    let prof = 1, j = ouv + 1;
    while (j < texte.length && prof > 0) { if (texte[j] === '{') prof++; else if (texte[j] === '}') prof--; j++; }
    res.push({ prelude, corps: texte.slice(ouv + 1, j - 1) });
    i = j;
  }
  return res;
}
const mot = (n) => new RegExp('(^|[^\\w-])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\w-])');

log('=== LE FICHIER EST CHARGÉ, APRÈS style.css ===');
{
  const liens = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="(css\/[^"]+)"[^>]*>/g)].map((m) => m[1]);
  eq('index.html charge css/grand-ecran.css UNE fois', liens.filter((l) => l === 'css/grand-ecran.css').length, 1);
  vrai('… APRÈS css/style.css (sinon il ne pourrait rien remplacer)', liens.indexOf('css/grand-ecran.css') > liens.indexOf('css/style.css') && liens.indexOf('css/style.css') >= 0, liens.join(' '));
}

log('\n=== LE TÉLÉPHONE NE CHANGE PAS : TOUT EST DANS UN @media DE GRANDE FENÊTRE ===');
const niveau0 = blocs(cssGrand);
const media = niveau0.find((b) => b.prelude.startsWith('@media'));
{
  eq('le fichier ne contient que : l\'animation « fondu » puis UN @media (aucune règle ordinaire dehors)', niveau0.map((b) => b.prelude.replace(/\s+/g, ' ')), ['@keyframes fondu', '@media (min-width:1000px) and (min-height:560px)']);
  vrai('le seuil est 1 000 px de large ET 560 px de haut (un téléphone en paysage reste sous 1 000 px : il garde sa mise en page)', !!media && /min-width:1000px/.test(media.prelude) && /min-height:560px/.test(media.prelude), media?.prelude);
  vrai('le @media ne contient AUCUN @media imbriqué ni max-width (rien qui puisse revenir au téléphone par un autre chemin)', !!media && !/@media|max-width\s*:/.test(media.corps.replace(/max-width:\d+px|max-height:calc/g, '')), '');
}
const regles = media ? blocs(media.corps).map((b) => ({ sels: b.prelude.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), corps: compact(b.corps || '') })) : [];
const touche = (sel) => regles.filter((r) => r.sels.includes(sel));
const corpsDe = (sel) => touche(sel).map((r) => r.corps).join(';');

log('\n=== LES SÉLECTEURS EXISTENT (une faute de frappe ne ferait RIEN, sans bruit) ===');
{
  const ids = new Set(), classes = new Set();
  for (const r of regles) for (const s of r.sels) {
    for (const m of s.matchAll(/#([A-Za-z][\w-]*)/g)) ids.add(m[1]);
    for (const m of s.matchAll(/\.([A-Za-z][\w-]*)/g)) classes.add(m[1]);
  }
  const idsInconnus = [...ids].filter((i) => !mot(i).test(html + '\n' + js));
  const classesInconnues = [...classes].filter((c) => !mot(c).test(texteApp));
  eq(`les ${ids.size} identifiants (#…) du fichier existent dans index.html ou dans le code`, idsInconnus, []);
  eq(`les ${classes.size} classes (.…) du fichier existent dans le style ou dans le code`, classesInconnues, []);
  vrai('le fichier vise bien un nombre normal de règles (on ne l\'a pas vidé par erreur)', regles.length >= 25, String(regles.length));
}

log('\n=== LE PANNEAU ADMIN : UN POSTE DE COMMANDE PLEIN ÉCRAN ===');
{
  const ov = corpsDe('#admin-overlay');
  vrai('le fond du panneau centre son contenu (au lieu de le coller en bas) avec une marge', /align-items:center/.test(ov) && /justify-content:center/.test(ov) && /padding:\d+px/.test(ov), ov);
  const p = corpsDe('#admin-panel');
  vrai('le panneau est une GRILLE à deux colonnes (onglets à gauche, contenu à droite)', /display:grid/.test(p) && /grid-template-columns:\d+px(minmax\(0,1fr\)|1fr)/.test(p), p);
  vrai('… il prend toute la hauteur (plus de « feuille » qui change de hauteur d\'un onglet à l\'autre) et déborde pas', /height:100%/.test(p) && /max-height:none/.test(p) && /overflow:hidden/.test(p), p);
  const t = corpsDe('#admin-tabs');
  vrai('les onglets passent en COLONNE, dans la colonne de gauche, sur toute la hauteur', /flex-direction:column/.test(t) && /grid-column:1/.test(t) && /grid-row:1\/3/.test(t), t);
  vrai('le haut (titre) et le contenu sont dans la colonne de droite', /grid-column:2/.test(corpsDe('#admin-header')) && /grid-column:2/.test(corpsDe('#admin-body')) && /grid-row:1/.test(corpsDe('#admin-header')) && /grid-row:2/.test(corpsDe('#admin-body')), '');
  vrai('le bouton « FERMER » du bas est caché (la croix du haut et un clic à côté ferment)', /display:none/.test(corpsDe('#admin-footer')), '');
  vrai('chaque onglet prend toute la largeur de la colonne et se lit de gauche à droite', /width:100%/.test(corpsDe('.admin-tab')) && /text-align:left/.test(corpsDe('.admin-tab')), '');
}

log('\n=== LES LONGUES LISTES SE RANGENT SUR PLUSIEURS COLONNES ===');
{
  const conteneurs = ['#su-liste:has(>.su-ligne)', '#cl-liste:has(>.su-ligne)', '#admin-body:has(>.emp-item)', '#admin-body:has(>.regl-item)'];
  for (const c of conteneurs.map((x) => x.replace(/\s/g, ''))) {
    const r = regles.find((x) => x.sels.map((s) => s.replace(/\s/g, '')).includes(c) && /display:grid/.test(x.corps));
    vrai(`« ${c} » est une grille qui remplit la largeur (colonnes automatiques)`, !!r && /grid-template-columns:repeat\(auto-fill,minmax\(\d+px,1fr\)\)/.test(r.corps), r?.corps);
  }
  // Seuls les LIGNES vont dans les colonnes : les titres de section, le résumé et les boutons du bas prennent toute la largeur
  const pleines = regles.filter((x) => /grid-column:1\/-1/.test(x.corps)).flatMap((x) => x.sels.map((s) => s.replace(/\s/g, '')));
  for (const c of ['#su-liste:has(>.su-ligne)>:not(.su-ligne)', '#cl-liste:has(>.su-ligne)>:not(.su-ligne)', '#admin-body:has(>.emp-item)>:not(.emp-item)', '#admin-body:has(>.regl-item)>:not(.regl-item)'])
    vrai(`tout ce qui n'est pas une ligne prend toute la largeur : ${c}`, pleines.includes(c), pleines.join(' | '));
  vrai('la grille ne s\'applique QUE quand la liste contient des lignes (:has) : les écrans de l\'Avis et du Journal, construits autrement, ne sont pas bousculés', conteneurs.every((c) => regles.some((x) => x.sels.some((s) => s.replace(/\s/g, '') === c.replace(/\s/g, '')))), '');
  const minCl = [...corpsDe('#cl-liste:has(>.su-ligne)').matchAll(/minmax\((\d+)px/g)].pop()?.[1];   // la DERNIÈRE règle gagne (celle des fiches vient après la règle commune)
  vrai('les fiches du répertoire sont plus étroites que les lignes du Suivi : 3 colonnes sur un écran de 1920', Number(minCl) > 0 && Number(minCl) < 500, String(minCl));
  vrai('les champs, les listes et les gros boutons ne s\'étirent pas sur toute la largeur (max-width)', /max-width:\d+px/.test(corpsDe('#admin-body input[type="text"]')) && /max-width:\d+px/.test(corpsDe('#admin-body .lf-btn.nouveau')), '');
}

log('\n=== AUCUNE FEUILLE DU TÉLÉPHONE N\'EST OUBLIÉE (règle générale) ===');
{
  const telRegles = blocs(cssTel).filter((b) => !b.prelude.startsWith('@') && b.corps != null).map((b) => ({ sels: b.prelude.split(',').map((s) => s.trim()), corps: compact(b.corps) }));
  const sheets = [...new Set(telRegles.filter((r) => r.sels.length === 1 && /^#([\w-]+-)?overlay$/.test(r.sels[0]) && /align-items:flex-end/.test(r.corps)).map((r) => r.sels[0]))];
  const panneaux = [...new Set(telRegles.filter((r) => r.sels.length === 1 && /^#[\w-]+$/.test(r.sels[0]) && /border-radius:\d+px\d+px00/.test(r.corps)).map((r) => r.sels[0]))];
  vrai(`style.css contient des fenêtres qui montent du bas (${sheets.length} trouvées : le test ne regarde pas dans le vide)`, sheets.length >= 15, String(sheets.length));
  eq('… dont la fenêtre « Nouveau client » (#overlay, sans tiret : la règle générale ne doit pas la rater)', sheets.includes('#overlay'), true);
  vrai(`… et leurs panneaux aux coins arrondis seulement en haut (${panneaux.length} trouvés)`, panneaux.length >= 16, String(panneaux.length));
  const centres = new Set(regles.filter((r) => /align-items:center/.test(r.corps) && /justify-content:center/.test(r.corps)).flatMap((r) => r.sels));
  const arrondis = new Set(regles.filter((r) => /(^|;)border-radius:\d+px(;|$)/.test(r.corps)).flatMap((r) => r.sels));
  eq('CHAQUE fenêtre qui monte du bas est CENTRÉE en grand écran', sheets.filter((s) => !centres.has(s)), []);
  eq('CHAQUE panneau du téléphone (coins arrondis en haut) est arrondi sur ses quatre coins en grand écran', panneaux.filter((s) => !arrondis.has(s)), []);
  const largeurs = new Set(regles.filter((r) => /width:min\(\d+px,100%\)/.test(r.corps)).flatMap((r) => r.sels));
  eq('CHAQUE panneau du téléphone a une largeur raisonnable en grand écran (pas 1 400 px)', panneaux.filter((s) => !largeurs.has(s)), []);
  const hauteurs = new Set(regles.filter((r) => /max-height:calc\(100vh-48px\)|height:100%/.test(r.corps)).flatMap((r) => r.sels));
  eq('CHAQUE panneau tient dans la fenêtre (hauteur maximale) : un long formulaire défile au lieu de sortir de l\'écran', panneaux.filter((s) => !hauteurs.has(s)), []);
  const anime = new Set(regles.filter((r) => /animation:fondu/.test(r.corps)).flatMap((r) => r.sels));
  eq('… et chacun apparaît en fondu (plus de glissement du bas, qui n\'a pas de sens pour une fenêtre centrée)', panneaux.filter((s) => !anime.has(s)), []);
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
