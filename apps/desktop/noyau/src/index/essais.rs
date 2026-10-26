//! Essais d'AETHRYON Index sur des arbres jetables (dossiers temporaires) : milliers de fichiers, boucle de liens,
//! dossier sans droits, renommages / déplacements / suppressions entre deux scans, annulation, doublons, exclusions,
//! filtres, coupure réelle (processus tué au milieu d'un scan), emplacement déplacé, disque débranché, surveillance en
//! direct, métadonnées et miniatures, Everything factice (Windows), mesure de débit (ignorée par défaut).

use super::base::{EtatFichier, Requete, Source, Tri};
use super::reglages::{Cible, GenreCible};
use super::volumes::{GenreVolume, SourceVolumes, Volume, VolumesFixes};
use super::*;
use std::fs;
use std::sync::Mutex as M;

#[derive(Default)]
struct Journal {
    progressions: M<Vec<Progression>>,
    fins: M<Vec<Resume>>,
    changements: M<Vec<String>>,
}

struct Avis(Arc<Journal>);

impl AvisIndex for Avis {
    fn progression(&self, p: &Progression) {
        self.0.progressions.lock().unwrap().push(p.clone());
    }
    fn fin(&self, r: &Resume) {
        self.0.fins.lock().unwrap().push(r.clone());
    }
    fn changement(&self, q: &str) {
        self.0.changements.lock().unwrap().push(q.into());
    }
    fn enrichissement(&self, _: &Enrichissement) {}
    fn migration(&self, _: &Migration) {}
}

struct Banc {
    d: tempfile::TempDir,
    ix: IndexMedias,
    journal: Arc<Journal>,
}

fn volumes_essai() -> Box<dyn SourceVolumes> {
    // Windows (Wine) : les vrais volumes (identifiants de fichiers sur NTFS) ; ailleurs : rien (identité par périphérique).
    if cfg!(windows) {
        Box::new(volumes::VolumesSysteme)
    } else {
        Box::new(VolumesFixes(M::new(Vec::new())))
    }
}

fn banc_avec(volumes: Box<dyn SourceVolumes>, enrichir: bool) -> Banc {
    let d = tempfile::tempdir().unwrap();
    let config = d.path().join("Roaming").join("AETHRYON");
    let racine = d.path().join("Local").join("AETHRYON");
    fs::create_dir_all(&config).unwrap();
    let mut r = Reglages::default();
    r.metadonnees = enrichir;
    r.miniatures = enrichir;
    r.surveiller = false;
    reglages::enregistrer(&config, &r).unwrap();
    let journal = Arc::new(Journal::default());
    let ix = IndexMedias::demarrer(&config, &racine, volumes, Box::new(Avis(journal.clone())));
    Banc { d, ix, journal }
}

fn banc() -> Banc {
    banc_avec(volumes_essai(), false)
}

impl Banc {
    fn arbre(&self) -> PathBuf {
        let a = self.d.path().join("arbre");
        fs::create_dir_all(&a).unwrap();
        a
    }
    fn scanner(&self, cibles: Vec<Cible>) -> Resume {
        let id = self.ix.lancer_scan(Some(cibles)).expect("scan refusé");
        assert!(self.ix.attendre_scan(Duration::from_secs(120)), "scan trop long");
        let r = self.ix.resume(None).unwrap();
        assert_eq!(r.scan, id);
        r
    }
    fn chercher(&self, r: Requete) -> Page {
        self.ix.bibliotheque(&r).unwrap()
    }
    fn total(&self, texte: &str) -> u64 {
        self.chercher(Requete { texte: texte.into(), ..Default::default() }).total
    }
}

/// Les identifiants de fichiers servent-ils sur ce volume (NTFS sous Windows ; toujours sous Unix) ?
fn ids_fiables_ici(p: &Path) -> bool {
    if cfg!(windows) {
        volumes::volume_de(p, &volumes::lister_systeme()).ids_fiables
    } else {
        true
    }
}

impl Drop for Banc {
    fn drop(&mut self) {
        self.ix.arreter();
    }
}

fn dossier(p: &Path) -> Cible {
    Cible { genre: GenreCible::Dossier, chemin: p.to_string_lossy().into_owned() }
}

fn ecrire(p: &Path, n: usize) {
    if let Some(d) = p.parent() {
        fs::create_dir_all(d).unwrap();
    }
    fs::write(p, vec![b'x'; n]).unwrap();
}

fn attendre(max: Duration, mut f: impl FnMut() -> bool) -> bool {
    let fin = Instant::now() + max;
    while Instant::now() < fin {
        if f() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    f()
}

#[test]
fn sqlite_embarque_avec_fts5() {
    let c = rusqlite::Connection::open_in_memory().unwrap();
    let v: String = c.query_row("SELECT sqlite_version()", [], |r| r.get(0)).unwrap();
    let fts5: i64 = c.query_row("SELECT sqlite_compileoption_used('ENABLE_FTS5')", [], |r| r.get(0)).unwrap();
    eprintln!("SQLite embarqué {v}, FTS5 {fts5}");
    assert_eq!(fts5, 1);
    assert!(base::expression_fts("\"*-", false).is_none(), "aucun mot : aucune recherche plein texte");
    assert_eq!(base::expression_fts("Été côte", false).unwrap(), "{nom etiquettes} : (\"Été\"* AND \"côte\"*)");
    assert_eq!(base::expression_fts("a\"b", true).unwrap(), "\"a\"\"b\"*");
}

#[test]
fn milliers_de_fichiers_types_pagination_filtres() {
    let b = banc();
    let a = b.arbre();
    // 30 dossiers × 5 sous-dossiers × (8 vidéos, 4 audios, 6 images, 2 textes, 1 vidéo vide).
    for i in 0..30 {
        for j in 0..5 {
            let s = a.join(format!("Dossier {i:02}")).join(format!("sous {j}"));
            for k in 0..8 {
                ecrire(&s.join(format!("clip {i}-{j}-{k} été.mp4")), 10 + k);
            }
            for k in 0..4 {
                ecrire(&s.join(format!("son {i}-{j}-{k}.mp3")), 100 + k);
            }
            for k in 0..6 {
                ecrire(&s.join(format!("photo {i}-{j}-{k}.JPG")), 1000 + k);
            }
            ecrire(&s.join("notes.txt"), 5);
            ecrire(&s.join("lisez-moi.md"), 5);
            ecrire(&s.join("vide.mp4"), 0);
        }
    }
    let r = b.scanner(vec![dossier(&a)]);
    assert_eq!(r.etat, "termine");
    assert_eq!((r.medias.video, r.medias.audio, r.medias.image), (1200, 600, 900));
    assert_eq!(r.total_medias, 2700);
    assert_eq!(r.bilan.nouveaux, 2700);
    assert_eq!(r.dossiers, 181);
    assert_eq!(r.fichiers_vus, 150 * 21);
    assert_eq!(r.erreurs, 0);
    assert!(b.journal.progressions.lock().unwrap().iter().all(|p| !p.mesurable && p.fraction.is_none()), "parcours natif : jamais de pourcentage inventé");
    // Rescan sans changement : rien n'est réécrit.
    let r2 = b.scanner(vec![dossier(&a)]);
    assert_eq!((r2.bilan.nouveaux, r2.bilan.modifies, r2.bilan.supprimes, r2.bilan.inchanges), (0, 0, 0, 2700));
    // Pagination : 1 200 vidéos en pages de 500, ordre stable, aucun doublon.
    let mut ids = std::collections::HashSet::new();
    for page in 1..=3 {
        let p = b.chercher(Requete { types: vec![TypeMedia::Video], tri: Tri::Nom, page, taille_page: 500, ..Default::default() });
        assert_eq!((p.total, p.pages), (1200, 3));
        assert_eq!(p.elements.len(), if page < 3 { 500 } else { 200 });
        ids.extend(p.elements.into_iter().map(|e| e.id));
    }
    assert_eq!(ids.len(), 1200);
    // Filtres : type, dossier, taille, date, recherche sans accent ni casse.
    assert_eq!(b.chercher(Requete { types: vec![TypeMedia::Audio], ..Default::default() }).total, 600);
    let d03 = a.join("Dossier 03");
    assert_eq!(b.chercher(Requete { dossier: Some(d03.to_string_lossy().into()), ..Default::default() }).total, 90);
    assert_eq!(b.chercher(Requete { taille_min: Some(1000), ..Default::default() }).total, 900);
    assert_eq!(b.chercher(Requete { taille_min: Some(100), taille_max: Some(101), ..Default::default() }).total, 300);
    assert_eq!(b.total("ETE"), 1200);
    assert_eq!(b.total("photo 7-3"), 6, "« 7-3 » : mots consécutifs, le dernier en préfixe");
    let vieux = a.join("Dossier 00").join("sous 0").join("son 0-0-0.mp3");
    fs::File::options().write(true).open(&vieux).unwrap().set_modified(std::time::UNIX_EPOCH + Duration::from_secs(1_500_000_000)).unwrap();
    b.scanner(vec![dossier(&a)]);
    assert_eq!(b.chercher(Requete { modifie_avant: Some("2018-01-01T00:00:00Z".into()), ..Default::default() }).total, 1);
    let el = &b.chercher(Requete { texte: "son 0-0-0".into(), ..Default::default() }).elements[0];
    assert_eq!((el.nom.as_str(), el.ext.as_str(), el.type_media), ("son 0-0-0", "mp3", TypeMedia::Audio));
    assert_eq!(el.id, noms::id_media(&vieux.to_string_lossy()), "même règle d'identifiant qu'index.json");
    assert_eq!(el.sources, vec![Source::Index]);
}

#[test]
fn recherche_accents_prefixes_tri() {
    let b = banc();
    let a = b.arbre();
    for (n, t) in [
        ("Coucher de soleil sur la côte.mp4", 300),
        ("Été à Marseille.mp3", 200),
        ("IMG_20240101_1200.jpg", 100),
        ("Plan large — rushes 02.mov", 400),
        ("Nuit étoilée.png", 50),
    ] {
        ecrire(&a.join("Vacances 2024").join(n), t);
    }
    b.scanner(vec![dossier(&a)]);
    assert_eq!(b.total("cote"), 1);
    assert_eq!(b.total("COUCH sol"), 1);
    assert_eq!(b.total("ete"), 1);
    assert_eq!(b.total("eto"), 1);
    assert_eq!(b.total("2024"), 1, "préfixe d'un nombre dans IMG_20240101");
    assert_eq!(b.total("rushes 02"), 1);
    assert_eq!(b.total("mp4"), 1, "l'extension est un mot du nom");
    assert_eq!(b.total("vacances"), 0, "le chemin n'est pas cherché par défaut");
    assert_eq!(b.chercher(Requete { texte: "vacances".into(), dans_chemin: true, ..Default::default() }).total, 5);
    assert_eq!(b.total("\"*"), 5, "requête sans mot : tout, sans erreur SQL");
    assert_eq!(b.total("introuvable"), 0);
    let p = b.chercher(Requete { tri: Tri::Taille, ..Default::default() });
    let tailles: Vec<u64> = p.elements.iter().map(|e| e.taille).collect();
    assert_eq!(tailles, vec![400, 300, 200, 100, 50]);
    let p = b.chercher(Requete { tri: Tri::Nom, ordre: Some(base::Ordre::Asc), ..Default::default() });
    assert_eq!(p.elements[0].nom, "Coucher de soleil sur la côte");
    assert!(p.duree_ms < 1000.0);
}

#[cfg(unix)]
#[test]
fn boucle_de_liens_jamais_suivie_deux_fois() {
    use std::os::unix::fs::symlink;
    let b = banc();
    let a = b.arbre();
    ecrire(&a.join("a").join("x.mp4"), 10);
    ecrire(&a.join("a").join("b").join("y.mp3"), 10);
    symlink(a.join("a"), a.join("a").join("b").join("retour")).unwrap();
    symlink(a.join("a").join("x.mp4"), a.join("lien vers x.mp4")).unwrap();
    symlink(a.join("absent"), a.join("lien cassé")).unwrap();
    let r = b.scanner(vec![dossier(&a)]);
    assert_eq!(r.etat, "termine");
    assert_eq!(r.total_medias, 2);
    assert!(r.liens_ignores >= 2, "liens non suivis par défaut ({})", r.liens_ignores);
    // Liens suivis : la boucle est évitée par l'identité des dossiers, le lien de fichier est un doublon.
    b.ix.modifier_reglages(&serde_json::json!({"suivreLiens": true})).unwrap();
    let r = b.scanner(vec![dossier(&a)]);
    assert_eq!(r.etat, "termine");
    assert!(r.boucles_evitees >= 1, "boucle évitée ({})", r.boucles_evitees);
    assert_eq!(r.bilan.doublons, 1);
    assert_eq!(b.chercher(Requete::default()).total, 2, "chaque fichier une seule fois (doublons masqués)");
    assert_eq!(b.chercher(Requete { doublons: true, ..Default::default() }).total, 3);
}

/// Linux : retire au fil courant (et aux fils qu'il crée) le droit de passer outre les permissions (essais en root).
#[cfg(target_os = "linux")]
fn droits_dac(actifs: bool) -> bool {
    #[repr(C)]
    struct EnTete {
        version: u32,
        pid: i32,
    }
    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct Donnees {
        effectifs: u32,
        permis: u32,
        heritables: u32,
    }
    let mut h = EnTete { version: 0x2008_0522, pid: 0 };
    let mut d = [Donnees::default(); 2];
    unsafe {
        if libc::syscall(libc::SYS_capget, &mut h as *mut EnTete, d.as_mut_ptr()) != 0 {
            return false;
        }
        let masque = (1u32 << 1) | (1u32 << 2); // CAP_DAC_OVERRIDE, CAP_DAC_READ_SEARCH
        if actifs {
            d[0].effectifs |= masque & d[0].permis;
        } else {
            d[0].effectifs &= !masque;
        }
        libc::syscall(libc::SYS_capset, &mut h as *mut EnTete, d.as_ptr()) == 0
    }
}

#[cfg(target_os = "linux")]
#[test]
fn dossier_sans_droits_compte_et_continue() {
    use std::os::unix::fs::PermissionsExt;
    let b = banc();
    let a = b.arbre();
    ecrire(&a.join("ouvert").join("a.mp4"), 10);
    ecrire(&a.join("ferme").join("b.mp4"), 10);
    ecrire(&a.join("z-apres").join("c.png"), 10);
    fs::set_permissions(a.join("ferme"), fs::Permissions::from_mode(0o000)).unwrap();
    let root = unsafe { libc::geteuid() } == 0;
    if root {
        assert!(droits_dac(false), "capacités DAC non retirées");
    }
    let r = b.scanner(vec![dossier(&a)]);
    if root {
        droits_dac(true);
    }
    fs::set_permissions(a.join("ferme"), fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(r.etat, "termine", "une erreur d'accès n'arrête pas le scan");
    assert_eq!(r.erreurs, 1);
    assert!(r.erreurs_liste[0].chemin.ends_with("ferme"), "{:?}", r.erreurs_liste);
    assert_eq!(r.erreurs_liste[0].message, "Accès refusé par le système.");
    assert_eq!(r.total_medias, 2, "les autres dossiers sont lus");
    let r = b.scanner(vec![dossier(&a)]);
    assert_eq!((r.erreurs, r.total_medias, r.bilan.nouveaux, r.bilan.supprimes), (0, 3, 1, 0));
}

#[test]
fn renommes_deplaces_supprimes_modifies_entre_deux_scans() {
    let b = banc();
    let a = b.arbre();
    for (n, t) in [("A/un.mp4", 11), ("A/deux.mp4", 12), ("A/trois.mp4", 13), ("A/quatre.jpg", 14), ("B/cinq.mp3", 15)] {
        ecrire(&a.join(n), t);
    }
    let r = b.scanner(vec![dossier(&a)]);
    assert_eq!(r.bilan.nouveaux, 5);
    let avant = |t: &str| b.chercher(Requete { texte: t.into(), ..Default::default() }).elements[0].clone();
    let (un, deux) = (avant("un"), avant("deux"));
    fs::rename(a.join("A/un.mp4"), a.join("A/un renommé.mp4")).unwrap();
    fs::rename(a.join("A/deux.mp4"), a.join("B/deux.mp4")).unwrap();
    fs::remove_file(a.join("A/trois.mp4")).unwrap();
    ecrire(&a.join("B/cinq.mp3"), 99);
    ecrire(&a.join("B/six.wav"), 16);
    let r = b.scanner(vec![dossier(&a)]);
    let bl = &r.bilan;
    if !ids_fiables_ici(&a) {
        eprintln!("identifiants de fichiers non fiables ici : renommage = suppression + ajout ({bl:?})");
        assert_eq!((bl.supprimes, bl.nouveaux, bl.modifies), (3, 3, 1));
        return;
    }
    assert_eq!((bl.renommes, bl.deplaces, bl.supprimes, bl.modifies, bl.nouveaux, bl.inchanges), (1, 1, 1, 1, 1, 1), "{bl:?}");
    let renomme = avant("renommé");
    assert_eq!(renomme.ajoute_le, un.ajoute_le, "même entrée d'index, métadonnées gardées");
    assert_ne!(renomme.id, un.id, "nouvel identifiant (nouveau chemin)");
    let deplace = avant("deux");
    assert!(deplace.dossier.ends_with('B'));
    assert_eq!(deplace.ajoute_le, deux.ajoute_le);
    assert_eq!(b.total("trois"), 0, "supprimé : masqué par défaut");
    assert_eq!(b.chercher(Requete { texte: "trois".into(), etats: vec![EtatFichier::Absent], ..Default::default() }).total, 1, "gardé « absent » 7 jours");
    assert!(a.join("A/un renommé.mp4").exists() && a.join("B/deux.mp4").exists(), "fichiers d'origine intacts");
}

#[test]
fn annulation_puis_scan_complet() {
    let b = banc();
    let a = b.arbre();
    for i in 0..600 {
        for k in 0..5 {
            ecrire(&a.join(format!("d{i:03}")).join(format!("f{k}.mp4")), 8);
        }
    }
    b.ix.regler_pause(Some(Duration::from_millis(3)));
    b.ix.lancer_scan(Some(vec![dossier(&a)])).unwrap();
    assert!(attendre(Duration::from_secs(20), || b.journal.progressions.lock().unwrap().iter().any(|p| p.dossiers >= 20)));
    assert!(b.ix.annuler_scan());
    assert!(b.ix.attendre_scan(Duration::from_secs(30)));
    let r = b.ix.resume(None).unwrap();
    assert_eq!(r.etat, "annule");
    assert!(r.total_medias < 3000, "{}", r.total_medias);
    assert_eq!(r.bilan.supprimes, 0, "un scan annulé ne marque rien d'absent");
    b.ix.regler_pause(None);
    let r = b.scanner(vec![dossier(&a)]);
    assert_eq!((r.etat.as_str(), r.total_medias, r.bilan.supprimes), ("termine", 3000, 0));
    assert_eq!(b.chercher(Requete::default()).total, 3000);
    assert!(b.ix.lancer_scan(Some(vec![])).is_err());
}

#[test]
fn doublons_par_liens_physiques() {
    let b = banc();
    let a = b.arbre();
    ecrire(&a.join("a").join("x.mp4"), 42);
    fs::create_dir_all(a.join("b")).unwrap();
    fs::hard_link(a.join("a").join("x.mp4"), a.join("b").join("x — lien.mp4")).unwrap();
    let r = b.scanner(vec![dossier(&a)]);
    if !ids_fiables_ici(&a) {
        eprintln!("identifiants de fichiers non fiables ici : doublons non détectables (essai sauté)");
        return;
    }
    assert_eq!(r.bilan.doublons, 1);
    let p = b.chercher(Requete::default());
    assert_eq!((p.total, p.elements[0].doublons), (1, 1));
    let p = b.chercher(Requete { doublons: true, ..Default::default() });
    assert_eq!(p.total, 2);
    assert_eq!(p.elements.iter().filter(|e| e.doublon_de.is_some()).count(), 1);
    // Le chemin de référence disparaît : l'autre le remplace.
    let reference = p.elements.iter().find(|e| e.doublon_de.is_none()).unwrap().chemin.clone();
    fs::remove_file(&reference).unwrap();
    b.scanner(vec![dossier(&a)]);
    let p = b.chercher(Requete::default());
    assert_eq!((p.total, p.elements[0].doublons), (1, 0));
    assert_ne!(p.elements[0].chemin, reference);
}

#[test]
fn exclusions_caches_types_et_filtres() {
    let b = banc();
    let a = b.arbre();
    let mut ts = vec![0u8; 400];
    ts[0] = 0x47;
    ts[188] = 0x47;
    fs::create_dir_all(&a).unwrap();
    for (n, t) in [
        ("node_modules/a.mp4", 10),
        (".git/b.png", 10),
        (".cache/c.mp3", 10),
        ("sous/Windows/e.mp4", 10),
        ("garde/f.mp4", 10),
        ("._g.mp4", 10),
        (".cachée.mp4", 10),
        ("vide.mp4", 0),
        ("petit.jpg", 3),
    ] {
        ecrire(&a.join(n), t);
    }
    fs::write(a.join("code.ts"), b"export const x: number = 1;\n".repeat(20)).unwrap();
    fs::write(a.join("flux.ts"), &ts).unwrap();
    let r = b.scanner(vec![dossier(&a)]);
    assert_eq!((r.medias.video, r.medias.image, r.medias.audio), (3, 1, 0), "{r:?}");
    assert!(r.exclus >= 3);
    assert_eq!(b.total("flux"), 1, "MPEG-TS reconnu");
    assert_eq!(b.total("code"), 0, "TypeScript ignoré");
    // Exclusion absolue, images désactivées, taille minimale.
    let garde = a.join("garde").to_string_lossy().into_owned();
    let mut ex = Reglages::default().exclusions;
    ex.push(garde);
    b.ix.modifier_reglages(&serde_json::json!({"exclusions": ex, "types": {"image": false}, "tailleMin": 5})).unwrap();
    let r = b.scanner(vec![dossier(&a)]);
    assert_eq!(r.bilan.retires, 2, "{:?}", r.bilan);
    assert_eq!(r.bilan.supprimes, 0, "sortis du périmètre : retirés, pas « supprimés »");
    assert_eq!(b.chercher(Requete::default()).total, 2);
    assert!(a.join("garde/f.mp4").exists() && a.join("petit.jpg").exists());
}

/// Enfant de `reprise_apres_coupure` : lance un scan ralenti et attend d'être tué.
#[test]
#[ignore]
fn enfant_coupure() {
    let Some(base) = std::env::var_os("AETHRYON_ESSAI_COUPURE").map(PathBuf::from) else { return };
    let ix = IndexMedias::demarrer(&base.join("config"), &base.join("R"), volumes_essai(), Box::new(AvisMuet));
    ix.regler_pause(Some(Duration::from_millis(4)));
    ix.lancer_scan(Some(vec![dossier(&base.join("arbre"))])).unwrap();
    ix.attendre_scan(Duration::from_secs(120));
}

#[test]
fn reprise_apres_coupure_reelle() {
    let d = tempfile::tempdir().unwrap();
    let base_dir = d.path().to_path_buf();
    let a = base_dir.join("arbre");
    for i in 0..1200 {
        ecrire(&a.join(format!("d{i:04}")).join("v.mp4"), 9);
        ecrire(&a.join(format!("d{i:04}")).join("s.flac"), 9);
    }
    fs::create_dir_all(base_dir.join("config")).unwrap();
    let mut r = Reglages::default();
    r.metadonnees = false;
    r.miniatures = false;
    r.surveiller = false;
    reglages::enregistrer(&base_dir.join("config"), &r).unwrap();
    let mut enfant = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "index::essais::enfant_coupure", "--ignored", "--test-threads=1"])
        .env("AETHRYON_ESSAI_COUPURE", &base_dir)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let fichier = base_dir.join("R").join("index").join(base::NOM_BASE);
    let lignes = || -> i64 {
        rusqlite::Connection::open_with_flags(&fichier, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .and_then(|c| c.query_row("SELECT count(*) FROM fichiers", [], |r| r.get(0)))
            .unwrap_or(0)
    };
    assert!(attendre(Duration::from_secs(60), || lignes() > 300), "l'enfant n'écrit pas");
    enfant.kill().unwrap();
    let _ = enfant.wait();
    let ecrites = lignes();
    let etat: String = rusqlite::Connection::open(&fichier).unwrap().query_row("SELECT etat FROM scans ORDER BY id DESC LIMIT 1", [], |r| r.get(0)).unwrap();
    assert_eq!(etat, "en-cours", "le processus a bien été tué au milieu du scan");
    assert!(ecrites < 2400, "coupure au milieu ({ecrites} lignes)");
    // Redémarrage : base intègre, scan marqué interrompu, reprise par un scan incrémental.
    let ix = IndexMedias::demarrer(&base_dir.join("config"), &base_dir.join("R"), volumes_essai(), Box::new(AvisMuet));
    let e = ix.etat();
    assert_eq!(e.interrompu.as_ref().map(|c| c.len()), Some(1), "reprise proposée");
    {
        let b = Base::ouvrir(&base_dir.join("R").join("index"), 2000).unwrap();
        assert_eq!(b.integrite(), "ok");
    }
    ix.lancer_scan(e.interrompu).unwrap();
    assert!(ix.attendre_scan(Duration::from_secs(120)));
    let r = ix.resume(None).unwrap();
    assert_eq!((r.etat.as_str(), r.total_medias), ("termine", 2400));
    assert_eq!(r.bilan.nouveaux as i64, 2400 - ecrites, "les lignes déjà écrites sont gardées");
    assert_eq!(ix.bibliotheque(&Requete::default()).unwrap().total, 2400);
    ix.arreter();
}

fn png(chemin: &Path, l: u32, h: u32) {
    let img = image::RgbaImage::from_fn(l, h, |x, y| image::Rgba([(x % 256) as u8, (y % 256) as u8, 128, if x < 10 { 0 } else { 255 }]));
    if let Some(d) = chemin.parent() {
        fs::create_dir_all(d).unwrap();
    }
    img.save(chemin).unwrap();
}

#[test]
fn metadonnees_et_miniatures_progressives() {
    let b = banc_avec(volumes_essai(), true);
    let a = b.arbre();
    for n in ["nocturne.mp3", "ivoire.flac", "sans-etiquette.wav"] {
        fs::copy(crate::musique::etiquettes::essais_fixture(n), a.join(n)).unwrap();
    }
    png(&a.join("dégradé.png"), 800, 600);
    let jpg = image::RgbImage::from_fn(1200, 900, |x, _| image::Rgb([(x % 256) as u8, 40, 90]));
    jpg.save(a.join("photo.jpg")).unwrap();
    fs::write(a.join("clip.mp4"), crate::mesure::essais::mp4(12, 1280, 720, 30, false)).unwrap();
    fs::write(a.join("iphone.heic"), b"\0\0\0\x18ftypheic").unwrap();
    b.scanner(vec![dossier(&a)]);
    assert!(
        attendre(Duration::from_secs(60), || {
            let t = b.ix.etat().totaux;
            t.metadonnees_a_faire == 0 && t.miniatures_a_faire == 0
        }),
        "enrichissement non terminé"
    );
    // Several files share tags (artist, album), so a text search can rank another file first:
    // pick the result whose file name matches, independently of ranking ties.
    let el = |t: &str| {
        b.chercher(Requete { texte: t.into(), ..Default::default() })
            .elements
            .into_iter()
            .find(|e| Path::new(&e.chemin).file_name().map_or(false, |n| n.to_string_lossy().contains(t)))
            .unwrap_or_else(|| panic!("aucun fichier nommé « {t} »"))
    };
    let mp3 = el("nocturne");
    assert_eq!(mp3.titre.as_deref(), Some("Clair de nuit"));
    assert_eq!(mp3.artistes, vec!["Atelier Chouette"]);
    assert_eq!(mp3.album.as_deref(), Some("Nocturnes"));
    assert_eq!(mp3.codec_audio.as_deref(), Some("mp3"));
    assert!(mp3.duree.unwrap() > 1.0);
    assert_eq!(mp3.etat_miniature, "faite", "pochette intégrée → miniature");
    let m = image::open(mp3.miniature.as_ref().unwrap()).unwrap();
    assert!(m.width() <= 320 && m.height() <= 320);
    assert_eq!(b.total("chouette"), 2, "les étiquettes sont cherchables (MP3 et FLAC)");
    assert_eq!(el("ivoire").etat_miniature, "impossible", "FLAC sans pochette");
    let p = el("dégradé");
    assert_eq!((p.largeur, p.hauteur, p.etat_miniature.as_str()), (Some(800), Some(600), "faite"));
    let m = image::open(p.miniature.as_ref().unwrap()).unwrap();
    assert_eq!((m.width(), m.height()), (320, 240));
    assert_eq!(el("photo").etat_miniature, "faite");
    assert_eq!(el("iphone").etat_miniature, "impossible", "HEIC : pas de décodeur");
    let v = el("clip");
    assert_eq!((v.duree, v.largeur, v.hauteur), (Some(12.0), Some(1280), Some(720)));
    assert_eq!(v.etat_miniature, "webview");
    // Carte visible : la vidéo est confiée au WebView2, qui renvoie une image JPEG.
    let demandes = b.ix.demander_miniatures(&[v.id.clone(), mp3.id.clone()]).unwrap();
    assert_eq!(demandes.len(), 1);
    assert_eq!(demandes[0].chemin, v.chemin);
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 80).encode_image(&image::RgbImage::new(480, 270)).unwrap();
    b.ix.enregistrer_analyse(&v.id, &AnalyseWeb { duree: Some(12.0), largeur: Some(1280), hauteur: Some(720), miniature: true, echec: false }, Some(&jpeg)).unwrap();
    let v = el("clip");
    assert_eq!(v.etat_miniature, "faite");
    assert!(Path::new(v.miniature.as_ref().unwrap()).is_file());
    assert!(b.ix.enregistrer_analyse(&v.id, &AnalyseWeb::default(), Some(b"<html>")).is_err(), "seul un JPEG est accepté");
}

#[test]
fn emplacement_deplace_avec_migration_sure() {
    let b = banc_avec(volumes_essai(), true);
    let a = b.arbre();
    png(&a.join("une.png"), 64, 64);
    png(&a.join("deux.png"), 64, 48);
    ecrire(&a.join("trois.mp4"), 10);
    b.scanner(vec![dossier(&a)]);
    assert!(attendre(Duration::from_secs(30), || b.ix.etat().totaux.miniatures_a_faire == 0));
    let ancien = b.ix.emplacement();
    assert!(ancien.join(base::NOM_BASE).is_file());
    let nouveau = b.d.path().join("D").join("AETHRYON").join("Index");
    assert!(b.ix.deplacer_emplacement(&ancien.to_string_lossy()).is_err(), "même emplacement");
    assert!(b.ix.deplacer_emplacement(&ancien.join("sous").to_string_lossy()).is_err(), "dans l'ancien");
    let r = b.ix.deplacer_emplacement(&nouveau.to_string_lossy()).unwrap();
    assert_eq!(PathBuf::from(r), nouveau);
    assert_eq!(b.ix.emplacement(), nouveau);
    assert!(nouveau.join(base::NOM_BASE).is_file() && !ancien.join(base::NOM_BASE).exists());
    assert_eq!(b.ix.reglages().emplacement.as_deref(), Some(nouveau.to_string_lossy().as_ref()));
    let p = b.chercher(Requete { types: vec![TypeMedia::Image], ..Default::default() });
    assert_eq!(p.total, 2);
    for e in &p.elements {
        let m = PathBuf::from(e.miniature.as_ref().unwrap());
        assert!(m.starts_with(&nouveau) && m.is_file(), "miniature déplacée : {m:?}");
    }
    // Le scan suivant écrit au nouvel emplacement ; un dossier qui contient déjà un index est refusé.
    ecrire(&a.join("quatre.mp3"), 10);
    assert_eq!(b.scanner(vec![dossier(&a)]).bilan.nouveaux, 1);
    let autre = b.d.path().join("E");
    fs::create_dir_all(&autre).unwrap();
    fs::write(autre.join(base::NOM_BASE), b"x").unwrap();
    assert!(b.ix.deplacer_emplacement(&autre.to_string_lossy()).is_err());
    assert_eq!(b.ix.emplacement(), nouveau);
}

#[test]
fn disque_debranche_indisponible_puis_rebranche_ailleurs() {
    let d0 = tempfile::tempdir().unwrap();
    let disque = d0.path().join("disque");
    for n in ["Rushes/a.mp4", "Rushes/b.mov", "Sons/c.wav"] {
        ecrire(&disque.join(n), 20);
    }
    let cle = volumes::volume_de(&disque, &[]).cle;
    let mut v = Volume::vide(&disque.to_string_lossy(), GenreVolume::Amovible);
    v.disponible = true;
    v.cle = Some(cle.clone());
    v.ids_fiables = true;
    v.nom = Some("CLÉ USB".into());
    let source = Arc::new(VolumesFixes(M::new(vec![v.clone()])));
    struct Partagee(Arc<VolumesFixes>);
    impl SourceVolumes for Partagee {
        fn lister(&self) -> Vec<Volume> {
            self.0.lister()
        }
    }
    let b = banc_avec(Box::new(Partagee(source.clone())), false);
    let cible = Cible { genre: GenreCible::Volume, chemin: disque.to_string_lossy().into_owned() };
    assert_eq!(b.scanner(vec![cible.clone()]).total_medias, 3);
    let vi = b.ix.volumes().unwrap();
    assert_eq!(vi[0].indexe.fichiers, 3);
    // Débranché : le volume disparaît de l'énumération.
    let ailleurs = d0.path().join("disque-F");
    fs::rename(&disque, &ailleurs).unwrap();
    source.0.lock().unwrap().clear();
    b.ix.volumes().unwrap();
    let t = b.ix.etat().totaux;
    assert_eq!((t.indisponibles, t.absents, t.total), (3, 0, 3), "indisponibles, jamais supprimés");
    assert_eq!(b.chercher(Requete { etats: vec![EtatFichier::Present], ..Default::default() }).total, 0);
    assert!(b.chercher(Requete::default()).elements.iter().all(|e| e.etat == EtatFichier::Indisponible));
    // Scan pendant l'absence : volume connu mais indisponible → rien n'est effacé.
    let mut absent = v.clone();
    absent.disponible = false;
    absent.message = Some("Aucun média dans le lecteur.".into());
    *source.0.lock().unwrap() = vec![absent];
    let r = b.scanner(vec![cible]);
    assert_eq!(r.volumes_indisponibles.len(), 1, "{r:?}");
    assert_eq!(b.ix.etat().totaux.absents, 0);
    // Rebranché sous une autre « lettre » : même volume (même clé), chemins réécrits.
    let mut f = v.clone();
    f.racine = ailleurs.to_string_lossy().into_owned();
    *source.0.lock().unwrap() = vec![f];
    b.ix.volumes().unwrap();
    let p = b.chercher(Requete::default());
    assert_eq!(p.total, 3);
    assert!(p.elements.iter().all(|e| e.etat == EtatFichier::Present && e.chemin.starts_with(&*ailleurs.to_string_lossy()) && Path::new(&e.chemin).is_file()), "{p:?}");
    let r = b.scanner(vec![Cible { genre: GenreCible::Volume, chemin: ailleurs.to_string_lossy().into_owned() }]);
    assert_eq!((r.bilan.nouveaux, r.bilan.supprimes, r.bilan.inchanges), (0, 0, 3), "{:?}", r.bilan);
}

#[test]
fn deux_cles_usb_tour_a_tour_sur_la_meme_lettre() {
    let d0 = tempfile::tempdir().unwrap();
    let e = d0.path().join("E");
    for n in ["DCIM/a1.jpg", "DCIM/a2.jpg", "Musique/m.mp3"] {
        ecrire(&e.join(n), 10);
    }
    let cle_a = |c: &str| {
        let mut v = Volume::vide(&e.to_string_lossy(), GenreVolume::Amovible);
        v.disponible = true;
        v.cle = Some(c.into());
        v.ids_fiables = true;
        v
    };
    let source = Arc::new(VolumesFixes(M::new(vec![cle_a("serie:aaaa0001")])));
    struct Partagee(Arc<VolumesFixes>);
    impl SourceVolumes for Partagee {
        fn lister(&self) -> Vec<Volume> {
            self.0.lister()
        }
    }
    let b = banc_avec(Box::new(Partagee(source.clone())), false);
    let cible = Cible { genre: GenreCible::Volume, chemin: e.to_string_lossy().into_owned() };
    assert_eq!(b.scanner(vec![cible.clone()]).total_medias, 3);
    // Clé A retirée, clé B branchée sous la même « lettre » : un a1.jpg différent, un b1.jpg.
    fs::rename(&e, d0.path().join("clé A")).unwrap();
    ecrire(&e.join("DCIM/a1.jpg"), 77);
    ecrire(&e.join("DCIM/b1.jpg"), 78);
    *source.0.lock().unwrap() = vec![cle_a("serie:bbbb0002")];
    b.ix.volumes().unwrap();
    let r = b.scanner(vec![cible.clone()]);
    assert_eq!((r.bilan.nouveaux, r.bilan.retires, r.bilan.supprimes), (2, 2, 0), "{:?}", r.bilan);
    let p = b.chercher(Requete::default());
    assert_eq!(p.total, 3, "2 fichiers de B présents, la musique de A indisponible");
    assert!(p.elements.iter().any(|x| x.nom == "m" && x.etat == EtatFichier::Indisponible));
    assert_eq!(p.elements.iter().find(|x| x.nom == "a1").unwrap().taille, 77, "jamais confondu avec le a1.jpg de A");
    // Retour de A : sa musique redevient présente ; son DCIM est réindexé.
    fs::rename(&e, d0.path().join("clé B")).unwrap();
    fs::rename(d0.path().join("clé A"), &e).unwrap();
    *source.0.lock().unwrap() = vec![cle_a("serie:aaaa0001")];
    b.ix.volumes().unwrap();
    let r = b.scanner(vec![cible]);
    assert_eq!((r.bilan.nouveaux, r.bilan.retires, r.bilan.supprimes), (2, 2, 0), "{:?}", r.bilan);
    let p = b.chercher(Requete::default());
    assert_eq!(p.total, 3);
    assert!(p.elements.iter().all(|x| x.etat == EtatFichier::Present && x.taille == 10));
}

#[test]
fn bibliotheque_unifiee_avec_sources() {
    use crate::bibliotheque::{self as bib, DossierIndex, Index as IndexBib, Suivi};
    let b = banc();
    let a = b.arbre();
    let surveille = a.join("Téléchargements AETHRYON");
    for n in ["Coucher de soleil.mp4", "Nappe sonore.wav"] {
        ecrire(&surveille.join(n), 30);
        let t = std::time::SystemTime::now() - Duration::from_secs(3600);
        fs::File::options().write(true).open(surveille.join(n)).unwrap().set_modified(t).unwrap();
    }
    ecrire(&a.join("Rushes").join("plan large.mov"), 40);
    let ds = vec![DossierIndex { chemin: surveille.to_string_lossy().into_owned(), principal: true }];
    let (f, _) = bib::lister_fichiers(&[ds[0].chemin.clone()], &[]);
    let index = bib::passer(&IndexBib::default(), &mut Suivi::default(), &ds, f, chrono::Utc::now(), true).index;
    assert_eq!(index.medias.len(), 2);
    assert!(b.ix.synchroniser_bibliotheque(&index.medias).unwrap() > 0);
    assert_eq!(b.ix.synchroniser_bibliotheque(&index.medias).unwrap(), 0, "rien ne change : rien n'est réécrit");
    let p = b.chercher(Requete::default());
    assert_eq!(p.total, 2);
    assert!(p.elements.iter().all(|e| e.sources == vec![Source::Bibliotheque] && e.etat_bibliotheque == Some(crate::bibliotheque::EtatMedia::Disponible)));
    assert_eq!(p.elements.iter().find(|e| e.ext == "mp4").unwrap().id, index.medias.iter().find(|m| m.ext == "mp4").unwrap().id, "même identifiant qu'index.json");
    assert_eq!(b.ix.rechercher(&Requete::default()).unwrap().total, 0, "rechercher : l'index seul");
    // Scan d'un dossier qui contient le dossier surveillé : aucune ligne en double, deux sources.
    b.scanner(vec![dossier(&a)]);
    let p = b.chercher(Requete::default());
    assert_eq!(p.total, 3);
    let mp4 = p.elements.iter().find(|e| e.ext == "mp4").unwrap();
    assert_eq!(mp4.sources, vec![Source::Index, Source::Bibliotheque]);
    assert_eq!(b.chercher(Requete { sources: vec![Source::Bibliotheque], ..Default::default() }).total, 2);
    // Média sorti d'index.json : il garde sa source « index ».
    let reste: Vec<Media> = index.medias.iter().filter(|m| m.ext != "mp4").cloned().collect();
    b.ix.synchroniser_bibliotheque(&reste).unwrap();
    let p = b.chercher(Requete { texte: "coucher".into(), ..Default::default() });
    assert_eq!(p.elements[0].sources, vec![Source::Index]);
    assert_eq!(p.elements[0].etat_bibliotheque, None);
}

#[test]
fn surveillance_en_direct_d_un_dossier_cible() {
    let b = banc();
    let a = b.arbre();
    ecrire(&a.join("existant.mp4"), 10);
    b.ix.modifier_reglages(&serde_json::json!({"cibles": [{"genre": "dossier", "chemin": a.to_string_lossy()}], "surveiller": true})).unwrap();
    b.scanner(vec![dossier(&a)]);
    assert_eq!(b.ix.etat().veille.len(), 1);
    std::thread::sleep(Duration::from_millis(300));
    let present = |t: &str| b.total(t) == 1;
    ecrire(&a.join("nouveau.mp4"), 11);
    assert!(attendre(Duration::from_secs(20), || present("nouveau")), "ajout vu en direct");
    fs::rename(a.join("nouveau.mp4"), a.join("renommé.mp4")).unwrap();
    assert!(attendre(Duration::from_secs(20), || present("renommé") && !present("nouveau")), "renommage vu en direct");
    fs::remove_file(a.join("renommé.mp4")).unwrap();
    assert!(attendre(Duration::from_secs(20), || !present("renommé")), "suppression vue en direct");
    // Dossier entier déposé d'un coup.
    let dehors = b.d.path().join("album");
    for n in ["1.flac", "2.flac", "3.flac"] {
        ecrire(&dehors.join(n), 12);
    }
    fs::rename(&dehors, a.join("album")).unwrap();
    assert!(attendre(Duration::from_secs(20), || b.chercher(Requete { types: vec![TypeMedia::Audio], ..Default::default() }).total == 3), "dossier déposé vu en direct");
    b.ix.arreter();
}

#[test]
fn volumes_du_systeme() {
    // Un lecteur qui ne répond pas en 4 s (machine chargée) est « indisponible » : on réessaie deux fois.
    let mut v = volumes::lister_systeme();
    for _ in 0..2 {
        if !cfg!(windows) || v.iter().any(|x| x.lettre.as_deref() == Some("C") && x.disponible) {
            break;
        }
        eprintln!("énumération lente, nouvel essai : {v:?}");
        v = volumes::lister_systeme();
    }
    for x in &v {
        eprintln!(
            "volume {} lettre={:?} nom={:?} genre={:?} fs={:?} dispo={} taille={:?} libre={:?} cle={:?} ids={} msg={:?}",
            x.racine, x.lettre, x.nom, x.genre, x.systeme_fichiers, x.disponible, x.taille, x.libre, x.cle, x.ids_fiables, x.message
        );
    }
    assert!(v.iter().any(|x| x.disponible), "au moins un volume disponible");
    #[cfg(windows)]
    {
        let c = v.iter().find(|x| x.lettre.as_deref() == Some("C")).expect("C: absent");
        assert!(c.disponible && c.genre == GenreVolume::Fixe && c.cle.is_some() && c.taille.unwrap_or(0) > 0);
    }
}

#[test]
fn identifiants_de_fichiers_stables_au_renommage() {
    let d = tempfile::tempdir().unwrap();
    ecrire(&d.path().join("a.mp4"), 1);
    ecrire(&d.path().join("b.mp4"), 1);
    let fid = |nom: &str| parcours::lire_dossier(d.path(), false).unwrap().entrees.into_iter().find(|e| e.nom == nom).and_then(|e| e.fid);
    let l = parcours::lire_dossier(d.path(), false).unwrap();
    assert!(l.identite.is_some(), "identité du dossier (volume + identifiant)");
    let (a, b2) = (fid("a.mp4"), fid("b.mp4"));
    eprintln!("identifiants : a={a:?} b={b2:?} dossier={:?}", l.identite);
    assert!(a.is_some() && b2.is_some() && a != b2);
    fs::rename(d.path().join("a.mp4"), d.path().join("c.mp4")).unwrap();
    assert_eq!(fid("c.mp4"), a, "même identifiant après renommage");
}

#[test]
fn cibles_resolues_sans_doublon() {
    let mut v = Volume::vide("/", GenreVolume::Fixe);
    v.disponible = true;
    let tous = resoudre_cibles(&[Cible { genre: GenreCible::Tous, chemin: String::new() }], &[v]);
    assert_eq!(tous, vec![PathBuf::from("/")]);
    #[cfg(unix)]
    {
        let r = resoudre_cibles(
            &[
                Cible { genre: GenreCible::Dossier, chemin: "/srv/medias/rushes".into() },
                Cible { genre: GenreCible::Dossier, chemin: "/srv/medias".into() },
                Cible { genre: GenreCible::Dossier, chemin: "/srv/medias 2".into() },
                Cible { genre: GenreCible::Dossier, chemin: "/srv/medias/".into() },
            ],
            &[],
        );
        assert_eq!(r, vec![PathBuf::from("/srv/medias"), PathBuf::from("/srv/medias 2")]);
    }
}

#[cfg(windows)]
#[test]
fn everything_factice_par_wm_copydata() {
    use std::sync::atomic::AtomicU32;
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::DataExchange::COPYDATASTRUCT;
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;
    static RECHERCHE: M<String> = M::new(String::new());
    static FENETRE: AtomicU32 = AtomicU32::new(0);
    fn fixture() -> Vec<everything::ElementEverything> {
        (0..7)
            .map(|i| everything::ElementEverything {
                chemin: format!("C:\\Médias\\Été {i}\\plage — côte {i}.mp4"),
                dossier: false,
                taille: Some(1000 + i),
                cree_ms: Some(1_700_000_000_000),
                modifie_ms: Some(1_700_000_000_000 + i as i64),
                attributs: Some(0x20),
            })
            .collect()
    }
    unsafe extern "system" fn proc_factice(h: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
        if msg == everything::WM_IPC {
            return match w {
                0 => 1,
                1 => 4,
                2 => 1,
                3 => 1024,
                401 => 1,
                _ => 0,
            };
        }
        if msg == WM_COPYDATA {
            let cds = unsafe { &*(l as *const COPYDATASTRUCT) };
            if cds.dwData != everything::COPYDATA_QUERY2W {
                return 0;
            }
            let b = unsafe { std::slice::from_raw_parts(cds.lpData as *const u8, cds.cbData as usize) };
            let u = |i: usize| u32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]);
            let (reponse, id, decalage, max) = (u(0), u(4), u(12) as usize, u(16) as usize);
            let texte: Vec<u16> = b[28..b.len() - 2].chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
            *RECHERCHE.lock().unwrap() = String::from_utf16_lossy(&texte);
            let tous = fixture();
            let page: Vec<_> = tous.iter().skip(decalage).take(max).cloned().collect();
            let corps = everything::encoder_reponse(tous.len() as u32, decalage as u32, &page);
            let r = COPYDATASTRUCT { dwData: id as usize, cbData: corps.len() as u32, lpData: corps.as_ptr() as *mut core::ffi::c_void };
            unsafe { SendMessageW(reponse as usize as HWND, WM_COPYDATA, h as WPARAM, &r as *const COPYDATASTRUCT as LPARAM) };
            return 1;
        }
        unsafe { DefWindowProcW(h, msg, w, l) }
    }
    let serveur = std::thread::spawn(|| unsafe {
        let classe: Vec<u16> = "EVERYTHING_TASKBAR_NOTIFICATION\0".encode_utf16().collect();
        let mut wc: WNDCLASSEXW = std::mem::zeroed();
        wc.cbSize = std::mem::size_of::<WNDCLASSEXW>() as u32;
        wc.lpfnWndProc = Some(proc_factice);
        wc.hInstance = GetModuleHandleW(std::ptr::null());
        wc.lpszClassName = classe.as_ptr();
        RegisterClassExW(&wc);
        // Fenêtre « message seulement » : Wine sans affichage ne crée pas de fenêtre de premier niveau.
        let h = CreateWindowExW(0, classe.as_ptr(), std::ptr::null(), 0, 0, 0, 0, 0, HWND_MESSAGE, std::ptr::null_mut(), wc.hInstance, std::ptr::null());
        assert!(!h.is_null());
        FENETRE.store(h as usize as u32, Ordering::SeqCst);
        let mut m: MSG = std::mem::zeroed();
        while GetMessageW(&mut m, std::ptr::null_mut(), 0, 0) > 0 {
            DispatchMessageW(&m);
        }
    });
    assert!(attendre(Duration::from_secs(10), || FENETRE.load(Ordering::SeqCst) != 0));
    let e = everything::detecter();
    assert!(e.disponible && e.base_chargee, "{e:?}");
    assert_eq!(e.version.as_deref(), Some("1.4.1.1024"));
    let mut recus = Vec::new();
    let mut totaux = Vec::new();
    let n = everything::lister("C:\\Médias", &["mp4".into()], &AtomicBool::new(false), 3, &mut |page, total| {
        recus.extend(page.iter().cloned());
        totaux.push(total);
        true
    })
    .unwrap();
    assert_eq!(n, 7);
    assert_eq!(totaux, vec![7, 7, 7], "trois pages de 3 au plus");
    assert_eq!(recus, fixture(), "chemins Unicode, tailles et dates intacts");
    assert_eq!(*RECHERCHE.lock().unwrap(), "file: ext:mp4 \"C:\\Médias\\\"");
    unsafe { PostMessageW(FENETRE.load(Ordering::SeqCst) as usize as HWND, WM_QUIT, 0, 0) };
    let _ = serveur.join();
}

/// Mesure de débit (ignorée par défaut) : `cargo test -p aethryon-noyau --release mesure_debit -- --ignored --nocapture`.
#[test]
#[ignore]
fn mesure_debit() {
    let n_dossiers: usize = std::env::var("AETHRYON_MESURE_DOSSIERS").ok().and_then(|v| v.parse().ok()).unwrap_or(2000);
    let b = banc();
    let a = b.arbre();
    let t = Instant::now();
    let mut fichiers = 0usize;
    for i in 0..n_dossiers {
        let s = a.join(format!("g{:02}", i % 50)).join(format!("d{i:05}"));
        fs::create_dir_all(&s).unwrap();
        for k in 0..25 {
            let ext = ["mp4", "mp3", "jpg", "png", "txt"][k % 5];
            fs::write(s.join(format!("f{k:02}.{ext}")), b"x").unwrap();
            fichiers += 1;
        }
    }
    eprintln!("arbre : {fichiers} fichiers, {n_dossiers} dossiers, créé en {:.1} s", t.elapsed().as_secs_f64());
    let rss = || {
        fs::read_to_string("/proc/self/status")
            .ok()
            .and_then(|s| s.lines().find(|l| l.starts_with("VmHWM")).map(|l| l.split_whitespace().nth(1).unwrap_or("0").parse::<u64>().unwrap_or(0)))
            .unwrap_or(0)
    };
    let rss0 = rss();
    let r = b.scanner(vec![dossier(&a)]);
    eprintln!(
        "scan initial : {} fichiers vus, {} médias, {} ms, {:.0} fichiers/s, RSS max {} Mo (avant {} Mo)",
        r.fichiers_vus,
        r.total_medias,
        r.duree_ms,
        r.debit,
        rss() / 1024,
        rss0 / 1024
    );
    let r2 = b.scanner(vec![dossier(&a)]);
    eprintln!("scan incrémental : {} ms, {:.0} fichiers/s, {} inchangés", r2.duree_ms, r2.debit, r2.bilan.inchanges);
    for q in ["f07", "f1", "d01234"] {
        let t = Instant::now();
        let p = b.chercher(Requete { texte: q.into(), ..Default::default() });
        eprintln!("recherche « {q} » : {} résultats, {:.2} ms (base) / {:.2} ms (appel)", p.total, p.duree_ms, t.elapsed().as_secs_f64() * 1000.0);
    }
    let t = Instant::now();
    let p = b.chercher(Requete { tri: Tri::Nom, page: 50, taille_page: 100, ..Default::default() });
    eprintln!("page 50 triée par nom : {} éléments sur {}, {:.2} ms", p.elements.len(), p.total, t.elapsed().as_secs_f64() * 1000.0);
    let taille = fs::metadata(b.ix.emplacement().join(base::NOM_BASE)).map(|m| m.len()).unwrap_or(0);
    eprintln!("index : {:.1} Mo ({:.0} octets par média)", taille as f64 / 1048576.0, taille as f64 / r.total_medias.max(1) as f64);
}
