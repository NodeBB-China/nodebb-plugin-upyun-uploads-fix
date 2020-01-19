'use strict'

const db = require.main.require('./src/database')
const winston = require.main.require('winston')

const nconf = require.main.require('nconf')
const Package = require('../package.json')

function makeError (err) {
  if (err instanceof Error) {
    err.message = Package.name + ' :: ' + err.message
  } else {
    err = new Error(Package.name + ' :: ' + err)
  }

  winston.error(err.message)
  return err
}

const Controllers = {}
const settings = {
  'operaterName': process.env.UPYUN_OPERATER_NAME,
  'operaterPassword': process.env.UPYUN_OPERATER_PASSWORD,
  'endpoint': process.env.UPYUN_ENDPOINT || 'v0.api.upyun.com',
  'bucket': process.env.UPYUN_UPLOADS_BUCKET,
  'path': process.env.UPYUN_UPLOADS_PATH,
  'host': process.env.UPYUN_HOST
}
Controllers.renderAdmin = (req, res) => {
  // Regenerate csrf token
  var token = req.csrfToken()
  var forumPath = nconf.get('url')
  if (forumPath.split('').reverse()[0] !== '/') {
    forumPath = forumPath + '/'
  }
  console.log()
  var data = {
    bucket: settings.bucket,
    path: settings.path,
    host: settings.host,
    forumPath: forumPath,
    endpoint: settings.endpoint || 'v0.api.upyun.com',
    operaterName: settings.operaterName,
    operaterPassword: settings.operaterPassword,
    csrf: token
  }

  res.render('admin/plugins/upyun-uploads', data)
}
Controllers.saveSettings = (settings, res, next) => {
  db.setObject(Package.name, settings, function (err) {
    if (err) {
      return next(makeError(err))
    }

    // fetchSettings()
    next()
  })
}

Controllers.upyunSettings = (req, res, next) => {
  const data = req.body
  const newSettings = {
    bucket: data.bucket || '',
    host: data.host || '',
    path: data.path || '',
    endpoint: data.endpoint || 'v0.api.upyun.com'
  }

  Controllers.saveSettings(newSettings, res, next)
}

Controllers.credentials = (req, res, next) => {
  const data = req.body
  const newSettings = {
    operaterName: data.operaterName || '',
    operaterPassword: data.operaterPassword || ''
  }

  Controllers.saveSettings(newSettings, res, next)
}

module.exports = Controllers
module.exports.Controllers = Controllers
module.exports.settings = settings
