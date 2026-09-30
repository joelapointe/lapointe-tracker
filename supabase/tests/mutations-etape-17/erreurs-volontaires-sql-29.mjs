// Demande 6 — outil des ERREURS VOLONTAIRES du fichier SQL 29 (arret_presences, arret_presence, réglage presence_complete_auto_s) (ne fait PAS partie de « npm test »).
//   node mutations-etape-17/erreurs-volontaires-sql-29.mjs               (toutes les mutations, ≈ 8 s chacune)
//   ONLY=3,7 node mutations-etape-17/erreurs-volontaires-sql-29.mjs      (seulement celles-là)
// Chaque mutation abîme UNE règle dans une COPIE (dossier temporaire) du fichier SQL 29 (variable SQL29_TEST) ; test-presence-temps.mjs doit alors ÉCHOUER (ou planter).
// Le vrai fichier n'est JAMAIS touché (l'outil le vérifie à la fin). (Le code de l'application : node erreurs-volontaires.mjs test-app-presence.mjs mutations-etape-17/mutations-app-presence.json)
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const TESTS = fileURLToPath(new URL('../', import.meta.url));   // le dossier supabase/tests/
const FICHIER = fileURLToPath(new URL('../../29-presence-et-temps-passe.sql', import.meta.url));
const SOURCE = fs.readFileSync(FICHIER, 'utf8');
const TMP = path.join(os.tmpdir(), 'sql-29-mutation.sql');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;
const AVANT_COMMIT = `commit;\n\n-- ====`;
const GARDE1 = `if to_regclass('public.passes') is null or to_regclass('public.stops') is null or to_regclass('public.utilisateurs') is null or to_regclass('public.reglages') is null then`;
const GARDE2 = `if to_regprocedure('public.est_admin()') is null or to_regprocedure('public._exiger_actif()') is null or to_regprocedure('public._moment_valide(timestamptz)') is null then`;
const GARDE3 = `if to_regprocedure('public.completer_arret(uuid, uuid, timestamptz, text, double precision, double precision)') is null then`;
const CASE_DEPART = `set depart_le = case when excluded.depart_le is null then ap.depart_le\n                         when ap.depart_le is null then excluded.depart_le\n                         else greatest(ap.depart_le, excluded.depart_le) end,`;

// [nom, texte exact (UNE fois dans le fichier), texte abîmé]
// (Ne sont PAS essayées : « begin; » et « set search_path » retirés, qui ne changent rien à ce qu'un banc d'essai peut voir ; la requête « verification » du bas, lue à la main sur la vraie base ;
//  « check (depart_le >= arrivee_le) » sans le « is null or » : une règle CHECK dont le résultat est « vide » (NULL) est ACCEPTÉE par PostgreSQL, la mutation ne change donc rien.)
const M = [
  ['le contrôle « les tables de base existent » est retiré', GARDE1, `if false then`],
  ['le contrôle « les fonctions de base existent » est retiré', GARDE2, `if false then`],
  ['le contrôle « completer_arret existe » est retiré', GARDE3, `if false then`],
  ['ré-exécuter le fichier plante (table créée sans « if not exists »)', `create table if not exists public.arret_presences (`, `create table public.arret_presences (`],
  ['une présence peut n\'avoir AUCUNE passe', `passe_id    uuid not null references public.passes(id),`, `passe_id    uuid references public.passes(id),`],
  ['une présence peut viser une passe qui n\'existe pas (plus de clé étrangère)', `passe_id    uuid not null references public.passes(id),`, `passe_id    uuid not null,`],
  ['supprimer une passe EFFACE ses présences (cascade au lieu de refuser)', `passe_id    uuid not null references public.passes(id),`, `passe_id    uuid not null references public.passes(id) on delete cascade,`],
  ['une présence peut n\'avoir AUCUN client', `stop_id     uuid not null references public.stops(id),`, `stop_id     uuid references public.stops(id),`],
  ['une présence peut viser un client qui n\'existe pas (plus de clé étrangère)', `stop_id     uuid not null references public.stops(id),`, `stop_id     uuid not null,`],
  ['supprimer un client EFFACE ses présences (cascade au lieu de refuser)', `stop_id     uuid not null references public.stops(id),`, `stop_id     uuid not null references public.stops(id) on delete cascade,`],
  ['une présence peut n\'avoir AUCUNE arrivée', `arrivee_le  timestamptz not null,`, `arrivee_le  timestamptz,`],
  ['le départ devient obligatoire (l\'arrivée seule est refusée)', `depart_le   timestamptz,`, `depart_le   timestamptz not null default now(),`],
  ['« signalé par » peut être une personne qui n\'existe pas', `signale_par uuid references public.utilisateurs(id),`, `signale_par uuid,`],
  ['l\'heure de création n\'est plus posée toute seule (une date fixe)', `cree_le     timestamptz not null default now(),`, `cree_le     timestamptz not null default '2100-01-01',`],
  ['l\'heure de mise à jour n\'est plus posée toute seule (une date fixe)', `maj_le      timestamptz not null default now(),`, `maj_le      timestamptz not null default '2000-01-01',`],
  ['la règle « une arrivée par passe et par client » ne regarde que la passe et l\'arrivée', `constraint arret_presences_une_arrivee unique (passe_id, stop_id, arrivee_le),`, `constraint arret_presences_une_arrivee unique (passe_id, arrivee_le),`],
  ['la règle « une arrivée par passe et par client » n\'existe plus', `constraint arret_presences_une_arrivee unique (passe_id, stop_id, arrivee_le),\n`, ``],
  ['la règle « le départ suit l\'arrivée » est retirée', `  constraint arret_presences_depart_apres_arrivee check (depart_le is null or depart_le >= arrivee_le),\n`, ``],
  ['la règle « le départ suit l\'arrivée » refuse un départ à la même seconde (> au lieu de ≥)', `depart_le >= arrivee_le),`, `depart_le > arrivee_le),`],
  ['la règle « 12 heures au plus » est retirée', `  constraint arret_presences_duree_plausible check (depart_le is null or depart_le - arrivee_le <= interval '12 hours')\n`, `  constraint arret_presences_duree_plausible check (true)\n`],
  ['la règle « 12 heures au plus » passe à 13 heures', `depart_le - arrivee_le <= interval '12 hours')`, `depart_le - arrivee_le <= interval '13 hours')`],
  ['la règle « 12 heures au plus » passe à 11 heures', `depart_le - arrivee_le <= interval '12 hours')`, `depart_le - arrivee_le <= interval '11 hours')`],
  ['la sécurité de la table est coupée (les règles d\'accès ne comptent plus)', `alter table public.arret_presences enable row level security;`, `alter table public.arret_presences disable row level security;`],
  ['un visiteur non connecté peut lire la table', `grant select on public.arret_presences to authenticated;`, `grant select on public.arret_presences to authenticated;\ngrant select on public.arret_presences to anon;`],
  ['un visiteur non connecté peut écrire dans la table', AVANT_COMMIT, `grant insert on public.arret_presences to anon;\ncommit;\n\n-- ====`],
  ['un employé connecté peut écrire directement dans la table (insert)', `grant select on public.arret_presences to authenticated;`, `grant select, insert on public.arret_presences to authenticated;`],
  ['un employé connecté peut modifier directement la table (update)', `grant select on public.arret_presences to authenticated;`, `grant select, update on public.arret_presences to authenticated;`],
  ['un employé connecté peut supprimer directement dans la table (delete)', `grant select on public.arret_presences to authenticated;`, `grant select, delete on public.arret_presences to authenticated;`],
  ['personne (même connecté) n\'a plus aucun droit de lecture', `grant select on public.arret_presences to authenticated;`, `select 1;`],
  ['ré-exécuter le fichier plante (la règle d\'accès n\'est pas retirée avant d\'être remise)', `drop policy if exists arret_presences_admin_lecture on public.arret_presences;\n`, ``],
  ['la règle d\'accès laisse TOUS LES EMPLOYÉS lire les présences', `using ((select public.est_admin()));\n\n-- Noter une présence`, `using ((select public.est_actif()));\n\n-- Noter une présence`],
  ['la règle d\'accès laisse lire tout le monde', `using ((select public.est_admin()));\n\n-- Noter une présence`, `using (true);\n\n-- Noter une présence`],
  ['la règle d\'accès permet aussi d\'écrire (règle « all »)', `create policy arret_presences_admin_lecture on public.arret_presences for select to authenticated`, `create policy arret_presences_admin_lecture on public.arret_presences for all to authenticated`],
  ['la fonction n\'est pas « security definer » (elle écrit avec les droits de l\'appelant)', `language plpgsql security definer set search_path = ''\nas $$\ndeclare\n  v_uid     uuid;\n  v_p       public.passes%rowtype;`, `language plpgsql set search_path = ''\nas $$\ndeclare\n  v_uid     uuid;\n  v_p       public.passes%rowtype;`],
  ['la passe qui n\'existe pas n\'est plus refusée', `  if not found then\n    raise exception 'passe_introuvable';\n  end if;`, `  if false then\n    raise exception 'passe_introuvable';\n  end if;`],
  ['n\'importe quel employé peut noter une présence (le contrôle du chauffeur est retiré)', `  if v_p.chauffeur_id <> v_uid and not public.est_admin() then\n    raise exception 'non_autorise';\n  end if;`, `  if false then\n    raise exception 'non_autorise';\n  end if;`],
  ['l\'administrateur ne peut plus noter une présence', `if v_p.chauffeur_id <> v_uid and not public.est_admin() then`, `if v_p.chauffeur_id <> v_uid then`],
  ['tout le monde est refusé sauf l\'administrateur (le chauffeur aussi)', `if v_p.chauffeur_id <> v_uid and not public.est_admin() then`, `if not public.est_admin() then`],
  ['la personne désactivée n\'est plus refusée (plus de contrôle d\'employé actif)', `  v_uid := public._exiger_actif();`, `  v_uid := (select auth.uid());`],
  ['l\'arrivée absente n\'est plus refusée', `  if p_arrivee is null then\n    raise exception 'arrivee_requise';\n  end if;`, `  if false then\n    raise exception 'arrivee_requise';\n  end if;`],
  ['l\'arrêt d\'une autre route n\'est plus refusé', `s.id = p_stop_id and s.route_id = v_p.route_id) then`, `s.id = p_stop_id) then`],
  ['l\'arrêt d\'une autre tâche n\'est plus refusé', `  if not exists (select 1 from public.stops s where s.id = p_stop_id and s.service = v_p.tache) then\n    raise exception 'arret_hors_tache';\n  end if;`, `  if false then\n    raise exception 'arret_hors_tache';\n  end if;`],
  ['l\'heure d\'arrivée n\'est plus vérifiée (le futur et les vieux gestes passent)', `v_arrivee := public._moment_valide(p_arrivee);`, `v_arrivee := p_arrivee;`],
  ['l\'heure de départ n\'est plus vérifiée (le futur passe)', `v_depart  := case when p_depart is null then null else public._moment_valide(p_depart) end;`, `v_depart  := p_depart;`],
  ['le départ absent est remplacé par maintenant', `v_depart  := case when p_depart is null then null else public._moment_valide(p_depart) end;`, `v_depart  := public._moment_valide(p_depart);`],
  ['une arrivée d\'avant la passe n\'est plus refusée', `  if v_arrivee < v_p.debut - interval '10 minutes' then\n    raise exception 'presence_avant_passe';\n  end if;`, `  if false then\n    raise exception 'presence_avant_passe';\n  end if;`],
  ['la marge avant la passe passe de 10 minutes à 0', `v_p.debut - interval '10 minutes'`, `v_p.debut - interval '0 minutes'`],
  ['la marge avant la passe passe de 10 minutes à 3 heures', `v_p.debut - interval '10 minutes'`, `v_p.debut - interval '3 hours'`],
  ['un départ avant l\'arrivée n\'est plus refusé par la fonction', `  if v_depart is not null and v_depart < v_arrivee then\n    raise exception 'presence_incoherente';\n  end if;`, `  if false then\n    raise exception 'presence_incoherente';\n  end if;`],
  ['un départ à la même seconde que l\'arrivée est refusé (≤ au lieu de <)', `v_depart < v_arrivee then`, `v_depart <= v_arrivee then`],
  ['la visite de plus de 12 heures n\'est plus refusée par la fonction', `  if v_depart is not null and v_depart - v_arrivee > interval '12 hours' then\n    raise exception 'presence_trop_longue';\n  end if;`, `  if false then\n    raise exception 'presence_trop_longue';\n  end if;`],
  ['la fonction refuse déjà à 11 heures', `v_depart - v_arrivee > interval '12 hours' then`, `v_depart - v_arrivee > interval '11 hours' then`],
  ['la fonction refuse déjà 12 heures pile (≥ au lieu de >)', `v_depart - v_arrivee > interval '12 hours' then`, `v_depart - v_arrivee >= interval '12 hours' then`],
  ['la fonction accepte jusqu\'à 13 heures (la table refuse alors avec un autre message)', `v_depart - v_arrivee > interval '12 hours' then`, `v_depart - v_arrivee > interval '13 hours' then`],
  ['un renvoi de la même arrivée ne fait plus rien (le départ n\'est jamais ajouté)', `  on conflict (passe_id, stop_id, arrivee_le) do update\n    set ${''}`.replace('${}', ''), `  on conflict (passe_id, stop_id, arrivee_le) do nothing\n    -- `],
  ['un renvoi de la même arrivée avec le départ vide EFFACE le départ', CASE_DEPART, `set depart_le = excluded.depart_le,`],
  ['un départ plus tôt renvoyé plus tard FAIT RECULER le départ (le plus petit gagne)', CASE_DEPART, `set depart_le = case when excluded.depart_le is null then ap.depart_le\n                         when ap.depart_le is null then excluded.depart_le\n                         else least(ap.depart_le, excluded.depart_le) end,`],
  ['un départ renvoyé écrase toujours l\'ancien (le dernier gagne, même plus tôt)', CASE_DEPART, `set depart_le = coalesce(excluded.depart_le, ap.depart_le),`],
  ['« maj_le » n\'est plus mise à jour par un renvoi', `        maj_le = now()\n  returning`, `        maj_le = ap.maj_le\n  returning`],
  ['« signalé par » n\'est plus celui qui appelle', `values (p_passe_id, p_stop_id, v_arrivee, v_depart, v_uid)`, `values (p_passe_id, p_stop_id, v_arrivee, v_depart, null)`],
  ['la présence est notée avec l\'heure de l\'appel au lieu de celle de l\'arrivée', `values (p_passe_id, p_stop_id, v_arrivee, v_depart, v_uid)`, `values (p_passe_id, p_stop_id, now(), v_depart, v_uid)`],
  ['la réponse ne dit plus « enregistree »', `jsonb_build_object('statut', 'enregistree', 'presence_id', v_id)`, `jsonb_build_object('statut', 'ok', 'presence_id', v_id)`],
  ['la réponse ne donne plus le numéro de la présence', `jsonb_build_object('statut', 'enregistree', 'presence_id', v_id)`, `jsonb_build_object('statut', 'enregistree')`],
  ['un visiteur peut appeler la fonction (le droit n\'est plus retiré)', `revoke all on function public.arret_presence(uuid, uuid, timestamptz, timestamptz) from public, anon;`, `select 1;`],
  ['un employé connecté ne peut plus appeler la fonction', `grant execute on function public.arret_presence(uuid, uuid, timestamptz, timestamptz) to authenticated;`, `select 1;`],
  ['le réglage du complété automatique passe à 30 secondes', `to_jsonb(60)`, `to_jsonb(30)`],
  ['le réglage du complété automatique passe à 0 (coupé)', `to_jsonb(60)`, `to_jsonb(0)`],
  ['le réglage n\'est pas ajouté', `insert into public.reglages (cle, valeur, description)\nvalues ('presence_complete_auto_s'`, `select 1 where false; insert into public.reglages (cle, valeur, description)\nselect 'x', to_jsonb(1), 'x' where false union all select 'presence_complete_auto_s'`],
  ['ré-exécuter le fichier REMET le réglage à 60 (le changement de Joé est perdu)', `on conflict (cle) do nothing;`, `on conflict (cle) do update set valeur = excluded.valeur;`],
  ['ré-exécuter le fichier plante (le réglage existe déjà : plus de « on conflict »)', `on conflict (cle) do nothing;`, `;`],
  ['la description du réglage dit « minutes »', `Complété automatique : après ce nombre de SECONDES`, `Complété automatique : après ce nombre de minutes`],
  ['la description du réglage n\'explique plus « 0 = jamais »', `0 = jamais : le chauffeur touche « Complété ».`, `Le chauffeur peut toujours toucher « Complété ».`],
  ['un autre réglage est changé au passage', AVANT_COMMIT, `update public.reglages set valeur = '5'::jsonb where cle = 'duree_max_passe_heures';\ncommit;\n\n-- ====`],
  ['un autre réglage est supprimé au passage', AVANT_COMMIT, `delete from public.reglages where cle = 'duree_max_quart_heures';\ncommit;\n\n-- ====`],
  ['une règle d\'accès des réglages est retirée au passage', AVANT_COMMIT, `drop policy if exists reglages_admin on public.reglages;\ncommit;\n\n-- ====`],
  ['un employé peut modifier les réglages (règle ajoutée)', AVANT_COMMIT, `create policy employe_regle on public.reglages for update to authenticated using (true) with check (true);\ncommit;\n\n-- ====`],
  ['completer_arret est remplacée au passage (elle refuse le mode « auto »)', AVANT_COMMIT, `create or replace function public.completer_arret(p_passe_id uuid, p_stop_id uuid, p_moment timestamptz default null, p_mode text default 'manuel', p_lat double precision default null, p_lon double precision default null) returns jsonb language sql as $f$ select '{}'::jsonb $f$;\ncommit;\n\n-- ====`],
  ['un « Complété » est effacé au passage', AVANT_COMMIT, `delete from public.passe_arrets;\ncommit;\n\n-- ====`],
  ['une passe est modifiée au passage', AVANT_COMMIT, `update public.passes set statut = 'terminee';\ncommit;\n\n-- ====`],
  ['une présence est notée d\'office pour chaque passe', AVANT_COMMIT, `insert into public.arret_presences (passe_id, stop_id, arrivee_le) select p.id, s.id, p.debut from public.passes p join public.stops s on s.route_id = p.route_id;\ncommit;\n\n-- ====`],
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
    try { sortie = execFileSync('node', ['test-presence-temps.mjs'], { cwd: TESTS, env: { ...process.env, SQL29_TEST: TMP }, encoding: 'utf8', timeout: 240000, stdio: ['ignore', 'pipe', 'pipe'] }); }
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
console.log(fs.readFileSync(FICHIER, 'utf8') === SOURCE ? 'Le vrai fichier (SQL 29) est intact.' : '⚠ LE VRAI FICHIER A CHANGÉ !');
