/*
 * AETHRYON pour Premiere Pro v2 — script hôte ExtendScript (chargé par le manifeste, <ScriptPath>).
 *
 * Règles de sûreté (audit phase 1, F3) :
 *   - le panneau n'appelle QUE AETHRYON.appel("<nom>", "<charge>") ; <nom> est comparé à une liste fermée ;
 *   - <charge> est du JSON encodé par encodeURIComponent (aucun guillemet ni retour à la ligne possible) ; il est lu
 *     par l'analyseur JSON ci-dessous, sans eval ;
 *   - aucun code reçu n'est jamais exécuté, aucun fichier de script n'est chargé à distance ($.evalFile absent).
 * ExtendScript = ECMAScript 3 : ni JSON, ni Array.indexOf, ni let/const.
 * NON TESTÉ DANS PREMIERE : exercé seulement contre un faux modèle de projet (tests/unit/jsx.test.ts).
 */
var AETHRYON = (function () {
    var VERSION = "2.0.0";
    var NOM_CHUTIER = "AETHRYON";
    var BUDGET = 20000; // éléments parcourus au plus dans un projet

    // ---- JSON minimal (sans eval) ------------------------------------------------------------------------------------
    function estTableau(v) {
        return Object.prototype.toString.call(v) === "[object Array]";
    }

    function echapper(s) {
        var r = "", i, c, h;
        for (i = 0; i < s.length; i++) {
            c = s.charAt(i);
            h = s.charCodeAt(i);
            if (c === "\"") r += "\\\"";
            else if (c === "\\") r += "\\\\";
            else if (c === "\n") r += "\\n";
            else if (c === "\r") r += "\\r";
            else if (c === "\t") r += "\\t";
            else if (h < 32 || h === 0x2028 || h === 0x2029) r += "\\u" + ("0000" + h.toString(16)).slice(-4);
            else r += c;
        }
        return "\"" + r + "\"";
    }

    function versJson(v) {
        var i, k, parties;
        if (v === null || v === undefined) return "null";
        if (typeof v === "boolean") return v ? "true" : "false";
        if (typeof v === "number") return isFinite(v) ? String(v) : "null";
        if (typeof v === "string") return echapper(v);
        if (estTableau(v)) {
            parties = [];
            for (i = 0; i < v.length; i++) parties.push(versJson(v[i]));
            return "[" + parties.join(",") + "]";
        }
        parties = [];
        for (k in v) {
            if (v.hasOwnProperty(k) && typeof v[k] !== "function") parties.push(echapper(k) + ":" + versJson(v[k]));
        }
        return "{" + parties.join(",") + "}";
    }

    function lireJson(texte) {
        var i = 0;
        function blanc() {
            while (i < texte.length) {
                var c = texte.charAt(i);
                if (c === " " || c === "\n" || c === "\r" || c === "\t") i++;
                else break;
            }
        }
        function erreur(m) { throw new Error("JSON invalide : " + m + " (position " + i + ")"); }
        function valeur() {
            blanc();
            var c = texte.charAt(i);
            if (c === "{") return objet();
            if (c === "[") return tableau();
            if (c === "\"") return chaine();
            if (c === "t" && texte.substr(i, 4) === "true") { i += 4; return true; }
            if (c === "f" && texte.substr(i, 5) === "false") { i += 5; return false; }
            if (c === "n" && texte.substr(i, 4) === "null") { i += 4; return null; }
            return nombre();
        }
        function objet() {
            var o = {}, cle;
            i++;
            blanc();
            if (texte.charAt(i) === "}") { i++; return o; }
            while (true) {
                blanc();
                if (texte.charAt(i) !== "\"") erreur("clé attendue");
                cle = chaine();
                blanc();
                if (texte.charAt(i) !== ":") erreur("« : » attendu");
                i++;
                o[cle] = valeur();
                blanc();
                if (texte.charAt(i) === ",") { i++; continue; }
                if (texte.charAt(i) === "}") { i++; return o; }
                erreur("« , » ou « } » attendu");
            }
        }
        function tableau() {
            var t = [];
            i++;
            blanc();
            if (texte.charAt(i) === "]") { i++; return t; }
            while (true) {
                t.push(valeur());
                blanc();
                if (texte.charAt(i) === ",") { i++; continue; }
                if (texte.charAt(i) === "]") { i++; return t; }
                erreur("« , » ou « ] » attendu");
            }
        }
        function chaine() {
            var r = "", c, h;
            i++;
            while (i < texte.length) {
                c = texte.charAt(i++);
                if (c === "\"") return r;
                if (c === "\\") {
                    c = texte.charAt(i++);
                    if (c === "n") r += "\n";
                    else if (c === "r") r += "\r";
                    else if (c === "t") r += "\t";
                    else if (c === "b") r += "\b";
                    else if (c === "f") r += "\f";
                    else if (c === "u") {
                        h = texte.substr(i, 4);
                        if (!/^[0-9a-fA-F]{4}$/.test(h)) erreur("échappement \\u");
                        r += String.fromCharCode(parseInt(h, 16));
                        i += 4;
                    } else r += c;
                } else r += c;
            }
            erreur("chaîne non fermée");
        }
        function nombre() {
            var m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(texte.substr(i, 40));
            if (!m) erreur("valeur inattendue");
            i += m[0].length;
            return parseFloat(m[0]);
        }
        var v = valeur();
        blanc();
        if (i !== texte.length) erreur("contenu après la valeur");
        return v;
    }

    // ---- Projet ----------------------------------------------------------------------------------------------------------
    function normaliser(chemin) {
        return String(chemin || "").replace(/\//g, "\\").toLowerCase();
    }

    function projetOuvert() {
        try {
            return app && app.project && app.project.rootItem ? app.project : null;
        } catch (e) {
            return null;
        }
    }

    function estChutier(item) {
        return item && item.type === ProjectItemType.BIN;
    }

    function cheminDe(item) {
        try {
            if (item && typeof item.getMediaPath === "function") return item.getMediaPath() || "";
        } catch (e) { /* élément sans média (séquence, chutier) */ }
        return "";
    }

    /** Parcourt le projet (profondeur d'abord) ; f(item) renvoie true pour arrêter. */
    function parcourir(racine, f) {
        var pile = [racine], vus = 0, item, enfants, i;
        while (pile.length && vus < BUDGET) {
            item = pile.pop();
            vus++;
            if (item !== racine && f(item)) return true;
            enfants = item.children;
            if (enfants && enfants.numItems) {
                for (i = enfants.numItems - 1; i >= 0; i--) pile.push(enfants[i]);
            }
        }
        return false;
    }

    function elementPourChemin(racine, chemin) {
        var cible = normaliser(chemin), trouve = null;
        parcourir(racine, function (item) {
            if (!estChutier(item) && normaliser(cheminDe(item)) === cible) { trouve = item; return true; }
            return false;
        });
        return trouve;
    }

    function chutierAethryon(projet) {
        var enfants = projet.rootItem.children, i;
        for (i = 0; i < enfants.numItems; i++) {
            if (estChutier(enfants[i]) && enfants[i].name === NOM_CHUTIER) return { chutier: enfants[i], cree: false };
        }
        var nouveau = projet.rootItem.createBin(NOM_CHUTIER);
        if (!nouveau) {
            // Premiere ancien : createBin ne renvoie rien, on relit la racine.
            for (i = 0; i < enfants.numItems; i++) {
                if (estChutier(enfants[i]) && enfants[i].name === NOM_CHUTIER) nouveau = enfants[i];
            }
        }
        if (!nouveau) throw new Error("le chutier « AETHRYON » n'a pas pu être créé");
        return { chutier: nouveau, cree: true };
    }

    function chutierPour(projet, mode) {
        if (mode === "racine") return { chutier: projet.rootItem, nom: "Racine du projet", note: "" };
        if (mode === "selection") {
            try {
                if (typeof projet.getInsertionBin === "function") {
                    var b = projet.getInsertionBin();
                    if (b && b.type === ProjectItemType.ROOT) return { chutier: projet.rootItem, nom: "Racine du projet", note: "" };
                    if (b && estChutier(b)) return { chutier: b, nom: b.name, note: "" };
                }
            } catch (e) { /* repli ci-dessous */ }
            var r = chutierAethryon(projet);
            return { chutier: r.chutier, nom: NOM_CHUTIER, note: "aucun chutier sélectionné : import dans « AETHRYON »" };
        }
        var a = chutierAethryon(projet);
        return { chutier: a.chutier, nom: NOM_CHUTIER, note: a.cree ? "chutier « AETHRYON » créé" : "" };
    }

    function nomProjet(projet) {
        return String(projet.name || "").replace(/\.prproj$/i, "");
    }

    // ---- Fonctions appelables (liste fermée) ------------------------------------------------------------------------------
    var F = {};

    F.ping = function () {
        return { ok: true, version: VERSION, premiere: String(app.version || ""), extendscript: String($.version || "") };
    };

    F.projet = function () {
        var p = projetOuvert();
        if (!p) return { ok: true, projet: null };
        var sel = null, seq = null;
        try {
            if (typeof p.getInsertionBin === "function") {
                var b = p.getInsertionBin();
                if (b && estChutier(b)) sel = b.name;
            }
        } catch (e) { /* facultatif */ }
        try {
            if (p.activeSequence) seq = p.activeSequence.name;
        } catch (e2) { /* facultatif */ }
        return { ok: true, projet: { nom: nomProjet(p), chemin: String(p.path || "") || null, chutierSelectionne: sel, sequenceActive: seq } };
    };

    F.importer = function (a) {
        var p = projetOuvert(), i, chemin, item, resultats = [], aImporter = [], cible, okImport;
        if (!p) return { ok: false, code: "aucunProjet", resultats: [] };
        var chemins = a && estTableau(a.chemins) ? a.chemins : [];
        if (!chemins.length || chemins.length > 200) return { ok: false, code: "arguments", resultats: [] };
        for (i = 0; i < chemins.length; i++) {
            chemin = String(chemins[i]);
            if (!new File(chemin).exists) { resultats.push({ chemin: chemin, ok: false, code: "introuvable" }); continue; }
            item = elementPourChemin(p.rootItem, chemin);
            if (item) { resultats.push({ chemin: chemin, ok: true, deja: true, horsLigne: estHorsLigne(item) }); continue; }
            aImporter.push(chemin);
        }
        cible = { chutier: null, nom: null, note: "" };
        if (aImporter.length) {
            cible = chutierPour(p, a.mode);
            try {
                okImport = p.importFiles(aImporter, true, cible.chutier, false);
            } catch (e) {
                for (i = 0; i < aImporter.length; i++) resultats.push({ chemin: aImporter[i], ok: false, code: "exception", detail: String(e) });
                return { ok: false, chutier: cible.nom, projet: nomProjet(p), note: cible.note, resultats: resultats };
            }
            // Vérification réelle : chaque chemin doit maintenant se trouver dans le projet.
            for (i = 0; i < aImporter.length; i++) {
                item = elementPourChemin(cible.chutier, aImporter[i]) || elementPourChemin(p.rootItem, aImporter[i]);
                if (item) resultats.push({ chemin: aImporter[i], ok: true, horsLigne: estHorsLigne(item) });
                else resultats.push({ chemin: aImporter[i], ok: false, code: "absentApres", detail: okImport === false ? "importFiles a renvoyé false" : "" });
            }
        }
        var tous = true;
        for (i = 0; i < resultats.length; i++) if (!resultats[i].ok) tous = false;
        return { ok: tous, chutier: cible.nom, projet: nomProjet(p), note: cible.note, resultats: resultats };
    };

    function estHorsLigne(item) {
        try {
            return typeof item.isOffline === "function" ? !!item.isOffline() : false;
        } catch (e) {
            return false;
        }
    }

    F.presentsDansProjet = function (a) {
        var p = projetOuvert(), presents = [], vus = {}, i, cibles = {};
        if (!p) return { ok: true, presents: [] };
        var chemins = a && estTableau(a.chemins) ? a.chemins : [];
        for (i = 0; i < chemins.length; i++) cibles[normaliser(chemins[i])] = String(chemins[i]);
        parcourir(p.rootItem, function (item) {
            if (estChutier(item)) return false;
            var n = normaliser(cheminDe(item));
            if (n && cibles.hasOwnProperty(n) && !vus[n]) { vus[n] = true; presents.push(cibles[n]); }
            return false;
        });
        return { ok: true, presents: presents };
    };

    F.presentsDansSequence = function (a) {
        var p = projetOuvert(), presents = [], vus = {}, cibles = {}, i, t, c, pistes, piste, clip, n;
        if (!p || !p.activeSequence) return { ok: true, presents: [], sequence: null };
        var chemins = a && estTableau(a.chemins) ? a.chemins : [];
        for (i = 0; i < chemins.length; i++) cibles[normaliser(chemins[i])] = String(chemins[i]);
        var seq = p.activeSequence;
        var groupes = [seq.videoTracks, seq.audioTracks];
        for (t = 0; t < groupes.length; t++) {
            pistes = groupes[t];
            if (!pistes) continue;
            for (i = 0; i < pistes.numTracks; i++) {
                piste = pistes[i];
                for (c = 0; piste && piste.clips && c < piste.clips.numItems; c++) {
                    clip = piste.clips[c];
                    n = clip && clip.projectItem ? normaliser(cheminDe(clip.projectItem)) : "";
                    if (n && cibles.hasOwnProperty(n) && !vus[n]) { vus[n] = true; presents.push(cibles[n]); }
                }
            }
        }
        return { ok: true, presents: presents, sequence: seq.name };
    };

    F.insererTeteLecture = function (a) {
        var p = projetOuvert();
        if (!p) return { ok: false, message: "Aucun projet ouvert." };
        var seq = p.activeSequence;
        if (!seq) return { ok: false, message: "Aucune séquence active : ouvre une séquence dans la timeline." };
        var chemin = String(a.chemin || "");
        if (!new File(chemin).exists) return { ok: false, message: "Fichier introuvable." };
        var item = elementPourChemin(p.rootItem, chemin);
        if (!item) {
            var cible = chutierPour(p, a.mode);
            p.importFiles([chemin], true, cible.chutier, false);
            item = elementPourChemin(p.rootItem, chemin);
            if (!item) return { ok: false, message: "Premiere n'a pas importé le fichier." };
        }
        var position = seq.getPlayerPosition();
        var audioSeul = /\.(mp3|wav|aac|m4a)$/i.test(chemin);
        var pistes = audioSeul ? seq.audioTracks : seq.videoTracks;
        if (!pistes || !pistes.numTracks) return { ok: false, message: "La séquence n'a pas de piste " + (audioSeul ? "audio." : "vidéo.") };
        var piste = pistes[0];
        try {
            if (typeof piste.isLocked === "function" && piste.isLocked()) return { ok: false, message: "La première piste est verrouillée." };
        } catch (e) { /* facultatif */ }
        var avant = piste.clips ? piste.clips.numItems : 0;
        piste.insertClip(item, position.seconds);
        var apres = piste.clips ? piste.clips.numItems : 0;
        if (apres <= avant) {
            // Certaines versions n'acceptent que l'objet Time : second essai, toujours sur clic explicite.
            try { piste.insertClip(item, position); } catch (e3) { /* message ci-dessous */ }
            apres = piste.clips ? piste.clips.numItems : 0;
        }
        if (apres <= avant) return { ok: false, message: "Premiere n'a pas inséré le clip." };
        return { ok: true, message: "Inséré à " + position.seconds.toFixed(2) + " s dans « " + seq.name + " »." };
    };

    F.ouvrirMoniteurSource = function (a) {
        var chemin = String(a.chemin || "");
        if (!new File(chemin).exists) return { ok: false, message: "Fichier introuvable." };
        if (!app.sourceMonitor || typeof app.sourceMonitor.openFilePath !== "function") return { ok: false, message: "Moniteur source indisponible dans cette version." };
        var ok = app.sourceMonitor.openFilePath(chemin);
        return { ok: ok !== false };
    };

    F.essaiImport = function (a) {
        var p = projetOuvert(), debut = new Date().getTime();
        if (!p) return { ok: false, message: "Aucun projet ouvert : ouvre ou crée un projet pour cet essai." };
        var chemin = String(a.chemin || "");
        if (!new File(chemin).exists) return { ok: false, message: "Fichier d'essai introuvable." };
        var nom = "AETHRYON · diagnostic " + debut;
        var chutier = p.rootItem.createBin(nom), i, enfants;
        if (!chutier) {
            enfants = p.rootItem.children;
            for (i = 0; i < enfants.numItems; i++) if (estChutier(enfants[i]) && enfants[i].name === nom) chutier = enfants[i];
        }
        if (!chutier) return { ok: false, message: "Chutier temporaire impossible à créer." };
        var importe = false, nettoye = false, detail = "";
        try {
            p.importFiles([chemin], true, chutier, false);
            importe = !!elementPourChemin(chutier, chemin);
            if (!importe) detail = "importFiles n'a rien ajouté au chutier temporaire";
        } catch (e) {
            detail = String(e);
        }
        try {
            chutier.deleteBin();
            nettoye = true;
            enfants = p.rootItem.children;
            for (i = 0; i < enfants.numItems; i++) if (estChutier(enfants[i]) && enfants[i].name === nom) nettoye = false;
        } catch (e2) {
            detail += (detail ? " ; " : "") + "nettoyage : " + String(e2);
        }
        return { ok: importe && nettoye, importe: importe, nettoye: nettoye, chutierTemporaire: nom, dureeMs: new Date().getTime() - debut, detail: detail };
    };

    var LISTE = { ping: 1, projet: 1, importer: 1, presentsDansProjet: 1, presentsDansSequence: 1, insererTeteLecture: 1, ouvrirMoniteurSource: 1, essaiImport: 1 };

    return {
        /** Seul point d'entrée du panneau. Renvoie toujours une chaîne JSON. */
        appel: function (nom, charge) {
            try {
                if (typeof nom !== "string" || !LISTE.hasOwnProperty(nom)) return versJson({ ok: false, code: "refuse", message: "Fonction inconnue." });
                if (typeof charge !== "string" || charge.length > 200000 || /[^A-Za-z0-9\-_.!~*'()%]/.test(charge)) {
                    return versJson({ ok: false, code: "charge", message: "Arguments refusés." });
                }
                var args = charge ? lireJson(decodeURIComponent(charge)) : {};
                return versJson(F[nom](args || {}));
            } catch (e) {
                return versJson({ ok: false, code: "exception", message: String(e && e.message ? e.message : e) });
            }
        },
        _json: { versJson: versJson, lireJson: lireJson }
    };
}());
