import React from 'react'
import { ArrowRight, Check, Heart, MessageCircle, ShieldCheck, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import Brand from '../../components/Brand.jsx'
import PageMeta from '../../components/PageMeta.jsx'

export default function OnboardingPage() {
  return (
    <>
      <PageMeta title="A social space that feels like yours" description="Meet iConnect: a thoughtful social experience for sharing moments, finding your people, and feeling more connected." />
      <main className="onboarding-screen onboarding-animated">
        <header className="onboarding-header">
          <Brand />
          <nav className="onboarding-nav">
            <Link to="/app/login">Log in</Link>
            <Link to="/app/signup" className="onboarding-nav-cta">Sign up</Link>
          </nav>
        </header>
        <div className="onboarding-layout">
          <section className="onboarding-story onboarding-enter-left">
            <span className="onboarding-badge"><span /> A NEW KIND OF SOCIAL SPACE</span>
            <h1>Your people.<br />Your moments.<br /><em>Your place.</em></h1>
            <p>Share the little things, find people who get you, and spend more time connecting—not bouncing between apps.</p>
            <div className="onboarding-benefits">
              <span><Heart size={15} /> A feed for real moments</span>
              <span><Users size={15} /> Find your people and communities</span>
              <span><MessageCircle size={15} /> Keep conversations close</span>
            </div>
            <div className="onboarding-quote">
              <span className="onboarding-quote-mark">“</span>
              <p>Less scrolling past each other. More showing up for each other.</p>
              <span>THE iCONNECT WAY</span>
            </div>
          </section>
          <section className="onboarding-card onboarding-enter-right">
            <span className="app-page-eyebrow">WELCOME TO iCONNECT</span>
            <h2>Good things happen<br />when we <em>connect.</em></h2>
            <p className="onboarding-card-copy">A home for your updates, conversations, and the communities that make you feel at home.</p>
            <Link to="/app/signup" className="app-primary-button onboarding-continue">Create your account <ArrowRight size={17} /></Link>
            <div className="onboarding-login-prompt">Already have an account? <Link to="/app/login">Log in</Link></div>
            <div className="onboarding-privacy"><ShieldCheck size={18} /><span><strong>Email verification required.</strong> New accounts use a one-time email code. Passwords are stored as one-way hashes.</span></div>
            <div className="onboarding-methods"><span /><small>MADE FOR YOUR SOCIAL LIFE</small><span /></div>
            <div className="planned-providers"><span><Heart size={15} /> Share</span><span><Users size={15} /> Discover</span><span><MessageCircle size={15} /> Connect</span></div>
            <p className="onboarding-provider-note">Website-first experience · Mobile app comes later</p>
          </section>
        </div>
        <footer className="onboarding-footer"><Link to="/">← Back to iConnect website</Link><span>Social, made a little more human</span></footer>
      </main>
    </>
  )
}
