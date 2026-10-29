const adminSessionKey = 'iconnect.admin.demo.session'
const adminStateKey = 'iconnect.admin.demo.state'

export const defaultAdminSettings = {
  videoUploadsEnabled: true,
  campaignDraftsEnabled: true,
  walletsEnabled: true,
  paymentsEnabled: true,
  tradingEnabled: true,
  marketplaceEnabled: true,
  bookingsEnabled: true,
  socialEnabled: true,
  liveVideoEnabled: true,
}

export function getDemoAdminSettings() {
  return readDemoAdminState().settings
}

export function isDemoAdminSessionActive() {
  return window.localStorage.getItem(adminSessionKey) === 'active'
}

export function startDemoAdminSession() {
  window.localStorage.setItem(adminSessionKey, 'active')
}

export function endDemoAdminSession() {
  window.localStorage.removeItem(adminSessionKey)
}

export function readDemoAdminState() {
  const serialized = window.localStorage.getItem(adminStateKey)
  if (!serialized) {
    return {
      userStatuses: {},
      reviewedReportIds: [],
      settings: defaultAdminSettings,
      campaignStatuses: {},
      auditLog: [],
      productCatalog: [],
      productOverrides: {},
      orderStatuses: {},
    }
  }

  const state = JSON.parse(serialized)
  if (
    !state ||
    !state.userStatuses ||
    typeof state.userStatuses !== 'object' ||
    Array.isArray(state.userStatuses) ||
    !Array.isArray(state.reviewedReportIds) ||
    !state.settings ||
    typeof state.settings !== 'object' ||
    !state.campaignStatuses ||
    typeof state.campaignStatuses !== 'object' ||
    Array.isArray(state.campaignStatuses) ||
    (state.auditLog !== undefined && !Array.isArray(state.auditLog)) ||
    (state.productCatalog !== undefined && !Array.isArray(state.productCatalog)) ||
    (state.productOverrides !== undefined && (!state.productOverrides || typeof state.productOverrides !== 'object' || Array.isArray(state.productOverrides))) ||
    (state.orderStatuses !== undefined && (!state.orderStatuses || typeof state.orderStatuses !== 'object' || Array.isArray(state.orderStatuses)))
  ) {
    throw new Error('Saved demo admin data is invalid. Clear this browser’s iConnect admin demo data to continue.')
  }

  return {
    userStatuses: state.userStatuses,
    reviewedReportIds: state.reviewedReportIds,
    settings: { ...defaultAdminSettings, ...state.settings },
    campaignStatuses: state.campaignStatuses,
    auditLog: state.auditLog ?? [],
    productCatalog: state.productCatalog ?? [],
    productOverrides: state.productOverrides ?? {},
    orderStatuses: state.orderStatuses ?? {},
  }
}

export function writeDemoAdminState(state) {
  window.localStorage.setItem(adminStateKey, JSON.stringify(state))
}
