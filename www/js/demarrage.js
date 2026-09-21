// js/demarrage.js — Démarrage de l'application (doit rester chargé en dernier)
// (extrait de l'ancien index.html)
setStatus('Chargement de la carte…');
Promise.all([
  // copiées dans l'application (étape 16a) : elle démarre sans réseau (voir vendor/VERSIONS.txt)
  // La rotation de la carte (étape 18b) se charge APRÈS Leaflet ; si elle manquait, la carte marcherait quand même, sans pouvoir pivoter.
  loadScript('vendor/leaflet.js').then(()=>loadScript('vendor/leaflet-rotate.umd.min.js').catch(()=>{})),
  loadScript('vendor/supabase.min.js'),
]).then(()=>{
  setStatus('Connexion à la base de données…');
  initApp();
}).catch(e=>{
  showErr('Impossible de charger les librairies de l’application.<br>Ferme puis rouvre l’application. Si ça continue, communique avec Joé.<br><br><small>'+esc(e.message)+'</small>');
});
