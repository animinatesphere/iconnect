import React from 'react'
import { ArrowRight, ArrowUpRight, Check } from 'lucide-react'
import { Link } from 'react-router-dom'
import PageMeta from '../components/PageMeta.jsx'
import SectionHeading from '../components/SectionHeading.jsx'
import { productAreas } from '../data/siteContent.js'

export default function ProductPage() {
  return (
    <>
      <PageMeta
        title="Product vision"
        description="Explore the iConnect product vision, including a connected feed, messaging, content creation, and future opportunities."
      />
      <section className="page-hero page-hero-product px-6 py-16 md:px-10 md:py-24 xl:px-14">
        <div className="page-hero-inner mx-auto grid max-w-[1208px] grid-cols-1 items-end gap-8 md:grid-cols-[1.2fr_.8fr]">
          <SectionHeading
            number="01"
            eyebrow="WHAT WE'RE BUILDING"
            title="One home for"
            emphasis="your online life."
            description="iConnect is a web-first product vision for bringing the useful parts of your digital life closer together."
          />
          <div className="product-intro-note">
            <span className="concept-pill"><span className="live-dot" /> PRODUCT VISION</span>
            <p>These are planned directions—not features available on this marketing website today.</p>
            <Link className="arrow-link" to="/roadmap">See the build phases <span><ArrowUpRight size={17} /></span></Link>
          </div>
        </div>
      </section>

      <section className="product-areas-section section-pad">
        <div className="product-areas-heading">
          <div className="section-kicker"><span>02</span> A CONNECTED TOOLKIT</div>
          <h2>Different needs.<br /><span className="serif-italic">A clearer home.</span></h2>
        </div>
        <div className="product-area-grid">
          {productAreas.map(({ name, description, icon: Icon, status }, index) => (
            <article className="product-area-card" key={name}>
              <span className="product-area-number">0{index + 1}</span>
              <span className="product-area-icon"><Icon size={20} strokeWidth={1.7} /></span>
              <h3>{name}</h3>
              <p>{description}</p>
              <span className="planned-label">{status}</span>
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
            <p><Check size={17} /> Clear about what is live and what is planned</p>
            <p><Check size={17} /> User control over connected accounts and privacy</p>
            <p><Check size={17} /> A focused web product before a mobile expansion</p>
            <p><Check size={17} /> Careful treatment of sensitive features and data</p>
          </div>
        </div>
      </section>

      <section className="page-cta">
        <div><span className="section-kicker"><span>04</span> BUILDING IN THE OPEN</span><h2>Follow the <span className="serif-italic">journey.</span></h2></div>
        <Link className="button-primary" to="/roadmap">View the roadmap <ArrowRight size={17} /></Link>
      </section>
    </>
  )
}
