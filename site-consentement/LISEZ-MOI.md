# Pages du site pour les avis de passage par texto (demande 5)

Ces fichiers s'ajoutent au site **entretienlapointe.ca** (hébergé chez WHC). Ils reprennent le thème du site, mais **sans aucun suivi** (ni Pixel Meta, ni balise Google) : on y saisit un numéro de cellulaire.

| Fichier ici | Où le mettre sur WHC (cPanel > Gestionnaire de fichiers > `public_html`) | Adresse finale |
|---|---|---|
| `avis.html` | `public_html/avis.html` | https://www.entretienlapointe.ca/avis.html |
| `confidentialite.html` | `public_html/confidentialite.html` | https://www.entretienlapointe.ca/confidentialite.html |
| `css/avis.css` | `public_html/css/avis.css` | |
| `js/avis.js` | `public_html/js/avis.js` | |

## Ordre à respecter

1. Le **fichier SQL 30** (`supabase/30-repertoire-clients-et-inscriptions.sql`) doit être exécuté chez Supabase **avant** de mettre la page en ligne : la page appelle la fonction `inscrire_avis` que ce fichier crée.
2. Ensuite seulement, mettre les 4 fichiers ci-dessus sur le site.
3. Essayer une vraie inscription (avec son propre numéro, et avec la 2ᵉ case cochée une fois), puis vérifier qu'elle apparaît dans la table `inscriptions_avis` (`promo_accepte`) et dans le registre `consentements` (une ligne `texto` et, si la 2ᵉ case était cochée, une ligne `courriel_promo`).

## Les textes de consentement (deux cases, deux textes)

- **Case 1 (obligatoire pour s'inscrire) : les textos d'avis de passage.** Le texte affiché à côté de la case de `avis.html` est **identique, mot pour mot,** à celui de la version `texto-2026-10-v1` du fichier SQL 30 (table `textes_consentement`).
- **Case 2 (facultative, décochée au départ) : les offres et les nouvelles PAR COURRIEL** (jamais par texto). Son texte est identique à celui de la version `promo-2026-10-v1` (canal `courriel_promo`). Si elle est cochée, le courriel devient obligatoire.

Le registre des consentements garde chaque texte comme preuve, avec la date, le courriel ou le numéro et l'empreinte de l'adresse IP.

- On ne modifie **jamais** une version. Pour changer un texte : ajouter une **nouvelle version** dans `textes_consentement` (ex. `texto-2027-v2` ou `promo-2027-v2`), changer **en même temps** le texte et la valeur cachée (`avis-version` ou `avis-version-promo`) de `avis.html`.
- `supabase/tests/test-page-avis.mjs` vérifie que la page et le fichier SQL disent la même chose.

## Essayer la page sur son poste

```
node supabase/tests/serveur-page-avis.mjs
```

puis ouvrir http://localhost:8124/ (les styles du thème sont lus dans une copie du site : variable `SITE_WEB`, sinon le dossier « site web » du Bureau).

## Tests

```
cd supabase/tests
node test-page-avis.mjs
node mutations-etape-17/erreurs-volontaires-page-avis.mjs
```

La clé écrite dans `js/avis.js` est la clé **publique** (« anon ») de Supabase, la même que celle de l'application : elle est faite pour être visible. La base limite ce qu'elle permet (seulement s'inscrire, avec des limites par adresse IP).
