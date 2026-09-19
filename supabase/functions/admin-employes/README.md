# Fonction « admin-employes » (étape 10)

Gère les comptes d'employés. **Réservée à l'administrateur** : chaque appel est vérifié avec le jeton de
la personne qui appelle (la base répond à `est_admin()`). Elle utilise la clé secrète du serveur, que
Supabase lui fournit automatiquement : **cette clé n'est écrite nulle part, ni dans ce fichier, ni dans l'application.**

## Ce qu'elle sait faire

Appel : `POST https://<projet>.supabase.co/functions/v1/admin-employes`, en-tête `Authorization: Bearer <jeton de Joé>`,
corps JSON avec un champ `action`.

| `action` | Champs | Résultat |
|---|---|---|
| `creer` | `nom`, `telephone`, `nip` (facultatif) | Crée l'employé. Sans `nip`, un NIP est tiré au hasard. **Le NIP est renvoyé une seule fois** : le noter pour le remettre à l'employé. |
| `desactiver` | `id` | L'employé ne voit plus rien et ne peut plus se connecter. Historique conservé. |
| `reactiver` | `id` | L'inverse (employé saisonnier qui revient). |
| `supprimer` | `id` | Supprime **seulement s'il n'a aucun historique** ; sinon le désactive (la réponse dit `resultat: "supprime"` ou `"desactive"`). |
| `reinitialiser_nip` | `id`, `nip` (facultatif) | Nouveau NIP (tiré au hasard si absent), renvoyé une seule fois. |

Règles : le NIP fait exactement 6 chiffres et refuse les NIP évidents (`000000`, `123456`, `654321`…) ;
le téléphone est accepté sous toutes ses formes (`819-123-4567`, `+1 819 123 4567`…) ; un compte administrateur ne se
modifie jamais par cette fonction ; le rôle d'un compte n'est jamais écrit ici (tout compte créé est un employé).

## Mise en service (Joé, une seule fois)

**Ordre important : d'abord le SQL, ensuite la fonction.**

1. **SQL** — Supabase > SQL Editor > New query : coller le contenu de `supabase/06-etape10-outils-admin-employes.sql`, **Run**,
   puis copier le résultat de la dernière requête (« vérification ») et le donner à Claude.
2. **Fonction** — Supabase > **Edge Functions** > **Deploy a new function** > **Via Editor** :
   - remplacer tout le code proposé par le contenu de `supabase/functions/admin-employes/index.ts` ;
   - donner le nom **`admin-employes`** (exactement, en minuscules avec le tiret) ;
   - laisser les réglages par défaut (en particulier « Verify JWT » activé), puis **Deploy function** et attendre la confirmation.
3. **Rien à configurer d'autre** : aucune clé à copier, aucun secret à ajouter.
4. Dire à Claude « déployé » : la fonction sera testée ensuite avec les vrais comptes (étape 11, après la création du compte
   administrateur de Joé — sans ce compte, la fonction répond « Réservé à l'administrateur », ce qui est normal).

Pour modifier la fonction plus tard : rouvrir la fonction dans le tableau de bord, remplacer le code, **Deploy** de nouveau
(le tableau de bord ne garde pas d'historique des versions : le fichier de ce dépôt est la référence).

## Tests

`supabase/tests/test-etape-10.mjs` (`cd supabase/tests && npm test`). Ils utilisent la vraie base simulée (PGlite) et un
**faux** Supabase Auth. Ils ne peuvent donc pas confirmer le comportement réel de Supabase Auth (par exemple le refus d'un
courriel en double, le blocage de connexion, la suppression d'un compte) : cela se vérifie à l'étape 11.
