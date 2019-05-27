var app = require('../app'),

    Twitter = require('../models/twitter');

app.get('/twitter/', function(req, res) {
  Twitter.monthActvity(0, function(error, data) {
    if (!error) {
      res.status(200).json(data);
    }
  });
});

app.get('/twitter/setup', function(req, res) {
  if (process.env.SETUP_ENABLED != 'true') {
    res.status(404).send('Not found');
    return;
  }

  Twitter.setup(function(error, data) {
    res.status(200).send(error ? 'Setup failed see logs': 'Setup done!');
  });
});

app.get('/twitter/user', function(req, res) {
  Twitter.user(function(error, data) {
    res.status(200).json(data);
  });
});
app.param('page', function (req, res, next) {
  next()
})

app.get('/twitter/:page', function(req, res) {
  var page = parseInt(req.params.page);
  if (!page)
    page = 0;

  Twitter.monthActvity(page, function(error, data) {
    if (!error) {
      res.status(200).json(data);
    }
  });
});

module.exports = app;
