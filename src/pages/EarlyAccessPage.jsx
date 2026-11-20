import React from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, UserPlus } from 'lucide-react'
import { Link } from 'react-router-dom'
import PageMeta from '../components/PageMeta.jsx'

export default function EarlyAccessPage() {
  return (
    <>
      <PageMeta
        title="Join iConnect"
        description="iConnect is open on the web. Create a free account and start posting, chatting and exploring today."
      />
      <section className="updates-page px-6 py-16 md:px-10 md:py-24 xl:px-14">
        <div className="updates-card mx-auto grid max-w-[1080px] grid-cols-1 overflow-hidden md:grid-cols-[1.05fr_.95fr]">
          <div className="updates-copy">
            <span className="updates-kicker"><span className="live-dot" /> OPEN NOW · FREE TO JOIN</span>
            <h1>Come on<br /><span className="serif-italic">in.</span></h1>
            <p>iConnect is live on the web. Create your account, set up your profile, and start using the feed, chat, communities, marketplace and more today.</p>
            <div className="updates-status"><UserPlus size={18} /><div><strong>Signing up takes about a minute.</strong><span>You'll confirm your email with a short code, then you're in.</span></div></div>
            <Link className="button-primary updates-roadmap-link" to="/app/onboarding">Create your free account <ArrowRight size={16} /></Link>
            <Link className="text-link updates-back" to="/"><ArrowLeft size={15} /> Back to iConnect</Link>
          </div>
          <div className="updates-side">
            <figure className="updates-photo"><img src="https://images.unsplash.com/photo-1531545514256-b1400bc00f31?auto=format&fit=crop&w=900&h=500&q=75" alt="Friends gathered around a laptop, smiling" /></figure>
            <div className="updates-side-icon"><CheckCircle2 size={24} /></div>
            <span className="section-kicker"><span>01</span> WHAT HAPPENS NEXT</span>
            <h2>Three quick<br />steps.</h2>
            <div className="updates-step"><span>01</span><p><strong>Create your account.</strong> Your name, email and a password.</p></div>
            <div className="updates-step"><span>02</span><p><strong>Confirm your email.</strong> Enter the code we send you.</p></div>
            <div className="updates-step"><span>03</span><p><strong>Set up your profile.</strong> Add a photo and interests, then explore.</p></div>
            <Link className="text-link" to="/app/login">Already have an account? Log in</Link>
          </div>
        </div>
      </section>
    </>
  )
}
