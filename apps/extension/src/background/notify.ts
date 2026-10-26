// Notifications facultatives (fin de téléchargement, échec). La permission « notifications » est
// optionnelle : elle n'est JAMAIS demandée ici (la page de réglages la demande sur un geste de
// l'utilisateur) ; sans elle, ou sans l'option activée, rien n'est affiché.
import { getSettings } from "../shared/storage.ts";
import type { JobView } from "../shared/types.ts";
import { PLATFORM_LABEL } from "../shared/urls.ts";
import { typo } from "./errors.ts";

const DONE = { file: "Téléchargement terminé", gif: "GIF enregistré", frame: "Image enregistrée", thumb: "Miniature enregistrée" } as const;

export async function notifyJob(job: JobView): Promise<boolean> {
  if (job.state !== "done" && job.state !== "error") return false;
  try {
    if (!(await getSettings()).notifications) return false;
    if (!(await chrome.permissions.contains({ permissions: ["notifications"] }))) return false;
    const api = (chrome as { notifications?: typeof chrome.notifications }).notifications;
    if (!api?.create) return false;
    const what = job.title || job.fileName || `Vidéo ${PLATFORM_LABEL[job.platform]}`;
    const options: chrome.notifications.NotificationCreateOptions = {
      type: "basic",
      iconUrl: chrome.runtime.getURL("assets/icons/icon-128.png"),
      title: job.state === "done" ? "AETHRYON" : typo("AETHRYON : échec du téléchargement"),
      message: job.state === "done" ? typo(`${DONE[job.kind ?? "file"]} : ${what}`) : typo(`${what} : ${job.error?.message ?? "le téléchargement a échoué."}`),
      priority: 0,
    };
    await api.create(`aethryon-${job.key}`, options);
    return true;
  } catch {
    return false;
  }
}
