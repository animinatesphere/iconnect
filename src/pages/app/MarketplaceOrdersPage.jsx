import React, { useCallback, useEffect, useState } from 'react'
import { BadgeCheck, MessageCircle, PackageCheck, RefreshCw, ShoppingBag } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import { confirmBillingPayment } from '../../utils/billingApi.js'
import { fulfillMarketplaceOrder, getMarketplaceOrders } from '../../utils/marketplaceApi.js'
import { openConversation } from '../../utils/messageApi.js'

function formatPrice(amountMinor, currency) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amountMinor / 100)
}

function statusLabel(status) {
  return ({
    pending: 'Awaiting payment',
    paid: 'Paid · awaiting fulfillment',
    fulfilled: 'Fulfilled',
    payment_failed: 'Payment failed',
    expired: 'Checkout expired',
    refund_required: 'Payment received · review required',
  })[status] ?? status
}

export default function MarketplaceOrdersPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    const nextOrders = await getMarketplaceOrders()
    setOrders(nextOrders)
  }, [])

  useEffect(() => {
    let active = true
    getMarketplaceOrders()
      .then((nextOrders) => {
        if (!active) return
        setOrders(nextOrders)
      })
      .catch((loadError) => { if (active) setError(loadError.message || 'Could not load your marketplace orders.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const reference = searchParams.get('reference')
    if (searchParams.get('status') !== 'success' || !reference) return
    let active = true
    setBusy('confirm')
    confirmBillingPayment(reference)
      .then(async () => {
        if (!active) return
        await refresh()
        setNotice('Payment confirmed. Your order is now in your orders list.')
        navigate('/app/orders', { replace: true })
      })
      .catch((confirmError) => { if (active) setError(confirmError.message || 'We could not confirm the payment yet.') })
      .finally(() => { if (active) setBusy('') })
    return () => { active = false }
  }, [navigate, refresh, searchParams])

  async function markFulfilled(order) {
    setBusy(order.id)
    setError('')
    setNotice('')
    try {
      await fulfillMarketplaceOrder(order.id)
      await refresh()
      setNotice(`Marked ${order.productName} as fulfilled.`)
    } catch (fulfillError) {
      setError(fulfillError.message || 'Could not update this order.')
    } finally {
      setBusy('')
    }
  }

  async function messageOtherParty(order) {
    setBusy(`message-${order.id}`)
    try {
      const conversationId = await openConversation(order.otherParty.id)
      navigate('/app/chat', { state: { conversationId } })
    } catch (messageError) {
      setError(messageError.message || 'Could not open a conversation.')
    } finally {
      setBusy('')
    }
  }

  if (loading) return <div className="app-content-width"><p role="status">Loading orders…</p></div>
  const purchases = orders.filter((order) => order.role === 'buyer')
  const sales = orders.filter((order) => order.role === 'seller')
  const sections = [['purchases', 'Your purchases', purchases], ['sales', 'Your sales', sales]]

  return (
    <div className="app-content-width marketplace-orders-page">
      <AppPageHeader eyebrow="IBUY · ORDER MANAGEMENT" title="Marketplace orders" description="Review purchases, follow up with sellers, and manage the orders you receive." />
      {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
      {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}
      {busy === 'confirm' && <p role="status">Confirming your payment…</p>}
      <div className="marketplace-orders-actions">
        <Link className="product-detail-secondary-button" to="/app/ibuy"><ShoppingBag size={15} /> Browse iBuy</Link>
        <button type="button" className="product-detail-secondary-button" onClick={() => refresh().catch((refreshError) => setError(refreshError.message))}><RefreshCw size={14} /> Refresh orders</button>
      </div>
      {sections.map(([key, title, list]) => <section className="marketplace-orders-section" key={key}>
        <div className="marketplace-orders-heading"><span className="app-page-eyebrow">{key === 'sales' ? 'SELLER WORKSPACE' : 'BUYER WORKSPACE'}</span><h2>{title} <small>{list.length}</small></h2></div>
        {list.length ? <div className="marketplace-order-list">{list.map((order) => <article className="marketplace-order-card" key={`${key}-${order.id}`}>
          <div className={`marketplace-order-status order-${order.status}`}><PackageCheck size={15} /> {statusLabel(order.status)}</div>
          {order.status === 'refund_required' && <p className="feed-interaction-notice feed-error" role="alert">Your payment was received after the stock reservation expired, and the item is no longer available. Contact iConnect support before placing another order; a refund needs to be arranged.</p>}
          <div className="marketplace-order-main"><h3>{order.productName}</h3><p>{order.quantity} × {formatPrice(order.unitPriceMinor, order.currency)} · {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(order.createdAt))}</p><small>{key === 'sales' ? 'Buyer' : 'Seller'}: {order.otherParty.name} · @{order.otherParty.username}</small></div>
          <strong className="marketplace-order-total">{formatPrice(order.amountMinor, order.currency)}</strong>
          <div className="marketplace-order-actions">
            <button type="button" className="product-detail-secondary-button" disabled={busy !== ''} onClick={() => messageOtherParty(order)}><MessageCircle size={14} /> {busy === `message-${order.id}` ? 'Opening…' : 'Message'}</button>
            {key === 'sales' && order.status === 'paid' && <button type="button" className="app-primary-button" disabled={busy !== ''} onClick={() => markFulfilled(order)}><BadgeCheck size={14} /> {busy === order.id ? 'Saving…' : 'Mark fulfilled'}</button>}
            {key === 'sales' && (order.status === 'paid' || order.status === 'fulfilled') && <small className="marketplace-seller-net">Seller amount: {formatPrice(order.sellerAmountMinor, order.currency)}</small>}
          </div>
        </article>)}</div> : <div className="marketplace-orders-empty"><PackageCheck size={22} /><p>No {key} yet.</p><span>Orders from iBuy will show here.</span></div>}
      </section>)}
      <p className="marketplace-payout-note">iConnect records order totals and its configured commission. Seller payouts and delivery arrangements are handled outside iBuy for now.</p>
    </div>
  )
}
