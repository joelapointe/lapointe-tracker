/*
 * Page « Ne plus recevoir les avis par courriel » (desabonnement.html) : le lien au bas de chaque courriel d'avis de passage d'Entretien Lapointe.
 * Le lien porte l'identifiant du client (c) et son jeton secret (t). Le désabonnement se fait par la fonction « avis_desabonner_par_jeton » (fichier SQL 31).
 * IMPORTANT : la page ne fait RIEN au chargement : les robots de sécurité des boîtes courriel ouvrent les liens sans que la personne l'ait demandé ; le désabonnement
 * se fait seulement quand la personne TOUCHE LE BOUTON.
 * Aucune bibliothèque, aucun suivi (ni Google, ni Meta). La clé ci-dessous est la clé PUBLIQUE (« anon ») : elle est faite pour être visible dans une page web.
 */
(function () {
	'use strict';

	var SUPA_URL = 'https://uxoxdauzcxjsefuoruwt.supabase.co';
	var SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4b3hkYXV6Y3hqc2VmdW9ydXd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MDgxOTksImV4cCI6MjA5MDQ4NDE5OX0.wkCtoY3_273C-XWx9c2hP2PIWOC1c1I_3sFjG9cN55A';
	var DELAI_MAX_MS = 20000; // sans réponse après 20 secondes : on abandonne et on le dit

	var TEL = '<a href="tel:18192688069">819 268-8069</a>';
	var MSG_RESEAU = 'Connexion impossible. Vérifiez votre réseau et réessayez, ou écrivez-nous à <a href="mailto:info@entretienlapointe.ca">info@entretienlapointe.ca</a> ou téléphonez-nous au ' + TEL + '.';
	var MSG_AUTRE = 'Une erreur est survenue. Réessayez dans un instant, ou écrivez-nous à <a href="mailto:info@entretienlapointe.ca">info@entretienlapointe.ca</a> ou téléphonez-nous au ' + TEL + '.';
	var MSG_ANCIEN = 'Votre navigateur est trop ancien pour terminer le désabonnement. Écrivez-nous à <a href="mailto:info@entretienlapointe.ca">info@entretienlapointe.ca</a> ou téléphonez-nous au ' + TEL + '.';

	function $(id) { return document.getElementById(id); }

	var confirmer = $('des-confirmer');
	var incomplet = $('des-incomplet');
	var merci = $('des-merci');
	var bouton = $('des-bouton');
	var alerte = $('des-alerte');
	if (!confirmer || !incomplet || !merci || !bouton || !alerte) { return; }

	// Le lien : « ?c=<identifiant du client>&t=<jeton de 32 caractères> » (rien d'autre n'est accepté)
	function lireLien() {
		var c = '', t = '';
		var requete = String(window.location.search || '').replace(/^\?/, '');
		var parties = requete === '' ? [] : requete.split('&');
		if (parties.length !== 2) { return null; }
		for (var i = 0; i < parties.length; i++) {
			var kv = parties[i].split('=');
			if (kv.length !== 2) { return null; }
			if (kv[0] === 'c') { c = kv[1]; } else if (kv[0] === 't') { t = kv[1]; } else { return null; }
		}
		if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c)) { return null; }
		if (!/^[0-9a-f]{32}$/i.test(t)) { return null; }
		return { client: c.toLowerCase(), jeton: t.toLowerCase() };
	}

	function montrerAlerte(html) {
		alerte.innerHTML = html;
		alerte.hidden = false;
	}

	function fini() {
		enCours = false;
		bouton.disabled = false;
		bouton.textContent = 'Je ne veux plus recevoir ces avis par courriel';
	}

	function succes() {
		confirmer.hidden = true;
		merci.hidden = false;
		if (merci.focus) { merci.focus(); }
		if (merci.scrollIntoView) { merci.scrollIntoView(); }
	}

	function lienInvalide() {
		confirmer.hidden = true;
		incomplet.hidden = false;
	}

	var lien = lireLien();
	var enCours = false;
	if (!lien) { lienInvalide(); return; }
	confirmer.hidden = false;

	function envoyer() {
		if (typeof fetch !== 'function') { montrerAlerte(MSG_ANCIEN); return; }
		enCours = true;
		alerte.hidden = true;
		bouton.disabled = true;
		bouton.textContent = 'Un instant…';

		var controle = typeof AbortController === 'function' ? new AbortController() : null;
		var minuterie = controle ? setTimeout(function () { controle.abort(); }, DELAI_MAX_MS) : null;
		var options = {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY },
			body: JSON.stringify({ p_client_id: lien.client, p_jeton: lien.jeton })
		};
		if (controle) { options.signal = controle.signal; }

		fetch(SUPA_URL + '/rest/v1/rpc/avis_desabonner_par_jeton', options)
			.then(function (rep) { return rep.text().then(function (texte) { return { ok: rep.ok, texte: texte }; }); })
			.then(function (r) {
				if (minuterie) { clearTimeout(minuterie); }
				var statut = '', code = '';
				if (r.ok) { try { statut = String(JSON.parse(r.texte).statut || ''); } catch (e) { statut = ''; } }
				else { try { code = String(JSON.parse(r.texte).message || ''); } catch (e) { code = ''; } }
				if (r.ok && statut === 'desabonne') { enCours = false; succes(); return; }
				fini();
				if (code === 'lien_invalide') { lienInvalide(); } else { montrerAlerte(MSG_AUTRE); }
			})
			.catch(function () {
				if (minuterie) { clearTimeout(minuterie); }
				fini();
				montrerAlerte(MSG_RESEAU);
			});
	}

	bouton.addEventListener('click', function () {
		if (enCours) { return; }
		envoyer();
	});
})();
