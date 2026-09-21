// Étape 17 — outil des ERREURS VOLONTAIRES des fichiers SQL 20 et 21 (ne fait PAS partie de « npm test »).
//   node mutations-etape-17/erreurs-volontaires-sql.mjs            (toutes les mutations, ≈ 10 s chacune)
//   ONLY=3,40 node mutations-etape-17/erreurs-volontaires-sql.mjs  (seulement celles-là)
// Chaque mutation abîme UNE règle dans une COPIE (dossier temporaire) du fichier 20 ou 21 ; test-etape-17.mjs (variables SQL20_TEST /
// SQL21_TEST) doit alors ÉCHOUER. Les vrais fichiers ne sont JAMAIS touchés (l'outil le vérifie à la fin).
// Le fichier 21 REMPLACE la fonction quart_terminer_equipier du fichier 20 : les mutations de cette fonction visent donc le fichier 21.
// (Les mutations du code de l'application : node erreurs-volontaires.mjs test-app-gestes-sans-reseau.mjs mutations-etape-17/mutations-app-js.json ;
//  le CSS : … test-app-zones-sures.mjs mutations-etape-17/mutations-app-css.json.)
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const TESTS = fileURLToPath(new URL('../', import.meta.url));   // le dossier supabase/tests/
const FICHIERS = {
  20: fileURLToPath(new URL('../../20-etape17-fin-de-quart-equipage.sql', import.meta.url)),
  21: fileURLToPath(new URL('../../21-etape17-fin-de-quart-equipe-passe-terminee.sql', import.meta.url)),
};
const SOURCES = { 20: fs.readFileSync(FICHIERS[20], 'utf8'), 21: fs.readFileSync(FICHIERS[21], 'utf8') };
const TMP = path.join(os.tmpdir(), 'sql-etape-17-mutation.sql');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;

// [fichier, nom, texte exact (UNE fois dans ce fichier), texte abîmé]
const M = [
  // ── Fichier 20 : « Je termine » sans numéro, « ce n'est pas exact », réglages, droits, valeurs permises ──
  [20, '« Je termine » sans numéro ignore l\'heure du geste (un vieux geste fermerait le nouveau quart)',
    `where q.utilisateur_id = v_uid and q.debut <= v_moment and (q.fin is null or q.fin >= v_moment)`, `where q.utilisateur_id = v_uid and q.fin is null`],
  [20, 'sans numéro et sans quart : erreur au lieu de « pas en quart »',
    `return jsonb_build_object('statut', 'pas_en_quart');   -- rien à terminer (déjà fermé automatiquement, par exemple) : pas une erreur`, `raise exception 'quart_introuvable';`],
  [20, 'sans numéro : un quart déjà terminé est re-terminé (renvoi non inoffensif)',
    `      return jsonb_build_object('statut', 'deja_termine', 'quart_id', v_q.id, 'fin', v_q.fin);   -- geste renvoyé\n    end if;\n  end if;\n\n  if v_moment <= v_q.debut then`,
    `      null;\n    end if;\n  end if;\n\n  if v_moment <= v_q.debut then`],
  [20, 'sans numéro : l\'heure du geste n\'est plus vérifiée (plus de 3 jours accepté)',
    `    v_moment := public._moment_valide(p_moment);\n    select * into v_q from public.quarts q`, `    v_moment := coalesce(p_moment, now());\n    select * into v_q from public.quarts q`],
  [20, '« Je termine » ne ferme plus la passe du chauffeur',
    `select p.id into v_passe from public.passes p where p.chauffeur_id = v_uid and p.statut = 'en_cours';`, `v_passe := null;`],
  [20, '« Je termine » : fin égale au début acceptée (viole la règle du serveur)',
    `if v_moment <= v_q.debut then`, `if false then`],
  [20, '« pas exact » : un collègue peut contester le quart d\'un autre',
    `select * into v_q from public.quarts where id = p_quart_id and utilisateur_id = v_uid;\n  if not found then\n    raise exception 'quart_introuvable';\n  end if;\n  if v_q.fin is null or`,
    `select * into v_q from public.quarts where id = p_quart_id;\n  if not found then\n    raise exception 'quart_introuvable';\n  end if;\n  if v_q.fin is null or`],
  [20, '« pas exact » : un quart terminé par la personne elle-même se conteste',
    `if v_q.fin is null or v_q.fin_source is distinct from 'equipage' then`, `if v_q.fin is null then`],
  [20, '« pas exact » : un quart déjà validé par l\'administrateur se rouvre',
    `if v_q.valide_le is not null then`, `if false then`],
  [20, '« pas exact » : un renvoi n\'est plus reconnu',
    `if v_q.a_valider and v_q.raison_a_valider = 'fin_contestee' then`, `if false then`],
  [20, '« pas exact » : la raison « fin_contestee » n\'est pas notée',
    `raison_a_valider = 'fin_contestee',`, `raison_a_valider = raison_a_valider,`],
  [20, 'réglage : rappel à 8 h au lieu de 12 h', `('rappel_en_service_heures', '12',`, `('rappel_en_service_heures', '8',`],
  [20, 'réglage : pause suggérée à 5 h au lieu de 4 h', `('suggestion_pause_heures',  '4',`, `('suggestion_pause_heures',  '5',`],
  [20, 'réglage : une valeur changée par l\'administrateur est remise à zéro à chaque exécution',
    `on conflict (cle) do nothing;`, `on conflict (cle) do update set valeur = excluded.valeur;`],
  [20, 'droits : un visiteur peut signaler une erreur',
    `revoke all on function public.quart_signaler_erreur(uuid, text) from public, anon;\n`, ``],
  [20, 'règle : l\'origine « equipage » n\'est plus permise',
    `check (fin_source in ('manuel', 'fin_passe', 'delai_max', 'admin', 'equipage'));`, `check (fin_source in ('manuel', 'fin_passe', 'delai_max', 'admin'));`],
  [20, 'règle : la raison « fin_contestee » n\'est plus permise',
    `check (raison_a_valider in ('ouvert_par_equipage', 'ouvert_par_passe', 'fin_estimee', 'fin_contestee'));`, `check (raison_a_valider in ('ouvert_par_equipage', 'ouvert_par_passe', 'fin_estimee'));`],
  [20, 'règle : n\'importe quelle origine de fin est permise',
    `check (fin_source in ('manuel', 'fin_passe', 'delai_max', 'admin', 'equipage'));`, `check (true);`],
  // ── Fichier 21 : quart_terminer_equipier (la version qui reste en service) ──
  [21, 'équipier : n\'importe qui peut terminer le quart d\'un collègue (plus de contrôle du chauffeur)', `if v_passe.chauffeur_id <> v_uid then`, `if false then`],
  [21, 'équipier : le chauffeur peut l\'appliquer à lui-même', `if p_utilisateur_id is null or p_utilisateur_id = v_uid then`, `if p_utilisateur_id is null then`],
  [21, 'équipier : l\'heure du geste n\'est plus vérifiée', `  v_moment := public._moment_valide(p_moment);\n\n  -- (a) À bord de MA passe`, `  v_moment := coalesce(p_moment, now());\n\n  -- (a) À bord de MA passe`],
  [21, 'équipier : tolérance de 10 minutes portée à 10 heures', `(e.fin is null or e.fin >= v_moment - interval '10 minutes')`, `(e.fin is null or e.fin >= v_moment - interval '10 hours')`],
  [21, 'équipier : « était à bord à cette heure-là » ne vérifie plus l\'heure d\'arrivée', `     and e.debut <= v_moment\n`, ``],
  [21, 'équipier : le refus « pas à bord » devient une réponse polie', `return jsonb_build_object('statut', 'refuse', 'raison', 'pas_a_bord');`, `return jsonb_build_object('statut', 'pas_en_quart');`],
  [21, 'équipier : le quart se termine à l\'heure de la réponse et non à l\'heure de la descente', `v_fin := least(v_moment, coalesce(v_per.fin, v_moment));`, `v_fin := v_moment;`],
  [21, 'équipier : le quart déjà terminé est cherché parmi les quarts ouverts seulement',
    `where q.utilisateur_id = p_utilisateur_id and q.debut <= v_fin and (q.fin is null or q.fin >= v_fin)`, `where q.utilisateur_id = p_utilisateur_id and q.fin is null`],
  [21, 'équipier : sans quart, erreur au lieu de « pas en quart »', `    return jsonb_build_object('statut', 'pas_en_quart');\n  end if;`, `    raise exception 'quart_introuvable';\n  end if;`],
  [21, 'équipier : un quart déjà terminé est écrasé',
    `return jsonb_build_object('statut', 'deja_termine', 'quart_id', v_q.id, 'fin', v_q.fin);   -- geste renvoyé, ou terminé par la personne`, `null;`],
  [21, 'équipier : il termine le quart même si la personne est à bord d\'un autre camion',
    `where e.utilisateur_id = p_utilisateur_id and e.passe_id <> p_passe_id and e.fin is null`, `where e.utilisateur_id = p_utilisateur_id and e.passe_id <> p_passe_id and e.fin is null and false`],
  [21, 'équipier : la fin à la seconde du début n\'est plus reculée', `if v_fin <= v_q.debut then`, `if false then`],
  [21, 'équipier : la trace « qui l\'a fait » n\'est pas gardée', `set fin = v_fin, fin_source = 'equipage', fin_par = v_uid,`, `set fin = v_fin, fin_source = 'equipage',`],
  [21, 'équipier : l\'origine est « manuel » au lieu de « equipage »', `set fin = v_fin, fin_source = 'equipage', fin_par = v_uid,`, `set fin = v_fin, fin_source = 'manuel', fin_par = v_uid,`],
  [21, 'équipier : la personne ne sort pas du camion', `perform public._fermer_periodes_ouvertes(p_utilisateur_id, v_fin, v_uid);`, `null;`],
  [21, 'équipier (a) : tout le monde est « à bord » (plus aucun refus)', `  v_ok := found;\n  if v_ok then\n    v_fin := least(`, `  v_ok := true;\n  if v_ok then\n    v_fin := least(`],
  // ── Fichier 21 : la passe déjà fermée ──
  [21, 'passe fermée : le cas (b) n\'existe plus', `if v_passe.fin is not null and v_moment >= v_passe.fin and v_moment <= v_passe.fin + (v_heures * interval '1 hour') then`, `if false then`],
  [21, 'passe fermée : plus de limite de temps (des jours plus tard, ça marche encore)', `and v_moment <= v_passe.fin + (v_heures * interval '1 hour') then`, `then`],
  [21, 'passe fermée : limite par défaut de 30 h au lieu de 3 h', `v_heures := coalesce(v_heures, 3);`, `v_heures := coalesce(v_heures, 30);`],
  [21, 'passe fermée : le réglage de l\'administrateur est ignoré', `select (r.valeur #>> '{}')::numeric into v_heures from public.reglages r where r.cle = 'fin_equipe_apres_passe_heures';`, `v_heures := null;`],
  [21, 'passe fermée : une personne descendue AVANT la fin de la passe est acceptée', `         and e.debut <= v_passe.fin and (e.fin is null or e.fin >= v_passe.fin)\n`, `         and e.debut <= v_passe.fin\n`],
  [21, 'passe fermée : le quart se termine à l\'heure de la fin de la passe, pas à l\'heure du geste', `      v_ok := found;\n      if v_ok then\n        v_fin := v_moment;`, `      v_ok := found;\n      if v_ok then\n        v_fin := v_passe.fin;`],
  [21, 'passe fermée : n\'importe qui est accepté', `      v_ok := found;\n      if v_ok then\n        v_fin := v_moment;`, `      v_ok := true;\n      if v_ok then\n        v_fin := v_moment;`],
  [21, 'réglage : 5 h au lieu de 3 h', `('fin_equipe_apres_passe_heures', '3',`, `('fin_equipe_apres_passe_heures', '5',`],
  [21, 'réglage : une valeur changée par l\'administrateur est remise à zéro à chaque exécution', `on conflict (cle) do nothing;`, `on conflict (cle) do update set valeur = excluded.valeur;`],
  // (« droits : un visiteur peut terminer le quart d'un passager » n'est PAS essayée pour le fichier 21 : create or replace garde les droits posés par le fichier 20 ; mutation équivalente)
  [21, 'le fichier 21 ne vérifie plus que le fichier 20 a été exécuté', `is null then\n    raise exception 'la fonction quart_terminer_equipier (fichier 20)`, `is not null and false then\n    raise exception 'la fonction quart_terminer_equipier (fichier 20)`],
];

let detectees = 0, essayees = 0; const rapport = [];
try {
  for (const [i, [f, nom, de, vers]] of M.entries()) {
    if (ONLY && !ONLY.includes(i + 1)) continue;
    essayees++;
    const src = SOURCES[f];
    const n = src.split(de).length - 1;
    if (n !== 1) { rapport.push(`?? ${i + 1}. [${f}] TEXTE ${n === 0 ? 'INTROUVABLE' : 'EN ' + n + ' EXEMPLAIRES'} : ${nom}`); console.log(rapport[rapport.length - 1]); continue; }
    if (src.replace(de, () => vers) === src) { rapport.push(`?? ${i + 1}. [${f}] MUTATION SANS EFFET : ${nom}`); console.log(rapport[rapport.length - 1]); continue; }
    fs.writeFileSync(TMP, src.replace(de, () => vers));
    let sortie = '';
    try { sortie = execFileSync('node', ['test-etape-17.mjs'], { cwd: TESTS, env: { ...process.env, ['SQL' + f + '_TEST']: TMP }, encoding: 'utf8', timeout: 240000, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { sortie = String(e.stdout || '') + String(e.stderr || ''); }
    const m = sortie.match(/RÉSULTAT : (\d+) réussis, (\d+) échoués/);
    const ko = m ? Number(m[2]) : -1;
    const vu = ko !== 0;
    if (vu) detectees++;
    rapport.push(`${vu ? 'OK  détectée' : 'RATÉE      '} ${i + 1}. [${f}] ${nom}${m ? ' (' + ko + ' échec(s))' : ' (plantage)'}`);
    console.log(rapport[rapport.length - 1]);
  }
} finally {
  fs.rmSync(TMP, { force: true });
}
console.log(`\n${detectees} erreurs volontaires détectées sur ${essayees}`);
const intacts = [20, 21].every((f) => fs.readFileSync(FICHIERS[f], 'utf8') === SOURCES[f]);
console.log(intacts ? 'Les vrais fichiers SQL 20 et 21 sont intacts.' : '⚠ UN VRAI FICHIER A CHANGÉ !');
