/**
 * ビルドのときに licenses/plugin.ts が作るモジュール。型は plugin.ts の LicenseEntry と同じ形
 * （plugin.ts は Node の API を使うので、画面の側からは読み込まずにここで写す）
 */
declare module 'virtual:bani-licenses' {
  export interface LicenseEntry {
    name: string
    version: string
    license: string
    author?: string
    homepage?: string
    /** texts の何番目か */
    text?: number
    embeddedIn?: string
  }
  /** package.json の版 */
  export const version: string
  export const packages: readonly LicenseEntry[]
  export const texts: readonly string[]
}
