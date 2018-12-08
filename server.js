'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');

const apiRouter = require('./routes/api.js');
const fccTestingRoutes = require('./routes/fcctesting.js');
const runner = require('./test-runner');

const app = express();

const ninetyDaysInMilliseconds = 90 * 24 * 60 * 60 * 1000;
app.use(helmet({
  noCache: true,
  hidePoweredBy: { setTo: 'PHP 4.2.0' },
  frameguard: { action: 'SAMEORIGIN' },
  hsts: { maxAge: ninetyDaysInMilliseconds, force: true },
  dnsPrefetchControl: true,
  referrerPolicy: { policy: 'same-origin' },
  contentSecurityPolicy: {
    directives: {
      scriptSrc: [
        "'self'",
        'code.jquery.com',
        "'unsafe-inline'",
        // "'sha256-Zel/R1cOUDWeomhnRLeWGPfTLXtyqK1YwSKQYXPzahE='",
        // "'sha256-ib4lFC28v5FzLoBNALLdYEkn/kJIVLlIrCMotPLCeyw='",
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
      ],
      imgSrc: [
        "'self'",
        'cdn.gomix.com',
        'hyperdev.com',
        'glitch.com',
      ],
      defaultSrc: [
        "'self'",
      ],
    },
  },
}));

app.use('/public', express.static(process.cwd() + '/public'));

app.use(cors({origin: '*'})); // For FCC testing purposes only

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.success = (data) => {
    res.json({success: true, ...data});
  };

  res.error = (error) => {
    console.log('stop: error time', {error});
    res.status(400).json({success: false, error});
  };
  
  // req.startTime = Date.now();

  next();
});

// Sample front-end
app.route('/b/:board/')
  .get(function(req, res) {
    res.sendFile(process.cwd() + '/views/board.html');
  });
app.route('/b/:board/:threadid')
  .get(function(req, res) {
    res.sendFile(process.cwd() + '/views/thread.html');
  });

// Index page (static HTML)
app.route('/')
  .get(function(req, res) {
    res.sendFile(process.cwd() + '/views/index.html');
  });

// For FCC testing purposes
fccTestingRoutes(app);

// Routing for API
app.use('/api', apiRouter);


// 404 Not Found Middleware
app.use(function(req, res, next) {
  res.status(404)
    .type('text')
    .send('Not Found');
});

// Start our server and tests!
app.listen(process.env.PORT || 3000, function() {
  console.log('Listening on port ' + process.env.PORT);
  if (process.env.NODE_ENV === 'test') {
    console.log('Running Tests...');
    setTimeout(function() {
      try {
        runner.run();
      } catch (e) {
        var error = e;
        console.log('Tests are not valid:');
        console.log(error);
      }
    }, 1500);
  }
});

module.exports = app; // for testing
