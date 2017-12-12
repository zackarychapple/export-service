import { createReadStream, existsSync, unlinkSync } from 'fs';
import * as path from 'path';
import { Request, Response, Express } from 'express';
import { eachLimit } from 'async';
import express = require('express');
import bodyParser = require('body-parser');
const Chrome = require('chrome-remote-interface');
import PDFDocument = require('pdfkit');
const SimpleNodeLogger = require('simple-node-logger');

const serverPkg = require('../package.json');
import { ChromeInstancesManager } from './classes/ChromeInstancesManager.class';
import { ScreenshotMaker } from './classes/ScreenshotMaker.class';
import { ScreenshotRequest } from './support/ScreenshotRequest';
import { ChromeInstance } from './support/ChromeInstance';
import { ATTEMPTS_FOR_URL, DEFAULT_INSTANCES_NUMBER, HEALTH_CHECK_PERIOD } from './support/constants';

if (process.argv[2] === undefined) {
  throw Error('No headless binary path provided.');
}

const logPath = path.join(__dirname, '../logfile.log');

// remove logfile
if (existsSync(logPath)) {
  unlinkSync(logPath);
}

const logger = SimpleNodeLogger.createSimpleLogger({
  logFilePath:'logfile.log',
  timestampFormat:'YYYY-MM-DD HH:mm:ss.SSS'
});

const instancesNumber = (process.argv[3] && !isNaN(parseInt(process.argv[3], 10))) ?
  parseInt(process.argv[3], 10) :
  DEFAULT_INSTANCES_NUMBER;

const app: Express = express();
const chromeInstancesManager = new ChromeInstancesManager(process.argv[2], instancesNumber, logger);

process.on('SIGINT', () => {
  // closing chrome instances before exiting from main nodejs process
  chromeInstancesManager.killInstances(false);
  setTimeout(() => {
    process.exit(1);
  }, 500);
});

_runServer();

app.use(bodyParser.json());

/* ENDPOINTS START*/
app.get('/healthcheck', healthCheck);
app.get('/activity-check', activityCheck);
app.get('/logfile', logfile);
app.get('/', info);
app.post('/save-as-pdf', getAsPdf);
app.post('/', makeResource);
app.post('/dom2page', domToFile);
app.post('/dom-to-file', domToFile);
/* ENDPOINTS END*/

/* MAIN FUNCTIONS START */
function healthCheck(req: Request, res: Response) {
  res.status(200).end(`version: ${serverPkg.version}`);
}

function activityCheck(req: Request, res: Response) {
  chromeInstancesManager.getChromeProcessesNumber((err: string, pCount: number) => {
    console.log(`Health check started. Period is ${HEALTH_CHECK_PERIOD} sec.`);
    chromeInstancesManager.healthCheck(serverPkg.version, (outString: string) => {
      if (!err && pCount) {
        outString = `Chrome processes detected:  ${pCount} \r\n` + outString;
      }
      res.status(200).end(outString);
    });
  });

}

// todo: shall be removed after stabilisation of app
function logfile(req: Request, res: Response) {
  const readStream = createReadStream(logPath);
  res.writeHead(200, {
    'Content-Type': 'text/plain',
    'Content-Disposition': `attachment; filename=log.txt`
  });

  readStream.pipe(res);
}

function info (req: Request, res: Response) {
  const response = {
    version: serverPkg.version,
    endpoints: {
      'GET /': {
        description: 'API help',
        method: 'get'
      },
      'GET /healthcheck': {
        description: 'Immediately sends service\'s version',
        method: 'get'
      },
      'GET /activity-check': {
        description: 'Will gather info about activities at 30 sec and send result to browser',
        method: 'get'
      },
      'POST /': {
        description: 'Will create PDF or image, which will contain screenshots of pages, specified via urls(in case of image - only first of them)',
        method: 'post',
        request: {
          urls: 'string[], for example [\'http://github.com\', \'http://github.com\', \'http://github.com\'])',
          exportName: 'string',
          exportType: 'image || pdf',
          delay: 'number(not supported in versions > 1.3.0)',
          flagName: 'readyState(not supported in versions > 1.3.0)'
        },
        response: {
          body: 'Buffer'
        }
      },
      'POST /save-as-pdf': {
        description: 'Will create PDF, which will contain print(Ctrl+p -> save as PDF in browser) version os specified page',
        method: 'post',
        request: {
          url: 'string',
          options: 'Look at https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-printToPDF',
          evalParams: {
            delay: 'Number. Optional. Delay in milliseconds between loading page and making PDF file'
          }
        },
        response: {
          body: 'Buffer'
        }
      },
      'POST /dom2page': {
        warning: ' endpoint deprecated. Use dom-to-file endpoint instead.',
        description: 'Will create PDF or image, for specified html',
        method: 'post',
        request: {
          html: 'string',
          exportName: 'string',
          exportType: 'image || pdf'
        },
        response: {
          body: 'Buffer'
        }
      },
      'POST /dom-to-file': {
        description: 'Will create PDF or image, for specified html',
        method: 'post',
        request: {
          html: 'string',
          exportName: 'string',
          exportType: 'image || pdf'
        },
        response: {
          body: 'Buffer'
        }
      }
    }
  };

  res.writeHead(200, {
    'Content-Type': 'text/html',
  });
  res.end('<html><head></head><body><ul>' + _expand(response) + '</ul></body></html>');
}

async function getAsPdf (req: Request, res: Response) {

  let {url, options, evalParams} = req.body;

  if (!url || typeof url !== 'string') {
    res.status(422).send('Url required');
    return;
  }
  if (!options || typeof options !== 'object') {
    options = {};
  }

  if (!evalParams || typeof evalParams !== 'object') {
    evalParams = {};
  }

  // todo add options validation
  const maker = new ScreenshotMaker(logger);
  const port = await chromeInstancesManager.getFreePort();
  try {
    const pdfBuffer = await maker.makeNativePdf(url, port, options, evalParams);
    chromeInstancesManager.setPortAsIdle(port);
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
    });
    res.end(pdfBuffer, 'binary');
  } catch (e) {
    res.status(500).end('PDF making error');
    chromeInstancesManager.killInstanceOn(port);
  }
}

function makeResource(req: Request, res: Response): void {
  // todo: add validator for url
  const currentRequest: ScreenshotRequest = req.body;
  if (!currentRequest.urls || !Array.isArray(currentRequest.urls) || currentRequest.urls.length <= 0) {
    res.status(422).send('Should be specified at least one url');
    return;
  }
  if (!currentRequest.exportType || (currentRequest.exportType !== 'image' && currentRequest.exportType !== 'pdf')) {
    res.status(422).send('Export type should be specified');
    return;
  }

  // in case of requested image and several urls was received - will leave only the first
  if (currentRequest.exportType === 'image' && currentRequest.urls.length > 1) {
    currentRequest.urls = [currentRequest.urls[0]];
  }

  const urlData: any[] = currentRequest.urls.map((url: string) => {
    return {
      url,
      buffer: null,
      error: null
    }
  });
  currentRequest.urls.forEach(async (url, index) => {
    try {
      urlData[index].buffer = await _getScreenshot(url, currentRequest, ATTEMPTS_FOR_URL);
    } catch (err) {
      logger.error(`${err}`);
      urlData[index].error = true;
    } finally {
      // will check, is all screenshots already made(all buffers/errors filled)
      if (urlData.some((item: any) => !item.buffer && !item.error)) {
        return;
      }
      try {
        const requestData = {
          exportType: req.body.exportType,
          exportName: (req.body.exportName) ? req.body.exportName : 'Export_' + Date.now()
        };
        switch (requestData.exportType) {
          case 'pdf':
            _sendPdf(urlData, requestData.exportName, res).catch(e => {
              throw new Error('Error pdf generation:' + e);
            });
            break;
          case 'image':
            _sendImage(urlData[0].buffer, res);
            break;
          default:
            res.status(422).send('Invalid file type');
            break;
        }
      } catch (e) {
        const msg = `Resource not create. Error: ${e}`;
        logger.error(msg);

        res.status(500).send(e);
      }

    }

  });
}

/**
 * Will make pdf/image from passed html string
 * @param {Request} req
 *                  req.body: {
 *                     html: string,
 *                     exportName: string,
 *                     exportType: image
 *                  }
 * @param {Response} res
 * @returns {any}
 */
async function domToFile (req: Request, res: Response): Promise<any> {
  const port = await chromeInstancesManager.getFreePort();

  const maker = new ScreenshotMaker(logger);
  try {
    const buffer = await maker.domToImage(port, req.body.html);
    chromeInstancesManager.setPortAsIdle(port);

    switch (req.body.exportType) {
      case 'pdf':
        _sendPdf([{buffer}], req.body.exportName, res);
        break;
      case 'image':
        _sendImage(buffer, res);
        break;
      default:
        res.status(422).send('Invalid file type');
    }
  } catch (err) {
    logger.error(`Dom to file function error: ${err}`);
    res.status(500).send(err);
  }

}
/* MAIN FUNCTIONS END */


/* SERVICE FUNCTIONS START */
/**
 * will try to receive data(Buffer) from specified url. In case of error, will repeat (recursively), until attempts > 0
 * @param {string} url
 * @param {IScreenshotRequest} request
 * @param {number} attemptsLeft
 * @returns {Promise<any>}
 * @private
 */
async function _getScreenshot(url: string, request: ScreenshotRequest, attemptsLeft: number): Promise<any> {
  const port = await chromeInstancesManager.getFreePort();

  const maker = new ScreenshotMaker(logger);
  try {
    const image = await maker.makeScreenshot(url, port);
    chromeInstancesManager.setPortAsIdle(port);
    return Promise.resolve(image);

  } catch (err) {
    chromeInstancesManager.killInstanceOn(port);
    const msg = `Screenshot of ${url} was not created. Error: ${err}`;
    logger.error(msg);
    if (attemptsLeft === 1) {
      return Promise.reject(`Screenshot of ${url} was not created. Attempts spent: ${ATTEMPTS_FOR_URL}`);
    }
    attemptsLeft--;
    logger.info(`${url}. Attempts left: ${attemptsLeft}`);
    return await _getScreenshot(url, request, attemptsLeft);
  }
}

/**
 * Recursive add page with image to document
 * @param {[{buffer: Buffer, url: string}]} images
 * @param doc: PDFDocument
 * @private
 */
function _addImageToDocument(images: any[], doc: any): void {
  const currentImage = images.shift();
  if (currentImage) {
    try {
      doc.image(currentImage.buffer, 0, 0, {width: 612});
    } catch (e) {
      doc.text('Error receiving data');
    }
  } else {
    doc.text('Error receiving data');
  }

  if (images.length > 0) {
    doc.addPage();

    return _addImageToDocument(images, doc);
  } else {
    return;
  }
}

async function _sendPdf(images: any, fileName: string, res: Response) {
  const doc = new PDFDocument({layout: 'portrait'});

  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename=${fileName}`
  });

  doc.pipe(res);
  await _addImageToDocument(images, doc);
  doc.end();
}

function _sendImage(imageBuffer: Buffer, res: Response) {
  res.writeHead(200, {
    'Content-Type': 'image/png',
  });
  res.end(imageBuffer, 'binary');
}

function _runServer() {
  const instances = chromeInstancesManager.cloneInstancesState();
  eachLimit(instances, 5, _browsersInfo, (error: Error) => {
    if (error) {
      const msg = `Server starting error: ${error}`;
      logger.error(msg);
      return;
    }

    app.listen(3000, () => {
      console.log('Export app running on 3000!');
    });
  });
}

function _browsersInfo(item: ChromeInstance, cb: Function): Function {
  return Chrome.Version({port: item.port}, (err: Error) => {
    if (!err) {
      return cb(null, null);
    }

    setTimeout(() => {
      return _browsersInfo(item, cb);
    }, 300);
  });
}

function _expand(obj: any) {
  let out = '';
  for (let key in obj) {

    if (obj.hasOwnProperty(key)) {
      const item = obj[key];
      out += (typeof item === 'string') ?
        `<li><b>${key}</b>: ${item}</li>`:
        `<li><b>${key}: </b><ul>${_expand(item)}</ul></li>`;
    }
  }
  return out;
}
/* SERVICE FUNCTIONS END */
