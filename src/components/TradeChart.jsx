import React, { useEffect, useMemo, useRef, useState } from 'react'
import { CandlestickSeries, CrosshairMode, HistogramSeries, createChart } from 'lightweight-charts'

const marketQuotes = {
  'EUR/USD': { price: 1.0842, precision: 5, volatility: 0.00065 },
  'XAU/USD': { price: 2335.6, precision: 2, volatility: 0.0018 },
  'BTC/USDT': { price: 67480, precision: 2, volatility: 0.0025 },
  'ETH/USDT': { price: 3510, precision: 2, volatility: 0.0028 },
}

const timeframes = [
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 300 },
  { label: '15m', seconds: 900 },
  { label: '1H', seconds: 3600 },
  { label: '4H', seconds: 14400 },
  { label: '1D', seconds: 86400 },
]

function makeCandles(pair, timeframe) {
  const quote = marketQuotes[pair] ?? marketQuotes['EUR/USD']
  const interval = timeframes.find((item) => item.label === timeframe) ?? timeframes[0]
  const now = Math.floor(Date.now() / 1000 / interval.seconds) * interval.seconds
  let seed = [...pair].reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, interval.seconds)
  const nextRandom = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  const values = []
  let close = quote.price * (1 - quote.volatility * 8)

  for (let index = 89; index >= 0; index -= 1) {
    const open = close
    const drift = (nextRandom() - 0.48) * quote.volatility * quote.price
    close = Math.max(quote.price * 0.7, open + drift)
    const wick = nextRandom() * quote.volatility * quote.price * 0.8
    const volume = Math.round((0.3 + nextRandom() * 1.4) * 1000)
    values.push({
      time: (now - index * interval.seconds),
      open,
      high: Math.max(open, close) + wick,
      low: Math.max(quote.price * 0.7, Math.min(open, close) - wick * (0.5 + nextRandom())),
      close,
      volume,
      volumeColor: close >= open ? '#8ca56a80' : '#c9756680',
    })
  }
  return values
}

function formatPrice(value, precision) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(value)
}

export default function TradeChart({ pair, onPairChange, pairs }) {
  const chartElement = useRef(null)
  const [timeframe, setTimeframe] = useState('1H')
  const [hoveredCandle, setHoveredCandle] = useState(null)
  const quote = marketQuotes[pair] ?? marketQuotes['EUR/USD']
  const candles = useMemo(() => makeCandles(pair, timeframe), [pair, timeframe])
  const lastCandle = candles[candles.length - 1]
  const firstCandle = candles[0]
  const change = ((lastCandle.close - firstCandle.open) / firstCandle.open) * 100
  const displayedCandle = hoveredCandle ?? lastCandle

  useEffect(() => {
    if (!chartElement.current) return undefined

    const chart = createChart(chartElement.current, {
      autoSize: true,
      height: 330,
      layout: {
        background: { color: '#fffefa' },
        textColor: '#85867d',
        fontFamily: 'DM Sans, sans-serif',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: '#f1f0eb' },
        horzLines: { color: '#f1f0eb' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#9eae7a', labelBackgroundColor: '#78894f' },
        horzLine: { color: '#9eae7a', labelBackgroundColor: '#78894f' },
      },
      rightPriceScale: { borderColor: '#e9e8e1' },
      timeScale: { borderColor: '#e9e8e1', timeVisible: true, secondsVisible: false },
      localization: {
        priceFormatter: (price) => formatPrice(price, quote.precision),
      },
    })
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#78934f',
      downColor: '#c76e5d',
      borderUpColor: '#78934f',
      borderDownColor: '#c76e5d',
      wickUpColor: '#78934f',
      wickDownColor: '#c76e5d',
      priceLineVisible: false,
    })
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    })
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
      visible: false,
    })
    candleSeries.setData(candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })))
    volumeSeries.setData(candles.map(({ time, volume, volumeColor }) => ({ time, value: volume, color: volumeColor })))
    chart.timeScale().fitContent()

    const onCrosshairMove = (param) => {
      const candle = param.seriesData.get(candleSeries)
      setHoveredCandle(candle && 'open' in candle ? candle : null)
    }
    chart.subscribeCrosshairMove(onCrosshairMove)

    return () => {
      chart.unsubscribeCrosshairMove(onCrosshairMove)
      chart.remove()
    }
  }, [candles, quote.precision])

  return (
    <div className="trade-chart-terminal">
      <div className="trade-panel-toolbar">
        <div>
          <span className="app-page-eyebrow">PAPER TRADING · SIMULATION</span>
          <h2>
            <select value={pair} onChange={(event) => onPairChange(event.target.value)} aria-label="Market pair">
              {pairs.map((item) => <option key={item}>{item}</option>)}
            </select>
            <small className={change >= 0 ? 'trade-positive' : 'trade-negative'}>{change >= 0 ? '+' : ''}{change.toFixed(2)}% demo</small>
          </h2>
        </div>
        <span className="simulated-pill"><i /> MOCK MARKET</span>
      </div>
      <div className="trade-chart-summary">
        <strong>{formatPrice(displayedCandle.close, quote.precision)}</strong>
        <span className={change >= 0 ? 'trade-positive' : 'trade-negative'}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</span>
        <small>{hoveredCandle ? 'Selected candle' : 'Illustrative quote · not real-time'}</small>
      </div>
      <div className="trade-chart-toolbar">
        <div className="trade-ohlc-readout">
          <span>O <b>{formatPrice(displayedCandle.open, quote.precision)}</b></span>
          <span>H <b>{formatPrice(displayedCandle.high, quote.precision)}</b></span>
          <span>L <b>{formatPrice(displayedCandle.low, quote.precision)}</b></span>
          <span>C <b>{formatPrice(displayedCandle.close, quote.precision)}</b></span>
        </div>
        <div className="trade-timeframe-controls" aria-label="Chart timeframe">
          {timeframes.map(({ label }) => <button key={label} type="button" className={timeframe === label ? 'is-active' : ''} aria-pressed={timeframe === label} onClick={() => { setTimeframe(label); setHoveredCandle(null) }}>{label}</button>)}
        </div>
      </div>
      <div className="trade-chart-canvas" ref={chartElement} role="img" aria-label={`${pair} candlestick chart with volume, simulated ${timeframe} timeframe`} />
      <div className="trade-chart-attribution">Charts by <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts™</a></div>
      <div className="trade-disclaimer">Demo candles and volume are generated locally for interface testing only—not live market data or investment guidance.</div>
    </div>
  )
}
