import styles from './AssigneeAvatar.module.css'

/**
 * 頭文字の取り出しに使う。単純な `[...name][0]` だと、絵文字や結合文字を
 * 途中で切ってしまうため、書記素単位で区切る。
 */
const graphemeSegmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' })

function firstGrapheme(text: string): string {
  return [...graphemeSegmenter.segment(text)][0]?.segment ?? '?'
}

type Props = {
  assigneeId: number | null
  assigneeName: string | null
  /** グループ見出しなど、少し大きく出したい場所で使う。 */
  size?: 'sm' | 'md'
}

/**
 * 担当者のアイコン。
 *
 * Backlog のアイコン取得はアクセストークンを要するため、Worker の
 * `/api/users/:id/icon` を経由して読み込む。画像が読めなかった場合は
 * 背後に置いた頭文字がそのまま見える。
 */
export function AssigneeAvatar({ assigneeId, assigneeName, size = 'sm' }: Props) {
  const label = assigneeName ?? '未割り当て'
  const initial = firstGrapheme(label)

  return (
    <span className={styles.avatar} data-size={size} title={label}>
      <span className={styles.initial} aria-hidden="true">
        {initial}
      </span>
      {assigneeId === null ? null : (
        <img className={styles.image} src={`/api/users/${assigneeId}/icon`} alt="" loading="lazy" decoding="async" />
      )}
    </span>
  )
}
