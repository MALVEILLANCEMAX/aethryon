//! Priorité basse des fils de l'index (parcours, écriture, métadonnées, miniatures).
//!
//! Windows : `SetThreadPriority(THREAD_MODE_BACKGROUND_BEGIN)` abaisse à la fois la priorité processeur, la priorité
//! d'E/S et la priorité mémoire DU FIL (mode « arrière-plan » documenté par Microsoft pour ce genre de travail). Le
//! processus entier n'est PAS mis en arrière-plan (`PROCESS_MODE_BACKGROUND_BEGIN`) : cela ralentirait aussi le fil de
//! l'interface, la surveillance des dossiers et le battement de 2 s attendu par le panneau Premiere (contrat §4).
//! Linux (essais) : `nice` 10 sur le fil et classe d'E/S « idle ».

/// Abaisse la priorité du fil appelant. Renvoie vrai si le système l'a accepté. Sous Windows, coupe aussi les
/// erreurs critiques de CE fil : un disque retiré pendant le scan ne fait jamais apparaître « Insérez un disque ».
pub fn basse() -> bool {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Diagnostics::Debug::{SetThreadErrorMode, SEM_FAILCRITICALERRORS};
        use windows_sys::Win32::System::Threading::{GetCurrentThread, SetThreadPriority, THREAD_MODE_BACKGROUND_BEGIN};
        unsafe {
            SetThreadErrorMode(SEM_FAILCRITICALERRORS, std::ptr::null_mut());
            SetThreadPriority(GetCurrentThread(), THREAD_MODE_BACKGROUND_BEGIN) != 0
        }
    }
    #[cfg(target_os = "linux")]
    {
        unsafe {
            let tid = libc::syscall(libc::SYS_gettid) as libc::id_t;
            let a = libc::setpriority(libc::PRIO_PROCESS, tid, 10) == 0;
            // ioprio_set(IOPRIO_WHO_PROCESS = 1, tid, IOPRIO_CLASS_IDLE (3) << 13)
            let b = libc::syscall(libc::SYS_ioprio_set, 1, tid as libc::c_long, (3i64 << 13) as libc::c_long) == 0;
            a || b
        }
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        false
    }
}
