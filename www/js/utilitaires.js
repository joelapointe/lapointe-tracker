// js/utilitaires.js — Petits outils : indicateur de synchro et messages (toast)
// (extrait de l'ancien index.html)
	function showSync(on){document.getElementById('sync').classList.toggle('show',on);}
let _tT;
function toast(msg){
  const el=document.getElementById('toast');
  el.textContent=msg;el.classList.add('show');
  clearTimeout(_tT);_tT=setTimeout(()=>el.classList.remove('show'),2500);
}

// ── SÉCURITÉ : insertion de texte dans du HTML ─────────
// À utiliser sur TOUT texte venant de la base de données ou d'un utilisateur
// avant de le mettre dans innerHTML, un popup Leaflet ou un divIcon.
// Sans ça, un nom comme <img src=x onerror=...> exécuterait du code.
function esc(v){
  return String(v==null?'':v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
// N'accepte qu'une couleur de type #c8e63c (sinon la couleur par défaut).
function couleurSure(c){
  return /^#[0-9a-fA-F]{3,8}$/.test(String(c||''))?c:'#c8e63c';
}
