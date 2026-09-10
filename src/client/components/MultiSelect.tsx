import { useEffect, useId, useMemo, useRef, useState } from 'react'

import styles from './MultiSelect.module.css'

export type MultiSelectOption = {
  value: string
  label: string
  /** 選択肢の左に表示する色チップ。 */
  color?: string
}

type Props = {
  label: string
  options: MultiSelectOption[]
  selected: string[]
  onChange: (selected: string[]) => void
  /** 何も選択されていないときの表示。 */
  emptyLabel: string
  disabled?: boolean
  /** 選択肢が多い場合に絞り込み用の入力欄を出す。 */
  searchable?: boolean
}

/** チェックボックス付きのドロップダウン。複数選択のフィルタに使う。 */
export function MultiSelect({ label, options, selected, onChange, emptyLabel, disabled, searchable }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const labelId = useId()
  const summaryId = useId()
  const hintId = useId()

  useEffect(() => {
    if (!open) {
      return
    }
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        // パネルを閉じると中にあったフォーカスごと消えて body に戻ってしまい、
        // 次の Tab がページ先頭からやり直しになる。開いた元のボタンへ返す。
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const visibleOptions = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) {
      return options
    }
    return options.filter((option) => option.label.toLowerCase().includes(keyword))
  }, [options, query])

  const selectedSet = useMemo(() => new Set(selected), [selected])

  const toggle = (value: string) => {
    const next = new Set(selectedSet)
    if (next.has(value)) {
      next.delete(value)
    } else {
      next.add(value)
    }
    // 選択肢は選択中のプロジェクトに応じて非同期に入れ替わるため、
    // 手元の options に無い選択値（共有 URL 由来など）が残ることがある。
    // options だけで組み直すとそれらが黙って消えるので、選択肢の順に並べたうえで
    // 一覧に無い選択値は末尾に残す。
    const known = options.filter((option) => next.has(option.value)).map((option) => option.value)
    const knownValues = new Set(options.map((option) => option.value))
    const unknown = [...next].filter((item) => !knownValues.has(item))
    onChange([...known, ...unknown])
  }

  /** Enter を押したときに選ばれる候補。絞り込み結果の先頭。 */
  const firstVisible = visibleOptions.at(0)

  const selectFirstVisible = () => {
    // トグルではなく「選択する」なので、すでに選んでいるなら何もしない。
    if (!firstVisible || selectedSet.has(firstVisible.value)) {
      return
    }
    toggle(firstVisible.value)
  }

  const summary = selected.length === 0 ? emptyLabel : `${selected.length}件選択`

  return (
    <div className={styles.root} ref={containerRef}>
      <span className={styles.label} id={labelId}>
        {label}
      </span>
      <button
        type="button"
        ref={triggerRef}
        className={styles.trigger}
        onClick={() => setOpen((value) => !value)}
        disabled={disabled === true || options.length === 0}
        aria-expanded={open}
        // 見出しの「プロジェクト」「担当者」「ステータス」と現在の選択状況を
        // 続けて読み上げさせる。見出しを結び付けないと、支援技術には
        // 「未選択」「2件選択」としか伝わらず、どの絞り込みか区別できない。
        aria-labelledby={`${labelId} ${summaryId}`}
        // 閉じているあいだパネルは存在しないため、参照させない。
        aria-controls={open ? listId : undefined}
      >
        <span id={summaryId}>{options.length === 0 ? '選択肢がありません' : summary}</span>
        <span aria-hidden="true">▾</span>
      </button>

      {open ? (
        <div className={styles.panel} id={listId}>
          {searchable ? (
            <input
              type="search"
              className={styles.search}
              placeholder="絞り込み"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              // 絞り込んでから Enter で決定できるようにする。トグルではなく
              // 「選択する」なので、続けて押しても外れない。
              onKeyDown={(event) => {
                if (event.key !== 'Enter') {
                  return
                }
                event.preventDefault()
                selectFirstVisible()
              }}
              // 先頭の候補が Enter の対象であることを支援技術にも伝える。
              aria-describedby={firstVisible ? hintId : undefined}
            />
          ) : null}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.actionButton}
              // 「表示中」を足すのであって、既存の選択を置き換えるのではない。
              // 絞り込み中に置き換えてしまうと、検索語に一致しない選択済みの項目が
              // 画面に出ていないまま外れてしまう。
              onClick={() => onChange([...new Set([...selected, ...visibleOptions.map((option) => option.value)])])}
            >
              表示中をすべて選択
            </button>
            <button type="button" className={styles.actionButton} onClick={() => onChange([])}>
              クリア
            </button>
          </div>

          <ul className={styles.list}>
            {visibleOptions.map((option) => (
              <li key={option.value}>
                <label className={styles.option}>
                  <input
                    type="checkbox"
                    checked={selectedSet.has(option.value)}
                    onChange={() => toggle(option.value)}
                  />
                  {option.color ? (
                    <span className={styles.chip} style={{ backgroundColor: option.color }} aria-hidden="true" />
                  ) : null}
                  <span>{option.label}</span>
                </label>
              </li>
            ))}
            {visibleOptions.length === 0 ? <li className={styles.empty}>該当なし</li> : null}
          </ul>

          {searchable && firstVisible ? (
            <p className={styles.hint} id={hintId}>
              Enter で「{firstVisible.label}」を選択
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
