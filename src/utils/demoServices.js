const storageKey = 'iconnect.demo.services'

export function emptyDemoServicesState() {
  return {
    balances: { NGN: 50000, USD: 100, EUR: 80, GBP: 65, BTC: 0.002, USDT: 35 },
    transactions: [],
    trades: [],
    paperBot: {
      status: 'Paused',
      strategy: 'Moving average crossover',
      maxPosition: 25,
      dailyLossLimit: 20,
      riskPerTrade: 1,
      scanCount: 0,
      activity: [],
      pendingSignal: null,
    },
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
    (state.walletChains !== undefined && !Array.isArray(state.walletChains)) ||
    (state.paperBot !== undefined && (
      !state.paperBot ||
      typeof state.paperBot !== 'object' ||
      Array.isArray(state.paperBot) ||
      !['Running', 'Paused'].includes(state.paperBot.status) ||
      typeof state.paperBot.strategy !== 'string' ||
      !Number.isFinite(state.paperBot.maxPosition) ||
      !Number.isFinite(state.paperBot.dailyLossLimit) ||
      !Number.isFinite(state.paperBot.riskPerTrade) ||
      !Number.isInteger(state.paperBot.scanCount) ||
      !Array.isArray(state.paperBot.activity) ||
      (state.paperBot.pendingSignal != null && typeof state.paperBot.pendingSignal !== 'object')
    ))
  ) {
    throw new Error('Saved product demo data is invalid. Clear this browser’s iConnect product demo data to continue.')
  }

  return {
    ...emptyDemoServicesState(),
    ...state,
    balances: { ...emptyDemoServicesState().balances, ...state.balances },
    paperBot: { ...emptyDemoServicesState().paperBot, ...state.paperBot },
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
