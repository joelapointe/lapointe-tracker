// js/auth.js — Connexion, inscription, déconnexion, rôle
// (extrait de l'ancien index.html, aucun changement de code)
function showLoginScreen(){
  document.getElementById('login-screen').classList.add('show');
  document.getElementById('signup-screen').classList.remove('show');
  document.getElementById('pending-screen').classList.remove('show');
}

function showSignup(){
  document.getElementById('login-screen').classList.remove('show');
  document.getElementById('signup-screen').classList.add('show');
  document.getElementById('pending-screen').classList.remove('show');
}

function showPending(){
  document.getElementById('login-screen').classList.remove('show');
  document.getElementById('signup-screen').classList.remove('show');
  document.getElementById('pending-screen').classList.add('show');
}

function showLogin(){
  document.getElementById('signup-screen').classList.remove('show');
  document.getElementById('pending-screen').classList.remove('show');
  document.getElementById('login-screen').classList.add('show');
}

async function doSignup(){
  const nom=document.getElementById('s-nom').value.trim();
  const tel=document.getElementById('s-tel').value.trim().replace(/\D/g,'');
  const pin=document.getElementById('s-pin').value.trim();
  const errEl=document.getElementById('signup-err');
  errEl.textContent='';

  if(!nom||!tel||!pin){errEl.textContent='Remplis tous les champs.';return;}
  if(pin.length!==4){errEl.textContent='Le PIN doit être 4 chiffres.';return;}
  if(tel.length<10){errEl.textContent='Numéro de téléphone invalide.';return;}

  document.getElementById('signup-btn').textContent='Création…';

  // Vérifier si le numéro existe déjà
  const{data:exist}=await db.from('utilisateurs').select('id').eq('telephone',tel).single();
  if(exist){
    document.getElementById('signup-btn').textContent='Créer mon compte →';
    errEl.textContent='Ce numéro est déjà utilisé.';
    return;
  }

  const{data,error}=await db.from('utilisateurs')
    .insert([{nom,telephone:tel,pin,role:'employe',approuve:false}])
    .select().single();

  document.getElementById('signup-btn').textContent='Créer mon compte →';

  if(error){errEl.textContent='Erreur: '+error.message;return;}

  currentUser=data;
  localStorage.setItem('lp_user',JSON.stringify(data));
  showPending();
}
function doLogout(){
  if(!confirm('Se déconnecter ?'))return;
  arreterTracking();
	currentUser=null;
  localStorage.removeItem('lp_user');
  location.reload();
}

async function doLogin(){
  const tel=document.getElementById('l-tel').value.trim().replace(/\D/g,'');
  const pin=document.getElementById('l-pin').value.trim();
  const errEl=document.getElementById('login-err');
  errEl.textContent='';
  if(!tel||!pin){errEl.textContent='Remplis tous les champs.';return;}
  document.getElementById('login-btn').textContent='Vérification…';
  const{data,error}=await db.from('utilisateurs').select('*').eq('telephone',tel).eq('pin',pin).single();
  document.getElementById('login-btn').textContent='Connexion →';
  if(error||!data){errEl.textContent='Numéro ou PIN incorrect.';return;}
  currentUser=data;
  localStorage.setItem('lp_user',JSON.stringify(data));
 document.getElementById('login-screen').classList.remove('show');
  if(!data.approuve){
    currentUser=data;
    localStorage.setItem('lp_user',JSON.stringify(data));
    showPending();
    return;
  }
  applyRole();
  loadStops();
 
}

function applyRole(){
  if(!currentUser)return;
  const isAdmin=currentUser.role==='admin';
  const badge=document.getElementById('role-badge');
  badge.textContent=(isAdmin?'👑 ':'')+currentUser.nom+' · Déconnexion';
  badge.className=isAdmin?'admin':'employe';
  document.getElementById('op-name').textContent=currentUser?currentUser.nom:operator||'—';
  document.getElementById('bb-add').style.display=isAdmin?'flex':'none';
	document.getElementById('btn-nouveau-liste').style.display=isAdmin?'flex':'none';
  document.getElementById('btn-del').style.display=isAdmin?'flex':'none';
  document.getElementById('bb-admin').style.display=isAdmin?'flex':'none';
	demarrerTracking();
}
