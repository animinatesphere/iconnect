import React from 'react'
import { ArrowUpRight, Megaphone } from 'lucide-react'
import { recordAdClick } from '../utils/adsApi.js'

export default function SponsoredAd({ ad }) {
  async function open() {
    try {
      const { linkUrl } = await recordAdClick(ad.id)
      const target = linkUrl || ad.linkUrl
      if (target) window.open(target, '_blank', 'noopener,noreferrer')
    } catch {
      if (ad.linkUrl) window.open(ad.linkUrl, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <article className="feed-card sponsored-ad" aria-label={`Sponsored: ${ad.title}`}>
      <div className="sponsored-ad-head"><span><Megaphone size={13} /> Sponsored</span><small>{ad.advertiser}</small></div>
      {ad.imageUrl && <img src={ad.imageUrl} alt="" loading="lazy" />}
      <h3>{ad.title}</h3>
      <p>{ad.body}</p>
      {ad.linkUrl && <button type="button" onClick={open}>{ad.ctaLabel} <ArrowUpRight size={14} /></button>}
    </article>
  )
}
