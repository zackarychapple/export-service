import { Request, Response, Express } from 'express';
import { IScreenshotRequest } from './support/ScreenshotRequest';
import { TimingObject } from './support/TimingObject';
import { IChromeInstance } from './support/ChromeInstance';
import { debounce } from 'lodash';
import { eachLimit } from 'async';

import fs = require('fs');
import express = require('express');
import bodyParser = require('body-parser');
import spawnprocess = require('child_process');
const Chrome = require('chrome-remote-interface');

import PDFDocument = require('pdfkit');
import PDFDocumentOptions = PDFKit.PDFDocumentOptions;
import Timer = NodeJS.Timer;

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
const remoteDebuggingPorts: IChromeInstance[] = [
  {port: 9222, isInActive: true},
  {port: 9223, isInActive: true},
  {port: 9224, isInActive: true},
  {port: 9225, isInActive: true},
  {port: 9226, isInActive: true}
];

let app: Express = express();
app.use(bodyParser.json());

//Look into '--dump-dom option'
//See additional options in
//https://cs.chromium.org/chromium/src/headless/app/headless_shell_switches.cc
//https://groups.google.com/a/chromium.org/forum/#!topic/headless-dev/zxnl6JZA7hQ look at this for resizing page

remoteDebuggingPorts.forEach((item: IChromeInstance) => {
  spawn(chromiumBinary, ['--no-sandbox', `--remote-debugging-port=${item.port}`, `--window-size=${letterPortraitResolution}`, '--hide-scrollbars']);
});

runServer();

app.get('/', (req: Request, res: Response) => {
  res.json({
    url: 'http://stackoverflow.com',
    exportName: 'my export file',
    orientation: 'portrait',
    exportType: 'image',
    delay: 0,
    flagName: 'prerenderReady'
  });
});

app.post('/', (req: Request, res: Response): any => {
  const screenshotRequest: IScreenshotRequest = req.body;

  if (typeof screenshotRequest === 'undefined' || typeof screenshotRequest.url === 'undefined') {
    return res.sendStatus(422);
  }

  let instanceData = remoteDebuggingPorts.find((item: IChromeInstance, index: number) => {
    if (!item.isInActive) {
      return false;
    }

    remoteDebuggingPorts[index].isInActive = false;
    return true;
  });

  if (!instanceData) {
    return res.json({error: 'Sorry, all instances of chrome isn\'t unavailable'});
  }

  let timingObj: TimingObject = {
    requestMade: Date.now()
  };

  let delay: number = 0;
  let exportType: string = 'image';
  let customEventName: string = 'prerenderReady';

  if (typeof screenshotRequest.exportName !== 'undefined') {
    timingObj.exportName = screenshotRequest.exportName;
  } else {
    timingObj.exportName = 'Export_' + Date.now();
  }

  if (typeof screenshotRequest.flagName !== 'undefined') {
    customEventName = screenshotRequest.flagName;
  }

  if (typeof screenshotRequest.exportType !== 'undefined') {
    exportType = screenshotRequest.exportType;
  }

  if (typeof screenshotRequest.delay !== 'undefined') {
    delay = screenshotRequest.delay;
  }

  Chrome({port: (instanceData as IChromeInstance).port}, (chromeInstance: any) => {
    const {Page, Runtime} = chromeInstance;

    timingObj.chromeStartup = Date.now();

    const exportFileDebounce: Function = debounce(() => {
      if (exportType.toLowerCase() === 'pdf') {
        pdfExport(chromeInstance, res, instanceData as IChromeInstance, timingObj, delay);
      } else {
        imageExport(chromeInstance, res, instanceData as IChromeInstance, timingObj, delay);
      }
    }, 300);

    Page.loadEventFired(() => {
      getEventStatusByName(Runtime.evaluate, customEventName, (error: Error) => {
        if (error) {
          console.error('Custom event status: ', error);
        }

        exportFileDebounce();
      });
    });

    timingObj.pagePreEnable = Date.now();

    Page.enable();
    Runtime.enable();

    timingObj.pagePostEnable = Date.now();

    chromeInstance.once('ready', () => {
      timingObj.navigationStart = Date.now();

      Page.navigate({url: screenshotRequest.url});
    });
  });
});

function getEventStatusByName(runtimeEvaluate: Function, customEventName: string, cb: Function): Function {
  return getPrerenderReadyStatus(runtimeEvaluate, customEventName, (error: Error, data: {isLoaded: boolean}): Function | Timer => {
    if (error) {
      return cb(error);
    }

    if (data.isLoaded) {
      return cb(null, null);
    }

    return setTimeout((): Function => {
      return getEventStatusByName(runtimeEvaluate, customEventName, cb);
    }, 100);
  });
}

function getPrerenderReadyStatus(runtimeEvaluate: Function, customEventName: string, cb: Function): Function {
  return runtimeEvaluate({
    'expression': `window.${customEventName}`
  }, (error: Error, response: any): Function => {
    if (error) {
      return cb(error);
    }

    if (response.result.type === 'undefined') {
      return cb(`The custom event '${customEventName}' is not found`);
    }

    let isLoaded: boolean = false;

    if (response.result.value) {
      isLoaded = !!response.result.value;
    }

    return cb(null, {isLoaded});
  });
}

app.post('/dom2page', (req: Request, res: Response): any => {
  const instanceData = remoteDebuggingPorts.find((item: IChromeInstance, index: number) => {
    if (!item.isInActive) {
      return false;
    }

    remoteDebuggingPorts[index].isInActive = false;
    return true;
  });

  if (!instanceData) {
    return res.json({error: 'Sorry, all instances of chrome isn\'t unavailable'});
  }

  Chrome({port: instanceData.port}, (chromeInstance: any) => {
    chromeInstance.Runtime.evaluate({
      'expression': `document.getElementsByTagName('html')[0].innerHTML = \`${body}\``
    }, function (error: Error, response: any) {
      if (error) {
        console.error('Protocol error: ', error);

        remoteDebuggingPorts.forEach((item: IChromeInstance) => {
          if (item.port !== instanceData.port) {
            return;
          }

          item.isInActive = true;
        });
      } else if (response.wasThrown) {
        console.error('Evaluation error', response);
      } else {
        imageExport(chromeInstance, res, instanceData as IChromeInstance, {}, 0);
      }
    });
  });
});

async function pdfExport(instance: any, response: Response, instanceData: IChromeInstance, timingObject: TimingObject, delay: number) {
  const takeScreenshotDebounce: Function = debounce(async () => {
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
    response.setHeader('Content-Disposition', 'attachment; filename=' + timingObject.exportName);

    doc.pipe(response);
    timingObject.pdfPiped = Date.now();

    doc.end();
    timingObject.documentClosed = Date.now();

    instance.close();
    timingObject.instanceClosed = Date.now();

    remoteDebuggingPorts.forEach((item: IChromeInstance) => {
      if (item.port !== instanceData.port) {
        return;
      }

      item.isInActive = true;
    });

    console.log(timingObject);
    console.log(`Export ${timingObject.exportName} image saved in: ${timingObject.imageSaved - timingObject.requestMade}`);

    if (typeof timingObject.pdfPiped !== 'undefined') {
      console.log(`Export ${timingObject.exportName} pdf sent in: ${timingObject.pdfPiped - timingObject.requestMade}`);
    }
  }, delay);

  takeScreenshotDebounce();
}

async function imageExport(instance: any, response: Response, instanceData: IChromeInstance, timingObject: TimingObject, delay: number) {
  const takeScreenshotDebounce: Function = debounce(async () => {
    let filename: any = await takeScreenshot(instance, timingObject)
      .catch((error: Error) => {
        console.log('Take Screenshot Call Error: ' + error);
      });

    response.setHeader('Content-Type', 'image/png');
    response.setHeader('Content-Disposition', 'attachment; filename=' + timingObject.exportName);

    remoteDebuggingPorts.forEach((item: IChromeInstance) => {
      if (item.port !== instanceData.port) {
        return;
      }

      item.isInActive = true;
    });

    fs.createReadStream(filename + '.png').pipe(response);

    instance.close();
    timingObject.instanceClosed = Date.now();

    console.log(timingObject);
  }, delay);

  takeScreenshotDebounce();
}

async function takeScreenshot(instance: any, timingObject: TimingObject) {
  timingObject.inTakeScreenshot = Date.now();

  const base64Image: any = await instance.Page.captureScreenshot();
  const filename: string = `screenshot-${Date.now()}`;

  fs.writeFileSync(filename + '.png', base64Image.data, 'base64');
  timingObject.imageSaved = Date.now();

  return filename;
}

function runServer() {
  eachLimit(remoteDebuggingPorts, 5, browsersInfo, (error: Error) => {
    if (error) {
      console.log(error);
      return;
    }

    console.log('Instances stats :');
    console.log(remoteDebuggingPorts);
    console.log('********************');

    app.listen(3000, () => {
      console.log('Export app running on 3000!');
    });
  });
}

function browsersInfo(item: IChromeInstance, cb: Function): Function {
  return Chrome.Version({port: item.port}, (err: Error) => {
    if (!err) {
      return cb(null, null);
    }

    setTimeout(() => {
      return browsersInfo(item, cb);
    }, 300);
  });
}
