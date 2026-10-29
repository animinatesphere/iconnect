const storageKey = 'iconnect.demo.services'

export function emptyDemoServicesState() {
  return {
    balances: { NGN: 50000, USD: 100, EUR: 80, GBP: 65, BTC: 0.002, USDT: 35 },
    transactions: [],
    trades: [],
    orders: [],
    cart: [],
    bookings: [],
    walletCurrencies: ['NGN', 'USD', 'EUR', 'GBP'],
    walletChains: [],
  }
}

export function readDemoServicesState() {
  const serialized = window.localStorage.getItem(storageKey)
  if (!serialized) return emptyDemoServicesState()

  const state = JSON.parse(serialized)
  if (
    !state ||
    !state.balances ||
    typeof state.balances !== 'object' ||
    Array.isArray(state.balances) ||
    !Array.isArray(state.transactions) ||
    !Array.isArray(state.trades) ||
    !Array.isArray(state.orders) ||
    (state.cart !== undefined && !Array.isArray(state.cart)) ||
    !Array.isArray(state.bookings) ||
    (state.walletCurrencies !== undefined && !Array.isArray(state.walletCurrencies)) ||
    (state.walletChains !== undefined && !Array.isArray(state.walletChains))
  ) {
    throw new Error('Saved product demo data is invalid. Clear this browser’s iConnect product demo data to continue.')
  }

  return {
    ...emptyDemoServicesState(),
    ...state,
    balances: { ...emptyDemoServicesState().balances, ...state.balances },
    cart: state.cart ?? [],
    walletCurrencies: state.walletCurrencies ?? emptyDemoServicesState().walletCurrencies,
    walletChains: state.walletChains ?? [],
  }
}

export function writeDemoServicesState(state) {
  window.localStorage.setItem(storageKey, JSON.stringify(state))
}

export function addDemoTransaction(state, { kind, amount, currency, description }) {
  const nextId = `demo-tx-${Date.now()}`
  const balance = Number(state.balances[currency] ?? 0)
  const nextBalance = kind === 'credit' ? balance + amount : balance - amount
  if (nextBalance < 0) throw new Error(`Not enough demo ${currency} balance for this preview action.`)

  return {
    ...state,
    balances: { ...state.balances, [currency]: nextBalance },
    transactions: [{
      id: nextId,
      kind,
      amount,
      currency,
      description,
      createdAt: new Date().toISOString(),
    }, ...state.transactions],
  }
}
