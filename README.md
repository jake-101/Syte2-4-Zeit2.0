# Syte2 for Zeit Now v2

Syte2 is the new and refined version of [Syte](http://github.com/rigoneri/syte), a personal website with interactive social integrations. Syte2 integrates with Twitter, Instagram, Foursquare, Github, Dribbble, Spotify/Last.fm, YouTube and Tumblr. You can see it in action on [the creator's personal site](http://rigoneri.com).

## For Zeit Now v2

Minor modifications were made to run the Syte2 API server using the [Now 2.0](https://zeit.co/now) serverless enviornment. Moved the controllers to an API folder, got rid of Express routing and moved it into [now.json](https://github.com/jake-101/Syte2-4-Zeit2.0/blob/master/now.json). The headers set in the "Routes" section of now.json cache the database responses at the [CDN edge](https://zeit.co/smart-cdn) for 2 hours before calling the Lambda function again. Env variables are set in now.json using [secrets](https://zeit.co/docs/v2/deployments/environment-variables-and-secrets/).

## Credit

Syte2 was developed by **Rigo** (Rodrigo Neri). The Zeit Now 2 changes are by [@jake-101](https://github.com/jake-101)

Check out Rigo's personal website at <http://rigoneri.com>
