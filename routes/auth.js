const express = require('express')
const router  = express.Router()

const passport = require('../config/passport');

router.get('/', (request, response) => {
  if(!request.session.user) {
    return response.redirect('/auth/google');
  }
  
  response.redirect('/dashboard');
});

router.get('/logout', (request, response) => {
  request.session.destroy();
  request.logout(() => response.redirect('/'));
});

router.get('/google', passport.authenticate('google', {
  scope: [
    "profile",
    "email",
    "https://www.googleapis.com/auth/spreadsheets"
  ],
  accessType: "offline",
  prompt: "consent"
}));

router.get('/google/callback', passport.authenticate('google', { failureRedirect: '/login' }), (req, res) => {
  req.session.user = req.user;
  req.session.save(() => res.redirect('/dashboard'));
});

module.exports = router;
