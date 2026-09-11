/**
 * Apps Script の V8 ランタイムに足りない組み込みを補う。
 *
 * Apps Script の V8 は更新されるものの、どの ECMAScript 版まで含むかは
 * 公表されていない。ここで補うのは、コード側で普通に使いたいのに
 * 存在が保証されないものだけに絞る。構文（`??` や `?.` など）は
 * ビルド時に esbuild が ES2019 相当まで落とすため、ここでは扱わない。
 *
 * このモジュールは副作用だけを持ち、エントリポイントの先頭で読み込む。
 * 組み込みの拡張と破壊的な `sort` はこのファイルの目的そのものなので、
 * それを禁じる検査だけ外している。
 */

/* oxlint-disable no-extend-native */
/* oxlint-disable unicorn/no-array-sort */

type Comparator<T> = (a: T, b: T) => number

/** `Array.prototype.toSorted` が無い環境向けの実装。 */
function toSortedFallback<T>(this: T[], compare?: Comparator<T>): T[] {
  return [...this].sort(compare)
}

if (typeof Array.prototype.toSorted !== 'function') {
  Object.defineProperty(Array.prototype, 'toSorted', {
    value: toSortedFallback,
    writable: true,
    configurable: true,
    enumerable: false
  })
}
