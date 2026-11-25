import { defineMessages } from '../../i18n/local'

export const aboutMessages = defineMessages({
  ja: {
    title: 'Bani について',
    what: 'Bani は、動画・音声・画像・PDF・テキスト・アーカイブを変換したり、少し直したりするためのアプリです。',
    privacy:
      'ファイルはどこにも送りません。読み込み・変換・保存はすべてこのブラウザの中で行い、一度開けばオフラインでも動きます。',
    version: (version: string) => `版 ${version}`,
    source: 'ソースコード',
    licensesTitle: 'ライセンス',
    licensesIntro:
      'Bani は次のオープンソースのソフトウェアを使っています。名前を押すと、ライセンスの本文を開きます。リンクは押したときだけ開き、この画面が自分から外へ取りに行くことはありません。',
    packagesTitle: 'パッケージ',
    embeddedTitle: 'WASM に組み込まれているライブラリ',
    embeddedIntro: 'ほかのパッケージの WASM の中に組み込まれて配られているものです。本文は各サイトにあります。',
    embeddedIn: (name: string) => `${name} に組み込み`,
    author: '作者',
    homepage: 'サイト',
    noText: 'パッケージにライセンスの本文が含まれていません。上の識別子のライセンスに従います。',
    lgplTitle: 'LGPL のライブラリについて',
    lgplHeif:
      'HEIC の読み込みに使う libheif（libheif-js、その中の libde265）は LGPL-3.0 です。Bani はこれを改変せず、HEIC を開いたときにだけ読み込む別のファイル（JS と WASM）として配っています。ソースは github.com/strukturag/libheif と github.com/catdad-experiments/libheif-js から入手でき、同じ名前のファイルを置き換えれば、ほかの版に差し替えて動かせます。',
    lgplLame:
      'MP3 の書き出しに使う LAME は LGPL です。@mediabunny/mp3-encoder の WASM に組み込まれたまま、改変せずに使っています。ソースは lame.sourceforge.io から入手できます。',
  },
  en: {
    title: 'About Bani',
    what: 'Bani converts and lightly edits video, audio, images, PDFs, text, and archives.',
    privacy:
      'Your files are never uploaded. Reading, converting, and saving all happen inside this browser, and it keeps working offline once loaded.',
    version: (version: string) => `Version ${version}`,
    source: 'Source code',
    licensesTitle: 'Licenses',
    licensesIntro:
      'Bani uses the following open-source software. Select a name to read its license. Links open only when you select them; this page never fetches anything on its own.',
    packagesTitle: 'Packages',
    embeddedTitle: 'Libraries embedded in WASM',
    embeddedIntro: 'These ship inside another package’s WASM build. Their license texts are on each project’s site.',
    embeddedIn: (name: string) => `Embedded in ${name}`,
    author: 'Author',
    homepage: 'Website',
    noText: 'The package does not include a license file. It is distributed under the license named above.',
    lgplTitle: 'About the LGPL libraries',
    lgplHeif:
      'libheif (libheif-js, including libde265), used to read HEIC, is licensed under LGPL-3.0. Bani ships it unmodified as separate files (JS and WASM) that load only when you open a HEIC image. The source is available at github.com/strukturag/libheif and github.com/catdad-experiments/libheif-js, and you can replace those files with another build of the same name.',
    lgplLame:
      'LAME, used to write MP3, is licensed under the LGPL. It is used unmodified inside the WASM build of @mediabunny/mp3-encoder. The source is available at lame.sourceforge.io.',
  },
})
