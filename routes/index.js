const express = require('express')
const router  = express.Router()

router.get('/', (_request, response) => response.redirect('/dashboard'));

module.exports = router;