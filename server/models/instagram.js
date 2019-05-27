var request = require('request'),
     moment = require('moment'),
         db = require('../db'),
      dates = require('../utils/dates'),
      cache = require('memory-cache');

var INSTAGRAM_API_URL = 'https://api.instagram.com/v1/';
var lastUpdated;

exports.monthActvity = function(page, cb) {
  if (process.env.INSTAGRAM_INTEGRATION_DISABLED == 'true') {
    cb(null, []);
    return;
  }

  dates.monthRange(page, function(start, end) {
    var cacheKey = 'instagram-' + moment(start).format('YYYY-MM-DD');
    if (page == 0) {
      //if it's the first month check if data needs to be updated
      exports.update(function(updated) {
        var cachedData = cache.get(cacheKey);
        if (!updated && cachedData) {
          console.log('Instagram page', page ,'used cache:', cachedData.length);
          cb(null, cachedData);
        } else {
          db.collection('instagramdb').find({
            'date': { $gte: start, $lte: end }
          }).sort({'date': -1}).toArray(function (err, posts) {
            console.log('Instagram page', page, 'used db:', posts.length);
            if (!err && posts.length) {
                cache.put(cacheKey, posts);
            }
            cb(err, posts);
          });
        }
      });
    } else {
      var cachedData = cache.get(cacheKey);
      if (cachedData) {
        console.log('Instagram page', page ,'used cache:', cachedData.length);
        cb(null, cachedData);
      } else {
        db.collection('instagramdb').find({
          'date': { $gte: start, $lte: end }
        }).sort({'date': -1}).toArray(function (err, posts) {
          console.log('Instagram page', page, 'used db:', posts.length);
          if (!err && posts.length) {
            cache.put(cacheKey, posts);
          }
          cb(err, posts);
        });
      }
    }
  });
};

exports.recentActivity = function(cb) {
  if (process.env.INSTAGRAM_INTEGRATION_DISABLED == 'true') {
    cb(null, []);
    return;
  }

  dates.lastYearRange(function(start, end) {
    var cacheKey = 'instagram-year-' + moment(start).format('YYYY-MM-DD');
  
    var cachedData = cache.get(cacheKey);
    if (cachedData) {
      console.log('Instagram recent activity, used cache:', cachedData.length);
      cb(null, cachedData);
    } else {
      db.collection('instagramdb').find({
        'date': { $gte: start, $lte: end }
      }).sort({'date': -1}).toArray(function (err, posts) {
        console.log('Instagram recent activity, used db:', posts.length);
        if (!err && posts.length) {
            cache.put(cacheKey, posts);
        }
        cb(err, posts);
      });
    }
  });
};

exports.update = function(cb) {
  db.lastUpdatedDate(lastUpdated, 'instagram', function(date) {
    var needUpdate = true;
    if (date) {
      var minutes = moment().diff(date, 'minutes');
      if (minutes < process.env.INSTAGRAM_UPDATE_FREQ_MINUTES) {
        console.log('Instagram next update in', process.env.INSTAGRAM_UPDATE_FREQ_MINUTES - minutes, 'minutes');
        needUpdate = false;
      }
    }

    if (needUpdate) {
      exports.fetch(10, null, function(err, posts) {
        console.log('Instagram needed update and fetched:', posts.length);
        if (!err && posts && posts.length > 0) {
          var bulk = db.collection('instagramdb').initializeUnorderedBulkOp();
          for (var i=0; i<posts.length; i++) {
            var post = posts[i];
            bulk.find({'id': post.id}).upsert().updateOne(post);
          }
          bulk.execute(function(err, result) {
            if (err) {
              console.log('Instagram Bulk error', err);
            }

            db.setLastUpdatedDate('instagram', function(err) {
              if (!err) {
                lastUpdated = new Date();
                cb(true);
              } else {
                cb(false);
              }
            });
          });
        } else if (!err) {
          db.setLastUpdatedDate('instagram', function(err) {
            if (!err) {
              lastUpdated = new Date();
            }
            cb(false);
          });
        } else {
          cb(false)
        }
      });
    } else {
      cb(false);
    }
  });
};

exports.setup = function(cb) {
  if (process.env.INSTAGRAM_INTEGRATION_DISABLED == 'true') {
    cb(null, []);
    return;
  }

  var max_id = null;
  var count = 0;

  function _fetchAndSave(fetchCallback) {
    exports.fetch(50, max_id, function(err, posts, next_max_id) {
      console.log('Instagram setup, page:', count, '.:', posts.length);
      if (!err && posts && posts.length > 0) {
        var bulk = db.collection('instagramdb').initializeUnorderedBulkOp();
        for (var i=0; i<posts.length; i++) {
          var post = posts[i];
          bulk.find({'id': post.id}).upsert().updateOne(post);
        }
        bulk.execute(function(err, result) {
          if (next_max_id) {
            max_id = next_max_id;
            count++;
            if (count > 5) {
              fetchCallback();
            } else {
              _fetchAndSave(fetchCallback);
            }
          }
          else {
            fetchCallback();
          }
        });
      } else {
        fetchCallback();
      }
    });
  }

  _fetchAndSave(function() {
    db.setLastUpdatedDate('instagram', function(err) {
      if (!err) {
        lastUpdated = new Date();
      }
      exports.monthActvity(0, cb);
    });
  });
};

exports.fetch = function(count, max_id, cb) {
  var url = INSTAGRAM_API_URL + 'users/self/media/recent/?count=' + count +
            '&access_token=' + process.env.INSTAGRAM_ACCESS_TOKEN;

  if (max_id) {
    url += '&max_id=' + max_id;
  }

  request(url, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      body = JSON.parse(body);
      var next_max_id = null;
      if (body.pagination && body.pagination.next_max_id) {
        next_max_id = body.pagination.next_max_id;
      }

      var posts = [];

      for (var i = 0; i < body.data.length; i++) {
        var post = body.data[i];
        var createdDate = moment(new Date(parseInt(post.created_time) * 1000));
        var cleanedPost = {
          'id': post.id,
          'date': createdDate.toISOString(),
          'type': 'instagram',
          'url': post.link,
          'video': post.videos && post.videos.standard_resolution ? post.videos.standard_resolution : null,
          'picture': post.images && post.images.thumbnail ? post.images.thumbnail.url : null,
          'pictureHD':  post.images && post.images.standard_resolution ? post.images.standard_resolution.url : null,
          'likes': post.likes && post.likes.count ? post.likes.count : 0,
          'comments': post.comments && post.comments.count ? post.comments.count : 0,
          'text': post.caption && post.caption.text ? linkifyText(post.caption.text) : null,
          'user': post.user || null
        };

        if (post.images && post.images.thumbnail) {
          cleanedPost.picture = post.images.thumbnail.url.replace(/s150x150/g, 's320x320');
        }

        posts.push(cleanedPost);
      }

      console.log('POSTS', posts)
      cb(null, posts, next_max_id);
    } else {
      cb(error, [], null);
    }
  });

  function linkifyText(text) {
    text = text.replace(/(https?:\/\/\S+)/gi, function (s) {
      return '<a href="' + s + '" target="_blank">' + s + '</a>';
    });

    text = text.replace(/(^|)@(\w+)/gi, function (s) {
      return '<a href="https://instagram.com/' + s.replace(/@/,'') + '" target="_blank">' + s + '</a>';
    });

    text = text.replace(/(^|)#(\w+)/gi, function (s) {
      return '<a href="http://instagram.com/explore/tags/' + s.replace(/#/,'') + '" target="_blank">' + s + '</a>';
    });

    text = text.replace(/\n/g, '<br>');

    return text;
  }
};

var lastUpdatedUser;

exports.user = function(cb) {
  var needUpdate = true;
  if (lastUpdatedUser) {
    var minutes = moment().diff(lastUpdatedUser, 'minutes');
    if (minutes < process.env.INSTAGRAM_UPDATE_FREQ_MINUTES) {
      needUpdate = false;
    }
  }

  var cachedUser = cache.get('instagram-user');
  if (!needUpdate && cachedUser) {
    cb(null, cachedUser);
    return;
  }

  var url = INSTAGRAM_API_URL + 'users/self?access_token=' +
            process.env.INSTAGRAM_ACCESS_TOKEN;

  request(url, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      body = JSON.parse(body);
      var instagramUser = body.data;
      instagramUser.url = 'https://instagram.com/' + instagramUser.username;
      cache.put('instagram-user', instagramUser);
      lastUpdatedUser = new Date();
      cb(null, instagramUser);
    } else {
      cb(error, null);
    }
  });
};

var INSTAGRAM_TOKEN_URL = 'https://api.instagram.com/oauth/access_token',
    INSTAGRAM_AUTH_REDIRECT_URL = 'http://localhost:3000/instagram/auth';

exports.getToken = function(code, cb) {
  request({
    'url': INSTAGRAM_TOKEN_URL,
    'method': 'POST',
    'form': {
      'client_id': process.env.INSTAGRAM_CLIENT_ID,
      'client_secret': process.env.INSTAGRAM_CLIENT_SECRET,
      'grant_type': 'authorization_code',
      'redirect_uri': INSTAGRAM_AUTH_REDIRECT_URL,
      'code': code
    }
  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      body = JSON.parse(body);
      if (body.access_token) {
        cb({'access_token': body.access_token});
      } else {
        cb(body);
      }
    } else {
      cb(body);
    }
  });
};
