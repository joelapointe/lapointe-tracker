# Fonction « calculer-parcours » (étape 18b) — le tracé qui suit les rues

Calcule les **tronçons** du tracé : le trajet en voiture d'un client au suivant, dans l'ordre choisi, pour chaque route et chaque
type de service. **Réservée à l'administrateur** (chaque appel est vérifié avec le jeton de la personne qui appelle : la base
répond à `est_admin()`). Elle écrit dans la table `parcours_segments` (fichier SQL 22) ; les téléphones n'ont qu'à la **lire**.

Le trajet vient de **Geoapify** (données OpenStreetMap). **La clé de Geoapify est un « secret » Supabase (`GEOAPIFY_KEY`) : elle n'est
écrite nulle part dans ce fichier ni dans l'application, et n'est jamais écrite dans les journaux.**

## Ce qu'elle fait

Appel : `POST https://<projet>.supabase.co/functions/v1/calculer-parcours`, en-tête `Authorization: Bearer <jeton de Joé>`,
corps JSON **facultatif** :

| Champ | Effet |
|---|---|
| *(rien)* | tout mettre à jour : les tronçons qui manquent, pour toutes les routes |
| `route_id` | seulement cette route |
| `refaire_sans_route: true` | redemander aussi les tronçons où Geoapify n'avait trouvé « aucune route » |

Réponse : `{ ok, calcules, sans_route, echecs, restants, total_troncons, limite_atteinte }`. Au plus **40 tronçons par appel** ; s'il
en reste (`restants` > 0), l'application rappelle la fonction (jusqu'à 6 fois de suite).

- Un tronçon **déjà calculé et à jour n'est jamais redemandé** (1 crédit chez Geoapify par tronçon). Il n'est refait que si l'un des
  deux clients a changé de place.
- Deux clients à moins de 8 m l'un de l'autre : aucun appel à Geoapify.
- « Trop de demandes » (429) : une pause de 1,5 s, un seul nouvel essai, puis la fonction s'arrête (`limite_atteinte`).
- Clé refusée (401/403) : la fonction s'arrête tout de suite (erreur `cle_refusee`, avec un message qui dit quoi vérifier).
- Panne passagère de Geoapify : rien n'est écrit pour ce tronçon (`echecs`), le prochain appel réessaie.
- Les lignes sont simplifiées (3 m de tolérance) et arrondies à 5 décimales : la table reste petite.

## Mise en service (Joé, une seule fois)

**Ordre important : le SQL et la clé d'abord, la fonction ensuite.**

1. **Clé Geoapify** — compte gratuit sur https://myprojects.geoapify.com, créer un projet, copier la clé (« API Key »).
2. **Secret Supabase** — Supabase > **Edge Functions** > **Secrets** : ajouter un secret nommé exactement **`GEOAPIFY_KEY`**, avec la clé
   comme valeur.
3. **SQL** — Supabase > SQL Editor > New query : coller le contenu de `supabase/22-etape18b-parcours-segments.sql`, **Run**, puis copier
   le résultat de la dernière requête (« vérification ») et le donner à Claude.
4. **Fonction** — Supabase > **Edge Functions** > **Deploy a new function** > **Via Editor** :
   - remplacer tout le code proposé par le contenu de `supabase/functions/calculer-parcours/index.ts` ;
   - donner le nom **`calculer-parcours`** (exactement, en minuscules avec le tiret) ;
   - laisser les réglages par défaut (en particulier « Verify JWT » activé), puis **Deploy function**.
5. Dans l'application (compte administrateur) : ouvrir la liste des arrêts (toucher la case d'avancement en bas), choisir une route,
   toucher **« 🛣 Mettre à jour le tracé »**. Le message dit combien de tronçons ont été calculés.

Pour modifier la fonction plus tard : rouvrir la fonction dans le tableau de bord, remplacer le code, **Deploy** de nouveau (le fichier de
ce dépôt est la référence).

## Attribution obligatoire

Tant que le tracé est affiché, la carte montre « Itinéraires © Geoapify · Données © contributeurs OpenStreetMap » (`www/js/parcours.js`).
Elle doit rester visible.

## Tests

`supabase/tests/test-etape-18b.mjs` (`cd supabase/tests && npm test`) : la fonction avec un **faux** Geoapify et un faux accès à la base,
le fichier SQL 22 sur une vraie base locale (PGlite). Ils ne peuvent pas confirmer la vraie réponse de Geoapify ni le comportement réel
de Supabase (PostgREST, secrets) : cela se vérifie avec la vraie clé, par le bouton « Mettre à jour le tracé ».
Les erreurs volontaires : `node mutations-etape-17/erreurs-volontaires-etape-18b.mjs`.
