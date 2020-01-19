'use strict'

// 系统函数库
// const user = require.main.require('./user')
const db = require.main.require('./src/database')
const meta = require.main.require('./src/meta')
// const utils = require.main.require('../public/src/utils')

// 常用模块
// const async = require.main.require('async')
// const nconf = require.main.parent.require('nconf')
const winston = require.main.require('winston')
// const path = require.main.require('path')

// 插件模块
const Package = require('../package.json')
const Upyun = require('upyun')
const mime = require('mime')
const uuid = require('uuid/v4')
const fs = require('fs')
const path = require('path')
const util = require('util')
const axios = require('axios')

const { settings } = require('./controllers')
const { Controllers } = require('./controllers')

// console.log(settings)

let upyunConn = null

function makeError (err) {
  if (err instanceof Error) {
    err.message = Package.name + ' :: ' + err.message
  } else {
    err = new Error(Package.name + ' :: ' + err)
  }

  winston.error(err.message)
  return err
}

const Core = {}
Core.UpyunConn = () => {
  if (!upyunConn) {
    // console.log(settings)
    const bucket = new Upyun.Bucket(settings.bucket, settings.operaterName, settings.operaterPassword)
    upyunConn = new Upyun.Client(bucket, { domain: settings.endpoint })
  }
  return upyunConn
}

Core.getUpyunDir = () => {
  var remotePath = ''
  if (settings.path && settings.path.length > 0) {
    remotePath = settings.path
    if (!remotePath.match(/^\//)) {
      // Add start slash
      remotePath = '/' + remotePath
    }
    // remove trailing slash
    remotePath = remotePath.replace(/\/$/, '')
  }
  return remotePath
}

Core.getUpyunHost = () => {
  var host = 'https://' + settings.bucket + '.b0.upaiyun.com'
  if (settings.host) {
    // must start with http://
    if (!settings.host.match(/^http/)) {
      host = 'https://' + settings.host
    } else {
      host = settings.host
    }
  }
  return host
}

Core.uploadToUpyun = async (filename, buffer) => {
  let remotePath = Core.getUpyunDir() + '/'
  remotePath += uuid() + path.extname(filename)
  try {
    const data = await Core.UpyunConn().putFile(remotePath, buffer)
    winston.verbose(data)
    const host = Core.getUpyunHost()
    const remoteHref = host + remotePath
    return {
      name: filename,
      url: remoteHref
    }
  } catch (e) {
    throw makeError(e)
  }
}

Core.fetchSettings = async () => {
  const newSettings = await db.getObjectFields(Package.name, Object.keys(settings))
  if (newSettings.operaterName) {
    settings.operaterName = newSettings.operaterName
  } else {
    settings.operaterName = process.env.UPYUN_OPERATER_NAME
  }
  if (newSettings.operaterPassword) {
    settings.operaterPassword = newSettings.operaterPassword
  } else {
    settings.operaterPassword = process.env.UPYUN_OPERATER_PASSWORD
  }
  if (!newSettings.bucket) {
    settings.bucket = process.env.UPYUN_UPLOADS_BUCKET || ''
  } else {
    settings.bucket = newSettings.bucket
  }
  if (!newSettings.path) {
    settings.path = process.env.UPYUN_UPLOADS_PATH || ''
  } else {
    settings.path = newSettings.path
  }
  if (!newSettings.host) {
    settings.host = process.env.UPYUN_HOST
  } else {
    settings.host = newSettings.host
  }
  if (!newSettings.endpoint) {
    settings.endpoint = process.env.UPYUN_ENDPOINT || 'v0.api.upyun.com'
  } else {
    settings.endpoint = newSettings.endpoint
  }
  if (settings.path) {
    try {
      await Core.UpyunConn().makeDir(Core.getUpyunDir())
    } catch (e) {
      makeError(e)
      winston.error(e.stack)
    }
  }
}

Core.init = async (params) => {
  Core.fetchSettings()
  const router = params.router
  const hostMiddleware = params.middleware
  // const hostControllers = params.controllers;
  // 我们需要为每个视图创建路由。 一个 API 路由，以及它自身的路由。 方法可以参考下面的方案
  // 使用 buildHeader 中间件， NodeBB会构建页面，并将你的模板嵌入进去
  const adminRoute = '/admin/plugins/upyun-uploads'
  router.get(adminRoute, hostMiddleware.applyCSRF, hostMiddleware.admin.buildHeader, Controllers.renderAdmin)
  router.get('/api' + adminRoute, hostMiddleware.applyCSRF, Controllers.renderAdmin)

  router.post('/api' + adminRoute + '/upyunsettings', Controllers.upyunSettings, (req, res) => {
    Core.fetchSettings()
    res.json('Saved!')
  })
  router.post('/api' + adminRoute + '/credentials', Controllers.credentials, (req, res) => {
    Core.fetchSettings()
    res.json('Saved!')
  })
}

Core.addAdminNavigation = async (header) => {
  header.plugins.push({
    route: '/plugins/upyun-uploads',
    icon: 'fa-envelope-o',
    name: '又拍云上传'
  })
  return header
}

Core.uploadImage = async (data) => {
  const image = data.image

  if (!image) {
    winston.error('invalid image')
    throw new Error('invalid image')
  }

  // check filesize vs. settings
  if (image.size > parseInt(meta.config.maximumFileSize, 10) * 1024) {
    winston.error('error:file-too-big, ' + meta.config.maximumFileSize)
    throw new Error('[[error:file-too-big, ' + meta.config.maximumFileSize + ']]')
  }

  const type = image.url ? 'url' : 'file'
  const allowedMimeTypesOrigin = ['image/png', 'image/jpeg', 'image/pjpeg', 'image/jpg', 'image/gif', 'image/svg+xml']
  const allowedMimeTypesConfig = meta.config.allowedFileExtensions.split(',').map(v => mime.getType(v))
  winston.verbose(allowedMimeTypesConfig)
  const allowedMimeTypes = Object.assign(allowedMimeTypesOrigin, allowedMimeTypesConfig)
  if (type === 'file') {
    if (!image.path) {
      throw new Error('invalid image path')
    }

    if (allowedMimeTypes.indexOf(mime.getType(image.path)) === -1) {
      throw new Error('invalid mime type')
    }

    const buffer = await util.promisify(fs.readFile)(image.path)
    return Core.uploadToUpyun(image.name, buffer)
  } else { // River: what is Core about? need test.
    if (allowedMimeTypes.indexOf(mime.getType(image.url)) === -1) {
      throw new Error('invalid mime type')
    }
    winston.verbose(image)
    const filename = image.url.split('/').pop()
    const response = await axios.get(image.url, {
      responseType: 'arraybuffer'
    })
    if (response.status !== 200) {
      throw new Error('目前不能获得图像')
    }
    return Core.uploadToUpyun(filename, response.data)
  }
}

Core.uploadFile = async (data) => {
  const file = data.file

  if (!file) {
    throw new Error('invalid file')
  }

  if (!file.path) {
    throw new Error('invalid file path')
  }
  // check filesize vs. settings
  // const allowedMimeTypes = meta.config.allowedFileExtensions.split(',').map(v => mime.getType(v))

  // if (allowedMimeTypes.indexOf(mime.getType(file.path)) === -1) {
  //  throw new Error('invalid mime type')
  // }

  if (file.size > parseInt(meta.config.maximumFileSize, 10) * 1024) {
    winston.error('error:file-too-big, ' + meta.config.maximumFileSize)
    throw new Error('[[error:file-too-big, ' + meta.config.maximumFileSize + ']]')
  }

  const buffer = util.promisify(fs.readFile(file.path))
  return Core.uploadToUpyun(file.name, buffer)
}
module.exports = Core
module.exports.Core = Core
