import { defineMessages } from '../i18n/local'

/** 作業の保存と再開（入口の一覧、再開の通知）の文言 */
export const sessionMessages = defineMessages({
  ja: {
    title: '前回の作業を再開',
    resume: '再開',
    remove: '削除',
    resumeLabel: (name: string) => `「${name}」の作業を再開`,
    removeLabel: (name: string) => `「${name}」の作業を削除`,
    note: '保存していない編集を、このブラウザの中にだけ残しています。',
    storage: (usage: string, quota: string) => `保存領域: ${usage} 使用 / 約 ${quota}`,
    resumeFailed: '前回の作業のファイルを読み直せませんでした。',
    found: (name: string) => `前回の作業「${name}」が残っています`,
  },
  en: {
    title: 'Resume previous work',
    resume: 'Resume',
    remove: 'Delete',
    resumeLabel: (name: string) => `Resume the work on “${name}”`,
    removeLabel: (name: string) => `Delete the work on “${name}”`,
    note: 'Unsaved edits are kept only inside this browser.',
    storage: (usage: string, quota: string) => `Storage: ${usage} used of about ${quota}`,
    resumeFailed: 'Could not reread the files of the previous work.',
    found: (name: string) => `Your previous work on “${name}” is still here`,
  },
})
