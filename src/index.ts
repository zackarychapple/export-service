import { Request, Response, Express } from 'express';
import { eachLimit } from 'async';
import express = require('express');
import bodyParser = require('body-parser');
const Chrome = require('chrome-remote-interface');
import PDFDocument = require('pdfkit');

const serverPkg = require('../package.json');

import { ChromeInstancesManager } from './classes/ChromeInstancesManager.class';
import { ScreenshotMaker } from './classes/ScreenshotMaker.class';
import { IScreenshotRequest } from './support/ScreenshotRequest';
import { IChromeInstance } from './support/ChromeInstance';
import { HEALTH_CHECK_PERIOD } from './support/constants';

if (process.argv[2] === undefined) {
  throw Error('No headless binary path provided.');
}

// process.argv[2] contains chromium binary
const chromeInstancesManager: ChromeInstancesManager = new ChromeInstancesManager(process.argv[2]);
const app: Express = express();

chromeInstancesManager.runInstances();
_runServer();

app.use(bodyParser.json());

/* ENDPOINTS START*/
app.get('/healthcheck', healthCheck);
app.get('/', testImage);
app.post('/', makeResource);
app.post('/dom2page', domToFile);
/* ENDPOINTS END*/

/* MAIN FUNCTIONS START */
function healthCheck(req: Request, res: Response) {
  console.log(`Health check started. Period is ${HEALTH_CHECK_PERIOD} sec.`);
  chromeInstancesManager.healthCheck((outString: string) => {
    res.status(200).end(outString);
  });
}

function testImage (req: Request, res: Response) {
  res.json({
    version: serverPkg.version,
    url: 'http://stackoverflow.com',
    exportName: 'my export file',
    orientation: 'portrait',
    exportType: 'image',
    delay: 0,
    flagName: 'readyState'
  });
}

function makeResource(req: Request, res: Response): void {
  // todo: add validator for url
  const currentRequest: IScreenshotRequest = req.body;
  if (!currentRequest.urls || !Array.isArray(currentRequest.urls) || currentRequest.urls.length <= 0) {
    res.status(422).send('Should be specified at least one url');
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

    chromeInstancesManager.getFreeInstance((instance: any) => {

      const maker = new ScreenshotMaker();
      maker.getScreenShot(url, instance, {flagName: currentRequest.flagName, delay: currentRequest.delay},
        (err: any, data: Buffer) => {
          // screenshot was made(or error received), anyway instance don't needed more
          chromeInstancesManager.setInstanceAsIdle(instance);

          if (err) {
            // in case of error current page will be generated with error notification
            console.log(`Screenshot of ${url} was not created`);
            console.log(err);
            urlData[index].error = true;
          }

          urlData[index].buffer = data;
          // all screenshots has been made - buffers filled
          if (urlData.every((item: any) => item.buffer || item.error)) {
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
              res.status(500).send(e);
            }

          }

        });

    });

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
function domToFile (req: Request, res: Response): any {

  chromeInstancesManager.getFreeInstance((instance: IChromeInstance) => {
    const maker = new ScreenshotMaker();
    maker.domToImage(instance, req.body.html, (error: any, buffer: Buffer) => {
      // screenshot was made(or error received), anyway instance don't needed more
      chromeInstancesManager.setInstanceAsIdle(instance);

      if (error) {
        return res.status(500).send(error);
      }

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
      return;
    })

  });
}
/* MAIN FUNCTIONS END */


/* SERVICE FUNCTIONS START */
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
      console.log(error);
      return;
    }

    console.log('Instances stats :');
    console.log(instances);
    console.log('********************');

    app.listen(3000, () => {
      console.log('Export app running on 3000!');
    });
  });
}

function _browsersInfo(item: IChromeInstance, cb: Function): Function {
  return Chrome.Version({port: item.port}, (err: Error) => {
    if (!err) {
      return cb(null, null);
    }

    setTimeout(() => {
      return _browsersInfo(item, cb);
    }, 300);
  });
}
/* SERVICE FUNCTIONS END */
