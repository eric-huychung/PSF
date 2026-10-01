import { formatAmount } from '../ui/format'

export interface ChartDataRow {
  label: string
  values: Array<number | string>
}

/** Screen-reader equivalent of a chart, so data is never color/shape-only. One row per category/period, one column per series. */
export function ChartDataTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: ReadonlyArray<ChartDataRow> }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col" />
          {columns.map((column) => <th key={column} scope="col">{column}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row">{row.label}</th>
            {row.values.map((value, index) => <td key={columns[index]}>{typeof value === 'number' ? formatAmount(value) : value}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
