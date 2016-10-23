let express = require('express');
let bodyParser = require('body-parser');
let fs = require('fs');
let Chrome = require('chrome-remote-interface');
let spawn = require('child_process').spawn;
let PDFDocument = require('pdfkit');

if (process.argv[ 2 ] === undefined) {
  throw Error('No headless binary path provided.');
}

spawn(process.argv[ 2 ], [ '--remote-debugging-port=9222' ]);
let _cri = null;

let app = express();
app.use(bodyParser.json({limit: '50mb'}));

function pageEvents(params) {
  params._cri.Page.enable();
  params._cri.once('ready', ()=> {
    params._cri.Page.navigate({url: params.url});
  })
}

app.post('/export', function (req, res) {
  let params = null;
  params = req.body;
  if (!params.url) {
    res.sendStatus(422)
  }
  params[ 'response' ] = res;
  params[ 'startTime' ] = Date.now();
  if (_cri) {
    params[ '_cri' ] = _cri;
    pageEvents(params);
  } else {
    Chrome.New(function (err, chromeInstanceTab) {
      Chrome({chooseTab: chromeInstanceTab}, chromeInstance => {
        _cri = chromeInstance;
        _cri.Page.loadEventFired(takeScreenshot.bind(null, params));
        params[ '_tab' ] = chromeInstanceTab;
        params[ '_cri' ] = _cri;
        pageEvents(params)
      });
    });
  }
});

function takeScreenshot(params) {
  params._cri.Page.captureScreenshot().then((v) => {
    let filename = `export-${Date.now()}`;

    fs.writeFileSync(filename + '.png', v.data, 'base64');

    if (params.format && params.format.toLowerCase() == 'pdf') {
      let doc = new PDFDocument();
      doc.image(filename + '.png');
      params.response.setHeader('Content-Type', 'application/pdf');
      params.response.setHeader('Content-Disposition', 'attachment; filename=' + filename + '.pdf');
      doc.pipe(params.response);
      doc.end();
      console.log("pdf generated and sent in: " + (Date.now() - +params.startTime) + "ms");
    } else {
      params.response.sendFile(filename + ".png", {root: __dirname});
      console.log("image generated and sent in: " + (Date.now() - +params.startTime) + "ms");
    }
  }).then(_ => {
    params._cri.Close({
      id: this._tab.id
    })
  });
}

app.listen(3000, function () {
  Chrome.Version().then(version => {
    console.log(version)
  });
  console.log('Export app running on 3000!');
});