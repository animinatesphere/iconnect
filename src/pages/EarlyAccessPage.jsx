import React from 'react'
import { ArrowLeft, ArrowRight, BellRing, Mail, MessageCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import PageMeta from '../components/PageMeta.jsx'

export default function EarlyAccessPage() {
  return (
    <>
      <PageMeta
        title="Follow iConnect"
        description="Learn how to follow the iConnect website-first journey and get updates as the product takes shape."
      />
      <section className="updates-page px-6 py-16 md:px-10 md:py-24 xl:px-14">
        <div className="updates-card mx-auto grid max-w-[1080px] grid-cols-1 overflow-hidden md:grid-cols-[1.05fr_.95fr]">
          <div className="updates-copy">
            <span className="updates-kicker"><span className="live-dot" /> WEBSITE FIRST, MOBILE LATER</span>
            <h1>Good things<br />take <span className="serif-italic">shape.</span></h1>
            <p>iConnect is at the beginning of its web-first journey. Follow along as the website and product direction develop.</p>
            <div className="updates-status"><BellRing size={18} /><div><strong>Early access signup is not open yet.</strong><span>We’ll share a signup option here when there’s a working way to collect updates.</span></div></div>
            <Link className="text-link updates-back" to="/"><ArrowLeft size={15} /> Back to iConnect</Link>
          </div>
          <div className="updates-side">
            <div className="updates-side-icon"><Mail size={24} /></div>
            <span className="section-kicker"><span>01</span> FOLLOW THE JOURNEY</span>
            <h2>What happens<br />from here?</h2>
            <div className="updates-step"><span>01</span><p><strong>Website first.</strong> We’re introducing iConnect and clarifying what we’re building.</p></div>
            <div className="updates-step"><span>02</span><p><strong>Build the web product.</strong> The first core product journeys come next.</p></div>
            <div className="updates-step"><span>03</span><p><strong>Mobile later.</strong> Mobile apps follow after the web foundations are in place.</p></div>
            <Link className="button-primary updates-roadmap-link" to="/roadmap">Read the roadmap <ArrowRight size={16} /></Link>
            <span className="updates-side-note"><MessageCircle size={13} /> No fake signup form. We’ll add one when it can really save your details.</span>
          </div>
        </div>
      </section>
    </>
  )
}
