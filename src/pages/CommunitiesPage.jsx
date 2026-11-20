import React from 'react'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import PageMeta from '../components/PageMeta.jsx'
import SectionHeading from '../components/SectionHeading.jsx'
import { communities, principles } from '../data/siteContent.js'

export default function CommunitiesPage() {
  return (
    <>
      <PageMeta
        title="Communities"
        description="Start or join communities on iConnect around your interests: music, reading, photography, the outdoors and more."
      />
      <section className="page-hero page-hero-community px-6 py-16 md:px-10 md:py-24 xl:px-14">
        <div className="mx-auto max-w-[1208px]">
          <SectionHeading
            number="01"
            eyebrow="FIND YOUR PEOPLE"
            title="Your interests,"
            emphasis="your corner."
            description="Members start and join communities around the things they love, the things they're learning, and the moments they want to share."
          >
            <div className="community-hero-side">
              <figure className="community-hero-photo"><img src="https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=900&h=620&q=75" alt="A group of friends with arms around each other looking out at the view" /></figure>
              <Link className="button-primary page-heading-cta" to="/app/onboarding">Join and find your community <ArrowRight size={17} /></Link>
            </div>
          </SectionHeading>
        </div>
      </section>

      <section className="community-directory section-pad">
        <div className="community-directory-heading">
          <div className="section-kicker"><span>02</span> LITTLE CORNERS, BIG INTERESTS</div>
          <p>Any member can create a community in a few taps, add a cover photo, and other members can find and join it. Here are a few ideas to get you started.</p>
        </div>
        <div className="spaces-grid">
          {communities.map((community, index) => (
            <article className={`space-card reveal ${community.className}`} style={{ '--reveal-delay': `${index * 80}ms` }} key={community.name}>
              <img src={`https://images.unsplash.com/${community.image}?auto=format&fit=crop&w=720&h=560&q=85`} alt="" loading="lazy" />
              <span className="space-index">0{index + 1} / IDEA TO START</span>
              <div className="space-card-copy">
                <h3>{community.name}</h3>
                <p>{community.description}</p>
              </div>
              <span className="community-card-arrow"><ArrowUpRight size={18} /></span>
            </article>
          ))}
        </div>
      </section>

      <section className="community-values-section">
        <div className="community-values-inner">
          <div className="community-values-heading">
            <div className="section-kicker"><span>03</span> THE KIND OF SOCIAL WE WANT</div>
            <h2>Social should feel<br />like <span className="serif-italic">being social.</span></h2>
          </div>
          <div className="community-values-list">
            {principles.map(({ title, description, icon: Icon }, index) => (
              <article className="community-value reveal" style={{ '--reveal-delay': `${index * 80}ms` }} key={title}>
                <span className="community-value-icon"><Icon size={18} /></span>
                <span className="community-value-number">0{index + 1}</span>
                <div><h3>{title}</h3><p>{description}</p></div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
