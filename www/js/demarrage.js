// js/demarrage.js — Démarrage de l'application (doit rester chargé en dernier)
// (extrait de l'ancien index.html)
setStatus('Chargement de la carte…');
Promise.all([
  loadScript('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'),
  loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js'),
]).then(()=>{
  setStatus('Connexion à la base de données…');
  initApp();
}).catch(e=>{
  showErr('Impossible de charger les librairies.<br>Vérifie ta connexion internet.<br><br><small>'+esc(e.message)+'</small>');
});
