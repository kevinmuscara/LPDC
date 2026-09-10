// env vars
require('dotenv').config()
const PORT = process.env.PORT || 3000
const HOST = process.env.HOST || "0.0.0.0"

// imports
const layouts = require('express-ejs-layouts')
const express = require('express')
const session = require('express-session')
const passport = require('./config/passport.js');
const server  = express()

// plugins
server.use(express.urlencoded({ extended: true }))
server.use(express.json())
server.use(express.static('public'))
server.use(layouts)
server.use(session({
  secret: process.env.SESSION_SECRET || 'default_secret',
  resave: false,
  saveUninitialized: true
}));
server.use(passport.initialize());
server.use(passport.session());

// server config
server.set('layout', '_layout.ejs')
server.set('view engine', 'ejs')
server.set('trust proxy', 1)

// routing
server.use('/', require('./routes/index.js'))
server.use('/auth', require('./routes/auth.js'))
server.use('/dashboard', require('./routes/dashboard.js'))
server.use('/teacher', require('./routes/teacher.js'));

server.listen(PORT, HOST, (err) => {
  if (err) {
    console.error('Error starting server:', err);
  } else {
    console.info(`Server live.`);
  }
});