var app = require('../app'),

  Instagram = require('../models/instagram');

var INSTAGRAM_AUTH_URL = 'https://api.instagram.com/oauth/authorize',
    INSTAGRAM_AUTH_REDIRECT_URL = 'http://localhost:3000/instagram/auth';

app.get('/instagram/', function(req, res) {
  Instagram.monthActvity(0, function(error, data) {
    if (!error) {
      res.status(200).json(data);
    }
  });
});

app.get('/instagram/recent', function(req, res) {
  Instagram.recentActivity(function(error, data) {
    if (!error) {
      res.status(200).json(data);
    }
  });
});

app.get('/instagram/setup', function(req, res) {
  if (process.env.SETUP_ENABLED != 'true') {
    res.status(404).send('Not found');
    return;
  }

  Instagram.setup(function(error, data) {
    res.status(200).send(error ? 'Setup failed see logs': 'Setup done!');
  });
});

app.get('/instagram/auth', function(req, res) {
  if (process.env.INSTAGRAM_OAUTH_ENABLED != 'true') {
    res.status(404).send('Not found');
    return;
  }

  var code = req.query.code;
  if (code) {
    Instagram.getToken(code, function(response) {
      res.status(200).json(response);
    });
  } else {
    var url = INSTAGRAM_AUTH_URL + '?client_id=' + process.env.INSTAGRAM_CLIENT_ID +
      '&redirect_uri=' + INSTAGRAM_AUTH_REDIRECT_URL + '&response_type=code';
    res.redirect(url);
  }
});

app.get('/instagram/user', function(req, res) {
  Instagram.user(function(error, data) {
    res.status(200).json(data);
  });
});

app.param('page', function (req, res, next) {
  next()
})

app.get('/instagram/:page', function(req, res) {
  var page = parseInt(req.params.page);
  if (!page)
    page = 0;

  Instagram.monthActvity(page, function(error, data) {
    if (!error) {
      res.status(200).json(data);
    }
  });
});

module.exports = app;
