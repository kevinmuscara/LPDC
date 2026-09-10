const express = require('express')
const router  = express.Router()
const { loadSpreadsheetRows, ensureReviewStatusColumn, ensureApproverColumn, ensureDenialReasonColumn, updateReviewStatus, getReviewStatusColumnName, getApproverColumnName, getDenialReasonColumnName } = require('../data/data')

const normalizeHours = (value) => {
  if (value === null || value === undefined || value === '') {
    return 0
  }

  const parsed = Number(String(value).replace(/,/g, '').trim())

  return Number.isFinite(parsed) ? parsed : 0
}

const normalizeReviewStatus = (value) => {
  const normalized = String(value || '').trim().toLowerCase()

  if (!normalized) {
    return 'pending'
  }

  if (['approved', 'approve', 'accepted', 'verified'].includes(normalized)) {
    return 'approved'
  }

  if (['denied', 'deny', 'declined', 'rejected'].includes(normalized)) {
    return 'denied'
  }

  if (['pending', 'unreviewed', 'new', 'submitted', 'not reviewed'].includes(normalized)) {
    return 'pending'
  }

  return normalized
}

const normalizeLicensureName = (value) => String(value || '').trim()

const normalizeTab = (value) => {
  const normalized = String(value || '').trim().toLowerCase()

  if (['approved', 'pending', 'denied'].includes(normalized)) {
    return normalized
  }

  return 'approved'
}

const ACTIVE_VIEWER_TTL_MS = 30000
const activeTeacherReviewers = new Map()

const getViewerDisplayName = (user = {}) => {
  const email = String(user.emails?.[0]?.value || user.email || '').trim()

  return String(user.displayName || user.name || email || 'Another user').trim()
}

const pruneInactiveReviewers = () => {
  const now = Date.now()

  for (const [staffId, viewersBySession] of activeTeacherReviewers.entries()) {
    for (const [sessionId, viewer] of viewersBySession.entries()) {
      if (now - viewer.lastSeen > ACTIVE_VIEWER_TTL_MS) {
        viewersBySession.delete(sessionId)
      }
    }

    if (viewersBySession.size === 0) {
      activeTeacherReviewers.delete(staffId)
    }
  }
}

const getTeacherReviewers = (staffId, currentSessionId) => {
  pruneInactiveReviewers()

  const viewersBySession = activeTeacherReviewers.get(staffId) || new Map()

  return Array.from(viewersBySession.values())
    .filter((viewer) => viewer.sessionId !== currentSessionId)
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
}

const registerTeacherViewer = (request, staffId) => {
  const user = request.session.user || {}
  const sessionId = request.session.id || 'anonymous'

  if (!staffId) {
    return []
  }

  const viewersBySession = activeTeacherReviewers.get(staffId) || new Map()
  const viewer = {
    sessionId,
    email: String(user.emails?.[0]?.value || user.email || '').trim(),
    displayName: getViewerDisplayName(user),
    lastSeen: Date.now()
  }

  viewersBySession.set(sessionId, viewer)
  activeTeacherReviewers.set(staffId, viewersBySession)

  return getTeacherReviewers(staffId, sessionId)
}

const buildTeacherDashboardData = async (accessToken, staffId, requestedLicensureName = '') => {
  const rows = await loadSpreadsheetRows(accessToken)
  const teacherRows = rows.filter((row) => String(row['Staff ID#'] || '').trim() === staffId)

  if (!teacherRows.length) {
    throw new Error(`No teacher found with Staff ID ${staffId}.`)
  }

  const licensureOptions = Array.from(
    new Set(
      teacherRows
        .map((row) => normalizeLicensureName(row['Licensure Name']))
        .filter(Boolean)
    )
  )

  const selectedLicensureName =
    licensureOptions.includes(normalizeLicensureName(requestedLicensureName))
      ? normalizeLicensureName(requestedLicensureName)
      : licensureOptions[0] || ''

  const uniqueBuildings = Array.from(
    new Set(
      teacherRows
        .map((row) => String(row['Building'] || '').trim())
        .filter(Boolean)
    )
  )

  const teacher = {
    firstName: teacherRows[0]['First Name'] || '',
    lastName: teacherRows[0]['Last Name'] || '',
    building: uniqueBuildings.join(', '),
    staffId,
    licensureName: teacherRows[0]['Licensure Name'] || '',
    licensureType: selectedLicensureName || teacherRows[0]['Licensure Name'] || '',
    licensureStartDate: teacherRows[0]['Licensure Start Date'] || '',
    licensureEndDate: teacherRows[0]['Licensure End Date'] || '',
    licensureOptions,
    emailAddress: teacherRows[0]['Email Address'] || '',
    teacherName: [teacherRows[0]['First Name'], teacherRows[0]['Last Name']]
      .filter(Boolean)
      .join(' ')
  }

  const reviewStatusColumnName = getReviewStatusColumnName()
  const approverColumnName = getApproverColumnName()
  const denialReasonColumnName = getDenialReasonColumnName()
  const events = teacherRows
    .filter((row) => row['Professional Development Event Name'] || row['Professional Development Event Date'] || row['Professional Development Total Hours'])
    .map((row) => ({
      __sheetRowNumber: row.__sheetRowNumber,
      timestamp: row['Timestamp'] || '',
      licensureName: normalizeLicensureName(row['Licensure Name']),
      licensureStartDate: row['Licensure Start Date'] || '',
      licensureEndDate: row['Licensure End Date'] || '',
      pdEventName: row['Professional Development Event Name'] || '',
      pdEventDate: row['Professional Development Event Date'] || '',
      pdEventTotalHours: row['Professional Development Total Hours'] || '',
      evidenceUrl: row['Professional Development Evidence URL'].split(',') || '',
      approver: row[approverColumnName] || '',
      denialReason: row[denialReasonColumnName] || '',
      reviewStatus: normalizeReviewStatus(row[reviewStatusColumnName])
    }))

  const filteredEvents = !selectedLicensureName
    ? events
    : events.filter((event) => normalizeLicensureName(event.licensureName) === normalizeLicensureName(selectedLicensureName))

  const approvedEvents = filteredEvents.filter((event) => event.reviewStatus === 'approved')
  const pendingEvents = filteredEvents.filter((event) => event.reviewStatus === 'pending')
  const deniedEvents = filteredEvents.filter((event) => event.reviewStatus === 'denied')

  const totalPdHours = approvedEvents.reduce(
    (sum, event) => sum + normalizeHours(event.pdEventTotalHours),
    0
  )

  const pendingReviewHours = pendingEvents.reduce(
    (sum, event) => sum + normalizeHours(event.pdEventTotalHours),
    0
  )

  return {
    teacher,
    approvedEvents,
    pendingEvents,
    deniedEvents,
    totalPdHours,
    pendingReviewHours,
    reviewStatusColumnName
  }
}

router.get('/', async (request, response) => {
  if (!request.session.user) {
    return response.redirect('/auth/google');
  }

  const staffId = String(request.query.id || '').trim()

  if (!staffId) {
    return response.status(400).send('Staff ID query parameter is required.')
  }

  try {
    const dashboardData = await buildTeacherDashboardData(
      request.session.user.accessToken,
      staffId,
      String(request.query.licensure || '')
    )

    response.render('teacher.ejs', {
      view: "",
      user: request.session.user,
      otherReviewers: registerTeacherViewer(request, staffId),
      tab: normalizeTab(request.query.tab),
      ...dashboardData
    })
  } catch (error) {
    console.error('Teacher data load failed:', error)
    return response.status(500).send(error.message || 'Unable to load teacher spreadsheet data.')
  }
})

router.get('/viewers', async (request, response) => {
  if (!request.session.user) {
    return response.redirect('/auth/google');
  }

  const staffId = String(request.query.id || '').trim()

  if (!staffId) {
    return response.status(400).json({ error: 'Staff ID query parameter is required.' })
  }

  try {
    return response.json({
      staffId,
      otherViewers: registerTeacherViewer(request, staffId)
    })
  } catch (error) {
    console.error('Teacher active viewer lookup failed:', error)
    return response.status(500).json({ error: error.message || 'Unable to load active reviewers.' })
  }
})

router.get('/print', async (request, response) => {
  if (!request.session.user) {
    return response.redirect('/auth/google');
  }

  const staffId = String(request.query.id || '').trim()

  if (!staffId) {
    return response.status(400).send('Staff ID query parameter is required.')
  }

  try {
    const dashboardData = await buildTeacherDashboardData(
      request.session.user.accessToken,
      staffId,
      String(request.query.licensure || '')
    )

    response.render('teacher-print.ejs', {
      user: request.session.user,
      ...dashboardData,
      generatedAt: new Date().toLocaleString()
    })
  } catch (error) {
    console.error('Teacher printable report load failed:', error)
    return response.status(500).send(error.message || 'Unable to load printable teacher report.')
  }
})

router.post('/:staffId/review', async (request, response) => {
  if (!request.session.user) {
    return response.redirect('/auth/google');
  }

  const { staffId } = request.params
  const action = String(request.body.action || '').trim().toLowerCase()
  const rowNumber = Number(request.body.rowNumber)
  const denialReason = String(request.body.denialReason || '').trim()
  const requestedLicensure = normalizeLicensureName(request.body.licensure)
  const requestedTab = normalizeTab(request.body.tab)

  if (!staffId || !Number.isInteger(rowNumber)) {
    return response.status(400).send('A valid staff ID and event row number are required.')
  }

  if (!['approved', 'denied', 'pending'].includes(action)) {
    return response.status(400).send('The requested event action is invalid.')
  }

  if (action === 'denied' && !denialReason) {
    return response.status(400).send('A denial reason is required when denying a PD event.')
  }

  try {
    const rows = await loadSpreadsheetRows(request.session.user.accessToken)
    const targetRow = rows.find((row) => {
      return Number(row.__sheetRowNumber) === rowNumber && String(row['Staff ID#'] || '').trim() === staffId
    })

    if (!targetRow) {
      return response.status(404).send(`Could not find event row ${rowNumber} for staff ID ${staffId}.`)
    }

    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID
    const range = process.env.GOOGLE_SHEET_RANGE || 'Sheet1'
    const approverEmail = request.session.user.emails?.[0]?.value || request.session.user.email || ''

    await ensureReviewStatusColumn(request.session.user.accessToken, spreadsheetId, range)
    await ensureApproverColumn(request.session.user.accessToken, spreadsheetId, range)
    await ensureDenialReasonColumn(request.session.user.accessToken, spreadsheetId, range)
    await updateReviewStatus({
      accessToken: request.session.user.accessToken,
      spreadsheetId,
      range,
      rowNumber,
      status: action,
      approverEmail,
      denialReason: action === 'denied' ? denialReason : '',
    })

    const redirectUrl = `/teacher?id=${encodeURIComponent(staffId)}${requestedLicensure ? `&licensure=${encodeURIComponent(requestedLicensure)}` : ''}&tab=${encodeURIComponent(requestedTab)}`

    response.redirect(redirectUrl)
  } catch (error) {
    console.error('Review action failed:', error)
    return response.status(500).send(error.message || 'Unable to update event review status.')
  }
})

module.exports = router;