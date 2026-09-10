const express = require('express')
const router  = express.Router()
const { getUniqueUsers, loadSpreadsheetRows, getReviewStatusColumnName } = require('../data/data')

const formatHeaderLabel = (key) => {
  let label = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim()

  label = label.replace(/\bId\b/g, 'ID')

  return label.charAt(0).toUpperCase() + label.slice(1)
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

router.get('/', async (request, response) => {
  if (!request.session.user) {
    return response.redirect('/auth');
  }

  try {
    const view = request.query.view || 'staff'
    const rows = await loadSpreadsheetRows(request.session.user.accessToken)
    const users = getUniqueUsers(rows)
    const reviewStatusColumnName = getReviewStatusColumnName()

    const pendingReviewStaffIds = new Set(
      rows
        .filter((row) => {
          const hasEventData = row['Professional Development Event Name'] || row['Professional Development Event Date'] || row['Professional Development Total Hours']

          return hasEventData && normalizeReviewStatus(row[reviewStatusColumnName]) === 'pending'
        })
        .map((row) => String(row['Staff ID#'] || '').trim())
        .filter(Boolean)
    )

    const pendingReviewUsers = users.filter((user) => pendingReviewStaffIds.has(user.staffId))
    const headers = users.length
      ? Object.keys(users[0]).map((key) => ({
          key,
          label: formatHeaderLabel(key)
        }))
      : []

    response.render('dashboard.ejs', {
      user: request.session.user,
      users,
      pendingReviewUsers,
      headers,
      view
    });
  } catch (error) {
    console.error('Dashboard data load failed:', error)
    return response.status(500).send(error.message || 'Unable to load spreadsheet data.')
  }
});

module.exports = router;