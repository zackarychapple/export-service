import { Request, Response } from 'express';
import { ScreenshotRequest } from './support/ScreenshotRequest';
import { TimingObject } from './support/TimingObject';
import express = require('express');
import bodyParser = require('body-parser');
import fs = require('fs');
import Chrome = require('chrome-remote-interface');
import spawnprocess = require('child_process');
import PDFDocument = require('pdfkit');
import PDFDocumentOptions = PDFKit.PDFDocumentOptions;

const spawn = spawnprocess.spawn;
let chromiumBinary: any;
if (process.argv[ 2 ] === undefined) {
  throw Error('No headless binary path provided.');
} else {
  chromiumBinary = process.argv[ 2 ];
}

const letterPortriateWidth = '1280';
const letterPortriateHeight = '1696';
const letterLandscapeWidth = '1696';
const letterLandscapeHeight = '1280';
const letterPortriateResolution = `${letterPortriateWidth}x${letterPortriateHeight}`;
const letterLandscapeResolution = `${letterLandscapeWidth}x${letterLandscapeHeight}`;
//Look into '--dump-dom option'
//See additional options in
//https://cs.chromium.org/chromium/src/headless/app/headless_shell_switches.cc
//https://groups.google.com/a/chromium.org/forum/#!topic/headless-dev/zxnl6JZA7hQ look at this for resizing page
spawn(chromiumBinary, [ '--no-sandbox', '--remote-debugging-port=9222', `--window-size=${letterPortriateResolution}`, '--hide-scrollbars' ]);

let app = express();
app.use(bodyParser.json());

app.post('/', (req: Request, res: Response) => {
  const screenshotRequest: ScreenshotRequest = req.body;

  if (typeof screenshotRequest === 'undefined' || typeof screenshotRequest.url === 'undefined') {
    res.sendStatus(422)
  }
  let timingObj: TimingObject = {
    requestMade: Date.now()
  };
  Chrome.New(() => {
    Chrome((chromeInstance: any) => {
      timingObj.chromeStartup = Date.now();
      if (screenshotRequest.exportType === 'pdf') {
        chromeInstance.Page.loadEventFired(pdfExport.bind(null, chromeInstance, res, timingObj));
      }
      else {
        chromeInstance.Page.loadEventFired(imageExport.bind(null, chromeInstance, res, timingObj));
      }
      timingObj.pagePreEnable = Date.now();
      chromeInstance.Page.enable();
      timingObj.pagePostEnable = Date.now();
      chromeInstance.once('ready', () => {
        timingObj.navigationStart = Date.now();
        chromeInstance.Page.navigate({url: screenshotRequest.url});
      })
    });
  });
});

async function pdfExport(instance: Chrome, response: Response, timingObject: TimingObject) {
  const filename = await takeScreenshot(instance, timingObject);
  const doc = new PDFDocument({
    margin: 0
  });
  timingObject.initPDF = Date.now();
  doc.image(filename + '.png', 0, 0, {width: 612});
  response.setHeader('Content-Type', 'application/pdf');
  response.setHeader('Content-Disposition', 'attachment; filename=' + filename + '.pdf');

  doc.pipe(response);
  timingObject.pdfPiped = Date.now();

  doc.end();
  timingObject.documentClosed = Date.now();

  instance.close();
  timingObject.instanceClosed = Date.now();

  console.log(timingObject);
}

async function imageExport(instance: Chrome, response: Response, timingObject: TimingObject) {
  let filename = await takeScreenshot(instance, timingObject);

  response.setHeader('Content-Type', 'image/png');
  response.setHeader('Content-Disposition', 'attachment; filename=' + filename);
  fs.createReadStream(filename + '.png').pipe(response);

  console.log(timingObject);
}


async function takeScreenshot(instance: Chrome, timingObject: TimingObject) {
  timingObject.inTakeScreenshot = Date.now();

  const base64Image = await instance.Page.captureScreenshot();
  const filename = `screenshot-${Date.now()}`;

  fs.writeFileSync(filename + '.png', base64Image.data, 'base64');
  timingObject.imageSaved = Date.now();

  return filename;
}

app.listen(3000, async() => {
  Chrome.Version((err: any, info: any) => {
    if (err) {
      console.log(err);
    } else {
      console.log(info);
    }
  });
  console.log('Export app running on 3000!');
});