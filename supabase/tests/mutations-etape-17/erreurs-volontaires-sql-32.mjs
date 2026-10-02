// Demande 5, chantier C — outil des ERREURS VOLONTAIRES du fichier SQL 32 (canaux demandés, aperçu, fonction centrale avis_preparer à 5 paramètres) (ne fait PAS partie de « npm test »).
//   node mutations-etape-17/erreurs-volontaires-sql-32.mjs               (toutes les mutations)
//   ONLY=3,7 node mutations-etape-17/erreurs-volontaires-sql-32.mjs      (seulement celles-là)
// Chaque mutation abîme UNE règle dans une COPIE (dossier temporaire) du fichier SQL 32 (variable SQL32_TEST) ; test-avis-envois-32.mjs (fichiers 31 + 32) doit alors ÉCHOUER (ou planter).
// Le vrai fichier n'est JAMAIS touché (l'outil le vérifie à la fin). [nom, texte exact (UNE fois dans le fichier), texte abîmé]
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const TESTS = fileURLToPath(new URL('../', import.meta.url));
const FICHIER = fileURLToPath(new URL('../../32-avis-canaux-et-apercu.sql', import.meta.url));
const SOURCE = fs.readFileSync(FICHIER, 'utf8');
const TMP = path.join(os.tmpdir(), 'sql-32-mutation-' + (process.env.ONLY || 'tout').replace(/[^0-9]/g, '_') + '.sql');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;
const SIG5 = `(uuid, text, jsonb, timestamptz, text[])`;

const M = [
  ['le contrôle « le fichier 31 a été exécuté » est retiré', `if to_regprocedure('public.avis_preparer(uuid, text, jsonb, timestamptz)') is null and to_regprocedure('public.avis_preparer(uuid, text, jsonb, timestamptz, text[])') is null then`, `if false then`],
  ['le second contrôle (tables incomplètes) est retiré', `if to_regclass('public.avis_envois') is null or to_regclass('public.avis_modeles') is null then`, `if false then`],
  ['l\'ancienne fonction à 4 paramètres n\'est pas retirée', `drop function if exists public.avis_preparer(uuid, text, jsonb, timestamptz);`, `select 1;`],
  ['ré-exécuter le fichier plante (retrait de l\'ancienne fonction sans « if exists »)', `drop function if exists public.avis_preparer(uuid, text, jsonb, timestamptz);`, `drop function public.avis_preparer(uuid, text, jsonb, timestamptz);`],
  // — les canaux
  ['une liste de canaux absente est acceptée', `if p_canaux is null or cardinality(p_canaux) = 0 or exists (select 1 from unnest(p_canaux) c where c is null or c not in ('courriel', 'texto')) then`, `if cardinality(p_canaux) = 0 or exists (select 1 from unnest(p_canaux) c where c is null or c not in ('courriel', 'texto')) then`],
  ['une liste de canaux vide est acceptée', `if p_canaux is null or cardinality(p_canaux) = 0 or exists (select 1 from unnest(p_canaux) c where c is null or c not in ('courriel', 'texto')) then`, `if p_canaux is null or exists (select 1 from unnest(p_canaux) c where c is null or c not in ('courriel', 'texto')) then`],
  ['un canal inconnu est accepté', `if p_canaux is null or cardinality(p_canaux) = 0 or exists (select 1 from unnest(p_canaux) c where c is null or c not in ('courriel', 'texto')) then`, `if p_canaux is null or cardinality(p_canaux) = 0 or exists (select 1 from unnest(p_canaux) c where c is null) then`],
  ['un canal vide dans la liste est accepté', `where c is null or c not in ('courriel', 'texto')) then`, `where c not in ('courriel', 'texto')) then`],
  ['les canaux NON demandés sont quand même traités et écrits au journal', `      if not (v_canal = any (p_canaux)) then\n        continue;\n      end if;\n`, ``],
  ['les canaux demandés sont inversés', `      if not (v_canal = any (p_canaux)) then`, `      if v_canal = any (p_canaux) then`],
  ['sans préciser les canaux : seulement le courriel', `create or replace function public.avis_preparer(p_par uuid, p_delai text, p_lignes jsonb, p_maintenant timestamptz default now(), p_canaux text[] default array['courriel', 'texto'])`, `create or replace function public.avis_preparer(p_par uuid, p_delai text, p_lignes jsonb, p_maintenant timestamptz default now(), p_canaux text[] default array['courriel'])`],
  ['sans préciser les canaux (aperçu) : seulement le texto', `create or replace function public.avis_apercu(p_par uuid, p_delai text, p_lignes jsonb, p_maintenant timestamptz default now(), p_canaux text[] default array['courriel', 'texto'])`, `create or replace function public.avis_apercu(p_par uuid, p_delai text, p_lignes jsonb, p_maintenant timestamptz default now(), p_canaux text[] default array['texto'])`],
  // — l'aperçu
  ['l\'aperçu ÉCRIT au journal', `      if p_ecrire then\n        v_statut := case when v_motif is null then 'en_attente' else 'refuse' end;`, `      if true then\n        v_statut := case when v_motif is null then 'en_attente' else 'refuse' end;`],
  ['l\'envoi réel n\'écrit plus au journal', `      if p_ecrire then\n        v_statut := case when v_motif is null then 'en_attente' else 'refuse' end;`, `      if false then\n        v_statut := case when v_motif is null then 'en_attente' else 'refuse' end;`],
  ['l\'aperçu dit « en_attente » au lieu de « a_envoyer »', `v_statut := case when v_motif is null then 'a_envoyer' else 'refuse' end;`, `v_statut := case when v_motif is null then 'en_attente' else 'refuse' end;`],
  ['l\'aperçu ne montre plus les refus', `v_statut := case when v_motif is null then 'a_envoyer' else 'refuse' end;`, `v_statut := 'a_envoyer';`],
  ['l\'aperçu a un numéro de lot', `  v_lot      uuid := case when p_ecrire then gen_random_uuid() else null end;`, `  v_lot      uuid := gen_random_uuid();`],
  ['le lot de l\'envoi réel n\'a plus de numéro', `  v_lot      uuid := case when p_ecrire then gen_random_uuid() else null end;`, `  v_lot      uuid := null;`],
  ['la réponse ne dit plus que c\'est un aperçu', `'apercu', not p_ecrire,`, `'apercu', false,`],
  ['avis_preparer fonctionne en mode aperçu', `  select public._avis_decider(p_par, p_delai, p_lignes, p_maintenant, p_canaux, true)`, `  select public._avis_decider(p_par, p_delai, p_lignes, p_maintenant, p_canaux, false)`],
  ['avis_apercu écrit au journal', `  select public._avis_decider(p_par, p_delai, p_lignes, p_maintenant, p_canaux, false)`, `  select public._avis_decider(p_par, p_delai, p_lignes, p_maintenant, p_canaux, true)`],
  ['l\'aperçu n\'oublie pas « déjà averti » (le contrôle est retiré)', `if v_motif is null and exists (select 1 from public.avis_envois e where e.client_id = v_c.id and e.canal = v_canal and e.jour = v_jour and e.statut in ('en_attente', 'envoye')) then`, `if false then`],
  // — les droits
  ['une personne connectée peut appeler avis_preparer', `grant execute on function public.avis_preparer${SIG5}        to service_role;`, `grant execute on function public.avis_preparer${SIG5}        to service_role, authenticated;`],
  ['une personne connectée peut appeler avis_apercu', `grant execute on function public.avis_apercu${SIG5}          to service_role;`, `grant execute on function public.avis_apercu${SIG5}          to service_role, authenticated;`],
  ['un visiteur peut appeler avis_preparer (le retrait des droits est oublié)', `revoke all on function public.avis_preparer${SIG5}           from public, anon, authenticated;`, `select 1;`],
  ['un visiteur peut appeler avis_apercu (le retrait des droits est oublié)', `revoke all on function public.avis_apercu${SIG5}             from public, anon, authenticated;`, `select 1;`],
  ['un visiteur peut appeler la fonction centrale (le retrait des droits est oublié)', `revoke all on function public._avis_decider(uuid, text, jsonb, timestamptz, text[], boolean) from public, anon, authenticated;`, `select 1;`],
  ['avis_preparer n\'a plus de chemin de recherche fermé', `returns jsonb\nlanguage sql security definer set search_path = ''\nas $$\n  select public._avis_decider(p_par, p_delai, p_lignes, p_maintenant, p_canaux, true)`, `returns jsonb\nlanguage sql security definer\nas $$\n  select public._avis_decider(p_par, p_delai, p_lignes, p_maintenant, p_canaux, true)`],
  ['avis_apercu n\'a plus de chemin de recherche fermé', `returns jsonb\nlanguage sql security definer set search_path = ''\nas $$\n  select public._avis_decider(p_par, p_delai, p_lignes, p_maintenant, p_canaux, false)`, `returns jsonb\nlanguage sql security definer\nas $$\n  select public._avis_decider(p_par, p_delai, p_lignes, p_maintenant, p_canaux, false)`],
  ['la fonction centrale n\'a plus de chemin de recherche fermé', `language plpgsql security definer set search_path = ''\nas $$\ndeclare\n  v_heures   integer;`, `language plpgsql security definer\nas $$\ndeclare\n  v_heures   integer;`],
  // — les règles (la fonction centrale reprend celles du fichier 31 : le test les vérifie de nouveau)
  ['n\'importe qui peut préparer ou prévisualiser un avis', `if p_par is null or not exists (select 1 from public.utilisateurs u where u.id = p_par and u.role = 'admin' and u.actif) then`, `if false then`],
  ['un administrateur désactivé peut préparer un avis', `where u.id = p_par and u.role = 'admin' and u.actif) then`, `where u.id = p_par and u.role = 'admin') then`],
  ['le délai n\'est plus validé', `if p_delai is null or not (p_delai = 'demain' or p_delai ~ '^[1-9][0-9]?h$') then`, `if p_delai is null then`],
  ['un délai de 100 heures est accepté', `if v_heures > 72 then`, `if v_heures > 100 then`],
  ['plus de 300 lignes sont acceptées', `jsonb_array_length(p_lignes) > 300`, `jsonb_array_length(p_lignes) > 3000`],
  ['la limite du matin passe à 5 h', `v_local::time >= time '06:00'`, `v_local::time >= time '05:00'`],
  ['la limite du soir est incluse', `v_local::time < time '21:00'`, `v_local::time <= time '21:00'`],
  ['les heures ne tiennent plus compte du fuseau du Québec', `v_local := p_maintenant at time zone 'America/Toronto';`, `v_local := p_maintenant at time zone 'UTC';`],
  ['le jour n\'est plus celui du Québec', `v_jour := v_local::date;`, `v_jour := (p_maintenant at time zone 'UTC')::date;`],
  ['une fiche archivée reçoit un avis', `if not found or not v_c.actif then`, `if not found then`],
  ['un client désabonné des courriels reçoit quand même', `if v_c.desabonne_courriel_le is not null then v_motif := 'desabonne';`, `if false then v_motif := 'desabonne';`],
  ['un client désabonné des textos reçoit quand même', `if v_c.desabonne_texto_le is not null then v_motif := 'desabonne';`, `if false then v_motif := 'desabonne';`],
  ['« avertir par courriel » n\'est plus exigé', `elsif not v_c.avis_courriel then v_motif := 'pas_active';`, `elsif false then v_motif := 'pas_active';`],
  ['l\'inscription aux textos n\'est plus exigée', `elsif not v_c.avis_texto then v_motif := 'pas_active';`, `elsif false then v_motif := 'pas_active';`],
  ['les heures permises ne sont plus vérifiées pour le texto', `elsif not v_heure_ok then v_motif := 'hors_heures';`, `elsif false then v_motif := 'hors_heures';`],
  ['la course entre deux demandes plante au lieu de refuser', `        exception when unique_violation then`, `        exception when no_data_found then`],
  ['la ligne du journal porte l\'heure du serveur au lieu de celle de la demande', `v_dest, p_delai, v_service, v_adresse, v_modele.version, v_objet, v_message, v_statut, v_motif, p_maintenant)`, `v_dest, p_delai, v_service, v_adresse, v_modele.version, v_objet, v_message, v_statut, v_motif, now())`],
  ['le modèle utilisé n\'est plus le plus récent', `order by m.cree_le desc, m.version desc limit 1;`, `order by m.cree_le asc, m.version asc limit 1;`],
  ['un modèle retiré est quand même utilisé', `where m.canal = v_canal and m.variante = v_variante and m.en_vigueur order by`, `where m.canal = v_canal and m.variante = v_variante order by`],
  ['l\'absence de modèle n\'arrête plus rien', `      if not found then\n        raise exception 'modele_introuvable';\n      end if;`, ``],
  ['le courriel et le texto vont au même destinataire', `        v_dest := v_c.cellulaire;`, `        v_dest := v_c.courriel;`],
  ['« demain » utilise les textes « heures »', `    v_variante := 'demain';`, `    v_variante := 'heures';`],
  ['« 1 heure » devient « 1 heures »', `case when v_heures > 1 then 's' else '' end`, `'s'`],
  ['le service peut glisser un repère (le nettoyage est retiré)', `    v_service := public._avis_texte_propre(v_ligne ->> 'service');`, `    v_service := btrim(coalesce(v_ligne ->> 'service', ''));`],
];

let detectees = 0, essayees = 0; const rapport = [];
try {
  for (const [i, [nom, de, vers]] of M.entries()) {
    if (ONLY && !ONLY.includes(i + 1)) continue;
    essayees++;
    const n = SOURCE.split(de).length - 1;
    if (n !== 1) { rapport.push(`?? ${i + 1}. TEXTE ${n === 0 ? 'INTROUVABLE' : 'EN ' + n + ' EXEMPLAIRES'} : ${nom}`); console.log(rapport[rapport.length - 1]); continue; }
    const mut = SOURCE.replace(de, () => vers);
    if (mut === SOURCE) { rapport.push(`?? ${i + 1}. MUTATION SANS EFFET : ${nom}`); console.log(rapport[rapport.length - 1]); continue; }
    fs.writeFileSync(TMP, mut);
    let sortie = '';
    try { sortie = execFileSync('node', ['test-avis-envois-32.mjs'], { cwd: TESTS, env: { ...process.env, SQL32_TEST: TMP }, encoding: 'utf8', timeout: 240000, stdio: ['ignore', 'pipe', 'pipe'] }); }
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
console.log(fs.readFileSync(FICHIER, 'utf8') === SOURCE ? 'Le vrai fichier (SQL 32) est intact.' : '⚠ LE VRAI FICHIER A CHANGÉ !');
