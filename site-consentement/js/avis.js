/*
 * Page « Avis de passage par texto » (avis.html) : inscription publique aux textos d'Entretien Lapointe.
 * L'inscription est envoyée à la base Supabase par la fonction « inscrire_avis » (fichier SQL 30).
 * Aucune bibliothèque, aucun suivi (ni Google, ni Meta) : la personne saisit son numéro de cellulaire.
 * La clé ci-dessous est la clé PUBLIQUE (« anon ») : elle est faite pour être visible dans une page web.
 * Ce qu'elle permet est limité par la base : ici, seulement s'inscrire (et la fonction limite le nombre de demandes).
 */
(function () {
	'use strict';

	var SUPA_URL = 'https://uxoxdauzcxjsefuoruwt.supabase.co';
	var SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4b3hkYXV6Y3hqc2VmdW9ydXd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MDgxOTksImV4cCI6MjA5MDQ4NDE5OX0.wkCtoY3_273C-XWx9c2hP2PIWOC1c1I_3sFjG9cN55A';
	var DELAI_MAX_MS = 20000; // sans réponse après 20 secondes : on abandonne et on le dit

	var TEL = '<a href="tel:18192688069">819 268-8069</a>';

	// Les champs, dans l'ordre de la page (le premier champ en erreur reçoit le curseur)
	var CHAMPS = ['nom', 'cellulaire', 'adresse', 'courriel', 'accepte'];

	var MSG_CHAMP = {
		nom: 'Écrivez votre nom complet (au moins 2 lettres).',
		cellulaire: 'Écrivez un numéro de cellulaire à 10 chiffres, par exemple 819 555-1234.',
		adresse: 'Écrivez l\'adresse où nous faisons vos travaux (numéro et rue).',
		courriel: 'Ce courriel semble incomplet. Laissez le champ vide si vous n\'en avez pas.',
		accepte: 'Cochez la case pour accepter de recevoir les textos.'
	};

	// Les codes que la base peut répondre (texte de l'erreur) : un champ précis, ou un message général
	var MSG_OFFRES = 'Écrivez votre courriel pour recevoir nos offres, ou décochez la deuxième case.';
	var MSG_PAS_A_JOUR = 'Cette page n\'est plus à jour. Rechargez la page, puis réessayez.';
	var CODE_CHAMP = {
		nom_invalide: 'nom',
		cellulaire_invalide: 'cellulaire',
		adresse_invalide: 'adresse',
		courriel_invalide: 'courriel',
		courriel_requis_offres: 'courriel',
		consentement_requis: 'accepte'
	};
	// Le message d'un code qui n'est pas celui habituel de son champ
	var MSG_CODE = { courriel_requis_offres: MSG_OFFRES };
	var CODE_ALERTE = {
		version_inconnue: MSG_PAS_A_JOUR,
		version_promo_inconnue: MSG_PAS_A_JOUR,
		trop_de_demandes: 'Il y a eu trop de demandes en peu de temps. Réessayez plus tard ou téléphonez-nous au ' + TEL + '.'
	};
	var MSG_RESEAU = 'Connexion impossible. Vérifiez votre réseau et réessayez, ou téléphonez-nous au ' + TEL + '.';
	var MSG_AUTRE = 'Une erreur est survenue. Réessayez dans un instant, ou téléphonez-nous au ' + TEL + '.';
	var MSG_ANCIEN = 'Votre navigateur est trop ancien pour envoyer l\'inscription. Téléphonez-nous au ' + TEL + '.';

	function $(id) { return document.getElementById(id); }

	var form = $('avis-form');
	var bouton = $('avis-envoi');
	var alerte = $('avis-alerte');
	var merci = $('avis-merci');
	if (!form || !bouton) { return; }

	var champ = {
		nom: $('avis-nom'),
		cellulaire: $('avis-cellulaire'),
		adresse: $('avis-adresse'),
		courriel: $('avis-courriel'),
		accepte: $('avis-accepte'),
		promo: $('avis-promo')
	};
	var TEXTE_BOUTON = bouton.textContent;
	var enCours = false;

	// ---------- Vérifications (les mêmes règles que la base : la base a toujours le dernier mot) ----------
	function chiffres(t) { return String(t || '').replace(/[^0-9]/g, ''); }
	function cellulaireValide(t) { return /^1?[2-9][0-9]{2}[2-9][0-9]{6}$/.test(chiffres(t)); }
	function courrielValide(t) { return t.length <= 150 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t); }

	function lire() {
		return {
			nom: champ.nom.value.replace(/^\s+|\s+$/g, ''),
			cellulaire: champ.cellulaire.value.replace(/^\s+|\s+$/g, ''),
			adresse: champ.adresse.value.replace(/^\s+|\s+$/g, ''),
			courriel: champ.courriel.value.replace(/^\s+|\s+$/g, ''),
			accepte: champ.accepte.checked === true,
			promo: champ.promo.checked === true,
			version: $('avis-version').value,
			versionPromo: $('avis-version-promo').value,
			piege: $('avis-site-web').value
		};
	}

	function verifier(v) {
		var e = {};
		if (v.nom.length < 2 || v.nom.length > 100) { e.nom = MSG_CHAMP.nom; }
		if (!cellulaireValide(v.cellulaire)) { e.cellulaire = MSG_CHAMP.cellulaire; }
		if (v.adresse.length < 5 || v.adresse.length > 200) { e.adresse = MSG_CHAMP.adresse; }
		if (v.courriel !== '' && !courrielValide(v.courriel)) { e.courriel = MSG_CHAMP.courriel; }
		else if (v.promo && v.courriel === '') { e.courriel = MSG_OFFRES; }
		if (!v.accepte) { e.accepte = MSG_CHAMP.accepte; }
		return e;
	}

	// ---------- Affichage des erreurs ----------
	function marquer(cle, invalide) {
		var el = champ[cle];
		var cible = cle === 'accepte' ? el.parentNode : el;
		var classe = 'av-invalide';
		if (invalide) { cible.classList.add(classe); el.setAttribute('aria-invalid', 'true'); }
		else { cible.classList.remove(classe); el.removeAttribute('aria-invalid'); }
	}

	function montrerErreur(cle, message) {
		var zone = $('avis-err-' + cle);
		zone.textContent = message;
		zone.hidden = false;
		marquer(cle, true);
	}

	function effacerErreur(cle) {
		var zone = $('avis-err-' + cle);
		zone.textContent = '';
		zone.hidden = true;
		marquer(cle, false);
	}

	function montrerAlerte(html) {
		alerte.innerHTML = html;
		alerte.hidden = false;
	}

	function effacerTout() {
		CHAMPS.forEach(effacerErreur);
		alerte.innerHTML = '';
		alerte.hidden = true;
	}

	function premierEnErreur(erreurs) {
		for (var i = 0; i < CHAMPS.length; i++) { if (erreurs[CHAMPS[i]]) { return CHAMPS[i]; } }
		return null;
	}

	// ---------- Envoi ----------
	function fini() {
		enCours = false;
		bouton.disabled = false;
		bouton.textContent = TEXTE_BOUTON;
	}

	function succes(avecOffres) {
		// on ne garde rien de la personne dans la page une fois l'inscription reçue
		champ.promo.checked = false;
		champ.promo.parentNode.classList.remove('av-coche');
		$('avis-merci-promo').hidden = !avecOffres;
		CHAMPS.forEach(function (cle) { if (cle === 'accepte') { champ.accepte.checked = false; } else { champ[cle].value = ''; } });
		champ.accepte.parentNode.classList.remove('av-coche');
		form.hidden = true;
		merci.hidden = false;
		if (merci.focus) { merci.focus(); }
		if (merci.scrollIntoView) { merci.scrollIntoView(); }
	}

	function echec(texte) {
		var code = '';
		try { code = String(JSON.parse(texte).message || ''); } catch (e) { code = ''; }
		if (CODE_CHAMP[code]) {
			var cle = CODE_CHAMP[code];
			montrerErreur(cle, MSG_CODE[code] || MSG_CHAMP[cle]);
			if (champ[cle].focus) { champ[cle].focus(); }
		} else if (CODE_ALERTE[code]) {
			montrerAlerte(CODE_ALERTE[code]);
		} else {
			montrerAlerte(MSG_AUTRE);
		}
	}

	function envoyer(v) {
		if (typeof fetch !== 'function') { montrerAlerte(MSG_ANCIEN); return; }
		enCours = true;
		bouton.disabled = true;
		bouton.textContent = 'Envoi en cours…';

		var controle = typeof AbortController === 'function' ? new AbortController() : null;
		var minuterie = controle ? setTimeout(function () { controle.abort(); }, DELAI_MAX_MS) : null;
		var options = {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY },
			body: JSON.stringify({
				p_nom: v.nom,
				p_adresse: v.adresse,
				p_cellulaire: v.cellulaire,
				p_courriel: v.courriel === '' ? null : v.courriel,
				p_accepte: true,
				p_version: v.version,
				p_site_web: v.piege,
				p_agent: String(navigator.userAgent || '').slice(0, 300),
				p_promo: v.promo,
				p_version_promo: v.promo ? v.versionPromo : null
			})
		};
		if (controle) { options.signal = controle.signal; }

		fetch(SUPA_URL + '/rest/v1/rpc/inscrire_avis', options)
			.then(function (rep) { return rep.text().then(function (texte) { return { ok: rep.ok, texte: texte }; }); })
			.then(function (r) {
				if (minuterie) { clearTimeout(minuterie); }
				fini();
				var statut = '';
				if (r.ok) { try { statut = String(JSON.parse(r.texte).statut || ''); } catch (e) { statut = ''; } }
				if (r.ok && statut === 'enregistree') { succes(v.promo); } else { echec(r.texte); }
			})
			.catch(function () {
				if (minuterie) { clearTimeout(minuterie); }
				fini();
				montrerAlerte(MSG_RESEAU);
			});
	}

	form.addEventListener('submit', function (ev) {
		ev.preventDefault();
		if (enCours) { return; }
		effacerTout();
		var v = lire();
		var erreurs = verifier(v);
		var premier = premierEnErreur(erreurs);
		if (premier) {
			CHAMPS.forEach(function (cle) { if (erreurs[cle]) { montrerErreur(cle, erreurs[cle]); } });
			if (champ[premier].focus) { champ[premier].focus(); }
			return;
		}
		envoyer(v);
	});

	// Une erreur disparaît dès que la personne corrige le champ ; la case cochée prend sa couleur
	CHAMPS.forEach(function (cle) {
		var evenement = cle === 'accepte' ? 'change' : 'input';
		champ[cle].addEventListener(evenement, function () {
			effacerErreur(cle);
			if (cle === 'accepte') {
				if (champ.accepte.checked) { champ.accepte.parentNode.classList.add('av-coche'); }
				else { champ.accepte.parentNode.classList.remove('av-coche'); }
			}
		});
	});

	champ.promo.addEventListener('change', function () {
		if (champ.promo.checked) { champ.promo.parentNode.classList.add('av-coche'); }
		else { champ.promo.parentNode.classList.remove('av-coche'); }
		if (!champ.promo.checked && $('avis-err-courriel').textContent === MSG_OFFRES) { effacerErreur('courriel'); }
	});

	bouton.disabled = false;
})();
