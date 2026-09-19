// js/config.js — Configuration Supabase et variables globales
// (extrait de l'ancien index.html, aucun changement de code)
// ── APP ────────────────────────────────────────────────
const SUPA_URL='https://uxoxdauzcxjsefuoruwt.supabase.co';
const SUPA_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4b3hkYXV6Y3hqc2VmdW9ydXd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MDgxOTksImV4cCI6MjA5MDQ4NDE5OX0.wkCtoY3_273C-XWx9c2hP2PIWOC1c1I_3sFjG9cN55A';

let db, map, stops=[], activeIdx=null, mkrs={};
let currentUser=null;
let operator=localStorage.getItem('lp_op')||'';
let zone=localStorage.getItem('lp_zone')||'';
let lastPos=null;
