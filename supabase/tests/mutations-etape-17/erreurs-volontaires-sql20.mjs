// Étape 17 — outil des ERREURS VOLONTAIRES du SQL 20 (ne fait PAS partie de « npm test »). Lancement : node mutations-etape-17/erreurs-volontaires-sql20.mjs
// (les mutations du code de l'application : node erreurs-volontaires.mjs test-app-gestes-sans-reseau.mjs mutations-etape-17/mutations-app-js.json ; le CSS : … test-app-zones-sures.mjs mutations-etape-17/mutations-app-css.json)
// Erreurs volontaires pour le fichier SQL 20 : chaque mutation abîme UNE règle dans une COPIE (dossier temporaire) ;
// test-etape-17.mjs (variable SQL20_TEST) doit alors ÉCHOUER. Le vrai fichier n'est JAMAIS touché.
// ONLY="3,5" : ne lancer que ces mutations.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const TESTS = fileURLToPath(new URL('../', import.meta.url));   // le dossier supabase/tests/
const REEL = fileURLToPath(new URL('../../20-etape17-fin-de-quart-equipage.sql', import.meta.url));
const SRC = fs.readFileSync(REEL, 'utf8');
const TMP = path.join(os.tmpdir(), 'sql20-mutation.sql');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;

const M = [
  ['« Je termine » sans numéro ignore l\'heure du geste (un vieux geste fermerait le nouveau quart)',
    `where q.utilisateur_id = v_uid and q.debut <= v_moment and (q.fin is null or q.fin >= v_moment)`, `where q.utilisateur_id = v_uid and q.fin is null`],
  ['sans numéro et sans quart : erreur au lieu de « pas en quart »',
    `return jsonb_build_object('statut', 'pas_en_quart');   -- rien à terminer (déjà fermé automatiquement, par exemple) : pas une erreur`, `raise exception 'quart_introuvable';`],
  ['sans numéro : un quart déjà terminé est re-terminé (renvoi non inoffensif)',
    `      return jsonb_build_object('statut', 'deja_termine', 'quart_id', v_q.id, 'fin', v_q.fin);   -- geste renvoyé\n    end if;\n  end if;\n\n  if v_moment <= v_q.debut then`,
    `      null;\n    end if;\n  end if;\n\n  if v_moment <= v_q.debut then`],
  ['sans numéro : l\'heure du geste n\'est plus vérifiée (plus de 3 jours accepté)',
    `    v_moment := public._moment_valide(p_moment);\n    select * into v_q from public.quarts q`, `    v_moment := coalesce(p_moment, now());\n    select * into v_q from public.quarts q`],
  ['« Je termine » ne ferme plus la passe du chauffeur',
    `select p.id into v_passe from public.passes p where p.chauffeur_id = v_uid and p.statut = 'en_cours';`, `v_passe := null;`],
  ['« Je termine » : fin égale au début acceptée (viole la règle du serveur)',
    `if v_moment <= v_q.debut then`, `if false then`],
  ['équipier : n\'importe qui peut terminer le quart d\'un collègue (plus de contrôle du chauffeur)',
    `if v_passe.chauffeur_id <> v_uid then`, `if false then`],
  ['équipier : le chauffeur peut l\'appliquer à lui-même',
    `if p_utilisateur_id is null or p_utilisateur_id = v_uid then`, `if p_utilisateur_id is null then`],
  ['équipier : l\'heure du geste n\'est plus vérifiée',
    `  v_moment := public._moment_valide(p_moment);\n\n  -- À bord de MA passe`, `  v_moment := coalesce(p_moment, now());\n\n  -- À bord de MA passe`],
  ['équipier : tolérance de 10 minutes portée à 10 heures',
    `(e.fin is null or e.fin >= v_moment - interval '10 minutes')`, `(e.fin is null or e.fin >= v_moment - interval '10 hours')`],
  ['équipier : « était à bord à cette heure-là » ne vérifie plus l\'heure d\'arrivée',
    `     and e.debut <= v_moment\n`, ``],
  ['équipier : le refus « pas à bord » devient une réponse polie',
    `return jsonb_build_object('statut', 'refuse', 'raison', 'pas_a_bord');`, `return jsonb_build_object('statut', 'pas_en_quart');`],
  ['équipier : le quart se termine à l\'heure de la réponse et non à l\'heure de la descente',
    `v_fin := least(v_moment, coalesce(v_per.fin, v_moment));`, `v_fin := v_moment;`],
  ['équipier : le quart déjà terminé est cherché parmi les quarts ouverts seulement',
    `where q.utilisateur_id = p_utilisateur_id and q.debut <= v_fin and (q.fin is null or q.fin >= v_fin)`, `where q.utilisateur_id = p_utilisateur_id and q.fin is null`],
  ['équipier : sans quart, erreur au lieu de « pas en quart »',
    `    return jsonb_build_object('statut', 'pas_en_quart');\n  end if;`, `    raise exception 'quart_introuvable';\n  end if;`],
  ['équipier : un quart déjà terminé est écrasé',
    `return jsonb_build_object('statut', 'deja_termine', 'quart_id', v_q.id, 'fin', v_q.fin);   -- geste renvoyé, ou terminé par la personne`, `null;`],
  ['équipier : il termine le quart même si la personne est à bord d\'un autre camion',
    `where e.utilisateur_id = p_utilisateur_id and e.passe_id <> p_passe_id and e.fin is null`, `where e.utilisateur_id = p_utilisateur_id and e.passe_id <> p_passe_id and e.fin is null and false`],
  ['équipier : la fin à la seconde du début n\'est plus reculée',
    `if v_fin <= v_q.debut then`, `if false then`],
  ['équipier : la trace « qui l\'a fait » n\'est pas gardée',
    `set fin = v_fin, fin_source = 'equipage', fin_par = v_uid,`, `set fin = v_fin, fin_source = 'equipage',`],
  ['équipier : l\'origine est « manuel » au lieu de « equipage »',
    `set fin = v_fin, fin_source = 'equipage', fin_par = v_uid,`, `set fin = v_fin, fin_source = 'manuel', fin_par = v_uid,`],
  ['équipier : la personne ne sort pas du camion',
    `perform public._fermer_periodes_ouvertes(p_utilisateur_id, v_fin, v_uid);`, `null;`],
  ['« pas exact » : un collègue peut contester le quart d\'un autre',
    `select * into v_q from public.quarts where id = p_quart_id and utilisateur_id = v_uid;\n  if not found then\n    raise exception 'quart_introuvable';\n  end if;\n  if v_q.fin is null or`,
    `select * into v_q from public.quarts where id = p_quart_id;\n  if not found then\n    raise exception 'quart_introuvable';\n  end if;\n  if v_q.fin is null or`],
  ['« pas exact » : un quart terminé par la personne elle-même se conteste',
    `if v_q.fin is null or v_q.fin_source is distinct from 'equipage' then`, `if v_q.fin is null then`],
  ['« pas exact » : un quart déjà validé par l\'administrateur se rouvre',
    `if v_q.valide_le is not null then`, `if false then`],
  ['« pas exact » : un renvoi n\'est plus reconnu',
    `if v_q.a_valider and v_q.raison_a_valider = 'fin_contestee' then`, `if false then`],
  ['« pas exact » : la raison « fin_contestee » n\'est pas notée',
    `raison_a_valider = 'fin_contestee',`, `raison_a_valider = raison_a_valider,`],
  ['réglage : rappel à 8 h au lieu de 12 h',
    `('rappel_en_service_heures', '12',`, `('rappel_en_service_heures', '8',`],
  ['réglage : pause suggérée à 5 h au lieu de 4 h',
    `('suggestion_pause_heures',  '4',`, `('suggestion_pause_heures',  '5',`],
  ['réglage : une valeur changée par l\'administrateur est remise à zéro à chaque exécution',
    `on conflict (cle) do nothing;`, `on conflict (cle) do update set valeur = excluded.valeur;`],
  ['droits : un visiteur peut terminer le quart d\'un passager',
    `revoke all on function public.quart_terminer_equipier(uuid, uuid, timestamptz, double precision, double precision, real) from public, anon;\n`, ``],
  ['droits : un visiteur peut signaler une erreur',
    `revoke all on function public.quart_signaler_erreur(uuid, text) from public, anon;\n`, ``],
  ['règle : l\'origine « equipage » n\'est plus permise',
    `check (fin_source in ('manuel', 'fin_passe', 'delai_max', 'admin', 'equipage'));`, `check (fin_source in ('manuel', 'fin_passe', 'delai_max', 'admin'));`],
  ['règle : la raison « fin_contestee » n\'est plus permise',
    `check (raison_a_valider in ('ouvert_par_equipage', 'ouvert_par_passe', 'fin_estimee', 'fin_contestee'));`, `check (raison_a_valider in ('ouvert_par_equipage', 'ouvert_par_passe', 'fin_estimee'));`],
  ['règle : n\'importe quelle origine de fin est permise',
    `check (fin_source in ('manuel', 'fin_passe', 'delai_max', 'admin', 'equipage'));`, `check (true);`]
];

let detectees = 0, essayees = 0; const rapport = [];
try {
  for (const [i, [nom, de, vers]] of M.entries()) {
    if (ONLY && !ONLY.includes(i + 1)) continue;
    essayees++;
    const n = SRC.split(de).length - 1;
    if (n !== 1) { rapport.push(`?? ${i + 1}. TEXTE ${n === 0 ? 'INTROUVABLE' : 'EN ' + n + ' EXEMPLAIRES'} : ${nom}`); console.log(rapport[rapport.length - 1]); continue; }
    if (SRC.replace(de, () => vers) === SRC) { rapport.push(`?? ${i + 1}. MUTATION SANS EFFET (texte identique) : ${nom}`); console.log(rapport[rapport.length - 1]); continue; }
    fs.writeFileSync(TMP, SRC.replace(de, () => vers));
    let sortie = '';
    try { sortie = execFileSync('node', ['test-etape-17.mjs'], { cwd: TESTS, env: { ...process.env, SQL20_TEST: TMP }, encoding: 'utf8', timeout: 240000, stdio: ['ignore', 'pipe', 'pipe'] }); }
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
const apres = fs.readFileSync(REEL, 'utf8');
console.log(apres === SRC ? 'Le vrai fichier SQL 20 est intact.' : '⚠ LE VRAI FICHIER A CHANGÉ !');
