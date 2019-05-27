var app = require('../app'),

    Github = require('../models/github');

var GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize',
    GITHUB_AUTH_REDIRECT_URL = 'http://localhost:3000/github/auth';

app.get('/github/', function(req, res) {
  Github.monthActvity(0, function(error, data) {
    if (!error) {
      res.status(200).json(data);
    }
  });
});

app.get('/github/setup', function(req, res) {
  if (process.env.SETUP_ENABLED != 'true') {
    res.status(404).send('Not found');
    return;
  }

  Github.setup(function(error, data) {
    res.status(200).send(error ? 'Setup failed see logs': 'Setup done!');
  });
});

app.get('/github/auth', function(req, res) {
  if (process.env.GITHUB_OAUTH_ENABLED != 'true') {
    res.status(404).send('Not found');
    return;
  }

  var code = req.query.code;
  if (code) {
    Github.getToken(code, function(response) {
      res.status(200).json(response);
    });
  } else {
    var url = GITHUB_AUTH_URL + '?client_id=' + process.env.GITHUB_CLIENT_ID +
        '&redirect_uri=' + GITHUB_AUTH_REDIRECT_URL + '&response_type=code';
    res.redirect(url);
  }
});

app.get('/github/user', function(req, res) {
  Github.user(function(error, data) {
    if (!error) {
      res.status(200).json(data);
    }
  });
});

app.get('/github/repos', function(req, res) {
  Github.repos(function(error, data) {
    if (!error) {
      res.status(200).json(data);
    }
  });
});

app.get('/github/activity', function(req, res) {
  Github.recentActivity(function(error, data) {
    if (!error) {
      res.status(200).json(data);
    }
  });
});


module.exports = app;
