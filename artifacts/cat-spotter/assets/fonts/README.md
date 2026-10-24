# Web fonts (SYC-148)

Subset WOFF2 copies of Inter (400/500/600/700/800) and Space Mono (400/700),
used by the website only (`lib/fontSources.web.ts`). The phone apps use the
full TTFs from `@expo-google-fonts` (`lib/fontSources.ts`).

Regenerate from the TTFs in `node_modules/@expo-google-fonts/*` with
fonttools (`pip install fonttools brotli`):

    pyftsubset <font>.ttf --flavor=woff2 \
      --unicodes="U+0020-007E,U+00A0-00FF,U+0100-017F,U+0300-036F,U+0370-03FF,U+200B,U+2010-2027,U+2030-203A,U+20AC,U+2122,U+2190-2193,U+2212,U+2022,U+2248,U+2460-2473,U+2713,U+2764,U+FEFF" \
      --layout-features='kern,liga,calt,ccmp,locl,mark,mkmk,tnum,case,zero' \
      --output-file=<name>.woff2

If a new language or symbol is added to the app, add its range here.

Licences: `Inter-OFL.txt` and `SpaceMono-OFL.txt` (SIL Open Font License) travel with the files.
