import { useEffect, useId, useMemo, useRef, useState } from 'react'

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
  const listId = useId()

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
    onChange(options.filter((option) => next.has(option.value)).map((option) => option.value))
  }

  const summary = selected.length === 0 ? emptyLabel : `${selected.length}件選択`

  return (
    <div className="multi-select" ref={containerRef}>
      <span className="field-label">{label}</span>
      <button
        type="button"
        className="multi-select__trigger"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled || options.length === 0}
        aria-expanded={open}
        aria-controls={listId}
      >
        <span>{options.length === 0 ? '選択肢がありません' : summary}</span>
        <span aria-hidden="true">▾</span>
      </button>

      {open ? (
        <div className="multi-select__panel" id={listId}>
          {searchable ? (
            <input
              type="search"
              className="multi-select__search"
              placeholder="絞り込み"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          ) : null}

          <div className="multi-select__actions">
            <button type="button" onClick={() => onChange(visibleOptions.map((option) => option.value))}>
              表示中をすべて選択
            </button>
            <button type="button" onClick={() => onChange([])}>
              クリア
            </button>
          </div>

          <ul className="multi-select__list">
            {visibleOptions.map((option) => (
              <li key={option.value}>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedSet.has(option.value)}
                    onChange={() => toggle(option.value)}
                  />
                  {option.color ? (
                    <span className="multi-select__chip" style={{ backgroundColor: option.color }} aria-hidden="true" />
                  ) : null}
                  <span>{option.label}</span>
                </label>
              </li>
            ))}
            {visibleOptions.length === 0 ? <li className="multi-select__empty">該当なし</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
