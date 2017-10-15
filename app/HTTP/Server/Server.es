/*!UroxGvT3uDMQCT1va20i43ZZSxo*/
import express      from 'express';
import bodyParser   from 'body-parser';
import cookieParser from 'cookie-parser';
import formidable   from 'formidable';
import mime         from 'mime';
import S            from 'underscore.string';
import url          from 'url';
import fs           from 'fs';

export default function (node, logger) {

  node.on('-load', function (slice, callback) {
    const server = express();
    server.on('error', err => logger.error(err));

    server.use(bodyParser.json(this.node.get('middleware.body-parser.json')));
    server.use(bodyParser.urlencoded(this.node.get('middleware.body-parser.urlencoded')));
    server.use(bodyParser.raw(this.node.get('middleware.body-parser.raw')));

    const CPOptions = this.node.get('middleware.cookie-parser');
    server.use(cookieParser(CPOptions.secret, CPOptions));

    const routesmap = this.node.get('routes');
    const routes = [];
    for (let name in routesmap) {
      const route = routesmap[name];
      route.name = name;
      routes.push(route);
    }
    routes.sort((left, right) => left.path < right.path).map(route => {
      const method = route.method.toLowerCase();
      logger.info('New route %s:%s %s %s', this.node.cwd(), route.name, route.method, route.path);
      server[method](route.path, (request, response) => {
        return node.newest().begin()
          .then(':prepare-transaction').replace('input')
          .then(route.handler, '$:input').replace('output')
          .then(':write-output')
          .end({ route, request, response }, error => { if (error) logger.error(error) });
      });
    });

    const ip = this.node.get('ip');
    const port = this.node.get('port');
    logger.info('Listening on %s:%s', ip, port);
    server.listen(port, ip);

    this.node.set('instance', server);
    return callback(null, slice);
  });

  node.on('prepare-transaction', function ({ route, request, response }, callback) {
    logger.log('%s %s %s', route.name, request.method, request.url);
    const payload = {};
    payload.http    = { request, response, route: Bhiv.Util.copy(route) };
    payload.url     = request.url;
    payload.headers = request.headers;
    payload.params  = request.params;
    payload.query   = url.parse(request.url, true).query;
    payload.cookies = request.cookies;
    payload.session = null;
    payload.body    = null;
    payload.files   = null;
    const contentType = (request.headers['content-type'] || '').split(';')[0] || 'none';
    switch (contentType) {
    case 'application/octet-stream':
      payload.body = request.body.toString();
      return callback(null, payload);
    case 'application/x-www-form-urlencoded':
    case 'application/json':
      payload.body = request.body;
      return callback(null, payload);
    default : case 'none':
      return callback(null, payload);
    case 'multipart/form-data':
      const opts = node.get('Formidable') || {};
      const form = new formidable.IncomingForm(opts);
      return form.parse(request, (err, fields, files) => {
        payload.body  = fields;
        payload.files = files;
        return callback(null, payload);
      });
    }
  });

  node.on('write-output')
    .then(function (payload) {
      payload.response.removeHeader('X-Powered-By');
      return payload;
    })
    .Match('$:output.type')
    .  When(/^http$/i).then(':write-output-generic')
    .  When(/^error$/i).then(':write-output-error')
    .  When(/^empty$/i).then(':write-output-empty')
    .  When(/^json$/i).then(':write-output-json')
    .  When(/^html$/i).then(':write-output-html')
    .  When(/^css$/i).then(':write-output-css')
    .  When(/^javascript|js$/i).then(':write-output-javascript')
    .  When(/^plain|te?xt$/i).then(':write-output-text')
    .  When(/^file$/i).then(':write-output-file')
    .  When(/^redirect|location$/i).then(':write-output-rediect')
    .  When(/^proxy$/i).then(':write-output-proxypass')
    .  Otherwise()
    .    then( ':write-output-error'
             , { response: '$:response', error: { message: 'Bad response type' } }
             )
    .  end()
    .end();

  node.on('write-output-error', function ({ response, error }) {
    logger.error(error);
    const code = error.code == 'ENOENT' ? 404
      : (error.code | 0) == error.code ? error.code
      : 500;
    const headers = error.headers || { 'Content-Type': 'text/plain' };
    response.writeHead(code, headers);
    response.end(error.message);
    return null;
  });

  node.on('write-output-generic', function ({ response, output }) {
    if (output == null) return ;
    response.writeHead(output.code || 200, output.headers || {});
    response.end(output.body);
    return null;
  });

  node.on('write-output-html', function ({ response, output }, callback) {
    const params = Bhiv.Util.copy(output);
    params.body = params.content;
    if (params.headers == null) params.headers = {};
    params.headers['Content-Type'] = 'text/html; charset=UTF-8';
    params.headers['Content-Length'] = params.body.length;
    return this.node.send(':write-output-generic', { response, output: params }, callback);
  });

  node.on('write-output-file', function ({ response, output }, callback) {
    const params = Bhiv.Util.copy(output);
    if (params.headers == null) params.headers = {};
    const lowerCase = s => String.prototype.toLowerCase.call(s);
    if (!~Object.keys(params.headers).map(lowerCase).indexOf('content-type'))
      params.headers['Content-Type'] = mime.getType(params.filepath);
    try {
      const file = fs.createReadStream(params.filepath);
      file.pipe(response);
      file.on('start', () => { response.writeHead(params.code || 200, params.headers); });
      file.on('error', error => {
        return this.node.send(':write-output-file-error', { response, output, error }, callback);
      });
    } catch (error) {
      return this.node.send(':write-output-file-error', { response, output, error }, callback);
    }
  });

  node.on('write-output-file-error', function ({ response, output, error }, callback) {
    const payload = { response, error };
    return fs.stat(output.filepath, (error, stats) => {
      if (error) {
        payload.error = error;
        return this.node.send(':write-output-error', payload, callback);
      }
      if (!stats.isFile()) {
        payload.error = Bhiv.Util.wrapError(output.filepath + ' is not a file');
        return this.node.send(':write-output-error', payload, callback);
      }
      return this.node.send(':write-output-error', payload, callback);
    });
  });


};
