//! Comparaison de versions à la SemVer : `2.0.0-beta.1 < 2.0.0-beta.2 < 2.0.0 < 2.0.1`. Les versions de fichier de
//! Windows (`26.5.2.13`) gardent leurs quatre nombres.

use std::cmp::Ordering;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Version {
    pub nombres: Vec<u64>,
    pub pre: Vec<String>,
}

pub fn lire(v: &str) -> Option<Version> {
    let v = v.trim().trim_start_matches(['v', 'V']);
    let (base, pre) = match v.split_once('-') {
        Some((b, p)) => (b, p.split('.').map(str::to_string).collect()),
        None => (v, Vec::new()),
    };
    let base = base.split('+').next()?;
    let nombres: Option<Vec<u64>> = base.split('.').map(|x| x.parse().ok()).collect();
    let nombres = nombres?;
    if nombres.is_empty() {
        return None;
    }
    Some(Version { nombres, pre })
}

fn cmp_pre(a: &[String], b: &[String]) -> Ordering {
    match (a.is_empty(), b.is_empty()) {
        (true, true) => return Ordering::Equal,
        (true, false) => return Ordering::Greater,
        (false, true) => return Ordering::Less,
        _ => {}
    }
    for (x, y) in a.iter().zip(b.iter()) {
        let o = match (x.parse::<u64>(), y.parse::<u64>()) {
            (Ok(i), Ok(j)) => i.cmp(&j),
            (Ok(_), Err(_)) => Ordering::Less,
            (Err(_), Ok(_)) => Ordering::Greater,
            _ => x.cmp(y),
        };
        if o != Ordering::Equal {
            return o;
        }
    }
    a.len().cmp(&b.len())
}

impl Ord for Version {
    fn cmp(&self, o: &Self) -> Ordering {
        let n = self.nombres.len().max(o.nombres.len());
        for i in 0..n {
            let a = self.nombres.get(i).copied().unwrap_or(0);
            let b = o.nombres.get(i).copied().unwrap_or(0);
            if a != b {
                return a.cmp(&b);
            }
        }
        cmp_pre(&self.pre, &o.pre)
    }
}

impl PartialOrd for Version {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}

/// `Some(Ordering)` si les deux versions sont lisibles.
pub fn comparer(a: &str, b: &str) -> Option<Ordering> {
    Some(lire(a)?.cmp(&lire(b)?))
}

/// Vrai si `v` est dans l'intervalle CEP `[min,max]` (bornes incluses ; `[25.0,99.9]`). Une borne absente est ouverte.
pub fn dans_intervalle(v: &str, intervalle: &str) -> Option<bool> {
    let x = lire(v)?;
    let i = intervalle.trim();
    if !(i.starts_with('[') || i.starts_with('(')) {
        // Version simple : « au moins ».
        return Some(x >= lire(i)?);
    }
    let incl_min = i.starts_with('[');
    let incl_max = i.ends_with(']');
    let corps = i.trim_start_matches(['[', '(']).trim_end_matches([']', ')']);
    let (a, b) = corps.split_once(',')?;
    let mut ok = true;
    if !a.trim().is_empty() {
        let m = lire(a)?;
        ok &= if incl_min { x >= m } else { x > m };
    }
    if !b.trim().is_empty() {
        // `99.9` couvre 99.9.x.y : on compare sur le même nombre de composantes que la borne.
        let m = lire(b)?;
        let tronque = Version { nombres: x.nombres.iter().copied().take(m.nombres.len()).collect(), pre: Vec::new() };
        ok &= if incl_max { tronque <= m } else { tronque < m };
    }
    Some(ok)
}

#[cfg(test)]
mod essais {
    use super::*;

    #[test]
    fn ordre_semver() {
        let l = ["1.0.0-beta.2", "1.0.0", "2.0.0-alpha", "2.0.0-beta.1", "2.0.0-beta.2", "2.0.0-beta.10", "2.0.0", "2.0.1", "10.0.0"];
        for w in l.windows(2) {
            assert_eq!(comparer(w[0], w[1]), Some(Ordering::Less), "{} < {}", w[0], w[1]);
        }
        assert_eq!(comparer("2.0.0-beta.1", "2.0.0-beta.1"), Some(Ordering::Equal));
        assert_eq!(comparer("26.5.2.13", "26.5.2"), Some(Ordering::Greater));
        assert_eq!(comparer("abc", "1.0"), None);
    }

    #[test]
    fn intervalles_cep() {
        assert_eq!(dans_intervalle("26.5.2.13", "[25.0,99.9]"), Some(true));
        assert_eq!(dans_intervalle("25.0.0.48", "[25.0,99.9]"), Some(true));
        assert_eq!(dans_intervalle("24.6.4.2", "[25.0,99.9]"), Some(false));
        assert_eq!(dans_intervalle("99.9.7.1", "[25.0,99.9]"), Some(true));
        assert_eq!(dans_intervalle("100.0.0.1", "[25.0,99.9]"), Some(false));
        assert_eq!(dans_intervalle("26.0", "25.0"), Some(true));
        assert_eq!(dans_intervalle("illisible", "[25.0,99.9]"), None);
    }
}
