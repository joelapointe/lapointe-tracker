// Chantier C, fichiers SQL 31 ET 32 ensemble : les mêmes scénarios que test-avis-envois.mjs, après avoir appliqué le fichier 32 (avis_preparer à 5 paramètres, avis_apercu), plus les scénarios des canaux et de l'aperçu.
// SQL32_TEST (variable d'environnement) : une COPIE abîmée du fichier 32, pour les « erreurs volontaires » ; le vrai fichier n'est jamais touché.
process.env.AVEC_32 = '1';
await import('./test-avis-envois.mjs');
