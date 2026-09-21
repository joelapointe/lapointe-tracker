// Erreurs volontaires : vérifie que les tests DÉTECTENT vraiment les défauts (un test qui ne voit pas un défaut ne protège de rien).
// Ne fait PAS partie de « npm test ».
//
//   node erreurs-volontaires.mjs <fichier-de-test.mjs> <mutations.json>
//
// Pour chaque mutation : une COPIE du dossier www est faite dans le dossier temporaire, UN texte y est remplacé par un texte abîmé, le test est
// lancé sur cette copie (variable d'environnement WWW_TEST) et il doit ÉCHOUER (ou planter). Le vrai dossier www n'est JAMAIS touché.
// Seuls les tests qui lisent WWW_TEST peuvent être essayés ainsi : test-app-gestes-sans-reseau.mjs et test-app-zones-sures.mjs.
//
// Format de mutations.json : [ { "nom": "ce qui est cassé, en français", "fichier": "js/quart.js", "de": "texte exact à remplacer", "vers": "texte abîmé" }, … ]
//   • « de » doit exister UNE fois dans le fichier (sinon la mutation est signalée « TEXTE INTROUVABLE » et ne compte pas) ;
//   • « RATÉE » = le test n'a rien vu : il manque un scénario (l'ajouter, puis relancer) ; « OK détectée » = le test a échoué (ou planté).
// Les mutations du SQL se font autrement : le fichier .sql est remplacé un instant PAR une version abîmée puis TOUJOURS remis (try/finally),
// et test-etape-16d.mjs est lancé (voir le cahier, étape 16d).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const ICI = fileURLToPath(new URL('.', import.meta.url));
const REEL = fileURLToPath(new URL('../../www/', import.meta.url));
const COPIE = process.env.COPIE_ERREURS || path.join(os.tmpdir(), 'www-erreurs-volontaires');   // (COPIE_ERREURS : un autre dossier, pour lancer plusieurs séries EN PARALLÈLE)
const TEST = process.argv[2];
const FICHIER_MUTATIONS = process.argv[3];
if (!TEST || !FICHIER_MUTATIONS) { console.log('Usage : node erreurs-volontaires.mjs <fichier-de-test.mjs> <mutations.json>'); process.exit(2); }
const MUTATIONS = JSON.parse(fs.readFileSync(FICHIER_MUTATIONS, 'utf8'));

let detectees = 0;
const rapport = [];
try {
  for (const [i, mu] of MUTATIONS.entries()) {
    fs.rmSync(COPIE, { recursive: true, force: true });
    fs.cpSync(REEL, COPIE, { recursive: true });
    const f = path.join(COPIE, mu.fichier);
    const src = fs.readFileSync(f, 'utf8');
    if (!src.includes(mu.de)) { rapport.push(`?? ${i + 1}. TEXTE INTROUVABLE : ${mu.nom}`); continue; }
    fs.writeFileSync(f, src.replace(mu.de, mu.vers));
    let sortie = '';
    try { sortie = execFileSync('node', [TEST], { cwd: ICI, env: { ...process.env, WWW_TEST: COPIE }, encoding: 'utf8', timeout: 240000, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { sortie = String(e.stdout || '') + String(e.stderr || ''); }
    const m = sortie.match(/RÉSULTAT : (\d+) réussis, (\d+) échoués/);
    const ko = m ? Number(m[2]) : -1;
    const vu = ko !== 0;   // -1 : le test a planté = détecté aussi
    if (vu) detectees++;
    rapport.push(`${vu ? 'OK  détectée ' : 'RATÉE       '} ${i + 1}. ${mu.nom}${m ? ' (' + ko + ' échec(s))' : ' (plantage)'}`);
  }
} finally {
  fs.rmSync(COPIE, { recursive: true, force: true });
}
console.log(rapport.join('\n'));
console.log(`\n${detectees} erreurs volontaires détectées sur ${MUTATIONS.length}`);
