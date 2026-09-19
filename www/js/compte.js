// js/compte.js — « Mon compte » : l'employé change lui-même son NIP
// Étape 12. Le NIP de départ est tiré au hasard et remis par Joé ; l'employé peut ensuite en choisir un facile à retenir.
//   • Le NIP ACTUEL est revérifié auprès du serveur avant tout changement (téléphone emprunté ou laissé déverrouillé).
//   • Les NIP évidents (000000, 123456, 654321…) sont refusés — mêmes règles que la fonction serveur admin-employes.
//   • Rien n'est jamais gardé dans le téléphone (ni le NIP actuel, ni le nouveau) ; les champs sont vidés après chaque envoi.
//   • Limite honnête : ces règles sont vérifiées dans l'application. Supabase Auth accepte tout mot de passe d'au moins 6
//     caractères, donc quelqu'un qui contournerait l'application pourrait se donner un NIP faible… à SON propre compte seulement.
//   • L'administrateur (courriel + mot de passe) n'utilise pas cet écran : son mot de passe se change dans Supabase.

const CHAMPS_NIP=['nip-actuel','nip-nouveau','nip-confirmation'];

// NIP trop facile à deviner : chiffres tous pareils (000000) ou suite (123456, 654321).
function nipTropFacile(nip){
  if(/^(\d)\1{5}$/.test(nip)) return true;
  const d=String(nip).split('').map(Number);
  const pas=d[1]-d[0];
  return (pas===1||pas===-1)&&d.every((x,i)=>i===0||x-d[i-1]===pas);
}

// Renvoie '' si tout est bon, sinon le message à afficher.
function validerNouveauNip(actuel,nouveau,confirmation){
  if(!actuel||!nouveau||!confirmation) return 'Remplis les trois champs.';
  if(!/^\d{6}$/.test(actuel)) return 'Ton NIP actuel a 6 chiffres.';
  if(!/^\d{6}$/.test(nouveau)) return 'Le nouveau NIP doit avoir exactement 6 chiffres.';
  if(nipTropFacile(nouveau)) return 'NIP trop facile à deviner (ex. 123456 ou 000000). Choisis-en un autre.';
  if(nouveau===actuel) return 'Le nouveau NIP doit être différent de l’ancien.';
  if(nouveau!==confirmation) return 'Les deux NIP ne sont pas pareils.';
  return '';
}

function messageErreurChangementNip(err){
  const code=(err&&err.code)||'';
  const statut=err&&err.status;
  if(code==='same_password') return 'Le nouveau NIP doit être différent de l’ancien.';
  if(code==='weak_password') return 'Ce NIP est refusé (trop facile). Choisis-en un autre.';
  if(code==='over_request_rate_limit'||statut===429) return 'Trop d’essais. Attends quelques minutes, puis réessaie.';
  if((err&&err.name==='AuthRetryableFetchError')||statut===0||(statut===undefined&&navigator.onLine===false)) return 'Pas de réseau. Réessaie quand tu auras du signal.';
  return 'Le changement a échoué. Réessaie.';
}

function effacerChampsNip(){
  CHAMPS_NIP.forEach(id=>{document.getElementById(id).value='';});
}

function ouvrirCompte(){
  if(!currentUser) return;
  effacerChampsNip();
  document.getElementById('compte-err').textContent='';
  document.getElementById('compte-nom').textContent=(currentUser.role==='admin'?'👑 ':'')+currentUser.nom;
  const employe=currentUser.role==='employe';
  document.getElementById('compte-nip').style.display=employe?'block':'none';
  document.getElementById('compte-admin').style.display=employe?'none':'block';
  document.getElementById('compte-overlay').classList.add('open');
  if(employe) document.getElementById('nip-actuel').focus();
}

function fermerCompte(){
  document.getElementById('compte-overlay').classList.remove('open');
  effacerChampsNip();
}

function bgClickCompte(e){
  if(e.target===document.getElementById('compte-overlay')) fermerCompte();
}

async function changerNip(){
  const errEl=document.getElementById('compte-err');
  const btn=document.getElementById('compte-btn');
  errEl.textContent='';
  if(!currentUser||currentUser.role!=='employe') return;
  const lire=id=>document.getElementById(id).value.replace(/\s/g,'');
  const actuel=lire('nip-actuel'), nouveau=lire('nip-nouveau'), confirmation=lire('nip-confirmation');
  const probleme=validerNouveauNip(actuel,nouveau,confirmation);
  if(probleme){errEl.textContent=probleme;return;}   // les champs restent pour corriger sans tout retaper
  btn.disabled=true;
  btn.textContent='Vérification…';
  try{
    const s=await db.auth.getSession();
    const session=s&&s.data&&s.data.session;
    if(!session||!session.user||!session.user.email){errEl.textContent='Session introuvable. Reconnecte-toi.';return;}
    // 1) Le NIP actuel est-il le bon ? (le serveur décide)
    const verif=await db.auth.signInWithPassword({email:session.user.email,password:actuel});
    if(verif.error){
      errEl.textContent=(verif.error.code==='invalid_credentials'||verif.error.status===400)?'NIP actuel incorrect.':messageErreurConnexion(verif.error);
      return;
    }
    // 2) Changement
    btn.textContent='Enregistrement…';
    const maj=await db.auth.updateUser({password:nouveau});
    if(maj.error){errEl.textContent=messageErreurChangementNip(maj.error);return;}
    fermerCompte();
    toast('✔ NIP changé.');
  }catch(e){
    errEl.textContent=messageErreurChangementNip(e);
  }finally{
    btn.disabled=false;
    btn.textContent='Enregistrer mon NIP';
    effacerChampsNip();   // aucun NIP ne reste dans les champs
  }
}
