import { defineMessages } from '../i18n/local'

/** アプリの枠（画面の移動・配色の切り替え）の文言 */
export const shellMessages = defineMessages({
  ja: {
    leaveConfirm: '保存していない変更があります。破棄してこの画面を離れますか？',
    theme: '配色',
    themeLabel: { light: 'ライト', dark: 'ダーク', system: 'システムに合わせる' },
    about: 'Bani について',
    aboutLink: 'Bani について・ライセンス',
  },
  en: {
    leaveConfirm: 'You have unsaved changes. Discard them and leave this screen?',
    theme: 'Theme',
    themeLabel: { light: 'Light', dark: 'Dark', system: 'Match system' },
    about: 'About Bani',
    aboutLink: 'About Bani & licenses',
  },
})
