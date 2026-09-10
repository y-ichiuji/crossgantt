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

/**
 * 選択済みを先頭へ寄せる。
 *
 * 選択肢が多いときに、いま何を選んでいるかを一覧の中から探し直さずに済む。
 * `toSorted` は安定なので、選択済み同士・未選択同士では元の並びが残る。
 */
function selectedFirst(options: MultiSelectOption[], selectedSet: ReadonlySet<string>): MultiSelectOption[] {
  return options.toSorted((a, b) => Number(selectedSet.has(b.value)) - Number(selectedSet.has(a.value)))
}

/**
 * 値をひとつ入れ替えた後の選択一覧を組み立てる。
 *
 * 選択肢は選択中のプロジェクトに応じて非同期に入れ替わるため、手元の
 * `options` に無い選択値（共有 URL 由来など）が残ることがある。`options`
 * だけで組み直すとそれらが黙って消えるので、選択肢の順に並べたうえで
 * 一覧に無い選択値は末尾に残す。
 */
function toggleValue(options: MultiSelectOption[], selectedSet: ReadonlySet<string>, value: string): string[] {
  const next = new Set(selectedSet)
  if (next.has(value)) {
    next.delete(value)
  } else {
    next.add(value)
  }
  const knownValues = new Set(options.map((option) => option.value))
  const known = options.filter((option) => next.has(option.value)).map((option) => option.value)
  const unknown = [...next].filter((item) => !knownValues.has(item))
  return [...known, ...unknown]
}

/**
 * 絞り込み入力での Enter を拾う。
 *
 * 日本語入力の変換を確定する Enter は、こちらへの操作ではないので無視する。
 * 変換中かどうかは `nativeEvent.isComposing` で判別できる。
 */
function isSelectionEnter(event: React.KeyboardEvent<HTMLInputElement>): boolean {
  return event.key === 'Enter' && !event.nativeEvent.isComposing
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

  const selectedSet = useMemo(() => new Set(selected), [selected])

  const visibleOptions = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const matched = keyword ? options.filter((option) => option.label.toLowerCase().includes(keyword)) : options
    return selectedFirst(matched, selectedSet)
  }, [options, query, selectedSet])

  const toggle = (value: string) => onChange(toggleValue(options, selectedSet, value))

  /** Enter の対象は一覧の先頭。選択済みを上へ寄せた後の先頭であることに注意。 */
  const toggleFirstVisible = () => {
    const first = visibleOptions.at(0)
    if (first) {
      toggle(first.value)
    }
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
        <Panel
          id={listId}
          hintId={hintId}
          searchable={searchable === true}
          query={query}
          onQueryChange={setQuery}
          visibleOptions={visibleOptions}
          selectedSet={selectedSet}
          onToggle={toggle}
          onToggleFirst={toggleFirstVisible}
          onSelectVisible={() => onChange([...new Set([...selected, ...visibleOptions.map((option) => option.value)])])}
          onClear={() => onChange([])}
        />
      ) : null}
    </div>
  )
}

type PanelProps = {
  id: string
  hintId: string
  searchable: boolean
  query: string
  onQueryChange: (query: string) => void
  visibleOptions: MultiSelectOption[]
  selectedSet: ReadonlySet<string>
  onToggle: (value: string) => void
  onToggleFirst: () => void
  onSelectVisible: () => void
  onClear: () => void
}

/** 開いているときだけ描かれる、絞り込みと選択肢のパネル。 */
function Panel({
  id,
  hintId,
  searchable,
  query,
  onQueryChange,
  visibleOptions,
  selectedSet,
  onToggle,
  onToggleFirst,
  onSelectVisible,
  onClear
}: PanelProps) {
  const first = visibleOptions.at(0)

  return (
    <div className={styles.panel} id={id}>
      {searchable ? (
        <input
          type="search"
          className={styles.search}
          placeholder="絞り込み"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          // 絞り込んでから Enter で先頭の候補を選び、もう一度押すと外せる。
          onKeyDown={(event) => {
            if (isSelectionEnter(event)) {
              event.preventDefault()
              onToggleFirst()
            }
          }}
          // 先頭の候補が Enter の対象であることを支援技術にも伝える。
          aria-describedby={first ? hintId : undefined}
        />
      ) : null}

      <div className={styles.actions}>
        {/*
         * 「表示中」を足すのであって、既存の選択を置き換えるのではない。
         * 絞り込み中に置き換えてしまうと、検索語に一致しない選択済みの項目が
         * 画面に出ていないまま外れてしまう。
         */}
        <button type="button" className={styles.actionButton} onClick={onSelectVisible}>
          表示中をすべて選択
        </button>
        <button type="button" className={styles.actionButton} onClick={onClear}>
          クリア
        </button>
      </div>

      <ul className={styles.list}>
        {visibleOptions.map((option) => (
          <Option
            key={option.value}
            option={option}
            checked={selectedSet.has(option.value)}
            onToggle={() => onToggle(option.value)}
          />
        ))}
        {visibleOptions.length === 0 ? <li className={styles.empty}>該当なし</li> : null}
      </ul>

      {searchable && first ? (
        <p className={styles.hint} id={hintId}>
          Enter で「{first.label}」を{selectedSet.has(first.value) ? '解除' : '選択'}
        </p>
      ) : null}
    </div>
  )
}

/** 選択肢 1 行。 */
function Option({ option, checked, onToggle }: { option: MultiSelectOption; checked: boolean; onToggle: () => void }) {
  return (
    <li>
      <label className={styles.option}>
        <input type="checkbox" checked={checked} onChange={onToggle} />
        {option.color ? (
          <span className={styles.chip} style={{ backgroundColor: option.color }} aria-hidden="true" />
        ) : null}
        <span>{option.label}</span>
      </label>
    </li>
  )
}
