// hashrock のサービス切り替え（index.html で読み込む <hashrock-switcher>）を JSX に書くための宣言
import 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'hashrock-switcher': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        theme?: 'light' | 'dark'
      }
    }
  }
}
