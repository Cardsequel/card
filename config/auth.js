const User = require('../models/User');

module.exports = {
  ensureAuthenticated: function(req, res, next) {
    if (req.isAuthenticated()) {
      return next();
    }
    req.flash('error_msg', 'Please log in to view dashboard');
    return res.redirect('/users/login');
  },
  ensureAdmin: function(req, res, next) {
    if (!req.isAuthenticated()) {
      req.flash('error_msg', 'Please log in to view the admin area');
      return res.redirect('/users/login');
    }

    User.findById(req.user.id)
      .select('category')
      .then(user => {
        if (!user) {
          req.logout();
          req.flash('error_msg', 'Your account could not be found. Please log in again.');
          return res.redirect('/users/login');
        }
        if (user.category !== 'admin') {
          return res.redirect('/dashboard');
        }
        return next();
      })
      .catch(next);
  },
  forwardAuthenticated: function(req, res, next) {
    if (!req.isAuthenticated()) {
      return next();
    }

    User.findById(req.user.id)
      .select('category')
      .then(user => {
        if (!user) {
          req.logout();
          req.flash('error_msg', 'Your account could not be found. Please log in again.');
          return res.redirect('/users/login');
        }
        return res.redirect(user.category === 'admin' ? '/admin-dashboard' : '/dashboard');
      })
      .catch(next);
  }
};
