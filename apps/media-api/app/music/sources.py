"""Sources that EXPLICITLY allow the download: Internet Archive and Wikimedia Commons (free licence or public domain,
read from their official APIs and recorded with the file), podcast feeds (RSS enclosures, published by the show for
download), direct audio files (the user declares his rights). The download URL always comes from the source's own
answer, re-read by the server at import time (never from the client)."""

from __future__ import annotations

import asyncio
import hashlib
import re
import xml.etree.ElementTree as ET
from typing import Any
from urllib.parse import SplitResult, quote, unquote, urlencode, urlsplit

from ..errors import ApiError
from . import licences
from .base import (Connector, Ctx, ImportPlan, Ref, https_or_none, invalid_link, not_found, number, seconds, text,
                   unavailable)
from .model import (ACTION_ENREGISTRER, AUDIO_TYPES, MIME_TO_EXT, Fiche, Fichier, Identifiant, InfoConnecteur, Piste,
                    action_importer, action_lecteur, action_ouvrir, ext_of)
from .web import ANY_PUBLIC, HostPolicy, check_url

FREE_ONLY = ("Téléchargement proposé seulement pour une licence libre ou le domaine public (CC0, Public Domain Mark, "
             "CC BY, CC BY-SA), lue dans les métadonnées officielles et enregistrée avec le fichier.")

# --------------------------------------------------------------------------------------------------------------------

ARCHIVE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
ARCHIVE_API = HostPolicy.api("archive.org", label="Internet Archive (API)")
# Downloads: archive.org/download/… redirects to the item's storage server (iaNNNNNN.us.archive.org).
ARCHIVE_FILES = HostPolicy.api("archive.org", suffixes=(".archive.org",), label="Internet Archive (fichiers)")
# Lending library / restricted collections, and the Great 78 Project (78 rpm transfers, subject of a 2023 lawsuit by
# record labels): never downloaded, whatever their metadata says.
ARCHIVE_REFUSED_COLLECTIONS = {"inlibrary", "printdisabled", "lendinglibrary", "georgeblood"}


def _as_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(v) for v in value if v]
    return [str(value)] if value else []


class InternetArchive(Connector):
    id = "archive"
    nom = "Internet Archive"
    famille = "source_libre"
    conditions = ["https://archive.org/developers/md-read.html", "https://archive.org/about/terms.php"]

    def recognizes(self, host: str) -> bool:
        return host in ("archive.org", "www.archive.org")

    def parse(self, url: str, parts: SplitResult) -> Ref:
        segs = [unquote(s) for s in parts.path.split("/") if s]
        if len(segs) < 2 or segs[0] not in ("details", "download", "embed") or not ARCHIVE_ID.match(segs[1]):
            raise invalid_link("Lien Internet Archive invalide : archive.org/details/<identifiant> attendu.")
        extra = (("fichier", "/".join(segs[2:])[:300]),) if len(segs) > 2 else ()
        return Ref("archive", "element", segs[1], f"https://archive.org/details/{segs[1]}", extra)

    def info(self) -> InfoConnecteur:
        caps = ["Metadata", "Search", "Playback", "AuthorizedDownload", "Import"]
        return InfoConnecteur(self.id, self.nom, "source_libre", True, caps, caps, [],
                              [FREE_ONLY, "Licence déclarée par la personne qui a déposé l'élément : AETHRYON la "
                                          "recopie telle quelle avec le fichier (et son lien).",
                               "Éléments en prêt ou à accès restreint, Great 78 Project : jamais téléchargés.",
                               "Empreinte MD5 publiée par l'Internet Archive vérifiée après chaque téléchargement."],
                              self.conditions)

    async def _metadata(self, ident: str) -> dict[str, Any]:
        status, data = await self.ctx.json("archive", 60, f"https://archive.org/metadata/{quote(ident)}", ARCHIVE_API,
                                           max_bytes=8 * 1024 * 1024, deadline_s=15.0)
        if status != 200 or not isinstance(data, dict):
            raise unavailable("Internet Archive", status)
        if not data or "metadata" not in data:  # the API answers {} for an unknown identifier
            raise not_found("Internet Archive")
        return data

    def _fiche(self, ref: Ref, data: dict[str, Any]) -> Fiche:
        md = data.get("metadata") or {}
        fiche = Fiche("archive", "element", ref.id, ref.url)
        fiche.source_metadonnees = "archive"
        fiche.titre = text(md.get("title"))
        fiche.artistes = [a for a in (text(c, 200) for c in _as_list(md.get("creator"))) if a][:10]
        fiche.date = text(md.get("date") or md.get("year"), 20)
        fiche.pochette = f"https://archive.org/services/img/{quote(ref.id)}"
        lic = licences.from_url(md.get("licenseurl"))
        fiche.licence = lic
        collections = {c.lower() for c in _as_list(md.get("collection"))}
        restricted = (str(md.get("access-restricted-item", "")).lower() == "true" or bool(data.get("is_dark"))
                      or bool(collections & ARCHIVE_REFUSED_COLLECTIONS))
        files = data.get("files") or []
        groups: dict[str, Piste] = {}
        for f in files if isinstance(files, list) else []:
            if not isinstance(f, dict) or str(f.get("private", "")).lower() == "true":
                continue
            name = str(f.get("name") or "")
            ext = ext_of(name)
            if not ext or name.count("/") > 3 or len(name) > 300:
                continue
            base = name.rsplit(".", 1)[0]
            piste = groups.get(base)
            if piste is None:
                piste = groups[base] = Piste(text(f.get("title")) or text(base.rsplit("/", 1)[-1]),
                                             [a for a in [text(f.get("creator") or f.get("artist"), 200)] if a],
                                             text(f.get("album")), seconds(f.get("length")), None,
                                             int(number(str(f.get("track", "")).split("/")[0]) or 0) or None,
                                             f"https://archive.org/details/{ref.id}/{quote(name)}", base)
            md5 = str(f.get("md5") or "").lower()
            piste.fichiers.append(Fichier(
                nom=name.rsplit("/", 1)[-1], url=f"https://archive.org/download/{quote(ref.id)}/{quote(name)}",
                extension=ext, type_mime=AUDIO_TYPES[ext][0], taille=int(number(f.get("size")) or 0) or None,
                format=text(f.get("format"), 60), duree_s=seconds(f.get("length")),
                md5=md5 if re.fullmatch(r"[0-9a-f]{32}", md5) else None,
                original=str(f.get("source", "")).lower() == "original"))
            if piste.duree_s is None:
                piste.duree_s = seconds(f.get("length"))
        fiche.pistes = sorted(groups.values(), key=lambda p: (p.numero or 10_000, p.id or ""))[:300]
        fiche.pistes_total = len(groups)
        fiche.capacites = ["Metadata", "Search"]
        fiche.actions = [action_ouvrir("sur Internet Archive", ref.url),
                         action_lecteur("Internet Archive", f"https://archive.org/embed/{quote(ref.id)}", 400),
                         dict(ACTION_ENREGISTRER)]
        fiche.capacites.append("Playback")
        creator = ", ".join(fiche.artistes) or "auteur inconnu"
        fiche.attribution = f"« {fiche.titre or ref.id} » par {creator}, {lic.nom}" + \
                            (f" ({lic.url})" if lic.url else "") + f", via Internet Archive ({ref.url})"
        if not fiche.pistes:
            fiche.manque.append("Aucun fichier audio importable dans cet élément (MP3, Ogg, FLAC, WAV, M4A).")
        elif restricted:
            fiche.restrictions.append("Élément à accès restreint (prêt, collection protégée) : pas de téléchargement.")
        elif not lic.libre:
            fiche.restrictions.append(f"Licence « {lic.nom} » : pas de téléchargement. " + FREE_ONLY)
        else:
            fiche.capacites += ["AuthorizedDownload", "Import"]
            for p in fiche.pistes:
                best = _best_file(p.fichiers)
                if best:
                    p.fichiers.sort(key=lambda f: f is not best)
            first = fiche.pistes[0]
            fiche.actions.append(action_importer({"url": ref.url, "fichier": _best_file(first.fichiers).nom
                                                  if len(fiche.pistes) == 1 else "<nom d'un fichier de « pistes »>"}))
            if lic.attribution_requise:
                fiche.restrictions.append(f"Licence {lic.nom} : citer l'auteur et la licence en cas de "
                                          "réutilisation (attribution enregistrée avec le fichier).")
        return fiche

    async def analyse(self, ref: Ref) -> Fiche:
        return self._fiche(ref, await self._metadata(ref.id))

    async def plan_import(self, ref: Ref, body: dict[str, Any]) -> ImportPlan:
        fiche = self._fiche(ref, await self._metadata(ref.id))
        if "AuthorizedDownload" not in fiche.capacites:
            raise ApiError(403, "telechargement_non_autorise", " ".join(fiche.restrictions or fiche.manque)
                           or "Téléchargement non autorisé pour cet élément.")
        wanted = str(body.get("fichier") or ref.get("fichier") or "").strip()
        candidates = [(p, f) for p in fiche.pistes for f in p.fichiers]
        if wanted:
            pick = next(((p, f) for p, f in candidates if f.nom == wanted.rsplit("/", 1)[-1]
                         or f.url.endswith("/" + quote(wanted))), None)
            if pick is None:
                raise ApiError(404, "fichier_introuvable", "Ce fichier n'est pas un fichier audio de cet élément.")
        elif len(fiche.pistes) == 1:
            pick = (fiche.pistes[0], _best_file(fiche.pistes[0].fichiers))
        else:
            raise ApiError(400, "fichier_requis", "Cet élément contient plusieurs pistes : choisis un fichier "
                                                  "(champ « fichier », voir « pistes » de la fiche).")
        piste, fichier = pick
        assert fiche.licence is not None
        return ImportPlan("archive", fichier, ARCHIVE_FILES, fiche.licence, piste.titre or fiche.titre or ref.id,
                          piste.artistes or fiche.artistes, piste.album or fiche.titre, fiche.date, fiche.attribution,
                          ref.url, fiche.pochette)

    async def search(self, q: str) -> list[Fiche]:
        words = " ".join(re.findall(r"[\w'-]{1,40}", q, re.UNICODE)[:8])
        if not words:
            raise ApiError(400, "recherche_vide", "Recherche vide.")
        # Lucene: "/" must be escaped. Pre-filter only: the licence is read again at the analysis of the element.
        lic = r"(licenseurl:*publicdomain* OR licenseurl:*licenses\/by\/* OR licenseurl:*licenses\/by-sa\/*)"
        audio = '(format:("VBR MP3" OR "Ogg Vorbis" OR "Flac" OR "128Kbps MP3" OR "64Kbps MP3"))'  # importable files
        query = urlencode([("q", f"({words}) AND mediatype:(audio) AND {lic} AND {audio}"), ("fl[]", "identifier"),
                           ("fl[]", "title"), ("fl[]", "creator"), ("fl[]", "licenseurl"), ("rows", "10"),
                           ("output", "json")])
        status, data = await self.ctx.json("archive", 60, f"https://archive.org/advancedsearch.php?{query}", ARCHIVE_API)
        if status != 200 or not isinstance(data, dict):
            raise unavailable("Internet Archive", status)
        out = []
        for d in ((data.get("response") or {}).get("docs") or [])[:10]:
            ident = str(d.get("identifier") or "")
            if ARCHIVE_ID.match(ident):
                f = Fiche("archive", "element", ident, f"https://archive.org/details/{ident}")
                f.source_metadonnees = "archive"
                f.titre = text(d.get("title"))
                f.artistes = [a for a in (text(c, 200) for c in _as_list(d.get("creator"))) if a][:5]
                f.licence = licences.from_url(d.get("licenseurl"))
                f.capacites = ["Metadata", "Search", "Playback"]
                f.actions = [action_ouvrir("sur Internet Archive", f.url)]
                f.manque.append("Fichiers et droits vérifiés à l'analyse de l'élément (POST /music/analyser).")
                out.append(f)
        return out


def _best_file(files: list[Fichier]) -> Fichier | None:
    """Original audio first (best quality), then a VBR MP3, then anything."""
    if not files:
        return None
    return sorted(files, key=lambda f: (not f.original, f.extension != "mp3", -(f.taille or 0)))[0]


# --------------------------------------------------------------------------------------------------------------------

COMMONS_API = HostPolicy.api("commons.wikimedia.org", label="Wikimedia Commons (API)")
COMMONS_FILES = HostPolicy.api("upload.wikimedia.org", label="Wikimedia Commons (fichiers)")


class Commons(Connector):
    id = "commons"
    nom = "Wikimedia Commons"
    famille = "source_libre"
    conditions = ["https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia",
                  "https://foundation.wikimedia.org/wiki/Policy:User-Agent_policy"]

    def recognizes(self, host: str) -> bool:
        return host in ("commons.wikimedia.org", "commons.m.wikimedia.org", "upload.wikimedia.org")

    def parse(self, url: str, parts: SplitResult) -> Ref:
        host = (parts.hostname or "").lower()
        path = unquote(parts.path)
        name = None
        if host == "upload.wikimedia.org":
            m = re.fullmatch(r"/wikipedia/commons/(?:transcoded/)?[0-9a-f]/[0-9a-f]{2}/([^/]+?)(?:/[^/]+)?", path)
            name = m.group(1) if m else None
        else:
            m = re.fullmatch(r"/wiki/(?:File|Fichier|Datei|Archivo):(.+)", path)
            if m:
                name = m.group(1)
            elif path == "/w/index.php":
                title = dict(p.split("=", 1) for p in parts.query.split("&") if "=" in p).get("title", "")
                t = unquote(title)
                name = t.split(":", 1)[1] if t.startswith(("File:", "Fichier:")) else None
        if not name or len(name) > 240 or any(c in name for c in "#<>[]|{}"):
            raise invalid_link("Lien Wikimedia Commons invalide : commons.wikimedia.org/wiki/File:<nom> attendu.")
        name = name.replace(" ", "_")
        return Ref("commons", "fichier", name, f"https://commons.wikimedia.org/wiki/File:{quote(name)}")

    def info(self) -> InfoConnecteur:
        caps = ["Metadata", "Search", "Playback", "AuthorizedDownload", "Import"]
        return InfoConnecteur(self.id, self.nom, "source_libre", True, caps, caps, [],
                              [FREE_ONLY, "Fichiers audio seulement (type « AUDIO » de Commons).",
                               "Empreinte SHA-1 publiée par Commons vérifiée après chaque téléchargement.",
                               "Agent utilisateur identifié, comme le demande la Wikimedia Foundation."],
                              self.conditions)

    async def _info(self, name: str) -> dict[str, Any]:
        query = urlencode({"action": "query", "format": "json", "formatversion": "2", "prop": "imageinfo",
                           "iiprop": "url|size|mime|mediatype|sha1|extmetadata", "iiextmetadatalanguage": "fr",
                           "titles": f"File:{name}"})
        status, data = await self.ctx.json("commons", 60, f"https://commons.wikimedia.org/w/api.php?{query}", COMMONS_API)
        if status != 200 or not isinstance(data, dict):
            raise unavailable("Wikimedia Commons", status)
        pages = (data.get("query") or {}).get("pages") or []
        page = pages[0] if pages and isinstance(pages[0], dict) else {}
        infos = page.get("imageinfo") or []
        if page.get("missing") or not infos or not isinstance(infos[0], dict):
            raise not_found("Wikimedia Commons")
        return infos[0]

    def _fiche(self, ref: Ref, info: dict[str, Any]) -> tuple[Fiche, Fichier | None]:
        meta = info.get("extmetadata") or {}
        val = lambda k: (meta.get(k) or {}).get("value") if isinstance(meta.get(k), dict) else None  # noqa: E731
        fiche = Fiche("commons", "fichier", ref.id, ref.url)
        fiche.source_metadonnees = "commons"
        fiche.titre = text(val("ObjectName")) or text(ref.id.rsplit(".", 1)[0].replace("_", " "))
        artist = text(val("Artist"), 200)
        fiche.artistes = [artist] if artist else []
        fiche.date = text(val("DateTimeOriginal"), 40)
        lic = licences.from_commons(text(val("LicenseShortName"), 100), text(val("License"), 60), val("LicenseUrl"))
        fiche.licence = lic
        credit = text(val("Credit"), 200)
        fiche.attribution = f"« {fiche.titre} » par {artist or 'auteur inconnu'}, {lic.nom}" + \
                            (f" ({lic.url})" if lic.url else "") + (f", {credit}" if credit else "") + \
                            f", via Wikimedia Commons ({ref.url})"
        restrictions = text(val("Restrictions"), 200)
        if restrictions:
            fiche.restrictions.append(f"Restrictions indiquées par Commons : {restrictions}.")
        fiche.capacites = ["Metadata", "Search"]
        fiche.actions = [action_ouvrir("sur Wikimedia Commons", ref.url), dict(ACTION_ENREGISTRER)]
        mime = str(info.get("mime") or "").lower()
        ext = MIME_TO_EXT.get(mime) or ext_of(ref.id)
        url = https_or_none(info.get("url"))
        if info.get("mediatype") != "AUDIO" or not ext or not url or urlsplit(url).hostname != "upload.wikimedia.org":
            fiche.manque.append("Ce fichier n'est pas un fichier audio importable (MP3, Ogg, FLAC, WAV).")
            return fiche, None
        sha1 = str(info.get("sha1") or "").lower()
        fichier = Fichier(ref.id, url, ext, AUDIO_TYPES[ext][0], int(number(info.get("size")) or 0) or None, mime,
                          None, None, sha1 if re.fullmatch(r"[0-9a-f]{40}", sha1) else None, True)
        fiche.pistes = [Piste(fiche.titre, fiche.artistes, None, None, None, None, ref.url, ref.id, fiche.date,
                              None, [fichier])]
        fiche.capacites.append("Playback")
        fiche.actions.insert(1, {"id": "ecouter", "libelle": "Écouter (fichier de Commons)", "url": url,
                                 "type": AUDIO_TYPES[ext][0]})
        if lic.libre:
            fiche.capacites += ["AuthorizedDownload", "Import"]
            fiche.actions.append(action_importer({"url": ref.url}))
            if lic.attribution_requise:
                fiche.restrictions.append(f"Licence {lic.nom} : citer l'auteur et la licence en cas de réutilisation "
                                          "(attribution enregistrée avec le fichier).")
        else:
            fiche.restrictions.append(f"Licence « {lic.nom} » : pas de téléchargement. " + FREE_ONLY)
        return fiche, fichier

    async def analyse(self, ref: Ref) -> Fiche:
        return self._fiche(ref, await self._info(ref.id))[0]

    async def plan_import(self, ref: Ref, body: dict[str, Any]) -> ImportPlan:
        fiche, fichier = self._fiche(ref, await self._info(ref.id))
        if fichier is None or "AuthorizedDownload" not in fiche.capacites:
            raise ApiError(403, "telechargement_non_autorise", " ".join(fiche.restrictions or fiche.manque)
                           or "Téléchargement non autorisé pour ce fichier.")
        assert fiche.licence is not None
        return ImportPlan("commons", fichier, COMMONS_FILES, fiche.licence, fiche.titre or ref.id, fiche.artistes,
                          None, fiche.date, fiche.attribution, ref.url)

    async def search(self, q: str) -> list[Fiche]:
        words = " ".join(re.findall(r"[\w'-]{1,40}", q, re.UNICODE)[:8])
        if not words:
            raise ApiError(400, "recherche_vide", "Recherche vide.")
        query = urlencode({"action": "query", "format": "json", "formatversion": "2", "list": "search",
                           "srnamespace": "6", "srlimit": "10", "srsearch": f"{words} filetype:audio"})
        status, data = await self.ctx.json("commons", 60, f"https://commons.wikimedia.org/w/api.php?{query}", COMMONS_API)
        if status != 200 or not isinstance(data, dict):
            raise unavailable("Wikimedia Commons", status)
        out = []
        for hit in ((data.get("query") or {}).get("search") or [])[:10]:
            title = str(hit.get("title") or "")
            if title.startswith("File:"):
                name = title[5:].replace(" ", "_")
                f = Fiche("commons", "fichier", name, f"https://commons.wikimedia.org/wiki/File:{quote(name)}")
                f.titre = text(name.rsplit(".", 1)[0].replace("_", " "))
                f.source_metadonnees = "commons"
                f.capacites = ["Metadata", "Search"]
                f.actions = [action_ouvrir("sur Wikimedia Commons", f.url)]
                f.manque.append("Licence vérifiée à l'analyse du fichier (POST /music/analyser).")
                out.append(f)
        return out


# --------------------------------------------------------------------------------------------------------------------

FEED_MAX = 5 * 1024 * 1024
NS = {"itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd", "podcast": "https://podcastindex.org/namespace/1.0"}


def parse_feed(raw: bytes) -> ET.Element:
    """RSS 2.0 only. Any DTD or entity declaration is refused before parsing (no entity expansion, no external
    entity); ElementTree never fetches anything."""
    head = raw[:FEED_MAX]
    if b"<!DOCTYPE" in head.upper() or b"<!ENTITY" in head.upper():
        raise ApiError(422, "flux_invalide", "Flux refusé : déclaration DTD ou d'entité interdite.")
    try:
        root = ET.fromstring(head)
    except ET.ParseError:
        raise ApiError(422, "flux_invalide", "Ce n'est pas un flux RSS lisible.") from None
    channel = root.find("channel")
    if root.tag != "rss" or channel is None:
        raise ApiError(422, "flux_invalide", "Ce n'est pas un flux de podcast RSS 2.0.")
    return channel


def episode_id(item: ET.Element) -> str:
    guid = (item.findtext("guid") or "").strip()
    enclosure = item.find("enclosure")
    basis = guid or (enclosure.get("url", "") if enclosure is not None else "") or (item.findtext("title") or "")
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()[:20]


class Podcast(Connector):
    id = "podcast"
    nom = "Podcast (flux RSS)"
    famille = "source_libre"
    conditions = ["https://www.rssboard.org/rss-specification#ltenclosuregtSubelementOfLtitemgt"]

    def recognizes(self, host: str) -> bool:
        return False  # any host: chosen by the "podcast" type or by feed-like paths (registry)

    def parse(self, url: str, parts: SplitResult) -> Ref:
        check_url(url, ANY_PUBLIC, self.ctx.settings.music_allow_local_sources)
        return Ref("podcast", "podcast", hashlib.sha256(url.encode()).hexdigest()[:20], url)

    def info(self) -> InfoConnecteur:
        caps = ["Metadata", "Playback", "AuthorizedDownload", "Import"]
        return InfoConnecteur(self.id, self.nom, "source_libre", True, caps, caps, [],
                              ["Épisodes publiés par l'émission dans son flux RSS (balise <enclosure>) : fichiers "
                               "destinés au téléchargement par les applications de podcast ; droits réservés à "
                               "l'éditeur, usage personnel.",
                               "Flux de 5 Mo au plus, RSS 2.0, aucune DTD ni entité ; 300 épisodes listés au plus.",
                               "Hébergeurs de streaming commerciaux refusés même si un flux y renvoie."],
                              self.conditions)

    async def _feed(self, url: str) -> tuple[ET.Element, str]:
        self.ctx.throttle("podcast", 60)
        resp = await asyncio.to_thread(self.ctx.web.request, "GET", url, ANY_PUBLIC, max_bytes=FEED_MAX,
                                       deadline_s=20.0, accept_status=(200,),
                                       headers={"Accept": "application/rss+xml, application/xml, text/xml"})
        if resp.status == 404 or resp.status == 410:
            raise not_found("ce site")
        if resp.status != 200:
            raise unavailable("Le site du podcast", resp.status)
        return parse_feed(resp.body), resp.url

    async def analyse_feed(self, url: str) -> Fiche:
        return self._fiche(*(await self._feed(url)), source=url)

    async def analyse(self, ref: Ref) -> Fiche:
        return await self.analyse_feed(ref.url)

    def _fiche(self, channel: ET.Element, final_url: str, source: str) -> Fiche:
        fiche = Fiche("podcast", "podcast", hashlib.sha256(source.encode()).hexdigest()[:20], source)
        fiche.source_metadonnees = "rss"
        fiche.titre = text(channel.findtext("title"))
        author = text(channel.findtext("itunes:author", namespaces=NS), 200)
        fiche.artistes = [author] if author else []
        image = channel.find("itunes:image", NS)
        fiche.pochette = https_or_none(image.get("href") if image is not None else None) or \
            https_or_none(channel.findtext("image/url"))
        rights = text(channel.findtext("copyright"), 200)
        tagged = channel.find("podcast:license", NS)
        lic = licences.PUBLISHER
        if tagged is not None:
            lic = licences.from_url(tagged.get("url")) if tagged.get("url") else lic
        fiche.licence = lic
        fiche.attribution = f"« {fiche.titre or 'Podcast'} »" + (f" par {author}" if author else "") + \
                            (f" — {rights}" if rights else "") + f" (flux : {source})"
        link = https_or_none(channel.findtext("link"))
        if link:
            fiche.actions.append(action_ouvrir("le site de l'émission", link))
        fiche.actions.append(dict(ACTION_ENREGISTRER))
        fiche.capacites = ["Metadata"]
        items = channel.findall("item")
        fiche.pistes_total = len(items)
        for item in items[:300]:
            enc = item.find("enclosure")
            if enc is None:
                continue
            url = https_or_none(enc.get("url"))
            mime = (enc.get("type") or "").lower().split(";")[0].strip()
            ext = MIME_TO_EXT.get(mime) or (ext_of(urlsplit(url).path) if url else None)
            if not url or not ext:
                continue
            ident = episode_id(item)
            dur = seconds(item.findtext("itunes:duration", namespaces=NS))
            img = item.find("itunes:image", NS)
            fiche.pistes.append(Piste(text(item.findtext("title")), fiche.artistes, fiche.titre, dur, None,
                                      int(number(item.findtext("itunes:episode", namespaces=NS)) or 0) or None,
                                      https_or_none(item.findtext("link")), ident, text(item.findtext("pubDate"), 40),
                                      https_or_none(img.get("href") if img is not None else None) or fiche.pochette,
                                      [Fichier(urlsplit(url).path.rsplit("/", 1)[-1][:200] or f"{ident}.{ext}", url,
                                               ext, AUDIO_TYPES[ext][0], int(number(enc.get("length")) or 0) or None,
                                               None, dur)]))
        if fiche.pistes:
            fiche.capacites += ["Playback", "AuthorizedDownload", "Import"]
            fiche.actions.append(action_importer({"url": source, "type": "podcast",
                                                  "episode": "<id d'un épisode de « pistes »>"},
                                                 libelle="Importer un épisode dans ma bibliothèque"))
            fiche.restrictions.append("Droits réservés à l'éditeur du podcast : usage personnel.")
        else:
            fiche.manque.append("Aucun épisode audio dans ce flux (balise <enclosure> absente ou vidéo).")
        return fiche

    async def plan_import(self, ref: Ref, body: dict[str, Any]) -> ImportPlan:
        wanted = str(body.get("episode") or "").strip()
        if not re.fullmatch(r"[0-9a-f]{20}", wanted):
            raise ApiError(400, "episode_requis", "Choisis un épisode (champ « episode » : id d'un épisode de la fiche).")
        fiche = await self.analyse_feed(ref.url)
        piste = next((p for p in fiche.pistes if p.id == wanted), None)
        if piste is None or not piste.fichiers:
            raise ApiError(404, "episode_introuvable", "Cet épisode n'est plus dans le flux.")
        assert fiche.licence is not None
        return ImportPlan("podcast", piste.fichiers[0], ANY_PUBLIC, fiche.licence, piste.titre or "Épisode",
                          fiche.artistes, fiche.titre, piste.date, fiche.attribution, piste.url or ref.url,
                          piste.pochette)


# --------------------------------------------------------------------------------------------------------------------


class DirectFile(Connector):
    id = "fichier"
    nom = "Fichier audio direct"
    famille = "source_libre"
    conditions: list[str] = []

    @property
    def actif(self) -> bool:
        return self.ctx.settings.music_direct_files

    def recognizes(self, host: str) -> bool:
        return False  # chosen by the "fichier" type or by an audio extension (registry)

    def parse(self, url: str, parts: SplitResult) -> Ref:
        check_url(url, ANY_PUBLIC, self.ctx.settings.music_allow_local_sources)
        name = unquote(parts.path.rsplit("/", 1)[-1])[:200] or "fichier"
        return Ref("fichier", "fichier", hashlib.sha256(url.encode()).hexdigest()[:20], url, (("nom", name),))

    def info(self) -> InfoConnecteur:
        caps = ["Metadata", "AuthorizedDownload", "Import"] if self.actif else []
        return InfoConnecteur(self.id, self.nom, "source_libre", self.actif, caps,
                              ["Metadata", "AuthorizedDownload", "Import"], [],
                              ["Lien https vers un fichier audio (MP3, Ogg, Opus, FLAC, WAV, M4A) : le fichier est "
                               "importé seulement après la déclaration de droits de l'utilisateur (fichier personnel "
                               "ou droits détenus).",
                               "Type vérifié par les en-têtes ET par le contenu du fichier ; flux de streaming et "
                               "services de streaming commerciaux toujours refusés."],
                              self.conditions)

    async def _probe(self, ref: Ref) -> tuple[str, str, int | None, str]:
        """(extension, MIME, size, file name) from the headers and the first bytes of the file."""
        from .audio import sniff

        self.ctx.throttle("fichier", 60)
        resp = await asyncio.to_thread(self.ctx.web.request, "GET", ref.url, ANY_PUBLIC, peek=64,
                                       headers={"Range": "bytes=0-63"}, deadline_s=15.0)
        if resp.status in (404, 410):
            raise not_found("ce site")
        if resp.status not in (200, 206):
            raise unavailable("Le site du fichier", resp.status)
        ctype = resp.header("content-type").lower().split(";")[0].strip()
        sniffed = sniff(resp.body)
        if not sniffed:
            raise ApiError(415, "type_refuse", "Ce lien ne mène pas à un fichier audio pris en charge (MP3, Ogg, "
                                               "Opus, FLAC, WAV, M4A).")
        if ctype and ctype not in MIME_TO_EXT and ctype not in ("application/octet-stream", "binary/octet-stream"):
            raise ApiError(415, "type_refuse", f"Type annoncé par le serveur refusé ({ctype[:60]}).")
        size = None
        rng = resp.header("content-range")
        if "/" in rng and rng.rsplit("/", 1)[1].isdigit():
            size = int(rng.rsplit("/", 1)[1])
        elif resp.status == 200 and resp.header("content-length").isdigit():
            size = int(resp.header("content-length"))
        name = ref.get("nom") or "fichier"
        disp = resp.header("content-disposition")
        m = re.search(r"filename\*?=(?:UTF-8'')?\"?([^\";]{1,200})", disp, re.I)
        if m:
            name = unquote(m.group(1)).strip() or name
        ext = sniffed
        return ext, AUDIO_TYPES[ext][0], size, name

    async def analyse(self, ref: Ref) -> Fiche:
        if not self.actif:
            raise ApiError(403, "connecteur_coupe", "Les fichiers audio directs sont désactivés sur ce serveur.")
        ext, mime, size, name = await self._probe(ref)
        fiche = Fiche("fichier", "fichier", ref.id, ref.url)
        fiche.source_metadonnees = "entetes"
        fiche.titre = text(name.rsplit(".", 1)[0], 200)
        fiche.licence = licences.DECLARED
        fiche.pistes = [Piste(fiche.titre, [], None, None, None, None, ref.url, ref.id, None, None,
                              [Fichier(name, ref.url, ext, mime, size)])]
        fiche.capacites = ["Metadata", "AuthorizedDownload", "Import"]
        fiche.actions = [dict(ACTION_ENREGISTRER), action_importer({"url": ref.url, "type": "fichier"},
                                                                    attestation=True)]
        # Le corps proposé ne porte JAMAIS « attestation » : seul le client, quand l'utilisateur coche la case, l'ajoute
        # (un client qui renverrait le corps tel quel est refusé : 400 attestation_requise).
        fiche.restrictions.append("Import seulement si tu possèdes ce fichier ou disposes des droits nécessaires "
                                  "(déclaration enregistrée avec le fichier).")
        fiche.manque.append("Artiste, album, durée : lus dans le fichier après l'import.")
        return fiche

    async def plan_import(self, ref: Ref, body: dict[str, Any]) -> ImportPlan:
        if not self.actif:
            raise ApiError(403, "connecteur_coupe", "Les fichiers audio directs sont désactivés sur ce serveur.")
        if body.get("attestation") is not True:
            raise ApiError(400, "attestation_requise", "Confirme que tu possèdes ce fichier ou que tu disposes des "
                                                       "droits nécessaires (champ « attestation »: true).")
        ext, mime, size, name = await self._probe(ref)
        return ImportPlan("fichier", Fichier(name, ref.url, ext, mime, size), ANY_PUBLIC, licences.DECLARED,
                          name.rsplit(".", 1)[0][:200] or "Fichier", [], None, None, None, ref.url, None, None, True)
