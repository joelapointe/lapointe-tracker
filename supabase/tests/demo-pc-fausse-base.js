// Fausse bibliothèque Supabase pour la DÉMONSTRATION sur grand écran (servie à la place de vendor/supabase.min.js par serveur-demo-pc.mjs).
// Toutes les données sont INVENTÉES : aucun vrai client, aucun vrai employé, aucune connexion à ta vraie base.
// Les écritures (ajouter, modifier, archiver…) restent dans la mémoire de la page : elles disparaissent au rechargement.
// Elle ouvre l'application déjà connectée en administrateur (« Joé (démo) »). Ne saisir AUCUN vrai mot de passe dans cette page.
(function(){
  'use strict';

  // ── Hasard déterministe : les mêmes données à chaque chargement ──────────────────────────────
  let graine=20261002;
  const alea=()=>{graine=(Math.imul(graine,1664525)+1013904223)>>>0;return graine/4294967296;};
  const entier=(a,b)=>a+Math.floor(alea()*(b-a+1));
  const choisir=l=>l[Math.floor(alea()*l.length)];
  const pad=(n,l)=>String(n).padStart(l||2,'0');
  const MAINTENANT=Date.now();
  const JOUR=86400000;
  const iso=ms=>new Date(ms).toISOString();
  const sansAccent=t=>String(t).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z]/g,'');

  const PRENOMS=['Marie','Jean','Sylvie','Pierre','Nathalie','André','Louise','Michel','Isabelle','Robert','Julie','Denis','Chantal','Yves','Line','Guy','Diane','Claude','Francine','Luc','Hélène','Serge','Monique','Daniel','Carole','Réjean','Lise','Gilles','Nicole','Marc'];
  const NOMS=['Tremblay','Gagnon','Roy','Côté','Bouchard','Gauthier','Morin','Lavoie','Fortin','Gagné','Ouellet','Pelletier','Bélanger','Lévesque','Bergeron','Leblanc','Paquette','Girard','Simard','Boucher','Caron','Beaulieu','Cloutier','Dubé','Poirier','Fournier','Leclerc','Désilets','Houle','Mongrain'];
  const RUES=['rue Principale','chemin du Lac','rue Notre-Dame','rue des Érables','boulevard Saint-Laurent','rue du Parc','chemin Bellevue','rue Saint-Jean','rue des Pins','avenue des Cèdres','rue Girardin','rue Desfossés','chemin des Cormiers','rue Michel','rue Villemure'];
  const ENTREPRISES=['Immeubles Bellevue inc.','Syndicat Domaine des Pins','Dépanneur du Coin','Clinique Santé Plus','Municipalité de Charette (garage)','Les Placements Lavoie inc.','Résidence Les Érables','Boulangerie Saint-Jean'];
  const NOTES=['Chien dans la cour : fermer la barrière.','Entrée de garage à gauche, éviter les rosiers.','Appeler avant de passer.','Terrain en pente, tondre en travers.','Clé de la remise sous le pot de fleurs.','Boîte aux lettres à dégager en hiver.'];

  const T={};   // les tables : nom -> tableau de lignes

  // ── Utilisateurs, véhicules, services, routes ───────────────────────────────────────────────
  const noms_emp=['Marc Lavoie','Julie Gagnon','Luc Bergeron','Sophie Roy','Alex Pelletier','Nicolas Fortin','Émilie Caron'];
  T.utilisateurs=[{id:'u-joe',nom:'Joé (démo)',telephone:null,role:'admin',actif:true,cree_le:iso(MAINTENANT-60*JOUR)}]
    .concat(noms_emp.map((n,i)=>({id:'u-'+(i+1),nom:n,telephone:'819555'+pad(100+i,4),role:'employe',actif:i!==6,cree_le:iso(MAINTENANT-(50-i)*JOUR)})));
  T.equipes=[{id:'e-1',nom:'Camion 1',actif:true},{id:'e-2',nom:'Camion 2',actif:true},{id:'e-3',nom:'Tracteur 3',actif:true},{id:'e-4',nom:'Camion 4 (vendu)',actif:false}];
  T.types_service=[
    {id:'t-1',nom:'Coupe de gazon',actif:true,icone:null,frequence_jours:7},
    {id:'t-2',nom:'Déneigement',actif:true,icone:null,frequence_jours:null},
    {id:'t-3',nom:'Désherbage',actif:true,icone:null,frequence_jours:14},
    {id:'t-4',nom:'Aération',actif:false,icone:null,frequence_jours:null}];
  const ROUTES=[
    {id:'r-1',nom:'Charette',couleur:'#c8e63c',service:'Coupe de gazon',n:18,lat:46.4503,lon:-72.9461,ville:'Charette'},
    {id:'r-2',nom:'Louiseville',couleur:'#38bdf8',service:'Coupe de gazon',n:14,lat:46.2580,lon:-72.9440,ville:'Louiseville'},
    {id:'r-3',nom:'Trois-Rivières',couleur:'#fb923c',service:'Coupe de gazon',n:12,lat:46.3430,lon:-72.5430,ville:'Trois-Rivières'},
    {id:'r-4',nom:'Déneigement Nord',couleur:'#a78bfa',service:'Déneigement',n:10,lat:46.4700,lon:-72.9300,ville:'Charette'}];
  T.routes=ROUTES.map((r,i)=>({id:r.id,nom:r.nom,couleur:r.couleur,created_at:iso(MAINTENANT-(40-i)*JOUR),actif:true,numero_base:0}));

  // ── Clients (répertoire) ─────────────────────────────────────────────────────────────────────
  T.clients=[];
  for(let i=0;i<64;i++){
    const prenom=choisir(PRENOMS),nom=choisir(NOMS);
    const entreprise=(i%9===4)?ENTREPRISES[Math.floor(i/9)%ENTREPRISES.length]:null;
    const type=entreprise?choisir(['commerce','syndicat','investisseur','municipalite']):'particulier';
    const aCourriel=alea()<0.72,aCell=alea()<0.4;
    const cree=iso(MAINTENANT-entier(5,25)*JOUR);
    T.clients.push({
      id:'c-'+pad(i+1,3),nom:prenom+' '+nom,nom_entreprise:entreprise,type_client:type,
      adresse:entier(10,980)+' '+choisir(RUES),ville:choisir(['Charette','Charette','Louiseville','Yamachiche','Trois-Rivières','Saint-Étienne-des-Grès']),
      code_postal:'G0X '+entier(1,3)+choisir(['A','B','C','E','H'])+entier(0,9),
      courriel:aCourriel?sansAccent(prenom)+'.'+sansAccent(nom)+'@exemple.test':null,
      telephone:alea()<0.8?'819 555-'+pad(entier(100,199),4):null,
      cellulaire:aCell?'+1819555'+pad(entier(200,299),4):null,
      avis_courriel:aCourriel&&alea()<0.3,avis_texto:aCell&&alea()<0.25,
      desabonne_courriel_le:(i===7||i===19)?iso(MAINTENANT-9*JOUR):null,desabonne_texto_le:null,desabonne_promo_le:null,
      notes:alea()<0.2?choisir(NOTES):null,actif:!(i===12||i===33||i===50),
      cree_le:cree,maj_le:cree});
  }

  // ── Arrêts (stops) : environ 70 % reliés à une fiche, 76 % avec une zone dessinée ──────────
  T.stops=[];
  let k=0;
  ROUTES.forEach(r=>{
    for(let i=0;i<r.n;i++){
      const lie=alea()<0.7&&k<T.clients.length;
      const cl=lie?T.clients[k++]:null;
      const lat=r.lat+(alea()-0.5)*0.03,lon=r.lon+(alea()-0.5)*0.05;
      const dz=0.00018;
      const zone=alea()<0.76?[[lat+dz,lon-dz*1.4],[lat+dz,lon+dz*1.4],[lat-dz,lon+dz*1.4],[lat-dz,lon-dz*1.4]]:null;
      T.stops.push({
        id:'s-'+r.id+'-'+pad(i+1,2),adresse:(cl?cl.adresse:entier(10,980)+' '+choisir(RUES))+', '+(cl?cl.ville:r.ville),
        client:cl?cl.nom:(alea()<0.5?choisir(PRENOMS)+' '+choisir(NOMS):null),service:r.service,lat,lon,ordre:i,equipe_id:null,zone_id:null,
        created_at:iso(MAINTENANT-(30-i)*JOUR),route_nom:null,route_id:r.id,zone_points:zone,actif:true,client_id:cl?cl.id:null});
    }
  });

  // ── Passes et arrêts complétés (de quoi remplir le Suivi et l'Historique) ───────────────────
  T.passes=[];T.passe_arrets=[];
  const PLAN=[['r-1',[35,28,21,14,7,2]],['r-2',[27,20,13,5]],['r-3',[24,16,9]]];
  let nPasse=0;
  PLAN.forEach(([rid,ags])=>{
    const route=ROUTES.find(x=>x.id===rid);
    const arrets=T.stops.filter(s=>s.route_id===rid);
    ags.forEach((age,j)=>{
      nPasse++;
      const debut=MAINTENANT-age*JOUR-3600000*entier(0,3);
      const faits=arrets.filter(()=>alea()<0.9);
      const chauffeur=T.utilisateurs[1+((nPasse+j)%5)];
      const p={id:'p-'+pad(nPasse,3),numero:j+1,tache:route.service,route_id:rid,equipe_id:'e-'+(1+(nPasse%3)),chauffeur_id:chauffeur.id,
        debut:iso(debut),fin:iso(debut+faits.length*420000),fin_type:'complete',fin_estimee:null,statut:'terminee',
        nb_arrets_total:arrets.length,nb_arrets_faits:faits.length,pourcentage:Math.round(100*faits.length/arrets.length),cree_le:iso(debut)};
      T.passes.push(p);
      faits.forEach((s,m)=>T.passe_arrets.push({id:'pa-'+p.id+'-'+pad(m,2),passe_id:p.id,stop_id:s.id,complete_le:iso(debut+(m+1)*420000),complete_par:chauffeur.id,mode:(m%3===0)?'auto':'manuel'}));
    });
  });
  T.passages_manuels=[{id:'pm-1',stop_id:'s-r-1-03',jour:iso(MAINTENANT-10*JOUR).slice(0,10),note:null},{id:'pm-2',stop_id:'s-r-1-05',jour:iso(MAINTENANT-3*JOUR).slice(0,10),note:null}];

  // ── Quarts, problèmes, réglages ──────────────────────────────────────────────────────────────
  T.quarts=[
    {id:'q-1',utilisateur_id:'u-1',debut:iso(MAINTENANT-3*3600000),fin:null,a_valider:false,raison_a_valider:null,note:null},
    {id:'q-2',utilisateur_id:'u-3',debut:iso(MAINTENANT-JOUR-9*3600000),fin:iso(MAINTENANT-JOUR-1*3600000),a_valider:true,raison_a_valider:'Fin estimée : le téléphone n’a pas envoyé la fin du quart',note:null},
    {id:'q-3',utilisateur_id:'u-2',debut:iso(MAINTENANT-2*JOUR-8*3600000),fin:iso(MAINTENANT-2*JOUR-30*60000),a_valider:true,raison_a_valider:'Quart de plus de 8 heures',note:null}];
  T.problemes=[
    {id:'pb-1',stop_id:'s-r-1-04',passe_id:'p-005',utilisateur_id:'u-2',note:'Barrière fermée à clé, impossible d’entrer dans la cour.',cree_le:iso(MAINTENANT-2*3600000),photo_chemin:null,lu:false},
    {id:'pb-2',stop_id:'s-r-2-02',passe_id:'p-008',utilisateur_id:'u-4',note:'Beaucoup de branches tombées sur le terrain.',cree_le:iso(MAINTENANT-JOUR),photo_chemin:null,lu:false}];
  T.reglages=[
    {cle:'presence_complete_auto_s',valeur:'60',description:'Temps passé dans la zone d’un client avant que l’arrêt se complète tout seul (0 = jamais).'},
    {cle:'quart_pause_suggestion_h',valeur:'4',description:'Après combien d’heures de quart on suggère une pause.'},
    {cle:'quart_rappel_heures',valeur:'12',description:'Après combien d’heures on rappelle à l’employé qu’il est encore en service.'},
    {cle:'quart_fermeture_auto_heure',valeur:'16',description:'Heure de la fermeture automatique des quarts oubliés.'},
    {cle:'position_intervalle_s',valeur:'3',description:'Toutes les combien de secondes le téléphone du chauffeur envoie sa position.'}];
  T.equipage_periodes=[];T.positions=[];T.parcours_segments=[];

  // ── Avis aux clients : inscriptions reçues et journal ───────────────────────────────────────
  T.inscriptions_avis=[
    {id:'i-1',nom:'Sylvie Morin',adresse:'45 rue des Pins, Charette',cellulaire:'+18195550311',courriel:'sylvie.morin@exemple.test',promo_accepte:true,statut:'nouvelle',client_id:null,cree_le:iso(MAINTENANT-2*3600000),traitee_le:null},
    {id:'i-2',nom:'Denis Boucher',adresse:'210 chemin du Lac, Louiseville',cellulaire:'+18195550312',courriel:null,promo_accepte:false,statut:'nouvelle',client_id:null,cree_le:iso(MAINTENANT-JOUR),traitee_le:null},
    {id:'i-3',nom:'Line Roy',adresse:'12 rue Principale, Charette',cellulaire:'+18195550313',courriel:'line.roy@exemple.test',promo_accepte:false,statut:'reliee',client_id:'c-005',cree_le:iso(MAINTENANT-6*JOUR),traitee_le:iso(MAINTENANT-5*JOUR)}];
  T.avis_envois=[];
  for(let i=0;i<14;i++){
    const cl=T.clients[i*3+1];const st=['envoye','envoye','envoye','refuse','echec','envoye','en_attente'][i%7];
    const t=MAINTENANT-(i<8?1:2)*JOUR-i*420000;
    T.avis_envois.push({id:'a-'+pad(i+1,3),lot_id:'lot-'+(i<8?1:2),cree_le:iso(t),jour:iso(t).slice(0,10),client_id:cl.id,canal:'courriel',destinataire:cl.courriel||'client'+i+'@exemple.test',
      delai:i%2?'3h':'24h',service:'Coupe de gazon',adresse:cl.adresse+', '+cl.ville,version_modele:'avis-2026-10-v1',
      objet:'Entretien Lapointe : nous passons chez vous d’ici environ '+(i%2?'3 heures':'24 heures'),
      message:'Bonjour,\n\nNous passerons chez vous d’ici environ '+(i%2?'3 heures':'24 heures')+' pour le service « Coupe de gazon » ('+cl.adresse+').\nMerci de ramasser les objets sur le terrain pour éviter les bris.\n\nEntretien Lapointe',
      statut:st,motif:st==='refuse'?'desabonne_courriel':null,fournisseur_id:st==='envoye'?'re_'+(100000+i):null,envoye_le:st==='envoye'?iso(t+800):null,erreur:st==='echec'?'Boîte pleine (démonstration)':null});
  }

  // ── Moteur de requêtes minimal ───────────────────────────────────────────────────────────────
  const RELATIONS={
    passe_arrets:{stops:{table:'stops',local:'stop_id'},utilisateurs:{table:'utilisateurs',local:'complete_par'},passes:{table:'passes',local:'passe_id'}},
    passes:{equipes:{table:'equipes',local:'equipe_id'},utilisateurs:{table:'utilisateurs',local:'chauffeur_id'}},
    quarts:{utilisateurs:{table:'utilisateurs',local:'utilisateur_id'}},
    problemes:{utilisateurs:{table:'utilisateurs',local:'utilisateur_id'},stops:{table:'stops',local:'stop_id'}},
    stops:{passe_arrets:{table:'passe_arrets',distante:'stop_id',plusieurs:true}}
  };
  function extraireRelations(sel){
    const res=[],s=String(sel||'');const re=/([a-z_]+)(?:!([a-z_]+))?\(/g;let m;
    while((m=re.exec(s))){
      let prof=1,i=re.lastIndex;
      while(i<s.length&&prof>0){if(s[i]==='(')prof++;else if(s[i]===')')prof--;i++;}
      res.push({nom:m[1],cle:m[2]||null,interne:s.slice(re.lastIndex,i-1)});
      re.lastIndex=i;
    }
    return res;
  }
  function incorporer(table,lignes,sel){
    const rels=extraireRelations(sel);
    if(!rels.length) return lignes;
    return lignes.map(l=>{
      const o=Object.assign({},l);
      rels.forEach(r=>{
        const def=(RELATIONS[table]||{})[r.nom];
        if(!def){o[r.nom]=null;return;}
        if(def.plusieurs){o[r.nom]=incorporer(def.table,(T[def.table]||[]).filter(x=>x[def.distante]===l.id),r.interne);return;}
        const col=(r.cle&&r.nom==='utilisateurs')?r.cle:def.local;
        const cible=(T[def.table]||[]).find(x=>x.id===l[col]);
        o[r.nom]=cible?incorporer(def.table,[cible],r.interne)[0]:null;
      });
      return o;
    });
  }
  function executer(e){
    const lignes=T[e.table]||[];
    const filtrer=ls=>ls.filter(l=>e.filtres.every(f=>f(l)));
    let data;
    if(e.op==='insert'||e.op==='upsert'){
      const rows=(Array.isArray(e.charge)?e.charge:[e.charge]).map(r=>Object.assign({id:'n-'+Math.random().toString(36).slice(2,8)},r));
      if(!T[e.table])T[e.table]=[];
      rows.forEach(r=>T[e.table].push(r));
      data=rows;
    }else if(e.op==='update'){
      data=filtrer(lignes);data.forEach(l=>Object.assign(l,e.charge));
    }else if(e.op==='delete'){
      const a=filtrer(lignes);T[e.table]=lignes.filter(l=>!a.includes(l));data=a;
    }else{
      data=filtrer(lignes).slice();
      e.tri.slice().reverse().forEach(t=>{data.sort((a,b)=>{const x=a[t.c],y=b[t.c];if(x===y)return 0;if(x==null)return 1;if(y==null)return -1;return (x<y?-1:1)*(t.asc?1:-1);});});
    }
    const total=data.length;
    if(e.fin!==null)data=data.slice(e.debut,e.fin+1);
    if(e.limite!==null)data=data.slice(0,e.limite);
    data=incorporer(e.table,data,e.sel);
    if(e.unique){
      if(!data.length) return e.unique==='single'?{data:null,error:{message:'0 ligne',code:'PGRST116'}}:{data:null,error:null};
      data=data[0];
    }
    return {data,error:null,count:e.compte?total:null};
  }
  function requete(table){
    const e={table,filtres:[],tri:[],debut:0,fin:null,limite:null,unique:null,op:'select',charge:null,sel:'*',compte:false};
    const q={};
    const ajoute=f=>{e.filtres.push(f);return q;};
    q.select=(sel,opts)=>{e.sel=sel||'*';if(opts&&opts.count)e.compte=true;return q;};
    q.eq=(c,v)=>ajoute(l=>l[c]===v);
    q.neq=(c,v)=>ajoute(l=>l[c]!==v);
    q.is=(c,v)=>ajoute(l=>(l[c]===undefined?null:l[c])===v);
    q.in=(c,vs)=>ajoute(l=>vs.includes(l[c]));
    q.gt=(c,v)=>ajoute(l=>l[c]>v);
    q.gte=(c,v)=>ajoute(l=>l[c]>=v);
    q.lt=(c,v)=>ajoute(l=>l[c]<v);
    q.lte=(c,v)=>ajoute(l=>l[c]<=v);
    q.ilike=(c,v)=>{const re=new RegExp('^'+String(v).replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/%/g,'.*')+'$','i');return ajoute(l=>re.test(String(l[c]||'')));};
    q.not=()=>q;q.or=()=>q;q.filter=()=>q;q.match=()=>q;q.contains=()=>q;
    q.order=(c,o)=>{e.tri.push({c,asc:!(o&&o.ascending===false)});return q;};
    q.limit=n=>{e.limite=n;return q;};
    q.range=(a,b)=>{e.debut=a;e.fin=b;return q;};
    q.single=()=>{e.unique='single';return q;};
    q.maybeSingle=()=>{e.unique='maybe';return q;};
    q.insert=v=>{e.op='insert';e.charge=v;return q;};
    q.update=v=>{e.op='update';e.charge=v;return q;};
    q.upsert=v=>{e.op='upsert';e.charge=v;return q;};
    q.delete=()=>{e.op='delete';return q;};
    q.then=(ok,ko)=>Promise.resolve().then(()=>executer(e)).then(ok,ko);
    return q;
  }

  // ── Fonctions de la base (rpc) et fonctions serveur ──────────────────────────────────────────
  const RPC={
    admin_lister_utilisateurs:()=>T.utilisateurs,
    tours_en_cours:()=>[]
  };

  // Aucune requête ne part vers la vraie base : le test « le serveur répond-il ? » de l'appli reçoit une fausse réponse.
  const fetchOriginal=window.fetch?window.fetch.bind(window):null;
  window.fetch=function(url,opts){
    if(/supabase\.co/i.test(String(url&&url.url||url))) return Promise.resolve(new Response('{}',{status:200,headers:{'Content-Type':'application/json'}}));
    return fetchOriginal?fetchOriginal(url,opts):Promise.reject(new Error('fetch indisponible'));
  };

  window.supabase={createClient:()=>{
    const canal=()=>{const c={on:()=>c,subscribe:()=>c,unsubscribe(){}};return c;};
    return {
      from:requete,
      rpc:async(nom,args)=>({data:RPC[nom]?RPC[nom](args||{}):null,error:null}),
      channel:canal,removeChannel(){},
      functions:{invoke:async(nom)=>({data:null,error:{message:'Démonstration : la fonction « '+nom+' » n’est pas branchée.'}})},
      auth:{
        onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};},
        getSession:async()=>({data:{session:{access_token:'demo',refresh_token:'demo',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'u-joe',email:'demo@exemple.test'}}}}),
        getUser:async()=>({data:{user:{id:'u-joe'}},error:null}),
        signOut:async()=>({}),
        signInWithPassword:async()=>({data:null,error:{message:'Démonstration : pas de connexion.'}})
      },
      storage:{from:()=>({createSignedUrls:async()=>({data:[]})})}
    };
  }};
  window.DEMO_DONNEES=T;   // pour regarder ou ajuster les données depuis la console

  // ── Mode « étapes » pour les captures d'écran sans fenêtre visible ───────────────────────────────────────
  // Exemple : http://localhost:8126/?etapes=admin;onglet:clients;clic:Avis aux clients;attente:800
  //   admin = ouvre le panneau Admin ; onglet:<id> = changerOngletAdmin ; clic:<texte> = clique le premier bouton qui contient ce texte ;
  //   attente:<ms> ; js:<code> = exécute ce code dans la page. L'écran « JE COMMENCE » du début est fermé tout seul.
  (function(){
    const q=new URLSearchParams(location.search).get('etapes');
    if(!q) return;
    const attendre=ms=>new Promise(r=>setTimeout(r,ms));
    window.addEventListener('load',async()=>{
      try{
        for(let i=0;i<80&&!(typeof currentUser!=='undefined'&&currentUser);i++) await attendre(100);
        await attendre(600);
        const lien=[...document.querySelectorAll('button,a')].find(e=>/voir la carte/i.test(e.textContent));
        if(lien) lien.click();
        await attendre(300);
        for(const etape of q.split(';')){
          const i=etape.indexOf(':');const cmd=i<0?etape:etape.slice(0,i);const arg=i<0?'':etape.slice(i+1);
          if(cmd==='admin'){openAdmin();await attendre(500);}
          else if(cmd==='onglet'){changerOngletAdmin(arg);await attendre(900);}
          else if(cmd==='clic'){
            const cands=[...document.querySelectorAll('button,a,[onclick],.su-puce,.admin-tab')].filter(x=>x.textContent.trim().includes(arg));
            const c=cands.find(x=>!cands.some(y=>y!==x&&x.contains(y)));   // le plus profond : jamais un parent comme le fond du panneau
            if(c) c.click(); else console.error('démo : rien à cliquer pour « '+arg+' »');
            await attendre(800);
          }
          else if(cmd==='attente'){await attendre(Number(arg)||500);}
          else if(cmd==='js'){await (new Function('return (async()=>{'+arg+'})()'))();await attendre(400);}
        }
        document.title='demo-pret';
      }catch(err){console.error('démo : étapes en échec',err);document.title='demo-echec';}
    });
  })();
})();
