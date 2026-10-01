const formatters = new Map<string, Intl.NumberFormat>()

function formatter(currency: string) {
  let f = formatters.get(currency)
  if (!f) {
    f = new Intl.NumberFormat(undefined, { style: 'currency', currency })
    formatters.set(currency, f)
  }
  return f
}

export function formatAmount(value: number, currency = 'USD') {
  // True minus sign: the ASCII hyphen sits too narrow/wide in tabular figures.
  return formatter(currency).format(value).replace('-', '\u2212')
}
