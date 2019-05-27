var app = require('../app'),
    Foursquare = require('../models/foursquare');

var FOURSQUARE_AUTH_URL = 'https://foursquare.com/oauth2/authorize',
    FOURSQUARE_AUTH_REDIRECT_URL = 'http://localhost:3000/foursquare/auth';

app.get('/foursquare/', function(req, res) {
  Foursquare.monthActvity(0, function(error, data) {
    if (!error) {
      res.status(200).json(data);
    }
  });
});

app.get('/foursquare/setup', function(req, res) {
  if (process.env.SETUP_ENABLED != 'true') {
    res.status(404).send('Not found');
    return;
  }

  Foursquare.setup(function(error, data) {
    res.status(200).send(error ? 'Setup failed see logs': 'Setup done!');
  });
});

app.get('/foursquare/auth', function(req, res) {
  if (process.env.FOURSQUARE_OAUTH_ENABLED != 'true') {
    res.status(404).send('Not found');
    return;
  }

  var code = req.query.code;
  if (code) {
    Foursquare.getToken(code, function(response) {
      res.status(200).json(response);
    });
  } else {
    var url = FOURSQUARE_AUTH_URL + '?client_id=' + process.env.FOURSQUARE_CLIENT_ID +
        '&redirect_uri=' + FOURSQUARE_AUTH_REDIRECT_URL +
        '&response_type=code';
    res.redirect(url);
  }
});

app.get('/foursquare/user', function(req, res) {
  Foursquare.user(function(error, data) {
    if (!error) {
      res.status(200).json(data);
    }
  });
});

app.param('page', function (req, res, next) {
  next()
})

app.get('/foursquare/:page', function(req, res) {
  var page = parseInt(req.params.page);
  if (!page)
    page = 0;

  Foursquare.monthActvity(page, function(error, data) {
    if (!error) {
      res.status(200).json(data);
    }
  });
});

module.exports = app;
