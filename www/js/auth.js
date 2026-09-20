// js/auth.js — Connexion (Supabase Auth), session permanente, déconnexion, rôle
// Étape 12 : remplace l'ancienne connexion « numéro + NIP comparés en clair dans la table utilisateurs ».
//   • L'employé se connecte avec son NUMÉRO DE TÉLÉPHONE et son NIP à 6 chiffres (identifiant technique numéro@tel.entretienlapointe.ca).
//   • L'administrateur se connecte avec son COURRIEL et son mot de passe (même champ : dès qu'il y a un « @ », c'est un courriel).
//   • Aucune inscription : c'est Joé qui crée chaque compte.
//   • La session reste ouverte sur le téléphone (supabase-js la garde et la renouvelle tout seul).
//   • On ne déconnecte JAMAIS quelqu'un parce que le réseau est coupé (zones mortes) : seulement si le serveur dit que le compte est désactivé.
//   • On ne lit jamais « select * » sur utilisateurs (la base l'interdit) : on nomme les colonnes.

const DOMAINE_TEL='tel.entretienlapointe.ca';
const PROFIL_LOCAL='lp_profil';   // {id, nom, role} gardé pour ouvrir l'app sans réseau. Jamais de secret, jamais de téléphone.
let deconnexionVolontaire=false;

// ── Écran de connexion ─────────────────────────────────
function showLoginScreen(message){
  document.getElementById('login-screen').classList.add('show');
  document.getElementById('login-err').textContent=message||'';
  const btn=document.getElementById('login-btn');
  btn.textContent='Connexion →';
  btn.disabled=false;
  majChampsConnexion();
}

function cacherLoginScreen(){
  document.getElementById('login-screen').classList.remove('show');
}

// Le libellé du 2e champ suit le premier : un numéro → « NIP », un courriel → « Mot de passe ».
function majChampsConnexion(){
  const id=document.getElementById('l-tel').value;
  const admin=id.indexOf('@')!==-1;
  const pin=document.getElementById('l-pin');
  document.getElementById('l-pin-label').textContent=admin?'Mot de passe':'NIP (6 chiffres)';
  pin.setAttribute('inputmode',admin?'text':'numeric');
  pin.setAttribute('maxlength',admin?'128':'6');
  pin.setAttribute('placeholder',admin?'••••••••':'••••••');
}

// ── Identifiant → courriel technique ───────────────────
// « 819-123-4567 », « (819) 123 4567 », « +1 819 123 4567 » → 8191234567@tel.entretienlapointe.ca
// « joe@exemple.ca » → joe@exemple.ca
function identifiantConnexion(saisie){
  const s=String(saisie||'').trim();
  if(s.indexOf('@')!==-1) return {email:s.toLowerCase(),admin:true};
  let t=s.replace(/\D/g,'');
  if(t.length===11&&t.charAt(0)==='1') t=t.slice(1);
  if(!/^[2-9]\d{9}$/.test(t)) return {erreur:'Numéro de téléphone invalide : 10 chiffres, indicatif régional compris.'};
  return {email:t+'@'+DOMAINE_TEL,admin:false};
}

function messageErreurConnexion(err){
  const code=(err&&err.code)||'';
  const statut=err&&err.status;
  if(code==='user_banned') return 'Ce compte est désactivé. Communique avec Joé.';
  if(code==='over_request_rate_limit'||statut===429) return 'Trop d’essais. Attends quelques minutes, puis réessaie.';
  if(code==='invalid_credentials'||statut===400) return 'Numéro ou NIP incorrect.';
  if((err&&err.name==='AuthRetryableFetchError')||statut===0||statut===undefined&&navigator.onLine===false) return 'Pas de réseau. Vérifie ta connexion, puis réessaie.';
  return 'Connexion impossible. Réessaie.';
}

async function doLogin(){
  const errEl=document.getElementById('login-err');
  const btn=document.getElementById('login-btn');
  errEl.textContent='';
  const id=identifiantConnexion(document.getElementById('l-tel').value);
  if(id.erreur){errEl.textContent=id.erreur;return;}
  let secret=document.getElementById('l-pin').value;
  if(!id.admin) secret=secret.replace(/\s/g,'');   // un NIP ne contient que des chiffres
  if(!secret){errEl.textContent='Remplis tous les champs.';return;}
  btn.disabled=true;
  btn.textContent='Vérification…';
  try{
    const{data,error}=await db.auth.signInWithPassword({email:id.email,password:secret});
    if(error){errEl.textContent=messageErreurConnexion(error);return;}
    document.getElementById('l-pin').value='';
    await ouvrirSession(data.session);
  }catch(e){
    errEl.textContent=messageErreurConnexion(e);
  }finally{
    btn.disabled=false;
    btn.textContent='Connexion →';
  }
}

// ── Profil (nom, rôle, actif) ──────────────────────────
// Renvoie {statut:'ok', profil} | {statut:'inaccessible'} | {statut:'reseau'}
//   inaccessible = le serveur répond, mais l'employé n'a pas de profil visible : compte DÉSACTIVÉ (la base ne lui montre plus rien) ou non configuré.
//   reseau       = pas de réponse (zone morte, serveur injoignable) : on ne déconnecte personne pour ça.
async function chargerProfil(userId){
  try{
    const{data,error}=await db.from('utilisateurs')
      .select('id, nom, role, actif, cree_le')
      .eq('id',userId)
      .maybeSingle();
    if(error) return {statut:'reseau'};
    if(!data||!data.actif) return {statut:'inaccessible'};
    return {statut:'ok',profil:{id:data.id,nom:data.nom,role:data.role}};
  }catch(e){
    return {statut:'reseau'};
  }
}

function lireProfilLocal(){
  try{
    const p=JSON.parse(localStorage.getItem(PROFIL_LOCAL));
    if(p&&p.id&&p.nom&&(p.role==='admin'||p.role==='employe')) return p;
  }catch(e){}
  return null;
}
function sauverProfilLocal(p){
  try{localStorage.setItem(PROFIL_LOCAL,JSON.stringify({id:p.id,nom:p.nom,role:p.role}));}catch(e){}
}
function effacerProfilLocal(){
  try{localStorage.removeItem(PROFIL_LOCAL);}catch(e){}
}

// Ouvre l'application pour la session donnée. Renvoie true si l'application est ouverte.
async function ouvrirSession(session){
  const r=await chargerProfil(session.user.id);
  if(r.statut==='ok'){
    currentUser=r.profil;
    sauverProfilLocal(r.profil);
    cacherLoginScreen();
    applyRole();
    loadStops();
    return true;
  }
  if(r.statut==='inaccessible'){
    await fermerSessionLocale();
    showLoginScreen('Ce compte est désactivé ou n’est pas configuré. Communique avec Joé.');
    return false;
  }
  // Pas de réseau : si c'est bien le même utilisateur, on ouvre avec le dernier profil connu (hors réseau).
  const local=lireProfilLocal();
  if(local&&local.id===session.user.id){
    currentUser=local;
    cacherLoginScreen();
    applyRole();
    loadStops();
    return true;
  }
  showLoginScreen('Pas de réseau. Vérifie ta connexion, puis réessaie.');
  return false;
}

async function fermerSessionLocale(){
  deconnexionVolontaire=true;
  await effacerCache();
  currentUser=null;
  effacerProfilLocal();
  try{await db.auth.signOut({scope:'local'});}catch(e){}
  deconnexionVolontaire=false;
}

// ── Démarrage : reprendre la session déjà ouverte sur ce téléphone ──
async function restaurerSession(){
  try{localStorage.removeItem('lp_user');}catch(e){}   // ancien profil gardé en clair (avec le NIP) : effacé de chaque téléphone
  db.auth.onAuthStateChange((event)=>{
    // Session terminée ailleurs que par « Se déconnecter » (ex. renouvellement refusé) : retour à l'écran de connexion.
    // (Aucun appel à Supabase ici, seulement l'affichage.)
    if(event==='SIGNED_OUT'&&!deconnexionVolontaire&&currentUser){
      currentUser=null;
      effacerProfilLocal();
      effacerCache();
      document.getElementById('btn-deconnexion').style.display='none';
      showLoginScreen('Session terminée. Reconnecte-toi.');
    }
  });
  let session=null;
  try{
    const r=await db.auth.getSession();
    session=r&&r.data&&r.data.session;
  }catch(e){}
  hideLoading();
  if(session){
    const ouverte=await ouvrirSession(session);
    if(!ouverte&&!document.getElementById('login-screen').classList.contains('show')) showLoginScreen();
  } else if(await ouvrirSansSignal()){
    // ouvert hors réseau avec la session gardée sur le téléphone
  } else {
    showLoginScreen();
  }
}

// Le téléphone a été hors réseau assez longtemps pour que la session expire (le renouvellement demande du signal) : supabase-js
// ne rend alors plus de session, mais il GARDE le jeton sur le téléphone. Si le serveur est vraiment injoignable et que ce jeton est
// bien celui de l'employé gardé ici, on ouvre avec ses copies (aucune requête au serveur). Le signal de retour renouvelle le jeton tout seul ;
// s'il est refusé, l'application revient à l'écran de connexion. (Le serveur, lui, ne fait confiance qu'au jeton : rien ne se contourne.)
function jetonGardeSurLeTelephone(){
  try{
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      if(k&&/^sb-.+-auth-token$/.test(k)){
        const v=JSON.parse(localStorage.getItem(k));
        const s=v&&(v.currentSession||v);
        if(s&&s.user&&s.user.id&&s.refresh_token) return s.user.id;
      }
    }
  }catch(e){}
  return null;
}
async function ouvrirSansSignal(){
  const local=lireProfilLocal();
  if(!local||jetonGardeSurLeTelephone()!==local.id) return false;
  if(await serveurJoignable()) return false;   // le serveur répond : la session est vraiment finie, retour à la connexion
  currentUser=local;
  cacherLoginScreen();
  applyRole();
  await loadStops();
  return true;
}

async function doLogout(){
  // Décision de Joé : on ne se déconnecte pas tant qu'un geste attend d'être envoyé (il serait relu au nom de la prochaine personne connectée : jamais)
  const enAttente=gestesEnAttente().length;
  if(enAttente){
    if(await confirmer('Déconnexion impossible',pluriel(enAttente,'geste n’est pas encore envoyé','gestes ne sont pas encore envoyés')+'. Reste connecté : ils partiront dès que le signal revient, puis tu pourras te déconnecter.','Voir la liste','Compris')) ouvrirListeGestes();
    return;
  }
  // Boîte de l'application (pas la fenêtre native confirm(), refusée d'office par certains navigateurs intégrés)
  if(!(await confirmer('Se déconnecter ?','Tu devras te reconnecter pour utiliser l’application.','Se déconnecter','Rester connecté')))return;
  deconnexionVolontaire=true;
  try{await arreterTracking();}catch(e){}
  effacerProfilLocal();
  await effacerCache();   // les copies de l'employé ne restent pas sur le téléphone après sa déconnexion
  currentUser=null;
  try{await db.auth.signOut({scope:'local'});}catch(e){}   // « local » : ne déconnecte pas les autres appareils du même compte
  location.reload();
}

function applyRole(){
  if(!currentUser)return;
  const isAdmin=currentUser.role==='admin';
  // Bouton « Déconnexion » de la barre du haut (visible seulement quand quelqu'un est connecté)
  const bouton=document.getElementById('btn-deconnexion');
  bouton.style.display='flex';
  bouton.setAttribute('title','Se déconnecter ('+currentUser.nom+')');
  document.getElementById('op-name').textContent=(isAdmin?'👑 ':'')+currentUser.nom;
  document.getElementById('bb-add').style.display=isAdmin?'flex':'none';
  document.getElementById('btn-nouveau-liste').style.display=isAdmin?'flex':'none';
  document.getElementById('btn-del').style.display=isAdmin?'flex':'none';
  document.getElementById('bb-admin').style.display=isAdmin?'flex':'none';
  // Ancien suivi GPS : désactivé (il écrit dans une table refaite). Remplacé aux étapes 13 et 18.
  if(ANCIEN_SUIVI_ACTIF) demarrerTracking();
}
