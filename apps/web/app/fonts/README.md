# Bundled fonts

These unmodified Latin WOFF2 subsets are served locally through `next/font/local`. Builds and browser rendering do not contact a font CDN. IBM Plex Sans uses its weight axis (100–700); Plex Mono keeps the previous 400/500/600 faces; Instrument Serif keeps regular and italic 400. Characters outside these Latin subsets use the existing system fallback fonts.

Only Sans is preloaded globally. Mono and the display serif load when used.

## Sources and licenses

- [@fontsource-variable/ibm-plex-sans 5.3.0](https://registry.npmjs.org/@fontsource-variable/ibm-plex-sans/-/ibm-plex-sans-5.3.0.tgz), SIL Open Font License 1.1: `ibm-plex-sans-OFL.txt`.
- [@fontsource/ibm-plex-mono 5.3.0](https://registry.npmjs.org/@fontsource/ibm-plex-mono/-/ibm-plex-mono-5.3.0.tgz), SIL Open Font License 1.1: `ibm-plex-mono-OFL.txt`.
- [@fontsource/instrument-serif 5.3.0](https://registry.npmjs.org/@fontsource/instrument-serif/-/instrument-serif-5.3.0.tgz), SIL Open Font License 1.1: `instrument-serif-OFL.txt`.

Upstream typefaces: [IBM Plex](https://github.com/IBM/plex) and [Instrument Serif](https://github.com/Instrument/instrument-serif). Fontsource distributes the subsets without changing their font names.

## Asset SHA-256

```text
08949f728dc52d528e69b1667d15c89a5686a4ee9a296ff90983985f99c380f7  ibm-plex-mono-latin-400-normal.woff2
01d285447409c8a588692162439a038b8cbd7871309ee20267b0d2d91c6e8e22  ibm-plex-mono-latin-500-normal.woff2
0d1f0b8d0722224e32e9f28261bdc86c79115be73444ae5eceb73976a1bcdf83  ibm-plex-mono-latin-600-normal.woff2
e2291e842cf5af167122a22881a740c7f2dda7716f1e8cd76680264f4a859470  ibm-plex-sans-latin-wght-normal.woff2
5a51946dfffa82972bc98745359c46761515641fda557c25116459a9f83da4a7  instrument-serif-latin-400-italic.woff2
5eb09b5ac0e28b67c2f041c8ba6d244604ca0c0980d65912ab2d47fed84ddc31  instrument-serif-latin-400-normal.woff2
```
