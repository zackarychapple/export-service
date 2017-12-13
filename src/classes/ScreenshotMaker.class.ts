import { PdfSaverOptions } from '../support/PdfSaverOptions';
const Chrome = require('chrome-remote-interface');
import { CHROME_WAITING_PERIOD, DELAY_PER_CHECK } from '../support/constants';
import { EvaluationParameters } from '../support/EvaluationParameters';
import Timer = NodeJS.Timer;

interface Base64response {
  data: string;
}

export class ScreenshotMaker {

  private logger: any;

  // count of attempts of checking a required element on target page
  private attempts = 0;

  private delayScale = DELAY_PER_CHECK;

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

  public makeNativePdf(url: string, port: number, options: PdfSaverOptions, params: EvaluationParameters): Promise<any> {
    return this.perform(url, port, 'saveAsPdf', options, params);
  };

  private async perform(url: string, port: number, type: string, options?: PdfSaverOptions, params?: EvaluationParameters) {
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

        const {Page, Runtime, Network} = chromeInstance;
        await Page.enable();
        await Network.enable();

        await Page.navigate({url});
        await Page.loadEventFired();

        /* OPTIONAL CHECKS */

        // check if request to some url was receive response(document.load already emitted)
        const maxWaitingTime = params && params.maxWaitingTime && !isNaN(params.maxWaitingTime)
        && params.maxWaitingTime > this.delayScale ? params.maxWaitingTime : this.delayScale;

        if (params && params.requiredUrl && typeof params.requiredUrl === 'string'
          && params.requiredUrl.trim().length > 0) {
          const potentialError = await this.waitingForLoading(params.requiredUrl, maxWaitingTime, Network);

          if (potentialError) {
            this.logger.warn(potentialError)
          }
        }

        // will try to find some element on target page
        if (params && params.expectedElementId && typeof params.expectedElementId === 'string' &&
          params.expectedElementId.trim().length > 0) {

          const potentialError = await this.waitingForElement(params.expectedElementId.trim(), maxWaitingTime, Runtime, true);

          if (potentialError) {
            this.logger.warn(potentialError)
          }
        }

        // custom delay
        if (params && params.delay && !isNaN(params.delay) && params.delay > 0) {
          await this.delay(params.delay);
        }

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
  public domToImage(port: number, html: string): Promise<any> {
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

  /**
   * Will resolve promise after specified delay
   * @param {number} ms: Delay in milliseconds
   * @returns {Promise<any>}
   */
  private delay(ms: number) {
    return new Promise((res) => {
      setTimeout(() => {
        res();
      }, ms);
    })
  }

  /**
   * Will resolve promise when specified element found on target page(or time expired)
   * @param {string} id : id of required element
   * @param {number} maxTime : time when promise will be resolved forcibly
   * @param runtime
   * @param {boolean} isInitial : optional sets attempt to null
   * @returns {Promise<any>}
   */
  private waitingForElement(id: string, maxTime: number, runtime: any, isInitial = false) {
    this.attempts  = isInitial ? 0 : this.attempts + 1;
    const expression = `document.getElementById(${JSON.stringify(id)})`;

    return new Promise((res) => {
      if (this.attempts * this.delayScale >= maxTime) {
        return res('Optional evaluation check. WaitingForElement method. Attempts ended');
      }
      setTimeout(() => {
        runtime.evaluate({expression}).then(async (response: any) => {
          const evalResult = (!response.result || response.result.value === null) ?
            await this.waitingForElement(id, maxTime, runtime) : undefined;
          console.log('waitingForElement, is error:' + evalResult);
          res(evalResult);
        }).catch((e: any) => {
          res('Optional evaluation check. waitingForElement method. ' + e);
        });

      }, this.delayScale);
    });
  }

  /**
   * Will resolve promise after specified endpoint returns data(or time expired)
   * @param {string} url : url which should respond for resolving a promise
   * @param {number} maxTime : time when promise will be resolved forcibly
   * @param network
   * @returns {Promise<any>}
   */
  private waitingForLoading(url: string, maxTime: number, network: any) {
    let timer: Timer;
    return new Promise((res) => {
      timer = setTimeout(() => {
        res('Optional evaluation check. waitingForLoading method. Timeout expired');
      }, maxTime);
      network.responseReceived((params: any) => {
        if (params.response.url.indexOf(url) > -1) {
          clearInterval(timer);
          console.log('waitingForLoading: URL loaded');
          res();
        }
      });
    })
  }
}
