import { Request, Response } from 'express';
import { ScreenshotRequest } from './support/ScreenshotRequest';
import { TimingObject } from './support/TimingObject';
import { debounce, union } from 'lodash';

import fs = require('fs');
import express = require('express');
import bodyParser = require('body-parser');
import spawnprocess = require('child_process');
import Chrome = require('chrome-remote-interface');

import PDFDocument = require('pdfkit');
import PDFDocumentOptions = PDFKit.PDFDocumentOptions;

const spawn: any = spawnprocess.spawn;

let chromiumBinary: any;

if (process.argv[2] === undefined) {
  throw Error('No headless binary path provided.');
} else {
  chromiumBinary = process.argv[2];
}

const body = `
<head>
    <base href="http://www.goat.com">
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Goat.com</title>
    <link href="assets/css/style.css" rel="stylesheet">
    <!--[if lt IE 9]>
      <script src="https://oss.maxcdn.com/html5shiv/3.7.2/html5shiv.min.js"></script>
      <script src="https://oss.maxcdn.com/respond/1.4.2/respond.min.js"></script>
    <![endif]-->
    <link rel="apple-touch-icon" sizes="180x180" href="assets/favicon/apple-touch-icon.png">
    <link rel="icon" type="image/png" href="assets/favicon/favicon-32x32.png" sizes="32x32">
    <link rel="icon" type="image/png" href="assets/favicon/favicon-16x16.png" sizes="16x16">
    <link rel="manifest" href="assets/favicon/manifest.json">
    <link rel="mask-icon" href="assets/favicon/safari-pinned-tab.svg" color="#5bbad5">
    <link rel="shortcut icon" href="assets/favicon/favicon.ico">
    <meta name="msapplication-config" content="assets/favicon/browserconfig.xml">
    <meta name="theme-color" content="#ffffff">
  </head>
  <body>
    <script async="" src="//www.google-analytics.com/analytics.js"></script><script>
      (function(i,s,o,g,r,a,m){i['GoogleAnalyticsObject']=r;i[r]=i[r]||function(){
      (i[r].q=i[r].q||[]).push(arguments)},i[r].l=1*new Date();a=s.createElement(o),
      m=s.getElementsByTagName(o)[0];a.async=1;a.src=g;m.parentNode.insertBefore(a,m)
      })(window,document,'script','//www.google-analytics.com/analytics.js','ga');
      ga('create', 'UA-9369909-101', 'auto');
      ga('send', 'pageview');
    </script>
    <div class="top-bar">The one and only Goat.com<div class="visible-xs"><br></div><div class="hidden-xs">&nbsp;-&nbsp;</div>is available <a href="https://domainnamesales.com/domain/goat.com" target="_blank">For Lease</a></div>
    <h1>Goat.com</h1>
  	<div class="goat-holder">
    	<img src="assets/img/goat.png" alt="Greatest of All Time" onclick="document.getElementById('goatPlay').play()">
  	</div>
    <div id="beaver" style="bottom: -10px;">
      <a href="http://beaver.com" target="_blank">
        <img src="assets/img/beaver-canada.png" alt="beaver.com">
      </a>
    </div>
    <audio id="goatPlay" autoplay="">
    	<source src="assets/audio/wav/goat.wav" id="wavSource" type="audio/wav">
    	<source src="assets/audio/mp3/goat.mp3" id="mp3Source" type="audio/mpeg">
    	<source src="assets/audio/ogg/goat.ogg" id="oggSource" type="audio/ogg">
    	Your browser does not support the audio element.
    </audio>
    <script src="bower_components/jquery/dist/jquery.min.js"></script>
    <script src="assets/js/main.js"></script>
</body>
`;

const letterPortraitWidth = '1280';
const letterPortraitHeight = '1696';
const letterLandscapeWidth = '1696';
const letterLandscapeHeight = '1280';
const letterPortraitResolution = `${letterPortraitWidth}x${letterPortraitHeight}`;
const letterLandscapeResolution = `${letterLandscapeWidth}x${letterLandscapeHeight}`;
//Look into '--dump-dom option'
//See additional options in
//https://cs.chromium.org/chromium/src/headless/app/headless_shell_switches.cc
//https://groups.google.com/a/chromium.org/forum/#!topic/headless-dev/zxnl6JZA7hQ look at this for resizing page
spawn(chromiumBinary, ['--no-sandbox', '--remote-debugging-port=9222', `--window-size=${letterPortraitResolution}`, '--hide-scrollbars']);

let app = express();
app.use(bodyParser.json());

app.post('/', (req: Request, res: Response): any => {
  const screenshotRequest: ScreenshotRequest = req.body;

  if (typeof screenshotRequest === 'undefined' || typeof screenshotRequest.url === 'undefined') {
    return res.sendStatus(422);
  }

  let timingObj: TimingObject = {
    requestMade: Date.now()
  };

  let delay: number = 0;

  if (typeof screenshotRequest.delay !== 'undefined') {
    delay = screenshotRequest.delay;
  }

  Chrome.New((err: Error, newTabData: any) => {
    if (err) {
      console.error('Create new tab error: ', err);
    }

    Chrome((chromeInstance: any) => {
      const {Page, Network} = chromeInstance;

      timingObj.chromeStartup = Date.now();

      let requestCount: number = 0;
      let requestFinishedCount: number = 0;
      let requestFailedCount: number = 0;

      let pageIsLoaded: boolean = false;

      let requestIds: string[] = [];
      let requestFailedIds: string[] = [];
      let requestFinishedIds: string[] = [];

      const exportFileDebounce: Function = debounce(() => {
        setTimeout(() => {
          if (requestFinishedCount + requestFailedCount !== requestCount) {
            return;
          }

          if (screenshotRequest.exportType.toLowerCase() === 'pdf') {
            pdfExport(chromeInstance, res, newTabData, timingObj, delay);
          } else {
            imageExport(chromeInstance, res, newTabData, timingObj, delay);
          }
        }, 300);
      }, 300);

      Network.requestWillBeSent((response: any) => {
        requestIds.push(response.requestId);

        requestCount = union(requestIds).length;
      });

      Network.loadingFinished((response: any) => {
        requestFinishedIds.push(response.requestId);
        requestFinishedCount = union(requestFinishedIds).length;

        if (pageIsLoaded && requestFinishedCount + requestFailedCount === requestCount) {
          exportFileDebounce();
        }
      });

      Network.loadingFailed((response: any) => {
        requestFailedIds.push(response.requestId);
        requestFailedCount = union(requestFailedIds).length;

        if (pageIsLoaded && requestFinishedCount + requestFailedCount === requestCount) {
          exportFileDebounce();
        }
      });

      Page.loadEventFired(() => {
        pageIsLoaded = true;

        if (pageIsLoaded && requestFinishedCount + requestFailedCount === requestCount) {
          exportFileDebounce();
        }
      });

      timingObj.pagePreEnable = Date.now();

      Page.enable();
      Network.enable();

      timingObj.pagePostEnable = Date.now();

      chromeInstance.once('ready', () => {
        timingObj.navigationStart = Date.now();

        Page.navigate({url: screenshotRequest.url});
      });
    });
  });
});

app.post('/dom2page', (req: Request, res: Response) => {
  Chrome.New((err: Error, newTabData: any) => {
    if (err) {
      console.error('Create new tab error: ', err);
    }

    Chrome((chromeInstance: any) => {
      chromeInstance.Runtime.evaluate({
        'expression': `document.getElementsByTagName('html')[0].innerHTML = \`${body}\``
      }, function (error: Error, response: any) {
        if (error) {
          console.error('Protocol error: ', error);
        } else if (response.wasThrown) {
          console.error('Evaluation error', response);
        } else {
          imageExport(chromeInstance, res, newTabData, {}, 0);
        }
      });
    });
  });
});

async function pdfExport(instance: Chrome, response: Response, newTabInfo: any, timingObject: TimingObject, delay: number) {
  const takeScreenshotDebounce: Function = debounce(async() => {
    const filename = await takeScreenshot(instance, timingObject)
      .catch((error: Error) => {
        console.log('Take Screenshot Call Error: ' + error);
      });

    const doc: any = new PDFDocument({
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

    Chrome.Close({'id': newTabInfo.id});
    timingObject.instanceClosed = Date.now();

    console.log(timingObject);
  }, delay);

  takeScreenshotDebounce();
}

async function imageExport(instance: Chrome, response: Response, newTabInfo: any, timingObject: TimingObject, delay: number) {
  const takeScreenshotDebounce: Function = debounce(async() => {
    let filename: any = await takeScreenshot(instance, timingObject)
      .catch((error: Error) => {
        console.log('Take Screenshot Call Error: ' + error);
      });

    response.setHeader('Content-Type', 'image/png');
    response.setHeader('Content-Disposition', 'attachment; filename=' + filename);

    fs.createReadStream(filename + '.png').pipe(response);

    Chrome.Close({'id': newTabInfo.id});

    console.log(timingObject);
  }, delay);

  takeScreenshotDebounce();
}

async function takeScreenshot(instance: Chrome, timingObject: TimingObject) {
  timingObject.inTakeScreenshot = Date.now();

  const base64Image: any = await instance.Page.captureScreenshot();
  const filename: string = `screenshot-${Date.now()}`;

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
