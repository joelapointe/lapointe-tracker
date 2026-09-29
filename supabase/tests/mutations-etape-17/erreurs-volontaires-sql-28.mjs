// Demande 4 — outil des ERREURS VOLONTAIRES du fichier SQL 28 (passages_manuels + types_service.frequence_jours) (ne fait PAS partie de « npm test »).
//   node mutations-etape-17/erreurs-volontaires-sql-28.mjs               (toutes les mutations, ≈ 5 s chacune)
//   ONLY=3,7 node mutations-etape-17/erreurs-volontaires-sql-28.mjs      (seulement celles-là)
// Chaque mutation abîme UNE règle dans une COPIE (dossier temporaire) du fichier SQL 28 (variable SQL28_TEST) ; test-suivi-passages.mjs doit alors ÉCHOUER (ou planter).
// Le vrai fichier n'est JAMAIS touché (l'outil le vérifie à la fin). (Le code de l'application : node erreurs-volontaires.mjs test-app-suivi-passages.mjs mutations-etape-17/mutations-app-suivi-passages.json)
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const TESTS = fileURLToPath(new URL('../', import.meta.url));   // le dossier supabase/tests/
const FICHIER = fileURLToPath(new URL('../../28-suivi-des-passages.sql', import.meta.url));
const SOURCE = fs.readFileSync(FICHIER, 'utf8');
const TMP = path.join(os.tmpdir(), 'sql-28-mutation.sql');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;
const AVANT_COMMIT = `commit;\n\n-- ====`;
const POLITIQUE = `using ((select public.est_admin())) with check ((select public.est_admin()));`;

// [nom, texte exact (UNE fois dans le fichier), texte abîmé]
// (Deux mutations ont été RETIRÉES parce qu'elles ne changent rien : un CHECK laisse toujours passer NULL, donc « between 1 and 365 » sans « is null or » accepte le vide aussi ; et « for all to public »
//  ne donne aucune ligne à un visiteur : la règle exige est_admin() ET le visiteur n'a de toute façon aucun droit sur la table.)
const M = [
  ['le contrôle « le fichier 23 a été exécuté » est retiré', `if to_regclass('public.types_service') is null then`, `if false then`],
  ['le rythme devient un texte au lieu d\'un nombre', `add column if not exists frequence_jours smallint;`, `add column if not exists frequence_jours text;`],
  ['le rythme devient un grand nombre entier (integer)', `add column if not exists frequence_jours smallint;`, `add column if not exists frequence_jours integer;`],
  ['ré-exécuter le fichier plante (colonne du rythme ajoutée sans « if not exists »)', `add column if not exists frequence_jours smallint;`, `add column frequence_jours smallint;`],
  ['le rythme devient obligatoire (avec 7 jours d\'office)', `add column if not exists frequence_jours smallint;`, `add column if not exists frequence_jours smallint not null default 7;`],
  ['le rythme reçoit 7 jours d\'office pour tous les types', `add column if not exists frequence_jours smallint;`, `add column if not exists frequence_jours smallint default 7;`],
  ['ré-exécuter le fichier plante (la règle du rythme n\'est pas retirée avant d\'être remise)', `alter table public.types_service drop constraint if exists types_service_frequence_plage;\n`, ``],
  ['la règle du rythme accepte 0 jour', `frequence_jours between 1 and 365);`, `frequence_jours between 0 and 365);`],
  ['la règle du rythme accepte 1000 jours', `frequence_jours between 1 and 365);`, `frequence_jours between 1 and 1000);`],
  ['la règle du rythme accepte 366 jours', `frequence_jours between 1 and 365);`, `frequence_jours between 1 and 366);`],
  ['la règle du rythme refuse 1 jour', `frequence_jours between 1 and 365);`, `frequence_jours between 2 and 365);`],
  ['la règle du rythme refuse 365 jours', `frequence_jours between 1 and 365);`, `frequence_jours between 1 and 364);`],
  ['la règle du rythme n\'existe plus', `alter table public.types_service add constraint types_service_frequence_plage\n  check (frequence_jours is null or frequence_jours between 1 and 365);`, `select 1;`],
  ['ré-exécuter le fichier plante (table créée sans « if not exists »)', `create table if not exists public.passages_manuels (`, `create table public.passages_manuels (`],
  ['un passage peut n\'avoir AUCUN client (stop_id vide permis)', `stop_id    uuid not null references public.stops(id),`, `stop_id    uuid references public.stops(id),`],
  ['un passage peut viser un client qui n\'existe pas (plus de clé étrangère)', `stop_id    uuid not null references public.stops(id),`, `stop_id    uuid not null,`],
  ['supprimer un client EFFACE ses dates à la main (cascade au lieu de refuser)', `stop_id    uuid not null references public.stops(id),`, `stop_id    uuid not null references public.stops(id) on delete cascade,`],
  ['un passage peut n\'avoir AUCUN jour', `jour       date not null,`, `jour       date,`],
  ['la note est limitée à 10 caractères par le type', `note       text,`, `note       varchar(10),`],
  ['« ajouté par » n\'est plus posé tout seul', `ajoute_par uuid default auth.uid() references public.utilisateurs(id),`, `ajoute_par uuid references public.utilisateurs(id),`],
  ['« ajouté par » peut être une personne qui n\'existe pas', `ajoute_par uuid default auth.uid() references public.utilisateurs(id),`, `ajoute_par uuid default auth.uid(),`],
  ['l\'heure de l\'ajout n\'est plus posée toute seule (une date fixe)', `ajoute_le  timestamptz not null default now(),`, `ajoute_le  timestamptz not null default '2000-01-01',`],
  ['plusieurs passages le même jour pour un client (la règle ne regarde que le jour)', `unique (stop_id, jour),`, `unique (jour),`],
  ['un seul passage par client et par jour devient un seul par client, jour ET note', `unique (stop_id, jour),`, `unique (stop_id, jour, note),`],
  ['la règle « un seul passage par jour » n\'existe plus', `constraint passages_manuels_un_par_jour unique (stop_id, jour),\n`, ``],
  ['les jours d\'avant 2000 sont acceptés', `date '2000-01-01' and`, `date '1900-01-01' and`],
  ['les jours d\'après 2100 sont acceptés', `and date '2100-12-31'`, `and date '2200-12-31'`],
  ['les jours de 2000 sont refusés (borne trop haute)', `date '2000-01-01' and`, `date '2001-01-01' and`],
  ['la note peut faire 2000 caractères', `char_length(note) <= 200)`, `char_length(note) <= 2000)`],
  ['la note est limitée à 20 caractères', `char_length(note) <= 200)`, `char_length(note) <= 20)`],
  ['la sécurité de la table est coupée (les règles d\'accès ne comptent plus)', `alter table public.passages_manuels enable row level security;`, `alter table public.passages_manuels disable row level security;`],
  ['un visiteur non connecté peut lire la table', AVANT_COMMIT, `grant select on public.passages_manuels to anon;\ncommit;\n\n-- ====`],
  ['un visiteur non connecté peut écrire dans la table', AVANT_COMMIT, `grant insert on public.passages_manuels to anon;\ncommit;\n\n-- ====`],
  ['personne (même connecté) n\'a plus aucun droit sur la table', `grant select, insert, update, delete on public.passages_manuels to authenticated;`, `select 1;`],
  ['l\'administrateur ne peut plus qu\'ajouter et lire (pas modifier ni supprimer)', `grant select, insert, update, delete on public.passages_manuels to authenticated;`, `grant select, insert on public.passages_manuels to authenticated;`],
  ['ré-exécuter le fichier plante (la règle d\'accès n\'est pas retirée avant d\'être remise)', `drop policy if exists passages_manuels_admin on public.passages_manuels;\n`, ``],
  ['la règle d\'accès laisse TOUT LE MONDE lire et écrire', POLITIQUE, `using (true) with check (true);`],
  ['la règle d\'accès laisse tout le monde ÉCRIRE (with check ouvert)', POLITIQUE, `using ((select public.est_admin())) with check (true);`],
  ['la règle d\'accès laisse tout le monde LIRE (using ouvert)', POLITIQUE, `using (true) with check ((select public.est_admin()));`],
  ['la règle d\'accès ne couvre plus que la lecture (l\'administrateur ne peut plus écrire)', `for all to authenticated`, `for select to authenticated`],
  ['les dates à la main sont remplies au départ (une par client)', AVANT_COMMIT, `insert into public.passages_manuels(stop_id, jour) select id, date '2026-01-01' from public.stops;\ncommit;\n\n-- ====`],
  ['un rythme est choisi d\'office pour tous les types', AVANT_COMMIT, `update public.types_service set frequence_jours = 7;\ncommit;\n\n-- ====`],
  ['un type de départ est effacé', AVANT_COMMIT, `delete from public.types_service where nom = 'Autre';\ncommit;\n\n-- ====`],
  ['un type est désactivé', AVANT_COMMIT, `update public.types_service set actif = false where nom = 'Coupe de gazon';\ncommit;\n\n-- ====`],
  ['la règle d\'accès des types de service pour l\'administrateur est retirée', AVANT_COMMIT, `drop policy types_service_admin on public.types_service;\ncommit;\n\n-- ====`],
  ['la sécurité des types de service est coupée', AVANT_COMMIT, `alter table public.types_service disable row level security;\ncommit;\n\n-- ====`],
  ['un employé peut modifier les dates à la main (règle ajoutée)', AVANT_COMMIT, `create policy employe_ecrit on public.passages_manuels for all to authenticated using (true) with check (true);\ncommit;\n\n-- ====`],
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
    try { sortie = execFileSync('node', ['test-suivi-passages.mjs'], { cwd: TESTS, env: { ...process.env, SQL28_TEST: TMP }, encoding: 'utf8', timeout: 240000, stdio: ['ignore', 'pipe', 'pipe'] }); }
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
console.log(fs.readFileSync(FICHIER, 'utf8') === SOURCE ? 'Le vrai fichier (SQL 28) est intact.' : '⚠ LE VRAI FICHIER A CHANGÉ !');
