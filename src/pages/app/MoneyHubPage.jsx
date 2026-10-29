import React, { Suspense, lazy, useEffect, useState } from 'react'
import { Activity, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, BadgeDollarSign, Banknote, Bitcoin, Bot, Check, Clock3, Coins, CreditCard, ExternalLink, Globe2, LockKeyhole, Pause, Play, Plus, RefreshCw, ShieldCheck, Wallet } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import { getDemoAdminSettings } from '../../utils/demoAdmin.js'
import { addDemoTransaction, emptyDemoServicesState, readDemoServicesState, writeDemoServicesState } from '../../utils/demoServices.js'

const TradeChart = lazy(() => import('../../components/TradeChart.jsx'))

const screens = {
  '/app/wallet': { name: 'Wallet', brand: 'iConnect wallet', eyebrow: 'YOUR MONEY · CONCEPT' },
  '/app/payments': { name: 'Payments', brand: 'Opay-inspired payments', eyebrow: 'PAYMENTS · DEMO' },
  '/app/itrade': { name: 'iTrade', brand: 'iTrade', eyebrow: 'MARKETS · SIMULATION' },
}

const currencyNames = { NGN: 'Nigerian naira', USD: 'US dollar', EUR: 'Euro', GBP: 'British pound', BTC: 'Bitcoin', USDT: 'Tether USD' }
const fxRates = { 'USD-NGN': 1500, 'EUR-NGN': 1630, 'GBP-NGN': 1900, 'USD-EUR': 0.92, 'USD-GBP': 0.79, 'EUR-GBP': 0.86 }
const assets = [
  { symbol: 'BTC', name: 'Bitcoin', quote: '67,480.00', change: '+2.4%', color: 'btc' },
  { symbol: 'ETH', name: 'Ethereum', quote: '3,510.00', change: '+1.2%', color: 'eth' },
  { symbol: 'USDT', name: 'Tether', quote: '1.00', change: '+0.0%', color: 'usdt' },
  { symbol: 'SOL', name: 'Solana', quote: '148.20', change: '-0.8%', color: 'sol' },
]
const pairs = ['EUR/USD', 'XAU/USD', 'BTC/USDT', 'ETH/USDT']
const botStrategies = ['Moving average crossover', 'RSI mean reversion', 'Breakout watch']

function formatAmount(amount, currency) {
  const maximumFractionDigits = currency === 'BTC' ? 6 : 2
  return new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits }).format(amount)
}

export default function MoneyHubPage() {
  const { pathname } = useLocation()
  const screen = screens[pathname] ?? screens['/app/wallet']
  const [state, setState] = useState(emptyDemoServicesState)
  const [settings, setSettings] = useState({})
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('NGN')
  const [description, setDescription] = useState('')
  const [sourceCurrency, setSourceCurrency] = useState('USD')
  const [targetCurrency, setTargetCurrency] = useState('NGN')
  const [pair, setPair] = useState('EUR/USD')
  const [tradeSide, setTradeSide] = useState('Buy')
  const [payoutPreview, setPayoutPreview] = useState(false)
  const [externalWalletPreview, setExternalWalletPreview] = useState(false)

  useEffect(() => {
    try {
      const servicesState = readDemoServicesState()
      setState(servicesState)
      setSettings(getDemoAdminSettings())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load local demo balances.')
    } finally {
      setLoaded(true)
    }
  }, [])

  const transferEnabled = settings.paymentsEnabled
  const walletEnabled = settings.walletsEnabled
  const tradingEnabled = settings.tradingEnabled
  const wallets = state.walletCurrencies
  const chains = state.walletChains

  function isValidBotConfig(bot) {
    return botStrategies.includes(bot.strategy) &&
      Number.isFinite(bot.maxPosition) && bot.maxPosition > 0 && bot.maxPosition <= 10000 &&
      Number.isFinite(bot.dailyLossLimit) && bot.dailyLossLimit > 0 && bot.dailyLossLimit <= 10000 &&
      Number.isFinite(bot.riskPerTrade) && bot.riskPerTrade > 0 && bot.riskPerTrade <= 5
  }

  function updateBotConfig(key, value) {
    setState((current) => ({
      ...current,
      paperBot: { ...current.paperBot, [key]: value },
    }))
  }

  function saveBotConfig(event) {
    event.preventDefault()
    const bot = state.paperBot
    if (!isValidBotConfig(bot)) {
      setError('Choose a listed strategy and valid demo limits: order size and daily loss up to 10,000 credits, and risk between 0.1% and 5%.')
      return
    }
    saveState(state, 'Paper bot settings saved locally. No broker or live market is connected.')
  }

  function togglePaperBot() {
    const status = state.paperBot.status === 'Running' ? 'Paused' : 'Running'
    if (status === 'Running' && !isValidBotConfig(state.paperBot)) {
      setError('Save valid demo limits before starting the paper bot.')
      return
    }
    saveState({
      ...state,
      paperBot: { ...state.paperBot, status },
    }, status === 'Running'
      ? 'Paper bot preview started. It will only scan when you request a demo scan.'
      : 'Paper bot preview paused. No live orders were active.')
  }

  function runBotScan() {
    const bot = state.paperBot
    if (bot.status !== 'Running') {
      setError('Start the paper bot preview before requesting a demo scan.')
      return
    }
    if (bot.pendingSignal) {
      setError('Review or dismiss the pending paper signal before running another scan.')
      return
    }
    const side = bot.scanCount % 2 === 0 ? 'Buy' : 'Sell'
    const signal = {
      id: `paper-signal-${Date.now()}`,
      pair,
      side,
      strategy: bot.strategy,
      amount: bot.maxPosition,
      createdAt: new Date().toISOString(),
    }
    const activity = [{
      ...signal,
      status: 'Awaiting your approval',
    }, ...bot.activity].slice(0, 6)
    saveState({
      ...state,
      paperBot: {
        ...bot,
        scanCount: bot.scanCount + 1,
        pendingSignal: signal,
        activity,
      },
    }, `Illustrative ${side.toLowerCase()} signal created for ${pair}. Approve it to record a paper trade.`)
  }

  function approveBotSignal() {
    const { pendingSignal } = state.paperBot
    if (!pendingSignal) return
    const fillPrice = pendingSignal.pair === 'EUR/USD' ? 1.0842
      : pendingSignal.pair === 'XAU/USD' ? 2335.6
        : pendingSignal.pair === 'BTC/USDT' ? 67480 : 3510
    const trade = {
      id: `trade-${Date.now()}`,
      pair: pendingSignal.pair,
      side: pendingSignal.side,
      amount: pendingSignal.amount,
      fillPrice,
      createdAt: new Date().toISOString(),
      status: 'Paper fill · user approved',
    }
    const activity = state.paperBot.activity.map((item) => item.id === pendingSignal.id
      ? { ...item, status: 'Paper trade recorded' }
      : item)
    saveState({
      ...state,
      trades: [trade, ...state.trades],
      paperBot: { ...state.paperBot, pendingSignal: null, activity },
    }, `Approved demo signal recorded as a paper trade. No market order was placed.`)
  }

  function dismissBotSignal() {
    const { pendingSignal } = state.paperBot
    if (!pendingSignal) return
    const activity = state.paperBot.activity.map((item) => item.id === pendingSignal.id
      ? { ...item, status: 'Dismissed by you' }
      : item)
    saveState({
      ...state,
      paperBot: { ...state.paperBot, pendingSignal: null, activity },
    }, 'Demo signal dismissed. No paper trade was recorded.')
  }

  function saveState(nextState, message) {
    try {
      writeDemoServicesState(nextState)
      setState(nextState)
      setError('')
      setNotice(message)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this browser demo action.')
    }
  }

  function submitTransaction(event) {
    event.preventDefault()
    if (!transferEnabled) {
      setError('Payment actions are disabled by the local admin demo setting.')
      return
    }
    const parsedAmount = Number(amount)
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || !description.trim()) {
      setError('Enter a positive demo amount and a recipient or payment description.')
      return
    }
    try {
      const nextState = addDemoTransaction(state, { kind: 'debit', amount: parsedAmount, currency, description: description.trim() })
      saveState(nextState, `Demo transaction of ${currency} ${formatAmount(parsedAmount, currency)} saved locally. No money moved.`)
      setAmount('')
      setDescription('')
    } catch (transactionError) {
      setError(transactionError instanceof Error ? transactionError.message : 'The demo transfer could not be completed.')
    }
  }

  function simulateTopUp() {
    const parsedAmount = Number(amount)
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Enter a positive demo amount before adding preview funds.')
      return
    }
    try {
      const nextState = addDemoTransaction(state, { kind: 'credit', amount: parsedAmount, currency, description: 'Demo balance top-up' })
      saveState(nextState, `Added ${currency} ${formatAmount(parsedAmount, currency)} in demo credits. No deposit occurred.`)
      setAmount('')
    } catch (transactionError) {
      setError(transactionError instanceof Error ? transactionError.message : 'Could not update demo balance.')
    }
  }

  function convertDemoFunds(event) {
    event.preventDefault()
    const parsedAmount = Number(amount)
    const key = `${sourceCurrency}-${targetCurrency}`
    const reverseRate = fxRates[`${targetCurrency}-${sourceCurrency}`]
    const rate = fxRates[key] ?? (reverseRate ? 1 / reverseRate : sourceCurrency === targetCurrency ? 1 : 1)
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || sourceCurrency === targetCurrency) {
      setError('Choose two different currencies and enter a positive amount.')
      return
    }
    try {
      const debit = addDemoTransaction(state, { kind: 'debit', amount: parsedAmount, currency: sourceCurrency, description: `Demo conversion to ${targetCurrency}` })
      const credit = addDemoTransaction(debit, { kind: 'credit', amount: parsedAmount * rate, currency: targetCurrency, description: `Demo conversion from ${sourceCurrency}` })
      saveState(credit, `Demo conversion recorded at an illustrative ${rate} rate. No FX trade occurred.`)
      setAmount('')
    } catch (conversionError) {
      setError(conversionError instanceof Error ? conversionError.message : 'Could not record this demo conversion.')
    }
  }

  function addWallet(code) {
    if (wallets.includes(code)) return
    const walletCurrencies = [...state.walletCurrencies, code]
    saveState({ ...state, walletCurrencies }, `${code} demo wallet added. It is not connected to a bank or blockchain.`)
  }

  function createChainWallet(chain) {
    if (chains.includes(chain)) return
    const walletChains = [...state.walletChains, chain]
    saveState({ ...state, walletChains }, `${chain} address preview saved locally. No wallet keys or blockchain account were created.`)
  }

  function placeDemoTrade(event) {
    event.preventDefault()
    if (!tradingEnabled) {
      setError('iTrade is disabled by the local admin demo setting.')
      return
    }
    const parsedAmount = Number(amount)
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount > 10000) {
      setError('Enter a demo trade size between 0 and 10,000 credits.')
      return
    }
    const trade = { id: `trade-${Date.now()}`, pair, side: tradeSide, amount: parsedAmount, fillPrice: pair === 'EUR/USD' ? 1.0842 : pair === 'XAU/USD' ? 2335.6 : pair === 'BTC/USDT' ? 67480 : 3510, createdAt: new Date().toISOString(), status: 'Simulated fill' }
    saveState({ ...state, trades: [trade, ...state.trades] }, `${tradeSide} ${pair} paper trade recorded. No market order was placed.`)
    setAmount('')
  }

  if (!loaded) return <div className="app-content-width">Loading local money demo…</div>

  return (
    <div className="app-content-width money-hub-page">
      <AppPageHeader eyebrow={screen.eyebrow} title={screen.name} description={`${screen.brand} · illustrative product screens. All amounts and activity below are simulated.`} />
      <div className="money-safety-banner"><LockKeyhole size={17} /><span><strong>Simulation only — no financial service is connected.</strong> Never enter bank details, card numbers, seed phrases, private keys, or real credentials. Demo balances are not withdrawable; all trades are paper simulations.</span></div>
      {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
      {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}

      {!walletEnabled && pathname !== '/app/itrade' && <p className="money-disabled-note">Wallet features are disabled by the local admin demo setting.</p>}
      {!transferEnabled && pathname === '/app/payments' && <p className="money-disabled-note">Payment features are disabled by the local admin demo setting.</p>}
      {!tradingEnabled && pathname === '/app/itrade' && <p className="money-disabled-note">iTrade is disabled by the local admin demo setting.</p>}

      {pathname === '/app/wallet' && walletEnabled && <div className="money-page-grid">
        <section className="wallet-demo-card"><div className="wallet-demo-card-top"><span><Wallet size={16} /> TOTAL DEMO BALANCE</span><span className="simulated-pill"><i /> SIMULATED</span></div><strong>NGN {formatAmount(state.balances.NGN, 'NGN')}</strong><small>Displayed balance is fictional demo credit.</small><div className="wallet-demo-actions"><button type="button" onClick={() => document.getElementById('wallet-topup')?.scrollIntoView({ behavior: 'smooth' })}><Plus size={15} /> Add demo credit</button><button type="button" onClick={() => setNotice('Send/receive actions are previews only. No account or network is connected.')}><ArrowUpRight size={15} /> Send / receive</button></div><div className="wallet-demo-decoration"><Wallet size={104} strokeWidth={.65} /></div></section>
        <section className="money-panel"><div className="money-panel-heading"><span><Coins size={16} /></span><div><h2>Your currency wallets</h2><p>Local balances for this browser demo</p></div><button type="button" className="money-icon-button" onClick={() => addWallet('GBP')} aria-label="Add GBP wallet"><Plus size={15} /></button></div><div className="currency-wallet-list">{wallets.map((code) => <article key={code}><span className={`currency-badge currency-${code.toLowerCase()}`}>{code === 'BTC' ? <Bitcoin size={16} /> : code.slice(0, 1)}</span><span><strong>{currencyNames[code] ?? code}</strong><small>{code} account · preview</small></span><b>{formatAmount(state.balances[code] ?? 0, code)}</b></article>)}</div><div className="wallet-add-controls">{['EUR', 'GBP', 'BTC', 'USDT'].filter((code) => !wallets.includes(code)).map((code) => <button key={code} type="button" onClick={() => addWallet(code)}><Plus size={12} /> Add {code}</button>)}</div></section>
        <section className="money-panel wallet-chain-panel"><div className="money-panel-heading"><span><Globe2 size={16} /></span><div><h2>Multichain address preview</h2><p>Address labels only. No keys generated or stored.</p></div></div><div className="chain-list">{['Bitcoin', 'Ethereum', 'TON', 'Solana'].map((chain) => <div key={chain}><span className="chain-token">{chain.slice(0, 1)}</span><span><strong>{chain}</strong><small>{chains.includes(chain) ? `demo:${chain.toLowerCase()}:••••••••` : 'Not set up'}</small></span><button type="button" onClick={() => createChainWallet(chain)} disabled={chains.includes(chain)}>{chains.includes(chain) ? <Check size={14} /> : 'Create demo'}</button></div>)}</div><div className="wallet-link-controls"><button type="button" onClick={() => setPayoutPreview((value) => !value)}><Banknote size={15} /> {payoutPreview ? 'Bank-link preview on' : 'Preview bank-link step'}</button><button type="button" onClick={() => setExternalWalletPreview((value) => !value)}><ExternalLink size={15} /> {externalWalletPreview ? 'Wallet-link preview on' : 'Preview crypto-wallet step'}</button></div><p className="money-panel-note">No bank account or external wallet is connected. Production setup needs a regulated provider and secure key custody.</p></section>
        <section className="money-panel" id="wallet-topup"><div className="money-panel-heading"><span><ArrowDownLeft size={16} /></span><div><h2>Demo balance control</h2><p>Add or transfer fake credits for UI testing.</p></div></div><div className="money-inline-form"><label>Currency<select value={currency} onChange={(event) => setCurrency(event.target.value)}>{wallets.map((code) => <option key={code} value={code}>{code}</option>)}</select></label><label>Amount<input type="number" min="0.01" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></label></div><div className="money-action-row"><button type="button" onClick={simulateTopUp}>Add demo credits</button><span>Not a deposit</span></div></section>
      </div>}

      {pathname === '/app/payments' && transferEnabled && <div className="money-page-grid">
        <section className="money-panel payment-action-panel"><div className="money-panel-heading"><span><ArrowLeftRight size={16} /></span><div><h2>Move money, in the prototype</h2><p>Choose an action to explore the flow; nothing is sent.</p></div></div><div className="payment-action-grid">{[['Transfer', ArrowUpRight], ['Remittance', Globe2], ['Airtime & data', RefreshCw], ['Utility bills', BadgeDollarSign], ['Virtual card', CreditCard], ['FX conversion', ArrowLeftRight]].map(([label, Icon]) => <button key={label} type="button" className={description === label ? 'payment-action-selected' : ''} onClick={() => { setDescription(label); setError('') }}><Icon size={17} /><strong>{label}</strong><small>{label === 'Virtual card' ? 'Preview only' : 'Simulated'}</small></button>)}</div></section>
        <section className="money-panel"><div className="money-panel-heading"><span><ArrowUpRight size={16} /></span><div><h2>{description || 'New demo payment'}</h2><p>Saved only to this browser’s demo ledger.</p></div></div><form className="money-form" onSubmit={submitTransaction}><label>Recipient / description<input value={description === 'Transfer' || description === 'Remittance' || description === 'Airtime & data' || description === 'Utility bills' || description === 'Virtual card' ? '' : description} onChange={(event) => setDescription(event.target.value)} placeholder="Demo recipient or bill" required /></label><label>Amount and currency<span className="money-amount-input"><select value={currency} onChange={(event) => setCurrency(event.target.value)}><option>NGN</option><option>USD</option><option>EUR</option><option>GBP</option></select><input type="number" min="0.01" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required /></span></label><button type="submit" className="app-primary-button"><ArrowUpRight size={15} /> Simulate transfer</button><p>No recipient is contacted, no bank is reached, and no transaction is processed.</p></form></section>
        <section className="money-panel"><div className="money-panel-heading"><span><ArrowLeftRight size={16} /></span><div><h2>Currency conversion preview</h2><p>Illustrative fixed rates; not live foreign exchange.</p></div></div><form className="money-inline-form fx-demo-form" onSubmit={convertDemoFunds}><label>From<select value={sourceCurrency} onChange={(event) => setSourceCurrency(event.target.value)}><option>USD</option><option>EUR</option><option>GBP</option><option>NGN</option></select></label><button type="button" aria-label="Switch currencies" onClick={() => { setSourceCurrency(targetCurrency); setTargetCurrency(sourceCurrency) }}><ArrowLeftRight size={15} /></button><label>To<select value={targetCurrency} onChange={(event) => setTargetCurrency(event.target.value)}><option>NGN</option><option>USD</option><option>EUR</option><option>GBP</option></select></label><label>Amount<input type="number" min="0.01" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></label><button type="submit" className="app-primary-button">Preview conversion</button></form></section>
        <section className="money-panel"><div className="money-panel-heading"><span><CreditCard size={16} /></span><div><h2>Virtual card concept</h2><p>No PAN or payment credentials are generated.</p></div></div><div className="virtual-card-preview"><span>iConnect · DEMO CARD</span><strong>•••• &nbsp; •••• &nbsp; •••• &nbsp; 0000</strong><small>DEMO HOLDER · NOT A REAL CARD</small><CreditCard size={22} /></div><button type="button" className="money-secondary-button" onClick={() => setNotice('Virtual card is a static preview. No card has been issued.')}>Preview card details</button></section>
        <section className="money-panel transaction-history"><div className="money-panel-heading"><span><Clock3 size={16} /></span><div><h2>Local activity</h2><p>Transactions generated in this preview</p></div></div><TransactionList transactions={state.transactions} /></section>
      </div>}

      {pathname === '/app/itrade' && tradingEnabled && <div className="trade-layout-grid">
        <section className="money-panel trade-chart-panel"><Suspense fallback={<div className="trade-chart-loading">Loading interactive market chart…</div>}><TradeChart pair={pair} onPairChange={setPair} pairs={pairs} /></Suspense></section>
        <section className="money-panel trade-ticket"><div className="money-panel-heading"><span><Coins size={16} /></span><div><h2>Paper trade</h2><p>Record a simulated position only.</p></div></div><div className="trade-side-toggle"><button type="button" className={tradeSide === 'Buy' ? 'is-buy' : ''} onClick={() => setTradeSide('Buy')}>Buy / Long</button><button type="button" className={tradeSide === 'Sell' ? 'is-sell' : ''} onClick={() => setTradeSide('Sell')}>Sell / Short</button></div><form className="money-form" onSubmit={placeDemoTrade}><label>Order size (demo credits)<input type="number" min="0.01" max="10000" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></label><div className="trade-estimate"><span>Order type</span><strong>Market · simulated</strong></div><div className="trade-estimate"><span>Available demo balance</span><strong>{formatAmount(state.balances.USD, 'USD')} USD</strong></div><button type="submit" className={tradeSide === 'Buy' ? 'app-primary-button trade-buy-button' : 'app-primary-button trade-sell-button'}>{tradeSide === 'Buy' ? 'Open paper position' : 'Open short simulation'}</button><p>No order reaches a broker or blockchain. Demo positions do not generate profit or loss.</p></form></section>
        <section className="money-panel trade-bot-panel">
          <div className="trade-bot-heading">
            <div className="trade-bot-heading-title"><span className="trade-bot-icon"><Bot size={18} /></span><div><span className="app-page-eyebrow">BOT STUDIO · PAPER MODE</span><h2>Automated strategy preview</h2><p>Configure a mock strategy and review each simulated signal yourself.</p></div></div>
            <span className={`trade-bot-status ${state.paperBot.status === 'Running' ? 'is-running' : ''}`}><i /> {state.paperBot.status === 'Running' ? 'PAPER BOT ACTIVE' : 'BOT PAUSED'}</span>
          </div>
          <form className="trade-bot-config" onSubmit={saveBotConfig}>
            <label>Strategy<select value={state.paperBot.strategy} onChange={(event) => updateBotConfig('strategy', event.target.value)}>{botStrategies.map((strategy) => <option key={strategy}>{strategy}</option>)}</select></label>
            <label>Max paper order<input type="number" min="0.01" max="10000" step="any" value={state.paperBot.maxPosition} onChange={(event) => updateBotConfig('maxPosition', Number(event.target.value))} /><small>Demo USD credits</small></label>
            <label>Daily loss guard<input type="number" min="0.01" max="10000" step="any" value={state.paperBot.dailyLossLimit} onChange={(event) => updateBotConfig('dailyLossLimit', Number(event.target.value))} /><small>Demo USD credits · UI limit only</small></label>
            <label>Risk per trade<input type="number" min="0.1" max="5" step="0.1" value={state.paperBot.riskPerTrade} onChange={(event) => updateBotConfig('riskPerTrade', Number(event.target.value))} /><small>Percent · simulated setting</small></label>
            <div className="trade-bot-config-actions"><button type="submit" className="trade-bot-save-button">Save settings</button><button type="button" className={`trade-bot-toggle ${state.paperBot.status === 'Running' ? 'is-paused' : ''}`} onClick={togglePaperBot}>{state.paperBot.status === 'Running' ? <><Pause size={14} /> Pause preview</> : <><Play size={14} /> Start paper bot</>}</button><button type="button" className="trade-bot-scan-button" disabled={state.paperBot.status !== 'Running' || Boolean(state.paperBot.pendingSignal)} onClick={runBotScan}><Activity size={14} /> Run demo scan</button></div>
          </form>
          <div className="trade-bot-safety-note"><ShieldCheck size={15} /><span>The bot does not scan in the background. Scans use illustrative demo signals only; every paper trade needs your approval. No AI, broker, exchange, or live market data is connected.</span></div>
          {state.paperBot.pendingSignal && <div className="trade-bot-pending-signal"><div><span className="app-page-eyebrow">SAMPLE SIGNAL · APPROVAL REQUIRED</span><strong className={state.paperBot.pendingSignal.side === 'Buy' ? 'trade-positive' : 'trade-negative'}>{state.paperBot.pendingSignal.side === 'Buy' ? 'BUY / LONG' : 'SELL / SHORT'} · {state.paperBot.pendingSignal.pair}</strong><small>{state.paperBot.pendingSignal.strategy} · {formatAmount(state.paperBot.pendingSignal.amount, 'USD')} demo credits · {new Date(state.paperBot.pendingSignal.createdAt).toLocaleTimeString()}</small></div><div><button type="button" className="trade-bot-approve" onClick={approveBotSignal}>Record paper trade</button><button type="button" className="trade-bot-dismiss" onClick={dismissBotSignal}>Dismiss signal</button></div></div>}
          <div className="trade-bot-activity"><div className="trade-bot-activity-heading"><strong>Recent bot activity</strong><span>{state.paperBot.scanCount} manual scans</span></div>{state.paperBot.activity.length ? state.paperBot.activity.slice(0, 4).map((activity) => <article key={activity.id}><span className={`trade-bot-activity-side ${activity.side === 'Buy' ? 'trade-positive' : 'trade-negative'}`}>{activity.side}</span><strong>{activity.pair}</strong><small>{activity.strategy} · {new Date(activity.createdAt).toLocaleTimeString()}</small><em>{activity.status}</em></article>) : <p>No scans yet. Start the preview and request a manual demo scan.</p>}</div>
        </section>
        <section className="money-panel trade-market-list"><div className="money-panel-heading"><span><Globe2 size={16} /></span><div><h2>Markets watchlist</h2><p>Sample quotes · USD</p></div></div>{assets.map((asset) => <article key={asset.symbol}><span className={`asset-icon asset-${asset.color}`}>{asset.symbol.slice(0, 1)}</span><span><strong>{asset.name}</strong><small>{asset.symbol}</small></span><b>{asset.quote}</b><em className={asset.change.startsWith('-') ? 'trade-negative' : 'trade-positive'}>{asset.change}</em></article>)}</section>
        <section className="money-panel trade-history"><div className="money-panel-heading"><span><Clock3 size={16} /></span><div><h2>Paper trade history</h2><p>Local simulated orders only</p></div></div>{state.trades.length ? state.trades.map((trade) => <article key={trade.id}><span className={trade.side === 'Buy' ? 'trade-positive' : 'trade-negative'}>{trade.side}</span><strong>{trade.pair}</strong><span>{trade.amount} credits</span><small>{trade.status}</small></article>) : <div className="money-empty-state">Your paper trades will show here.</div>}</section>
      </div>}
    </div>
  )
}

function TransactionList({ transactions }) {
  if (!transactions.length) return <div className="money-empty-state">No local demo activity yet.</div>
  return <div className="transaction-list">{transactions.slice(0, 6).map((transaction) => <article key={transaction.id}><span className={`transaction-type ${transaction.kind}`}>{transaction.kind === 'credit' ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}</span><span><strong>{transaction.description}</strong><small>{new Date(transaction.createdAt).toLocaleString()}</small></span><b className={transaction.kind === 'credit' ? 'transaction-credit' : ''}>{transaction.kind === 'credit' ? '+' : '−'}{transaction.currency} {formatAmount(transaction.amount, transaction.currency)}</b></article>)}</div>
}
