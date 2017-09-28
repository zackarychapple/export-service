import { PdfSaverOptions } from '../support/PdfSaverOptions';
const Chrome = require('chrome-remote-interface');
import { CHROME_WAITING_PERIOD } from '../support/constants';

interface Base64response {
  data: string;
}

export class ScreenshotMaker {

  private logger: any;

  constructor(logger: any) {
    this.logger = logger;
  }

  /**
   * Will return Buffer with specified url content(screenshot, not all page)
   * @param {string} url
   * @param {number} port
   * @returns {any}
   */
  public makeScreenshot(url: string, port: number): Promise<any> {
    return this.perform(url, port, 'getScreenshot');
  }

  public makeNativePdf(url: string, port: number, options: PdfSaverOptions): Promise<any> {
    return this.perform(url, port, 'saveAsPdf', options);
  };

  private async perform(url: string, port: number, type: string, options?: PdfSaverOptions) {
    console.log(url);
    let resolve: Function;
    let reject: Function;
    const resultPromise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });

    Chrome({port}, async (chromeInstance: any) => {
      const waitingTimeout = setTimeout(() => {
        chromeInstance.close();
        const msg = `Chrome url performing(${type} case). Error receiving data(timeout of page response exceeded), url: ${url}`;
        this.logger.warn(msg);
        reject('Error receiving data(timeout of page response exceeded)');
      }, CHROME_WAITING_PERIOD);
      try {

        const {Page} = chromeInstance;
        await Page.enable();
        await Page.navigate({url});
        await Page.loadEventFired();

        const {data} = (type === 'saveAsPdf') ?
          await Page.printToPDF(options) :
          await Page.captureScreenshot();

        resolve(Buffer.from(data, 'base64'));
      } catch (e) {
        const msg = `Chrome url performing(${type} case) error: ${e}`;
        this.logger.error(msg);
        reject(e);
      } finally {
        chromeInstance.close();
        if (waitingTimeout) {
          clearTimeout(waitingTimeout);
        }
      }

    });

    return resultPromise;
  }


  /**
   * Will create image from passed html string
   * @param {number} port
   * @param {string} html
   */
  public domToImage(port: number, html: string,): Promise<any> {
    let resolve: Function;
    let reject: Function;
    const resultPromise = new Promise((res: Function, rej: Function) => {
      resolve = res;
      reject = rej;
    });
    Chrome({port}, (chromeInstance: any) => {
      chromeInstance.Runtime.evaluate({
        'expression': `document.getElementsByTagName('html')[0].innerHTML = \`${html}\``
      }, (error: Error, response: any) => {

        if (error) {
          const msg = 'Error. DOM to Image: ' + error.toString();
          this.logger.error(msg);
          chromeInstance.close();
          return reject(error);
        }

        if (response.wasThrown) {
          this.logger.error('Thrown. DOM to Image: ' + response);
          chromeInstance.close();
          return reject('Evaluation error');
        }

        chromeInstance.Page.captureScreenshot().then((base64: Base64response) => {
          chromeInstance.close();
          resolve(Buffer.from(base64.data, 'base64'))
        });
      })
    });
    return resultPromise;
  }
}
