# Licences de code tiers inclus dans le site

## Arc — composant « Password strength »

Utilisé, adapté, dans `src/ui/PasswordStrength.tsx` (voir l'en-tête du fichier pour les modifications).
Source : https://uiarc.dev/components/password-strength (partie gratuite d'Arc, dépôt `kuratlielia/arc-library`).

```
MIT License

Copyright (c) 2026 Elia Kuratli

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Cap — widget de vérification et WebAssembly (`@cap.js/widget` 0.1.58, `@cap.js/wasm` 0.0.8)

Utilisés sans modification par `src/lib/verification.ts` (widget chargé seulement quand le serveur exige une
vérification) ; fichiers WebAssembly copiés dans `public/cap/wasm/` par `scripts/cap-wasm.mjs`. Le serveur Cap
(image `tiago2/cap`, même auteur, même licence) tourne dans son propre conteneur (docs/SECURITE-ANTIBOT.md).
Source : https://github.com/tiagozip/cap — https://capjs.js.org/

```
Copyright 2025 Tiago

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
