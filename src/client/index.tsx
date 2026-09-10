import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './app'

// デザイントークンとリセット。副作用としてスタイルを読み込む。
// oxlint-disable-next-line import/no-unassigned-import
import './styles/global.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('マウント先の #root が見つかりません')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
)
