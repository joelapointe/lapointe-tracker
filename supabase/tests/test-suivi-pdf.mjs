// Demande 4 de Joé (29 sept. 2026) — L'EXPORT EN PDF de l'onglet « Suivi » (www/js/suivi-pdf.js, avec l'écrivain www/js/pdf-simple.js) : la mise en page de la feuille (paysage, « # | Client : Adresse | Dates des passages »,
// une section par route), le PDF = exactement ce que l'écran montre (filtre et recherche), et la REMISE du fichier (les plugins Capacitor « Filesystem » puis « Share » ; un téléchargement dans un navigateur).
// Le PDF fabriqué est relu par un lecteur indépendant et strict (pdf-lecteur.mjs), qui rend chaque texte avec sa position : le test reconstruit le tableau à partir des positions et le compare aux données.
// Ce que ce test ne peut PAS vérifier : la vraie feuille de partage d'Android (essai sur le téléphone de Joé) et l'aspect dans tous les lecteurs de PDF (essayé à part avec pdf.js dans un navigateur).
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
const lire = (f) => fs.readFileSync(WWW + f, 'utf8');
const J = JSON.stringify;
const proche = (a, b, e = 0.011) => Math.abs(a - b) <= e;

const JOE = { id: 'u-joe', nom: 'Joé', role: 'admin' };
const AUJOURDHUI = '2026-09-29';
const MAINTENANT = new Date('2026-09-29T16:00:00Z').getTime();
const T = (jour, h = 16) => `${jour}T${String(h).padStart(2, '0')}:00:00Z`;

// ─────────────────────────────────────────────────────────────────────
// PARTIE A : la mise en page seule (des données → un PDF), dans un contexte nu (sans page ni base)
// ─────────────────────────────────────────────────────────────────────
const ctxA = vm.createContext({ btoa, console });
for (const f of ['js/pdf-simple.js', 'js/admin-suivi.js', 'js/suivi-pdf.js']) vm.runInContext(lire(f), ctxA, { filename: f });
const runA = (c) => vm.runInContext(c, ctxA);
const largeur = (texte, taille, gras) => runA(`pdfLargeur(${J(texte)}, ${taille}, ${!!gras})`);
const couleur = (c) => runA(`pdfCouleur(${J(c)}, '#000000')`);

const MAINT = new Date(2026, 8, 29, 14, 30, 0);
// des données de PDF (ce que suiviPdfDonnees() prépare) : sections = [[nom, [[libellé, [dates], état, jours], …]], …]
const donnees = (sections, o = {}) => ({
  service: 'Coupe de gazon', saison: 'Saison 2026', depuis: '2026-01-01', aujourdhui: AUJOURDHUI, rythme: null, filtre: '', maintenant: MAINT, ...o,
  sections: sections.map(([nom, lignes]) => ({ nom, lignes: lignes.map(([libelle, dates, etat = 'neutre', jours = null], i) => ({ numero: i + 1, libelle, dates, total: dates.length, etat, jours })) })),
});
const fabriquer = (d) => { runA('__d = ' + J({ ...d, maintenant: '__DATE__' }).replace('"__DATE__"', `new Date(${d.maintenant.getTime()})`)); return runA('suiviPdfConstruire(__d)'); };
const lirePdfDe = (d) => lirePdf(fabriquer(d));

// Le tableau reconstruit à partir des positions des textes (le PDF « relu »)
function tableau(pdf, avecEtat) {
  const xNum = 60, xClient = 72, xDates = avecEtat ? 342 : 372, xEtat = 626, xNb = 750;
  const sections = [];
  const pieds = [], entetes = [], titres = [], filtres = [];
  let section = null;
  const suites = [];
  pdf.pages.forEach((page, p) => {
    const it = page.textes.map((t) => ({ ...t, fin: t.x + largeur(t.texte, t.taille, t.gras) }));
    const numeros = it.filter((t) => !t.gras && t.taille === 9 && proche(t.fin, xNum));
    const bandes = it.filter((t) => t.gras && t.taille === 10 && proche(t.x, 42));
    const evenements = [...numeros.map((n) => ({ y: n.y, sorte: 'ligne', n })), ...bandes.map((b) => ({ y: b.y, sorte: 'bande', b }))].sort((a, b) => a.y - b.y);
    evenements.forEach((e, k) => {
      if (e.sorte === 'bande') {
        const suite = / \(suite\)$/.test(e.b.texte);
        const nom = e.b.texte.replace(/ \(suite\)$/, '');
        const compte = it.find((t) => proche(t.fin, 750) && proche(t.y, e.b.y) && t.taille === 9);
        if (suite) { suites.push([p + 1, nom]); if (!section || section.nom !== nom) fail('la suite d\'une section (« ' + nom + ' ») ne suit pas la même section'); }
        else { section = { nom, nbClients: compte ? compte.texte : null, lignes: [] }; sections.push(section); }
        return;
      }
      const n = e.n;
      const suivant = evenements.slice(k + 1).find(() => true);
      const yFin = suivant ? suivant.y : Infinity;
      const dans = (t) => t.y >= n.y - 0.01 && t.y < yFin - 0.01;
      const lignesDe = (x) => it.filter((t) => dans(t) && proche(t.x, x)).sort((a, b) => a.y - b.y);
      const compte = it.find((t) => dans(t) && proche(t.fin, xNb) && proche(t.y, n.y) && !t.gras && t.taille === 9);
      section.lignes.push({
        numero: Number(n.texte), client: lignesDe(xClient).map((t) => t.texte), dates: lignesDe(xDates).map((t) => t.texte),
        etat: avecEtat ? lignesDe(xEtat).map((t) => t.texte) : undefined, etatCouleur: avecEtat ? (lignesDe(xEtat)[0] || {}).couleur : undefined, total: compte ? Number(compte.texte) : null, page: p + 1, y: n.y,
      });
    });
    pieds.push(it.filter((t) => t.y > 585).map((t) => t.texte));
    entetes.push(it.filter((t) => t.gras && t.taille === 9 && t.y < 130 && ['#', 'Client : Adresse', 'Dates des passages', 'État', 'Passages'].includes(t.texte)).map((t) => t.texte));
    titres.push(it.filter((t) => t.y < 110 && !(t.gras && t.taille === 9 && ['#', 'Client : Adresse', 'Dates des passages', 'État', 'Passages'].includes(t.texte)) && t.texte !== '').map((t) => t.texte));
  });
  return { sections, pieds, entetes, titres, suites };
}
// Toutes les données d'un tableau reconstruit, à plat : [nom de section, numéro, libellé]
const aplat = (t) => t.sections.flatMap((s) => s.lignes.map((l) => [s.nom, l.numero, l.client.join(' ')]));

log('=== LES PETITES FONCTIONS : DATES, SAISON, NOM DU FICHIER, FILTRE ===');
{
  const f = (c) => runA(c);
  eq('suiviPdfDateLongue : « 1er janvier 2026 », « 29 septembre 2026 », « 2 février 2025 » ; illisible : vide', [f(`suiviPdfDateLongue('2026-01-01')`), f(`suiviPdfDateLongue('2026-09-29')`), f(`suiviPdfDateLongue('2025-02-02')`), f(`suiviPdfDateLongue('abc')`), f('suiviPdfDateLongue(null)')], ['1er janvier 2026', '29 septembre 2026', '2 février 2025', '', '']);
  eq('… les douze mois en toutes lettres', ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map((m) => f(`suiviPdfDateLongue('2026-${m}-15')`)), ['15 janvier 2026', '15 février 2026', '15 mars 2026', '15 avril 2026', '15 mai 2026', '15 juin 2026', '15 juillet 2026', '15 août 2026', '15 septembre 2026', '15 octobre 2026', '15 novembre 2026', '15 décembre 2026']);
  eq('… le 11 et le 31 ne sont PAS « 1er »', [f(`suiviPdfDateLongue('2026-05-11')`), f(`suiviPdfDateLongue('2026-05-31')`)], ['11 mai 2026', '31 mai 2026']);
  eq('suiviPdfSaison : « Saison 2026 » (départ dans l\'année), « Saison 2025-2026 » (départ d\'une année passée), départ absent ou futur : l\'année courante', [f(`suiviPdfSaison('2026-01-01','2026-09-29')`), f(`suiviPdfSaison('2025-11-01','2026-01-10')`), f(`suiviPdfSaison('','2026-09-29')`), f(`suiviPdfSaison('2027-01-01','2026-09-29')`)], ['Saison 2026', 'Saison 2025-2026', 'Saison 2026', 'Saison 2026']);
  eq('suiviPdfNomFichier : sans accents ni espaces', [f(`suiviPdfNomFichier('Coupe de gazon','2026-09-29')`), f(`suiviPdfNomFichier('Épandage de sel','2026-09-29')`), f(`suiviPdfNomFichier('  Déneigement / manuel !  ','2026-09-29')`)], ['Suivi-des-passages_Coupe-de-gazon_2026-09-29.pdf', 'Suivi-des-passages_Epandage-de-sel_2026-09-29.pdf', 'Suivi-des-passages_Deneigement-manuel_2026-09-29.pdf']);
  eq('… un service sans nom : pas de trait bas en trop', f(`suiviPdfNomFichier('','2026-09-29')`), 'Suivi-des-passages_2026-09-29.pdf');
  eq('suiviPdfTexteFiltre : « Tous » sans recherche : rien', [f(`suiviPdfTexteFiltre('tous','',14)`), f(`suiviPdfTexteFiltre('tous','   ',null)`)], ['', '']);
  eq('… « À faire » avec un rythme, sans rythme ; « Aucun passage » ; avec une recherche', [f(`suiviPdfTexteFiltre('afaire','',14)`), f(`suiviPdfTexteFiltre('afaire','',null)`), f(`suiviPdfTexteFiltre('aucun','',14)`), f(`suiviPdfTexteFiltre('afaire',' pins ',14)`), f(`suiviPdfTexteFiltre('tous','tremblay',null)`)],
    ['clients à faire (sans passage, à faire ou en retard : rythme de 14 jours)', 'clients sans passage', 'clients sans passage', 'clients à faire (sans passage, à faire ou en retard : rythme de 14 jours) ; recherche « pins »', 'recherche « tremblay »']);
  eq('suiviPdfDatesEnLignes : tout sur une ligne quand ça tient ; les virgules restent collées à la date qui précède', f(`suiviPdfDatesEnLignes(['20 avr.','12 mai','26 mai'], 500, 9)`), ['20 avr., 12 mai, 26 mai']);
  const dl = f(`suiviPdfDatesEnLignes(['20 avr.','12 mai','26 mai','9 juin','23 juin','7 juil.'], 70, 9)`);
  eq('… coupé ENTRE deux dates, jamais au milieu d\'une date (« 12 mai » reste entier), chaque ligne tient dans la largeur, sauf la dernière virgule : rien ne se perd', [dl.every((x) => largeur(x, 9, false) <= 70), dl.join(' ').replace(/,/g, '').split(' ').join(' '), dl.length > 1, dl.slice(0, -1).every((x) => x.endsWith(',')), dl.at(-1).endsWith(',')], [true, '20 avr. 12 mai 26 mai 9 juin 23 juin 7 juil.', true, true, false]);
  eq('… aucune date : aucune ligne', f(`suiviPdfDatesEnLignes([], 100, 9)`), []);
  eq('… deux dates qui tiennent JUSTE (largeur = celle de « 1 mai, 2 mai ») restent sur une ligne ; un tout petit peu moins de place les sépare', [f(`suiviPdfDatesEnLignes(['1 mai','2 mai'], ${largeur('1 mai, 2 mai', 9, false)}, 9)`).length, f(`suiviPdfDatesEnLignes(['1 mai','2 mai'], ${largeur('1 mai, 2 mai', 9, false) - 0.01}, 9)`).length], [1, 2]);
  eq('… une première date plus large que la case n\'ajoute pas de ligne vide avant elle', f(`suiviPdfDatesEnLignes(['12 septembre 2025','3 mai'], 5, 9)`), ['12 septembre 2025,', '3 mai']);
  const long = Array.from({ length: 60 }, (_, i) => 'ligne ' + i);
  eq('suiviPdfLimiter : au plus 40 lignes ; la dernière finit par « … » ; sous la limite : rien ne change', [f(`suiviPdfLimiter(${J(long)}, 200, 9, false)`).length, f(`suiviPdfLimiter(${J(long)}, 200, 9, false)`).at(-1), f(`suiviPdfLimiter(${J(long.slice(0, 40))}, 200, 9, false)`).length, f(`suiviPdfLimiter(${J(long.slice(0, 40))}, 200, 9, false)`).at(-1)], [40, 'ligne 39…', 40, 'ligne 39']);
  eq('… la virgule qui finit la dernière ligne de dates est retirée avant « … » (« 27 sept.… », pas « 27 sept.,… »)', f(`suiviPdfLimiter(Array.from({length: 45}, (_, i) => '27 sept.,'), 200, 9, false)`).at(-1), '27 sept.…');
  const Lx = largeur('xxxxx', 9, false);
  const limite = f(`suiviPdfLimiter(${J(Array(39).fill('a').concat(['xxxxx'], Array(5).fill('z')))}, ${Lx}, 9, false)`);
  eq('… si « … » ferait dépasser la largeur, la dernière ligne (« xxxxx », qui tient juste) est raccourcie pour lui faire de la place : « xxx… »', [limite.length, limite.at(-1), largeur(limite.at(-1), 9, false) <= Lx + 1e-9], [40, 'xxx…', true]);
  eq('suiviPdfAjuster : un texte qui tient JUSTE ne change pas ; quand la coupure tombe après une espace, l\'espace est retirée avant « … »', [f(`suiviPdfAjuster('Bonjour', ${largeur('Bonjour', 9, false)}, 9, false)`), f(`suiviPdfAjuster('ab cd', ${largeur('ab …', 9, false)}, 9, false)`)], ['Bonjour', 'ab…']);
  eq('suiviPdfAjuster : un texte qui tient ne change pas ; un texte trop long finit par « … » et tient dans la largeur', [f(`suiviPdfAjuster('Bonjour', 500, 9, false)`), f(`suiviPdfAjuster('Bonjour tout le monde', 40, 9, false)`), largeur(f(`suiviPdfAjuster('Bonjour tout le monde', 40, 9, false)`), 9, false) <= 40], ['Bonjour', 'Bonjou…', true]);   // (« Bonjour… » ferait 40,01 points)
  eq('suiviPdfPluriel : 0 et 1 au singulier, 2 et plus au pluriel', [f(`suiviPdfPluriel(0,'client')`), f(`suiviPdfPluriel(1,'client')`), f(`suiviPdfPluriel(2,'client')`)], ['0 client', '1 client', '2 clients']);
  eq('suiviPdfBase64 : les octets en base64 (comme Buffer)', [f(`suiviPdfBase64(Uint8Array.from([0,1,2,250,251,252,253,254,255]))`) === Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]).toString('base64'), f(`suiviPdfBase64(new Uint8Array(100000).fill(200))`) === Buffer.alloc(100000, 200).toString('base64')], [true, true]);
}

log('\n=== LA PREMIÈRE PAGE : LE TITRE, LE RÉSUMÉ, L\'EN-TÊTE DU TABLEAU, LES SECTIONS ===');
{
  const d = donnees([
    ['Louiseville', [['Famille Tremblay : 10 rue des Pins, Louiseville', ['20 avr.', '12 mai', '26 mai', '9 juin', '23 juin', '7 juil.']], ['8 av. du Parc, Louiseville', ['22 sept.']]]],
    ['Sans route', [['Client D : 1 rue Sansroute, Ville', []]]],
  ]);
  const pdf = lirePdfDe(d);
  eq('le fichier est bien formé, en UNE page de 792 × 612 (lettre en paysage)', [pdf.erreurs, pdf.pages.length, pdf.pages[0].largeur, pdf.pages[0].hauteur], [[], 1, 792, 612]);
  eq('les informations du fichier : titre, auteur, date de création (29 sept. 2026, 14 h 30)', pdf.info, { titre: 'Suivi des passages - Coupe de gazon', auteur: 'Entretien Lapointe', date: '20260929143000' });
  const t = pdf.pages[0].textes;
  eq('le grand titre (16 points, gras) à (36, 50)', [t[0].texte, t[0].x, t[0].y, t[0].taille, t[0].gras], ['SUIVI DES PASSAGES PAR CLIENT', 36, 50, 16, true]);
  eq('le sous-titre comme sa feuille : « Entretien Lapointe - Saison 2026 - Coupe de gazon » (11 points)', [t[1].texte, t[1].x, t[1].y, t[1].taille, t[1].gras], ['Entretien Lapointe - Saison 2026 - Coupe de gazon', 36, 68, 11, false]);
  eq('le résumé : depuis quand, combien de clients et de passages (7 = 6 + 1 + 0), la date d\'impression ; en gris', [t[2].texte, t[2].y, t[2].taille, t[2].couleur], ['Passages depuis le 1er janvier 2026 · 3 clients · 7 passages · Imprimé le 29 septembre 2026', 83, 9, couleur('#666666')]);
  const tab = tableau(pdf, false);
  eq('l\'en-tête du tableau : # | Client : Adresse | Dates des passages | Passages (sans rythme : pas de colonne « État »)', tab.entetes[0], ['#', 'Client : Adresse', 'Dates des passages', 'Passages']);
  const ent = (nom) => t.find((x) => x.texte === nom && x.gras && x.taille === 9);
  eq('… leur place : « # » et « Passages » finissent à droite de leur colonne (60 et 750), « Client : Adresse » et « Dates des passages » commencent à gauche de la leur (72 et 372)', [proche(ent('#').x + largeur('#', 9, true), 60), proche(ent('Passages').x + largeur('Passages', 9, true), 750), ent('Client : Adresse').x, ent('Dates des passages').x], [true, true, 72, 372]);
  eq('les sections en MAJUSCULES avec leur nombre de clients (« 1 client » au singulier)', tab.sections.map((s) => [s.nom, s.nbClients]), [['LOUISEVILLE', '2 clients'], ['SANS ROUTE', '1 client']]);
  eq('les lignes : numérotées depuis 1 dans CHAQUE section', tab.sections.map((s) => s.lignes.map((l) => l.numero)), [[1, 2], [1]]);
  eq('… « Client : Adresse » et les dates, écrites en toutes lettres et dans l\'ordre', tab.sections.flatMap((s) => s.lignes.map((l) => [l.client.join(' '), l.dates.join(' ')])),
    [['Famille Tremblay : 10 rue des Pins, Louiseville', '20 avr., 12 mai, 26 mai, 9 juin, 23 juin, 7 juil.'], ['8 av. du Parc, Louiseville', '22 sept.'], ['Client D : 1 rue Sansroute, Ville', 'Aucun passage']]);
  eq('… le nombre de passages de chaque ligne', tab.sections.flatMap((s) => s.lignes.map((l) => l.total)), [6, 1, 0]);
  const gris = t.find((x) => x.texte === 'Aucun passage');
  eq('« Aucun passage » est écrit en GRIS (sans la colonne « État »)', gris.couleur, couleur('#888888'));
  eq('le pied de page : le nom, et « Page 1 / 1 » à droite', tab.pieds[0], ['Entretien Lapointe - Suivi des passages - Coupe de gazon', 'Page 1 / 1']);
  const pied = t.find((x) => x.texte === 'Page 1 / 1');
  eq('… « Page 1 / 1 » finit au bord droit de la zone imprimable (756)', proche(pied.x + largeur(pied.texte, 8, false), 756), true);
  eq('la 1re page n\'a pas de « Liste : … » quand rien n\'est filtré', t.some((x) => /^Liste :/.test(x.texte)), false);
  const bandes = pdf.pages[0].rects.filter((r) => r.remplissage === couleur('#e5e5e5'));
  eq('une bande grise par section (720 de large, 19 de haut), l\'en-tête du tableau est une bande plus claire', [bandes.length, bandes.every((b) => b.l === 720 && b.h === 19 && b.x === 36), pdf.pages[0].rects.filter((r) => r.remplissage === couleur('#f0f0f0')).length], [2, true, 1]);
  eq('un trait sous chaque ligne (3 lignes) et sous l\'en-tête (1 trait plus épais)', [pdf.pages[0].traits.filter((x) => x.epaisseur === 0.4).length, pdf.pages[0].traits.filter((x) => x.epaisseur === 1).length], [3, 1]);
}

log('\n=== AVEC UN RYTHME : LA COLONNE « ÉTAT » ===');
{
  const d = donnees([['Louiseville', [['A : 1 rue A', ['1 mai'], 'retard', 21], ['B : 2 rue B', ['2 mai'], 'afaire', 14], ['C : 3 rue C', ['3 mai'], 'ok', 3], ['D : 4 rue D', [], 'aucun', null], ['E : 5 rue E', ['4 mai'], 'neutre', 9]]]], { rythme: 14 });
  const pdf = lirePdfDe(d);
  const tab = tableau(pdf, true);
  eq('l\'en-tête a la colonne « État » de plus', tab.entetes[0], ['#', 'Client : Adresse', 'Dates des passages', 'État', 'Passages']);
  eq('l\'état de chaque client, avec les jours (« Aucun passage » sans jours ; « neutre » : rien)', tab.sections[0].lignes.map((l) => l.etat.join(' ')), ['En retard · 21 j', 'À faire · 14 j', 'À jour · 3 j', 'Aucun passage', '']);
  eq('les couleurs de l\'état : rouge (retard, aucun), orange (à faire), vert (à jour)', tab.sections[0].lignes.map((l) => l.etatCouleur), [couleur('#b91c1c'), couleur('#b45309'), couleur('#15803d'), couleur('#b91c1c'), undefined]);
  eq('l\'état est écrit en gras, 8 points', pdf.pages[0].textes.filter((t) => t.texte === 'En retard · 21 j').map((t) => [t.gras, t.taille]), [[true, 8]]);
  eq('une ligne sans passage : la case des dates est vide (l\'état le dit déjà) ; les dates des autres sont là', tab.sections[0].lignes.map((l) => l.dates.join(' ')), ['1 mai', '2 mai', '3 mai', '', '4 mai']);
  eq('les colonnes se suivent sans se chevaucher : # 60, client 72, dates 342, état 626, passages 750', [tab.sections[0].lignes.length, pdf.pages[0].textes.filter((t) => t.texte === 'D : 4 rue D').map((t) => t.x)], [5, [72]]);
  const sans = tableau(lirePdfDe(donnees([['R', [['A : 1 rue A', ['1 mai'], 'retard', 21]]]], { rythme: null })), false);
  eq('sans rythme : même si les lignes portent un état, la colonne « État » n\'existe pas', [sans.entetes[0].includes('État'), sans.sections[0].lignes[0].dates.join(' ')], [false, '1 mai']);
}

log('\n=== LE FILTRE ET LA RECHERCHE : ILS SONT DITS SUR LA 1RE PAGE ===');
{
  const d = donnees([['R', [['A : 1 rue A', ['1 mai']]]]], { filtre: 'clients à faire (sans passage, à faire ou en retard : rythme de 14 jours) ; recherche « pins »' });
  const pdf = lirePdfDe(d);
  const l = pdf.pages[0].textes.find((x) => /^Liste :/.test(x.texte));
  eq('« Liste : … » sous le résumé (gras, 9 points), et le tableau commence plus bas', [l.texte, l.y, l.gras, l.taille], ['Liste : clients à faire (sans passage, à faire ou en retard : rythme de 14 jours) ; recherche « pins »', 96, true, 9]);
  const sans = lirePdfDe(donnees([['R', [['A : 1 rue A', ['1 mai']]]]]));
  const yEntete = (p) => p.pages[0].rects.find((r) => r.remplissage === couleur('#f0f0f0')).y;
  eq('… avec la ligne « Liste » l\'en-tête du tableau est à 105 ; sans elle, à 92', [yEntete(pdf), yEntete(sans)], [105, 92]);
  const longue = lirePdfDe(donnees([['R', [['A : 1 rue A', ['1 mai']]]]], { filtre: 'recherche « ' + 'très long '.repeat(40) + '»' }));
  const ll = longue.pages[0].textes.find((x) => /^Liste :/.test(x.texte));
  eq('une recherche très longue : une seule ligne, terminée par « … », qui ne dépasse pas la zone imprimable', [ll.texte.endsWith('…'), ll.x + largeur(ll.texte, 9, true) <= 756.01], [true, true]);
  const s = lirePdfDe(donnees([['R', [['A : 1 rue A', ['1 mai']]]]], { service: 'Un service au nom vraiment mais alors vraiment très très très très très très très très très très long, long, long, long, long' }));
  const sousTitre = s.pages[0].textes[1];
  eq('un nom de service démesuré : le sous-titre et le pied de page sont raccourcis (…) et restent dans la page', [sousTitre.texte.endsWith('…'), sousTitre.x + largeur(sousTitre.texte, 11, false) <= 756.01, s.pages[0].textes.filter((x) => x.y > 585).every((x) => x.x + largeur(x.texte, x.taille, x.gras) <= 756.01)], [true, true, true]);
}

log('\n=== LES TEXTES LONGS : ILS SE COUPENT DANS LEUR COLONNE ===');
{
  const libelle = 'Client Très Long Nom Avec Beaucoup De Mots : 12345 boulevard de la Très Très Longue Avenue Principale Nord-Ouest, Saint-Étienne-des-Grès (Québec) G0X 2P0 — Entrée arrière';
  const dates = Array.from({ length: 45 }, (_, i) => `${1 + (i % 28)} ${['mai', 'juin', 'juil.', 'août'][i % 4]}`);
  const pdf = lirePdfDe(donnees([['Saint-Étienne-des-Grès', [[libelle, dates], ['B', ['1 mai']]]]]));
  eq('le fichier reste bien formé', pdf.erreurs, []);
  const tab = tableau(pdf, false);
  const l = tab.sections[0].lignes[0];
  eq('un long nom + adresse : plusieurs lignes, chacune tient dans la colonne (288 points), rien ne se perd', [l.client.length > 1, l.client.every((x) => largeur(x, 9, false) <= 288.01), l.client.join(' ')], [true, true, libelle]);
  eq('45 dates : plusieurs lignes coupées entre deux dates, chacune tient dans sa colonne (322 points), rien ne se perd, aucune ligne ne commence par un mois seul', [l.dates.length > 2, l.dates.every((x) => largeur(x, 9, false) <= 322.01), l.dates.join(' ').replace(/,/g, ''), l.dates.every((x) => /^\d/.test(x))], [true, true, dates.join(' '), true]);
  eq('la 2e ligne est plus bas que la 1re (la 1re a pris la place de ses lignes)', tab.sections[0].lignes[1].y > l.y + (Math.max(l.client.length, l.dates.length) - 1) * 11.5, true);
  const tous = pdf.pages.flatMap((p) => p.textes);
  eq('tout le texte du document reste dans la zone imprimable (36 à 756 en x)', tous.every((x) => x.x >= 35.99 && x.x + largeur(x.texte, x.taille, x.gras) <= 756.01), true);
  const mot = lirePdfDe(donnees([['R', [['Motsanscoupure'.repeat(12), ['1 mai']]]]]));
  const lm = tableau(mot, false).sections[0].lignes[0];
  eq('un « mot » plus large que la colonne est coupé au caractère près (rien ne dépasse, rien ne se perd)', [lm.client.length > 1, lm.client.every((x) => largeur(x, 9, false) <= 288.01), lm.client.join('')], [true, true, 'Motsanscoupure'.repeat(12)]);
  const enorme = Array.from({ length: 500 }, (_, i) => `${1 + (i % 28)} ${['mai', 'juin', 'juil.', 'août'][i % 4]} 20${10 + (i % 15)}`);
  const pe = lirePdfDe(donnees([['R', [['Cas extrême', enorme], ['Suivant', ['1 mai']]]]]));
  const te = tableau(pe, false);
  eq('500 dates : la case est limitée à 40 lignes, terminée par « … », et tient sur une page avec la ligne suivante', [pe.erreurs, te.sections[0].lignes[0].dates.length, te.sections[0].lignes[0].dates.at(-1).endsWith('…'), te.sections[0].lignes.length], [[], 40, true, 2]);
  eq('« Suivant » est bien écrit après (sur la même page ou la suivante), dans la zone du tableau', te.sections[0].lignes[1].y <= 568, true);
  const cara = lirePdfDe(donnees([['Étienne — œuvre', [['Éric « Été » ’ … € : 5 rue Ā 😀 ł', ['1 mai']]]]]));
  const tc = tableau(cara, false);
  eq('les accents et signes typographiques sont gardés ; ce que la table Windows-1252 n\'a pas devient « ? » (Ā → A, emoji et ł → ?)', [tc.sections[0].nom, tc.sections[0].lignes[0].client.join(' ')], ['ÉTIENNE — ŒUVRE', 'Éric « Été » ’ … € : 5 rue A ? ?']);
}

log('\n=== PLUSIEURS PAGES : L\'EN-TÊTE RÉPÉTÉ, « (SUITE) », PAS DE SECTION ORPHELINE, LES PIEDS ===');
{
  const lignes60 = Array.from({ length: 60 }, (_, i) => [`Client ${i + 1} : ${100 + i} rue Numéro ${i + 1}`, ['1 mai', '15 mai']]);
  const d = donnees([['Grande route', lignes60], ['Petite route', [['Petit client : 1 rue P', ['3 juin']]]]]);
  const pdf = lirePdfDe(d);
  const tab = tableau(pdf, false);
  eq('le fichier est bien formé, sur plusieurs pages', [pdf.erreurs, pdf.pages.length > 2], [[], true]);
  eq('TOUS les clients sont là, une seule fois, dans l\'ordre, et la numérotation de chaque section repart de 1', [aplat(tab).length, aplat(tab).map((x) => x[1]).join(',') === [...Array(60).keys()].map((i) => i + 1).concat([1]).join(','), aplat(tab).map((x) => x[2]).slice(0, 2), aplat(tab).at(-1)],
    [61, true, ['Client 1 : 100 rue Numéro 1', 'Client 2 : 101 rue Numéro 2'], ['PETITE ROUTE', 1, 'Petit client : 1 rue P']]);
  eq('une seule section « GRANDE ROUTE » au départ ; les autres pages la continuent (« … (suite) »), dans le bon ordre des pages', [tab.sections.map((s) => s.nom), tab.suites.map((x) => x[1]).every((n) => n === 'GRANDE ROUTE' || n === 'PETITE ROUTE'), tab.suites.map((x) => x[0]).every((p, i, a) => i === 0 || p > a[i - 1])], [['GRANDE ROUTE', 'PETITE ROUTE'], true, true]);
  eq('la 1re page a le grand titre ; les autres, « SUIVI DES PASSAGES PAR CLIENT - Coupe de gazon (suite) »', [tab.titres[0][0], tab.titres.slice(1).every((t) => t[0] === 'SUIVI DES PASSAGES PAR CLIENT - Coupe de gazon (suite)')], ['SUIVI DES PASSAGES PAR CLIENT', true]);
  eq('l\'en-tête du tableau est répété sur CHAQUE page', tab.entetes.every((e) => e.join('|') === '#|Client : Adresse|Dates des passages|Passages'), true);
  eq('les pieds : « Page 1 / N », « Page 2 / N »… avec le bon nombre de pages', tab.pieds.map((p) => p.at(-1)), pdf.pages.map((_, i) => `Page ${i + 1} / ${pdf.pages.length}`));
  const pdfTextes = pdf.pages.flatMap((p) => p.textes);
  eq('aucun texte du tableau ne descend plus bas que 568 (le pied de page est en dessous) ; les pieds sont à 590', [pdf.pages.every((p) => p.textes.filter((t) => t.y < 585).every((t) => t.y <= 568)), pdfTextes.filter((t) => t.y > 585).every((t) => t.y === 590)], [true, true]);
  eq('les lignes ne sont écrites ni sur l\'en-tête du haut ni sur les pieds, et leur départ est sous l\'en-tête du tableau', pdf.pages.every((p) => { const entete = p.rects.find((r) => r.remplissage === couleur('#f0f0f0')); return p.textes.filter((t) => /^Client \d+ :/.test(t.texte)).every((t) => t.y > entete.y + 17); }), true);
  // pas de section orpheline : la bande d'une section est toujours suivie de sa 1re ligne, sur la MÊME page (la ligne est juste sous la bande)
  const orphelines = [];
  pdf.pages.forEach((p, i) => {
    p.rects.filter((r) => r.remplissage === couleur('#e5e5e5')).forEach((b) => {
      const ligneSous = p.textes.find((t) => !t.gras && t.taille === 9 && proche(t.x + largeur(t.texte, 9, false), 60) && t.y > b.y + 19 && t.y < b.y + 19 + 14);
      if (!ligneSous) orphelines.push(i + 1);
    });
  });
  eq('aucune bande de section n\'est seule au bas d\'une page : chaque bande a sa 1re ligne juste dessous', orphelines, []);
  // une section qui commence tout au bas d'une page : construire des données où une petite section tombe en fin de page
  let trouve = false;
  for (let k = 10; k <= 30 && !trouve; k++) {
    const p = lirePdfDe(donnees([['A', Array.from({ length: k }, (_, i) => [`x${i}`, ['1 mai']])], ['B', [['b1', ['1 mai']], ['b2', ['1 mai']]]]]));
    const t = tableau(p, false);
    const b = t.sections.find((s) => s.nom === 'B');
    // B commence en haut d'une nouvelle page seulement si sa bande ne tenait pas avec sa 1re ligne : alors sa 1re ligne est sur une autre page que la dernière ligne de A
    if (b && b.lignes[0].page > t.sections[0].lignes.at(-1).page) trouve = true;
    if (!p.pages.every((pg) => pg.textes.filter((x) => x.y < 585).every((x) => x.y <= 568))) fail('une ligne dépasse le bas de page (k = ' + k + ')');
  }
  eq('quand la bande + la 1re ligne ne tiennent plus au bas de la page, la section entière commence sur la page suivante', trouve, true);
  // deux exécutions identiques : mêmes octets
  eq('deux fabrications avec les mêmes données donnent EXACTEMENT les mêmes octets', Buffer.compare(Buffer.from(fabriquer(d)), Buffer.from(fabriquer(d))), 0);
}

log('\n=== DES CAS LIMITES DE LA MISE EN PAGE ===');
{
  const vide = lirePdfDe(donnees([]));
  eq('aucune section (le bouton l\'interdit, mais la fabrication ne plante pas) : une page valide avec le titre et le pied', [vide.erreurs, vide.pages.length, vide.pages[0].textes[0].texte, vide.pages[0].textes.some((t) => t.texte === 'Page 1 / 1')], [[], 1, 'SUIVI DES PASSAGES PAR CLIENT', true]);
  const un = tableau(lirePdfDe(donnees([['R', [['Un seul client', ['1 mai']]]]])), false);
  eq('un seul client : « 1 client » et « 1 passage » (singulier)', [un.sections[0].nbClients, lirePdfDe(donnees([['R', [['Un seul client', ['1 mai']]]]])).pages[0].textes[2].texte], ['1 client', 'Passages depuis le 1er janvier 2026 · 1 client · 1 passage · Imprimé le 29 septembre 2026']);
  const zero = lirePdfDe(donnees([['R', [['Sans passage', []]]]]));
  eq('zéro passage : « 0 passage » (singulier)', zero.pages[0].textes[2].texte.includes('· 0 passage ·'), true);
  const annee = lirePdfDe(donnees([['R', [['A', ['15 déc. 2025', '3 janv.']]]]], { saison: 'Saison 2025-2026', depuis: '2025-11-01' }));
  eq('une saison sur deux années : « Saison 2025-2026 » et la date de départ complète', [annee.pages[0].textes[1].texte, annee.pages[0].textes[2].texte.startsWith('Passages depuis le 1er novembre 2025')], ['Entretien Lapointe - Saison 2025-2026 - Coupe de gazon', true]);
  const beaucoup = Array.from({ length: 16 }, (_, s) => [`Section ${s + 1}`, Array.from({ length: 9 }, (_, i) => [`Client ${s}-${i}`, ['1 mai']])]);
  const gros = lirePdfDe(donnees(beaucoup));
  const tg = tableau(gros, false);
  eq('16 sections de 9 clients (144 lignes) : tout est là, dans l\'ordre, et le fichier reste valide', [gros.erreurs, aplat(tg).length, tg.sections.map((s) => s.nom).join('|') === Array.from({ length: 16 }, (_, i) => `SECTION ${i + 1}`).join('|')], [[], 144, true]);
  const nom = tableau(lirePdfDe(donnees([['Été (secteur nord)', [['A', ['1 mai']]]]])), false);
  eq('un nom de section avec accents et parenthèses : en majuscules, accents gardés', nom.sections[0].nom, 'ÉTÉ (SECTEUR NORD)');
}

log('\n=== LA GÉOMÉTRIE EXACTE : HAUTEURS, POSITIONS, PAGES ===');
{
  const g = lirePdfDe(donnees([['Route', [['A', ['1 mai']], ['B', ['2 mai']], ['C', ['3 mai']]]]]));
  const p = g.pages[0];
  const entete = p.rects.find((r) => r.remplissage === couleur('#f0f0f0'));
  const bande = p.rects.find((r) => r.remplissage === couleur('#e5e5e5'));
  eq('l\'en-tête du tableau : une bande de 17 points de haut à y = 92 ; ses textes ont leur ligne de base 12 points plus bas ; un trait de 1 point, gris foncé, en dessous', [entete.y, entete.h, p.textes.filter((t) => t.gras && t.taille === 9 && t.y < 110).map((t) => t.y), p.traits.filter((t) => t.epaisseur === 1).map((t) => [t.y1, t.couleur])], [92, 17, [104, 104, 104, 104], [[109, couleur('#333333')]]]);
  eq('la bande de la section est juste sous l\'en-tête (y = 109), de 19 points ; son titre a sa ligne de base 13 points plus bas, comme le nombre de clients', [bande.y, bande.h, p.textes.filter((t) => t.gras && t.taille === 10).map((t) => t.y), p.textes.filter((t) => t.texte === '3 clients').map((t) => t.y)], [109, 19, [122], [122]]);
  const nombres = p.textes.filter((t) => !t.gras && t.taille === 9 && proche(t.x + largeur(t.texte, 9, false), 60));
  eq('les lignes d\'une seule ligne de texte ont 17 points de haut (3 + 9 + 5) : la 1re a sa ligne de base à 128 + 12 = 140, puis 157, 174', nombres.map((t) => t.y), [140, 157, 174]);
  eq('un trait fin gris clair (0,4 point) sous chaque ligne, à la fin de la ligne (145, 162, 179)', p.traits.filter((t) => t.epaisseur === 0.4).map((t) => [t.y1, t.y2, t.x1, t.x2, t.couleur]), [145, 162, 179].map((y) => [y, y, 36, 756, couleur('#cccccc')]));
  // une ligne de deux lignes de texte
  const mots = Array.from({ length: 25 }, () => 'mot').join(' ');
  const g2 = lirePdfDe(donnees([['Route', [[mots, ['1 mai']], ['Suivant', ['2 mai']]]]]));
  const t2 = tableau(g2, false).sections[0].lignes;
  eq('une case sur 2 lignes : la 2e ligne est 11,5 points plus bas ; la ligne mesure alors 28,5 points (3 + 9 + 11,5 + 5) : la suivante commence 28,5 plus bas', [t2[0].client.length, g2.pages[0].textes.filter((t) => t.texte.startsWith('mot')).map((t) => t.y), t2[1].y - t2[0].y], [2, [140, 151.5], 28.5]);
  // une case de dates sur plusieurs lignes, et un état sur 2 lignes (un nombre de jours démesuré) : chaque ligne 11,5 points plus bas que la précédente
  const beaucoupDates = Array.from({ length: 30 }, (_, i) => `${1 + (i % 28)} ${['mai', 'juin'][i % 2]}`);
  const g4 = lirePdfDe(donnees([['Route', [['A', beaucoupDates, 'retard', 123456789]]]], { rythme: 14 }));
  const t4 = g4.pages[0].textes;
  const yDates = t4.filter((t) => proche(t.x, 342) && !t.gras && t.taille === 9).map((t) => t.y);
  const yEtat = t4.filter((t) => proche(t.x, 626) && t.taille === 8).map((t) => t.y);
  eq('30 dates sur plusieurs lignes : chaque ligne est 11,5 points plus bas que la précédente (à partir de 140)', [yDates.length > 2, yDates], [true, yDates.map((_, i) => 140 + 11.5 * i)]);
  eq('… un état sur 2 lignes (« En retard · 123456789 j ») : 140 puis 151,5, en gras de 8 points, rouge', [yEtat, t4.filter((t) => proche(t.x, 626) && t.taille === 8).every((t) => t.gras && t.couleur === couleur('#b91c1c'))], [[140, 151.5], true]);
  eq('… les dates sont écrites en NOIR ; « État » commence à 626', [t4.filter((t) => proche(t.x, 342) && !t.gras && t.taille === 9).every((t) => t.couleur === couleur('#000000')), t4.find((t) => t.texte === 'État').x], [true, 626]);
  // une section qui commence tout au bas d'une page : sa bande ET sa 1re ligne doivent tenir (536 + 19 + 17 = 572 > 568 : la page suivante ; 519 + 19 + 17 = 555 : la même page)
  const pageDeB = (k) => { const p = lirePdfDe(donnees([['A', Array.from({ length: k }, (_, i) => [`x${i}`, ['1 mai']])], ['B', [['b1', ['1 mai']], ['b2', ['1 mai']]]]])); return tableau(p, false).sections.find((s) => s.nom === 'B').lignes[0].page; };
  eq('la section B, après 23 lignes de A : sur la page 1 ; après 24 lignes : sur la page 2 (sa bande et sa 1re ligne ne tiennent plus)', [pageDeB(23), pageDeB(24)], [1, 2]);
  // les pages suivantes
  const ligne60 = Array.from({ length: 60 }, (_, i) => [`Client ${i + 1}`, ['1 mai']]);
  const g3 = lirePdfDe(donnees([['Grande route', ligne60], ['Petite route', [['Petit', ['3 juin']]]]]));
  const enteteSuite = g3.pages[1].rects.find((r) => r.remplissage === couleur('#f0f0f0'));
  eq('les pages suivantes : le titre gris à y = 44, l\'en-tête du tableau à y = 52, puis la bande « (suite) » juste dessous (y = 69)', [g3.pages[1].textes[0].y, g3.pages[1].textes[0].taille, enteteSuite.y, g3.pages[1].rects.filter((r) => r.remplissage === couleur('#e5e5e5'))[0].y], [44, 9, 52, 69]);
  const compte = (pg) => pg.textes.filter((t) => !t.gras && t.taille === 9 && proche(t.x + largeur(t.texte, 9, false), 60)).length;
  eq('60 + 1 clients : 3 pages, 25 lignes sur la 1re (la 26e ne tient plus : 128 + 26 × 17 > 568), 28 sur la 2e, 8 sur la 3e (les 7 dernières de la grande route et le client de la petite)', [g3.pages.length, g3.pages.map(compte)], [3, [25, 28, 8]]);
  const dernier = g3.pages[0].textes.filter((t) => /^Client \d+$/.test(t.texte)).map((t) => t.y);
  eq('… la dernière ligne de la 1re page finit à 553 (pas plus bas que 568)', Math.max(...dernier) + 5 + 3 <= 568 && Math.max(...dernier) === 128 + 24 * 17 + 12, true);
}

// ─────────────────────────────────────────────────────────────────────
// PARTIE B : dans l'application (les vrais fichiers, un faux navigateur, une fausse base, un faux Capacitor)
// ─────────────────────────────────────────────────────────────────────
const ROUTES = () => [{ id: 'r-lou', nom: 'Louiseville', actif: true }, { id: 'r-yam', nom: 'Yamachiche', actif: true }, { id: 'r-tmp', nom: 'Temporaire SS', actif: true }];
const STOPS = () => [
  { id: 's1b', adresse: '10 Rue des Pins, Louiseville', client: '', service: 'Coupe de gazon', route_id: 'r-tmp', ordre: 3, actif: true, created_at: '2026-09-25T12:00:00Z' },
  { id: 's2', adresse: '8 av. du Parc, Louiseville', client: null, service: 'Coupe de gazon', route_id: 'r-lou', ordre: 1, actif: true, created_at: '2026-04-01T12:01:00Z' },
  { id: 's1', adresse: '10 rue des Pins, Louiseville', client: 'Famille Tremblay', service: 'Coupe de gazon', route_id: 'r-lou', ordre: 0, actif: true, created_at: '2026-04-01T12:00:00Z' },
  { id: 's3', adresse: '55 chemin du Lac, Yamachiche', client: 'Client C', service: 'Coupe de gazon', route_id: 'r-yam', ordre: 0, actif: true, created_at: '2026-04-02T12:00:00Z' },
  { id: 's4', adresse: '1 rue Sansroute, Ville', client: 'Client D', service: 'Coupe de gazon', route_id: null, ordre: 0, actif: true, created_at: '2026-04-03T12:00:00Z' },
  { id: 's6', adresse: '10 rue des Pins, Louiseville', client: 'Famille Tremblay', service: 'Épandage de sel', route_id: 'r-lou', ordre: 0, actif: true, created_at: '2026-01-10T12:00:00Z' },
  { id: 's7b', adresse: '2 RUE ETE, VILLE', client: '', service: 'Coupe de gazon', route_id: 'r-tmp', ordre: 4, actif: true, created_at: '2026-09-26T12:00:00Z' },
  { id: 's7', adresse: '2 rue Été, Ville', client: 'Client E', service: 'Coupe de gazon', route_id: 'r-yam', ordre: 1, actif: true, created_at: '2026-04-04T12:00:00Z' },
];
const COMPLETIONS = () => [
  { id: 'c01', stop_id: 's1', complete_le: T('2026-04-20') }, { id: 'c02', stop_id: 's1', complete_le: T('2026-05-12') }, { id: 'c03', stop_id: 's1', complete_le: T('2026-05-26') },
  { id: 'c04', stop_id: 's1', complete_le: T('2026-06-09') }, { id: 'c05', stop_id: 's1b', complete_le: T('2026-06-09') }, { id: 'c06', stop_id: 's1b', complete_le: T('2026-06-23') },
  { id: 'c07', stop_id: 's3', complete_le: T('2026-09-12') }, { id: 'c08', stop_id: 's6', complete_le: T('2026-01-15') }, { id: 'c09', stop_id: 's7b', complete_le: T('2026-09-27') },
];
const MANUELS = () => [{ id: 'm1', stop_id: 's1', jour: '2026-07-07', note: 'remplaçant' }, { id: 'm2', stop_id: 's2', jour: '2026-09-22', note: null }];
const TYPES = () => [{ nom: 'Coupe de gazon', actif: true, frequence_jours: 14 }, { nom: 'Épandage de sel', actif: true, frequence_jours: null }];

const tous = (n) => [n, ...n.children.flatMap(tous)];
const parClasse = (n, c) => tous(n).filter((x) => (x.className || '').split(/\s+/).includes(c));
const cliquer = async (e) => { const r = e.onclick(); if (r && r.then) await r; };

function monde(o = {}) {
  const statiques = {};
  const clics = [];
  const creer = (id, balise = '') => {
    const e = { id: id ?? '', tagName: String(balise).toUpperCase(), children: [], style: {}, dataset: {}, attrs: {}, textContent: '', value: '', className: '', checked: false, disabled: false, onclick: null, onchange: null, oninput: null, type: '', href: '', download: '',
      min: '', max: '', placeholder: '', title: '', maxLength: 0, parent: null,
      classList: {
        add: (...c) => c.forEach((x) => { if (!e.className.split(/\s+/).includes(x)) e.className = (e.className + ' ' + x).trim(); }),
        remove: (...c) => { e.className = e.className.split(/\s+/).filter((x) => x && !c.includes(x)).join(' '); },
        contains: (c) => e.className.split(/\s+/).includes(c),
        toggle: (c, on) => { const a = e.className.split(/\s+/).includes(c); if (on === undefined ? !a : on) e.classList.add(c); else e.classList.remove(c); },
      },
      appendChild(c) { c.parent = e; e.children.push(c); return c; }, setAttribute(k, v) { e.attrs[k] = v; }, getAttribute(k) { return e.attrs[k]; },
      remove() { if (e.parent) e.parent.children = e.parent.children.filter((x) => x !== e); }, focus() {}, addEventListener() {}, querySelector() { return null; },
      click() { clics.push({ balise: e.tagName, href: e.href, download: e.download, dansLeDocument: !!e.parent }); } };
    Object.defineProperty(e, 'innerHTML', { get() { return ''; }, set(v) { if (v === '') e.children = []; else throw new Error('innerHTML avec du texte : ' + String(v).slice(0, 40)); } });
    return e;
  };
  const trouverDans = (n, id) => { if (n.id === id) return n; for (const c of n.children) { const r = trouverDans(c, id); if (r) return r; } return null; };
  const el = (id) => (statiques[id] ??= creer(id, 'div'));
  const getElementById = (id) => { if (statiques[id]) return statiques[id]; for (const r of Object.values(statiques)) { const t = trouverDans(r, id); if (t) return t; } return el(id); };
  const pageBody = creer('body', 'body');   // (le corps de la page : là où le lien de téléchargement est mis, puis retiré)

  const donneesDb = { passe_arrets: o.completions ?? COMPLETIONS(), passages_manuels: o.manuels ?? MANUELS(), types_service: o.types ?? TYPES() };
  const appels = { requetes: [], toasts: [], writeFile: [], share: [], blobs: [], urls: [], reseau: [], minuteries: [] };
  const executer = async (q) => {
    appels.requetes.push({ table: q.table, op: q.op });
    if (q.op !== 'select') return { data: null, error: { message: 'le PDF ne doit rien écrire dans la base' } };
    const lignes = donneesDb[q.table] ?? [];
    const filtrer = (l) => q.filtres.every(([f, c, v]) => (f === 'gte' ? String(l[c]) >= String(v) : f === 'eq' ? l[c] === v : f === 'in' ? v.includes(l[c]) : true));
    let r = lignes.filter(filtrer).map((l) => ({ ...l }));
    q.ordres.forEach(([c, sens]) => { r.sort((a, b) => (sens === 'desc' ? -1 : 1) * (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0)); });
    if (q.plage) r = r.slice(q.plage[0], q.plage[1] + 1);
    if (q.cols && !/[(!]/.test(q.cols) && q.cols.trim() !== '*') { const cols = q.cols.split(',').map((x) => x.trim()); r = r.map((l) => Object.fromEntries(cols.map((c) => [c, l[c]]))); }
    return { data: r, error: null };
  };
  const fauxDb = {
    channel() { const c = { on() { return c; }, subscribe() { return c; } }; return c; }, rpc: async () => ({ data: null, error: null }),
    from: (table) => {
      const q = { table, op: 'select', cols: null, filtres: [], ordres: [], plage: null };
      q.select = (c) => { q.cols = c; return q; };
      q.gte = (c, v) => { q.filtres.push(['gte', c, v]); return q; };
      q.eq = (c, v) => { q.filtres.push(['eq', c, v]); return q; };
      q.in = (c, l) => { q.filtres.push(['in', c, l]); return q; };
      q.order = (c, opt) => { q.ordres.push([c, opt && opt.ascending === false ? 'desc' : 'asc']); return q; };
      q.range = (a, b) => { q.plage = [a, b]; return q; };
      q.update = () => { q.op = 'update'; return q; }; q.delete = () => { q.op = 'delete'; return q; }; q.upsert = () => { q.op = 'upsert'; return q; };
      q.then = (ok_, ko_) => Promise.resolve().then(() => executer(q)).then(ok_, ko_);
      return q;
    },
  };
  class DateFausse extends Date { constructor(...a) { if (a.length) super(...a); else super(MAINTENANT); } static now() { return MAINTENANT; } }
  const stockage = {};
  const capacitor = o.capacitor === undefined ? undefined : o.capacitor({ appels, o });
  const sandbox = {
    document: { getElementById, createElement: (b) => creer(null, b), body: pageBody, addEventListener() {}, removeEventListener() {} },
    localStorage: { getItem: (k) => (k in stockage ? stockage[k] : null), setItem: (k, v) => { stockage[k] = String(v); }, removeItem: (k) => { delete stockage[k]; } },
    window: {}, navigator: {}, setTimeout: (f, ms) => { appels.minuteries.push({ f, ms }); return appels.minuteries.length; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, Date: DateFausse, console, btoa,
    fetch: async () => { throw new Error('le PDF ne doit faire aucune requête réseau'); }, setStatus() {}, hideLoading() {}, showErr() {},
    Blob: class { constructor(parts, opts) { this.parts = parts; this.type = opts && opts.type; this.taille = parts.reduce((s, p) => s + p.length, 0); appels.blobs.push(this); } },
    URL: { createObjectURL: (b) => { appels.urls.push(['creer', b]); return 'blob:essai-' + appels.urls.length; }, revokeObjectURL: (u) => appels.urls.push(['liberer', u]) },
    __db: fauxDb, __toasts: appels.toasts, __confirmations: [], __reponse: { oui: true },
  };
  if (capacitor !== undefined && capacitor !== null) sandbox.Capacitor = capacitor;
  const ctx = vm.createContext(sandbox);
  const fichiers = ['js/config.js', 'js/utilitaires.js', 'js/hors-reseau.js', 'js/routes.js', 'js/admin.js', 'js/admin-suivi.js', ...(o.sansPdf ? [] : ['js/pdf-simple.js', 'js/suivi-pdf.js'])];
  for (const f of fichiers) vm.runInContext(lire(f), ctx, { filename: f });
  // le vrai « pluginNatif » de tracking.js (l'application le trouve là)
  const tracking = lire('js/tracking.js');
  const fonction = tracking.match(/function pluginNatif\(nom\)\{[\s\S]*?\n\}/);
  if (!fonction) throw new Error('pluginNatif est introuvable dans tracking.js');
  vm.runInContext(fonction[0], ctx);
  vm.runInContext(`db = __db; stops = ${J(o.arrets ?? STOPS())}; routes = ${J(ROUTES())}; currentUser = ${J(JOE)}; _adminOnglet = 'suivi';
    toast = (m) => { __toasts.push(m); }; confirmer = async (...a) => { __confirmations.push(a); return __reponse.oui; };`, ctx);
  const corps = () => el('admin-body');
  return { ctx, el, appels, corps, clics, body: pageBody, run: (c) => vm.runInContext(c, ctx), ouvrir: () => vm.runInContext('suiviOuvrir()', ctx),
    actions: () => parClasse(corps(), 'su-actions')[0]?.children ?? [],
    boutonPdf: () => (parClasse(corps(), 'su-actions')[0]?.children ?? []).find((b) => /PDF/.test(b.textContent)),
    puce: (nom) => parClasse(corps(), 'su-puces')[0].children.find((b) => b.textContent === nom),
    filtre: (nom) => parClasse(corps(), 'su-filtres')[0].children.find((b) => b.textContent === nom),
    champ: (id) => tous(corps()).find((x) => x.id === id),
    lignes: () => parClasse(corps(), 'su-ligne'),
    dernierToast: () => appels.toasts.at(-1) };
}
// Un faux Capacitor : les deux plugins qui marchent (ou pas). retour : {uri, ecrire (rejet), partager (rejet), attente (promesse pour le partage)}
const capacitorNormal = (opts = {}) => ({ appels }) => ({
  Plugins: {
    Filesystem: { writeFile: async (a) => { appels.writeFile.push(a); if (opts.erreurEcriture) throw new Error(opts.erreurEcriture); return opts.sansUri ? {} : { uri: 'file:///data/user/0/com.entretienlapointe.tracker/cache/' + a.path }; } },
    Share: { share: async (a) => { appels.share.push({ ...a, apresEcriture: appels.writeFile.length }); if (opts.attente) await opts.attente; if (opts.erreurPartage) throw (opts.rejetTexte ? opts.erreurPartage : new Error(opts.erreurPartage)); return { activityType: 'x' }; } },
  },
  isPluginAvailable: (n) => !(opts.absents || []).includes(n), isNativePlatform: () => opts.natif !== false,
});
const pdfDeLEcriture = (m) => lirePdf(new Uint8Array(Buffer.from(m.appels.writeFile.at(-1).data, 'base64')));

log('\n=== LE BOUTON « 📄 EXPORTER EN PDF » DANS L\'ÉCRAN ===');
{
  const m = monde({ capacitor: capacitorNormal() });
  await m.ouvrir();
  eq('les 3 boutons du bas : « ＋ Une date pour plusieurs clients », « 📄 Exporter en PDF », « ↻ Actualiser » (dans cet ordre)', m.actions().map((b) => b.textContent), ['＋ Une date pour plusieurs clients', '📄 Exporter en PDF', '↻ Actualiser']);
  eq('le bouton est un vrai bouton (type « button », classe « lf-btn »)', [m.boutonPdf().tagName, m.boutonPdf().type, m.boutonPdf().className], ['BUTTON', 'button', 'lf-btn']);
  const sans = monde({ sansPdf: true });
  await sans.ouvrir();
  eq('sans le fichier suivi-pdf.js (une vieille version) : pas de bouton, l\'écran marche quand même', [sans.actions().map((b) => b.textContent), sans.lignes().length], [['＋ Une date pour plusieurs clients', '↻ Actualiser'], 5]);
  const html = lire('index.html');
  const scripts = [...html.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map((x) => x[1]);
  eq('la page charge pdf-simple.js puis suivi-pdf.js, chacun UNE fois, juste après admin-suivi.js et avant demarrage.js', [scripts.filter((s) => s === 'pdf-simple.js').length, scripts.filter((s) => s === 'suivi-pdf.js').length, scripts.indexOf('pdf-simple.js') === scripts.indexOf('admin-suivi.js') + 1, scripts.indexOf('suivi-pdf.js') === scripts.indexOf('pdf-simple.js') + 1, scripts.indexOf('suivi-pdf.js') < scripts.indexOf('demarrage.js')], [1, 1, true, true, true]);
  eq('« pluginNatif » (tracking.js) est chargé avant qu\'on puisse toucher le bouton (tracking.js avant demarrage.js)', scripts.indexOf('tracking.js') < scripts.indexOf('demarrage.js'), true);
}

log('\n=== L\'EXPORT SUR LE TÉLÉPHONE : ÉCRIRE LE FICHIER, PUIS OUVRIR LE PARTAGE ===');
{
  const m = monde({ capacitor: capacitorNormal() });
  await m.ouvrir();
  const avant = m.appels.requetes.length;
  await cliquer(m.boutonPdf());
  eq('le plugin « Filesystem » écrit UN fichier : nom sans accents, dans le dossier temporaire (CACHE), en base64', [m.appels.writeFile.length, m.appels.writeFile[0].path, m.appels.writeFile[0].directory, typeof m.appels.writeFile[0].data, Object.keys(m.appels.writeFile[0]).sort()],
    [1, 'Suivi-des-passages_Coupe-de-gazon_2026-09-29.pdf', 'CACHE', 'string', ['data', 'directory', 'path']]);
  eq('… puis le plugin « Share » est appelé UNE fois, APRÈS l\'écriture, avec le chemin rendu par l\'écriture', [m.appels.share.length, m.appels.share[0].apresEcriture, m.appels.share[0].url], [1, 1, 'file:///data/user/0/com.entretienlapointe.tracker/cache/Suivi-des-passages_Coupe-de-gazon_2026-09-29.pdf']);
  eq('… titre, texte et titre de la fenêtre de partage', [m.appels.share[0].title, m.appels.share[0].text, m.appels.share[0].dialogTitle], ['Suivi des passages - Coupe de gazon', 'Suivi des passages - Coupe de gazon', 'Envoyer ou imprimer le suivi']);
  eq('aucun message (la feuille de partage d\'Android parle d\'elle-même) et le bouton n\'a rien téléchargé', [m.appels.toasts, m.clics.length], [[], 0]);
  eq('le PDF ne lit ni n\'écrit RIEN dans la base et ne fait aucune requête réseau (il utilise ce qui est déjà à l\'écran)', m.appels.requetes.length - avant, 0);
  const pdf = pdfDeLEcriture(m);
  eq('le fichier écrit est un PDF bien formé (relu par le lecteur strict), de 1 page', [pdf.erreurs, pdf.pages.length], [[], 1]);
  const tab = tableau(pdf, true);
  eq('LE PDF MONTRE L\'ÉCRAN : les 3 sections (Louiseville, Yamachiche, Sans route) avec leurs clients dans l\'ordre de la route', tab.sections.map((s) => [s.nom, s.nbClients, s.lignes.map((l) => l.client.join(' '))]),
    [['LOUISEVILLE', '2 clients', ['Famille Tremblay : 10 rue des Pins, Louiseville', '8 av. du Parc, Louiseville']], ['YAMACHICHE', '2 clients', ['Client C : 55 chemin du Lac, Yamachiche', 'Client E : 2 rue Été, Ville']], ['SANS ROUTE', '1 client', ['Client D : 1 rue Sansroute, Ville']]]);
  eq('… les dates (les « Complété » des deux copies + les dates à la main), du plus ancien au plus récent, avec le nombre de passages', tab.sections.flatMap((s) => s.lignes.map((l) => [l.dates.join(' '), l.total])),
    [['20 avr., 12 mai, 26 mai, 9 juin, 23 juin, 7 juil.', 6], ['22 sept.', 1], ['12 sept.', 1], ['27 sept.', 1], ['', 0]]);
  eq('… l\'état de chaque client (le rythme du gazon est de 14 jours) : en retard, à jour, à faire, à jour, aucun passage', tab.sections.flatMap((s) => s.lignes.map((l) => l.etat.join(' '))), ['En retard · 84 j', 'À jour · 7 j', 'À faire · 17 j', 'À jour · 2 j', 'Aucun passage']);
  const t = pdf.pages[0].textes;
  eq('le titre, la saison (2026) et le service, et la date d\'impression du jour', [t[1].texte, t[2].texte], ['Entretien Lapointe - Saison 2026 - Coupe de gazon', 'Passages depuis le 1er janvier 2026 · 5 clients · 9 passages · Imprimé le 29 septembre 2026']);
  await cliquer(m.boutonPdf());
  eq('un 2e export (une fois le 1er terminé) marche aussi : il écrit et partage de nouveau', [m.appels.writeFile.length, m.appels.share.length], [2, 2]);
}

log('\n=== LE PDF SUIT LE FILTRE, LA RECHERCHE ET LE SERVICE DE L\'ÉCRAN ===');
{
  const m = monde({ capacitor: capacitorNormal() });
  await m.ouvrir();
  await cliquer(m.filtre('À faire'));
  await cliquer(m.boutonPdf());
  let pdf = pdfDeLEcriture(m);
  let tab = tableau(pdf, true);
  eq('filtre « À faire » : seuls les clients à faire, en retard ou sans passage (3), et la 1re page le dit', [tab.sections.map((s) => s.lignes.map((l) => l.client.join(' '))), pdf.pages[0].textes.find((x) => /^Liste :/.test(x.texte))?.texte, pdf.pages[0].textes[2].texte.includes('· 3 clients ·')],
    [[['Famille Tremblay : 10 rue des Pins, Louiseville'], ['Client C : 55 chemin du Lac, Yamachiche'], ['Client D : 1 rue Sansroute, Ville']], 'Liste : clients à faire (sans passage, à faire ou en retard : rythme de 14 jours)', true]);
  eq('… la numérotation de chaque section repart de 1 dans la liste filtrée', tab.sections.map((s) => s.lignes.map((l) => l.numero)), [[1], [1], [1]]);
  await cliquer(m.filtre('Aucun passage'));
  await cliquer(m.boutonPdf());
  pdf = pdfDeLEcriture(m);
  tab = tableau(pdf, true);
  eq('filtre « Aucun passage » : un seul client', [aplat(tab), pdf.pages[0].textes.find((x) => /^Liste :/.test(x.texte))?.texte], [[['SANS ROUTE', 1, 'Client D : 1 rue Sansroute, Ville']], 'Liste : clients sans passage']);
  await cliquer(m.filtre('Tous'));
  const rech = m.champ('su-recherche');
  rech.value = 'pins tremblay';
  rech.oninput();
  await cliquer(m.boutonPdf());
  pdf = pdfDeLEcriture(m);
  tab = tableau(pdf, true);
  eq('recherche « pins tremblay » : un client, et la 1re page dit la recherche', [aplat(tab), pdf.pages[0].textes.find((x) => /^Liste :/.test(x.texte))?.texte], [[['LOUISEVILLE', 1, 'Famille Tremblay : 10 rue des Pins, Louiseville']], 'Liste : recherche « pins tremblay »']);
  rech.value = 'introuvable';
  rech.oninput();
  const avant = m.appels.writeFile.length;
  await cliquer(m.boutonPdf());
  eq('une recherche qui ne trouve personne : « Rien à exporter », aucun fichier, aucun partage', [m.dernierToast(), m.appels.writeFile.length - avant, m.appels.share.length], ['Rien à exporter : aucun client dans la liste.', 0, 3]);   // (les 3 exports d'avant : « À faire », « Aucun passage », la recherche « pins tremblay »)
  rech.value = '';
  rech.oninput();
  await cliquer(m.puce('Épandage de sel'));
  await cliquer(m.boutonPdf());
  pdf = pdfDeLEcriture(m);
  tab = tableau(pdf, false);
  eq('un autre service (Épandage de sel : sans rythme) : SON client, SES dates, sans colonne « État », nom de fichier propre', [tab.entetes[0], aplat(tab), tab.sections[0].lignes[0].dates.join(' '), m.appels.writeFile.at(-1).path, pdf.pages[0].textes[1].texte],
    [['#', 'Client : Adresse', 'Dates des passages', 'Passages'], [['LOUISEVILLE', 1, 'Famille Tremblay : 10 rue des Pins, Louiseville']], '15 janv.', 'Suivi-des-passages_Epandage-de-sel_2026-09-29.pdf', 'Entretien Lapointe - Saison 2026 - Épandage de sel']);
}

log('\n=== LES ÉCHECS : LE PARTAGE ANNULÉ, LES PLUGINS ABSENTS OU EN PANNE, LE DOUBLE TOUCHER ===');
{
  const cas = async (opts, avant) => { const m = monde({ capacitor: capacitorNormal(opts) }); await m.ouvrir(); if (avant) avant(m); await cliquer(m.boutonPdf()); return m; };
  let m = await cas({ erreurPartage: 'Share canceled' });
  eq('la feuille de partage fermée sans rien choisir (« Share canceled ») : aucun message d\'erreur', m.appels.toasts, []);
  await cliquer(m.boutonPdf());
  eq('… et le bouton marche de nouveau ensuite', [m.appels.writeFile.length, m.appels.share.length], [2, 2]);
  m = await cas({ erreurPartage: 'Abort' });
  eq('un autre mot de l\'annulation (Abort, avec une majuscule) : aussi silencieux', m.appels.toasts, []);
  m = await cas({ erreurPartage: 'Dismissed' });
  eq('… « Dismissed » aussi', m.appels.toasts, []);
  m = await cas({ erreurPartage: 'Share canceled', rejetTexte: true });
  eq('… et quand le refus est un simple TEXTE (pas un objet d\'erreur) : aussi', m.appels.toasts, []);
  m = await cas({ erreurPartage: 'Boum', rejetTexte: true });
  eq('… un refus en texte qui n\'est pas une annulation : le message d\'erreur', m.appels.toasts, ['❌ Le PDF n’a pas pu être envoyé à l’application de partage du téléphone.']);
  m = await cas({ erreurPartage: 'Something exploded' });
  eq('une vraie erreur du partage : un message clair', m.appels.toasts, ['❌ Le PDF n’a pas pu être envoyé à l’application de partage du téléphone.']);
  await cliquer(m.boutonPdf());
  eq('… le bouton n\'est pas bloqué après une erreur', m.appels.writeFile.length, 2);
  m = await cas({ erreurEcriture: 'ENOSPC: plus de place' });
  eq('l\'écriture du fichier échoue (téléphone plein…) : un message, et la feuille de partage n\'est pas ouverte', [m.appels.toasts, m.appels.share.length], [['❌ Le PDF n’a pas pu être envoyé à l’application de partage du téléphone.'], 0]);
  m = await cas({ sansUri: true });
  eq('l\'écriture réussit mais ne rend pas le chemin du fichier : un message, pas de partage', [m.appels.toasts, m.appels.share.length], [['❌ Le PDF n’a pas pu être envoyé à l’application de partage du téléphone.'], 0]);
  m = await cas({ absents: ['Share'] });
  eq('téléphone SANS le plugin « Share » (une vieille version de l\'application) : un message, aucun téléchargement inutile, rien d\'écrit', [m.appels.toasts, m.clics.length, m.appels.writeFile.length], [['❌ Le PDF n’a pas pu être envoyé à l’application de partage du téléphone.'], 0, 0]);
  m = await cas({ absents: ['Filesystem'] });
  eq('… ou SANS le plugin « Filesystem » : de même', [m.appels.toasts, m.clics.length, m.appels.share.length], [['❌ Le PDF n’a pas pu être envoyé à l’application de partage du téléphone.'], 0, 0]);
  // le double toucher pendant que la feuille de partage est ouverte
  let liberer = null;
  const attente = new Promise((res) => { liberer = res; });
  const n = monde({ capacitor: capacitorNormal({ attente }) });
  await n.ouvrir();
  const p1 = n.boutonPdf().onclick();
  await new Promise((r) => setImmediate(r));
  const p2 = n.boutonPdf().onclick();
  await p2;
  eq('un 2e toucher pendant que la feuille de partage est ouverte ne fait RIEN (un seul fichier, un seul partage)', [n.appels.writeFile.length, n.appels.share.length], [1, 1]);
  liberer();
  await p1;
  await cliquer(n.boutonPdf());
  eq('… la feuille fermée, le bouton marche de nouveau', [n.appels.writeFile.length, n.appels.share.length], [2, 2]);
  // un PDF qui plante à la fabrication : message, rien d'envoyé
  const k = monde({ capacitor: capacitorNormal() });
  await k.ouvrir();
  k.run('suiviPdfConstruire = () => { throw new Error("boum"); }');
  await cliquer(k.boutonPdf());
  eq('la fabrication du PDF plante : « n\'a pas pu être préparé », rien n\'est écrit ni partagé, le bouton reste utilisable', [k.appels.toasts, k.appels.writeFile.length, k.appels.share.length], [['❌ Le PDF n’a pas pu être préparé.'], 0, 0]);
  k.run('delete suiviPdfConstruire; ');
  const v = monde({ capacitor: capacitorNormal() });
  await v.ouvrir();
  v.run('suiviDonnees = null');
  await v.run('suiviExporterPdf()');
  eq('l\'écran n\'a rien lu (pas de données) : « Rien à exporter. », rien d\'écrit', [v.appels.toasts, v.appels.writeFile.length], [['Rien à exporter.'], 0]);
}

log('\n=== UNE SAISON SUR DEUX ANNÉES : LA DATE DE DÉPART D\'UNE AUTRE ANNÉE ===');
{
  const m = monde({ capacitor: capacitorNormal(), manuels: [{ id: 'm1', stop_id: 's1', jour: '2025-12-15', note: null }, { id: 'm2', stop_id: 's1', jour: '2026-03-02', note: null }] });
  await m.ouvrir();
  const dep = m.champ('su-depuis');
  dep.value = '2025-12-01';
  await dep.onchange();
  await cliquer(m.boutonPdf());
  const pdf = pdfDeLEcriture(m);
  const tab = tableau(pdf, true);
  eq('« Depuis le 1er décembre 2025 » : la saison s\'écrit « Saison 2025-2026 », la date de départ est écrite en entier', [pdf.pages[0].textes[1].texte, pdf.pages[0].textes[2].texte], ['Entretien Lapointe - Saison 2025-2026 - Coupe de gazon', 'Passages depuis le 1er décembre 2025 · 5 clients · 9 passages · Imprimé le 29 septembre 2026']);
  eq('… une date d\'une autre année porte son année (« 15 déc. 2025 »), les autres non', tab.sections[0].lignes[0].dates.join(' '), '15 déc. 2025, 2 mars, 20 avr., 12 mai, 26 mai, 9 juin, 23 juin');
  const d = new Date(MAINTENANT);
  const p2 = (n) => String(n).padStart(2, '0');
  eq('la date de création écrite dans le fichier est celle du moment de l\'export (heure du téléphone)', pdf.info.date, '' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds()));
  eq('… le titre et l\'auteur du fichier', [pdf.info.titre, pdf.info.auteur], ['Suivi des passages - Coupe de gazon', 'Entretien Lapointe']);
}

log('\n=== DANS UN NAVIGATEUR (ESSAIS SUR ORDINATEUR) : LE FICHIER SE TÉLÉCHARGE ===');
{
  const m = monde({});
  await m.ouvrir();
  await cliquer(m.boutonPdf());
  eq('un fichier PDF (type « application/pdf ») est créé, un lien de téléchargement porte son nom, il est cliqué, puis retiré de la page', [m.appels.blobs.length, m.appels.blobs[0].type, m.clics, m.body.children.length],
    [1, 'application/pdf', [{ balise: 'A', href: 'blob:essai-1', download: 'Suivi-des-passages_Coupe-de-gazon_2026-09-29.pdf', dansLeDocument: true }], 0]);
  eq('… le message « ✔ PDF téléchargé » ; l\'adresse temporaire du fichier est libérée plus tard (une minuterie de 60 secondes)', [m.appels.toasts, m.appels.urls.map((u) => u[0]), m.appels.minuteries.map((x) => x.ms)], [['✔ PDF téléchargé'], ['creer'], [60000]]);
  m.appels.minuteries[0].f();
  eq('… quand la minuterie sonne, c\'est CETTE adresse qui est libérée', m.appels.urls.map((u) => u[0] + ' ' + (u[1] && u[1].type ? '' : u[1] || '')).map((s) => s.trim()), ['creer', 'liberer blob:essai-1']);
  const octets = m.appels.blobs[0].parts[0];
  eq('le contenu du fichier téléchargé est le PDF (bien formé)', [lirePdf(octets).erreurs, lirePdf(octets).pages.length], [[], 1]);
  const natif = monde({ capacitor: () => ({ Plugins: {}, isPluginAvailable: () => false, isNativePlatform: () => true }) });
  await natif.ouvrir();
  await cliquer(natif.boutonPdf());
  eq('sur le téléphone (plateforme native) SANS les plugins : pas de faux téléchargement : un message d\'erreur', [natif.appels.toasts, natif.appels.blobs.length, natif.clics.length], [['❌ Le PDF n’a pas pu être envoyé à l’application de partage du téléphone.'], 0, 0]);
  const web = monde({ capacitor: () => ({ Plugins: {}, isPluginAvailable: () => false, isNativePlatform: () => false }) });
  await web.ouvrir();
  await cliquer(web.boutonPdf());
  eq('un « Capacitor » de navigateur (isNativePlatform faux, sans plugins) : le téléchargement', [web.appels.toasts, web.clics.length], [['✔ PDF téléchargé'], 1]);
}

log('\n=== HORS RÉSEAU : LE PDF SE FAIT QUAND MÊME (RIEN N\'EST LU NI ÉCRIT SUR INTERNET) ===');
{
  const m = monde({ capacitor: capacitorNormal() });
  await m.ouvrir();
  m.run('reseau.enLigne = false');
  await cliquer(m.boutonPdf());
  eq('sans réseau : l\'écran déjà lu suffit, le fichier est écrit et partagé', [m.appels.writeFile.length, m.appels.share.length, m.appels.toasts], [1, 1, []]);
}

log('\n=== LA SÛRETÉ DU CODE ===');
{
  const src = lire('js/suivi-pdf.js');
  const pdfSrc = lire('js/pdf-simple.js');
  const nu = (s) => s.replace(/\/\/.*$/gm, '');
  vrai('suivi-pdf.js n\'écrit rien dans la base et ne lit rien du réseau (ni db., ni fetch, ni XMLHttpRequest, ni rpc, ni innerHTML)', !/\bdb\b|fetch\(|XMLHttpRequest|\.rpc\(|innerHTML|\.from\(/.test(nu(src)), (nu(src).match(/\bdb\b|fetch\(|XMLHttpRequest|\.rpc\(|innerHTML|\.from\(/) || [])[0]);
  vrai('ni eval, ni Function, ni document.write, ni onclick écrit en texte (ni dans pdf-simple.js)', !/eval\(|new Function|document\.write|onclick\s*=\s*["']|insertAdjacentHTML/.test(nu(src) + nu(pdfSrc)));
  vrai('pdf-simple.js ne touche ni à la page, ni au réseau, ni au stockage (du pur calcul : pas de document, window, localStorage, fetch)', !/\bdocument\b|\bwindow\b|localStorage|fetch\(|Capacitor/.test(nu(pdfSrc)));
  eq('les seuls plugins nommés : Filesystem et Share (lus par « pluginNatif »)', [...new Set([...src.matchAll(/pluginNatif\('([A-Za-z]+)'\)/g)].map((x) => x[1]))].sort(), ['Filesystem', 'Share']);
  vrai('le fichier est écrit dans le dossier TEMPORAIRE (CACHE), jamais dans les documents de la personne', /directory:'CACHE'/.test(src) && !/DOCUMENTS|EXTERNAL|Directory\.Data/.test(src));
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
