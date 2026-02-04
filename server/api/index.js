const serverless = require('serverless-http');
const app = require('../index').app;
module.exports = serverless(app);