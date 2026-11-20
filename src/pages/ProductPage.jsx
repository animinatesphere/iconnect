import React from 'react'
import { ArrowRight, ArrowUpRight, Check } from 'lucide-react'
import { Link } from 'react-router-dom'
import PageMeta from '../components/PageMeta.jsx'
import SectionHeading from '../components/SectionHeading.jsx'
import { productAreas } from '../data/siteContent.js'

export default function ProductPage() {
  const liveCount = productAreas.filter((area) => area.status.startsWith('Live')).length

  return (
    <>
      <PageMeta
        title="Product"
        description="See everything you can do on iConnect today: feed, chat, communities, live video, marketplace, jobs, stays and rides, dating, AI and more."
      />
      <section className="page-hero page-hero-product px-6 py-16 md:px-10 md:py-24 xl:px-14">
        <div className="page-hero-inner mx-auto grid max-w-[1208px] grid-cols-1 items-end gap-8 md:grid-cols-[1.2fr_.8fr]">
          <SectionHeading
            number="01"
            eyebrow="WHAT YOU CAN DO TODAY"
            title="One home for"
            emphasis="your online life."
            description="iConnect is live on the web. Create a free account and use the feed, chat, communities, marketplace, jobs and more, all from one login."
          />
          <div className="product-intro-note">
            <span className="concept-pill"><span className="live-dot" /> {liveCount} FEATURES LIVE NOW</span>
            <p>Every card marked <strong>Live</strong> works today. Cards marked <strong>Coming soon</strong> are being built, and we say so plainly.</p>
            <Link className="arrow-link" to="/app/onboarding">Create your free account <span><ArrowUpRight size={17} /></span></Link>
          </div>
        </div>
      </section>

      <section className="lp-photo-strip" aria-label="iConnect in everyday life">
        {[
          ['photo-1511988617509-a57c8a288659', 'Friends laughing together outdoors', 'Stay close to your people', 'Feed, stories and private chat'],
          ['photo-1522202176988-66273c2fd55f', 'Three people working together at a café table with laptops', 'Work, sell and hire', 'Marketplace, jobs and ads'],
          ['photo-1529156069898-49953e39b3ac', 'A group of friends with arms around each other looking at the view', 'Find your community', 'Communities around what you love'],
        ].map(([id, alt, title, caption], index) => (
          <figure className="lp-photo reveal" style={{ '--reveal-delay': `${index * 90}ms` }} key={id}>
            <img src={`https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&h=640&q=75`} alt={alt} loading="lazy" />
            <figcaption><strong>{title}</strong><span>{caption}</span></figcaption>
          </figure>
        ))}
      </section>

      <section className="product-areas-section section-pad">
        <div className="product-areas-heading">
          <div className="section-kicker"><span>02</span> EVERYTHING IN ONE PLACE</div>
          <h2>Different needs.<br /><span className="serif-italic">One account.</span></h2>
        </div>
        <div className="product-area-grid">
          {productAreas.map(({ name, description, icon: Icon, status }, index) => (
            <article className="product-area-card reveal" style={{ '--reveal-delay': `${(index % 3) * 70}ms` }} key={name}>
              <span className="product-area-number">{String(index + 1).padStart(2, '0')}</span>
              <span className="product-area-icon"><Icon size={20} strokeWidth={1.7} /></span>
              <h3>{name}</h3>
              <p>{description}</p>
              <span className={`product-status ${status.startsWith('Live') ? 'is-live' : 'is-soon'}`}>{status}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="product-principles">
        <div className="product-principles-inner">
          <div>
            <div className="section-kicker"><span>03</span> BUILT AROUND PEOPLE</div>
            <h2>Useful by design.<br /><span className="serif-italic">Human by default.</span></h2>
          </div>
          <div className="product-checklist">
            <p><Check size={17} /> Clear about what is live and what is still coming</p>
            <p><Check size={17} /> You control who can find you and message you</p>
            <p><Check size={17} /> Payments handled by trusted providers (Paystack and Stripe)</p>
            <p><Check size={17} /> Money features only with properly licensed partners</p>
          </div>
        </div>
      </section>

      <section className="page-cta">
        <div><span className="section-kicker"><span>04</span> JOIN IN</span><h2>Come and <span className="serif-italic">try it.</span></h2></div>
        <Link className="button-primary" to="/app/onboarding">Create your free account <ArrowRight size={17} /></Link>
      </section>
    </>
  )
}
