# Signature CEP (ZXP) depuis Linux — format, preuves, limites

## 1. Pourquoi pas ZXPSignCmd

`ZXPSignCmd` (Windows et macOS seulement) est publié dans le dépôt `Adobe-CEP/CEP-Resources`. Son dossier ne contient
aucun README ni conditions propres, mais le dépôt porte une licence, `License/GenSDK_IHC-*.pdf` (« Licence du kit de
développement logiciel d'Adobe pour Common Extensibility Platform »). Elle dit : « en téléchargeant, copiant,
installant ou utilisant toute partie de ce SDK, le Développeur accepte toutes ses dispositions ».

Télécharger ou lancer l'outil reviendrait donc à accepter ce contrat au nom du propriétaire. **Ce n'est pas fait :
l'exécutable n'a jamais été téléchargé.** C'est au propriétaire de décider s'il accepte ce contrat. S'il l'accepte,
`ZXPSignCmd -verify` sur son PC est une contre-épreuve possible (§4).

## 2. Le format, relevé sur un vrai ZXP signé par ZXPSignCmd

La référence est `snatch_1.3.0.zxp`, un ZXP public déjà présent sur ce serveur depuis la recherche de l'étape E. Il a
été signé en février 2022 par ZXPSignCmd, avec un certificat auto-signé et un horodatage Certum. Il sert seulement
de témoin d'essai : il n'est pas versionné et rien n'en est livré.

- **`mimetype`** contient `application/vnd.adobe.air-ucf-package+zip`. C'est le conteneur UCF d'AIR.
- **`META-INF/signatures.xml`** suit XML-DSig, avec des fins de ligne CRLF entre les éléments :
  - un `<Signature Id="PackageSignature">` contient `<SignedInfo>`. Ce bloc utilise la forme canonique C14N 1.0
    inclusive et la méthode `rsa-sha1` dans la référence. Il porte une seule `<Reference
    Type="…#Manifest" URI="#PackageContents">` (transformation C14N, empreinte SHA-256) ;
  - `<SignatureValue Id="PackageSignatureValue">` suit, puis `<KeyInfo><X509Data><X509Certificate>` ;
  - `<Object><Manifest Id="PackageContents">` donne une `<Reference URI="chemin">` (SHA-256) par fichier. **`mimetype`
    vient en premier**, puis les fichiers dans l'ordre d'un dossier NTFS (insensible à la casse). Les dossiers et
    `META-INF/signatures.xml` n'y figurent pas ;
  - le bloc `<Object xmlns:xades="http://uri.etsi.org/01903/v1.1.1#">` contient `QualifyingProperties`,
    `UnsignedProperties`, `UnsignedSignatureProperties`, puis `SignatureTimeStamp` avec
    `<xades:HashDataInfo uri="SignatureValue">` (C14N) ;
  - `<xades:EncapsulatedTimeStamp>` contient **la réponse RFC 3161 entière** (`TimeStampResp`, statut compris), et
    non le seul jeton.
- **Ce que couvre l'horodatage** (trouvé par essai, puis vérifié) : l'empreinte porte sur la forme canonique de
  `<SignatureValue>` **dont le base64 n'a aucun retour à la ligne**. ZXPSignCmd coupe ensuite ce base64 en lignes
  dans le fichier écrit. `zxp.py` écrit donc ce base64 sur une seule ligne : la forme horodatée est la même avant et
  après relecture, quel que soit le vérificateur.
- **Certificat de ZXPSignCmd** : X.509 **v1**, sans extension, signé SHA-256 (RSA 1024 bits dans la référence).

Constat technique : `lxml.etree.tostring(…, method="c14n")` (lxml 4.9.2, libxml2 de Debian 12) ajoute `xmlns=""` à
des descendants d'un sous-arbre. Le résultat est une empreinte fausse. `zxp.py` calcule donc lui-même la forme
canonique C14N 1.0 (≈ 50 lignes) et ne se sert de lxml que pour analyser le XML.

## 3. Ce que produit `zxp.py`

Le format est celui du §2, octet pour octet, avec ces choix :

| Point | Choix | Raison |
|---|---|---|
| Méthode de signature | `rsa-sha1` par défaut, `--algo rsa-sha256` possible | `rsa-sha1` est la sortie de ZXPSignCmd que CEP accepte depuis des années (référence). Les empreintes des fichiers et du Manifest restent en SHA-256 |
| Empreinte de l'horodatage | `sha1` par défaut, `--algo-horodatage sha256` possible | comme la référence ; le « SHA2 fix » de ZXPSignCmd 4.1.103 n'est pas documenté plus précisément |
| Certificat | X.509 v1, RSA **2048**, SHA-256, `C=FR, O=AETHRYON, CN=AETHRYON`, 10 ans | comme `-selfSignedCert`, avec une clé plus longue |
| Horodatage | autorité RFC 3161 **locale** (`openssl ts`, certificat auto-signé à usage `timeStamping`) | « rien ne sort de la machine » ; voir §5 |
| Archive | `mimetype` en premier et non compressé, puis `META-INF/`, puis le reste (deflate), entrées de dossier comprises | convention UCF ; l'ordre est sans effet sur la vérification |
| Refus | liens symboliques, fichiers spéciaux, `.DS_Store`, `Thumbs.db`, `desktop.ini`, `__MACOSX/`, `.git/`, `mimetype` ou `META-INF/signatures.xml` déjà présents | problème connu de novembre 2024 (§6) |

Matériel secret : un dossier privé hors dépôt (variable `SECRETS`) (0700, hors Git), créé une fois par `creer-certificats.sh`.
- `signature.p12` contient la clé et le certificat, chiffrés par le mot de passe.
- `mot-de-passe` (0600) est aléatoire et n'est jamais affiché.
- `tsa/` contient l'autorité d'horodatage locale ; sa clé est chiffrée par le même mot de passe.
- `signature.crt.pem` est le certificat public.

Pendant la signature, ces fichiers sont copiés dans le conteneur jetable, puis effacés avec lui.

## 4. Preuves (Linux)

`essais_zxp.py` (11 essais) utilise un matériel **jetable**, jamais celui de le matériel réel.
- **Référence Adobe** : `zxp.py verifier` déclare valide le ZXP signé par ZXPSignCmd (SignedInfo, Manifest,
  39 fichiers, horodatage Certum). Il le déclare invalide dès qu'un octet de `CSXS/manifest.xml` change. Le format
  relevé et la forme canonique calculée sont donc ceux d'Adobe.
- **xmlsec1 1.2.37** (Debian, implémentation indépendante, libxml2 et OpenSSL) valide la référence (SignedInfo 1/1,
  Manifest 39/39) **et** nos paquets (SignedInfo 1/1, Manifest n/n). Après falsification, il compte n-1/n.
- Nos paquets, en ZIP et extraits : signature valide en `rsa-sha1` et en `rsa-sha256`, horodatage valide avec
  l'autorité locale fournie. Sans horodatage : valide, avec un avertissement.
- Falsifications détectées : un fichier modifié, ajouté, retiré, un `.DS_Store` ajouté, un lien symbolique, un
  caractère de la signature changé (signature et horodatage invalides), une référence du Manifest réécrite.
- Le certificat produit est bien X.509 v1, SHA-256, RSA 2048.

`signer-extension.sh` lance ces deux vérifications (zxp.py et xmlsec1) à chaque signature et s'arrête si l'une échoue.

## 5. NON TESTÉ SOUS WINDOWS

- **L'acceptation par le vrai CEP de Premiere Pro** (sans PlayerDebugMode) d'un ZXP signé ici, extrait tel quel
  dans `%APPDATA%\Adobe\CEP\extensions\fr.aethryon.premiere`. C'est l'essai E1 du propriétaire. Si le panneau reste
  vide, le premier suspect est la signature.
- **L'horodatage d'une autorité locale non reconnue.** On ne sait pas si CEP le juge « valide ». Un horodatage
  invalide pourrait être ignoré (le certificat est valable jusqu'en 2036) ou faire refuser le paquet. Le setup livre
  donc aussi `fr.aethryon.premiere-sans-horodatage.zxp`, pour un essai de diagnostic. Pour une publication, il faudra
  une autorité publique (par exemple `http://time.certum.pl/`). Elle ne reçoit qu'une empreinte, mais c'est une
  requête vers l'extérieur : décision du propriétaire.
- `ZXPSignCmd -verify` n'a pas été lancé (§1).
- `rsa-sha256` : on ne sait pas si le CEP de Premiere accepte cet identifiant. C'est pourquoi `rsa-sha1` reste le
  choix par défaut.

## 6. Problème connu de novembre 2024 : ce qui est fait

Le symptôme : un panneau vide après installation, avec une signature jugée invalide. La cause : l'installateur
d'Adobe (UPIA) extrait les **liens symboliques** en fichiers texte, et ZXPSignLib a besoin des droits administrateur
pour les remplacer.
- **Aucun lien symbolique** : `zxp.py signer` refuse d'en signer un, `zxp.py verifier` et le setup refusent un
  paquet qui en contient, et le setup écrit chaque fichier lui-même.
- **Pas d'UPIA ni d'Extension Manager** : le setup extrait le ZXP signé tel quel, `mimetype` et
  `META-INF/signatures.xml` compris, puis revérifie la présence et les empreintes SHA-256 de chaque fichier contre le
  Manifest, avant et après la copie.
- **Pas de fichiers parasites** (`.DS_Store`, `__MACOSX`).
- Conseil d'Adobe : « signer sur la plateforme cible ». La signature est faite sous Linux, mais elle ne porte que sur
  des octets (empreintes SHA-256), et la vérification croisée par xmlsec1 ne dépend pas de la plateforme. Ce conseil
  vise les liens symboliques et les métadonnées de macOS, qui sont exclus ici. C'est à confirmer par l'essai E1.
- **PlayerDebugMode n'est jamais écrit** par le setup. La détection signale seulement s'il est déjà activé sur le PC.
