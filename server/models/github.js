var request = require('request'),
     moment = require('moment'),
         db = require('../db'),
      dates = require('../utils/dates'),
   markdown = require( "markdown" ).markdown,
      cache = require('memory-cache');

var GITHUB_API_URL = 'https://api.github.com/';
var lastUpdated;

exports.monthActvity = function(page, cb) {
  if (process.env.GITHUB_INTEGRATION_DISABLED == 'true') {
    cb(null, []);
    return;
  }

  dates.monthRange(page, function(start, end) {
    var cacheKey = 'github-' + moment(start).format('YYYY-MM-DD');
    if (page == 0) {
      //if it's the first month check if data needs to be updated
      exports.update(function(updated) {
        var cachedData = cache.get(cacheKey);
        if (!updated && cachedData) {
          console.log('Github page', page ,'used cache:', cachedData.length);
          cb(null, cachedData);
        } else {
          db.collection('githubdb').find({
            'date': { $gte: start, $lte: end }
          }).sort({'date': -1}).toArray(function (err, posts) {
            console.log('Github page', page, 'used db:', posts.length);
            if (!err && posts.length) {
              var groupedCommits =_groupCommits(posts);
              cache.put(cacheKey, groupedCommits);
              cb(err, groupedCommits);
            } else {
              cb(err, posts);
            }
          });
        }
      });
    } else {
      var cachedData = cache.get(cacheKey);
      if (cachedData) {
        console.log('Github page', page ,'used cache:', cachedData.length);
        cb(null, cachedData);
      } else {
        db.collection('githubdb').find({
          'date': { $gte: start, $lte: end }
        }).sort({'date': -1}).toArray(function (err, posts) {
          console.log('Github page', page, 'used db:', posts.length);
          if (!err && posts.length) {
            var groupedCommits =_groupCommits(posts);
            cache.put(cacheKey, groupedCommits);
            cb(err, groupedCommits);
          } else {
            cb(err, posts);
          }
        });
      }
    }
  });
};

function _groupCommits(posts) {
  var groups = {};

  for (var i=0; i<posts.length; i++) {
    var post = posts[i];
    var day = moment(post.date).format('YYYY-MM-DD');
    if (groups[day]) {
      var group = groups[day];
      if (group[post.repo_id]) {
        group[post.repo_id].commits += post.commits;
      } else {
        group[post.repo_id] = post;
      }
    } else {
      var group = {};
      group[post.repo_id] = post;
      groups[day] = group;
    }
  }

  var grouped = [];

  for (k in groups) {
    var group = groups[k];
    for (kk in group) {
      var post = group[kk];
      grouped.push(post);
    }
  }

  return grouped;
}

exports.update = function(cb) {
  db.lastUpdatedDate(lastUpdated, 'github', function(date) {
    var needUpdate = true;
    if (date) {
      var minutes = moment().diff(date, 'minutes');
      if (minutes < process.env.GITHUB_UPDATE_FREQ_MINUTES) {
        console.log('Github next update in', process.env.GITHUB_UPDATE_FREQ_MINUTES - minutes, 'minutes');
        needUpdate = false;
      }
    }

    if (needUpdate) {
      exports.fetch(1, function(err, posts) {
        console.log('Github needed update and fetched:', posts.length);
        if (!err && posts && posts.length > 0) {
          var bulk = db.collection('githubdb').initializeUnorderedBulkOp();
          for (var i=0; i<posts.length; i++) {
            var post = posts[i];
            bulk.find({'id': post.id}).upsert().updateOne(post);
          }
          bulk.execute(function(err, result) {
            if (err) {
              console.log('Github Bulk Error', err);
            }
            db.setLastUpdatedDate('github', function(err) {
              if (!err) {
                lastUpdated = new Date();
                cb(true);
              } else {
                cb(false);
              }
            });
          });
        } else if (!err) {
          db.setLastUpdatedDate('github', function(err) {
            if (!err) {
              lastUpdated = new Date();
            }
            cb(false);
          });
        } else {
          cb(false);
        }
      });
    } else {
      cb(false);
    }
  });
};

exports.setup = function(cb) {
  if (process.env.GITHUB_INTEGRATION_DISABLED == 'true') {
    cb(null, []);
    return;
  }

  //Gets most of the users github events and saves to the db...
  var page = 1;

  function _fetchAndSave(fetchCallback) {
    exports.fetch(page, function(err, posts) {
      console.log('Github setup, page:', page, 'received:', posts.length);
      if (!err && posts && posts.length > 0) {
        var bulk = db.collection('githubdb').initializeUnorderedBulkOp();
        for (var i=0; i<posts.length; i++) {
          var post = posts[i];
          bulk.find({'id': post.id}).upsert().updateOne(post);
        }
        bulk.execute(function(err, result) {
          page++;
          if (page > 10) {
            fetchCallback();
          } else {
            _fetchAndSave(fetchCallback);
          }
        });
      } else {
        fetchCallback();
      }
    });
  }

  _fetchAndSave(function() {
    db.setLastUpdatedDate('github', function(err) {
      if (!err) {
        lastUpdated = new Date();
      }
      exports.monthActvity(0, cb);
    });
  });
};

exports.fetch = function(page, cb) {
  var url = GITHUB_API_URL + 'users/'+
            process.env.GITHUB_USERNAME + '/events?access_token=' +
            process.env.GITHUB_ACCESS_TOKEN;

  if (page) {
    url += '&page=' + page;
  }

  request({
      'url': url,
      'headers': {
        'User-Agent': 'Syte'
      }
    }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      body = JSON.parse(body);

      var posts = [];
      for (var i = 0; i < body.length; i++) {
        var post = body[i];
        if (post.type && post.type == 'PushEvent') {
          var createdDate = moment(post.created_at);
          var cleanedPost = {
            'id': post.id,
            'date': createdDate.toISOString(),
            'type': 'github'
          };

          if (post.repo) {
            cleanedPost.repo_id = post.repo.id;
            if (post.public) {
              cleanedPost.repo = post.repo.name;
              cleanedPost.repo_url = 'https://github.com/' + post.repo.name;
            }
          }

          if (post.payload && post.payload.commits) {
            cleanedPost.commits = post.payload.commits.length;
          }

          posts.push(cleanedPost);
        }
      }

      cb(null, posts);
    } else {
      cb(error, []);
    }
  });
};


var lastUpdatedUser;

exports.user = function(cb) {
  var needUpdate = true;
  if (lastUpdatedUser) {
    var minutes = moment().diff(lastUpdatedUser, 'minutes');
    if (minutes < process.env.GITHUB_UPDATE_FREQ_MINUTES) {
      needUpdate = false;
    }
  }

  var cachedUser = cache.get('github-user');
  if (!needUpdate && cachedUser) {
    cb(null, cachedUser);
    return;
  }

  var url = GITHUB_API_URL + 'users/'+
            process.env.GITHUB_USERNAME + '?access_token=' +
            process.env.GITHUB_ACCESS_TOKEN;

  request({
      'url': url,
      'headers': {
        'User-Agent': 'Syte'
      }
    }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      body = JSON.parse(body);

      var githubUser = {
        'id': body.id,
        'name': body.name,
        'username': body.login,
        'picture': body.avatar_url,
        'url': body.html_url,
        'repos': body.public_repos || 0,
        'followers': body.followers || 0,
        'following': body.following || 0
      };

      cache.put('github-user', githubUser);
      lastUpdatedUser = new Date();
      cb(null, githubUser);
    } else {
      cb(error, null);
    }
  });
};


var lastUpdatedRepos;

exports.repos = function(cb) {
  var needUpdate = true;
  if (lastUpdatedRepos) {
    var minutes = moment().diff(lastUpdatedRepos, 'minutes');
    if (minutes < process.env.GITHUB_UPDATE_FREQ_MINUTES) {
      needUpdate = false;
    }
  }

  var cachedRepos = cache.get('github-repos');
  if (!needUpdate && cachedRepos) {
    cb(null, cachedRepos);
    return;
  }

  var url = GITHUB_API_URL + 'users/'+
            process.env.GITHUB_USERNAME + '/repos?access_token=' +
            process.env.GITHUB_ACCESS_TOKEN + '&sort=updated';

  request({
      'url': url,
      'headers': {
        'User-Agent': 'Syte'
      }
    }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      body = JSON.parse(body);

      var githubRepos = [];
      for (var i=0; i<body.length; i++) {
        var repo = body[i];
        if (!repo.private) {
          githubRepos.push({
            'id': repo.id,
            'name': repo.name,
            'url': repo.html_url,
            'updated': repo.updated_at,
            'description': repo.description,
            'fork': repo.fork,
            'language': repo.language,
            'forks': repo.forks_count,
            'favorites': repo.watchers_count
          });
        }
      }

      cache.put('github-repos', githubRepos);
      lastUpdatedRepos = new Date();

      cb(null, githubRepos);
    } else {
      cb(error, null);
    }
  });
};

var lastUpdatedActivity;
//Todo consider saving this to db and implement paging...

exports.recentActivity = function(cb) {
  var needUpdate = true;
  if (lastUpdatedActivity) {
    var minutes = moment().diff(lastUpdatedActivity, 'minutes');
    if (minutes < process.env.GITHUB_UPDATE_FREQ_MINUTES) {
      needUpdate = false;
    }
  }

  var cachedActivity = cache.get('github-activity');
  if (!needUpdate && cachedActivity) {
    cb(null, cachedActivity);
    return;
  }

  var url = GITHUB_API_URL + 'users/'+
            process.env.GITHUB_USERNAME + '/events/public?access_token=' +
            process.env.GITHUB_ACCESS_TOKEN;

  request({
      'url': url,
      'headers': {
        'User-Agent': 'Syte'
      }
    }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      body = JSON.parse(body);

      var githubActivity = [];
      for (var i=0; i<body.length; i++) {
        var activity = _parseActivity(body[i]);
        if (activity) {
          githubActivity.push(activity);
        }
      }

      cache.put('github-activity', githubActivity);
      lastUpdatedActivity = new Date();
      cb(null, githubActivity);
    } else {
      cb(error, null);
    }
  });
};

function _parseActivity(activity) {
  var createdDate = moment(activity.created_at);

  if (activity.type == 'CreateEvent') {
    var newActivity = {
      'id': activity.id,
      'date': createdDate.toISOString()
    };

    if (activity.payload.ref_type == 'branch') {
      newActivity.icon = 'git-branch';
      newActivity.description = 'Created a branch ';
    } else if (activity.payload.ref_type == 'repository') {
      newActivity.icon = 'git-repo';
      newActivity.description = 'Created a repository ';
    } else if (activity.payload.ref_type == 'tag') {
      newActivity.icon = 'git-tag';
      newActivity.description = 'Created tag ';
    }

    if (newActivity.icon && newActivity.description) {
      if (activity.payload.ref) {
        if (activity.payload.ref_type != 'tag') {
          newActivity.description += 'called ';
        }
        newActivity.description += '<strong>' + activity.payload.ref + '</strong> ';
      }

      if (activity.repo) {
        newActivity.description += 'at <a href="' + activity.repo.url + '" target="_blank">' + activity.repo.name + '</a>';
      }

      return newActivity;
    }
  } else if (activity.type == 'ForkEvent') {
    var newActivity = {
      'id': activity.id,
      'icon': 'git-branch',
      'description': 'Forked ',
      'date': createdDate.toISOString()
    };

    if (activity.repo) {
      newActivity.description += '<a href="https://github.com/' + activity.repo.name + '" target="_blank">' + activity.repo.name + '</a> ';
    }

    if (activity.payload && activity.payload.forkee) {
      newActivity.description += 'to <a href="' + activity.payload.forkee.html_url + '" target="_blank">' + activity.payload.forkee.full_name + '</a>';
    }

    return newActivity;
  } else if (activity.type == 'IssuesEvent') {
    var newActivity = {
      'id': activity.id,
      'date': createdDate.toISOString()
    };

    if (activity.payload.action == 'opened') {
      newActivity.icon = 'git-issue';
      newActivity.description = 'Opened issue ';
    } else if (activity.payload.action == 'closed') {
      newActivity.icon = 'git-issue-closed';
      newActivity.description = 'Closed issue ';
    } else if (activity.payload.action == 'reopened') {
      newActivity.icon = 'git-issue-reopen';
      newActivity.description = 'Reopened issue ';
    }

    if (newActivity.description) {
      newActivity.description += '<a href="' + activity.payload.issue.html_url + '" target="_blank">';

      if (activity.repo) {
        newActivity.description += activity.repo.name;
      }

      newActivity.description += '#' + activity.payload.issue.number + '</a>';

      if (activity.payload.issue.title) {
        newActivity.comment = activity.payload.issue.title;
      }

      return newActivity;
    }
  } else if (activity.type == 'IssueCommentEvent') {
    if (activity.payload.action == 'created') {
      var newActivity = {
        'id': activity.id,
        'icon': 'comment',
        'date': createdDate.toISOString(),
        'description': 'Commented on issue '
      };

      newActivity.description += '<a href="' + activity.payload.issue.html_url + '" target="_blank">';

      if (activity.repo) {
        newActivity.description += activity.repo.name;
      }

      newActivity.description += '#' + activity.payload.issue.number + '</a>';

      if (activity.payload.comment) {
        newActivity.comment = markdown.toHTML(activity.payload.comment.body.substring(0, 100) + '...');
      }

      return newActivity;
    }
  } else if (activity.type == 'PullRequestEvent') {
    var newActivity = {
      'id': activity.id,
      'date': createdDate.toISOString()
    };

    if (activity.payload.action == 'opened') {
      newActivity.icon = 'git-pull';
      newActivity.description = 'Opened a pull request ';
    } else if (activity.payload.action == 'closed') {
      newActivity.icon = 'git-pull';
      newActivity.description = 'Closed pull request ';
      if (activity.payload.pull_request.merged) {
        newActivity.icon = 'git-merge';
        newActivity.description = 'Merged pull request ';
      }
    }

    if (newActivity.description) {
      newActivity.description += '<a href="' + activity.payload.pull_request.html_url + '" target="_blank">';

      if (activity.repo) {
        newActivity.description += activity.repo.name;
      }

      newActivity.description += '#' + activity.payload.pull_request.number + '</a>';

      newActivity.comment = activity.payload.pull_request.title;

      return newActivity;
    }
  } else if (activity.type == 'PullRequestReviewCommentEvent') {
    if (activity.payload.action == 'created') {
      var newActivity = {
        'id': activity.id,
        'icon': 'comment',
        'date': createdDate.toISOString(),
        'description': 'Commented on pull request '
      };

      newActivity.description += '<a href="' + activity.payload.pull_request.html_url + '" target="_blank">';

      if (activity.repo) {
        newActivity.description += activity.repo.name;
      }

      newActivity.description += '#' + activity.payload.pull_request.number + '</a>';

      if (activity.payload.comment) {
        //newActivity.comment = activity.payload.comment.substring(0, 100);
        newActivity.comment = markdown.toHTML(activity.payload.comment);
      }

      return newActivity;
    }
  } else if (activity.type == 'PushEvent') {
    var newActivity = {
      'id': activity.id,
      'icon': 'git-commit',
      'date': createdDate.toISOString(),
      'description': 'Pushed '
    };

    if (activity.payload.size) {
      newActivity.description += activity.payload.size + (activity.payload.size == 1 ? ' commit ' : ' commits ');
    }

    if (activity.payload.ref) {
      newActivity.description += 'to <strong>' + activity.payload.ref.replace(/refs\/heads\//g, '') + '</strong> ';
    }

    if (activity.repo) {
      newActivity.description += 'at <a href="https://github.com/' + activity.repo.name + '" target="_blank">' + activity.repo.name + '</a> ';
    }

    return newActivity;
  } else if (activity.type == 'RepositoryEvent') {
    if (activity.payload.action == 'created') {
      var newActivity = {
        'id': activity.id,
        'icon': 'git-repo',
        'date': createdDate.toISOString(),
        'description': 'Create a new repository '
      };

      if (activity.payload.repository) {
        newActivity.description += 'at <a href="' + activity.payload.repository.html_url + '" target="_blank">' + activity.payload.repository.full_name + '</a> ';
      }

      return newActivity;
    }
  } else if (activity.type == 'WatchEvent') {
    var newActivity = {
      'id': activity.id,
      'icon': 'star',
      'date': createdDate.toISOString(),
      'description': 'Starred '
    };

    if (activity.repo) {
      newActivity.description += '<a href="' + activity.repo.url + '" target="_blank">' + activity.repo.name + '</a> ';
    }

    return newActivity;
  } else if (activity.type == 'ReleaseEvent') {
    var newActivity = {
      'id': activity.id,
      'icon': 'git-tag',
      'date': createdDate.toISOString(),
      'description': 'Released '
    };

    if (activity.payload.release) {
      newActivity.description += '<a href="' + activity.payload.release.html_url + '" target="_blank">' + activity.payload.release.tag_name + '</a> ';
    }

    if (activity.payload.repository) {
      newActivity.description += 'at <a href="' + activity.payload.repository.html_url + '" target="_blank">' + activity.payload.repository.full_name + '</a> ';
    }

    return newActivity;
  }

  return null;
}

var GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token',
    GITHUB_AUTH_REDIRECT_URL = 'http://localhost:3000/github/auth';

exports.getToken = function(code, cb) {
  request({
    'url': GITHUB_TOKEN_URL,
    'method': 'POST',
    'json': {
      'code': code,
      'client_id': process.env.GITHUB_CLIENT_ID,
      'client_secret': process.env.GITHUB_CLIENT_SECRET,
      'redirect_uri': GITHUB_AUTH_REDIRECT_URL
    }
  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      cb(body);
    } else {
      cb(body);
    }
  });
};
