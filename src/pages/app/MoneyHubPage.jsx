import React from 'react'
import { Activity, ArrowRight, CreditCard, LockKeyhole, ShieldCheck, Wallet } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'

const screens = {
  '/app/wallet': {
    name: 'Wallet',
    eyebrow: 'YOUR MONEY · NOT CONNECTED',
    description: 'Wallet balances and transfers will appear here after a secure wallet provider is integrated.',
    icon: Wallet,
    title: 'No wallet is connected.',
    detail: 'iConnect does not hold funds or connect to a bank or crypto wallet. There is no balance to view and no transfer can be made.',
  },
  '/app/payments': {
    name: 'Payments',
    eyebrow: 'PAYMENTS · NOT CONNECTED',
    description: 'Payment options will appear here when an authorized payment provider is integrated.',
    icon: CreditCard,
    title: 'Payments are unavailable.',
    detail: 'No bank, card, or payment processor is connected. You cannot send or receive money or make a payment from this page.',
  },
  '/app/itrade': {
    name: 'iTrade',
    eyebrow: 'MARKETS · NOT CONNECTED',
    description: 'Trading tools require a verified market-data and brokerage integration.',
    icon: Activity,
    title: 'Trading is unavailable.',
    detail: 'This page has no live market data or broker integration. No quote, signal, order, or trade is shown or recorded.',
  },
}

export default function MoneyHubPage() {
  const { pathname } = useLocation()
  const screen = screens[pathname] ?? screens['/app/wallet']
  const Icon = screen.icon

  return (
    <div className="app-content-width money-unavailable-page">
      <AppPageHeader eyebrow={screen.eyebrow} title={screen.name} description={screen.description} />
      <section className="money-unavailable-card" role="status">
        <span className="money-unavailable-icon"><Icon size={22} /></span>
        <div>
          <span className="app-page-eyebrow">NOT CONNECTED</span>
          <h2>{screen.title}</h2>
          <p>{screen.detail}</p>
        </div>
      </section>
      <section className="money-safety-note">
        <ShieldCheck size={18} />
        <div>
          <strong>Nothing is stored or transacted on this page.</strong>
          <p>Financial features will remain unavailable until the required providers, security controls, and operational safeguards are in place.</p>
        </div>
        <LockKeyhole size={17} />
      </section>
      <div className="money-learning-link">
        <div><span className="app-page-eyebrow">PRODUCT STATUS</span><h3>Learn what iConnect plans to build</h3><p>Explore the financial product areas and why they need careful integration.</p></div>
        <Link to="/app/invest">View product notes <ArrowRight size={14} /></Link>
      </div>
    </div>
  )
}
