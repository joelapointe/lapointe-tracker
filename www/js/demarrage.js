// js/demarrage.js — Démarrage de l'application (doit rester chargé en dernier)
// (extrait de l'ancien index.html)
setStatus('Chargement de la carte…');
Promise.all([
  loadScript('vendor/leaflet.js'),          // copiées dans l'application (étape 16a) : elle démarre sans réseau (voir vendor/VERSIONS.txt)
  loadScript('vendor/supabase.min.js'),
]).then(()=>{
  setStatus('Connexion à la base de données…');
  initApp();
}).catch(e=>{
  showErr('Impossible de charger les librairies de l’application.<br>Ferme puis rouvre l’application. Si ça continue, communique avec Joé.<br><br><small>'+esc(e.message)+'</small>');
});
