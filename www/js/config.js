// js/config.js — Configuration Supabase et variables globales
// (extrait de l'ancien index.html)
// ── APP ────────────────────────────────────────────────
const SUPA_URL='https://uxoxdauzcxjsefuoruwt.supabase.co';
const SUPA_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4b3hkYXV6Y3hqc2VmdW9ydXd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MDgxOTksImV4cCI6MjA5MDQ4NDE5OX0.wkCtoY3_273C-XWx9c2hP2PIWOC1c1I_3sFjG9cN55A';

let db, map, stops=[], activeIdx=null, mkrs={};
let currentUser=null;   // {id, nom, role} de la personne connectée (Supabase Auth), sinon null

// Ancien suivi GPS et complétion automatique des arrêts : ils écrivent dans des tables qui ont été refaites (étapes 6 à 9).
// Désactivés à l'étape 12 pour ne pas produire d'erreurs ; remplacés par les nouvelles fonctions aux étapes 13, 14 et 18.
const ANCIEN_SUIVI_ACTIF=false;
let operator=localStorage.getItem('lp_op')||'';
let zone=localStorage.getItem('lp_zone')||'';
let lastPos=null;
