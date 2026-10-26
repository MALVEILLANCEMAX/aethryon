/* SEULEMENT POUR L'ESSAI SOUS WINE 8 (Debian bookworm), qui ne fournit pas bcryptprimitives.dll : la bibliothèque
   standard de Rust l'emploie (ProcessPrng) et Windows 10/11 la fournissent. Ce remplaçant appelle RtlGenRandom
   (advapi32!SystemFunction036). Il est copié dans le system32 de Wine, jamais livré avec AETHRYON. */
#include <windows.h>
BOOLEAN WINAPI SystemFunction036(PVOID buffer, ULONG len);
__declspec(dllexport) BOOL WINAPI ProcessPrng(PBYTE data, SIZE_T len) {
  return SystemFunction036(data, (ULONG)len);
}
