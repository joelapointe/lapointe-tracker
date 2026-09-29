// Demande 2 — outil des ERREURS VOLONTAIRES du fichier SQL 27 (types_service.icone) (ne fait PAS partie de « npm test »).
//   node mutations-etape-17/erreurs-volontaires-sql-27.mjs               (toutes les mutations, ≈ 5 s chacune)
//   ONLY=3,7 node mutations-etape-17/erreurs-volontaires-sql-27.mjs      (seulement celles-là)
// Chaque mutation abîme UNE règle dans une COPIE (dossier temporaire) du fichier SQL 27 (variable SQL27_TEST) ; test-icones-taches.mjs doit alors ÉCHOUER (ou planter).
// Le vrai fichier n'est JAMAIS touché (l'outil le vérifie à la fin). (Le code de l'application : node erreurs-volontaires.mjs test-app-icones-taches.mjs mutations-etape-17/mutations-app-icones-taches.json)
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const TESTS = fileURLToPath(new URL('../', import.meta.url));   // le dossier supabase/tests/
const FICHIER = fileURLToPath(new URL('../../27-icones-des-taches.sql', import.meta.url));
const SOURCE = fs.readFileSync(FICHIER, 'utf8');
const TMP = path.join(os.tmpdir(), 'sql-27-mutation.sql');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;
const R = '\'^[a-z0-9-]{1,30}$\'';

// [nom, texte exact (UNE fois dans le fichier), texte abîmé]
const M = [
  ['le contrôle « le fichier 23 a été exécuté » est retiré', `if to_regclass('public.types_service') is null then`, `if false then`],
  ['la colonne devient obligatoire, avec une valeur d\'office (« vus »)', `add column if not exists icone text;`, `add column if not exists icone text not null default 'vus';`],
  ['la colonne reçoit une icône d\'office (« tracteur ») pour tous les types', `add column if not exists icone text;`, `add column if not exists icone text default 'tracteur';`],
  ['la colonne est un nombre au lieu d\'un texte', `add column if not exists icone text;`, `add column if not exists icone integer;`],
  ['ré-exécuter le fichier plante (colonne ajoutée sans « if not exists »)', `add column if not exists icone text;`, `add column icone text;`],
  ['ré-exécuter le fichier plante (la règle de forme n\'est pas retirée avant d\'être remise)', `alter table public.types_service drop constraint if exists types_service_icone_format;\n`, ``],
  ['la règle de forme n\'existe plus', `alter table public.types_service add constraint types_service_icone_format\n  check (icone is null or icone ~ ${R});`, `select 1;`],
  ['la règle de forme accepte les majuscules', R, `'^[a-zA-Z0-9-]{1,30}$'`],
  ['la règle de forme accepte 60 caractères', R, `'^[a-z0-9-]{1,60}$'`],
  ['la règle de forme accepte un texte vide', R, `'^[a-z0-9-]{0,30}$'`],
  ['la règle de forme refuse les tirets (« zero-turn » ne passe plus)', R, `'^[a-z0-9]{1,30}$'`],
  ['la règle de forme accepte le souligné', R, `'^[a-z0-9_-]{1,30}$'`],
  ['la règle de forme n\'a plus d\'ancres (n\'importe quel texte qui CONTIENT une clé valide passe)', R, `'[a-z0-9-]{1,30}'`],
  ['la règle de forme accepte les accents', R, `'^[a-zà-ÿ0-9-]{1,30}$'`],
  ['la sécurité de la table est coupée (les règles d\'accès ne comptent plus)', `commit;\n\n-- ====`, `alter table public.types_service disable row level security;\ncommit;\n\n-- ====`],
  ['un visiteur peut lire la table', `commit;\n\n-- ====`, `grant select on public.types_service to anon;\ncommit;\n\n-- ====`],
  ['toutes les icônes sont remplies par « tracteur »', `commit;\n\n-- ====`, `update public.types_service set icone = 'tracteur';\ncommit;\n\n-- ====`],
  ['un type de départ est effacé', `commit;\n\n-- ====`, `delete from public.types_service where nom = 'Autre';\ncommit;\n\n-- ====`],
  ['la règle d\'accès de l\'administrateur est retirée', `commit;\n\n-- ====`, `drop policy types_service_admin on public.types_service;\ncommit;\n\n-- ====`],
  ['un employé peut modifier les types (règle ajoutée)', `commit;\n\n-- ====`, `create policy employe_ecrit on public.types_service for update to authenticated using (true) with check (true);\ncommit;\n\n-- ====`],
];

let detectees = 0, essayees = 0; const rapport = [];
try {
  for (const [i, [nom, de, vers]] of M.entries()) {
    if (ONLY && !ONLY.includes(i + 1)) continue;
    essayees++;
    const n = SOURCE.split(de).length - 1;
    if (n !== 1) { rapport.push(`?? ${i + 1}. TEXTE ${n === 0 ? 'INTROUVABLE' : 'EN ' + n + ' EXEMPLAIRES'} : ${nom}`); console.log(rapport[rapport.length - 1]); continue; }
    if (SOURCE.replace(de, () => vers) === SOURCE) { rapport.push(`?? ${i + 1}. MUTATION SANS EFFET : ${nom}`); console.log(rapport[rapport.length - 1]); continue; }
    fs.writeFileSync(TMP, SOURCE.replace(de, () => vers));
    let sortie = '';
    try { sortie = execFileSync('node', ['test-icones-taches.mjs'], { cwd: TESTS, env: { ...process.env, SQL27_TEST: TMP }, encoding: 'utf8', timeout: 240000, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { sortie = String(e.stdout || '') + String(e.stderr || ''); }
    const m = sortie.match(/RÉSULTAT : (\d+) réussis, (\d+) échoués/);
    const ko = m ? Number(m[2]) : -1;
    const vu = ko !== 0;
    if (vu) detectees++;
    rapport.push(`${vu ? 'OK  détectée' : 'RATÉE      '} ${i + 1}. ${nom}${m ? ' (' + ko + ' échec(s))' : ' (plantage)'}`);
    console.log(rapport[rapport.length - 1]);
  }
} finally {
  fs.rmSync(TMP, { force: true });
}
console.log(`\n${detectees} erreurs volontaires détectées sur ${essayees}`);
console.log(fs.readFileSync(FICHIER, 'utf8') === SOURCE ? 'Le vrai fichier (SQL 27) est intact.' : '⚠ LE VRAI FICHIER A CHANGÉ !');
