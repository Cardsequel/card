const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const mongoose = require('mongoose');
const path = require('path');
const passport = require('passport');
const flash = require('connect-flash');
const session = require('express-session');
const { ensureAuthenticated } = require('./config/auth');

const app = express();
app.use(express.static(path.join(__dirname, 'assets')));
// Passport Config
require('./config/passport')(passport);


// DB Config
const db = require('./config/keys').mongoURI;

// Connect to MongoDB
mongoose
  .connect(
    db,
    { useNewUrlParser: true }
  )
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.log(err));

// EJS
app.use(expressLayouts);
app.set('view engine', 'ejs');

// Express body parser
app.use(express.urlencoded({ extended: true }));

// Express session
app.use(
  session({
    secret: 'secret',
    resave: true,
    saveUninitialized: true
  })
);

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Connect flash
app.use(flash());

// Global variables
app.use(function(req, res, next) {
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.error = req.flash('error');
  next();
});

// Routes
app.use('/', require('./routes/index.js'));
app.use('/users', require('./routes/users.js'));

app.use((req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(404).render('notfound-page', { layout: false });
  }

  return ensureAuthenticated(req, res, () =>
    res.status(404).render('notfound-auth', { user: req.user, layout: false })
  );
});

app.use((err, req, res, next) => {
  console.error('Request failed:', err);

  if (res.headersSent) {
    return next(err);
  }

  const statusCode = Number.isInteger(err.status) && err.status >= 400 && err.status < 600
    ? err.status
    : 500;

  if (req.accepts('html')) {
    return res.status(statusCode).render('server-error', {
      layout: false,
      returnUrl: req.isAuthenticated() ? '/dashboard' : '/'
    });
  }

  return res.status(statusCode).json({
    error: statusCode >= 500 ? 'Internal Server Error' : 'Request failed'
  });
});



const PORT = process.env.PORT || 4000;

app.listen(PORT, console.log(`Server started on port ${PORT}`));
