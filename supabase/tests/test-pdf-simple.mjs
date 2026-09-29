// Demande 4 de Joé (29 sept. 2026) — L'ÉCRIVAIN DE PDF (www/js/pdf-simple.js) : textes accentués, largeurs de Helvetica, coupure des lignes, et la STRUCTURE du fichier (table des positions, longueurs, pages)
// relue par un lecteur indépendant et strict (pdf-lecteur.mjs). Ce que ce test ne peut PAS vérifier : l'aspect dans un vrai lecteur de PDF ni l'impression (essayé à part dans un navigateur, puis sur le téléphone de Joé).
// WWW_TEST : un autre dossier « www » (erreurs volontaires : voir erreurs-volontaires.mjs).
import vm from 'vm';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { lirePdf } from './pdf-lecteur.mjs';
const WWW = process.env.WWW_TEST ? process.env.WWW_TEST.split('\\').join('/').replace(/\/?$/, '/') : fileURLToPath(new URL('../../www/', import.meta.url));

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(WWW + 'js/pdf-simple.js', 'utf8'), ctx, { filename: 'js/pdf-simple.js' });
const run = (c) => vm.runInContext(c, ctx);
const J = JSON.stringify;
const proche = (a, b, e = 0.006) => Math.abs(a - b) <= e;
const octetsContient = (octets, motif) => { for (let i = 0; i + motif.length <= octets.length; i++) { let bon = true; for (let k = 0; k < motif.length; k++) if (octets[i + k] !== motif[k]) { bon = false; break; } if (bon) return true; } return false; };

log('=== LES CARACTÈRES : LA TABLE WINDOWS-1252 ET LE NETTOYAGE DU TEXTE ===');
{
  const o = (cp) => run(`pdfOctetDe(${cp})`);
  eq('les lettres, chiffres et signes de base gardent leur code (A, z, 0, espace, ~)', [o(65), o(122), o(48), o(32), o(126)], [65, 122, 48, 32, 126]);
  eq('les lettres accentuées du français gardent leur code Latin-1 (é è à ç ô î û ï É À Ç)', [o(0xE9), o(0xE8), o(0xE0), o(0xE7), o(0xF4), o(0xEE), o(0xFB), o(0xEF), o(0xC9), o(0xC0), o(0xC7)], [0xE9, 0xE8, 0xE0, 0xE7, 0xF4, 0xEE, 0xFB, 0xEF, 0xC9, 0xC0, 0xC7]);
  eq('les guillemets et tirets typographiques ont leur code Windows-1252 (’ 0x92, “ 0x93, ” 0x94, – 0x96, — 0x97, … 0x85, « 0xAB, » 0xBB, € 0x80, œ 0x9C, Œ 0x8C)', [o(0x2019), o(0x201C), o(0x201D), o(0x2013), o(0x2014), o(0x2026), o(0xAB), o(0xBB), o(0x20AC), o(0x153), o(0x152)], [0x92, 0x93, 0x94, 0x96, 0x97, 0x85, 0xAB, 0xBB, 0x80, 0x9C, 0x8C]);
  eq('un caractère absent de la table (emoji, ł, Ā, code de contrôle, trait d\'union conditionnel) : 63 (« ? »)', [o(0x1F600), o(0x142), o(0x100), o(0), o(127), o(0xAD)], [63, 63, 63, 63, 63, 63]);
  const dec = new TextDecoder('windows-1252');
  const faux = [];
  for (let b = 0x80; b <= 0xFF; b++) {
    if ([0x81, 0x8D, 0x8F, 0x90, 0x9D, 0xAD].includes(b)) continue;   // (les 5 codes vides de la table, et le trait d'union conditionnel, qui ne s'écrit pas)
    const cp = dec.decode(Uint8Array.of(b)).codePointAt(0);
    if (o(cp) !== b) faux.push([b, cp, o(cp)]);
  }
  eq('TOUS les codes 0x80 à 0xFF de la vraie table Windows-1252 (celle de Node) reviennent à leur code : é, œ, €, ’, ™, ‰, Š, ž…', faux, []);
  eq('les bornes : l\'espace insécable (0xA0) et ÿ (0xFF) sont écrits ; le caractère juste avant l\'espace (31), le 127 et le caractère 0x100 ne le sont pas', [o(0xA0), o(0xFF), o(31), o(127), o(0x100)], [0xA0, 0xFF, 63, 63, 63]);
  const n = (t) => run(`pdfNettoyer(${J(t)})`);
  eq('les espaces multiples, retours à la ligne et tabulations : UN seul espace ; rien au début ni à la fin', [n('a  b\t\nc'), n('  x  '), n('\n\n')], ['a b c', 'x', '']);
  eq('vide, null, absent, un nombre', [n(''), run('pdfNettoyer(null)'), run('pdfNettoyer(undefined)'), run('pdfNettoyer(12)')], ['', '', '', '12']);
  eq('l\'espace insécable est un espace ordinaire ; les caractères invisibles (largeur nulle, trait d\'union conditionnel) sont retirés', [n('a\u00a0b'), n('a\u200bb\u00adc\ufeffd')], ['a b', 'abcd']);
  eq('… tous les invisibles : U+200B à U+200F (espace de largeur nulle, liants, marques de direction) et le sélecteur de variante U+FE0F', n('a\u200bb\u200cc\u200dd\u200ee\u200ff\ufe0fg'), 'abcdefg');
  eq('… les autres espaces (fine, cadratin, insécable étroit, ligne, paragraphe, idéographique) sont des espaces', n('a\u2009b\u2003c\u202fd\u2028e\u2029f\u3000g'), 'a b c d e f g');
  eq('une lettre décomposée (e + accent aigu) est recomposée (é) ; un accent seul disparaît', [n('e\u0301'), n('\u0301')], ['é', '']);
  eq('une lettre hors table mais décomposable prend sa lettre de base (Ā → A) ; sinon « ? » (ł, emoji, code de contrôle)', [n('Ā'), n('ł'), n('😀'), n('a\u0000b')], ['A', '?', '?', 'a?b']);
  eq('un vrai point d\'interrogation reste un point d\'interrogation', n('Quoi ?'), 'Quoi ?');
  eq('les textes typographiques sont gardés tels quels (Éric – « Été » ’ … € œ)', n('Éric – « Été » ’ … € œ'), 'Éric – « Été » ’ … € œ');
}

log('\n=== LES LARGEURS (HELVETICA) ET LA COUPURE DES LIGNES ===');
{
  const l = (t, taille = 10, gras = false) => run(`pdfLargeur(${J(t)}, ${taille}, ${gras})`);
  eq('« Hello » à 10 points = 22,78 (H 722 + e 556 + l 222 + l 222 + o 556, en millièmes)', Math.round(l('Hello') * 100) / 100, 22.78);
  eq('… en gras (Helvetica-Bold) = 24,45 (H 722 + e 556 + l 278 + l 278 + o 611)', Math.round(l('Hello', 10, true) * 100) / 100, 24.45);
  eq('la largeur suit la taille (20 points = deux fois 10 points)', proche(l('Hello', 20), 2 * l('Hello', 10), 1e-9), true);
  eq('une lettre accentuée a la largeur de sa lettre de base (é = e, É = E, ç = c, ô = o)', [l('é') === l('e'), l('É') === l('E'), l('ç') === l('c'), l('ô') === l('o')], [true, true, true, true]);
  eq('… sauf les i accentués : 278 (î ï ì í), pas 222', [l('î', 1000), l('ï', 1000), l('ì', 1000), l('í', 1000)], [278, 278, 278, 278]);
  eq('quelques largeurs connues de Helvetica : espace 278 (entre deux lettres : un espace seul est retiré du texte), m 833, W 944, i 222, @ 1015, chiffre 556, « — » 1000', [l('a b', 1000) - l('a', 1000) - l('b', 1000), l('m', 1000), l('W', 1000), l('i', 1000), l('@', 1000), l('7', 1000), l('—', 1000)], [278, 833, 944, 222, 1015, 556, 1000]);
  eq('… en gras : m 889, i 278, ! 333, l 278', [l('m', 1000, true), l('i', 1000, true), l('!', 1000, true), l('l', 1000, true)], [889, 278, 333, 278]);
  eq('les 5 caractères où Arial et Helvetica diffèrent ont la largeur de Helvetica (± 584, ¯ 333, µ 556, · 278, ÷ 584) ; le trait d\'union conditionnel est retiré du texte (0)', [l('±', 1000), l('¯', 1000), l('µ', 1000), l('·', 1000), l('÷', 1000), l('\u00ad', 1000)], [584, 333, 556, 278, 584, 0]);
  // Les largeurs de TOUS les caractères, comparées au fichier de métriques d'Adobe pour Helvetica et Helvetica-Bold (recopiées ici à part : codes 32 à 255 ; 0 = code qui ne s'écrit jamais)
  const AFM_REGULIER = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 0,
    556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 667,
    278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 0, 737, 333, 400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
    667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
    556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, 556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500];
  const AFM_GRAS = [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 0,
    556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 0, 500, 667,
    278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 0, 737, 333, 400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611,
    722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
    556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278, 611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556];
  const dec2 = new TextDecoder('windows-1252');
  const ecarts = [];
  for (const [nom, afm, gras] of [['Helvetica', AFM_REGULIER, false], ['Helvetica-Bold', AFM_GRAS, true]]) {
    for (let code = 32; code <= 255; code++) {
      if ([127, 129, 141, 143, 144, 157, 173].includes(code)) continue;   // (jamais écrits : 127, les 5 codes vides de la table, le trait d'union conditionnel)
      const car = dec2.decode(Uint8Array.of(code));
      const mesure = (code === 32 || code === 160) ? l('a' + car + 'a', 1000, gras) - 2 * l('a', 1000, gras) : l(car, 1000, gras);   // (un espace seul est retiré du texte : on le mesure entre deux lettres)
      if (Math.abs(mesure - afm[code - 32]) > 1e-6) ecarts.push([nom, code, car, mesure, afm[code - 32]]);
    }
  }
  eq('les largeurs de TOUS les caractères écrits (codes 32 à 255, Helvetica et Helvetica-Bold : 2 × 217 valeurs) sont celles du fichier de métriques d\'Adobe', ecarts, []);
  eq('un texte vide : 0 ; les espaces multiples ne comptent qu\'une fois', [l(''), l('a  b') === l('a b')], [0, true]);
  eq('le gras est plus large (ou égal) pour un texte de lettres courantes', l('Client : Adresse', 10, true) > l('Client : Adresse', 10, false), true);

  const d = (t, max, taille = 10, gras = false) => run(`pdfDecouper(${J(t)}, ${max}, ${taille}, ${gras})`);
  const phrase = 'Famille Tremblay : 10 rue des Pins, Louiseville';
  const lignes = d(phrase, 100);
  eq('une phrase est coupée aux espaces : rien ne dépasse, rien ne se perd, rien ne change d\'ordre', [lignes.every((x) => l(x) <= 100), lignes.join(' '), lignes.length > 1], [true, phrase, true]);
  eq('… pas d\'espace au début ni à la fin d\'une ligne', lignes.every((x) => x === x.trim() && x !== ''), true);
  eq('une ligne qui tient JUSTE (largeur = maximum) reste sur une ligne ; un tout petit peu moins de place la coupe', [d('Hello', l('Hello')).length, d('Hello World', l('Hello World')).length, d('Hello World', l('Hello World') - 0.01).length], [1, 1, 2]);
  const mot = 'Abcdefghijklmnopqrstuvwxyz0123456789'.repeat(3);
  const morceaux = d(mot, 60);
  eq('un mot plus large que la ligne est coupé au caractère près (rien ne dépasse, rien ne se perd)', [morceaux.every((x) => l(x) <= 60), morceaux.join(''), morceaux.length > 1], [true, mot, true]);
  eq('… au milieu d\'une phrase aussi', d('un ' + mot + ' fin', 60).join('').replace(/ /g, ''), ('un' + mot + 'fin'));
  eq('un texte vide ou fait d\'espaces : une seule ligne vide', [d('', 100), d('   ', 100), run('pdfDecouper(null, 100, 10, false)')], [[''], [''], ['']]);
  eq('une largeur plus petite qu\'une lettre : une lettre par ligne, sans boucle infinie', d('abc', 1), ['a', 'b', 'c']);
  eq('un long mot coupé au caractère près : un morceau qui tient JUSTE dans la largeur (« ab » dans la largeur de « ab ») est gardé entier', [d('abcd', l('ab')), d('abcdef', l('abc'))], [['ab', 'cd'], ['abc', 'def']]);
  eq('le gras est mesuré en gras (une ligne qui tient en normal peut être coupée en gras)', [d('Client : Adresse', l('Client : Adresse')).length, d('Client : Adresse', l('Client : Adresse'), 10, true).length], [1, 2]);
  eq('les accents sont gardés dans les lignes', d('Éric – « Été »', 1000), ['Éric – « Été »']);
}

log('\n=== LES NOMBRES ET LES COULEURS DU FICHIER ===');
{
  const nb = (x) => run(`pdfNombre(${x})`);
  eq('deux décimales au plus, sans zéros inutiles', [nb(12.3456), nb(12.5), nb(100), nb(0.5), nb(792), nb(0)], ['12.35', '12.5', '100', '0.5', '792', '0']);
  eq('un nombre négatif, un tout petit nombre négatif (« -0 » n\'existe pas), un nombre illisible (NaN, Infinity)', [nb(-3.25), nb(-0.001), nb('NaN'), nb('Infinity')], ['-3.25', '0', '0', '0']);
  const c = (x, d = '#000000') => run(`pdfCouleur(${J(x)}, ${J(d)})`);
  eq('« #rrggbb » devient trois nombres de 0 à 1 (rouge, gris #888888, blanc, majuscules)', [c('#ff0000'), c('#888888'), c('#ffffff'), c('#FF8800')], ['1 0 0', '0.53 0.53 0.53', '1 1 1', '1 0.53 0']);
  eq('une couleur illisible (mot, 3 chiffres, absente) prend la couleur par défaut', [c('rouge'), c('#fff'), c(null), c(undefined, '#ff0000')], ['0 0 0', '0 0 0', '0 0 0', '1 0 0']);
  eq('la division est par 255 (« #fefefe » : 254 / 255 = 0,996 s\'écrit 1 ; par 256 on aurait 0,99)', [c('#fefefe'), c('#333333')], ['1 1 1', '0.2 0.2 0.2']);
}

log('\n=== LE FICHIER : LA STRUCTURE, RELUE PAR UN LECTEUR INDÉPENDANT ===');
{
  // un petit document de 3 pages
  const date = new Date(2026, 8, 29, 12, 5, 9);
  run(`__doc = pdfNouveau({titre: 'Suivi des passages — Épandage de sel', auteur: 'Entretien Lapointe', date: new Date(2026, 8, 29, 12, 5, 9)})`);
  run(`__p1 = __doc.page(); __p2 = __doc.page(); __p3 = __doc.page();`);
  run(`__p1.texte(36, 50, 'SUIVI DES PASSAGES PAR CLIENT', {taille: 16, gras: true});`);
  run(`__p1.texte(36, 70, 'Prix (taxes) \\\\ net', {taille: 9});`);
  run(`__p1.texte(756, 90, 'Éric – « Été » ’ … € œ', {taille: 10, align: 'right', couleur: '#ff0000'});`);
  run(`__p1.texte(400, 110, 'Centré', {taille: 12, align: 'center'});`);
  run(`__p1.trait(36, 120, 756, 120, {epaisseur: 1, couleur: '#888888'});`);
  run(`__p1.rect(36, 130, 720, 18, {remplissage: '#e6e6e6'});`);
  run(`__p1.rect(36, 160, 100, 20, {contour: '#000000', epaisseur: 2});`);
  run(`__p1.rect(36, 190, 100, 20, {remplissage: '#ffff00', contour: '#ff0000'});`);
  run(`__p1.rect(36, 220, 100, 20, {});`);
  run(`__p2.texte(10, 20, 'page deux');`);
  run(`__p3.texte(10, 20, 'page trois', {gras: true});`);
  const octets = run('__doc.octets()');
  const pdf = lirePdf(octets);
  eq('le fichier est bien formé (la table des positions, les longueurs, l\'arbre des pages, les polices : aucune anomalie)', pdf.erreurs, []);
  eq('3 pages, 11 objets (1 catalogue, 1 liste, 2 polices, 1 information, 3 × page + contenu), de 792 × 612 points (lettre en paysage)', [pdf.pages.length, pdf.nbObjets, pdf.pages.map((p) => [p.largeur, p.hauteur])], [3, 11, [[792, 612], [792, 612], [792, 612]]]);
  eq('les informations : titre accentué, auteur, date de création (le 29 sept. 2026 à 12 h 05 min 09 s)', pdf.info, { titre: 'Suivi des passages — Épandage de sel', auteur: 'Entretien Lapointe', date: '20260929120509' });
  const t = pdf.pages[0].textes;
  eq('le titre : à (36, 50), 16 points, en gras, noir', [t[0].x, t[0].y, t[0].taille, t[0].gras, t[0].couleur, t[0].texte], [36, 50, 16, true, '0 0 0', 'SUIVI DES PASSAGES PAR CLIENT']);
  eq('les parenthèses et la barre oblique inverse sont échappées, et relues telles quelles', t[1].texte, 'Prix (taxes) \\ net');
  eq('les accents et signes typographiques sont écrits dans la table Windows-1252 et relus tels quels', t[2].texte, 'Éric – « Été » ’ … € œ');
  eq('… le texte est écrit avec le VRAI octet Windows-1252 (É = 0xC9, – = 0x96, œ = 0x9C), pas en Unicode', [octetsContient(octets, [0x28, 0xC9, 0x72, 0x69, 0x63, 0x20, 0x96]), octetsContient(octets, [0x20, 0x9C, 0x29, 0x20, 0x54, 0x6A])], [true, true]);
  eq('aligné à DROITE : le bord droit du texte est à 756 (x = 756 − largeur)', proche(t[2].x + run(`pdfLargeur('Éric – « Été » ’ … € œ', 10, false)`), 756, 0.01), true);
  eq('… et sa couleur est le rouge demandé', t[2].couleur, '1 0 0');
  eq('aligné au CENTRE : le milieu du texte est à 400', proche(t[3].x + run(`pdfLargeur('Centré', 12, false)`) / 2, 400, 0.01), true);
  eq('un trait de (36, 120) à (756, 120), 1 point, gris', pdf.pages[0].traits, [{ x1: 36, y1: 120, x2: 756, y2: 120, couleur: '0.53 0.53 0.53', epaisseur: 1 }]);
  const r = pdf.pages[0].rects;
  eq('trois rectangles (le 4e, sans remplissage ni contour, n\'est pas écrit) : rempli seul, contour seul, les deux', r.length, 3);
  eq('… rempli : coin haut gauche (36, 130), 720 × 18, gris clair, sans contour', [r[0].x, r[0].y, r[0].l, r[0].h, r[0].remplissage, r[0].contour, r[0].op], [36, 130, 720, 18, '0.9 0.9 0.9', null, 'f']);
  eq('… contour seul : (36, 160), 100 × 20, noir, 2 points, sans remplissage', [r[1].x, r[1].y, r[1].l, r[1].h, r[1].contour, r[1].epaisseur, r[1].remplissage, r[1].op], [36, 160, 100, 20, '0 0 0', 2, null, 'S']);
  eq('… rempli ET contour : jaune et rouge, contour de 0,5 point par défaut', [r[2].y, r[2].remplissage, r[2].contour, r[2].epaisseur, r[2].op], [190, '1 1 0', '1 0 0', 0.5, 'B']);
  eq('les pages 2 et 3 : leur texte (la 3e en gras, la taille par défaut de 10 points)', [pdf.pages[1].textes.map((x) => [x.texte, x.taille, x.gras]), pdf.pages[2].textes.map((x) => [x.texte, x.taille, x.gras])], [[['page deux', 10, false]], [['page trois', 10, true]]]);
  eq('la 1re ligne du fichier est « %PDF-1.4 », la dernière « %%EOF »', [Buffer.from(octets.slice(0, 8)).toString('latin1'), Buffer.from(octets.slice(-6)).toString('latin1')], ['%PDF-1.4', '%%EOF\n']);
  const brut = Buffer.from(octets).toString('latin1');
  vrai('aucun « NaN », « undefined », « Infinity » ni « null » dans le fichier', !/NaN|undefined|Infinity|null/.test(brut.replace(/\(.*?\) Tj/g, '')), (brut.match(/NaN|undefined|Infinity|null/) || [])[0]);
  eq('deux fabrications avec les mêmes appels donnent EXACTEMENT les mêmes octets', Buffer.compare(Buffer.from(run('__doc.octets()')), Buffer.from(octets)), 0);
  eq('taille : un petit fichier (moins de 3 Ko pour ces 3 pages)', octets.length < 3000, true);
}

log('\n=== LES CAS LIMITES ===');
{
  const doc0 = run('pdfNouveau().octets()');
  const p0 = lirePdf(doc0);
  eq('un document sans aucune page reçoit UNE page vide (un PDF sans page est invalide)', [p0.erreurs, p0.pages.length, p0.pages[0].textes.length, p0.pages[0].largeur, p0.pages[0].hauteur], [[], 1, 0, 792, 612]);
  eq('sans titre, ni auteur, ni date : ces informations ne sont pas écrites', p0.info, {});
  const p1 = lirePdf(run(`(() => { const d = pdfNouveau({largeur: 612, hauteur: 792, titre: 'Portrait'}); const p = d.page(); p.texte(10, 30, 'x'); return d.octets(); })()`));
  eq('une autre taille de page (lettre en portrait 612 × 792)', [p1.erreurs, p1.pages[0].largeur, p1.pages[0].hauteur, p1.pages[0].textes[0].y, p1.info.titre], [[], 612, 792, 30, 'Portrait']);
  const p2 = lirePdf(run(`(() => { const d = pdfNouveau({largeur: -5, hauteur: 'abc'}); d.page(); return d.octets(); })()`));
  eq('une taille de page illisible : la lettre en paysage', [p2.pages[0].largeur, p2.pages[0].hauteur], [792, 612]);
  const octets3 = run(`(() => { const d = pdfNouveau({date: new Date('pas une date')}); const p = d.page();
    p.texte(NaN, undefined, 'a', {taille: -3}); p.texte(5, 5, '', {}); p.texte(5, 5, '   ', {}); p.texte(5, 5, null); p.texte(1, 2, 'b', {taille: 0, couleur: 'rouge'});
    p.trait(0, 0, 10, 10, {epaisseur: -1, couleur: 'x'}); p.rect(1, 1, 5, 5, {remplissage: 'rouge'}); p.rect(1, 1, 5, 5, {contour: 'rouge', epaisseur: 0}); return d.octets(); })()`);
  const p3 = lirePdf(octets3);
  eq('… aucun « NaN » ni « undefined » n\'a été écrit dans ce fichier (date, positions, tailles, couleurs, épaisseurs illisibles)', /NaN|undefined|Infinity/.test(Buffer.from(octets3).toString('latin1')), false);
  eq('… un rectangle dont la couleur de remplissage est illisible est blanc ; un contour illisible est noir, avec l\'épaisseur par défaut (0.5) si elle est nulle', p3.pages[0].rects.map((r) => [r.remplissage, r.contour, r.epaisseur, r.op]), [['1 1 1', null, 0.5, 'f'], [null, '0 0 0', 0.5, 'S']]);
  eq('des valeurs illisibles (position NaN, taille négative ou nulle, texte vide, couleur en mot, épaisseur négative, date illisible) : le fichier reste valide, avec les valeurs par défaut', [p3.erreurs, p3.info, p3.pages[0].textes.map((x) => [x.x, x.y, x.taille, x.couleur, x.texte]), p3.pages[0].traits.map((x) => [x.couleur, x.epaisseur])],
    [[], {}, [[0, 0, 10, '0 0 0', 'a'], [1, 2, 10, '0 0 0', 'b']], [['0 0 0', 0.5]]]);
  const p4 = lirePdf(run(`(() => { const d = pdfNouveau(); const p = d.page(); p.texte(10, 10, 'A'.repeat(5000)); return d.octets(); })()`));
  eq('un texte de 5000 caractères : le fichier reste valide', [p4.erreurs, p4.pages[0].textes[0].texte.length], [[], 5000]);
  const p5 = lirePdf(run(`(() => { const d = pdfNouveau(); for (let i = 0; i < 200; i++) { const p = d.page(); p.texte(10, 10, 'page ' + (i + 1)); } return d.octets(); })()`));
  eq('200 pages : le fichier reste valide, chaque page a son texte', [p5.erreurs, p5.pages.length, p5.pages[199].textes[0].texte, p5.nbObjets], [[], 200, 'page 200', 405]);
  eq('nbPages() suit les pages ajoutées', run('(() => { const d = pdfNouveau(); const a = d.nbPages(); d.page(); d.page(); return [a, d.nbPages()]; })()'), [0, 2]);
  const p6 = lirePdf(run(`(() => { const d = pdfNouveau({titre: 'Titre "avec" (parenthèses) \\\\ et 😀'}); d.page(); return d.octets(); })()`));
  eq('un titre avec guillemets, parenthèses, barre oblique et emoji : écrit en UTF-16, relu tel quel', [p6.erreurs, p6.info.titre], [[], 'Titre "avec" (parenthèses) \\ et 😀']);
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
