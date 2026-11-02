import React from 'react'
import Brand from './Brand.jsx'

export default function UserLoadingScreen() {
  return (
    <main className="user-loading-screen" role="status" aria-live="polite">
      <div className="user-loading-glow user-loading-glow-one" aria-hidden="true" />
      <div className="user-loading-glow user-loading-glow-two" aria-hidden="true" />
      <section className="user-loading-card">
        <Brand className="user-loading-brand" to="/app/onboarding" />
        <div className="user-loading-scene" aria-hidden="true">
          <div className="user-loading-orbit user-loading-orbit-outer" />
          <div className="user-loading-orbit user-loading-orbit-inner" />
          <div className="user-loading-core"><span>i</span></div>
          <div className="user-loading-float user-loading-float-left"><i /><span /><span /></div>
          <div className="user-loading-float user-loading-float-right"><i /><span /><span /></div>
          <span className="user-loading-spark user-loading-spark-one">✦</span>
          <span className="user-loading-spark user-loading-spark-two">✦</span>
        </div>
        <span className="user-loading-eyebrow">YOUR WORLD, IN ONE PLACE</span>
        <h1>Making space for you.</h1>
        <p>Bringing your people, messages, and moments together.</p>
        <div className="user-loading-progress" aria-hidden="true"><span /></div>
        <span className="user-loading-status">Getting your space ready<span className="user-loading-dots">…</span></span>
      </section>
      <span className="user-loading-footer">A little connection goes a long way.</span>
    </main>
  )
}
