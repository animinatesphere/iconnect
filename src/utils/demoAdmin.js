const adminSessionKey = 'iconnect.admin.demo.session'
const adminStateKey = 'iconnect.admin.demo.state'

export const defaultAdminSettings = {
  videoUploadsEnabled: true,
  campaignDraftsEnabled: true,
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
    (state.auditLog !== undefined && !Array.isArray(state.auditLog))
  ) {
    throw new Error('Saved demo admin data is invalid. Clear this browser’s iConnect admin demo data to continue.')
  }

  return {
    userStatuses: state.userStatuses,
    reviewedReportIds: state.reviewedReportIds,
    settings: { ...defaultAdminSettings, ...state.settings },
    campaignStatuses: state.campaignStatuses,
    auditLog: state.auditLog ?? [],
  }
}

export function writeDemoAdminState(state) {
  window.localStorage.setItem(adminStateKey, JSON.stringify(state))
}
