import React from 'react'
import { ArrowDownLeft, ArrowUpRight, BookOpen, CircleHelp, LockKeyhole, ShieldCheck, Wallet } from 'lucide-react'
import AppPageHeader from '../../components/AppPageHeader.jsx'

export default function InvestPage() {
  return (
    <div className="app-content-width">
      <AppPageHeader eyebrow="A FUTURE PRODUCT AREA" title="Invest & save" description="A carefully considered direction for wallet tools, learning, and community savings." />
      <div className="invest-preview-banner"><LockKeyhole size={17} /><span><strong>Concept only — no financial services are available.</strong> No wallet is connected, no funds are held, and no transaction can be made here.</span></div>
      <section className="wallet-overview-card">
        <div className="wallet-overview-top"><span><Wallet size={17} /> iCONNECT WALLET CONCEPT</span><span className="wallet-unavailable-pill"><i /> NOT CONNECTED</span></div>
        <div className="wallet-balance-label">Available balance</div><div className="wallet-balance">— <small>USD</small></div>
        <p>Connect a wallet only in a future, reviewed product experience.</p>
        <div className="wallet-actions"><button disabled><ArrowDownLeft size={16} /> Receive</button><button disabled><ArrowUpRight size={16} /> Send</button></div>
        <div className="wallet-card-watermark"><Wallet size={115} strokeWidth={.7} /></div>
      </section>
      <section className="invest-learning-section"><div><span className="app-page-eyebrow">DESIGNED FOR UNDERSTANDING</span><h2>Money tools need<br />more than a nice screen.</h2><p>The PRD mentions external wallets, crypto, investments, and Ajo savings groups. Those areas need security, legal, regulatory, and operational work before they can be offered.</p></div><div className="invest-safety-list"><article><ShieldCheck size={18} /><div><strong>Security first</strong><span>Wallet connection and transaction safety need dedicated review.</span></div></article><article><BookOpen size={18} /><div><strong>Education built in</strong><span>Clear explanations should come before any financial action.</span></div></article><article><CircleHelp size={18} /><div><strong>Honest availability</strong><span>This preview does not provide financial advice or services.</span></div></article></div></section>
    </div>
  )
}
