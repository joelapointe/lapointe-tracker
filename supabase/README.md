# Dossier `supabase/` — base de données de Lapointe Tracker

Ce dossier contient tout le SQL qui a été (ou sera) exécuté dans Supabase, et les tests qui le vérifient.
Il ne contient **aucune clé ni aucun mot de passe**. Le dépôt GitHub est public : la sécurité vient des
règles d'accès de la base, pas du secret de leur contenu.

## Les fichiers SQL, dans l'ordre

Chaque fichier se colle dans **Supabase > SQL Editor > New query > Run**, **une seule fois**, dans cet ordre.
Chacun se termine par une requête « vérification » dont le résultat est à comparer à ce qui est attendu.

| Fichier | Rôle | État au 19 septembre 2026 |
|---|---|---|
| `00-inventaire-schema.sql` | Lecture seule : structure de la base | exécuté |
| `01-etape6-utilisateurs.sql` | Profils liés à Supabase Auth, fonctions `est_admin()` / `est_actif()` | exécuté et vérifié |
| `02-etape7-modele-passes-quarts.sql` | Tables : passes, arrêts complétés, quarts, équipage, journaux, réglages | exécuté et vérifié |
| `03-etape8-regles-acces.sql` | Règles d'accès par table et par rôle, retrait des droits du visiteur, temps réel | exécuté et vérifié |
| `04-etape9a-quarts-equipage.sql` | Fonctions : « Je commence / Je termine », équipage, transferts | exécuté et vérifié |
| `05-etape9b-passes-fermetures-export.sql` | Fonctions : passes, arrêts, position, fermetures automatiques, export de paie | exécuté et vérifié |

| `06-etape10-outils-admin-employes.sql` | Outils pour les fonctions d'administration des employés (détection de l'historique, droits du serveur) | exécuté et vérifié (19 septembre 2026) |
| `07-etape11-profil-sans-telephone.sql` | Corrige le déclencheur de l'étape 6 : un compte sans téléphone ni rôle admin ne reçoit plus de profil (sans ça, créer le compte de Joé dans le tableau de bord échoue) | **écrit et testé, PAS encore exécuté** |
| `08-etape11-donner-role-admin.sql` | Donne le rôle administrateur au compte de Joé (une ligne à modifier : le courriel). Refuse un 2e administrateur | **écrit et testé, PAS encore exécuté** |

Le prochain fichier sera créé à l'étape 12 ou plus tard, au besoin.

## Les Edge Functions (dossier `functions/`)

| Dossier | Rôle | État |
|---|---|---|
| `functions/admin-employes/` | Créer, désactiver, réactiver, supprimer un employé ; réinitialiser un NIP (administrateur seulement) | déployée le 19 septembre 2026 ; refuse bien un appelant non administrateur ; **jamais encore essayée par un administrateur** (étape 11). Mode d'emploi dans son README |

## Les tests (aucun contact avec ta vraie base)

Les tests exécutent les fichiers SQL sur un PostgreSQL local simulé (PGlite), avec de faux rôles
(visiteur, employé, employé désactivé, administrateur). **607 tests** au 19 septembre 2026.

```
cd supabase/tests
npm install
npm test
```

- `prepare.mjs` reproduit l'ancienne base (avant l'étape 6) puis exécute les fichiers demandés.
- `test-etapes-6-7.mjs` (76), `test-etape-8.mjs` (105), `test-etape-9a.mjs` (89), `test-etape-9b.mjs` (106), `test-etape-10.mjs` (195, fichier 06 + Edge Function avec un faux Supabase Auth), `test-etape-11.mjs` (36, fichiers 07 et 08).

**Règle de travail :** tout nouveau SQL est d'abord écrit avec ses tests, exécuté sur ce banc d'essai, et
seulement ensuite donné à Joé. Limites : la simulation n'a pas `pg_cron` ni le vrai Supabase Auth ; le
résultat de vérification collé par Joé après chaque exécution confirme le comportement sur la vraie base.

## Règles à respecter dans tout nouveau SQL

1. Toute nouvelle fonction se verrouille elle-même : `revoke all on function ... from public, anon;`
   (PostgreSQL donne le droit d'exécution à tout le monde par défaut, et rien ne peut l'empêcher globalement).
2. Toute nouvelle table est créée avec les règles d'accès actives et **sans aucun droit** (`revoke all ... from anon, authenticated`),
   puis ouverte explicitement.
3. L'employé n'écrit jamais directement dans les quarts, les passes, l'équipage ou la position : il passe par une fonction serveur.
4. La clé `service_role` ne doit jamais apparaître dans un fichier de ce dépôt.
